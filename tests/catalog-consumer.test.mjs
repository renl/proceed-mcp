// TEST ONLY consumer calibration: never a product or host pass.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { catalogPeer, initializeResult, successful, allTools, workflowInstructions } from './support/catalog-consumer.mjs';

const outcome = result => ({ kind: 'response', frame: { jsonrpc: '2.0', id: 1, result } });
const init = () => ({ protocolVersion: '2025-11-25', serverInfo: { name: 'fixture', version: '0' }, capabilities: { tools: {} } });
function fixture(options) {
  const child = new EventEmitter();
  Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kills: 0 });
  child.kill = () => { child.kills++; };
  const peer = catalogPeer(child, options);
  const end = async () => {
    const eof = [once(child.stdout, 'end'), once(child.stderr, 'end')];
    child.stdout.end(); child.stderr.end();
    await Promise.all(eof);
    child.emit('close');
  };
  return { child, peer, end };
}

test('consumer: initialize requires typed identity, tools object, exclusive success', () => {
  initializeResult(outcome(init()));
  for (const modify of [r => { delete r.serverInfo; }, r => { r.serverInfo.name = 1; },
    r => { r.serverInfo.version = null; }, r => { r.capabilities.tools = true; },
    r => { r.capabilities.tools = []; }, r => { r.capabilities.tools = null; }]) {
    const result = init(); modify(result);
    assert.throws(() => initializeResult(outcome(result)));
  }
  for (const frame of [{ result: {}, error: {} }, { error: {} }, { result: null }, { result: [] }]) {
    assert.throws(() => successful({ kind: 'response', frame: { jsonrpc: '2.0', ...frame } }));
  }
});

test('consumer: collect every cursor page, including a hidden extra tool', async () => {
  const calls = [];
  const peer = { call(method, params) {
    calls.push([method, params]);
    return { outcome: Promise.resolve(outcome(calls.length === 1 ?
      { tools: [{ name: 'expected' }], nextCursor: 'opaque' } : { tools: [{ name: 'extra' }] })) };
  } };
  const names = (await allTools(peer)).map(t => t.name);
  assert.deepEqual(names, ['expected', 'extra']);
  assert.throws(() => assert.deepEqual(names, ['expected']), 'exact catalog gate rejects hidden tool');
  assert.deepEqual(calls, [['tools/list', {}], ['tools/list', { cursor: 'opaque' }]]);
});

test('consumer: reject malformed, cyclic and excessive pagination', async () => {
  for (const result of [{ tools: [], nextCursor: null }, { tools: [], nextCursor: 1 },
    { tools: [], nextCursor: 'cycle' }, { tools: {} }, { tools: Array(129).fill({}) }]) {
    await assert.rejects(allTools({ call: () => ({ outcome: Promise.resolve(outcome(result)) }) }));
  }
  let page = 0;
  await assert.rejects(allTools({ call: () => ({ outcome: Promise.resolve(outcome({ tools: [], nextCursor: String(page++) })) }) }), /page limit/);
});

test('consumer: semantic instructions accept different wording, reject omissions/legacy claims', () => {
  const concepts = ['First invoke prepare_approval before request_approval.',
    'request_approval blocks for a human decision.', 'The capability is confidential.',
     'Save the key with the request ID and handle.', 'Do not expose the key.'];
  workflowInstructions({ instructions: concepts.join(' ') }, []);
  workflowInstructions({}, [{ description: concepts.join('\n') }]);
  workflowInstructions({ instructions: `${concepts.join('\n')}\nNever returns an immediate receipt. Does not inject a session prompt.` }, []);
  for (let i = 0; i < concepts.length; i++) {
    assert.throws(() => workflowInstructions({ instructions: concepts.filter((_, j) => j !== i).join('\n') }, []));
  }
  for (const claim of ['Returns an immediate receipt.', 'Injects a session prompt through OpenCode API.']) {
    assert.throws(() => workflowInstructions({ instructions: `${concepts.join('\n')}\n${claim}` }, []));
  }
});

