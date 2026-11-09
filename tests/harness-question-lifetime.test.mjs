// TEST ONLY. Command/dialog boundary with memory helper/config/key IO.
// Design 1/2: expiry fences outstanding question AND Respond, not just submission.
// These assertions do not establish rendered layout, actual host or human proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const epoch = 1900000000000;
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: epoch });
  const calls = [],
    dialogs = [],
    tasks = [],
    toasts = [];
  let holdDecision = false;
  const release = [];
  const presentation = {
    presentation_id: `hpr_${'a'.repeat(32)}`,
    request_id: `req_${'b'.repeat(32)}`,
    harness_id: 'qualification',
    owner_id: 'shared',
    session_id: 'session-two',
    session_label: 'Equal qualification label',
    action: 'Read this complete action',
    context: 'Distinct current question context',
    expires_at: new Date(epoch + 2000).toISOString(),
  };
  const sources = new Map([
    [
      new URL('../src/harness/node-helper.js', import.meta.url).href,
      'export class HelperChannelError extends Error {} export const runHelperExchange = (i) => globalThis.__sdetQuestionExchange(i);',
    ],
    [
      new URL('../src/state/store.js', import.meta.url).href,
      "export async function loadPortableConfiguration() { return {owners:[{owner_id:'shared'}],broker:{port:1}}; }",
    ],
    [
      new URL('../src/harness/operator-key.js', import.meta.url).href,
      `export function validateOperatorKeyFileOption() {} export async function loadOperatorKeyFile() { return {keyId:'${'a'.repeat(64)}',credential:'hop_${'d'.repeat(64)}'}; }`,
    ],
  ]);
  const hook = registerHooks({
    load(url, context, next) {
      return sources.has(url)
        ? { format: 'module', shortCircuit: true, source: sources.get(url) }
        : next(url, context);
    },
  });
  globalThis.__sdetQuestionExchange = async (input) => {
    calls.push(input);
    if (holdDecision && input.operation === 'decisions')
      await new Promise((resolve) => release.push(resolve));
    return {
      status: 200,
      body:
        input.operation === 'pending'
          ? { schema_version: 1, presentation: structuredClone(presentation) }
          : {
              schema_version: 1,
              request_id: presentation.request_id,
              accepted: true,
              resolution: input.body.choice === 'respond' ? 'responded' : 'rejected',
              decision_id: `dec_${'c'.repeat(32)}`,
              response_text: input.body.response_text,
            },
    };
  };
  let commands;
  const renderer = Object.assign(new EventEmitter(), { width: 120, height: 40 });
  const sessions = [
    { id: 'session-one', title: 'Equal host title' },
    { id: 'session-two', title: 'Equal host title' },
  ];
  const dialog = (kind) => (options) =>
    new Promise((resolve) => dialogs.push({ kind, options, resolve }));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const context = {
    app: { version: '2.2.5' },
    renderer,
    options: {
      state_dir: join(root, '.scratch/question/state'),
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: join(root, '.scratch/question/not-created.token'),
    },
    keymap: {
      layer: (factory) => {
        commands = factory().commands;
      },
      // Memory model of the pinned public dispatch signature. No keyboard event
      // is supplied. The actual registered product callback remains unmodified.
      dispatch: (id, input) => {
        const command = commands.find((c) => c.id === id);
        assert.ok(command, 'attack must reach a registered product command');
        tasks.push(Promise.resolve(command.run(input)));
      },
    },
    data: {
      session: {
        list: () => structuredClone(sessions),
        get: (id) => structuredClone(sessions.find((s) => s.id === id)),
      },
    },
    ui: {
      toast: { show: (v) => toasts.push(v) },
      dialog: {
        select: dialog('select'),
        confirm: dialog('confirm'),
        prompt: dialog('prompt'),
        // A future public custom display is recorded, not granted layout proof.
        show: dialog('show'),
      },
    },
  };
  let cleanup;
  try {
    const { harnessTuiDefinition } = await import(
      `../src/harness/tui-plugin.js?question-lifetime=${t.name}`
    );
    cleanup = await harnessTuiDefinition.setup(context);
    assert.equal(typeof cleanup, 'function');
  } catch (error) {
    hook.deregister();
    delete globalThis.__sdetQuestionExchange;
    throw error;
  }
  const open = commands.find((c) => c.id === 'proceed.harness.open').run;
  const question = async () => {
    tasks.push(open());
    dialogs.at(-1).resolve('session-two');
    await flush();
    assert.equal(dialogs.at(-1).kind, 'confirm');
    dialogs.at(-1).resolve(true);
    await flush();
    assert.equal(calls.at(-1).operation, 'pending');
    assert.equal(calls.at(-1).body.session_id, 'session-two');
    assert.equal(dialogs.at(-1).options.current, 'reject');
    for (const key of ['request_id', 'session_label', 'action', 'context', 'expires_at'])
      assert.ok(dialogs.at(-1).options.title.includes(presentation[key]));
    assert.deepEqual(
      dialogs
        .at(-1)
        .options.options.map((option) => option.value)
        .sort(),
      ['approve', 'reject', 'respond'],
    );
    return dialogs.at(-1);
  };
  t.after(async () => {
    cleanup();
    release.forEach((resolve) => resolve());
    // Late results are deliberately drained only after the generation is fenced.
    for (let n = 0; n < 4; n++) {
      dialogs.forEach((d) => d.resolve(undefined));
      await flush();
    }
    await Promise.allSettled(tasks);
    assert.equal(renderer.listenerCount('resize'), 0);
    hook.deregister();
    delete globalThis.__sdetQuestionExchange;
    t.mock.timers.reset();
  });
  return {
    calls,
    dialogs,
    question,
    cleanup,
    renderer,
    open,
    dispatch: context.keymap.dispatch,
    tasks,
    presentation,
    holdDecisions: () => {
      holdDecision = true;
    },
  };
}

