// TEST ONLY: execute the unchanged production module body with in-memory OS/exec inputs.
// No real helper, native API, filesystem lifecycle or protection qualification.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import * as errors from '../src/errors.js';
import { helperEnvironment } from '../src/harness/node-helper.js';

const TOKEN = 'PROCEED_TELEGRAM_BOT_TOKEN';
const CANARY = 'SYNTHETIC_HELPER_AUTHORITY';

test('ACL exec sink excludes all token casing and PSModulePath without parent mutation', async () => {
  const target = resolve('synthetic-protected-file');
  const env = {
    [TOKEN]: CANARY,
    proceed_telegram_bot_token: CANARY,
    Proceed_Telegram_Bot_Token: CANARY,
    PSModulePath: 'synthetic-modules',
    UNIT_UNRELATED: 'retained',
  };
  const before = { ...env };
  const calls = [];
  const context = createContext({ process: { platform: 'win32', env } });
  const execFile = (...args) => {
    const callback = args.pop();
    calls.push(args);
    callback(null, { stdout: JSON.stringify([{ path: target, ok: true }]) });
  };
  const imports = {
    'node:child_process': { execFile },
    'node:fs/promises': Object.fromEntries(
      ['chmod', 'mkdir', 'stat'].map((name) => [
        name,
        () => {
          throw new Error('filesystem not authorized');
        },
      ]),
    ),
    'node:util': { promisify },
    '../errors.js': errors,
  };
  const source = await readFile(new URL('../src/state/protection.js', import.meta.url), 'utf8');
  const production = new SourceTextModule(source, { context });
  await production.link((specifier) => {
    assert.ok(
      Object.hasOwn(imports, specifier),
      'unexpected dependency requires test-owner review',
    );
    const values = imports[specifier];
    return new SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      },
      { context },
    );
  });
  await production.evaluate();
  await production.namespace.verifyOwnerOnly([target]);
  assert.equal(calls.length, 1);
  const [command, args, options] = calls[0];
  assert.equal(command, 'powershell.exe');
  assert.deepEqual(Array.from(args.slice(0, 3)), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.equal(options.env.PROCEED_ACL_TARGETS, target);
  assert.equal(options.env.PROCEED_ACL_MODE, 'verify');
  assert.equal(options.env.UNIT_UNRELATED, 'retained');
  assert.equal(options.env.PSModulePath, undefined);
  assert.ok(!Object.keys(options.env).some((key) => key.toUpperCase() === TOKEN));
  assert.ok(!JSON.stringify([command, args]).includes(CANARY));
  assert.deepEqual(env, before);
});

test('existing harness helper keeps its clean platform allowlist', () => {
  // Absolute fixtures use node:path so this assertion is independent of host OS.
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
