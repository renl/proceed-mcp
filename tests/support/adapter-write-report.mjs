// TEST ONLY composition. Real broker/Journals are owned by publicRegistration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { createLocalClient } from '../../src/http/local-client.js';
import { createRegistrationBinding } from '../../src/mcp/registration.js';
import { createToolExecutor } from '../../src/mcp/execution.js';
import { runMcpServer } from '../../src/mcp/server.js';
import { readJournal } from '../../src/journal/framing.js';
import { observe } from './public-registration.mjs';
import { bounded } from './managed-spike.mjs';
export const reports = h => h.calls.filter(c => c.path.endsWith('/returned'));
export const rows = async h => readJournal(await h.journal()).transactions.flatMap(t => t.mutations);
export const auth = p => ({ request_id: p.request_id, request_capability: p.request_capability });
export const question = p => ({ request_handle: p.request_handle, request_capability: p.request_capability,
  client_request_id: 'write', action: 'Proceed?', context: '', expires_in_seconds: 60 });
export async function cancel(h, p) {
  const r = await h.http(`/v1/requests/${p.request_id}/cancel`, h.owner, { method: 'POST',
    headers: { 'X-Proceed-Request-Capability': p.request_capability }, body: '{}' });
  assert.equal(r.status, 200); return r.json();
}
export async function quiet(h, count = 0) {
  assert.equal(reports(h).length, count); await delay(150);
  assert.equal(reports(h).length, count, 'no late report or retry in measured150ms window');
}
export async function recorded(h, p, count = 1) {
  await observe(() => reports(h).some(r => r.path === `/v1/requests/${p.request_id}/returned` && r.committed),
    'actual report HTTP completion observed');
  await observe(async () => (await rows(h)).filter(m => m.op === 'request.returned' &&
    m.request_id === p.request_id).length === count, 'actual returned journal mutation');
  const r = reports(h).find(c => c.path === `/v1/requests/${p.request_id}/returned`);
  const w = h.calls.find(c => c.path === `/v1/requests/${p.request_id}/wait` && c.status === 200);
  assert.equal(r.method, 'POST'); assert.equal(r.status, 200);
  assert.deepEqual(r.body, { registration_id: w.body.registration_id, decision_id: w.reply.decision_id });
  assert.ok(r.token === `Bearer ${h.owner}` && r.capability === p.request_capability && r.header === w.header,
    'report carries exact terminal wait incarnation, owner and capability');
}
export async function controlled(h, work, { callback = true, fault = null } = {}) {
  const config = JSON.parse(await readFile(join(h.state, 'config.json'), 'utf8'));
  const client = createLocalClient({ port: config.broker.port, token: h.owner });
  const executor = createToolExecutor({ client, waitClient: client,
    registration: createRegistrationBinding({ client }) });
  const stdin = new PassThrough(), writes = [], errors = [], hooks = [], consumed = new Set();
  const stdout = new Writable({ highWaterMark: 1, write(chunk, encoding, done) {
    const frame = JSON.parse(String(chunk)); let released = false;
    writes.push({ frame, done(error) { if (!released) { released = true; done(error); } } });
    if (frame.id !== 'original') { released = true; done(); }
  } });
  if (fault === 'throw') {
    const write = stdout.write.bind(stdout);
    stdout.write = (chunk, ...args) => {
      const frame = JSON.parse(String(chunk));
      if (frame.id !== 'original') return write(chunk, ...args);
      writes.push({ frame, done() {} }); throw Error('controlled synchronous write failure');
    };
  }
  if (fault === 'callback-error-reusable') {
    const write = stdout.write.bind(stdout);
    stdout.write = (chunk, callback) => write(chunk, error => callback(
      JSON.parse(String(chunk)).id === 'original' ? Error('controlled callback failure on reusable transport') : error));
  }
  stdout.on('error', e => errors.push(e));
  const send = message => stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const call = (id, name, args = {}) => send({ id, method: 'tools/call', params: { name, arguments: args } });
  const task = runMcpServer({ stdin, stdout, execute: executor.execute,
    ...(callback ? { onResultWritten: (message, response) => {
      hooks.push(message.id); return executor.reportWritten(response.result);
    } } : {}), onInputClosed: () => { void executor.close(); } });
  try {
    await work({ call, send, writes, errors, hooks, stdout, executor, end: () => stdin.end(),
      frame: async id => { const next = () => writes.find(w => w.frame.id === id && !consumed.has(w));
        await observe(next, 'actual Writable invocation');
        const w = next(); consumed.add(w); return w; },
      eof: async () => { const start = performance.now(); stdin.end();
        await bounded(() => Promise.all([task, executor.close()]), 2750, 'shared close deadline');
        assert.ok(performance.now() - start < 2750); } });
  } finally {
    // Recovery is failed-write cleanup, never manufactured successful-write evidence.
    for (const w of writes) w.done(Error('test-owned stream cleanup'));
    stdin.end(); stdout.destroy();
    await bounded(() => Promise.allSettled([task, executor.close()]), 3000, 'controlled cleanup deadline');
    assert.ok(stdin.readableEnded && stdout.destroyed, 'owned streams closed');
  }
}
