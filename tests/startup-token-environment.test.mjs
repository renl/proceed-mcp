// TEST ONLY: actual public CLI and detached spawn sink with memory-only dependencies.
// Contract: support-startup-token-environment design decisions 1-2 and delta.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { blockedPrerequisite, storageFailure } from '../src/errors.js';

const TOKEN = 'PROCEED_TELEGRAM_BOT_TOKEN';
const CANARY = 'SYNTHETIC_STARTUP_AUTHORITY';
const state = resolve('synthetic-state');
const selectedFile = resolve('synthetic-selected-token');
const defaultFile = resolve('synthetic-default-token');
const deadlineAt = 1234567890000;
let scenario;
const childProcess = await import('node:child_process');
mock.module('node:child_process', {
  namedExports: {
    ...childProcess,
    spawn(...args) {
      scenario.spawns.push(args);
      if (scenario.spawnFailure) throw new Error(`${CANARY}: raw spawn options`);
      const child = new EventEmitter();
      child.unref = () => scenario.unrefs++;
      return child;
    },
  },
});
const availability = await import('../src/broker/availability.js');
mock.module('../src/broker/availability.js', {
  namedExports: {
    ...availability,
    async awaitSecureAvailability({ launch }) {
      scenario.availability++;
      if (!scenario.reuse) await launch({ deadlineAt });
      return { instance: 'synthetic-instance' };
    },
  },
});
const store = await import('../src/state/store.js');
mock.module('../src/state/store.js', {
  namedExports: {
    ...store,
    loadPortableConfiguration: async () => ({
      broker: { port: 12345 },
      owners: [{ owner_id: 'unit_owner' }],
    }),
  },
});
const credentials = await import('../src/state/credentials.js');
mock.module('../src/state/credentials.js', {
  namedExports: { ...credentials, readLocalCredential: async () => 'synthetic-control' },
});
const ownerCredentials = await import('../src/state/owner-credentials.js');
mock.module('../src/state/owner-credentials.js', {
  namedExports: { ...ownerCredentials, readOwnerCredential: async () => 'synthetic-owner' },
});
const files = await import('../src/state/credential-file.js');
mock.module('../src/state/credential-file.js', {
  namedExports: {
    ...files,
    defaultCredentialFile() {
      scenario.defaultSelections++;
      return defaultFile;
    },
    loadCredentialFile() {
      scenario.fileReads++;
      if (scenario.fileFailure) throw scenario.fileFailure;
      throw new Error('adapter must not load token files');
    },
  },
});
mock.module('../src/broker/portable-runtime.js', {
  namedExports: {
    startPortableRuntime: () => {
      throw new Error('runtime not authorized in unit tests');
    },
  },
});
const local = await import('../src/http/local-client.js');
mock.module('../src/http/local-client.js', {
  namedExports: {
    ...local,
    createSecureLocalClient: () => ({ request: async () => ({ status: 200 }) }),
    secureExchange: async () => ({
      status: 201,
      body: { code: 'a'.repeat(32), expires_at: '2026-11-10T12:00:00.000Z' },
    }),
  },
});
// The server/executor are memory sinks. The real CLI gate still observes launch failures.
mock.module('../src/mcp/execution.js', {
  namedExports: {
    createToolExecutor: ({ client }) => ({
      execute: () => client.request({}),
      close: async () => {},
    }),
  },
});
mock.module('../src/mcp/registration.js', {
  namedExports: { createRegistrationBinding: () => ({}) },
});
mock.module('../src/mcp/server.js', {
  namedExports: {
    async runMcpServer({ execute }) {
      try {
        await execute();
      } catch (error) {
        scenario.toolFailure = { localCode: error.code, ...startupToolFailure(error) };
      }
    },
  },
});
const { startupToolFailure } = await import('../src/broker/startup-failure.js');
const { run } = await import('../src/cli/main.js');

