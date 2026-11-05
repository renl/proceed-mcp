// TEST ONLY. No live launcher or production dependency. See checkpoint 2 slice.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export async function bounded(action, ms, label) {
  let timer;
  try {
    return await Promise.race([
      action(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms); }),
    ]);
  } finally { clearTimeout(timer); }
}

export async function managed(work, { totalMs = 5000, readyMs = 2000 } = {}) {
  const root = resolve('tests/.artifacts');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'spike-'));
  const resources = [];
  const controller = new AbortController();
  let closing = false;
  let assertionError;
  let cleanupError;
  const context = {
    directory, signal: controller.signal, resources,
    async start(argv) {
      assert.equal(closing, false, 'no process may start after teardown begins');
      // Allowlist environment: never inherit application credentials or .env.
      const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
        .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
      const child = spawn(argv[0], argv.slice(1), {
        cwd: directory, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });
      const resource = { child, pid: child.pid, events: [], knownPids: [], outputBytes: 0 };
      resources.push(resource);
      child.on('close', () => { resource.closed = true; });
      child.on('error', () => { resource.failed = true; });
      child.on('message', (event) => {
        if (resource.events.length < 100) resource.events.push(event);
        if (event.descendant) resource.knownPids.push(event.descendant);
      });
      // Count, never retain raw output (could contain secrets/private text).
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
        resource.outputBytes += chunk.length;
        if (resource.outputBytes > 65536) { resource.failed = true; child.kill(); }
      });
      resource.wait = (kind) => bounded(async () => {
        while (!resource.events.some((event) => event.kind === kind)) {
          controller.signal.throwIfAborted();
          assert.ok(!resource.failed && child.exitCode === null && child.signalCode === null,
            'owned process exited or exceeded output limit');
          await delay(10, undefined, { signal: controller.signal });
        }
        return resource.events.find((event) => event.kind === kind);
      }, readyMs, `deadline waiting for ${kind}`);
      await resource.wait('ready');
      return resource;
    },
  };
  try { await bounded(() => work(context), totalMs, 'total deadline'); }
  catch (error) { assertionError = error; }
  finally {
    closing = true;
    controller.abort();
    try {
      for (const resource of resources.reverse()) {
        const { child, pid, knownPids } = resource;
        if (pid && process.platform === 'win32') {
          // Known descendants remain owned even when their parent exited first.
          for (const target of [pid, ...knownPids.slice().reverse()]) {
            if (!alive(target)) continue;
            const result = spawnSync('taskkill.exe', ['/PID', String(target), '/T', '/F'], {
              timeout: 3000, maxBuffer: 65536, windowsHide: true, encoding: 'utf8',
            });
            assert.ifError(result.error);
            // A child exiting can cause its supervising root to exit between
            // the liveness probe and taskkill. Absence, not taskkill's race-prone
            // status alone, is the cleanup assertion below.
            assert.ok(result.status === 0 || !alive(target), 'owned process-tree termination failed');
          }
        } else if (pid && process.platform !== 'win32') {
          try { process.kill(-pid, 'SIGKILL'); }
          catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
        await bounded(async () => {
          while (!resource.closed || [pid, ...knownPids].filter(Boolean).some(alive)) await delay(10);
        }, 3000, 'cleanup could not verify process absence');
        child.stdin.destroy();
      }
      // Windows can release the terminated process's cwd handle slightly after
      // process absence. The filesystem retry budget is finite (<=600ms).
      await rm(directory, { recursive: true, maxRetries: 3, retryDelay: 100 });
      await assert.rejects(access(directory), { code: 'ENOENT' });
    } catch (error) { cleanupError = error; }
  }
  return { assertionError, cleanupError, directory, resources };
}
