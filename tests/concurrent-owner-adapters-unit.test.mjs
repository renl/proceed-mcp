// TEST ONLY: design decisions 1-5. Real registry/binding/executor/broker logic
// with in-memory journal and fake local client. No sockets, disk durability,
// actual human delivery, host closure or JSON-RPC framing proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRegistrationRegistry } from '../src/broker/registration.js';
import { createRegistrationBinding } from '../src/mcp/registration.js';
import { createToolExecutor } from '../src/mcp/execution.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { LocalRequestError } from '../src/http/local-client.js';

const turns = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const reply = (body, status = 200) => ({ status, body });
const fault = (code, status) => reply({
  schema_version: 1, error: { code, message: 'synthetic denial', retryable: false },
}, status);
const success = result => {
  assert.equal(result.isError, false, JSON.stringify(result.structuredContent));
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
};
const denied = result => {
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, 'NOT_FOUND');
};

async function fixture() {
  let now = Date.parse('2026-11-01T00:00:00Z');
  const transactions = [];
  // Non-production journal double: append/replay only, never disk/crash proof.
  const journal = {
    async recover() { return { transactions: structuredClone(transactions), validLength: 0, fileBytes: 0 }; },
    async append(mutations) {
      const transaction = { sequence: transactions.length + 1, mutations: structuredClone(mutations) };
      transactions.push(transaction);
      return transaction;
    },
  };
  const registry = createRegistrationRegistry({ clock: () => now });
  const broker = createPortableBroker({ journal, port: 43189, clock: () => now,
    owners: [{ owner_id: 'shared', label: 'Shared' }, { owner_id: 'foreign', label: 'Foreign' },
      { owner_id: 'outsider', label: 'Outsider' }] });
  await broker.recover();
  // Synthetic pairing via the existing domain seam. No Telegram/config access.
  const challenge = await broker.pairingChallenge();
  await broker.completePairing({ code: challenge.code, userId: '71', chatId: '81', updateId: 1 });
  const adapters = [], calls = [];
  function adapter(ownerId = 'shared') {
    const client = { async request(method, path, body, headers = {}, options = {}) {
      calls.push({ ownerId, method, path, body, headers, signal: options.signal });
      if (path === '/v1/adapter') {
        try { return reply(await registry.register({ ownerId }), 201); }
        catch (error) {
          if (!Number.isInteger(error.status)) throw error;
          return reply({ schema_version: 1, error: {
            code: error.code, message: error.message, retryable: error.retryable,
          } }, error.status);
        }
      }
      const segments = path.split('/');
      const registrationId = body?.registration_id ?? segments[3];
      const identity = { ownerId, registrationId, secret: headers['X-Proceed-Registration'] };
      if (method === 'DELETE') return registry.release(identity) ? reply(null, 204) : fault('AUTH_REQUIRED', 401);
      if (path.endsWith('/heartbeat')) return registry.heartbeat(identity) ? reply(null, 204) : fault('AUTH_REQUIRED', 401);
      const capability = headers['X-Proceed-Request-Capability'];
      const auth = { ownerId, capability, requestId: segments[3] };
      if (path === '/v1/handles') return reply(await broker.reserveHandle({
        ownerId, sessionLabel: body.session_label, hostConfigured: body.host_configured,
      }), 201);
      if (path === '/v1/requests') {
        const created = await broker.createRequest({
          ownerId, capability, requestHandle: body.request_handle, clientRequestId: body.client_request_id,
          action: body.action, context: body.context,
        });
        return created === null ? fault('NOT_FOUND', 404) : reply(created.request, created.created ? 201 : 200);
      }
      if (path.endsWith('/wait')) {
        if (!registry.authenticate(identity)) return fault('AUTH_REQUIRED', 401);
        const value = await broker.waitRequest({ ...auth, signal: options.signal,
          registration: { valid: () => registry.authenticate(identity) } });
        if (value === null) return fault('NOT_FOUND', 404);
        if (value.state === 'detached') throw new LocalRequestError('BROKER_UNAVAILABLE', 'detached');
        if (!registry.authenticate(identity)) return fault('AUTH_REQUIRED', 401);
        if (value.state === 'conflict') return fault('WAIT_ALREADY_ACTIVE', 409);
        registry.heartbeat(identity);
        return value.state === 'pending' ? reply(null, 204) : reply(value.request);
      }
      assert.ok(method === 'GET' || path.endsWith('/acknowledge') || path.endsWith('/cancel'),
        `unexpected synthetic route ${method} ${path}`);
      const value = path.endsWith('/acknowledge')
        ? await broker.acknowledgeRequest({ ...auth, decisionId: body.decision_id })
        : path.endsWith('/cancel') ? await broker.cancelRequest(auth) : await broker.readRequest(auth);
      return value === null ? fault('NOT_FOUND', 404) : reply(value);
    } };
    const binding = createRegistrationBinding({ client });
    const ex = createToolExecutor({ client, waitClient: client, registration: binding });
    const a = { ex, binding, ownerId };
    adapters.push(a);
    return a;
  }
  return { broker, registry, adapter, calls, transactions,
    advance(ms) { now += ms; },
    async decide(p, resolution, updateId) {
      const presentation = await broker.preparePresentation({ requestId: p.request_id });
      await broker.recordPresentationSent({ requestId: p.request_id, callbackToken: presentation.callback_token,
        chatId: '81', messageId: updateId });
      await broker.resolveCallback({ requestId: p.request_id, callbackToken: presentation.callback_token,
        messageId: updateId, userId: '71', chatId: '81', callbackQueryId: `query-${updateId}`,
        updateId, resolution });
    },
    async close() {
      try { await Promise.all(adapters.map(a => a.ex.close())); }
      finally { registry.close(); await broker.close(); }
    },
  };
}
const prepare = async a => success(await a.ex.execute('prepare_approval', { session_label: 'same label' }));
const input = p => ({ request_handle: p.request_handle, request_capability: p.request_capability,
  client_request_id: 'same-key', action: 'Question?', context: '' });
