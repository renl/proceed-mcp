// TEST ONLY: pure helper environment decisions. ACL query environment coverage
// now lives in windows-storage-node-unit.test.mjs against the metadata contract.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { helperEnvironment } from '../src/harness/node-helper.js';

const TOKEN = 'PROCEED_TELEGRAM_BOT_TOKEN';
const CANARY = 'SYNTHETIC_HELPER_AUTHORITY';

test('existing harness helper keeps its clean platform allowlist', () => {
  const env = {
    [TOKEN]: CANARY,
    proceed_telegram_bot_token: CANARY,
    SystemRoot: resolve('synthetic-system'),
    WINDIR: resolve('synthetic-windows'),
    PATH: CANARY,
    NODE_OPTIONS: CANARY,
    NODE_PATH: CANARY,
    HTTPS_PROXY: CANARY,
    OPENAI_API_KEY: CANARY,
    UNIT_OTHER: CANARY,
  };
  const before = { ...env };
  assert.deepEqual(helperEnvironment('linux', env), {});
  assert.deepEqual(helperEnvironment('darwin', env), {});
  assert.deepEqual(helperEnvironment('win32', env), {
    SystemRoot: env.SystemRoot,
    WINDIR: env.WINDIR,
  });
  for (const value of ['', 'relative', 'bad\nroot', 'bad\0root']) {
    assert.deepEqual(
      helperEnvironment('win32', { SystemRoot: value, WINDIR: value, [TOKEN]: CANARY }),
      {},
    );
  }
  assert.deepEqual(env, before);
});
