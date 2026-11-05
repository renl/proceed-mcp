// TEST ONLY. Installed public CLI, no real Telegram or live first-use proof.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, mkdtemp, rm, access, readdir, stat, realpath } from 'node:fs/promises';
import { resolve, join, dirname, isAbsolute, sep, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { safeSmokeDiagnostic } from './support/release-artifact.mjs';
import { managed } from './support/managed-spike.mjs';
import { completed, stopped } from './support/startup-guards.mjs';
import { catalogPeer, initializeResult, successful, allTools, workflowInstructions } from './support/catalog-consumer.mjs';

test('PREVIEW diagnostic: allowlisted fields exclude synthetic private markers', () => {
  const marker = 'SYNTHETIC_PRIVATE_MARKER';
  const safe = safeSmokeDiagnostic({ phase: marker, elapsedMs: marker, exit: marker,
    error: marker, assertion: marker, cleanup: marker, stdout: marker,
    stderr: marker, stack: marker, action: marker, capability: marker });
  assert.deepEqual(safe, { phase: 'entry', elapsedMs: null, exit: null,
    error: 'OTHER', assertion: 'pending', cleanup: 'pending' });
  assert.ok(!JSON.stringify(safe).includes(marker));
  assert.deepEqual(safeSmokeDiagnostic(null), safeSmokeDiagnostic());
  for (const error of [null, 'ERR_ASSERTION', 'ETIMEDOUT', 'ENOENT']) {
    const sample = { phase: 'init', elapsedMs: 5001, exit: 1, error,
      assertion: 'fail', cleanup: 'pass' };
    assert.deepEqual(safeSmokeDiagnostic(sample), sample);
  }
  assert.deepEqual(safeSmokeDiagnostic({ phase: 'complete', elapsedMs: 10, exit: 0,
    error: null, assertion: 'pass', cleanup: 'pass' }),
  { phase: 'complete', elapsedMs: 10, exit: 0, error: null, assertion: 'pass', cleanup: 'pass' });
});

test('PREVIEW diagnostic: child failure reports safely and calibration cleans up', async () => {
  const root = resolve('.scratch/preview-package');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'diagnostic-calibration-'));
  try {
    const report = join(directory, 'report.json');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=PREVIEW-INSTALLED',
      'tests/release-installed.test.mjs'], { timeout: 5000, maxBuffer: 65536,
      windowsHide: true, env: { ...env, TEMP: directory, TMP: directory, TMPDIR: directory,
        PROCEED_TEST_SMOKE_REPORT: report,
        PROCEED_TEST_INSTALLED_BIN: 'SYNTHETIC_PRIVATE_MARKER' } });
    assert.ifError(child.error);
    assert.equal(child.status, 1, 'deliberate invalid installed path fails');
    const text = await readFile(report, 'utf8');
    const value = JSON.parse(text);
    assert.equal(value.phase, 'entry');
    assert.equal(value.error, 'ERR_ASSERTION');
    assert.equal(value.assertion, 'fail');
    assert.equal(value.cleanup, 'pending', 'managed resources were not started');
    assert.deepEqual(value, safeSmokeDiagnostic(value));
    assert.ok(!text.includes('SYNTHETIC_PRIVATE_MARKER'));
  } finally {
    await rm(directory, { recursive: true, maxRetries: 3, retryDelay: 100 });
    await assert.rejects(access(directory), { code: 'ENOENT' });
  }
});

