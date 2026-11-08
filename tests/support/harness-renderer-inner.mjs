// TEST ONLY. Exactly one synthetic dialog in the existing isolated host image.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, access, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as delay } from 'node:timers/promises';
import {
  isolatedLinuxEnvironment,
  linuxScriptArguments,
  stageLinuxFixture,
} from './harness-linux-plan.mjs';
import { emittedLabels, rendererScan, digest } from './harness-renderer-observation.mjs';

const started = Date.now(),
  executionEnd = started + 210000,
  end = started + 240000;
const root = '/run/proceed/state',
  evidence = '/run/proceed/evidence';
const env = isolatedLinuxEnvironment(root);
const canaries = [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')];
let phase = 'policy',
  failure = 'NONE',
  scanReason = 'UNRUN',
  overflow = false;
let raw = '',
  child,
  exited = false,
  closed = false,
  ioFailure = false;
let cleanup = false,
  hostExit = false,
  runtime = { host: 'UNKNOWN', bun: 'UNKNOWN' };
let hostPid;
const counts = { ctrlG: 0, arrowDown: 0, observe: 0, escape: 0, enter: 0 };
const samples = {};
const rawBuffers = [],
  decoder = new StringDecoder('utf8');
let rawBytes = 0;
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const events = async () =>
  (await readFile(join(evidence, 'fixture.jsonl'), 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
const progress = async (value) => {
  phase = value;
  await appendFile(
    join(evidence, 'progress.jsonl'),
    JSON.stringify({ phase, elapsed: Date.now() - started }) + '\n',
  );
};
async function wait(predicate, budget = 15000, teardown = false) {
  const deadline = Math.min(teardown ? end : executionEnd, Date.now() + budget);
  while (Date.now() < deadline) {
    if (overflow || ioFailure) throw new Error('CAPTURE_OR_IO');
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error('PHASE_DEADLINE');
}
function key(name, value) {
  assert.ok(child && !exited);
  counts[name]++;
  child.stdin.write(value);
}
async function files(directory) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), 'SYMLINK_CAPTURE');
    if (entry.isDirectory()) list.push(...(await files(path)));
    else if (entry.isFile()) list.push(path);
  }
  return list;
}
await mkdir(evidence, { recursive: true });
try {
  await wait(() => exists('/run/proceed-authorized'));
  assert.equal(await exists('/etc/opencode'), false);
  for (const parent of ['/', '/run', '/run/proceed'])
    for (const name of ['.opencode', 'opencode.json', 'opencode.jsonc'])
      assert.equal(await exists(join(parent, name)), false);
  assert.equal(await exists(root), false);
  for (const path of new Set([
    root,
    ...Object.entries(env)
      .filter(([k]) => /HOME|TMP|TEMP|CONFIG_DIR/.test(k))
      .map(([, v]) => v),
    ...['home', 'data', 'config', 'cache', 'state', 'service-config', 'tmp', 'work'].map((v) =>
      join(root, v),
    ),
  ]))
    await mkdir(path, { recursive: true });
  assert.ok(
    Object.values(networkInterfaces())
      .flat()
      .every((v) => v.internal),
  );
  assert.equal((await readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
  await stageLinuxFixture(env, evidence, '/payload/tests/fixtures/harness-renderer/tui.ts');
  runtime.host = execFileSync('/usr/local/bin/opencode', ['--version'], {
    env,
    cwd: join(root, 'work'),
    timeout: 5000,
    encoding: 'utf8',
  }).trim();
  assert.match(runtime.host, /(?:opencode v)?2\.2\.5$/);
  await writeFile(
    join(evidence, 'binding.json'),
    JSON.stringify({
      sourceRevision: '9bbb8ce18c80f099e0e448775f59d965ead40a21',
      hostBinary: digest(await readFile('/usr/local/bin/opencode')),
      env,
      TERM: env.TERM,
      COLORTERM: env.COLORTERM ?? 'ABSENT',
      geometry: { rows: 40, columns: 120, source: 'runner stty rows 40 cols 120' },
      configuredTheme: 'default opencode',
      configuredMode: 'automatic, terminal background query black',
      newDesigns: 'default false, no experimental override',
      controlCanaryHashes: canaries.map(digest),
      authority: 'NONE',
      requests: 0,
      decisions: 0,
    }),
  );
  await progress('ready');
  child = spawn('/usr/bin/script', linuxScriptArguments(join(root, 'pty.raw')), {
    env,
    cwd: join(root, 'work'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('exit', () => {
    exited = true;
  });
  child.on('close', () => {
    closed = true;
  });
  child.on('error', () => {
    ioFailure = true;
  });
  child.stdin.on('error', () => {
    if (!exited) ioFailure = true;
  });
  let tail = '';
  child.stdout.on('data', (buffer) => {
    if (rawBytes + buffer.length > 1048576) {
      overflow = true;
      return;
    }
    rawBuffers.push(buffer);
    rawBytes += buffer.length;
    const chunk = decoder.write(buffer);
    raw += chunk;
    const input = tail + chunk;
    const replies = [
      [/\x1b\[6n/g, '\x1b[1;1R'],
      [/\x1b\[\?u/g, '\x1b[?0u'],
      [/\x1b\[c/g, '\x1b[?1;2c'],
      [/\x1b\[>c/g, '\x1b[>0;0;0c'],
      [/\x1b\]10;\?(?:\x07|\x1b\\)/g, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
      [/\x1b\]11;\?(?:\x07|\x1b\\)/g, '\x1b]11;rgb:0000/0000/0000\x1b\\'],
    ];
    let consumed = 0;
    for (const [pattern, reply] of replies)
      for (const match of input.matchAll(pattern)) {
        if (!exited) child.stdin.write(reply);
        consumed = Math.max(consumed, match.index + match[0].length);
      }
    const pending = input.slice(consumed),
      last = pending.lastIndexOf('\x1b');
    tail = last >= 0 && pending.length - last < 32 ? pending.slice(last) : '';
  });
  child.stderr.on('data', (b) => {
    if (rawBytes + b.length > 1048576) overflow = true;
    else {
      rawBuffers.push(b);
      rawBytes += b.length;
      raw += decoder.write(b);
    }
  });
  await wait(
    async () =>
      (await events()).some((e) => e.phase === 'setup') && raw.includes('SYNTHETIC renderer ready'),
    60000,
  );
  const setup = (await events()).find((e) => e.phase === 'setup');
  hostPid = Number.isSafeInteger(setup.pid) && setup.pid > 1 ? setup.pid : undefined;
  runtime.bun = /^\d+\.\d+\.\d+$/.test(setup.bun ?? '') ? setup.bun : 'UNKNOWN';
  assert.equal(setup.themeMode, 'dark');
  await progress('initial');
  key('ctrlG', '\x07');
  await wait(
    () =>
      Object.keys(emittedLabels(raw).labels).length === 2 &&
      raw.lastIndexOf('\x1b[?2026l') >
        Math.max(raw.lastIndexOf('1 SYNTHETIC ALPHA'), raw.lastIndexOf('2 SYNTHETIC BETA')),
  );
  key('observe', '\x19');
  await wait(async () => (await events()).filter((e) => e.phase === 'cursor').length === 1);
  assert.equal((await events()).find((e) => e.phase === 'cursor').value, 'alpha');
  samples.initial = { byteEnd: Buffer.byteLength(raw), emission: emittedLabels(raw) };
  await progress('moved');
  const boundary = raw.length;
  key('arrowDown', '\x1b[B');
  await wait(
    () =>
      raw.length > boundary &&
      raw.slice(boundary).includes('SYNTHETIC') &&
      raw.lastIndexOf('\x1b[?2026l') > boundary,
  );
  key('observe', '\x19');
  await wait(async () => (await events()).filter((e) => e.phase === 'cursor').length === 2);
  assert.equal((await events()).filter((e) => e.phase === 'cursor')[1].value, 'beta');
  samples.moved = {
    byteEnd: Buffer.byteLength(raw),
    emission: emittedLabels(raw),
    changedEmission: emittedLabels(raw.slice(boundary)),
  };
  const before = samples.initial.emission.labels,
    after = samples.moved.emission.labels;
  for (const label of Object.keys(before)) {
    assert.equal(before[label].supported, true);
    assert.equal(after[label].supported, true);
    assert.notDeepEqual(before[label].bg, after[label].bg);
  }
  assert.equal(before['1 SYNTHETIC ALPHA'].bold, true);
  assert.equal(after['2 SYNTHETIC BETA'].bold, true);
  assert.equal(before['2 SYNTHETIC BETA'].bold, false);
  assert.equal(after['1 SYNTHETIC ALPHA'].bold, false);
  for (const attribute of ['fg', 'bg']) {
    assert.deepEqual(before['1 SYNTHETIC ALPHA'][attribute], after['2 SYNTHETIC BETA'][attribute]);
    assert.deepEqual(before['2 SYNTHETIC BETA'][attribute], after['1 SYNTHETIC ALPHA'][attribute]);
  }
  await progress('dismissed');
  key('escape', '\x1b');
  await wait(async () => (await events()).some((e) => e.phase === 'dismissed'));
  assert.equal(
    (await events()).some((e) => e.phase === 'fixture-choice'),
    false,
  );
  // Read the isolated database without introducing sessions, credentials or work.
  let credentialTables = 0;
  for (const path of (await files(env.XDG_DATA_HOME)).filter((p) => p.endsWith('.db'))) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credential'").get()
      ) {
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM credential').get().count, 0);
        credentialTables++;
      }
    } finally {
      db.close();
    }
  }
  assert.ok(credentialTables > 0);
} catch (error) {
  failure =
    error.message === 'PHASE_DEADLINE'
      ? 'PHASE_DEADLINE'
      : overflow
        ? 'CAPTURE_LIMIT'
        : 'CONTROL_OR_IO';
} finally {
  const failedPhase = phase;
  await progress('cleanup');
  const setupAtCleanup = (await events().catch(() => [])).find((e) => e.phase === 'setup');
  if (setupAtCleanup) {
    hostPid ??=
      Number.isSafeInteger(setupAtCleanup.pid) && setupAtCleanup.pid > 1
        ? setupAtCleanup.pid
        : undefined;
    runtime.bun = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(setupAtCleanup.bun ?? '')
      ? setupAtCleanup.bun
      : 'UNKNOWN';
  }
  if (child && !exited && counts.ctrlG === 1 && counts.escape === 0) {
    try {
      key('escape', '\x1b');
      await wait(async () => (await events()).some((e) => e.phase === 'dismissed'), 2000, true);
    } catch {
      /* one dismiss attempt only, never navigation retry */
    }
  }
  try {
    if (child && !exited) child.stdin.write('\x03');
    await wait(
      async () => !child || (await events()).some((e) => e.phase === 'cleanup'),
      10000,
      true,
    );
    cleanup = !!child && (await events()).some((e) => e.phase === 'cleanup');
  } catch {
    /* cleanup remains independent and unproven */
  }
  // Observe the actual compiled host PID, not only the script wrapper exit.
  if (hostPid && (await exists(`/proc/${hostPid}`))) {
    try {
      assert.equal(
        digest(await readFile(`/proc/${hostPid}/exe`)),
        digest(await readFile('/usr/local/bin/opencode')),
      );
      process.kill(hostPid, 'SIGTERM');
      await wait(async () => !(await exists(`/proc/${hostPid}`)), 2000, true);
    } catch {
      /* exact container finally owns any remaining descendants */
    }
  }
  if (child && !closed) {
    child.stdin.end();
    try {
      await wait(() => closed, 2000, true);
    } catch {
      child.kill('SIGTERM');
    }
    try {
      await wait(() => closed, 2000, true);
    } catch {
      child.kill('SIGKILL');
    }
    try {
      await wait(() => closed, 2000, true);
    } catch {
      /* container finally owns descendants */
    }
  }
  hostExit = exited && closed && !!hostPid && !(await exists(`/proc/${hostPid}`));
  cleanup = (await events().catch(() => [])).some((e) => e.phase === 'cleanup');
  if (child) for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
  if (!cleanup || !hostExit) failure = failure === 'NONE' ? 'CLEANUP_FAILED' : failure;
  try {
    // Freeze every run-owned state/evidence byte after host close, before export.
    assert.ok(hostExit, 'INCOMPLETE');
    await writeFile(join(evidence, 'transcript.ansi'), Buffer.concat(rawBuffers));
    await writeFile(
      join(evidence, 'observations.json'),
      JSON.stringify({
        samples,
        counts,
        runtime,
        cleanup,
        hostExit,
        cellWidths: 'UNKNOWN',
        productProfile: null,
      }),
    );
    const statePaths = await files(root),
      evidencePaths = await files(evidence);
    const entries = [];
    for (const path of [...statePaths, ...evidencePaths]) {
      const bytes = await readFile(path);
      assert.ok(bytes.length <= 4194304, 'OVERFLOW');
      entries.push({ path, bytes });
    }
    assert.ok(entries.reduce((n, e) => n + e.bytes.length, 0) <= 16777216, 'OVERFLOW');
    const at = (p) => entries.find((e) => e.path === join(evidence, p))?.bytes;
    const diagnostics = entries.filter((e) => /\.log(?:$|[.-])/.test(e.path));
    assert.ok(diagnostics.length > 0, 'INCOMPLETE');
    const capture = {
      tui: Buffer.concat(rawBuffers),
      diagnostics: Buffer.concat(diagnostics.map((e) => e.bytes)),
      fixture: at('fixture.jsonl'),
      inventory: at('inventory.json'),
      state: Buffer.concat(
        entries
          .filter((e) => e.path.startsWith(root + '/'))
          .flatMap((e) => [Buffer.from(e.path), e.bytes]),
      ),
      evidence: Buffer.concat(
        entries
          .filter((e) => e.path.startsWith(evidence + '/'))
          .flatMap((e) => [Buffer.from(e.path), e.bytes]),
      ),
    };
    scanReason = 'SCAN_REFUSED';
    const scan = rendererScan(capture, canaries, true, overflow);
    scan.files = entries.map((e) => ({
      path: e.path,
      sha256: digest(e.bytes),
      bytes: e.bytes.length,
    }));
    await writeFile(join(evidence, 'diagnostics.log'), capture.diagnostics);
    await writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(scan));
    scanReason = 'NONE';
  } catch {
    if (scanReason !== 'SCAN_REFUSED')
      scanReason = overflow ? 'OVERFLOW' : 'COLLECTION_OR_INCOMPLETE';
  }
  if (scanReason !== 'NONE' && failure === 'NONE') failure = 'SCAN_REFUSED';
  // Only closed categories, numeric counters and normalized versions bypass scan.
  await writeFile(
    join(evidence, 'renderer-diagnostic.json'),
    JSON.stringify({
      status: failure === 'NONE' ? 'PASS' : 'FAIL',
      failure,
      phase: failedPhase,
      scanReason,
      frames: emittedLabels(raw).frames,
      bytes: Buffer.byteLength(raw),
      counts,
      runtime: {
        host: /^(?:opencode v)?2\.2\.5$/.test(runtime.host) ? '2.2.5' : 'UNKNOWN',
        bun: runtime.bun,
      },
      cleanup,
      hostExit,
    }),
  );
  process.exitCode = failure === 'NONE' ? 0 : 1;
}
