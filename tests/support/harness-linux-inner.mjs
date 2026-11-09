// TEST ONLY. Container-local state, real pinned TUI, actual PTY keyboard input.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, readdir, access, open } from 'node:fs/promises';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import {
  isolatedLinuxEnvironment,
  linuxScriptArguments,
  stageLinuxFixture,
} from './harness-linux-plan.mjs';
import { hostBudgets, dialogObserved } from './harness-host-plan.mjs';
import { assertPluginInventory, assertServiceInventory } from './harness-plugin-inventory.mjs';

const started = Date.now();
const end = started + 210000;
const root = '/run/proceed/state';
const evidence = '/run/proceed/evidence';
const env = isolatedLinuxEnvironment(root);
const checks = Object.fromEntries(
  [
    'artifact',
    'isolation',
    'fixture',
    'rendered',
    'escape',
    'reject',
    'respond',
    'credentials',
    'pluginCleanup',
    'inventory',
  ].map((k) => [k, 'UNRUN']),
);
let child;
let transcript = '';
let exited = false;
let failure;
let currentCheck = 'isolation';
let closing = false;
const progress = async (phase) =>
  appendFile(
    join(evidence, 'progress.jsonl'),
    `${JSON.stringify({ phase, elapsed: Date.now() - started })}\n`,
  );
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const plain = (s) =>
  s
    .replace(/\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
const events = async () => {
  const content = await readFile(join(evidence, 'fixture.jsonl'), 'utf8').catch(() => '');
  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};
async function wait(label, predicate, budget = hostBudgets.interaction) {
  await progress(label);
  const deadline = Math.min(end, Date.now() + budget);
  while (Date.now() < deadline) {
    if (failure) throw new Error(failure);
    if (await predicate()) return;
    assert.ok(!exited, `PTY exited before ${label}`);
    await delay(50);
  }
  throw new Error(`Deadline: ${label}`);
}
function keys(value) {
  assert.ok(child && !exited && Date.now() < end);
  child.stdin.write(value);
}
async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

await mkdir(evidence, { recursive: true });
try {
  await wait('await-inspected-container-policy', () => exists('/run/proceed-authorized'), 15000);
  await progress('isolated-staging');
  assert.equal(await exists('/etc/opencode'), false, 'uncontrolled system config');
  for (const parent of ['/', '/run', '/run/proceed']) {
    for (const name of ['.opencode', 'opencode.json', 'opencode.jsonc'])
      assert.equal(await exists(join(parent, name)), false, 'unexpected ancestor project config');
  }
  assert.equal(await exists(root), false, 'state namespace must be new');
  await mkdir(root);
  for (const directory of new Set(
    Object.entries(env)
      .filter(([key]) => /HOME|USERPROFILE|TMP|TEMP|CONFIG_DIR/.test(key))
      .map(([, value]) => value),
  )) {
    await mkdir(directory, { recursive: true });
  }
  for (const name of ['home', 'data', 'config', 'cache', 'state', 'service-config', 'tmp', 'work'])
    await mkdir(join(root, name), { recursive: true });
  const staging = await stageLinuxFixture(
    env,
    evidence,
    '/payload/tests/fixtures/harness-platform/tui.ts',
  );
  const { plugin } = staging;
  await progress('effective-config-staged');
  await writeFile(join(evidence, 'staging.json'), JSON.stringify(staging, null, 2));
  const interfaces = networkInterfaces();
  assert.ok(
    Object.values(interfaces)
      .flat()
      .every((value) => value.internal),
    'non-loopback interface',
  );
  const route = await readFile('/proc/net/route', 'utf8');
  assert.equal(route.trim().split('\n').length, 1, 'external route exists');
  await writeFile(
    join(evidence, 'isolation.json'),
    JSON.stringify(
      {
        roots: env,
        systemConfigAbsent: true,
        initialDataEmpty: true,
        initialHomeEmpty: true,
        initialEffectiveConfigEmpty: true,
        effectiveConfig: staging.config,
        pluginEntry: staging.entry,
        configuredPlugins: [plugin],
        interfaces: Object.keys(interfaces),
        externalRoutes: 0,
      },
      null,
      2,
    ),
  );
  checks.isolation = 'PASS';
  currentCheck = 'artifact';
  const version = execFileSync('/usr/local/bin/opencode', ['--version'], {
    env,
    cwd: join(root, 'work'),
    timeout: 5000,
    encoding: 'utf8',
  }).trim();
  assert.match(version, /(?:opencode v)?2\.2\.5$/);
  assert.match(
    execFileSync('/usr/bin/script', ['--version'], { env, timeout: 5000, encoding: 'utf8' }),
    /2\.39\.3/,
  );
  checks.artifact = 'PASS';
  currentCheck = 'fixture';
  await progress('pty-start');
  child = spawn('/usr/bin/script', linuxScriptArguments(join(root, 'pty.raw')), {
    env,
    cwd: join(root, 'work'),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.on('exit', () => {
    exited = true;
  });
  child.on('error', (error) => {
    failure = error.message;
  });
  child.stdin.on('error', (error) => {
    if (!closing) failure = error.message;
  });
  // Minimal terminal query replies, not a replacement renderer or callback invoker.
  let queryTail = '';
  child.stdout.on('data', (buffer) => {
    const chunk = buffer.toString('utf8');
    if (Buffer.byteLength(transcript) + buffer.length > 1048576) {
      failure = 'PTY output ceiling exceeded';
      return;
    }
    transcript += chunk;
    const input = queryTail + chunk;
    const responses = [
      [/\x1b\[6n/g, '\x1b[1;1R'],
      [/\x1b\[\?u/g, '\x1b[?0u'],
      [/\x1b\[c/g, '\x1b[?1;2c'],
      [/\x1b\[>c/g, '\x1b[>0;0;0c'],
      [/\x1b\]10;\?(?:\x07|\x1b\\)/g, '\x1b]10;rgb:ffff/ffff/ffff\x1b\\'],
      [/\x1b\]11;\?(?:\x07|\x1b\\)/g, '\x1b]11;rgb:0000/0000/0000\x1b\\'],
    ];
    let consumed = 0;
    for (const [pattern, reply] of responses)
      for (const match of input.matchAll(pattern)) {
        if (!exited) child.stdin.write(reply);
        consumed = Math.max(consumed, match.index + match[0].length);
      }
    // Retain only an incomplete trailing query, never replay completed replies.
    const pending = input.slice(consumed);
    const last = pending.lastIndexOf('\x1b');
    queryTail = last >= 0 && pending.length - last < 32 ? pending.slice(last) : '';
  });
  child.stderr.on('data', (buffer) => {
    if (Buffer.byteLength(transcript) + buffer.length > 1048576)
      failure = 'PTY output ceiling exceeded';
    else transcript += buffer.toString('utf8');
  });
  await progress('await-plugin-reconciliation');
  await wait(
    'fixture-and-rendered-readiness',
    async () => {
      const loaded = (await events()).some((e) => e.phase === 'setup' && e.version === '2.2.5');
      if (loaded) {
        checks.fixture = 'PASS';
        currentCheck = 'rendered';
      }
      return loaded && plain(transcript).includes('Proceed platform ready');
    },
    hostBudgets.readiness,
  );
  checks.fixture = 'PASS';
  await progress('plugin-setup-and-ready-render-observed');
  checks.rendered = 'PASS';
  for (const [id, key, outcome] of [
    [1, '\x1b', 'dismissed'],
    [2, '\r', 'reject'],
    [3, 'Respond\r', 'respond'],
  ]) {
    currentCheck = id === 1 ? 'escape' : outcome;
    keys('\x07');
    await wait(`rendered-dialog-${id}`, async () => dialogObserved(await events(), transcript, id));
    keys(key);
    if (outcome === 'respond') {
      await wait('rendered-response-prompt', async () =>
        dialogObserved(await events(), transcript, id, true),
      );
      keys('approved\r');
    }
    await wait(`callback-${outcome}`, async () =>
      (await events()).some(
        (e) =>
          e.id === id &&
          (outcome === 'dismissed'
            ? e.phase === 'dismissed'
            : e.phase === 'result' &&
              e.choice === outcome &&
              (outcome !== 'respond' || e.text === 'approved')),
      ),
    );
    const observed = await events();
    if (id === 1)
      assert.equal(
        observed.some((e) => e.id === 1 && e.phase === 'result'),
        false,
      );
    checks[id === 1 ? 'escape' : outcome] = 'PASS';
  }
  await progress('inspect-run-database');
  currentCheck = 'credentials';
  const dataFiles = await files(env.XDG_DATA_HOME);
  assert.equal(
    dataFiles.some((path) => path.endsWith('/auth.json')),
    false,
  );
  const databases = dataFiles.filter((path) => path.endsWith('.db'));
  assert.ok(databases.length > 0, 'no runtime database observed');
  let tables = 0;
  for (const path of databases) {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      if (
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credential'").get()
      ) {
        assert.equal(db.prepare('SELECT COUNT(*) AS count FROM credential').get().count, 0);
        tables++;
      }
    } finally {
      db.close();
    }
  }
  assert.ok(tables > 0, 'credential table was not inspected');
  checks.credentials = 'PASS';
  await writeFile(
    join(evidence, 'isolation.json'),
    JSON.stringify(
      {
        roots: env,
        systemConfigAbsent: true,
        initialDataEmpty: true,
        legacyAuthAbsent: true,
        credentialTables: tables,
        credentialRows: 0,
        configuredPlugins: [plugin],
        actualSetupEvents: (await events()).filter((e) => e.phase === 'setup'),
        externalRoutes: 0,
        interfaces: Object.keys(interfaces),
      },
      null,
      2,
    ),
  );
  await progress('graceful-tui-exit');
  currentCheck = 'pluginCleanup';
  keys('\x03');
  // Exit observation needs no live PTY requirement after the process exits.
  const quitDeadline = Math.min(end, Date.now() + 10000);
  while (Date.now() < quitDeadline && !(await events()).some((e) => e.phase === 'cleanup'))
    await delay(50);
  assert.ok(
    (await events()).some((e) => e.phase === 'cleanup'),
    'actual Plugin Cleanup not observed',
  );
  checks.pluginCleanup = 'PASS';
} catch (error) {
  failure = error.message;
  checks[currentCheck] = 'FAIL';
} finally {
  closing = true;
  await progress('close-owned-transport');
  if (child) {
    child.stdin.end();
    child.kill('SIGTERM');
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
  }
  // There are no injected credentials. Still redact common generated/auth shapes.
  const sanitized = transcript
    .replace(/(Bearer|Basic) [A-Za-z0-9._~+/=-]+/g, '$1 [REDACTED]')
    .replace(/hop_[a-f0-9]{64}/g, '[REDACTED]');
  await writeFile(join(evidence, 'transcript.ansi'), sanitized.slice(0, 1048576));
  // Select from complete bounded logs, not a tail, so an additional external
  // entry cannot disappear behind the earlier 40-line diagnostic ceiling.
  const diagnostics = [];
  let complete = true;
  const exitDeadline = Math.min(end, Date.now() + 5000);
  while (child && !exited && Date.now() < exitDeadline) await delay(50);
  if (child && !exited) complete = false;
  for (const directory of [env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME]) {
    const found = await files(directory).catch(() => {
      complete = false;
      return [];
    });
    if (found.some((p) => /\.log[.-]/.test(p))) complete = false;
    const logs = found.filter((p) => /\.log$/.test(p));
    if (logs.length > 8) complete = false;
    for (const path of logs.slice(0, 8)) {
      const handle = await open(path, 'r');
      let content;
      try {
        const { size } = await handle.stat();
        if (size > 1048576) complete = false;
        const buffer = Buffer.alloc(Math.min(size, 1048576));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== size) complete = false;
        content = buffer.toString('utf8');
      } finally {
        await handle.close();
      }
      if (
        plain(content)
          .split('\n')
          .some((line) => /plugin|reconcil|error|failed/i.test(line) && line.length > 2000)
      )
        complete = false;
      diagnostics.push(
        ...plain(content)
          .split('\n')
          .filter((line) => /plugin|reconcil|error|failed/i.test(line))
          .map((line) =>
            line
              .replace(/(Bearer|Basic) [A-Za-z0-9._~+/=-]+/g, '$1 [REDACTED]')
              .replace(/hop_[a-f0-9]{64}/g, '[REDACTED]')
              .slice(0, 2000),
          ),
      );
    }
  }
  if (diagnostics.length > 4096) complete = false;
  await writeFile(join(evidence, 'plugin-diagnostics.log'), diagnostics.slice(0, 4096).join('\n'));
  try {
    const serverInventory = JSON.parse(
      await readFile(join(evidence, 'server-inventory.json'), 'utf8'),
    );
    assertServiceInventory(serverInventory, {
      plugin: join(env.OPENCODE_CONFIG_DIR, 'plugins/proceed-qualification'),
    });
    const inventory = assertPluginInventory(diagnostics.slice(0, 4096), {
      plugin: join(env.OPENCODE_CONFIG_DIR, 'plugins/proceed-qualification'),
      entry: join(env.OPENCODE_CONFIG_DIR, 'plugins/proceed-qualification/tui.ts'),
      complete,
    });
    await writeFile(
      join(evidence, 'plugin-inventory.json'),
      JSON.stringify({ ...inventory, serverInventory }, null, 2),
    );
    checks.inventory = 'PASS';
  } catch (error) {
    checks.inventory = 'FAIL';
    failure ??= error.message;
  }
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify(
      {
        status: failure ? 'FAIL' : 'PASS',
        failure,
        checks,
        scope: 'Linux platform/client primitives only',
        elapsed: Date.now() - started,
        descendantCleanup: 'Outer private PID namespace destruction required',
      },
      null,
      2,
    ),
  );
}
// The outer runner destroys and inspects the whole namespace, even if a private
// serve child survived the TUI. Root-process exit is not descendant cleanup proof.
process.exit(failure ? 1 : 0);
