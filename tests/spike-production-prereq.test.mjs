// Intentional product RED until checkpoint 2 minimum commands exist. No live
// adapters, token, host, .env, secret-file read, or fixture fallback is allowed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

test('PRODUCT-PREREQ: public serve/status commands recognize missing prerequisites, not unknown commands', async () => {
  const root = resolve('tests/.artifacts');
  await mkdir(root, { recursive: true });
  const scratch = await mkdtemp(join(root, 'product-prereq-'));
  const state = join(scratch, 'state');
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const run = (command) => spawnSync(process.execPath,
    [resolve('bin/proceed-mcp.js'), command, '--state-dir', state], {
      env, cwd: scratch, encoding: 'utf8', timeout: 15000, maxBuffer: 65536, windowsHide: true,
    });
  try {
    const results = ['serve', 'status'].map((command) => {
      const result = run(command);
      assert.ifError(result.error);
      return { command, exit: result.status };
    });
    assert.deepEqual(results, [{ command: 'serve', exit: 3 }, { command: 'status', exit: 3 }],
      'RED: production commands must exist and report unavailable uninitialized state (design section 2)');
  } finally { await rm(scratch, { recursive: true, maxRetries: 3, retryDelay: 100 }); }
});
