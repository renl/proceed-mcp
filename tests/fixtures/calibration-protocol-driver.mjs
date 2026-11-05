// Finite OFFLINE MCP client, executed only inside the existing containment job.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter, once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prearm } from '../support/host-timeout-binding.mjs';

const [reportPath, mode] = process.argv.slice(2);
const source = new EventEmitter(), observer = prearm(source);
const child = spawn(process.execPath, [fileURLToPath(new URL('./calibration-mcp.mjs', import.meta.url))],
  { stdio: ['pipe', 'pipe', 'pipe'], env: {}, windowsHide: true });
const exit = once(child, 'exit');
const responses = [], errors = createInterface({ input: child.stderr }), output = createInterface({ input: child.stdout });
errors.on('line', line => source.emit('record', line));
output.on('line', line => responses.push(JSON.parse(line)));
const send = r => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n');
const wait = async predicate => {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'OFFLINE_PROTOCOL_DEADLINE');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
let error, clean = false;
try {
  await wait(() => observer.events.some(e => e.event === 'observer-ready'));
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'offline-test', version: '0' } } });
  await wait(() => responses.length === 1);
  assert.equal(responses[0].result.protocolVersion, '2025-11-25');
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  await wait(() => responses.length === 2);
  assert.equal(responses[1].result.tools[0].name, 'calibration_wait');
  send({ id: 3, method: 'tools/call', params: { name: 'calibration_wait', arguments: {}, _meta: { 'ai.opencode/sessionID': 'ses_fixture' } } });
  await wait(() => observer.events.some(e => e.event === 'call'));
  assert.equal(responses.length, 2, 'no result before controlled release');
  if (mode === 'failure') assert.fail('CONTROLLED_ASSERTION_FAILURE');
  if (mode === 'deadline') await new Promise(() => {}); // Outer job deadline, NOT MCP timeout proof.
  send({ method: 'notifications/cancelled', params: { requestId: 3, reason: 'offline observation' } });
  await wait(() => observer.events.some(e => e.event === 'cancel'));
  assert.equal(responses.length, 2, 'cancel does not counterfeit a timeout/result');
  send({ method: 'notifications/calibration/release' });
  await wait(() => responses.length === 3);
  assert.equal(responses[2].id, 3);
  observer.assertValid();
} catch (e) { error = e.message; }
finally {
  child.stdin.end();
  const [code] = await exit;
  clean = code === 0;
  errors.close(); output.close(); observer.close();
  await writeFile(reportPath, JSON.stringify({ pid: process.pid, childPID: child.pid, error, clean,
    events: observer.events, responses, hostTimeoutProof: false }));
}
process.exitCode = error ? 1 : clean ? 0 : 2;
