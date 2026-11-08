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
import {
  emittedLabels,
  rendererCells,
  rendererScan,
  digest,
  rendererCheckpoint,
  rendererStep,
  rendererCursor,
  assertRendererStyles,
  safeRendererDiagnostic,
  rendererStyleFacts,
  rendererSize,
  rendererReadFile,
  rendererDiagnostics,
  rendererCaptureCheck,
  assertRendererCursor,
  rendererDiagnosticSequence,
  rendererDiagnosticAnalysis,
  rendererMetadataInventory,
  incompleteInventory,
  encodeRendererInventory,
} from './harness-renderer-observation.mjs';

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
const inventoryMode = process.argv[2] === '--metadata-inventory';
const diagnosticMode = process.argv[2] === '--diagnostic-capture' || inventoryMode;
let inventoryResult = incompleteInventory();
const diagnosticSamples = {};
let diagnosticAnalysis = 'UNPROVEN';
const operation = { stage: 'POLICY', reason: 'ASSERT' };
const collection = { stage: 'UNRUN', reason: 'NONE' };
let cursor = { present: false, value: 'NONE' };
let styles = rendererStyleFacts();
const mark = (stage, reason = 'ASSERT') => rendererCheckpoint(operation, stage, reason);
const rawBuffers = [],
  decoder = new StringDecoder('utf8');