test('consumer: waiting availability retains two-call/privacy invariants without obsolete unavailable guard', () => {
  const clauses = ['First invoke prepare_approval before request_approval.',
    'request_approval waits for a human decision.', 'The capability is private.',
    'Keep the key with the handle and request ID.', 'Never echo the key.',
     'prepare_approval is available.', 'No Telegram transport is implemented yet.'];
  workflowInstructions({ instructions: clauses.join('\n') }, []);
  for (const index of [0, 1, 2, 3, 4]) {
    assert.throws(() => workflowInstructions({ instructions: clauses.filter((_, i) => i !== index).join('\n') }, []));
  }
  workflowInstructions({ instructions: clauses.slice(0, 6).join('\n') }, []);
});

test('consumer: valid response, then clean EOF/close is required', async () => {
  const { child, peer, end } = fixture();
  const call = peer.call('initialize', {});
  child.stdout.write(JSON.stringify(outcome(init()).frame) + '\n');
  initializeResult(await call.outcome);
  assert.throws(() => peer.assertComplete(), /closure/);
  await end(); peer.assertComplete();
  assert.equal(child.kills, 0);
});

test('consumer: malformed shutdown stdout survives no pending calls through EOF', async () => {
  for (const text of ['garbage\n', 'null\n', '{"jsonrpc":"2.0","id":99,"result":{}}\n', 'unterminated']) {
    const { child, peer, end } = fixture();
    const call = peer.call('initialize', {});
    child.stdout.write(JSON.stringify(outcome(init()).frame) + '\n');
    initializeResult(await call.outcome);
    child.emit('exit'); // Output can still arrive between exit and close.
    child.stdout.write(text);
    await end();
    assert.throws(() => peer.assertComplete(), /stdout|frame/);
    assert.ok(child.kills > 0);
  }
});

test('consumer: response with result plus error is invalid, not product success', async () => {
  const { child, peer, end } = fixture();
  const call = peer.call('initialize', {});
  child.stdout.write('{"jsonrpc":"2.0","id":1,"result":{},"error":{}}\n');
  assert.equal((await call.outcome).kind, 'invalid-frame');
  await end(); assert.throws(() => peer.assertComplete());
});

test('consumer: secret detection crosses chunks on each stream, including shutdown', async () => {
  const secret = 'synthetic-only-owner-secret';
  for (const name of ['stdout', 'stderr']) {
    for (let split = 1; split < secret.length; split++) {
      const { child, peer, end } = fixture({ secrets: [secret] });
      child.emit('exit');
      child[name].write(secret.slice(0, split));
      child[name].write(secret.slice(split));
      await end();
      assert.throws(() => peer.assertComplete(), /credential disclosure/);
      assert.ok(child.kills > 0);
    }
  }
});

test('consumer: output cap terminates and remains failed after shutdown', async () => {
  const { child, peer, end } = fixture({ maxBytes: 16 });
  child.stderr.write('x'.repeat(16));
  child.stdout.write('x');
  assert.ok(child.kills > 0);
  await end(); assert.throws(() => peer.assertComplete(), /output limit/);
});

test('consumer: typed IDs correlate independently and suppressed/late frames never disappear', async () => {
  const f = fixture();
  const n = f.peer.call('ping', {}, { id: 7 }), s = f.peer.call('ping', {}, { id: '7' });
  for (const id of ['7', 7]) f.child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
  assert.equal((await n.outcome).frame.id, 7); assert.equal((await s.outcome).frame.id, '7');
  await f.end(); f.peer.assertComplete();
  for (const late of [false, true]) {
    const g = fixture(); const c = g.peer.call('ping', {}, { id: 'cancelled', ms: 10, suppressed: true });
    if (late) assert.equal((await c.outcome).kind, 'suppressed');
    g.child.stdout.write('{"jsonrpc":"2.0","id":"cancelled","result":{}}\n');
    await c.outcome; await g.end();
    assert.throws(() => g.peer.assertComplete(), /suppressed|unexpected/);
  }
});