async function invoke(command, env = {}, options = [], settings = {}) {
  scenario = {
    spawns: [],
    unrefs: 0,
    availability: 0,
    defaultSelections: 0,
    fileReads: 0,
    ...settings,
  };
  const before = { ...env };
  let stdout = '',
    stderr = '';
  // Swap only the JS environment reference for this unit. Never inspect or copy
  // the user's environment. Restore it even when the production call fails.
  const originalEnvironment = process.env;
  const originalArgv = process.argv;
  const ambient = { UNIT_AMBIENT: 'not-command-input', [TOKEN]: 'SYNTHETIC_AMBIENT_AUTHORITY' };
  process.env = ambient;
  process.argv = [process.execPath, resolve('bin/proceed-mcp.js')];
  let code;
  try {
    code = await run(
      [
        command,
        ...(command === 'mcp' ? ['--owner', 'unit_owner'] : []),
        '--state-dir',
        state,
        ...options,
      ],
      {
        env,
        stdout: {
          write: (value) => {
            stdout += value;
          },
        },
        stderr: {
          write: (value) => {
            stderr += value;
          },
        },
      },
    );
    assert.deepEqual(ambient, {
      UNIT_AMBIENT: 'not-command-input',
      [TOKEN]: 'SYNTHETIC_AMBIENT_AUTHORITY',
    });
  } finally {
    process.env = originalEnvironment;
    process.argv = originalArgv;
  }
  assert.deepEqual(env, before, 'command environment must not be mutated');
  if (command !== 'serve')
    assert.equal(scenario.fileReads, 0, 'adapter never loads token file contents');
  assert.ok(!`${stdout}${stderr}`.includes(CANARY), 'output contains no synthetic authority');
  return { ...scenario, code, stdout, stderr };
}

function assertSpawn(result, mode, envToken) {
  assert.equal(result.spawns.length, 1);
  const [executable, args, options] = result.spawns[0];
  assert.equal(executable, process.execPath);
  assert.equal(args[0], resolve('bin/proceed-mcp.js'));
  assert.deepEqual(
    args.slice(1),
    mode === 'environment'
      ? ['serve', '--secure-local', '--state-dir', state]
      : ['serve', '--telegram-token-file', mode, '--state-dir', state],
  );
  assert.ok(!args.join(' ').includes(CANARY));
  assert.equal(options.shell, false);
  assert.equal(options.detached, true);
  assert.equal(options.stdio, 'ignore');
  assert.equal(resolve(options.cwd), resolve('.'));
  assert.equal(options.env.PROCEED_STARTUP_DEADLINE_AT, String(deadlineAt));
  assert.equal(options.env[TOKEN], envToken);
  assert.equal(
    options.env.UNIT_AMBIENT,
    undefined,
    'do not replace injected command environment with ambient input',
  );
  assert.equal(result.unrefs, 1);
  return options.env;
}

for (const command of ['mcp', 'pair']) {
  test(`${command}: explicit file takes precedence even over invalid environment`, async () => {
    const result = await invoke(command, { [TOKEN]: `${CANARY}\n` }, [
      '--telegram-token-file',
      selectedFile,
    ]);
    assert.equal(result.code, 0);
    assertSpawn(result, selectedFile, undefined);
    assert.equal(result.defaultSelections, 0);
  });

  test(`${command}: command environment reaches actual broker spawn unchanged`, async (t) => {
    for (const [index, token] of [CANARY, '!', '~'.repeat(4096)].entries()) {
      await t.test(`accepted input ${index}`, async () => {
        const result = await invoke(command, { [TOKEN]: token, UNIT_UNRELATED: 'retained' });
        assert.equal(result.code, 0);
        const child = assertSpawn(result, 'environment', token);
        assert.equal(child.UNIT_UNRELATED, 'retained');
        assert.equal(
          result.defaultSelections,
          0,
          'environment selection must not inspect default file',
        );
      });
    }
  });

  test(`${command}: absent and exactly empty environment retain default-file mode`, async () => {
    for (const env of [{}, { [TOKEN]: '' }]) {
      const result = await invoke(command, env);
      assert.equal(result.code, 0);
      assertSpawn(result, defaultFile, undefined);
    }
  });

  test(`${command}: invalid selected environment refuses without fallback or disclosure`, async (t) => {
    const invalid = [
      ' ',
      `${CANARY} x`,
      `${CANARY}\n`,
      `${CANARY}\r\n`,
      `${CANARY}\0`,
      '\t',
      '\u007f',
      '\u00e9',
      'x'.repeat(4097),
      42,
      null,
    ];
    for (const [index, value] of invalid.entries()) {
      await t.test(`invalid input ${index}`, async () => {
        const result = await invoke(command, { [TOKEN]: value });
        assert.equal(result.spawns.length, 0, 'invalid source cannot launch or fallback');
        assert.equal(result.defaultSelections, 0);
        if (command === 'pair') {
          assert.equal(result.code, 3);
          assert.match(result.stderr, /PROCEED_TELEGRAM_BOT_TOKEN/);
        } else {
          assert.equal(result.toolFailure?.localCode, 'TELEGRAM_CREDENTIAL_UNAVAILABLE');
          assert.equal(result.toolFailure?.code, 'BROKER_UNAVAILABLE');
          assert.match(result.toolFailure.message, /PROCEED_TELEGRAM_BOT_TOKEN/);
        }
      });
    }
  });

  test(`${command}: healthy reuse needs no source validation/default lookup/launch`, async () => {
    const result = await invoke(command, { [TOKEN]: `${CANARY}\n` }, [], { reuse: true });
    assert.equal(result.code, 0);
    assert.equal(result.spawns.length, 0);
    assert.equal(result.defaultSelections, 0);
  });

  test(`${command}: selected-file launch failure is safe and does not fall back`, async () => {
    const result = await invoke(
      command,
      { [TOKEN]: CANARY },
      ['--telegram-token-file', selectedFile],
      { spawnFailure: true },
    );
    assert.equal(result.spawns.length, 1);
    assert.equal(result.defaultSelections, 0);
    if (command === 'pair') assert.equal(result.code, 3);
    else {
      assert.equal(result.toolFailure?.code, 'BROKER_UNAVAILABLE');
      assert.ok(!result.toolFailure.message.includes(CANARY));
    }
  });
}