test('PREVIEW-INSTALLED: fresh protected setup and installed unpaired tool behavior', { timeout: 45000 }, async () => {
  const started = performance.now();
  const report = process.env.PROCEED_TEST_SMOKE_REPORT;
  assert.ok(report && isAbsolute(report) && resolve(report).startsWith(resolve('.scratch/preview-package') + sep),
    'explicit package-run diagnostic path required');
  let current = safeSmokeDiagnostic();
  const mark = (phase, fields = {}) => {
    current = safeSmokeDiagnostic({ ...current, ...fields, phase,
      elapsedMs: Math.floor(performance.now() - started) });
    writeFileSync(report, JSON.stringify(current));
  };
  mark('entry');
  try {
  const executable = process.env.PROCEED_TEST_INSTALLED_BIN;
  assert.ok(executable && isAbsolute(executable), 'explicit isolated installed bin required');
  assert.ok(resolve(executable).startsWith(resolve('.scratch') + sep),
    'installed artifact must remain inside worktree scratch');
  const prefix = process.env.PROCEED_TEST_INSTALL_PREFIX;
  assert.ok(prefix && isAbsolute(prefix) && resolve(prefix).startsWith(resolve('.scratch') + sep),
    'explicit isolated install prefix required');
  assert.equal(resolve(executable), join(resolve(prefix), 'node_modules', '@meshimize', 'proceed-mcp',
    'bin', 'proceed-mcp.js'));
  mark('manifest');
  const manifest = JSON.parse(await readFile(join(dirname(dirname(executable)), 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@meshimize/proceed-mcp');
  assert.equal(manifest.version, '0.1.0-preview.1');
  const preload = pathToFileURL(resolve('tests/fixtures/release-observer.mjs')).href;
  const result = await managed(async (context) => {
    const state = join(context.directory, 'state');
    const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    Object.assign(env, { TEMP: context.directory, TMP: context.directory, TMPDIR: context.directory });
    env.PATH = dirname(process.execPath) + delimiter + (env.PATH ?? '');
    const command = join(prefix, 'node_modules', '.bin',
      process.platform === 'win32' ? 'proceed-mcp.cmd' : 'proceed-mcp');
    if (process.platform !== 'win32') {
      assert.equal(await realpath(command), await realpath(executable), 'POSIX installed shim targets this package');
      assert.ok((await stat(command)).mode & 0o111, 'POSIX installed command is executable');
    }
    // cmd.exe owns quoting here. Reject expansion/quote characters, not spaces.
    assert.doesNotMatch(command, /["%!\r\n]/, 'shim path must not contain cmd expansion or quotes');
    mark('shim-help');
    const help = process.platform === 'win32'
      ? spawnSync(env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', `""${command}" --help"`],
        { cwd: context.directory, env, timeout: 5000, maxBuffer: 65536, windowsHide: true,
          windowsVerbatimArguments: true })
      : spawnSync(command, ['--help'],
        { cwd: context.directory, env, timeout: 5000, maxBuffer: 65536 });
    mark('shim-help', { exit: help.status, error: help.error?.code });
    assert.ifError(help.error);
    assert.equal(help.status, 0, 'installed named command help succeeds');
    const cli = (...args) => {
      const child = spawnSync(process.execPath, ['--import', preload, executable, ...args, '--state-dir', state], {
        cwd: context.directory, env, timeout: 5000, maxBuffer: 65536, windowsHide: true,
      });
      mark(current.phase, { exit: child.status, error: child.error?.code });
      assert.ifError(child.error);
      return child;
    };
    mark('invalid-command');
    assert.equal(cli('not-a-command').status, 2);
    mark('init');
    assert.equal(cli('init').status, 0, 'protection failure is not a passing setup');
    mark('repeat-init');
    assert.notEqual(cli('init').status, 0, 'existing state cannot be overwritten');
    mark('owner-add');
    assert.equal(cli('owner', 'add', 'preview_owner', '--label', 'Preview test').status, 0);
    // Real POSIX filesystem proof only. Windows DACLs are not mode-bit proof.
    const protectedState = async (directory) => {
      const info = await stat(directory);
      assert.equal(info.mode & 0o777, 0o700, 'POSIX state directory is owner-only');
      assert.equal(info.uid, process.getuid(), 'fixture state belongs to the running account');
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await protectedState(path);
        else {
          assert.ok(entry.isFile(), 'protected state has no unexpected link or special entry');
          const file = await stat(path);
          assert.equal(file.mode & 0o777, 0o600, 'POSIX state file is owner-only');
          assert.equal(file.uid, process.getuid(), 'fixture file belongs to the running account');
        }
      }
    };
    if (process.platform !== 'win32') await protectedState(state);
    mark('broker-start', { exit: null, error: null });
    const broker = await context.start([process.execPath, '--import', preload, executable, 'serve', '--state-dir', state]);
    const diagnostics = [];
    for (const stream of [broker.child.stdout, broker.child.stderr]) stream.on('data', chunk => diagnostics.push(chunk));
    mark('broker-ready');
    await broker.wait('broker-ready');
    mark('status');
    const status = cli('status', '--json');
    assert.equal(status.status, 0);
    const value = JSON.parse(status.stdout);
    assert.equal(value.schema_version, 1);
    assert.deepEqual(value.requests, []);
    mark('adapter-start', { exit: null, error: null });
    const adapter = await context.start([process.execPath, '--import', preload, executable,
      'mcp', '--owner', 'preview_owner', '--state-dir', state]);
    adapter.child.stderr.on('data', chunk => diagnostics.push(chunk));
    const peer = catalogPeer(adapter.child);
       mark('initialize');
       const init = initializeResult(await peer.call('initialize', {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'package-smoke', version: '1' },
      }).outcome);
      assert.equal(init.serverInfo.name, 'proceed-mcp');
      assert.equal(init.serverInfo.version, manifest.version);
      adapter.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
       mark('catalog');
       const tools = await allTools(peer);
      assert.ok(tools.some((tool) => tool.name === 'prepare_approval'));
      assert.ok(tools.some((tool) => tool.name === 'request_approval'));
       workflowInstructions(init, tools);
       // Compare privately: assertion diagnostics must never print issued authority.
       const tool = async (name, args) => {
         const result = successful(await peer.call('tools/call', { name, arguments: args }).outcome);
         assert.ok(Array.isArray(result.content) && result.content.length === 1 &&
           result.content[0].type === 'text', 'one documented text result required');
         let text;
         try { text = JSON.parse(result.content[0].text); }
         catch { assert.fail('tool text must be valid JSON, private output withheld'); }
         assert.ok(isDeepStrictEqual(text, result.structuredContent), 'structured and text results agree');
         return result;
       };
        mark('prepare');
        const prepared = await tool('prepare_approval', {});
       assert.equal(prepared.isError, false);
       const authority = prepared.structuredContent;
       assert.equal(authority.schema_version, 1);
       for (const [field, pattern] of [['request_handle', /^hdl_[a-f0-9]{32}$/],
         ['request_id', /^req_[a-f0-9]{32}$/], ['request_capability', /^cap_[a-f0-9]{64}$/]]) {
         assert.ok(typeof authority[field] === 'string' && pattern.test(authority[field]), 'documented private authority');
       }
        mark('unpaired-refusal');
        const refused = await tool('request_approval', {
         request_handle: authority.request_handle, request_capability: authority.request_capability,
         client_request_id: 'installed_smoke', action: 'Check installed unpaired refusal', context: '',
         expires_in_seconds: 60,
       });
       assert.equal(refused.isError, true);
       assert.ok(isDeepStrictEqual(refused.structuredContent, { schema_version: 1,
         error: { code: 'NOT_PAIRED', message: 'No human is paired; run proceed-mcp pair and complete private-chat pairing',
           retryable: false } }), 'documented unpaired refusal, not authority or transport failure');
        mark('status-after');
        const after = cli('status', '--json');
       assert.equal(after.status, 0);
       assert.ok(isDeepStrictEqual(JSON.parse(after.stdout).requests, []), 'no actionable approval after preparation/refusal');
       assert.ok(!Buffer.concat([after.stdout, after.stderr]).includes(Buffer.from(authority.request_capability)),
         'status excludes private capability');
        mark('adapter-eof', { exit: null, error: null });
        adapter.child.stdin.end();
      assert.equal(await completed(adapter), 0, 'public EOF completes adapter');
      peer.assertComplete();
    mark('broker-stop');
    await stopped(broker);
    if (process.platform !== 'win32') await protectedState(state);
    mark('privacy');
    assert.ok(!Buffer.concat(diagnostics).includes(Buffer.from(authority.request_capability)),
      'broker and adapter diagnostics exclude private capability');
  }, { totalMs: 30000, readyMs: 5000 });
  mark(current.phase, { assertion: result.assertionError ? 'fail' : 'pass',
    cleanup: result.cleanupError ? 'fail' : 'pass',
    error: current.error ?? result.assertionError?.code ?? result.cleanupError?.code ?? null });
  assert.ifError(result.cleanupError);
  assert.ifError(result.assertionError);
  mark('complete');
  } catch (error) {
    mark(current.phase, { assertion: current.assertion === 'pass' ? 'pass' : 'fail',
      error: current.error ?? error?.code ?? 'OTHER' });
    throw error;
  }
});
