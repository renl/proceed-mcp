// TEST ONLY. Public CLI dispatch, not process, OS-protection or Telegram proof.
// Contract: openspec/changes/archive/2026-11-07-add-automatic-broker-startup/design.md sections 1/5.
// Delta: Automatic broker availability for normal MCP use, Required local
// authority or state protection is unavailable, and Setup or pairing is incomplete.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { run } from '../src/cli/main.js';

async function invoke(args, env = {}) {
  let stdout = '',
    stderr = '';
  const code = await run(args, {
    env,
    stdout: {
      write(value) {
        stdout += String(value);
      },
    },
    stderr: {
      write(value) {
        stderr += String(value);
      },
    },
  });
  return { code, stdout, stderr };
}

test('AUTO-CLI-HELP: public setup and stop entry points are reachable', async () => {
  const result = await invoke(['--help']);
  assert.equal(result.code, 0);
  for (const name of [
    'telegram provision',
    '--token-stdin',
    '--telegram-token-file',
    'proceed-mcp stop',
  ]) {
    assert.ok(result.stdout.includes(name), `help exposes ${name}`);
  }
});

test(
  'AUTO-CLI-PREREQ: new file option reaches missing-state refusal, not unknown-option refusal',
  { timeout: 5000 },
  async (t) => {
    const root = resolve('.scratch/automatic-startup-cli');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'run-'));
    const state = join(directory, 'absent-state');
    const file = join(directory, 'absent-credential');
    try {
      for (const args of [['pair'], ['mcp', '--owner', 'synthetic_owner'], ['serve']]) {
        await t.test(args[0], async () => {
          const result = await invoke([
            ...args,
            '--state-dir',
            state,
            '--telegram-token-file',
            file,
          ]);
          assert.equal(
            result.code,
            3,
            'missing initialized state is an unavailable prerequisite, not invalid syntax',
          );
          assert.equal(result.stdout, '', 'missing setup cannot report success or an approval');
          assert.ok(result.stderr.length > 0, 'actionable diagnostic required');
          assert.deepEqual(
            await readdir(directory),
            [],
            'refusal creates no state, credential or ownership artifact',
          );
        });
      }
    } finally {
      await rm(directory, { recursive: true });
      await assert.rejects(access(directory), { code: 'ENOENT' }, 'owned fixture cleanup verified');
    }
  },
);

test(
  'AUTO-CLI-STOP: inaccessible uninitialized state is a refusal, not already-stopped success',
  { timeout: 5000 },
  async () => {
    const root = resolve('.scratch/automatic-startup-cli');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(join(root, 'run-'));
    try {
      const result = await invoke(['stop', '--state-dir', join(directory, 'absent-state')]);
      assert.equal(
        result.code,
        3,
        'stop recognizes the command but refuses unavailable initialized authority',
      );
      assert.equal(result.stdout, '');
      assert.ok(result.stderr.length > 0);
      assert.deepEqual(await readdir(directory), [], 'stop never initializes or repairs state');
    } finally {
      await rm(directory, { recursive: true });
      await assert.rejects(access(directory), { code: 'ENOENT' });
    }
  },
);

test('AUTO-CLI-SECRET: ambiguous foreground credential sources fail without token disclosure', async () => {
  const marker = 'SYNTHETIC_NOT_A_TELEGRAM_CREDENTIAL';
  const result = await invoke(['serve', '--telegram-token-file', 'relative-invalid-file'], {
    PROCEED_TELEGRAM_BOT_TOKEN: marker,
  });
  assert.equal(result.code, 2);
  assert.ok(
    !(result.stdout + result.stderr).includes(marker),
    'private input absent from diagnostics',
  );
});