const auth = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const waits = h => h.calls.filter(c => c.path.endsWith('/wait'));

for (const owner of ['foreign', 'shared']) test(`CONCURRENT-CALLS-${owner}: reverse decisions stay on original invocations, independent acknowledgements`, { timeout: 4000 }, async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await fixture();
  try {
    const a = h.adapter(), b = h.adapter(owner);
    const [pa, pb] = await Promise.all([prepare(a), prepare(b)]);
    assert.notEqual(pa.request_capability, pb.request_capability);
    assert.notEqual(pa.request_handle, pb.request_handle);
    const [ra, rb] = await Promise.all([a.binding.ensure(), b.binding.ensure()]);
    assert.notEqual(ra.registration_id, rb.registration_id);
    let settledA = false;
    const pendingA = a.ex.execute('request_approval', input(pa)).then(r => { settledA = true; return r; });
    const pendingB = b.ex.execute('request_approval', input(pb));
    await turns();
    assert.equal(waits(h).length, 2, 'both waits admitted before either decision');
    await h.decide(pb, 'rejected', 2);
    const resultB = success(await pendingB);
    assert.equal(resultB.request_id, pb.request_id);
    assert.equal(resultB.resolution, 'rejected');
    assert.equal(settledA, false, 'B must not settle A');
    await h.decide(pa, 'approved', 3);
    const rawA = await pendingA;
    const resultA = success(rawA);
    assert.equal(resultA.request_id, pa.request_id);
    assert.equal(resultA.resolution, 'approved');
    assert.notEqual(resultA.decision_id, resultB.decision_id);
    for (const [adapter, p, result] of [[a, pa, resultA], [b, pb, resultB]]) {
      const ack = { ...auth(p), decision_id: result.decision_id };
      const first = success(await adapter.ex.execute('acknowledge_approval', ack));
      assert.equal(first.delivery_state, 'confirmed');
      const count = h.transactions.length;
      assert.deepEqual(success(await adapter.ex.execute('acknowledge_approval', ack)), first);
      assert.equal(h.transactions.length, count, 'repeat acknowledgement commits nothing');
    }
    await a.ex.close();
    const count = h.calls.length;
    assert.equal(a.ex.reportWritten(rawA), null, 'late write callback cannot report after close');
    assert.equal(h.calls.length, count);
    assert.equal(success(await b.ex.execute('get_approval', auth(pb))).delivery_state, 'confirmed');
  } finally { await h.close(); t.mock.timers.reset(); }
});

