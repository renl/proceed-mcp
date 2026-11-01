// TEST ONLY private executor contracts; public stdio/socket proof is separate.
import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { createToolExecutor } from '../src/mcp/execution.js';
import { LocalRequestError } from '../src/http/local-client.js';
import { bounded } from './support/managed-spike.mjs';
const unavailable = r => {
  assert.equal(r.isError, true);
  assert.deepEqual(r.structuredContent, { schema_version: 1, error: { code: 'BROKER_UNAVAILABLE',
    message: 'the broker did not return a usable result', retryable: true } });
};
test('EXEC-CANCEL-ENSURE: abandoned awaiter settles promptly, shared ensure/survivor continue', { timeout: 2000 }, async () => {
  let release; const ensure = new Promise(r => { release = r; }); const sent = [];
  const ex = createToolExecutor({ waitClient: { request() { assert.fail('ordinary tools never wait'); } }, registration: { ensure: () => ensure, close() {} },
    client: { request: async (...args) => { sent.push(args); return { status: 200, body: {} }; } } });
  const c = new AbortController();
  const abandoned = ex.execute('prepare_approval', { session_label: 'cancelled' }, { signal: c.signal });
  const survivor = ex.execute('prepare_approval', { session_label: 'survivor' }); c.abort();
  try {
    unavailable(await bounded(() => abandoned, 200, 'cancelled ensure awaiter must settle before ensure resolves'));
    assert.equal(sent.length, 0); assert.equal(getEventListeners(c.signal, 'abort').length, 0);
  } finally { release(); await Promise.all([abandoned, survivor]); await ex.close(); }
  assert.equal(sent.length, 1); assert.deepEqual(sent[0][2], { session_label: 'survivor' });
});
test('EXEC-CANCEL-SIGNALS: per-call abort isolation, pre-abort, global close and listener cleanup', { timeout: 2000 }, async () => {
  const sent = []; const ex = createToolExecutor({ waitClient: { request() { assert.fail('ordinary tools never wait'); } }, registration: { async ensure() {}, close() {} },
    client: { request(method, path, body, headers, { signal }) {
      return new Promise((resolve, reject) => {
        const abort = () => { signal.removeEventListener('abort', abort);
          reject(new LocalRequestError('BROKER_UNAVAILABLE', 'synthetic private detail')); };
        signal.addEventListener('abort', abort, { once: true }); sent.push({ signal, resolve: () => {
          signal.removeEventListener('abort', abort); resolve({ status: 200, body: {} }); } });
      });
    } } });
  const pre = new AbortController(); pre.abort();
  try {
    unavailable(await bounded(() => ex.execute('prepare_approval', {}, { signal: pre.signal }), 200, 'pre-abort never sends'));
    assert.equal(sent.length, 0);
    const c = new AbortController(), d = new AbortController();
    const one = ex.execute('prepare_approval', {}, { signal: c.signal });
    const two = ex.execute('prepare_approval', {}, { signal: d.signal });
    await Promise.resolve(); await Promise.resolve(); c.abort();
    unavailable(await bounded(() => one, 200, 'only cancelled exchange settles'));
    assert.ok(!sent[1].signal.aborted); sent[1].resolve(); assert.equal((await two).isError, false);
    for (const signal of [c.signal, d.signal]) assert.equal(getEventListeners(signal, 'abort').length, 0);
    const three = ex.execute('prepare_approval', {}); await Promise.resolve(); await Promise.resolve();
    await ex.close(); unavailable(await three); assert.ok(sent.at(-1).signal.aborted);
  } finally { await ex.close(); }
});