test('file-mode spawn strips Windows token casing without changing caller environment', () => {
  scenario = { spawns: [], unrefs: 0 };
  const environment = {
    [TOKEN]: CANARY,
    proceed_telegram_bot_token: CANARY,
    Proceed_Telegram_Bot_Token: CANARY,
    UNIT_UNRELATED: 'retained',
  };
  const before = { ...environment };
  availability.spawnDetachedBroker({
    executable: resolve('bin/proceed-mcp.js'),
    args: ['serve', '--telegram-token-file', selectedFile],
    cwd: resolve('.'),
    environment,
  });
  assert.deepEqual(environment, before);
  const child = scenario.spawns[0][2].env;
  assert.equal(child.UNIT_UNRELATED, 'retained');
  assert.equal(child[TOKEN], undefined);
  if (process.platform === 'win32') {
    assert.ok(!Object.keys(child).some((key) => key.toUpperCase() === TOKEN));
  }
});

test('fixed MCP credential guidance ignores arbitrary exception text', () => {
  const result = startupToolFailure({
    code: 'TELEGRAM_CREDENTIAL_UNAVAILABLE',
    message: CANARY,
    options: { env: { [TOKEN]: CANARY } },
  });
  assert.equal(result.code, 'BROKER_UNAVAILABLE');
  assert.match(result.message, /PROCEED_TELEGRAM_BOT_TOKEN/);
  assert.match(result.message, /file/i);
  assert.ok(!JSON.stringify(result).includes(CANARY));
});

test('foreground explicit file plus environment remains an invalid source conflict', async () => {
  const result = await invoke('serve', { [TOKEN]: CANARY }, [
    '--secure-local',
    '--telegram-token-file',
    selectedFile,
  ]);
  assert.equal(result.code, 2);
  assert.equal(result.spawns.length, 0);
});

test('broker-only selected-file failures retain classification and never try another source', async () => {
  for (const [fileFailure, exitCode] of [
    [blockedPrerequisite('selected credential unavailable', 'TELEGRAM_CREDENTIAL_UNAVAILABLE'), 3],
    [storageFailure('selected credential protection unverified', 'PROTECTION_UNVERIFIED'), 4],
  ]) {
    const result = await invoke('serve', {}, ['--telegram-token-file', selectedFile], {
      fileFailure,
    });
    assert.equal(result.code, exitCode);
    assert.equal(result.fileReads, 1);
    assert.equal(result.defaultSelections, 0);
    assert.equal(result.spawns.length, 0);
    assert.equal(result.stdout, '');
  }
});
