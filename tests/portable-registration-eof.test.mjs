// TEST ONLY: real public executable, real committed HTTP replies held by relay.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';

for (const phase of ['create', 'heartbeat', 'release', 'handles', 'get', 'cancel', 'acknowledge']) {
  test(`PORT-PUBLIC-EOF-${phase}: actual socket closes, shared budget and queued-work fence`,
    { timeout: 65000 }, () => publicRegistration(async h => {
      await h.restart(); const a = await h.connect();
      let prepared, blocked;
      const match = c => phase === 'create' ? c.path === '/v1/adapter'
        : phase === 'heartbeat' ? c.path.endsWith('/heartbeat')
        : phase === 'release' ? c.method === 'DELETE'
        : phase === 'handles' ? c.path === '/v1/handles'
        : c.path === `/v1/requests/${prepared.request_id}${phase === 'get' ? '' : `/${phase}`}`;
      if (phase !== 'create') {
        prepared = success(await a.call('prepare_approval'));
        assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1,
          'public executable must bind before fault acceptance');
      }
      h.hold(c => {
        if (match(c)) { blocked = c; return true; }
        if (phase === 'heartbeat' && c.path === '/v1/handles') return true;
        return phase !== 'create' && c.method === 'DELETE'; // Simultaneously stall best-effort release.
      });
      if (phase === 'create' || phase === 'handles') a.call('prepare_approval');
      else if (['get', 'cancel', 'acknowledge'].includes(phase)) {
        a.call(`${phase === 'get' ? 'get' : phase === 'cancel' ? 'cancel' : 'acknowledge'}_approval`, {
          request_id: prepared.request_id, request_capability: prepared.request_capability,
          ...(phase === 'acknowledge' ? { decision_id: `dec_${'1'.repeat(32)}` } : {}) });
      }
      const start = performance.now();
      let ending, socketsDone;
      try {
        if (phase !== 'release') {
          await observe(() => blocked?.held, `real ${phase} HTTP reply reached hold barrier`, phase === 'heartbeat' ? 12500 : 3000);
          if (phase === 'heartbeat') {
            a.call('prepare_approval');
            await observe(() => h.calls.some(c => c.path === '/v1/handles' && c.held),
              'foreground ordinary exchange held alongside heartbeat before submitting queued calls');
          }
        }
        const journal = await h.journal();
        if (phase === 'handles') h.secrets.push(blocked.reply.request_capability);
        const before = h.calls.length;
        if (phase !== 'release') {
          // These calls were submitted before EOF but must never execute after it.
          for (let i = 0; i < 3; i++) a.call('prepare_approval', { session_label: 'queued' });
        }
        // Arm the combined barrier BEFORE EOF; no serial per-socket budget extensions.
        const deadline = performance.now() + 2750;
        socketsDone = observe(() => {
          const release = h.calls.find(c => c.method === 'DELETE');
          return (phase === 'create' || release?.held) &&
            h.calls.filter(c => c.held).every(c => c.socketClosed);
        }, 'real release response held AND all held sockets closed in ONE EOF deadline',
        Math.max(1, deadline - performance.now()));
        ending = h.eof(a);
        const [eofAt] = await Promise.all([ending, socketsDone]);
        assert.ok(performance.now() <= deadline, 'exit and combined socket barrier observed by shared deadline');
        assert.ok(blocked.socketClosed, 'actual client-facing HTTP socket closed, not an abort flag/Promise race');
        assert.ok(blocked.socketClosedAt - eofAt <= 2750, 'transport and process share the same close deadline');
        assert.ok(h.calls.filter(c => c.held).every(c => c.socketClosed && c.socketClosedAt - eofAt <= 2750),
          'simultaneous ordinary/lifecycle and release stalls share ONE budget');
        const added = h.calls.slice(before);
        assert.ok(added.every(c => c.method === 'DELETE'), 'no queued/new ordinary work after EOF');
        const releases = h.calls.filter(c => c.method === 'DELETE');
        if (phase === 'create') {
          assert.equal(releases.length, 0, 'lost create authority never guesses a delete');
          assert.equal((await h.http('/v1/adapter', h.owner, { method: 'POST', body: '{}' })).status, 409,
            'create committed remotely; remote lease may remain, not immediate release');
        } else {
          assert.equal(releases.length, 1, 'exactly one captured release, no compensation/retry');
          assert.ok(releases[0].committed && releases[0].held && releases[0].heldSocketOpen,
            'real DELETE response reached hold with live socket; immediate cancellation is not combined-stall proof');
          assert.ok(releases[0].heldAt >= eofAt && releases[0].heldAt <= releases[0].socketClosedAt &&
            releases[0].socketClosedAt <= deadline,
          'held release socket closes inside SAME EOF deadline as foreground/heartbeat and exit');
          const first = h.calls.find(c => c.path === '/v1/adapter').reply;
          assert.ok(releases[0].path === `/v1/adapter/${first.registration_id}` &&
            releases[0].header === first.registration_secret, 'release only captured incarnation');
        }
        assert.ok(journal.equals(await h.journal()), 'EOF does not alter committed reservations');
        if (phase === 'handles') {
          assert.equal(blocked.status, 201, 'held prepare really committed in product broker');
          const lost = blocked.reply; // Fixture sees withheld result; model never receives this authority.
          const r = await h.http(`/v1/requests/${lost.request_id}`, h.owner,
            { headers: { 'X-Proceed-Request-Capability': lost.request_capability } });
          assert.equal(r.status, 404, 'lost preparation remains unused reservation, not actionable approval');
        }
        const count = h.calls.length;
        await delay(100); // Process absence is the timer fence; not a shortened heartbeat proof.
        assert.equal(h.calls.length, count, 'no late frames/timers/replays can revive exited executable');
      } finally { await Promise.allSettled([ending, socketsDone].filter(Boolean)); }
      assert.ok(performance.now() - start < 18000, 'finite whole fault observation');
    }));
}

test('PORT-PUBLIC-ERROR: ordinary malformed/unknown replies redact, recognized errors remain exact',
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const a = await h.connect();
    success(await a.call('prepare_approval'));
    assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1, 'public binding prerequisite');
    h.mutate((reply, c) => c.path === '/v1/handles' ? { status: 503,
      body: { schema_version: 1, error: { code: 'NOT_PAIRED', message: 'safe synthetic diagnostic', retryable: false } } } : reply);
    assert.deepEqual(toolError(await a.call('prepare_approval'), 'NOT_PAIRED'),
      { code: 'NOT_PAIRED', message: 'safe synthetic diagnostic', retryable: false });
    for (const body of [null, { schema_version: 1, error: { code: 'PRIVATE_UNKNOWN', message: h.secrets.at(-1), retryable: false } },
      { schema_version: 2, error: { code: 'NOT_PAIRED', message: h.secrets.at(-1), retryable: false } }]) {
      h.mutate((reply, c) => c.path === '/v1/handles' ? { status: 503, body } : reply);
      const e = toolError(await a.call('prepare_approval'), 'BROKER_UNAVAILABLE');
      assert.equal(e.retryable, true);
    }
    await h.eof(a); // Secret guard remains attached through both output EOFs.
  }));
