// TEST ONLY runner negatives. Does not prove real-host timing or MCP support.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { rpcPeer } from './support/spike-rpc.mjs';

function fixture(work) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  const peer = rpcPeer(child);
  return Promise.resolve().then(() => work(peer, child)).finally(() => {
    peer.close();
    child.stdin.destroy();
    child.stdout.destroy();
  });
}

test('RPC-01: deadline check fails even before a delayed timeout callback runs',
  { timeout: 2000 }, () => fixture(async (peer) => {
    const call = peer.call('tools/call', {}, { ms: 10 });
    // Deliberately block this fixture event loop, bounded to 30ms.
    const end = performance.now() + 30;
    while (performance.now() < end) { /* test delayed timer scheduling */ }
    assert.equal(call.settled, false);
    assert.throws(() => peer.beforeDeadline(call, 'receipt-withheld'), /deadline already elapsed/);
    assert.equal((await call.outcome).kind, 'timeout');
  }));

test('RPC-02: same-id server request is not a response; matching error is not timeout',
  { timeout: 2000 }, () => fixture(async (peer, child) => {
    const call = peer.call('tools/call', {}, { id: 7 });
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`);
    assert.equal(call.settled, false);
    child.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7,
      error: { code: -32603, message: 'fixture' } })}\n`);
    const outcome = await call.outcome;
    assert.equal(outcome.kind, 'response');
    assert.equal(outcome.frame.error.code, -32603);
    assert.equal(peer.unmatched.length, 1);
  }));

test('RPC-03: transport exit does not become a caller timeout',
  { timeout: 2000 }, () => fixture(async (peer, child) => {
    const call = peer.call('tools/call', {});
    child.emit('exit', 1);
    assert.equal((await call.outcome).kind, 'transport-closed');
  }));
