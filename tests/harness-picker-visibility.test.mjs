// TEST ONLY. Design sections 1/3: native public-dialog arguments and fences.
// Fake callbacks do NOT prove rendered identity, highlight, or human authority.
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { assertIdentityMessage } from './support/harness-navigation-observation.mjs';

const exact = 'ses_' + 'a'.repeat(50);
const other = 'ses_' + 'b'.repeat(50);
const title = 'Long equal title '.repeat(4);
const hook = registerHooks({
  load(url, context, next) {
    const fake = (source) => ({ format: 'module', shortCircuit: true, source });
    if (url === new URL('../src/state/store.js', import.meta.url).href)
      return fake(
        `export async function loadPortableConfiguration() { return {owners:[{owner_id:'shared'}],broker:{port:1}}; }`,
      );
    if (url === new URL('../src/harness/operator-key.js', import.meta.url).href)
      return fake(
        `export function validateOperatorKeyFileOption() {} export async function loadOperatorKeyFile() { return {keyId:'${'a'.repeat(64)}',credential:'synthetic-only'}; }`,
      );
    if (url === new URL('../src/harness/node-helper.js', import.meta.url).href)
      return fake(
        `export class HelperChannelError extends Error {} export async function runHelperExchange(input) { globalThis.__pickerTEST.push({operation:input.operation,body:input.body}); return {status:200,body:{schema_version:1,presentation:null}}; }`,
      );
    return next(url, context);
  },
});

async function fixture({
  sessions = [
    { id: exact, title },
    { id: other, title },
  ],
  get,
  width = 100,
  height = 50,
} = {}) {
  const calls = [];
  globalThis.__pickerTEST = calls;
  const picks = [],
    confirms = [],
    queries = [],
    toasts = [];
  const renderer = Object.assign(new EventEmitter(), { width, height });
  let commands;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cleanup = await harnessTuiDefinition.setup({
    app: { version: '2.2.5' },
    renderer,
    options: {
      state_dir: join(root, '.scratch/picker-test/not-created'),
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: join(root, '.scratch/picker-test/not-created.token'),
    },
    keymap: {
      layer(factory) {
        commands = factory().commands;
      },
    },
    data: {
      session: {
        list: () => sessions,
        get: (id) => {
          queries.push(id);
          return get ? get(id, queries.length) : sessions.find((s) => s.id === id);
        },
        sync: async () => {},
      },
    },
    ui: {
      toast: {
        show(value) {
          toasts.push(value);
        },
      },
      dialog: {
        select: (options) => new Promise((resolve) => picks.push({ options, resolve })),
        confirm: (options) => new Promise((resolve) => confirms.push({ options, resolve })),
      },
    },
  });
  const pending = [];
  return {
    calls,
    picks,
    confirms,
    queries,
    renderer,
    toasts,
    sessions,
    open() {
      pending.push(commands.find((c) => c.id === 'proceed.harness.open').run());
    },
    async close() {
      await cleanup();
      for (const p of [...picks, ...confirms]) p.resolve(undefined);
      await Promise.all(pending);
      assert.equal(renderer.listenerCount('resize'), 0, 'resize listener leaked');
    },
    cleanup,
  };
}
const { harnessTuiDefinition } = await import('../src/harness/tui-plugin.js');
// Only bounded microtask progress. No host, timer, filesystem, child or wire.
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function select(f, index = 1) {
  f.open();
  f.picks.at(-1).resolve(f.sessions[index].id);
  await flush();
}
function confirmation(f) {
  assert.equal(f.confirms.length, 1, 'mandatory complete-identity confirmation missing');
  assert.equal(f.calls.length, 0, 'pending lookup occurred before confirmation');
  const options = f.confirms[0].options;
  assert.equal(options.title, 'Open Proceed question?');
  assert.deepEqual(options.label, { confirm: 'Open question', cancel: 'Cancel' });
  return options;
}

test('NH-PICKER-VISIBILITY-001 selected equal-title candidate confirms full lossless identity before exact lookup', async () => {
  const f = await fixture();
  try {
    await select(f);
    assert.deepEqual(
      f.picks[0].options.options.map((o) => o.value),
      [exact, other],
    );
    const ordinals = f.picks[0].options.options.map((o) => o.title.match(/^Session \d+\b/)?.[0]);
    assert.equal(new Set(ordinals).size, 2);
    assert.ok(ordinals.every(Boolean), 'unique short ordinals, not concatenated identities');
    const options = confirmation(f);
    const beforeConfirmReads = f.queries.length;
    assert.ok(beforeConfirmReads >= 1);
    assertIdentityMessage(options.message, { title, id: other, ordinal: ordinals[1] });
    assert.equal(f.renderer.listenerCount('resize'), 1);
    f.confirms[0].resolve(true);
    await flush();
    assert.ok(f.queries.length > beforeConfirmReads, 'reverify immediately after confirmation');
    assert.ok(
      f.queries.every((id) => id === other),
      'never verify another session',
    );
    assert.deepEqual(f.calls, [
      {
        operation: 'pending',
        body: { harness_id: 'qualification', owner_id: 'shared', session_id: other },
      },
    ]);
    assert.equal(f.renderer.listenerCount('resize'), 0);
  } finally {
    await f.close();
  }
});

