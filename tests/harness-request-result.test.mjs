// TEST ONLY. Native current-cell/refusal controls. No process, IO or runtime mode.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observeCurrentQuestion,
  currentQuestionAdapter,
  requestResultWireAdapter,
} from './support/harness-request-result.mjs';

const presentation = {
  request_id: `req_${'a'.repeat(32)}`,
  presentation_id: `hpr_${'b'.repeat(32)}`,
  session_id: 'exact-session',
  session_label: 'Equal qualification label',
  action: 'Qualification action',
  context: 'Current distinguishing context',
  expires_at: '2030-01-01T00:00:00.000Z',
};
const binding = {
  run: 'memory-run',
  setup: 'memory-generation',
  geometry: { width: 120, height: 40, resizeSequence: 0 },
  inputs: 'memory-only-not-admitted-runtime',
};
const live = {
  live: true,
  run: binding.run,
  generation: binding.setup,
  geometry: binding.geometry,
};
const paint = (lines) =>
  Buffer.from(
    '\x1b[?2026h\x1b[2J' + lines.map((s, n) => `\x1b[${n + 1};1H${s}`).join('') + '\x1b[?2026l',
  );
const lines = [
  'Proceed approval request',
  presentation.request_id,
  presentation.session_label,
  presentation.action,
  presentation.context,
  presentation.expires_at,
  'Reject',
  'Respond',
  'Approve',
];

test('current question requires every immutable field and all current controls, not old transcript text', () => {
  const raw = paint(lines);
  const seen = observeCurrentQuestion({ raw, live, binding, presentation });
  assert.equal(seen.bytes, raw.length);
  for (let i = 1; i < lines.length; i++) {
    const missing = paint(lines.filter((_, n) => n !== i));
    assert.throws(() => observeCurrentQuestion({ raw: missing, live, binding, presentation }));
  }
  const dismissed = Buffer.concat([raw, paint(['Ask anything'])]);
  assert.throws(() =>
    observeCurrentQuestion({ raw: dismissed, live, binding, presentation, previous: seen }),
  );
  for (const altered of [
    { ...live, live: false },
    { ...live, generation: 'replacement' },
    { ...live, geometry: { ...live.geometry, resizeSequence: 1 } },
  ])
    assert.throws(() => observeCurrentQuestion({ raw, live: altered, binding, presentation }));
});

test('question input rechecks current IO and permanently refuses after loss or final deadline', () => {
  for (const failure of ['dismissed', 'fixed', 'replacement', 'deadline', 'in-reader']) {
    let raw = paint(lines),
      state = structuredClone(live),
      fixed = structuredClone(binding),
      tick = 1;
    let adapter,
      invalidateInReader = false,
      writes = 0;
    adapter = currentQuestionAdapter({
      binding,
      deadline: 10,
      now: () => tick,
      readRaw: () => raw,
      readLive: () => {
        if (invalidateInReader) adapter.invalidate();
        return state;
      },
      readBinding: () => fixed,
    });
    adapter.check(presentation);
    if (failure === 'dismissed') raw = Buffer.concat([raw, paint(['Ask anything'])]);
    if (failure === 'fixed') fixed.inputs = 'changed';
    if (failure === 'replacement') state.generation = 'changed';
    if (failure === 'deadline') tick = 10;
    if (failure === 'in-reader') invalidateInReader = true;
    assert.throws(() => adapter.input(presentation, () => writes++, '\r'));
    raw = paint(lines);
    state = structuredClone(live);
    fixed = structuredClone(binding);
    tick = 1;
    invalidateInReader = false;
    assert.throws(() => adapter.input(presentation, () => writes++, '\r'));
    assert.equal(writes, 0);
  }
});

test('explicit wire adapter requires independently read presentation and preserves exact public route', async () => {
  const calls = [];
  const status = {
    schema_version: 1,
    request_id: presentation.request_id,
    decision_id: null,
    resolution: 'pending',
    response_text: null,
  };
  const h = {
    shared: null,
    operator: { credential: 'synthetic-memory-only' },
    async http(path, key, request) {
      calls.push({ path, key, request });
      return {
        status: 200,
        json: async () =>
          path === '/v1/harness/pending'
            ? { schema_version: 1, presentation: structuredClone(presentation) }
            : status,
      };
    },
  };
  assert.throws(() => requestResultWireAdapter(h, { scenario: null, wait() {} }));
  assert.equal(calls.length, 0);
  const adapter = requestResultWireAdapter(h, {
    scenario: 'request-to-originating-result',
    wait: async (_, predicate) => assert.equal(await predicate(), true),
    now: () => 1,
  });
  const p = await adapter.waitPending('exact-session');
  assert.deepEqual(await adapter.observe(p), { presentation, status });
  assert.deepEqual(
    calls.map((c) => c.path),
    ['/v1/harness/pending', '/v1/harness/presentations/' + presentation.presentation_id],
  );
  assert.deepEqual(calls[1].request.body, {
    harness_id: 'qualification',
    owner_id: 'shared',
    session_id: 'exact-session',
    request_id: presentation.request_id,
  });
  await assert.rejects(adapter.observe({ ...p, session_id: 'foreign-session' }));
  assert.equal(calls.length, 2, 'forged expected presentation cannot initiate a public read');
});