test('CONCURRENT-UNKNOWN: unobserved create/release never guesses authority and expires without sibling renewal', { timeout: 4000 }, async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  for (const phase of ['create', 'release']) {
    let now = 0, resolveHeld, entered = false, captured;
    const held = new Promise(resolve => { resolveHeld = resolve; });
    const registry = createRegistrationRegistry({ clock: () => now });
    const calls = [];
    const client = { async request(method, path, body, headers = {}, options = {}) {
      calls.push({ method, path, body, headers, signal: options.signal });
      if (path === '/v1/adapter') {
        captured = await registry.register({ ownerId: 'shared' });
        if (phase === 'create') { entered = true; return held; }
        return reply(captured, 201);
      }
      if (method === 'DELETE') { entered = true; return held; } // no claim of remote release
      assert.fail('unknown lifecycle must not initiate heartbeat or ordinary traffic');
    } };
    const binding = createRegistrationBinding({ client, shutdownBudgetMs: 60 });
    const bound = r => ({ ownerId: 'shared', registrationId: r.registration_id, secret: r.registration_secret });
    let pending;
    try {
      pending = binding.ensure();
      pending.catch(() => {});
      await turns();
      assert.ok(captured, 'remote create actually occurred before shutdown');
      if (phase === 'release') await pending;
      const closing = binding.close();
      await turns();
      assert.equal(entered, true, `${phase} failure injection actually reached`);
      t.mock.timers.tick(60);
      await turns();
      await closing;
      const count = calls.length;
      assert.equal(calls.filter(c => c.method === 'DELETE').length, phase === 'release' ? 1 : 0);
      assert.ok(calls.at(-1).signal.aborted, 'outstanding lifecycle exchange aborted within budget');
      // Separate-owner positive control avoids obsolete occupancy blocking the
      // expiry/fencing proof on the RED baseline. Same-owner isolation is above.
      const sibling = await registry.register({ ownerId: 'foreign' });
      now = 40000;
      assert.equal(registry.heartbeat({ ...bound(sibling), ownerId: 'foreign' }), true);
      resolveHeld(phase === 'create' ? reply(captured, 201) : reply(null, 204));
      await Promise.allSettled([pending]);
      await turns();
      await assert.rejects(binding.ensure());
      t.mock.timers.tick(10000);
      await turns();
      assert.equal(calls.length, count, 'late settlement starts no release/renewal');
      now = 45000;
      assert.equal(registry.authenticate(bound(captured)), false, 'unrenewed orphan expires exactly');
      assert.equal(registry.authenticate({ ...bound(sibling), ownerId: 'foreign' }), true);
    } finally {
      resolveHeld(reply(null, 204));
      await binding.close();
      registry.close();
    }
  }
  t.mock.timers.reset();
});

for (const owner of ['foreign', 'shared']) test(`CONCURRENT-RECOVERY-${owner}: closure leaves pending work, sibling wait and capability recovery intact`, { timeout: 4000 }, async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await fixture();
  try {
    const a = h.adapter(), b = h.adapter(owner), foreign = h.adapter('outsider');
    const [pa, pb] = await Promise.all([prepare(a), prepare(b)]);
    const old = await a.binding.ensure();
    const pendingA = a.ex.execute('request_approval', input(pa));
    let settledB = false;
    const pendingB = b.ex.execute('request_approval', input(pb)).then(r => { settledB = true; return r; });
    await turns();
    assert.equal(waits(h).length, 2);
    await a.ex.close();
    assert.equal((await pendingA).isError, true);
    assert.equal(settledB, false);
    const reconnect = h.adapter();
    const count = h.calls.filter(c => c.path === '/v1/requests').length;
    await reconnect.binding.ensure();
    await turns();
    assert.equal(waits(h).length, 2, 'reconnect never reattaches lost call');
    assert.equal(h.calls.filter(c => c.path === '/v1/requests').length, count);
    const read = success(await reconnect.ex.execute('get_approval', auth(pa)));
    assert.equal(read.resolution, 'pending', 'registration release is not cancellation');
    const transfer = owner === 'shared' ? b : reconnect;
    assert.equal(success(await transfer.ex.execute('get_approval', auth(pa))).request_id, pa.request_id,
      'intentional same-principal capability transfer remains authorized');
    const wrong = { ...auth(pa), request_capability: pb.request_capability };
    for (const method of ['get_approval', 'cancel_approval', 'acknowledge_approval']) {
      const extra = method === 'acknowledge_approval' ? { decision_id: `dec_${'0'.repeat(32)}` } : {};
      denied(await b.ex.execute(method, { ...wrong, ...extra }));
      denied(await foreign.ex.execute(method, { ...auth(pa), ...extra }));
    }
    assert.equal(settledB, false, 'denials and transferred retrieval do not redirect B');
    await h.decide(pb, 'approved', 2);
    assert.equal(success(await pendingB).request_id, pb.request_id);
    await h.decide(pa, 'rejected', 3);
    const recovered = success(await reconnect.ex.execute('get_approval', auth(pa)));
    assert.equal(recovered.resolution, 'rejected');
    assert.equal(recovered.delivery_state, 'unavailable', 'retrieval is not original-call write evidence');
    const ack = { ...auth(pa), decision_id: recovered.decision_id };
    assert.equal(success(await reconnect.ex.execute('acknowledge_approval', ack)).delivery_state, 'confirmed');
    assert.equal(h.registry.release({ ownerId: 'shared', registrationId: old.registration_id,
      secret: old.registration_secret }), false);
    assert.equal(success(await b.ex.execute('get_approval', auth(pb))).resolution, 'approved');
    const before = h.calls.length;
    assert.equal((await a.ex.execute('prepare_approval', {})).isError, true);
    assert.equal(h.calls.length, before, 'closed adapter cannot initiate ordinary traffic');
  } finally { await h.close(); t.mock.timers.reset(); }
});
