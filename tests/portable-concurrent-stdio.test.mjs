// TEST ONLY: actual public stdio + real product HTTP via post-commit relay holds.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { publicRegistration, observe, success, toolError } from './support/public-registration.mjs';
const rpc = (a, id, name, args, suppressed = false) => a.call(name, args, { id, ms: 2000, suppressed });
const cancel = (a, requestId) => a.resource.child.stdin.write(JSON.stringify({ jsonrpc: '2.0',
  method: 'notifications/cancelled', params: { requestId, reason: 'synthetic transport only' } }) + '\n');
function observer() {
  let raw = '', eof = false; const frames = [];
  return { frames, attach(child) {
    child.stdout.on('data', b => {
      raw += b.toString(); let end;
      while ((end = raw.indexOf('\n')) >= 0) {
        try { frames.push(JSON.parse(raw.slice(0, end))); } catch { frames.push(null); }
        raw = raw.slice(end + 1);
      }
    });
    child.stdout.on('end', () => { eof = true; });
  }, complete() { assert.ok(eof && raw === '' && frames.every(Boolean), 'independent complete raw framing'); } };
}
const argsFor = p => ({ request_id: p.request_id, request_capability: p.request_capability });
const heldGets = h => h.calls.filter(c => c.method === 'GET' && c.held);
const ping = async a => assert.equal((await a.peer.call('ping', {}).outcome).kind, 'response', 'live dispatcher barrier');

test('MCP-OBSERVER-CALIBRATION: split raw frames and unsolicited late frames remain visible', async () => {
  const child = { stdout: new PassThrough() }, raw = observer(); raw.attach(child);
  child.stdout.write('{"id":7'); child.stdout.write('}\n{"id":"7"}\n');
  child.stdout.write('{"id":"unsolicited"}\n');
  const ended = once(child.stdout, 'end'); child.stdout.end(); await ended;
  raw.complete(); assert.deepEqual(raw.frames.map(f => f.id), [7, '7', 'unsolicited']);
});

test('MCP-HOLD-CALIBRATION: committed registration can be released once without fabricated reply',
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const a = await h.connect(); h.hold(c => c.path === '/v1/adapter');
    const preparing = a.call('prepare_approval');
    await observe(() => h.calls[0]?.held, 'real committed registration response held');
    assert.equal(h.calls.length, 1); assert.ok(h.calls[0].heldSocketOpen);
    h.calls[0].release(); h.calls[0].release(); success(await preparing);
    assert.equal(h.calls.filter(c => c.path === '/v1/handles').length, 1);
    await h.eof(a);
  }));

test('MCP-CONCURRENT: two real GETs held before release; reverse replies and later prepare independent',
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
    const p = success(await a.call('prepare_approval')), q = success(await a.call('prepare_approval'));
    h.hold(c => c.method === 'GET');
    const first = rpc(a, 7, 'get_approval', argsFor(p));
    const second = rpc(a, '7', 'get_approval', argsFor(q));
    await observe(() => heldGets(h).length === 2, 'both GET exchanges must coexist before either release', 1500);
    assert.ok(heldGets(h).every(c => c.heldSocketOpen && !c.closed));
    success(await a.call('prepare_approval'));
    assert.equal(raw.frames.filter(f => f?.id === 7 || f?.id === '7').length, 0, 'no premature held reply');
    heldGets(h).find(c => c.path.endsWith(q.request_id)).release();
    toolError(await second, 'NOT_FOUND');
    assert.deepEqual(raw.frames.filter(f => f?.id === 7 || f?.id === '7').map(f => f.id), ['7']);
    heldGets(h).find(c => c.path.endsWith(p.request_id)).release();
    toolError(await first, 'NOT_FOUND');
    assert.deepEqual(raw.frames.filter(f => f?.id === 7 || f?.id === '7').map(f => f.id), ['7', 7]);
    assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1);
    assert.ok(h.calls.every(c => !c.path.endsWith('/returned')), 'no result-write ledger report in this cut');
    await h.eof(a); raw.complete();
  }));

for (const id of [7, '7']) test(`MCP-CANCEL-${typeof id}: only matching active typed ID loses socket/result`,
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
    const p = success(await a.call('prepare_approval')), q = success(await a.call('prepare_approval'));
    const otherId = typeof id === 'number' ? '7' : 7;
    h.hold(c => c.method === 'GET');
    const removed = rpc(a, id, 'get_approval', argsFor(p), true);
    const survivor = rpc(a, otherId, 'get_approval', argsFor(q));
    await observe(() => heldGets(h).length === 2, 'two live real HTTP transports before cancellation', 1500);
    const [target, other] = [p, q].map(x => heldGets(h).find(c => c.path.endsWith(x.request_id)));
    const journal = await h.journal(), before = h.calls.length;
    cancel(a, 'unknown-id'); await ping(a);
    assert.ok(!target.socketClosed && !other.socketClosed, 'unknown cancel is no-op');
    cancel(a, id);
    await observe(() => target.socketClosed, 'matched cancellation destroys actual held client socket', 1000);
    assert.ok(!other.socketClosed, 'other typed ID remains attached');
    other.release(); toolError(await survivor, 'NOT_FOUND');
    cancel(a, otherId); await ping(a); // Settled ID is not an adapter-wide cancellation.
    assert.ok(journal.equals(await h.journal()), 'transport cancellation leaves durable journal byte-identical');
    success(await a.call('prepare_approval'));
    assert.equal((await removed).kind, 'suppressed');
    assert.ok(!raw.frames.some(f => f?.id === id), 'independent observer sees no cancelled ID frame');
    assert.ok((await h.journal()).length > journal.length, 'only explicit later preparation can append');
    assert.ok(h.calls.slice(before).every(c => c.path === '/v1/handles'), 'protocol cancellation creates no business/lifecycle HTTP');
    await h.eof(a); raw.complete();
  }));

test('MCP-CANCEL-ENSURE: one registration, two awaiters; cancel one without aborting shared ensure',
  { timeout: 65000 }, () => publicRegistration(async h => {
    await h.restart(); const raw = observer(), a = await h.connect('shared', { observeOutput: raw.attach });
    h.hold(c => c.path === '/v1/adapter');
    const removed = rpc(a, 'abandoned', 'prepare_approval', { session_label: 'cancelled' }, true);
    await observe(() => h.calls.some(c => c.held), 'real registration committed and response withheld');
    const survivor = rpc(a, 'survivor', 'prepare_approval', { session_label: 'survivor' });
    await ping(a); // Dispatcher processed both lines while ensure is pending.
    cancel(a, 'abandoned'); await ping(a);
    const create = h.calls.find(c => c.path === '/v1/adapter');
    assert.ok(!create.socketClosed, 'cancelling awaiter must not cancel shared registration');
    assert.equal(h.calls.length, 1, 'one single-flight create, no early forwarding');
    create.release(); success(await survivor);
    assert.equal((await removed).kind, 'suppressed');
    assert.equal(h.calls.filter(c => c.path === '/v1/adapter').length, 1);
    const forwards = h.calls.filter(c => c.path === '/v1/handles');
    assert.equal(forwards.length, 1, 'cancelled awaiter never forwards after ensure');
    assert.deepEqual(forwards[0].body, { session_label: 'survivor' });
    assert.ok(!raw.frames.some(f => f?.id === 'abandoned'));
    await h.eof(a); raw.complete();
  }));
