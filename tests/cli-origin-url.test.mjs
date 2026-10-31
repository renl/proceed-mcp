// Public CLI regressions for SETUP-URL-001; design.md section 2 is authoritative.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Compare protected contents without printing credential bytes or their hashes.
async function snapshot(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    result.push([entry.name, entry.isDirectory()
      ? await snapshot(path)
      : createHash('sha256').update(await readFile(path)).digest('hex')]);
  }
  return JSON.stringify(result);
}

test('SETUP-URL-001: literal loopback and explicit default port through public CLI', async (t) => {
  assert.ok(process.env.PROCEED_TEST_COMMAND,
    'Set PROCEED_TEST_COMMAND to JSON argv for the public executable');
  const command = JSON.parse(process.env.PROCEED_TEST_COMMAND);
  assert.ok(Array.isArray(command) && command.length > 0
    && command.every((arg) => typeof arg === 'string' && arg.length > 0));
  const root = resolve('tests/.artifacts');
  await mkdir(root, { recursive: true });
  const run = await mkdtemp(join(root, 'origin-url-'));
  const env = { ...process.env };
  delete env.PROCEED_STATE_DIR;
  delete env.PROCEED_TELEGRAM_BOT_TOKEN;
  const invoke = (state, ...args) => {
    const child = spawnSync(command[0], [...command.slice(1), ...args, '--state-dir', state], {
      env, encoding: 'utf8', timeout: 5000, maxBuffer: 128 * 1024,
      windowsHide: true, shell: false,
    });
    assert.ifError(child.error);
    assert.equal(child.signal, null, 'CLI must complete within its deadline');
    return child.status; // Never print captured credential-bearing diagnostics.
  };
  const add = (state, id, url) => invoke(state, 'origin', 'add', id, '--url', url,
    '--password-env', 'PROCEED_TEST_HOST_PASSWORD');
  try {
    for (const [index, url] of [
      'http://127.1:4096', 'http://2130706433:4096', 'http://0x7f000001:4096',
    ].entries()) {
      await t.test(`reject nonliteral host: ${url}`, async () => {
        const state = join(run, `alias-${index}`);
        assert.equal(invoke(state, 'init'), 0);
        const before = await snapshot(state);
        const status = add(state, 'host_a', url);
        const unchanged = before === await snapshot(state);
        assert.equal(status, 2, 'nonliteral host must not become a canonical binding');
        assert.ok(unchanged, 'rejection must preserve configuration and credential contents');
      });
    }
    await t.test('accept explicit http default port and preserve immutable binding', async () => {
      const state = join(run, 'default-port');
      assert.equal(invoke(state, 'init'), 0);
      assert.equal(add(state, 'host_a', 'http://127.0.0.1:80'), 0,
        'explicit port 80 is valid even though WHATWG URL removes it');
      const config = JSON.parse(await readFile(join(state, 'config.json'), 'utf8'));
      assert.deepEqual(config.origins.find((origin) => origin.origin_id === 'host_a'), {
        origin_id: 'host_a', url: 'http://127.0.0.1:80',
        password_env: 'PROCEED_TEST_HOST_PASSWORD',
      });
      const before = await snapshot(state);
      assert.equal(add(state, 'host_a', 'http://127.0.0.1:4097'), 2);
      assert.ok(before === await snapshot(state),
        'duplicate origin must preserve the explicit default-port binding and credentials');
    });
  } finally {
    await rm(run, { recursive: true, force: true });
    await assert.rejects(access(run), { code: 'ENOENT' }, 'run-owned state cleanup verified');
  }
});
