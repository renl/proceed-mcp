// TEST ONLY: design 3/6/7. Real MCP/serve/HTTP; pairing seed is not human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { readJournal } from '../src/journal/framing.js';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';
import { recorded, reports } from './support/adapter-write-report.mjs';

const opts = { timeout: 65000 }, label = { session_label: 'same label' };
const authority = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const question = p => ({ request_handle: p.request_handle, request_capability: p.request_capability,
  client_request_id: 'same', action: 'Proceed?', context: '', expires_in_seconds: 60 });
const waits = h => h.calls.filter(c => c.path.endsWith('/wait'));
const creates = h => h.calls.filter(c => c.path === '/v1/requests');
const mutations = async h => readJournal(await h.journal()).transactions.flatMap(t => t.mutations);
const invoke = (a, id, p, suppressed = false) => a.call('request_approval', question(p), { id, ms: 5000, suppressed });
const cancelInvocation = (a, requestId) => a.resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0',
  method: 'notifications/cancelled', params: { requestId, reason: 'cancel approval' } }) + '\n');
function observer() {
  let tail = '', ended = false; const frames = [];
  return { frames, attach(child) {
    child.stdout.on('data', b => {
      tail += b.toString(); let end;
      while ((end = tail.indexOf('\n')) >= 0) {
        frames.push(JSON.parse(tail.slice(0, end))); tail = tail.slice(end + 1);
      }
    });
    child.stdout.on('end', () => { ended = true; });
  }, complete() { assert.ok(ended && tail === '', 'raw observer reaches exact framing EOF'); } };
}
const framesFor = (raw, ids) => raw.frames.filter(f => ids.includes(f.id));
async function frameless(raw, ids) {
  assert.equal(framesFor(raw, ids).length, 0);
  await delay(150); // Explicit measured negative window, after real wait admission.
  assert.equal(framesFor(raw, ids).length, 0, 'no pending receipt/progress/result frame in 150ms window');
}
async function prepare(h, a) {
  const p = success(await a.call('prepare_approval', label));
  h.requestSecrets.push(p.request_capability); return p;
}
function noReports(h) {
  assert.ok(!h.calls.some(c => /\/(returned|acknowledge)$/.test(c.path)), 'no receipt/write reporting in W1b');
}
async function admitted(h, p) {
  const path = `/v1/requests/${p.request_id}/wait`;
  await observe(() => waits(h).some(c => c.path === path && c.body), 'actual adapter wait request reaches relay');
  const w = waits(h).find(c => c.path === path), reg = h.calls.find(c => c.path === '/v1/adapter').reply;
  assert.equal(w.method, 'POST'); assert.deepEqual(w.body, { registration_id: reg.registration_id });
  assert.ok(w.header === reg.registration_secret && w.token === `Bearer ${h.owner}` &&
    w.capability === p.request_capability, 'wait uses captured registration, principal and request authority');
  assert.ok(!w.closed && !w.committed, 'actual HTTP exchange attached, not a terminal fixture');
  const made = creates(h).find(c => c.body?.request_handle === p.request_handle);
  assert.equal(made.status, 201); assert.equal(made.reply.resolution, 'pending');
  const { request_capability, ...body } = question(p);
  assert.deepEqual(made.body, body); assert.ok(made.capability === request_capability && made.token === `Bearer ${h.owner}`);
  // Direct real broker duplicate probe proves admission, not merely an unsettled Promise.
  const before = await h.journal();
  const duplicate = await h.http(path, h.owner, { method: 'POST', headers: {
    'X-Proceed-Request-Capability': p.request_capability, 'X-Proceed-Registration': w.header }, body: JSON.stringify(w.body) });
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).error.code, 'WAIT_ALREADY_ACTIVE');
  assert.ok(before.equals(await h.journal()), 'admission probe has no durable effect');
  return w;
}
async function terminal(h, p) {
  const r = await h.http(`/v1/requests/${p.request_id}/cancel`, h.owner, { method: 'POST',
    headers: { 'X-Proceed-Request-Capability': p.request_capability }, body: '{}' });
  assert.equal(r.status, 200); const v = await r.json();
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'pending');
  assert.equal(v.response_text, null); assert.match(v.decision_id, /^dec_[a-f0-9]{32}$/);
  return v;
}
function original(outcome, id, expected) {
  assert.equal(outcome.frame.id, id); assert.equal(typeof outcome.frame.id, typeof id);
  assert.deepEqual(success(outcome), expected); // Shared consumer checks structured/text equality.
}
async function finish(h, a, raw) {
  const written = waits(h).filter(w => w.status === 200);
  for (const w of written) await recorded(h, { request_id: w.reply.request_id, request_capability: w.capability });
  assert.equal(reports(h).length, written.length); await h.eof(a); raw.complete();
  const rows = await mutations(h);
  assert.equal(rows.filter(m => m.op === 'request.returned').length, written.length);
  assert.ok(!rows.some(m => m.op === 'request.acknowledge'));
}

