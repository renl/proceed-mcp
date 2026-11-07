// TEST ONLY. Public command with fake host UI and helper. Not rendered-host proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const exact = 'ses_' + 'a'.repeat(26);
const other = 'ses_' + 'b'.repeat(26);
const title = 'Composition empty exchange';
const mediumRow = (option) => option.title.slice(0, 48);
const calls = [];
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
        `export class HelperChannelError extends Error {} export async function runHelperExchange(input) { globalThis.__pickerTEST.push(input.body); return {status:200,body:{schema_version:1,presentation:null}}; }`,
      );
    return next(url, context);
  },
});
globalThis.__pickerTEST = calls;
const { harnessTuiDefinition } = await import('../src/harness/tui-plugin.js');

async function picker({ select, resolvable = true }) {
  let commands;
  const queried = [];
  const root = fileURLToPath(new URL('../', import.meta.url));
  const cleanup = await harnessTuiDefinition.setup({
    app: { version: '2.2.5' },
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
        list: () => [
          { id: exact, title },
          { id: other, title },
        ],
        get: (id) => {
          queried.push(id);
          return resolvable ? { id } : undefined;
        },
        sync: async () => {},
      },
    },
    ui: { toast: { show() {} }, dialog: { select } },
  });
  try {
    await commands.find((c) => c.id === 'proceed.harness.open').run();
  } finally {
    await cleanup();
  }
  return queried;
}

test('NH-PICKER-VISIBILITY-001 long equal titles must not hide exact IDs in supported medium row', async () => {
  let observed;
  await picker({
    select: async (options) => {
      observed = options;
      return undefined;
    },
  });
  assert.equal(observed.options.length, 2);
  for (const option of observed.options) {
    // Generous upper bound: medium 60 minus the documented row/title padding.
    // No generic Unicode/layout emulator. ASCII control only, source proxy.
    const visible = mediumRow(option);
    assert.ok(
      visible.includes(option.value),
      'complete exact session ID is hidden by medium-row clipping',
    );
  }
});

test('bounded ASCII visibility proxy accepts complete identity and refuses clipped or near-match identity', () => {
  const visible = mediumRow({ title: `Short (${exact})` });
  assert.equal(visible.includes(exact), true);
  for (const value of [other, exact + 'x']) assert.equal(visible.includes(value), false);
  const clipped = mediumRow({ title: `${title} (${exact})` });
  assert.equal(clipped.includes(exact), false);
  // This is a text-width comparator, not evidence of a current dialog or selection.
});

test('current selected option value, not equal title/foreground, binds lookup after simulated Enter', async () => {
  calls.length = 0;
  const queried = await picker({ select: async (options) => options.options[1].value });
  assert.deepEqual(queried, [other, other]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].session_id, other);
});

test('dismissal and unresolvable exact selection never query pending work', async () => {
  for (const config of [
    { select: async () => undefined },
    { select: async () => exact, resolvable: false },
  ]) {
    calls.length = 0;
    await picker(config);
    assert.equal(calls.length, 0);
  }
});

test.after(() => {
  hook.deregister();
  delete globalThis.__pickerTEST;
});
