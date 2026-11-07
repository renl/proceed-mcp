// TEST ONLY. Native interaction logic, not rendered UI, key-loader or wire proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('current interaction submits its captured Reject while replaced and cleaned continuations are inert', async () => {
  const calls = [];
  const presentation = {
    presentation_id: `hpr_${'a'.repeat(32)}`,
    request_id: `req_${'b'.repeat(32)}`,
    harness_id: 'qualification',
    owner_id: 'shared',
    session_id: 'current-session',
    session_label: 'Current session',
    action: 'Synthetic action',
    context: 'Native control',
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  // This substitution exists only in the test module loader. No application API
  // or private setup option is added, and no helper/process proof is inferred.
  globalThis.__sdetCurrentExchange = async (input) => {
    calls.push(input);
    return {
      status: 200,
      body:
        input.operation === 'pending'
          ? { schema_version: 1, presentation }
          : {
              schema_version: 1,
              request_id: presentation.request_id,
              accepted: true,
              resolution: 'rejected',
              decision_id: `dec_${'c'.repeat(32)}`,
              response_text: null,
            },
    };
  };
  const sources = new Map([
    [
      new URL('../src/harness/node-helper.js', import.meta.url).href,
      'export class HelperChannelError extends Error {} export const runHelperExchange = (input) => globalThis.__sdetCurrentExchange(input);',
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
  const dialogs = [],
    toasts = [],
    pending = [];
  let commands, cleanup;
  const root = fileURLToPath(new URL('../', import.meta.url));
  const context = {
    app: { version: '2.2.5' },
    options: {
      state_dir: join(root, '.scratch/current/state'),
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: join(root, '.scratch/current/not-created.token'),
    },
    keymap: {
      layer(factory) {
        commands = factory().commands;
      },
    },
    data: {
      session: {
        list: () => [{ id: 'current-session', title: 'Current session' }],
        get: () => ({ id: 'current-session' }),
      },
    },
    ui: {
      toast: {
        show(value) {
          toasts.push(value);
        },
      },
      dialog: {
        select(options) {
          return new Promise((resolve) => dialogs.push({ options, resolve }));
        },
        prompt(options) {
          return new Promise((resolve) => dialogs.push({ options, resolve }));
        },
      },
    },
  };
  const flush = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  try {
    const { harnessTuiDefinition } = await import('../src/harness/tui-plugin.js');
    cleanup = await harnessTuiDefinition.setup(context);
    assert.equal(typeof cleanup, 'function');
    const open = commands.find((c) => c.id === 'proceed.harness.open').run;
    const start = async () => {
      pending.push(open());
      dialogs.at(-1).resolve('current-session');
      await flush();
      assert.match(dialogs.at(-1).options.title, /Synthetic action/);
      return dialogs.at(-1);
    };
    const current = await start();
    current.resolve('reject');
    await Promise.all(pending);
    assert.deepEqual(
      calls.map((c) => c.operation),
      ['pending', 'decisions'],
    );
    assert.deepEqual(calls[1].body, {
      harness_id: 'qualification',
      owner_id: 'shared',
      session_id: 'current-session',
      request_id: presentation.request_id,
      presentation_id: presentation.presentation_id,
      choice: 'reject',
      response_text: null,
    });
    assert.equal(calls[1].presentationId, presentation.presentation_id);
    assert.ok(toasts.some((t) => t.message.includes('Proceed recorded rejected')));
    const old = await start();
    // A new command legitimately fences the prior question. Its late answer
    // cannot be submitted, while the successor picker is dismissed explicitly.
    pending.push(open());
    old.resolve('approve');
    dialogs.at(-1).resolve(undefined);
    await Promise.all(pending);
    assert.equal(calls.filter((c) => c.operation === 'decisions').length, 1);
    const response = await start();
    response.resolve('respond');
    await flush();
    assert.match(dialogs.at(-1).options.title, /Proceed response/);
    const oldPrompt = dialogs.at(-1);
    pending.push(open());
    oldPrompt.resolve('approved');
    dialogs.at(-1).resolve(undefined);
    await Promise.all(pending);
    assert.equal(calls.filter((c) => c.operation === 'decisions').length, 1);
    const disposed = await start();
    cleanup();
    disposed.resolve('reject');
    await Promise.all(pending);
    assert.equal(calls.filter((c) => c.operation === 'decisions').length, 1);
  } finally {
    cleanup?.();
    for (const dialog of dialogs) dialog.resolve(undefined);
    await Promise.allSettled(pending);
    hook.deregister();
    delete globalThis.__sdetCurrentExchange;
  }
});
