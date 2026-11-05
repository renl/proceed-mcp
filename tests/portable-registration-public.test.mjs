// TEST ONLY public acceptance: design 3/7, portable principal registration scenarios.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';
const creates = h => h.calls.filter(c => c.path === '/v1/adapter');
const handles = h => h.calls.filter(c => c.path === '/v1/handles');
const beats = h => h.calls.filter(c => c.path.endsWith('/heartbeat'));
const deletes = h => h.calls.filter(c => c.method === 'DELETE');

test('PORT-PUBLIC-LAZY: brokerless catalog/invalid; first valid prepare registers once',
  { timeout: 65000 }, () => publicRegistration(async h => {
    const a = await h.connect(); // No real broker exists, observing relay is reachable.
    assert.equal(h.calls.length, 0, 'initialize/catalog cause zero HTTP, not just tolerated failure');
    toolError(await a.call('prepare_approval', { session_label: '' }), 'INVALID_ARGUMENT');
    for (const name of ['get_approval', 'cancel_approval', 'acknowledge_approval'])
      toolError(await a.call(name), 'INVALID_ARGUMENT');
    const unknown = await a.call('unknown_tool');
    assert.ok(unknown.kind === 'response' && unknown.frame.error?.code === -32601, 'unknown tool protocol denial');
    toolError(await a.call('request_approval', { request_handle: `hdl_${'1'.repeat(32)}`,
      request_capability: `cap_${'2'.repeat(64)}`, client_request_id: 'unused', action: '', context: '' }),
      'INVALID_ARGUMENT');
    assert.equal(h.calls.length, 0, 'invalid execution never contacts broker');
    await h.eof(a);
    assert.equal(h.calls.length, 0, 'brokerless EOF never creates/releases');
    await h.restart();
    const b = await h.connect();
    h.hold(c => c.path === '/v1/adapter');
    const first = b.call('prepare_approval');
    await observe(() => creates(h)[0]?.held, 'registration held before second invocation');
    const second = b.call('prepare_approval');
    assert.equal((await b.peer.call('ping', {}).outcome).kind, 'response', 'overlapping public registration awaiters');
    h.hold(() => false); // Only the first overlapping create is withheld, not later admission attempts.
    creates(h)[0].release();
    const prepared = await Promise.all([first, second]);
    prepared.forEach(success);
    assert.equal(creates(h).length, 1, 'single-flight registration across overlapping public calls');
    assert.equal(creates(h)[0].method, 'POST'); assert.deepEqual(creates(h)[0].body, {});
    assert.ok(creates(h)[0].token === `Bearer ${h.owner}`, 'configured owner Bearer authenticates create');
    assert.equal(handles(h).length, 2);
    assert.ok(h.calls.indexOf(creates(h)[0]) < h.calls.indexOf(handles(h)[0]), 'register before business execution');
    const registration = creates(h)[0].reply;
    const journal = await h.journal();
    const duplicate = await h.connect();
    toolError(await duplicate.call('prepare_approval'), 'OWNER_IN_USE');
    assert.equal(handles(h).length, 2, 'duplicate adapter cannot reserve');
    assert.ok(journal.equals(await h.journal()), 'duplicate admission writes nothing');
    await h.eof(duplicate);
    assert.equal(deletes(h).length, 0, 'failed owner cannot release incumbent');
    await h.eof(b);
    assert.equal(deletes(h).length, 1);
    assert.ok(deletes(h)[0].path === `/v1/adapter/${registration.registration_id}` &&
      deletes(h)[0].header === registration.registration_secret, 'release captured exact incarnation');
    assert.ok(journal.equals(await h.journal()), 'EOF leaves existing reservation bytes, not cancellation proof');
    const replacement = await h.connect();
    success(await replacement.call('prepare_approval'));
    assert.equal(creates(h).length, 3, 'duplicate attempt plus original and replacement');
    await h.eof(replacement);
  }));

test('PORT-PUBLIC-RESTART: retained adapter real 10s heartbeat re-registers after real broker restart',
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const a = await h.connect();
    success(await a.call('prepare_approval'));
    assert.equal(creates(h).length, 1, 'production entry must establish binding');
    const initial = creates(h)[0], journal = await h.journal();
    await observe(() => beats(h).some(c => c.status === 204), 'production heartbeat observed', 12500);
    assert.ok(beats(h)[0].at - initial.at >= 9500, 'no accelerated test heartbeat');
    assert.equal(beats(h)[0].status, 204);
    assert.deepEqual(beats(h)[0].body, {});
    assert.ok(beats(h)[0].header === initial.reply.registration_secret &&
      beats(h)[0].token === `Bearer ${h.owner}`, 'authenticated heartbeat uses exact private authority');
    await h.restart(); // Does NOT close or replace adapter.
    await observe(() => creates(h).length === 2 && creates(h)[1].status === 201,
      'same retained adapter re-registers on heartbeat', 12500);
    assert.equal(beats(h).at(-1).status, 401, 'old incarnation rejected by restarted real broker');
    assert.ok(creates(h)[1].reply.registration_id !== initial.reply.registration_id, 'fresh authority');
    await observe(() => beats(h).some(c => c.at > creates(h)[1].at && c.status === 204),
      'replacement receives real production heartbeat', 12500);
    assert.ok(beats(h).at(-1).at - creates(h)[1].at >= 9500, 'replacement also uses production cadence');
    assert.equal(handles(h).length, 1, 're-registration never replays prepare');
    assert.ok(journal.equals(await h.journal()), 'heartbeat/restart preserve existing reservations');
    await h.eof(a);
    assert.ok(deletes(h)[0].path.endsWith(creates(h)[1].reply.registration_id), 'only replacement released');
  }));
