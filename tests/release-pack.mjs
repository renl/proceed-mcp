// TEST ONLY. Explicit package/install operation confined to ignored local scratch.
// Run only after metadata gates pass. Never publishes or reads ambient npm config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, cp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { resolve, join, isAbsolute, basename } from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { retainVerifiedArtifact, safeSmokeDiagnostic } from './support/release-artifact.mjs';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'qualified Node 24 required');
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
let retained;
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
    // Raw TAP can contain assertion operands. Do not persist or publish it.
    let diagnostic;
    try { diagnostic = JSON.parse(readFileSync(join(run, 'smoke-diagnostic.json'), 'utf8')); }
    catch { diagnostic = { error: 'OTHER' }; }
    const safe = safeSmokeDiagnostic(diagnostic);
    writeFileSync(`${record}-smoke.json`, JSON.stringify(safe));
    console.log('installed-smoke', JSON.stringify(safe));
  }
  assert.ifError(child.error);
  assert.equal(child.status, 0, `package check failed in ${phase}, no private output emitted`);
  return child.stdout;
};
const npmRun = (args, cwd) => execute(process.execPath, [npm, ...args, '--offline', '--ignore-scripts',
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
  assert.equal(packed.name, '@meshimize/proceed-mcp');
  assert.equal(packed.version, '0.1.0-preview.1');
  assert.equal(packed.filename, 'meshimize-proceed-mcp-0.1.0-preview.1.tgz');
  const packedHash = createHash('sha256').update(await readFile(join(run, packed.filename))).digest('hex');
  await writeFile(`${record}-artifact.json`, JSON.stringify({ filename: packed.filename,
    sha256: packedHash,
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
  npmRun(['install', join(run, packed.filename), '--prefix', install, '--omit=dev', '--package-lock=false'], install);
  const installed = join(install, 'node_modules', '@meshimize', 'proceed-mcp');
  for (const path of paths) {
    assert.deepEqual(await readFile(join(installed, path)), await readFile(join(stage, path)),
      'installed contents equal clean package input');
  }
  // Inspect actual installed tarball bytes, not a fabricated scoped pack fixture.
  const readme = await readFile(join(installed, 'README.md'), 'utf8');
  assert.match(readme, /@meshimize\/proceed-mcp@0\.1\.0-preview\.1/);
  assert.match(readme, /--package\s+@meshimize\/proceed-mcp@0\.1\.0-preview\.1\s+--\s+proceed-mcp/);
  assert.doesNotMatch(readme, /(?:--package\s+|npm install[^\r\n]*\s)proceed-mcp@/);
  await writeFile(`${record}-readme.json`, JSON.stringify({
    sha256: createHash('sha256').update(readme).digest('hex'), scopedExamples: 'pass' }));
  phase = 'installed-public-smoke'; await progress();
  execute(process.execPath, ['--test', 'tests/release-installed.test.mjs'], resolve('.'), 50000,
    { ...env, PROCEED_TEST_INSTALL_PREFIX: install,
      PROCEED_TEST_SMOKE_REPORT: join(run, 'smoke-diagnostic.json'),
      PROCEED_TEST_INSTALLED_BIN: join(installed, 'bin', 'proceed-mcp.js') });
  phase = 'assertions-pass'; await progress();
  if (process.env.PROCEED_TEST_ARTIFACT_DIR) {
    const bytes = await readFile(join(run, packed.filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), packedHash, 'asserted tarball unchanged');
    retained = await retainVerifiedArtifact({ tarballPath: join(run, packed.filename),
      artifactDir: process.env.PROCEED_TEST_ARTIFACT_DIR,
      manifest: { schemaVersion: 1, package: packed.name, version: packed.version,
        filename: packed.filename, sha256: packedHash,
        bytes: bytes.length, files: packed.files.map(({ path, size }) => ({ path, size })),
        node: process.versions.node, platform: process.platform } });
  }
} finally {
  try {
  await rm(run, { recursive: true, maxRetries: 3, retryDelay: 100 });
  await assert.rejects(access(run), { code: 'ENOENT' });
  if (retained) await retained(run);
  await writeFile(`${record}-cleanup.json`, '{"cleanup":"pass"}');
  console.log('package-cleanup', '{"cleanup":"pass"}');
  } catch {
    await writeFile(`${record}-cleanup.json`, '{"cleanup":"fail"}');
    console.log('package-cleanup', '{"cleanup":"fail"}');
    throw new Error('package cleanup failed, private details withheld');
  }
}