test('W4 command replacement is navigation only and old answers cannot affect another request', async (t) => {
  // Design 1/2 permits replacement. It does not permit command arguments or a
  // fenced old question to supply an answer, even after a new request appears.
  const f = await fixture(t);
  const current = await f.question();
  const before = f.calls.length;
  f.dispatch(
    'proceed.harness.open',
    JSON.stringify({
      choice: 'approve',
      request_id: f.presentation.request_id,
      presentation_id: f.presentation.presentation_id,
      human: true,
    }),
  );
  await flush();
  const afterAttack = f.dialogs.at(-1);
  assert.notEqual(afterAttack, current);
  assert.equal(afterAttack.kind, 'select', 'replacement must start fresh navigation');
  assert.ok(afterAttack.options.options.some((o) => o.value === 'session-one'));
  assert.ok(afterAttack.options.options.some((o) => o.value === 'session-two'));
  assert.equal(f.calls.length, before, 'no pending lookup without genuine identity confirmation');
  // Never send a decision key to the replacement picker. Dismiss navigation and
  // establish a different request through the complete fresh navigation path.
  afterAttack.resolve(undefined);
  await flush();
  f.presentation.request_id = `req_${'e'.repeat(32)}`;
  f.presentation.presentation_id = `hpr_${'f'.repeat(32)}`;
  const next = await f.question();
  const callsBeforeLate = f.calls.length;
  current.resolve('approve');
  await flush();
  assert.equal(f.dialogs.at(-1), next, 'late old answer cannot replace the current question');
  assert.equal(
    f.calls.length,
    callsBeforeLate,
    'late old answer cannot query or decide either binding',
  );
  assert.equal(f.calls.filter((c) => c.operation === 'decisions').length, 0);
});

for (const stage of ['question', 'respond']) {
  test(`${stage}: immutable expiry fences any late answer and successor`, async (t) => {
    const f = await fixture(t);
    let current = await f.question();
    if (stage === 'respond') {
      current.resolve('respond');
      await flush();
      current = f.dialogs.at(-1);
      assert.equal(current.kind, 'prompt');
    }
    const count = f.dialogs.length;
    t.mock.timers.tick(2000);
    await flush();
    current.resolve(stage === 'respond' ? 'approved' : 'respond');
    await flush();
    assert.equal(f.dialogs.length, count, 'an expired question cannot open its Respond successor');
    assert.equal(f.calls.filter((c) => c.operation === 'decisions').length, 0);
  });
}

test('immutable request expiry aborts a still-owned decision exchange without waiting for its result', async (t) => {
  const f = await fixture(t);
  const current = await f.question();
  f.holdDecisions();
  current.resolve('reject');
  await flush();
  const exchange = f.calls.at(-1);
  assert.equal(exchange.operation, 'decisions');
  assert.equal(exchange.signal.aborted, false);
  t.mock.timers.tick(2000);
  await flush();
  assert.equal(
    exchange.signal.aborted,
    true,
    'a live helper must be aborted at the immutable request deadline',
  );
});

for (const stage of ['question', 'respond']) {
  test(`${stage}: resize invalidates the interaction and cannot submit a late choice`, async (t) => {
    const f = await fixture(t);
    let current = await f.question();
    if (stage === 'respond') {
      current.resolve('respond');
      await flush();
      current = f.dialogs.at(-1);
      assert.equal(current.kind, 'prompt');
    }
    f.renderer.width = 20;
    f.renderer.height = 6;
    f.renderer.emit('resize');
    current.resolve(stage === 'respond' ? 'approved' : 'approve');
    await flush();
    assert.equal(
      f.calls.filter((c) => c.operation === 'decisions').length,
      0,
      'a resized interaction grants no decision, including its Respond successor',
    );
  });
}

test('resize aborts an already-owned decision exchange before its delayed result', async (t) => {
  // Design section 2 requires abort as well as callback fencing when display
  // admission is lost. This is an injected pending promise, not a real helper.
  const f = await fixture(t);
  const current = await f.question();
  f.holdDecisions();
  current.resolve('reject');
  await flush();
  const exchange = f.calls.at(-1);
  assert.equal(exchange.operation, 'decisions');
  assert.equal(exchange.signal.aborted, false);
  f.renderer.width = 20;
  f.renderer.height = 6;
  f.renderer.emit('resize');
  await flush();
  assert.equal(exchange.isActive(), false, 'lost display admission fences further phases');
  assert.equal(exchange.signal.aborted, true, 'resize must abort the outstanding exchange now');
  assert.equal(f.calls.filter((c) => c.operation === 'decisions').length, 1, 'no automatic retry');
});

test('Respond approved is instructions on the exact captured request, never approval', async (t) => {
  const f = await fixture(t);
  const current = await f.question();
  const captured = structuredClone(f.presentation);
  current.resolve('respond');
  await flush();
  // A subsequent pending slot/foreground record cannot retarget this prompt.
  f.presentation.request_id = `req_${'e'.repeat(32)}`;
  f.presentation.presentation_id = `hpr_${'f'.repeat(32)}`;
  f.presentation.session_id = 'session-one';
  f.dialogs.at(-1).resolve('approved');
  await flush();
  const submitted = f.calls.filter((c) => c.operation === 'decisions');
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0].body, {
    harness_id: 'qualification',
    owner_id: 'shared',
    session_id: 'session-two',
    request_id: captured.request_id,
    presentation_id: captured.presentation_id,
    choice: 'respond',
    response_text: 'approved',
  });
});
