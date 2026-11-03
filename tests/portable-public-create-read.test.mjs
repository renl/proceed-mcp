// TEST ONLY: design 3 A1b public binding / 7. Pairing is setup, requests are NEVER seeded.
import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { publicRegistration, success, toolError } from './support/public-registration.mjs';
import { workflowInstructions } from './support/catalog-consumer.mjs';

const fixture = (work, paired = true) => publicRegistration(work, { paired, foreign: true });
const options = { timeout: 65000 };
const denial = { schema_version: 1, error: { code: 'NOT_FOUND', message: 'no such request', retryable: false } };
const rows = bytes => readJournal(bytes).transactions.flatMap(t => t.mutations);
const auth = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const payload = p => ({ request_handle: p.request_handle, client_request_id: 'public_key', action: 'Offline question?', context: '' });
const header = p => ({ 'X-Proceed-Request-Capability': p.request_capability });
async function response(h, path, token, opts) {
  const r = await h.http(path, token, opts);
  return { status: r.status, body: await r.json() };
}
const post = (h, p, body = payload(p), token = h.owner, headers = header(p)) =>
  response(h, '/v1/requests', token, { method: 'POST', headers, body: JSON.stringify(body) });
const read = (h, p, token = h.owner, headers = header(p)) => response(h, `/v1/requests/${p.request_id}`, token, { headers });
async function prepare(h, a, args = {}) {
  const p = success(await a.call('prepare_approval', args));
  assert.match(p.request_handle, /^hdl_[a-f0-9]{32}$/);
  assert.match(p.request_id, /^req_[a-f0-9]{32}$/);
  assert.match(p.request_capability, /^cap_[a-f0-9]{64}$/);
  h.requestSecrets.push(p.request_capability);
  assert.ok(!(await h.journal()).includes(Buffer.from(p.request_capability)), 'durable reservation stores no plaintext key');
  return p;
}
function representation(value, p, label = 'Lifecycle test', duration = 3600) {
  assert.match(value.created_at, /^\d{4}-\d\d-\d\dT.*Z$/);
  assert.equal(Date.parse(value.expires_at) - Date.parse(value.created_at), duration * 1000);
  assert.deepEqual(value, { schema_version: 1, request_handle: p.request_handle, request_id: p.request_id,
    client_request_id: 'public_key', owner_id: 'shared', session_label: label, action: 'Offline question?', context: '',
    created_at: value.created_at, expires_at: value.expires_at, resolution: 'pending', resolved_at: null,
    response_text: null, decision_id: null, telegram_state: 'pending', delivery_state: 'not_applicable', delivery_error: null,
    event_capability: { status: 'unverified', revision: null, reason: 'No verified Events contract or host support' } });
}
async function created(h, p) {
  const r = await post(h, p); assert.equal(r.status, 201, 'actual public POST must create, not seed or return private null');
  representation(r.body, p); return r.body;
}
function noAuthority(value, p, h) {
  const text = JSON.stringify(value);
  assert.ok([p.request_capability, ...h.secrets].every(s => !text.includes(s)), 'ordinary result redacts all authority');
  assert.doesNotMatch(text, /capability_hash|pairing_snapshot|registration_secret/);
}

test('PUB-CAL: stopped pairing decoder, closed writer, actual serve + real MCP reservation only', options, () => fixture(async h => {
  const j = await Journal.open(join(h.state, 'journal.log')); let b;
  try {
    b = createPortableBroker({ journal: j, owners: [{ owner_id: 'shared', label: 'Lifecycle test' }], port: 43189 });
    await b.recover(); assert.deepEqual(b.pairing(), { user_id: '71', chat_id: '81', paired_at: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(b.snapshot().requests, []);
  } finally { try { await b?.close(); } finally { await j.close(); } }
  await h.restart(); const a = await h.connect(); const p = await prepare(h, a);
  assert.equal(rows(await h.journal()).filter(m => m.op === 'handle.reserve').length, 1);
  assert.equal(rows(await h.journal()).filter(m => m.op === 'request.create').length, 0);
  assert.deepEqual(await read(h, p), { status: 404, body: denial }); await h.eof(a);
}));

test('PUB-CREATE: 201 exact view/default, registration-free 200 replay/GET, conflict leaves future history unchanged', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect(), p = await prepare(h, a); await h.eof(a);
  const before = Date.now(), value = await created(h, p);
  assert.ok(Date.parse(value.created_at) >= before && Date.parse(value.created_at) <= Date.now());
  const bytes = await h.journal();
  for (const body of [payload(p), { ...payload(p), expires_in_seconds: 3600 }])
    assert.deepEqual(await post(h, p, body), { status: 200, body: value });
  assert.deepEqual(await read(h, p), { status: 200, body: value });
  assert.deepEqual(await read(h, p, h.owner, { ...header(p), 'X-Proceed-Registration': 'irrelevant' }), { status: 200, body: value });
  for (const changed of [{ client_request_id: 'changed' }, { action: 'Different' }, { context: 'Changed' }, { expires_in_seconds: 60 }]) {
    const r = await post(h, p, { ...payload(p), ...changed });
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'IDEMPOTENCY_CONFLICT'); noAuthority(r.body, p, h);
  }
  assert.deepEqual(await h.journal(), bytes, 'future-only no-append window, no status/sweep used');
  const mutations = rows(bytes).filter(m => m.op === 'request.create');
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0].request_handle, p.request_handle);
  assert.equal(mutations[0].expires_in_seconds, 3600);
  assert.equal(mutations[0].expires_at, value.expires_at);
  assert.ok(!bytes.includes(Buffer.from(p.request_capability)), 'actual public writer never persists plaintext authority');
  assert.equal(rows(bytes).filter(m => m.op === 'request.expire').length, 0); noAuthority(value, p, h);
}));