test('W1b-ORIGINAL: actual pending original call returns real committed cancel; replay/conflict are inert', opts, () => publicRegistration(async h => {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = await prepare(h, a), pending = invoke(a, 'original', p);
  const w = await admitted(h, p); await frameless(raw, ['original']);
  assert.equal(creates(h).length, 1); assert.equal(waits(h).length, 1);
  const v = await terminal(h, p); original(await pending, 'original', v);
  assert.equal(w.status, 200); assert.deepEqual(w.reply, v);
  const rows = await mutations(h);
  assert.equal(rows.filter(m => m.op === 'request.create').length, 1);
  const cancel = rows.filter(m => m.op === 'request.cancel'); assert.equal(cancel.length, 1);
  assert.equal(cancel[0].decision_id, v.decision_id); assert.equal(cancel[0].delivery_state, 'pending');
  await recorded(h, p); const before = await h.journal();
  original(await invoke(a, 'replay', p), 'replay', { ...v, delivery_state: 'returned' });
  assert.equal(creates(h).length, 2, 'one explicit replay exchange, not recreation');
  assert.equal(creates(h)[1].status, 200); assert.equal(waits(h).length, 1, 'terminal replay never waits again');
  toolError(await a.call('request_approval', { ...question(p), action: 'Changed' }), 'IDEMPOTENCY_CONFLICT');
  assert.ok(before.equals(await h.journal()), 'terminal replay/conflict append nothing');
  assert.deepEqual(framesFor(raw, ['original', 'replay']).map(f => f.id), ['original', 'replay']);
  await finish(h, a, raw);
}, { paired: true }));

test('W1b-REVERSE: same labels/client IDs, simultaneous typed IDs7/string7, reverse real closure', opts, () => publicRegistration(async h => {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = await prepare(h, a), q = await prepare(h, a);
  assert.ok(p.request_id !== q.request_id && p.request_handle !== q.request_handle && p.request_capability !== q.request_capability);
  const first = invoke(a, 7, p), second = invoke(a, '7', q);
  await admitted(h, p); await admitted(h, q); await frameless(raw, [7, '7']);
  await prepare(h, a); // Public later invocation progresses while both waits are attached.
  assert.equal(creates(h).length, 2); assert.equal(waits(h).length, 2);
  const qv = await terminal(h, q); original(await second, '7', qv);
  assert.deepEqual(framesFor(raw, [7, '7']).map(f => f.id), ['7']);
  await frameless(raw, [7]); const pv = await terminal(h, p); original(await first, 7, pv);
  assert.notEqual(pv.decision_id, qv.decision_id);
  assert.deepEqual(framesFor(raw, [7, '7']).map(f => f.id), ['7', 7]);
  for (const v of [pv, qv]) { assert.equal(v.client_request_id, 'same'); assert.equal(v.session_label, label.session_label); }
  assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1);
  await finish(h, a, raw);
}, { paired: true }));

