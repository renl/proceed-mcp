import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { prearm, inspectHostError, protectedTimeoutBinding, collectHostError } from './support/host-timeout-binding.mjs';
import { launchContained } from './support/windows-containment.mjs';

const input = () => ({ events: ['observer-ready', 'initialize', 'initialized', 'catalog', 'call']
  .map((event, i) => ({ event, at: i, ...(event === 'call' ? { id: 7, sessionID: 'ses_fixture' } : {}) })),
  before: ['msg_old'], page: { data: [{ id: 'msg_new', type: 'assistant', content: [{
    type: 'tool', name: 'calibration_wait', id: 'tool_projection',
    state: { status: 'error', error: { type: 'fixture-error', message: 'synthetic error literal' } },
  }] }], cursor: { next: null } }, sessionID: 'ses_fixture',
  path: '/api/session/ses_fixture/message?type=assistant&limit=100&order=desc',
  toolName: 'calibration_wait', executionMs: 100, toleranceMs: 10, observedAt: 104 });

test('B-ERROR: retain actual record/path/error, never certify timeout from fixtures', () => {
  const result = inspectHostError(input());
  assert.equal(result.callID, 7); assert.equal(result.toolID, 'tool_projection');
  assert.equal(result.error.type, 'fixture-error');
  assert.equal(result.timeoutEstablished, false); assert.equal(result.supportEligible, false);
});
test('B-OBSERVER: attached before stimulus; malformed records fail closed; detach', () => {
  const source = new EventEmitter(), observer = prearm(source, () => 42);
  source.emit('record', '{'); assert.throws(observer.assertValid, /MALFORMED_OBSERVER/);
  source.emit('record', JSON.stringify({ event: 'call', at: -100 }));
  assert.equal(observer.events[0].at, 42);
  observer.close(); assert.equal(source.listenerCount('record'), 0);
});
const mutations = {
  'absent invocation': x => x.events.pop(),
  'out of order': x => x.events.reverse(),
  'nonmonotonic observer': x => { x.events[2].at = -1; },
  'duplicate call': x => x.events.push(x.events.at(-1)),
  'wrong session': x => { x.events.at(-1).sessionID = 'ses_other'; },
  'result before host error': x => x.events.push({ event: 'result' }),
  'server exited': x => x.events.push({ event: 'eof' }),
  'protocol fault': x => x.events.push({ event: 'protocol-error' }),
  'early arbitrary tool error': x => { x.observedAt = 10; },
  'HTTP deadline instead': x => { x.page.data = [{ type: 'user', text: 'HTTP timeout' }]; },
  'Code Mode outer failure': x => { x.page.data[0].content[0].name = 'codemode'; },
  'text echo instead': x => { x.page.data[0].content = [{ type: 'text', text: 'timeout' }]; },
  'old tool error': x => x.before.push('msg_new'),
  'partial history': x => { x.page.cursor.next = 'more'; },
  'wrong path': x => { x.path = '/api/session/ses_other/message'; },
  'malformed error': x => { delete x.page.data[0].content[0].state.error.message; },
  'late fixture timer': x => { x.observedAt = 1000; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`B-RED: ${name}`, () => {
  const x = input(); mutate(x); assert.throws(() => inspectHostError(x), /HOST_TIMEOUT/);
});
test('B-BINDING: missing protected binding refuses before any live action', () => {
  assert.throws(() => protectedTimeoutBinding(), /PROTECTED_BINDING_MISSING/);
});
test('B-COLLECT: cleanup executes even if identity fails; missing schema blocks first', async () => {
  let stopped = 0;
  const binding = { ready: true, origin: 'http://127.0.0.1:1234',
    authorization: `Basic ${Buffer.from('opencode:fixture').toString('base64')}`,
    sessions: [{ id: 'ses_fixture', created: 1 }, { id: 'ses_other', created: 2 }], pid: 1, version: 'fixture',
    mode: 'direct', toolName: 'calibration_wait', executionMs: 100, configHash: 'a'.repeat(64), schemaCompared: true,
    arm() {}, invoke() {}, history() {}, alive() {}, identity() { throw new Error('IDENTITY_CHANGED'); },
    stop() { stopped++; return { clean: true }; } };
  await assert.rejects(collectHostError(binding, { toleranceMs: 10, signal: AbortSignal.timeout(1000) }), /IDENTITY_CHANGED/);
  assert.equal(stopped, 1);
  assert.throws(() => protectedTimeoutBinding({ ...binding, schemaCompared: false }), /TARGET_SCHEMA_NOT_COMPARED/);
});
test('B-COLLECT: prearm precedes invocation; host error keeps provenance; cleanup failure blocks', async () => {
  const order = [], source = new EventEmitter();
  let reads = 0;
  const pagePath = input().path;
  const b = { ready: true, origin: 'http://127.0.0.1:1234',
    authorization: `Basic ${Buffer.from('opencode:fixture').toString('base64')}`,
    sessions: [{ id: 'ses_fixture', created: 1 }, { id: 'ses_other', created: 2 }], pid: 1, version: 'fixture',
    mode: 'direct', toolName: 'calibration_wait', executionMs: 100, configHash: 'a'.repeat(64), schemaCompared: true,
    identity() { order.push('identity'); }, alive() { return true; },
    history() { return { path: pagePath, page: reads++ ? input().page : { data: [], cursor: {} } }; },
    arm() {
      order.push('arm'); const observer = prearm(source);
      // Synthetic backdated clock only exercises collector plumbing; NOT real timeout evidence.
      observer.events.push(...input().events.map(e => ({ ...e, at: performance.now() - 104 + e.at })));
      return observer;
    },
    invoke() { order.push('invoke'); }, stop() { order.push('stop'); return { clean: true }; } };
  const result = await collectHostError(b, { toleranceMs: 50, signal: AbortSignal.timeout(1000) });
  assert.equal(result.timeoutEstablished, false);
  assert.deepEqual(order, ['identity', 'arm', 'invoke', 'identity', 'stop']);
  assert.equal(source.listenerCount('record'), 0);
  reads = 0; b.stop = () => ({ clean: false });
  await assert.rejects(collectHostError(b, { toleranceMs: 50, signal: AbortSignal.timeout(1000) }), /CLEANUP_NOT_VERIFIED/);
});

const cwd = fileURLToPath(new URL('../', import.meta.url));
const driver = fileURLToPath(new URL('./fixtures/calibration-protocol-driver.mjs', import.meta.url));
function absent(pid) { assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); }
for (const mode of ['success', 'failure', 'deadline']) {
  test(`B-STDIO: contained ${mode}, verified cleanup, no host timeout claim`, { timeout: 45000 }, async () => {
    assert.equal(process.platform, 'win32', 'this packet requires reviewed Windows job containment');
    const scratch = await mkdtemp(join(cwd, '.scratch/packet-b-'));
    const report = join(scratch, 'report.json');
    let unit, ready;
    try {
      unit = launchContained({ exe: process.execPath, args: [driver, report, mode], cwd,
        deadline: mode === 'deadline' ? 6000 : 15000 });
      ready = await unit.ready;
      const result = await unit.closed;
      assert.equal(result.record?.active, 0, result.stderr);
      assert.equal(result.code, mode === 'deadline' ? 124 : mode === 'failure' ? 1 : 0);
      if (mode !== 'deadline') {
        const data = JSON.parse(await readFile(report));
        assert.equal(data.hostTimeoutProof, false); assert.equal(data.clean, true);
        assert.equal(data.events.filter(e => e.event === 'call').length, 1);
        absent(data.childPID);
        assert.equal(Boolean(data.error), mode === 'failure');
      }
    } finally {
      if (unit) { const result = await unit.stop(); assert.equal(result.record?.active, 0); }
      if (ready) absent(ready.pid);
      await rm(scratch, { recursive: true });
      await assert.rejects(access(scratch), { code: 'ENOENT' });
    }
  });
}