test('PUB-MCP: actual get success, lazy registration, cross-principal denial, EOF capability transfer; no waiting/delivery success', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect();
  assert.equal(h.calls.length, 0, 'real initialize/catalog have zero broker traffic');
  const p = await prepare(h, a), value = await created(h, p), bytes = await h.journal();
  assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1);
  const same = await a.call('get_approval', auth(p)); noAuthority(same, p, h);
  assert.deepEqual(success(same), value, 'same-principal key transfer on shared connection');
  const foreign = await h.connect('foreign');
  const denied = await foreign.call('get_approval', auth(p)); noAuthority(denied, p, h);
  assert.deepEqual(toolError(denied, 'NOT_FOUND'), denial.error);
  await h.eof(foreign); await h.eof(a);
  const replacement = await h.connect(); // Prior same-owner adapter is fully released first.
  const outcome = await replacement.call('get_approval', auth(p)); noAuthority(outcome, p, h);
  const observed = success(outcome);
  assert.deepEqual(observed, value); noAuthority(observed, p, h);
  toolError(await replacement.call('request_approval', { ...payload(p), action: 'Changed question', request_capability: p.request_capability }), 'IDEMPOTENCY_CONFLICT');
  for (const [name, args] of [['acknowledge_approval', { ...auth(p), decision_id: `dec_${'1'.repeat(32)}` }]])
    toolError(await replacement.call(name, args), 'DECISION_MISMATCH');
  const registration = h.calls.filter(c => c.path === '/v1/adapter').at(-1).reply;
  // Real pending wait/turnover/abort coverage lives in portable-wait; this client's deadline is shorter than 25s.
  for (const suffix of ['returned', 'acknowledge']) {
    const body = suffix === 'returned' ? { registration_id: registration.registration_id, decision_id: `dec_${'1'.repeat(32)}` }
      : suffix === 'acknowledge' ? { decision_id: `dec_${'1'.repeat(32)}` } : {};
    const r = await response(h, `/v1/requests/${p.request_id}/${suffix}`, h.owner,
      { method: 'POST', headers: { ...header(p), 'X-Proceed-Registration': registration.registration_secret }, body: JSON.stringify(body) });
    assert.equal(r.status, 409, 'pending evidence cannot resolve or expire'); noAuthority(r.body, p, h);
  }
  assert.equal(h.calls.filter(c => c.method === 'POST' && c.path === '/v1/requests').length, 1, 'MCP reaches real conflict without waiting or mutation');
  assert.deepEqual(await h.journal(), bytes, 'observation/denials/EOF never record returned or confirmed');
  assert.ok(h.calls.some(c => c.method === 'GET' && c.path === `/v1/requests/${p.request_id}` && c.status === 200));
  await h.eof(replacement);
}));

test('PUB-UNPAIRED: exact 503 after valid authority; preparation survives, no approval/deadline/callback/waiter', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect(), p = await prepare(h, a), bytes = await h.journal();
  assert.deepEqual(await post(h, p), { status: 503, body: { schema_version: 1, error: { code: 'NOT_PAIRED',
    message: 'No human is paired; run proceed-mcp pair and complete private-chat pairing', retryable: false } } });
  assert.deepEqual(await post(h, p, payload(p), h.owner, {}), { status: 404, body: denial });
  assert.deepEqual(await read(h, p), { status: 404, body: denial });
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}, false));

