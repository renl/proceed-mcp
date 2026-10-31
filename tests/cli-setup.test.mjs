// Test-only public CLI consumer. Production must not import this file.
// Contract: active change design.md section 2; traceability: slices/01-setup.md.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import test from 'node:test';

test('SETUP-01: empty-state init and immutable safe origin configuration', async () => {
  assert.ok(process.env.PROCEED_TEST_COMMAND,
    'RED prerequisite: set PROCEED_TEST_COMMAND to JSON argv for the built public executable');
  const command = JSON.parse(process.env.PROCEED_TEST_COMMAND);
  assert.ok(Array.isArray(command) && command.length > 0
    && command.every((arg) => typeof arg === 'string' && arg.length > 0));
  const root = resolve('tests/.artifacts');
  await mkdir(root, { recursive: true });
  const run = await mkdtemp(join(root, 'setup-'));
  const state = join(run, 'state');
  const env = { ...process.env };
  delete env.PROCEED_STATE_DIR;
  delete env.PROCEED_TELEGRAM_BOT_TOKEN;
  const invoke = (...args) => {
    const child = spawnSync(command[0], [...command.slice(1), ...args, '--state-dir', state], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024,
      windowsHide: true, shell: false,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, 'CLI terminated without completing');
    // Do not dump stdout/stderr: setup diagnostics may contain local credentials.
    return child.status;
  };
  try {
    assert.equal(invoke('init'), 0, 'empty-state init succeeds on a protected filesystem');
    assert.notEqual(invoke('init'), 0, 'init must refuse overwrite');
    assert.equal(invoke('origin', 'add', 'host_a', '--url', 'http://127.0.0.1:4096',
      '--password-env', 'PROCEED_TEST_HOST_PASSWORD'), 0);
    assert.notEqual(invoke('origin', 'add', 'host_a', '--url', 'http://127.0.0.1:4097',
      '--password-env', 'PROCEED_TEST_HOST_PASSWORD'), 0, 'duplicate origin cannot replace binding');
    const urls = [
      'http://localhost:4096', 'http://192.0.2.1:4096', 'https://127.0.0.1:4096',
      'http://127.0.0.1', 'http://user:password@127.0.0.1:4096',
      'http://127.0.0.1:4096/api', 'http://127.0.0.1:4096/?x=1',
      'http://127.0.0.1:4096/#fragment',
    ];
    for (const [index, url] of urls.entries()) {
      assert.equal(invoke('origin', 'add', `invalid_${index}`, '--url', url,
        '--password-env', 'PROCEED_TEST_HOST_PASSWORD'), 2, `reject forbidden topology ${index}`);
    }
    for (const id of ['UPPER', 'has.dot', 'x'.repeat(65)]) {
      assert.equal(invoke('origin', 'add', id, '--url', 'http://127.0.0.1:4096',
        '--password-env', 'PROCEED_TEST_HOST_PASSWORD'), 2, 'reject invalid origin identifier');
    }
  } finally {
    await rm(run, { recursive: true, force: true });
    await assert.rejects(access(run), { code: 'ENOENT' }, 'run-owned state cleanup verified');
  }
});
