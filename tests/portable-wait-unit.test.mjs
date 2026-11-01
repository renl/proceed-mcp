// TEST ONLY: selected private seams, design 3/6/7; NOT original-call/wire proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createToolExecutor } from '../src/mcp/execution.js';
import * as local from '../src/http/local-client.js';
import { bounded } from './support/managed-spike.mjs';
const id = (p, n = '1') => p + n.repeat(32);
const args = () => ({ request_handle: id('hdl_'), request_capability: `cap_${'1'.repeat(64)}`,
  client_request_id: 'same', action: 'Question?', context: '' });
const authority = n => ({ registration_id: id('reg_', n), registration_secret: n.repeat(64) });
const view = (extra = {}) => ({ schema_version: 1, request_handle: id('hdl_'), request_id: id('req_'),
  client_request_id: 'same', owner_id: 'shared', session_label: 'display', action: 'Question?', context: '',
  created_at: '2026-11-01T00:00:00Z', expires_at: '2026-11-01T01:00:00Z', resolution: 'pending',
  resolved_at: null, response_text: null, decision_id: null, telegram_state: 'pending',
  delivery_state: 'not_applicable', delivery_error: null,
  event_capability: { status: 'unverified', revision: null, reason: 'No verified Events contract or host support' }, ...extra });
const terminal = () => view({ resolution: 'cancelled', resolved_at: '2026-11-01T00:00:01Z',
  decision_id: id('dec_'), delivery_state: 'unavailable' });
const reply = (body, status = 200) => ({ status, body });
const fault = (code, status = 409) => reply({ schema_version: 1,
  error: { code, message: 'safe diagnostic', retryable: false } }, status);