test('PUB-INPUT: caller payload400 before handle/cap404, extra fields and missing required payload never ignored', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect(), p = await prepare(h, a), bytes = await h.journal();
  const missing = key => { const v = payload(p); delete v[key]; return v; };
  for (const body of [...['client_request_id', 'action', 'context'].map(missing),
    { ...payload(p), owner_id: 'shared' }, { ...payload(p), request_capability: p.request_capability },
    ...[null, 59, 86401, 60.5, '3600'].map(expires_in_seconds => ({ ...payload(p), expires_in_seconds })),
    { ...payload(p), request_handle: 'bad', action: '' }, { ...missing('request_handle'), context: null }]) {
    const r = await post(h, p, body, h.owner, {});
    assert.equal(r.status, 400); assert.equal(r.body.error.code, 'INVALID_ARGUMENT'); noAuthority(r.body, p, h);
  }
  for (const body of [missing('request_handle'), { ...payload(p), request_handle: null }, { ...payload(p), request_handle: 'bad' }])
    assert.deepEqual(await post(h, p, body), { status: 404, body: denial });
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}));

test('PUB-AUTH: Origin403/control403/noBearer401 before malformed payload, create and read', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect(), p = await prepare(h, a), bytes = await h.journal();
  for (const [token, extra, status, code] of [[h.control, {}, 403, 'FORBIDDEN'], [null, {}, 401, 'AUTH_REQUIRED'],
    [null, { origin: 'https://browser.invalid' }, 403, 'FORBIDDEN']]) {
    for (const [path, opts] of [['/v1/requests', { method: 'POST', body: '{' }], [`/v1/requests/${p.request_id}`, {}]]) {
      const r = await response(h, path, token, { ...opts, headers: extra });
      assert.equal(r.status, status); assert.equal(r.body.error.code, code); noAuthority(r.body, p, h);
    }
  }
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}));

test('PUB-DENIAL: exact uniform404 for unused/unknown/foreign/mismatched/missing/malformed authority, no effects', options, () => fixture(async h => {
  await h.restart(); const a = await h.connect(), p = await prepare(h, a), unused = await prepare(h, a);
  await created(h, p); const bytes = await h.journal();
  const foreign = h.secrets[2]; assert.ok(foreign && foreign !== h.owner);
  for (const [token, headers] of [[h.owner, {}], [h.owner, { 'X-Proceed-Request-Capability': 'bad' }],
    [h.owner, header(unused)], [foreign, header(p)]]) {
    assert.deepEqual(await post(h, p, payload(p), token, headers), { status: 404, body: denial });
    assert.deepEqual(await read(h, p, token, headers), { status: 404, body: denial });
  }
  for (const target of [unused, { ...p, request_id: `req_${'0'.repeat(32)}` }, { ...p, request_id: 'bad' }])
    assert.deepEqual(await read(h, target), { status: 404, body: denial });
  assert.deepEqual(await post(h, p, { ...payload(p), request_handle: `hdl_${'0'.repeat(32)}` }), { status: 404, body: denial });
  assert.deepEqual(await h.journal(), bytes); await h.eof(a);
}));

test('PUB-CATALOG: actual initialize/catalog disclose observation and acknowledgement without losing safety guidance', options, () => fixture(async h => {
  const a = await h.connect(); workflowInstructions(a.init, a.tools);
  const get = a.tools.find(t => t.name === 'get_approval').description;
  const retrievalInstructions = a.init.instructions.split('\n').filter(line => line.includes('get_approval')).join('\n');
  for (const text of [retrievalInstructions, get]) {
    assert.match(text, /pending/i); assert.match(text, /expired|expiry/i); assert.match(text, /NOT_FOUND/);
  }
  const ack = a.tools.find(t => t.name === 'acknowledge_approval').description;
  const unavailableAck = /acknowledg[^.\n]*(?:unavailable|not (?:yet )?(?:available|implemented|enabled)|cannot record)/i;
  assert.doesNotMatch(a.init.instructions, unavailableAck); assert.doesNotMatch(ack, /unavailable|not (?:yet )?(?:available|implemented|enabled)|cannot record/i);
  assert.doesNotMatch(ack, /until[^.\n]*wait/i, 'A2 acknowledgement not contingent on waiting B');
  assert.match(a.init.instructions, /terminal[^\n]*acknowledg/i);
  assert.match(a.init.instructions, /(?:assistant|operator)[^\n]*(?:outcome|acknowledg)|acknowledg[^\n]*(?:assistant|operator)/i);
  assert.match(a.init.instructions, /deduplicat[^\n]*request_id[^\n]*decision_id/i);
  for (const text of [a.init.instructions, a.tools.find(t => t.name === 'request_approval').description])
    assert.doesNotMatch(text, /request_approval[^.\n]*(?:ENHANCEMENT_UNAVAILABLE|not (?:yet )?(?:implemented|available|enabled))/i);
   assert.match(a.init.instructions, /sends[^\n]*approval question[^\n]*paired private chat[^\n]*Telegram/i);
   assert.match(a.init.instructions, /Telegram decision capture is not available[^\n]*no approval, rejection or response is recorded/i);
  assert.equal(h.calls.length, 0, 'catalog remains brokerless'); await h.eof(a);
}));
