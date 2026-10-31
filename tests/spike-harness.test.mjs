// Contract mapping: checkpoint 2 slice; fixture safety only, no live proof.
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { managed, alive } from './support/managed-spike.mjs';
import { rpcPeer } from './support/spike-rpc.mjs';

const fixture = resolve('tests/fixtures/spike-process.mjs');
const relay = resolve('tests/support/receipt-fault.mjs');
const command = (mode) => [process.execPath, fixture, mode];
const clean = (result) => {
  assert.ifError(result.cleanupError);
  for (const resource of result.resources) {
    for (const pid of [resource.pid, ...resource.knownPids]) assert.equal(alive(pid), false);
  }
};

test('HARNESS-01: success removes owned parent, descendant and namespace', { timeout: 12000 }, async () => {
  const result = await managed(async (run) => { await run.start(command('tree')); });
  assert.ifError(result.assertionError);
  clean(result);
});

test('HARNESS-02: assertion failure preserved separately from tree cleanup', { timeout: 12000 }, async () => {
  const result = await managed(async (run) => {
    await run.start(command('tree'));
    throw new Error('sentinel assertion failure');
  });
  assert.equal(result.assertionError.message, 'sentinel assertion failure');
  clean(result);
});

test('HARNESS-03: total deadline aborts work and removes whole tree', { timeout: 12000 }, async () => {
  const result = await managed(async (run) => {
    const tree = await run.start(command('tree'));
    await tree.wait('never-emitted');
  }, { totalMs: 1200, readyMs: 3000 });
  assert.equal(result.assertionError.message, 'total deadline');
  clean(result);
});

test('HARNESS-04: readiness deadline removes unready process', { timeout: 12000 }, async () => {
  const result = await managed(async (run) => { await run.start(command('never-ready')); },
    { readyMs: 300 });
  assert.equal(result.assertionError.message, 'deadline waiting for ready');
  clean(result);
});

test('HARNESS-06: known descendant remains owned after unexpected parent exit', { timeout: 12000 }, async () => {
  const result = await managed(async (run) => {
    const tree = await run.start(command('tree'));
    const exited = new Promise((done) => tree.child.once('exit', done));
    tree.child.send({ kind: 'exit-root' });
    await exited;
    throw new Error('unexpected owned parent exit');
  });
  assert.equal(result.assertionError.message, 'unexpected owned parent exit');
  clean(result);
});

test('HARNESS-05: pending call actually times out after durable creation and receipt fault',
  { timeout: 12000 }, async () => {
    const result = await managed(async (run) => {
      const transport = await run.start([process.execPath, relay, ...command('adapter')]);
      await transport.wait('adapter-ready');
      const peer = rpcPeer(transport.child);
      try {
        transport.child.send({ kind: 'hold', id: 7 });
        await transport.wait('armed');
        await peer.handshake();
        // Synthetic caller deadline starts BEFORE sending the selected call.
        const pendingCall = peer.call('tools/call', { name: 'request_approval', arguments: {
          client_request_id: 'fixture_1', action: 'fixture only', context: '' },
          _meta: { 'ai.opencode/sessionID': 'fixture_session' } }, { id: 7, ms: 800 });
        await transport.wait('durable-created');
        const record = JSON.parse(await readFile(join(run.directory, 'fixture-request.json'), 'utf8'));
        assert.equal(record.resolution, 'pending');
        peer.beforeDeadline(pendingCall, 'durable-created');
        await transport.wait('receipt-withheld');
        peer.beforeDeadline(pendingCall, 'receipt-withheld');
        assert.ok(transport.events.findIndex((e) => e.kind === 'durable-created')
          < transport.events.findIndex((e) => e.kind === 'receipt-withheld'));
        assert.equal((await pendingCall.outcome).kind, 'timeout');
        assert.deepEqual(peer.unmatched, [
          { jsonrpc: '2.0', method: 'notifications/message', params: { data: 'fixture-only' } },
          { jsonrpc: '2.0', id: '7', result: { fixture: 'string id is not numeric id' } },
          { jsonrpc: '2.0', id: 'server-question', method: 'ping' },
        ]);
        assert.equal(alive(transport.pid), true, 'transport remains running at timeout');
        assert.equal(JSON.parse(await readFile(join(run.directory, 'fixture-request.json'), 'utf8'))
          .resolution, 'pending', 'timeout creates no approval/cancellation');
      } finally { peer.close(); }
    });
    assert.ifError(result.assertionError);
    clean(result);
  });

test('HARNESS-07: late durable creation cannot reuse an already settled caller timeout',
  { timeout: 12000 }, async () => {
    const result = await managed(async (run) => {
      const transport = await run.start([process.execPath, relay, ...command('adapter')]);
      await transport.wait('adapter-ready');
      const peer = rpcPeer(transport.child);
      try {
        await peer.handshake();
        transport.child.send({ kind: 'creation-delay', ms: 200 });
        await transport.wait('delay-configured');
        transport.child.send({ kind: 'hold', id: 7 });
        await transport.wait('armed');
        const call = peer.call('tools/call', { name: 'request_approval', arguments: {} },
          { id: 7, ms: 50 });
        assert.equal((await call.outcome).kind, 'timeout');
        await transport.wait('durable-created');
        assert.throws(() => peer.beforeDeadline(call, 'durable-created'), /already settled/);
        await transport.wait('receipt-withheld');
        assert.throws(() => peer.beforeDeadline(call, 'receipt-withheld'), /already settled/);
      } finally { peer.close(); }
    });
    assert.ifError(result.assertionError);
    clean(result);
  });