const turns = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function fixture(wait, create = () => reply(view(), 201)) {
  const calls = [], waits = [], refreshes = []; let ensured = 0, current = authority('1');
  const registration = { async ensure() { ensured++; return current; },
    async refresh(captured) { refreshes.push(captured); current = authority('2'); return current; }, close() {} };
  const client = { async request(...a) { calls.push(a); return create(...a); } };
  const waitClient = { async request(...a) { waits.push(a); return wait(...a); } };
  return { ex: createToolExecutor({ client, waitClient, registration }), calls, waits, refreshes,
    ensured: () => ensured };
}
function error(result, code) {
  assert.equal(result.isError, true); assert.equal(result.structuredContent.error.code, code);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent.error;
}
function success(result, expected) {
  assert.equal(result.isError, false); assert.deepEqual(result.structuredContent, expected);
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
}
test('WAIT-U-CONSUMER: success/error consumers reject fabricated success and unequal channels', () => {
  const result = { isError: false, structuredContent: terminal(), content: [{ type: 'text', text: JSON.stringify(terminal()) }] };
  success(result, terminal());
  for (const broken of [{ ...result, isError: true }, { ...result, structuredContent: view() },
    { ...result, content: [{ type: 'text', text: '{}' }] }]) assert.throws(() => success(broken, terminal()));
  assert.throws(() => error(result, 'BROKER_UNAVAILABLE'));
});
test('WAIT-U-INPUT: required/formats/scalar/duration validation before all broker contact', async () => {
  const missing = k => { const v = args(); delete v[k]; return v; };
  const f = fixture(() => reply(terminal()));
  try {
    for (const v of [null, [], ...Object.keys(args()).map(missing),
      ...['request_handle', 'request_capability', 'client_request_id'].map(k => ({ ...args(), [k]: 'bad!' })),
      ...[null, 59, 86401, 60.5, '60'].map(expires_in_seconds => ({ ...args(), expires_in_seconds })),
      { ...args(), action: '' }, { ...args(), action: '\ud800' }, { ...args(), context: '\udfff' },
      { ...args(), action: '😀'.repeat(1001) }, { ...args(), context: null },
      { ...args(), context: '😀'.repeat(1001) }, { ...args(), owner_id: 'shared' }])
      error(await f.ex.execute('request_approval', v), 'INVALID_ARGUMENT');
    assert.equal(f.ensured(), 0); assert.equal(f.calls.length + f.waits.length, 0);
  } finally { await f.ex.close(); }
});
test('WAIT-U-CREATE: exact create once/default omission/capability, repeated204 same target/registration', async () => {
  assert.equal(local.LOCAL_WAIT_TIMEOUT_MS, 32000);
  for (const extra of [{}, { expires_in_seconds: 60 }, { expires_in_seconds: 86400, action: '😀'.repeat(1000) }]) {
    let n = 0; const f = fixture(() => ++n < 3 ? reply(null, 204) : reply(terminal()));
    try {
      const input = { ...args(), ...extra }; success(await f.ex.execute('request_approval', input), terminal());
      assert.equal(f.calls.length, 1); assert.equal(f.waits.length, 3);
      const { request_capability, ...body } = input;
      assert.deepEqual(f.calls[0].slice(0, 4), ['POST', '/v1/requests', body,
        { 'X-Proceed-Request-Capability': request_capability }]);
      for (const w of f.waits) assert.deepEqual(w.slice(0, 4), ['POST', `/v1/requests/${id('req_')}/wait`,
        { registration_id: authority('1').registration_id }, { 'X-Proceed-Request-Capability': request_capability,
          'X-Proceed-Registration': authority('1').registration_secret }]);
      assert.ok([...f.calls, ...f.waits].every(c => c[4].signal instanceof AbortSignal));
    } finally { await f.ex.close(); }
  }
});
test('WAIT-U-REPLAY: terminal create replay immediate; NOT_PAIRED propagated without wait/recreate', async () => {
  for (const response of [reply(terminal()), fault('NOT_PAIRED', 503)]) {
    const f = fixture(() => assert.fail('no wait after terminal/refusal'), () => response);
    try { const r = await f.ex.execute('request_approval', args());
      if (response.status === 200) success(r, terminal()); else assert.deepEqual(error(r, 'NOT_PAIRED'), response.body.error);
      assert.equal(f.calls.length, 1); assert.equal(f.waits.length, 0);
    } finally { await f.ex.close(); }
  }
});
test('WAIT-U-ENSURE: cancellation during shared registration stops only this wait invocation', async () => {
  let release; const pending = new Promise(r => { release = r; }); const calls = [];
  const client = { async request(...v) { calls.push(v); return reply(terminal()); } };
  const ex = createToolExecutor({ client, waitClient: client,
    registration: { ensure: () => pending, close() {} } });
  const c = new AbortController(), one = ex.execute('request_approval', args(), { signal: c.signal });
  try { c.abort(); error(await bounded(() => one, 200, 'registration wait abort'), 'BROKER_UNAVAILABLE');
    assert.equal(calls.length, 0); release(authority('1'));
    success(await ex.execute('request_approval', args()), terminal()); assert.equal(calls.length, 1);
    assert.equal(getEventListeners(c.signal, 'abort').length, 0);
  } finally { release(authority('1')); c.abort(); await ex.close(); }
});
test('WAIT-U-FAIL-CLOSED: pending/malformed200/identity/decision never outcome or retry', async () => {
  for (const body of [view(), null, {}, terminal(), { ...terminal(), decision_id: 'bad' },
    { ...terminal(), request_id: id('req_', '2') }, { ...terminal(), resolution: 'invented' }]) {
    // The unmodified terminal control is deliberately accepted, calibrating the negatives.
    const f = fixture(() => reply(body));
    try { const r = await f.ex.execute('request_approval', args());
      if (body?.resolution === 'cancelled' && body.decision_id === id('dec_') && body.request_id === id('req_')) success(r, body);
      else { assert.equal(error(r, 'BROKER_UNAVAILABLE').retryable, true);
        assert.ok(!JSON.stringify(r).includes(args().request_capability)); }
      assert.equal(f.waits.length, 1); assert.equal(f.calls.length, 1);
    } finally { await f.ex.close(); }
  }
});
test('WAIT-U-CONFLICT: explicit409 never reconnects, reservation released for explicit retry', async () => {
  let n = 0; const f = fixture(() => ++n === 1 ? fault('WAIT_ALREADY_ACTIVE') : reply(terminal()));
  try { assert.deepEqual(error(await f.ex.execute('request_approval', args()), 'WAIT_ALREADY_ACTIVE'), fault('WAIT_ALREADY_ACTIVE').body.error);
    success(await f.ex.execute('request_approval', args()), terminal());
    assert.equal(f.refreshes.length, 0); assert.equal(f.waits.length, 2); assert.equal(f.calls.length, 2);
  } finally { await f.ex.close(); }
});
// WAIT-RESPONSE-001: design 3 common representation and exact create/wait statuses.
// These fake replies verify executor handling only, not IPC or original-call delivery.
async function unusable(response, stage) {
  const f = fixture(() => stage === 'wait' ? response : reply(terminal()),
    () => stage === 'create' ? response : reply(view(), 201));
  try {
    const r = await f.ex.execute('request_approval', args());
    assert.equal(error(r, 'BROKER_UNAVAILABLE').retryable, true);
    assert.ok(!JSON.stringify(r).includes(args().request_capability));
  } finally {
    await f.ex.close();
    assert.equal(f.calls.length, 1, 'never recreate the business request');
    assert.equal(f.waits.length, stage === 'wait' ? 1 : 0, 'never retry an unusable reply');
    assert.equal(f.refreshes.length, 0, 'never refresh on malformed success');
  }
}
test('WAIT-RESPONSE-001-STATUS: unexpected wait2xx never falls through to success', async t => {
  for (const [status, body] of [[201, view()], [202, { injected: 'not an outcome' }], [206, terminal()]])
    await t.test(`wait${status}`, () => unusable(reply(body, status), 'wait'));
});
test('WAIT-RESPONSE-001-COMMON: terminal200 requires the complete common view', async t => {
  // Every entry is a documented public field, not private ledger timestamps/metadata.
  for (const key of Object.keys(terminal())) await t.test(`missing ${key}`, async () => {
    const body = terminal(); delete body[key];
    await unusable(reply(body), 'wait');
  });
});
test('WAIT-RESPONSE-001-VALIDITY: common field validity and terminal identity fail closed', async t => {
  const cases = {
    'foreign handle': { request_handle: id('hdl_', '2') },
    'foreign request': { request_id: id('req_', '2') },
    'missing decision': { decision_id: null },
    'pending200': view(),
    'invalid created time': { created_at: 'not a timestamp' },
    'invalid telegram state': { telegram_state: 'invented' },
    'invalid delivery state': { delivery_state: 'invented' },
    'non-response text': { response_text: 'not a Respond decision' },
    'invalid event status': { event_capability: { status: 'invented', revision: null, reason: null } },
  };
  for (const [label, extra] of Object.entries(cases))
    await t.test(label, () => unusable(reply({ ...terminal(), ...extra }), 'wait'));
});
test('WAIT-RESPONSE-001-CREATE: same gap cannot accept unexpected create2xx or incomplete replay', async t => {
  const incomplete = terminal(); delete incomplete.action;
  const pendingIncomplete = view(); delete pendingIncomplete.context;
  for (const [label, response] of [['create202 pending', reply(view(), 202)],
    ['create206 terminal', reply(terminal(), 206)], ['create200 incomplete', reply(incomplete)],
    ['create201 incomplete', reply(pendingIncomplete, 201)]])
    await t.test(label, () => unusable(response, 'create'));
});
test('WAIT-RESPONSE-001-CONTROLS: complete create201/200 pending/terminal and wait204/200 survive', async t => {
  for (const status of [201, 200]) for (const pending of [true, false])
    await t.test(`create${status} ${pending ? 'pending' : 'terminal'}`, async () => {
      let polls = 0;
      const f = fixture(() => ++polls === 1 ? reply(null, 204) : reply(terminal()),
        () => reply(pending ? view() : terminal(), status));
      try {
        success(await f.ex.execute('request_approval', args()), terminal());
        assert.equal(f.calls.length, 1); assert.equal(f.waits.length, pending ? 2 : 0);
        assert.equal(f.refreshes.length, 0);
      } finally { await f.ex.close(); }
    });
});
test('WAIT-U-ENVELOPE: broker failures and malformed creation do not enter transport retry', async () => {
  for (const response of [fault('NOT_FOUND', 404), fault('STORAGE_FAILURE', 500), fault('BROKER_UNAVAILABLE', 503)]) {
    const f = fixture(() => response);
    try { assert.deepEqual(error(await f.ex.execute('request_approval', args()), response.body.error.code), response.body.error);
      assert.equal(f.waits.length, 1);
    } finally { await f.ex.close(); }
  }
  const unreadable = fixture(() => { throw new local.LocalRequestError('BROKER_RESPONSE_INVALID', args().request_capability); });
  try { const r = await unreadable.ex.execute('request_approval', args()); error(r, 'BROKER_UNAVAILABLE');
    assert.ok(!JSON.stringify(r).includes(args().request_capability)); assert.equal(unreadable.waits.length, 1);
  } finally { await unreadable.ex.close(); }
  for (const response of [reply(null, 204), reply({}), reply({ ...view(), request_id: 'bad' }, 201)]) {
    const f = fixture(() => assert.fail('invalid receipt cannot wait'), () => response);
    try { error(await f.ex.execute('request_approval', args()), 'BROKER_UNAVAILABLE'); assert.equal(f.calls.length, 1); }
    finally { await f.ex.close(); }
  }
});
test('WAIT-U-READMIT409: conflict after transport loss is final, not a reconnect identity transfer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let n = 0;
  const f = fixture(() => { if (++n === 1) throw new local.LocalRequestError('BROKER_UNAVAILABLE', 'private');
    return fault('WAIT_ALREADY_ACTIVE'); });
  const c = new AbortController(), p = f.ex.execute('request_approval', args(), { signal: c.signal });
  try { await turns(); assert.equal(f.waits.length, 1); t.mock.timers.tick(1000); await turns();
    assert.equal(error(await p, 'WAIT_ALREADY_ACTIVE').retryable, false);
    t.mock.timers.tick(120000); await turns(); assert.equal(f.waits.length, 2);
    assert.equal(f.calls.length, 1); assert.equal(f.refreshes.length, 0);
  } finally { c.abort(); t.mock.timers.reset(); await f.ex.close(); }
});
test('WAIT-U-401: captured registration refresh; no creation replay, replacement headers', async () => {
  let n = 0; const f = fixture(() => ++n === 1 ? fault('AUTH_REQUIRED', 401) : reply(terminal()));
  try { success(await f.ex.execute('request_approval', args()), terminal());
    assert.deepEqual(f.refreshes, [authority('1')]); assert.equal(f.calls.length, 1);
    assert.equal(f.waits[1][3]['X-Proceed-Registration'], authority('2').registration_secret);
  } finally { await f.ex.close(); }
});
test('WAIT-U-RECONNECT: transport-only 1/2/4/8/16/repeated30 ladder, no cutoff, abortable', async t => {
  for (const stop of ['abort', 'close']) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(() => { throw new local.LocalRequestError('BROKER_UNAVAILABLE', 'private transport detail'); });
  const c = new AbortController(), p = f.ex.execute('request_approval', args(), { signal: c.signal });
  try { await turns(); assert.equal(f.waits.length, 1);
    for (const ms of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const before = f.waits.length; t.mock.timers.tick(ms - 1); await turns(); assert.equal(f.waits.length, before);
      t.mock.timers.tick(1); await turns(); assert.equal(f.waits.length, before + 1);
    }
    if (stop === 'abort') c.abort(); else await f.ex.close();
    await turns(); error(await p, 'BROKER_UNAVAILABLE'); const count = f.waits.length;
    t.mock.timers.tick(120000); await turns(); assert.equal(f.waits.length, count); assert.equal(f.calls.length, 1);
    assert.equal(getEventListeners(c.signal, 'abort').length, 0);
  } finally { c.abort(); t.mock.timers.reset(); await f.ex.close(); }
  }
});
test('WAIT-U-ABORT: same-handle overlap/other-call isolation, abort exchange, close fences new work', async () => {
  const f = fixture((method, path, body, headers, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new local.LocalRequestError('BROKER_UNAVAILABLE', 'private')), { once: true });
  }), (method, path, body) => reply(view({ request_handle: body.request_handle,
    request_id: body.request_handle.replace('hdl_', 'req_') }), 201));
  const c = new AbortController(), one = f.ex.execute('request_approval', args(), { signal: c.signal });
  try { await turns(); assert.equal(f.waits.length, 1);
    assert.equal(error(await f.ex.execute('request_approval', args()), 'WAIT_ALREADY_ACTIVE').retryable, false);
    const two = f.ex.execute('request_approval', { ...args(), request_handle: id('hdl_', '2') }); await turns();
    assert.equal(f.waits.length, 2); c.abort(); error(await bounded(() => one, 200, 'wait abort'), 'BROKER_UNAVAILABLE');
    assert.ok(!f.waits[1][4].signal.aborted); const start = performance.now(); await f.ex.close();
    assert.ok(performance.now() - start < 2000); error(await bounded(() => two, 200, 'close wait'), 'BROKER_UNAVAILABLE');
    const count = f.calls.length + f.waits.length;
    error(await f.ex.execute('request_approval', args()), 'BROKER_UNAVAILABLE');
    assert.equal(f.calls.length + f.waits.length, count);
    assert.equal(getEventListeners(c.signal, 'abort').length, 0);
  } finally { c.abort(); await f.ex.close(); }
});
