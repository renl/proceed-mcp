// TEST ONLY public stdio consumer. Not an MCP server or live-host attestation.
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';

export function rpcPeer(child) {
  let next = 1;
  const pending = new Map();
  const unmatched = [];
  const lines = createInterface({ input: child.stdout });
  const finish = (entry, outcome) => {
    clearTimeout(entry.timer);
    pending.delete(entry.id);
    entry.settled = true;
    entry.complete(outcome);
  };
  lines.on('line', (line) => {
    let frame;
    try { frame = JSON.parse(line); }
    catch { for (const entry of pending.values()) finish(entry, { kind: 'invalid-frame' }); return; }
    const entry = pending.get(frame.id);
    if (entry && !('method' in frame) && ('result' in frame || 'error' in frame)) {
      finish(entry, { kind: performance.now() >= entry.deadline ? 'late-response' : 'response', frame });
    } else unmatched.push(frame);
  });
  const stopped = () => {
    for (const entry of pending.values()) finish(entry, { kind: 'transport-closed' });
  };
  child.once('exit', stopped);
  child.once('error', stopped);
  function call(method, params, { ms = 1000, id = next++ } = {}) {
    assert.ok(!pending.has(id), 'unique outstanding JSON-RPC id');
    const entry = { id, deadline: performance.now() + ms, settled: false };
    entry.outcome = new Promise((done) => { entry.complete = done; });
    entry.timer = setTimeout(() => finish(entry, { kind: 'timeout' }), ms);
    pending.set(id, entry);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return entry;
  }
  return {
    call, unmatched,
    beforeDeadline(entry, label) {
      assert.equal(entry.settled, false, `${label}: caller already settled`);
      assert.ok(performance.now() < entry.deadline, `${label}: caller deadline already elapsed`);
    },
    async handshake() {
      const init = await call('initialize', { protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'spike-test', version: '0' } }).outcome;
      assert.equal(init.kind, 'response');
      assert.equal(init.frame.result.protocolVersion, '2025-11-25');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      const catalog = await call('tools/list', {}).outcome;
      assert.equal(catalog.kind, 'response');
      assert.ok(catalog.frame.result.tools.some((tool) => tool.name === 'request_approval'));
      return init.frame.result;
    },
    close() {
      stopped();
      lines.close();
      child.off('exit', stopped);
      child.off('error', stopped);
    },
  };
}
