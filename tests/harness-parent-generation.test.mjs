// TEST ONLY. Design sections 1-2, replacement fences late picker completion.
// Native product-generation control, NOT a rendered host or real-child proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syntheticOperator } from './support/harness-helper-vectors.mjs';

test('replacement fences an already settled old picker before it can start the actual parent', async () => {
  // Stub configuration/key prerequisites only. No key file is created, no ACL or
  // key-loader proof is claimed. Production TUI definition, selection logic and
  // runHelperExchange remain the unchanged imported application modules.
  const configURL = new URL('../src/state/store.js', import.meta.url).href;
  const keyURL = new URL('../src/harness/operator-key.js', import.meta.url).href;
  const hook = registerHooks({
    load(url, context, next) {
      if (url === configURL)
        return {
          format: 'module',
          shortCircuit: true,
          source: `export async function loadPortableConfiguration() {
            return {owners:[{owner_id:'shared'}],broker:{port:1}};
          }`,
        };
      if (url === keyURL)
        return {
          format: 'module',
          shortCircuit: true,
          source: `export function validateOperatorKeyFileOption() {}
            export async function loadOperatorKeyFile() {
              return {keyId:'${'a'.repeat(64)}',credential:'${syntheticOperator}'};
            }`,
        };
      return next(url, context);
    },
  });
  const original = childProcess.spawn;
  let attempts = 0;
  childProcess.spawn = () => {
    attempts++;
    throw new Error('fenced picker must not start a helper');
  };
  syncBuiltinESMExports();
  const pickers = [];
  let commands;
  let cleanup;
  const pending = [];
  const root = fileURLToPath(new URL('../', import.meta.url));
  const context = {
    app: { version: '2.2.5' },
    options: {
      state_dir: join(root, '.scratch/harness-parent-generation/state'),
      harness_id: 'qualification',
      owner_id: 'shared',
      operator_key_file: join(root, '.scratch/harness-parent-generation/not-created.token'),
    },
    keymap: {
      layer(factory) {
        commands = factory().commands;
      },
    },
    data: {
      session: {
        list: () => [{ id: 'replacement-session', title: 'Replacement session' }],
        get: () => ({ id: 'replacement-session' }),
      },
    },
    ui: {
      toast: { show() {} },
      dialog: {
        select: () => new Promise((resolve) => pickers.push(resolve)),
      },
    },
  };
  const priorPath = process.env.PATH;
  try {
    process.env.PATH = dirname(process.execPath);
    const { harnessTuiDefinition } = await import('../src/harness/tui-plugin.js');
    cleanup = await harnessTuiDefinition.setup(context);
    assert.equal(typeof cleanup, 'function', 'real product generation must be active');
    const open = commands.find((command) => command.id === 'proceed.harness.open').run;
    pending.push(open());
    assert.equal(pickers.length, 1);
    // Genuine dialog replacement resolves an old picker. Its result may already
    // be queued when the replacement command runs. It cannot authorize a query.
    pickers[0]('replacement-session');
    pending.push(open());
    assert.equal(pickers.length, 2);
    pickers[1](undefined);
    await Promise.all(pending);
    assert.equal(attempts, 0, 'replaced interaction must not start the parent/helper');
  } finally {
    for (const resolve of pickers) resolve(undefined);
    cleanup?.();
    await Promise.allSettled(pending);
    if (priorPath === undefined) delete process.env.PATH;
    else process.env.PATH = priorPath;
    childProcess.spawn = original;
    syncBuiltinESMExports();
    hook.deregister();
  }
});