test('W1b-DUPLICATE: overlapping same-handle call cannot disturb live original', opts, () => publicRegistration(async h => {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = await prepare(h, a), pending = invoke(a, 7, p); await admitted(h, p);
  const before = await h.journal();
  assert.equal(toolError(await invoke(a, 'duplicate', p), 'WAIT_ALREADY_ACTIVE').retryable, false);
  assert.equal(creates(h).length, 1); assert.equal(waits(h).length, 1);
  assert.ok(before.equals(await h.journal())); await frameless(raw, [7]);
  const v = await terminal(h, p); original(await pending, 7, v);
  await finish(h, a, raw);
}, { paired: true }));

test('W1b-AUTHORITY: wrong key/foreign principal denied while actual original survives', opts, t => publicRegistration(async h => {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = await prepare(h, a), q = await prepare(h, a), foreign = await h.connect('foreign');
  const pending = invoke(a, 'owned', p); await admitted(h, p); const before = await h.journal();
  for (const [name, caller, key] of [['wrong-key', a, q.request_capability], ['foreign-principal', foreign, p.request_capability]]) await t.test(name, async () => {
    const denied = async (name, args) => {
      const out = await caller.call(name, args); toolError(out, 'NOT_FOUND');
      assert.ok(!JSON.stringify(out.frame.result).includes(p.request_id), 'denial reveals no request identity');
    };
    await denied('request_approval', { ...question(p), request_capability: key });
    for (const name of ['get_approval', 'cancel_approval']) await denied(name, { ...authority(p), request_capability: key });
  });
  assert.equal(waits(h).length, 1); assert.ok(before.equals(await h.journal()), 'denials change no durable business state');
  await frameless(raw, ['owned']); const v = success(await a.call('cancel_approval', authority(p)));
  assert.equal(v.resolution, 'cancelled'); assert.equal(v.delivery_state, 'pending'); original(await pending, 'owned', v);
  await h.eof(foreign); await finish(h, a, raw);
}, { paired: true, foreign: true }));

test('W1b-DETACH: cancel one real typed wait then EOF another, no business cancellation/late frame', opts, () => publicRegistration(async h => {
  await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
  const p = await prepare(h, a), q = await prepare(h, a);
  const removed = invoke(a, 7, p, true), survivor = invoke(a, '7', q, true);
  const target = await admitted(h, p), other = await admitted(h, q), before = await h.journal();
  cancelInvocation(a, 'unknown'); await a.peer.call('ping', {}).outcome;
  assert.ok(!target.socketClosed && !other.socketClosed);
  cancelInvocation(a, 7);
  await observe(() => target.socketClosed, 'matched real wait client socket destroyed', 1000);
  assert.ok(!other.socketClosed, 'other typed ID wait still attached');
  assert.ok(before.equals(await h.journal())); await frameless(raw, [7, '7']);
  await h.eof(a); raw.complete();
  await observe(() => other.socketClosed, 'EOF destroys other actual wait transport', 1000);
  assert.equal((await removed).kind, 'transport-closed'); assert.equal((await survivor).kind, 'transport-closed');
  assert.equal(framesFor(raw, [7, '7']).length, 0); assert.ok(before.equals(await h.journal()));
  const release = h.calls.filter(c => c.method === 'DELETE'), reg = h.calls.find(c => c.path === '/v1/adapter').reply;
  assert.equal(release.length, 1); assert.ok(release[0].path.endsWith(reg.registration_id) && release[0].header === reg.registration_secret);
  for (const item of [q, p]) {
    const r = await h.http(`/v1/requests/${item.request_id}`, h.owner, { headers: { 'X-Proceed-Request-Capability': item.request_capability } });
    assert.equal(r.status, 200); const v = await r.json(); assert.equal(v.resolution, 'pending'); assert.equal(v.delivery_state, 'not_applicable');
  }
  assert.equal(creates(h).length, 2); assert.equal(waits(h).length, 2); noReports(h);
}, { paired: true }));