let rawBytes = 0;
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );
const events = async () => {
  const previous = { ...operation };
  const text = await rendererStep(operation, 'READ_EVENTS', 'IO', () =>
    readFile(join(evidence, 'fixture.jsonl'), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    }),
  );
  const result = await rendererStep(operation, 'PARSE_EVENTS', 'PARSE', () =>
    text
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s)),
  );
  Object.assign(operation, previous);
  return result;
};
const progress = async (value) => {
  phase = value;
  await rendererStep(operation, 'PROGRESS', 'IO', () =>
    appendFile(
      join(evidence, 'progress.jsonl'),
      JSON.stringify({ phase, elapsed: Date.now() - started }) + '\n',
    ),
  );
};
async function wait(predicate, budget = 15000, teardown = false) {
  const deadline = Math.min(teardown ? end : executionEnd, Date.now() + budget);
  while (Date.now() < deadline) {
    rendererCaptureCheck(operation, overflow, ioFailure);
    if (await predicate()) return;
    await delay(50);
  }
  operation.reason = 'DEADLINE';
  throw new Error('PHASE_DEADLINE');
}
function key(name, value) {
  mark('WRITE_KEY', 'IO');
  assert.ok(child && !exited);
  counts[name]++;
  child.stdin.write(value);
}
async function files(directory, tracking) {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      if (tracking) rendererCheckpoint(tracking, 'SYMLINK', 'INCOMPLETE');
      assert.fail('SYMLINK_CAPTURE');
    }
    if (entry.isDirectory()) list.push(...(await files(path, tracking)));
    else if (entry.isFile()) list.push(path);
  }
  return list;
}
try {
  mark('POLICY', 'IO');
  await mkdir(evidence, { recursive: true });
  mark('POLICY_WAIT', 'DEADLINE');
  await wait(() => exists('/run/proceed-authorized'));
  mark('POLICY');
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
  mark('STAGE_FIXTURE', 'IO');
  await stageLinuxFixture(env, evidence, '/payload/tests/fixtures/harness-renderer/tui.ts');
  mark('HOST_VERSION', 'IO');
  runtime.host = execFileSync('/usr/local/bin/opencode', ['--version'], {
    env,
    cwd: join(root, 'work'),
    timeout: 5000,
    encoding: 'utf8',
  }).trim();
  assert.match(runtime.host, /(?:opencode v)?2\.2\.5$/);
  mark('WRITE_BINDING', 'IO');
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
  mark('READY_WAIT', 'DEADLINE');
  await wait(
    async () =>
      (await events()).some((e) => e.phase === 'setup') && raw.includes('SYNTHETIC renderer ready'),
    60000,
  );
  const setup = (await events()).find((e) => e.phase === 'setup');
  mark('SETUP');
  hostPid = Number.isSafeInteger(setup.pid) && setup.pid > 1 ? setup.pid : undefined;
  runtime.bun = /^\d+\.\d+\.\d+$/.test(setup.bun ?? '') ? setup.bun : 'UNKNOWN';
  assert.equal(setup.themeMode, 'dark');
  if (diagnosticMode) {
    await rendererDiagnosticSequence(
      { key, wait, events, mark, progress, raw: () => raw },
      diagnosticSamples,
    );
  } else {
    await progress('initial');
    key('ctrlG', '\x07');
    mark('INITIAL_WAIT', 'DEADLINE');
    await wait(() => {
      try {
        rendererCells(raw);
        return true;
      } catch {
        return false; // Partial/unsupported output is never a qualified sample.
      }
    });
    key('observe', '\x19');
    mark('INITIAL_CURSOR_WAIT', 'DEADLINE');
    await wait(async () => (await events()).filter((e) => e.phase === 'cursor').length === 1);
    cursor = rendererCursor((await events()).find((e) => e.phase === 'cursor'));
    assertRendererCursor(operation, cursor, 'ALPHA');
    samples.initial = rendererCells(raw);
    await progress('moved');
    key('arrowDown', '\x1b[B');
    mark('MOVED_WAIT', 'DEADLINE');
    await wait(() => {
      try {
        const moved = rendererCells(raw, samples.initial);
        assertRendererStyles(samples.initial.labels, moved.labels, {});
        return true;
      } catch {
        return false;
      }
    });
    key('observe', '\x19');
    mark('MOVED_CURSOR_WAIT', 'DEADLINE');
    await wait(async () => (await events()).filter((e) => e.phase === 'cursor').length === 2);
    cursor = rendererCursor((await events()).filter((e) => e.phase === 'cursor')[1]);
    assertRendererCursor(operation, cursor, 'BETA', true);
    samples.moved = rendererCells(raw, samples.initial);
    const before = samples.initial.labels,
      after = samples.moved.labels;
    styles = rendererStyleFacts(before, after);
    assertRendererStyles(before, after, operation);
  }
  if (!diagnosticMode) {
    await progress('dismissed');
    key('escape', '\x1b');
    mark('DISMISS', 'DEADLINE');
    await wait(async () => (await events()).some((e) => e.phase === 'dismissed'));
  }
  assert.equal(
    (await events()).some((e) => e.phase === 'fixture-choice'),
    false,
  );
  // Read the isolated database without introducing sessions, credentials or work.
  let credentialTables = 0;
  mark('CREDENTIALS');
  for (const path of inventoryMode
    ? []
    : (await files(env.XDG_DATA_HOME)).filter((p) => p.endsWith('.db'))) {
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
  if (!inventoryMode) assert.ok(credentialTables > 0);
  operation.reason = 'NONE';
} catch {
  failure =
    operation.reason === 'DEADLINE'
      ? 'PHASE_DEADLINE'
      : overflow
        ? 'CAPTURE_LIMIT'
        : 'CONTROL_OR_IO';
} finally {
  const failedPhase = phase;
  const failedOperation = { ...operation };
  try {
    await progress('cleanup');
  } catch {
    /* teardown must still run */
  }
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
    rendererCheckpoint(collection, 'HOST_EXIT', 'INCOMPLETE');
    assert.ok(
      hostExit && (!inventoryMode || (cleanup && closed && failure === 'NONE')),
      'INCOMPLETE',
    );
    await rendererStep(collection, 'WRITE_TRANSCRIPT', 'IO', () =>
      writeFile(join(evidence, 'transcript.ansi'), Buffer.concat(rawBuffers)),
    );
    await rendererStep(collection, 'WRITE_OBSERVATIONS', 'IO', () =>
      writeFile(
        join(evidence, 'observations.json'),
        JSON.stringify({
          samples,
          counts,
          runtime,
          cleanup,
          hostExit,
          cellWidths: 'UNKNOWN',
          productProfile: null,
          ...(diagnosticMode
            ? {
                diagnostic: {
                  ALPHA: diagnosticSamples.ALPHA,
                  BETA: diagnosticSamples.BETA,
                  initialBytes: Buffer.byteLength(diagnosticSamples.initialRaw ?? ''),
                  movedBytes: Buffer.byteLength(diagnosticSamples.movedRaw ?? ''),
                },
              }
            : {}),
        }),
      ),
    );
    if (inventoryMode) {
      // No progress/event writer or content collector runs during these passes.
      const inventoryEnd = Math.min(end, Date.now() + 30000);
      // A stuck filesystem syscall must not extend the phase or teardown endpoint.
      // Process exit closes OS descriptors. Missing output becomes fixed incomplete.
      const watchdog = setTimeout(() => process.exit(1), Math.max(0, inventoryEnd - Date.now()));
      try {
        inventoryResult = await rendererMetadataInventory({ state: root, evidence }, inventoryEnd);
      } finally {
        clearTimeout(watchdog);
      }
    } else {
      const statePaths = await rendererStep(collection, 'ENUMERATE_STATE', 'IO', () =>
          files(root, collection),
        ),
        evidencePaths = await rendererStep(collection, 'ENUMERATE_EVIDENCE', 'IO', () =>
          files(evidence, collection),
        );
      const entries = [];
      let collectedBytes = 0;
      for (const [surface, paths] of [
        ['state', statePaths],
        ['evidence', evidencePaths],
      ]) {
        for (const path of paths) {
          const bytes = await rendererReadFile(collection, path, surface, collectedBytes);
          collectedBytes += bytes.length;
          entries.push({ path, bytes });
        }
      }
      rendererSize(
        collection,
        entries.reduce((n, e) => n + e.bytes.length, 0),
        true,
      );
      const at = (p) => entries.find((e) => e.path === join(evidence, p))?.bytes;
      const diagnostics = rendererDiagnostics(collection, entries);
      rendererCheckpoint(collection, 'BUILD_CAPTURE', 'INCOMPLETE');
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
      const scan = await rendererStep(collection, 'SCAN', overflow ? 'OVERFLOW' : 'REFUSED', () =>
        rendererScan(capture, canaries, hostExit && diagnostics.length > 0, overflow),
      );
      scan.files = entries.map((e) => ({
        path: e.path,
        sha256: digest(e.bytes),
        bytes: e.bytes.length,
      }));
      await rendererStep(collection, 'EXPORT_DIAGNOSTICS', 'IO', () =>
        writeFile(join(evidence, 'diagnostics.log'), capture.diagnostics),
      );
      await rendererStep(collection, 'EXPORT_SCAN', 'IO', () =>
        writeFile(join(evidence, 'scan-pass.json'), JSON.stringify(scan)),
      );
      scanReason = 'NONE';
      // Parsing is deliberately downstream of frozen complete-surface privacy proof.
      if (diagnosticMode) diagnosticAnalysis = rendererDiagnosticAnalysis(diagnosticSamples, true);
    }
  } catch {
    scanReason =
      collection.reason === 'OVERFLOW'
        ? 'OVERFLOW'
        : collection.stage === 'SCAN'
          ? 'SCAN_REFUSED'
          : 'COLLECTION_OR_INCOMPLETE';
  }
  if (inventoryMode) {
    // Inventory never writes renderer diagnostics, scan markers or detailed exports.
    try {
      await writeFile(
        join(evidence, 'renderer-inventory.json'),
        encodeRendererInventory(inventoryResult),
      );
    } catch {
      inventoryResult = incompleteInventory();
    }
    process.exitCode = inventoryResult.complete ? 0 : 1;
  } else {
    if (scanReason !== 'NONE' && failure === 'NONE') failure = 'SCAN_REFUSED';
    // Only closed categories, numeric counters and normalized versions bypass scan.
    try {
      await writeFile(
        join(evidence, 'renderer-diagnostic.json'),
        JSON.stringify(
          safeRendererDiagnostic({
            status: failure === 'NONE' ? 'PASS' : 'FAIL',
            failure,
            phase: failedPhase,
            scanReason,
            frames: diagnosticMode
              ? (raw.match(/\x1b\[\?2026l/g) ?? []).length
              : emittedLabels(raw).frames,
            bytes: Buffer.byteLength(raw),
            counts,
            runtime: {
              host: /^(?:opencode v)?2\.2\.5$/.test(runtime.host) ? '2.2.5' : 'UNKNOWN',
              bun: runtime.bun,
            },
            cleanup,
            hostExit,
            operation: failedOperation,
            collection,
            cursor,
            styles,
            ...(diagnosticMode
              ? {
                  diagnostic: {
                    capture: failure === 'NONE' ? 'DIAGNOSTIC_CAPTURE_PASS' : 'FAIL',
                    analysis: diagnosticAnalysis,
                    profile: 'UNPROVEN',
                    ALPHA: diagnosticSamples.ALPHA ?? { present: false, value: 'NONE' },
                    BETA: diagnosticSamples.BETA ?? { present: false, value: 'NONE' },
                  },
                }
              : {}),
          }),
        ),
      );
    } catch {
      failure = 'CONTROL_OR_IO'; /* No unfiltered stack on diagnostic write failure. */
    }
    process.exitCode = failure === 'NONE' ? 0 : 1;
  }
}
