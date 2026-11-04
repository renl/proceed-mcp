// TEST ONLY. Explicit package/install operation confined to ignored local scratch.
// Run only after metadata gates pass. Never publishes or reads ambient npm config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { resolve, join, isAbsolute, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'qualified Node 24 required');
const npm = process.env.PROCEED_TEST_NPM_CLI;
assert.ok(npm && isAbsolute(npm), 'explicit approved npm-cli.js path required');
const root = resolve('.scratch/preview-package');
await mkdir(root, { recursive: true });
const run = await mkdtemp(join(root, 'run-'));
const record = join(root, basename(run));
const stage = join(run, 'source');
const install = join(run, 'install with spaces');
await mkdir(stage);
await mkdir(install);
const config = join(run, 'npmrc');
const globalConfig = join(run, 'global-npmrc');
await writeFile(config, 'audit=false\nfund=false\nupdate-notifier=false\nignore-scripts=true\n');
await writeFile(globalConfig, '');
const env = Object.fromEntries(['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC']
  .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { TEMP: run, TMP: run, TMPDIR: run, HOME: run, USERPROFILE: run,
  NPM_CONFIG_USERCONFIG: config, NPM_CONFIG_GLOBALCONFIG: globalConfig,
  NPM_CONFIG_CACHE: join(run, 'cache'), NPM_CONFIG_LOGS_DIR: join(run, 'logs') });
let phase = 'metadata';
const deadline = performance.now() + 150000;
const progress = async () => writeFile(`${record}-progress.json`, JSON.stringify({ phase }));
const execute = (file, args, cwd, timeout = 30000, childEnv = env) => {
  const remaining = Math.floor(deadline - performance.now() - 5000);
  assert.ok(remaining > 0, 'aggregate package deadline reserves teardown');
  const child = spawnSync(file, args, { cwd, env: childEnv, timeout: Math.min(timeout, remaining), encoding: 'utf8',
    windowsHide: true, maxBuffer: 1024 * 1024 });
  writeFileSync(`${record}-${phase}-exit.json`, JSON.stringify({ status: child.status,
    signal: child.signal, error: child.error?.code ?? null }));
  if (phase === 'installed-public-smoke') {
    writeFileSync(`${record}-installed.tap`, child.stdout);
  }
  assert.ifError(child.error);
  assert.equal(child.status, 0, `package check failed in ${phase}, no private output emitted`);
  return child.stdout;
};
const npmRun = (args, cwd) => execute(process.execPath, [npm, ...args, '--ignore-scripts',
  '--userconfig', config, '--globalconfig', globalConfig, '--cache', join(run, 'cache'),
  '--logs-dir', join(run, 'logs'), '--no-audit', '--no-fund'], cwd);
try {
  await progress();
  execute(process.execPath, ['--test', 'tests/release-metadata.test.mjs'], resolve('.'));
  for (const path of ['package.json', 'bin', 'src', 'README.md', 'LICENSE']) {
    await cp(resolve(path), join(stage, path), { recursive: true });
  }
  phase = 'pack'; await progress();
  const [packed] = JSON.parse(npmRun(['pack', '--json', '--pack-destination', run], stage));
  assert.equal(packed.filename, 'proceed-mcp-0.1.0-preview.1.tgz');
  await writeFile(`${record}-artifact.json`, JSON.stringify({ filename: packed.filename,
    sha256: createHash('sha256').update(await readFile(join(run, packed.filename))).digest('hex'),
    files: packed.files.map(({ path, size }) => ({ path, size })) }));
  const paths = packed.files.map((entry) => entry.path);
  assert.ok(paths.includes('package.json') && paths.includes('LICENSE') && paths.includes('README.md'));
  for (const path of paths) {
    assert.ok(/^(?:package\.json|README\.md|LICENSE|(?:bin|src)\/[a-zA-Z0-9_./-]+\.js)$/.test(path),
      'unexpected shipped path');
    assert.ok(!path.split('/').some((part) => part === '..' || part.startsWith('.')), 'unsafe shipped path');
    const text = await readFile(join(stage, path), 'utf8');
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b\d{6,}:[A-Za-z0-9_-]{30,}\b/,
      'recognizable private key or bot credential must not ship');
  }
  phase = 'install'; await progress();
  await writeFile(join(install, 'package.json'), '{"private":true}');
  npmRun(['install', join(run, packed.filename), '--omit=dev', '--package-lock=false'], install);
  const installed = join(install, 'node_modules', 'proceed-mcp');
  for (const path of paths) {
    assert.deepEqual(await readFile(join(installed, path)), await readFile(join(stage, path)),
      'installed contents equal clean package input');
  }
  phase = 'installed-public-smoke'; await progress();
  execute(process.execPath, ['--test', 'tests/release-installed.test.mjs'], resolve('.'), 50000,
    { ...env, PROCEED_TEST_INSTALLED_BIN: join(installed, 'bin', 'proceed-mcp.js') });
  phase = 'assertions-pass'; await progress();
} finally {
  await rm(run, { recursive: true, maxRetries: 3, retryDelay: 100 });
  await assert.rejects(access(run), { code: 'ENOENT' });
  await writeFile(`${record}-cleanup.json`, '{"cleanup":"pass"}');
}