test('changing provisional selection changes exactly the confirmed identity, not equal title or foreground', async () => {
  for (const index of [0, 1]) {
    const f = await fixture();
    try {
      await select(f, index);
      assertIdentityMessage(confirmation(f).message, {
        ...f.sessions[index],
        ordinal: `Session ${index + 1}`,
      });
    } finally {
      await f.close();
    }
  }
});

test('false or undefined confirmation and picker dismissal send no pending lookup', async () => {
  for (const result of [false, undefined]) {
    const f = await fixture();
    try {
      await select(f);
      confirmation(f);
      f.confirms[0].resolve(result);
      await flush();
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
  const f = await fixture();
  try {
    f.open();
    f.picks[0].resolve(undefined);
    await flush();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.confirms, []);
  } finally {
    await f.close();
  }
});

test('printable ASCII title punctuation remains lossless inert body text, never sanitized identity', async () => {
  const safeTitle = '<a href="https://invalid/"> $() `text` [link]';
  const f = await fixture({ sessions: [{ id: exact, title: safeTitle }] });
  try {
    await select(f, 0);
    assertIdentityMessage(confirmation(f).message, {
      title: safeTitle,
      id: exact,
      ordinal: 'Session 1',
    });
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});

test('reopening creates fresh identity confirmation while replaced true cannot query reused session', async () => {
  const f = await fixture();
  try {
    await select(f);
    confirmation(f);
    const old = f.confirms[0];
    await select(f);
    assert.equal(f.confirms.length, 2);
    assert.equal(f.renderer.listenerCount('resize'), 1);
    old.resolve(true);
    await flush();
    assert.deepEqual(f.calls, []);
    f.confirms[1].resolve(true);
    await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].body.session_id, other);
  } finally {
    await f.close();
  }
});

test('unresolved, foreign, changed-title or non-snapshot selections refuse before confirmation/exchange', async () => {
  for (const get of [
    () => undefined,
    () => ({ id: exact, title }),
    () => ({ id: other, title: title + 'changed' }),
  ]) {
    const f = await fixture({ get });
    try {
      await select(f);
      assert.deepEqual(f.confirms, []);
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
  const f = await fixture();
  try {
    f.open();
    f.picks[0].resolve('not-in-snapshot');
    await flush();
    assert.deepEqual(f.confirms, []);
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});

test('second exact verification refuses title/ID change or unresolved record after current true', async () => {
  for (const changed of [undefined, { id: exact, title }, { id: other, title: 'changed' }]) {
    let record = { id: other, title };
    const f = await fixture({ get: () => record });
    try {
      await select(f);
      confirmation(f);
      record = changed;
      f.confirms[0].resolve(true);
      await flush();
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
});

test('a mutable host list cannot rewrite the captured confirmation identity', async () => {
  const f = await fixture();
  try {
    await select(f);
    const shown = confirmation(f).message;
    f.sessions[1].title = 'Changed after selection';
    assert.equal(f.confirms[0].options.message, shown);
    f.confirms[0].resolve(true);
    await flush();
    assert.deepEqual(f.calls, []);
  } finally {
    await f.close();
  }
});

test('unverifiable Unicode, control, bidi, malformed text and oversized complete identity refuse inertly', async () => {
  for (const field of ['title', 'id'])
    for (const text of [
      'wide-\u754c',
      'combining-e\u0301',
      'emoji-\u{1f600}',
      'bidi-\u202e',
      'escape-\x1b[31m',
      'newline-\n',
      'tab-\t',
      'C1-\u009b',
      '\ud800',
      'X'.repeat(2000),
    ]) {
      const session = { id: exact, title: 'Safe title', [field]: text };
      const f = await fixture({ sessions: [session] });
      try {
        await select(f, 0);
        assert.deepEqual(
          f.confirms,
          [],
          `${field} must not be sanitized into a different confirmed identity`,
        );
        assert.deepEqual(f.calls, []);
        assert.ok(f.toasts.length > 1, 'actionable refusal notice missing');
      } finally {
        await f.close();
      }
    }
});

test('unknown or insufficient public geometry refuses rather than truncating', async () => {
  for (const [width, height] of [
    [79, 50],
    [100, 23],
    [NaN, 50],
    [100, undefined],
    [80, 24],
  ]) {
    const f = await fixture();
    f.renderer.width = width;
    f.renderer.height = height;
    try {
      await select(f);
      assert.deepEqual(f.confirms, []);
      assert.deepEqual(f.calls, []);
    } finally {
      await f.close();
    }
  }
});

test('resize, silent geometry change, replacement and Cleanup fence a late true confirmation', async () => {
  for (const invalidate of [
    (f) => f.renderer.emit('resize', 100, 50), // Even same-size event invalidates.
    (f) => {
      f.renderer.width++;
    },
    (f) => {
      f.open();
      f.picks.at(-1).resolve(undefined);
    },
    (f) => f.cleanup(),
  ]) {
    const f = await fixture();
    try {
      await select(f);
      confirmation(f);
      await invalidate(f);
      f.confirms[0].resolve(true);
      await flush();
      assert.deepEqual(f.calls, []);
      assert.equal(f.renderer.listenerCount('resize'), 0);
    } finally {
      await f.close();
    }
  }
});

test.after(() => {
  hook.deregister();
  delete globalThis.__pickerTEST;
});
