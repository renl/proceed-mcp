// TEST ONLY. Existing pack procedure in a disposable container-local checkout.
// Actual qualified npm resolution, no global/user configuration or downloads.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, readdir, readFile, realpath, writeFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';

assert.equal(process.versions.node, '24.22.2');
assert.equal(process.env.PROCEED_TEST_FIXTURES, '/fixtures');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
const baseline = new Set((await readdir('/proc')).filter((n) => /^\d+$/.test(n)));
const candidate = '/fixtures/package-candidate';
await mkdir(candidate);
await cp('/workspace', candidate, { recursive: true });
process.chdir(candidate);
const results = [];
let cleanup = false;
const deadline = performance.now() + 480000;
const timer = setTimeout(() => process.exit(1), 540000);
const execute = async (file, args, env, timeout = 180000, input = '') => {
  const child = spawn(file, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  let output = '',
    size = 0;
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      size += chunk.length;
      if (size <= 262144) output += chunk;
      else child.kill();
    });
  const watchdog = setTimeout(
    () => child.kill(),
    Math.min(timeout, Math.max(1, deadline - performance.now())),
  );
  const code = await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('close', done);
  });
  clearTimeout(watchdog);
  assert.ok(size <= 262144);
  assert.equal(code, 0, 'bounded package operation, private diagnostics withheld');
  return output;
};
try {
  await writeFile('/evidence/phase.json', JSON.stringify({ phase: 'npm-resolution' }));
  const path = (await execute('/usr/bin/which', ['npm'], process.env, 5000)).trim();
  const npm = await realpath(path);
  assert.equal(
    basename(npm),
    'npm-cli.js',
    'resolve actual image npm CLI, not a guessed installation',
  );
  const config = '/fixtures/npmrc';
  const global = '/fixtures/global-npmrc';
  await writeFile(config, 'audit=false\nfund=false\nignore-scripts=true\nupdate-notifier=false\n');
  await writeFile(global, '');
  const env = {
    PATH: process.env.PATH,
    HOME: '/fixtures',
    TMP: '/fixtures',
    TEMP: '/fixtures',
    TMPDIR: '/fixtures',
    NPM_CONFIG_USERCONFIG: config,
    NPM_CONFIG_GLOBALCONFIG: global,
    NPM_CONFIG_CACHE: '/fixtures/npm-cache',
    NPM_CONFIG_LOGS_DIR: '/fixtures/npm-logs',
  };
  assert.equal((await execute(process.execPath, [npm, '--version'], env, 5000)).trim(), '11.19.1');
  results.push({ id: 'AUTO-PACKAGE-NPM-RESOLUTION', status: 'PASS' });
  await writeFile(
    '/evidence/npm.json',
    JSON.stringify({ node: process.versions.node, npm: '11.19.1', actualCli: npm }),
  );
  await writeFile('/evidence/phase.json', JSON.stringify({ phase: 'readme-bash-example' }));
  const readme = await readFile('README.md', 'utf8');
  const snippets = [...readme.matchAll(/```bash\r?\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.equal(snippets.length, 1, 'one authored Bash provisioning example');
  await execute('/usr/bin/bash', ['--noprofile', '--norc', '-n'], env, 5000, snippets[0]);
  const state = '/fixtures/readme-state';
  const home = '/fixtures/readme-home';
  await mkdir(home, { mode: 0o700 });
  const exampleEnv = { ...env, HOME: home };
  await execute(
    process.execPath,
    ['bin/proceed-mcp.js', 'init', '--state-dir', state],
    exampleEnv,
    5000,
  );
  const script =
    `proceed-mcp() { "${process.execPath}" "${candidate}/bin/proceed-mcp.js" "$@"; }\n` +
    snippets[0].replace('/absolute/path/to/proceed-state', state);
  const output = await execute(
    '/usr/bin/bash',
    ['--noprofile', '--norc', '-c', script],
    exampleEnv,
    5000,
    'SYNTHETIC_README_EXAMPLE\n',
  );
  assert.ok(!output.includes('SYNTHETIC_README_EXAMPLE'));
  const stateKey = createHash('sha256')
    .update(await realpath(state))
    .digest('hex');
  assert.equal(
    await readFile(`${home}/.proceed-mcp-credentials/${stateKey}/telegram.token`, 'utf8'),
    'SYNTHETIC_README_EXAMPLE\n',
  );
  results.push({ id: 'AUTO-README-BASH-SYNTAX-SYNTHETIC-ADMISSION', status: 'PASS' });
  await writeFile(
    '/evidence/phase.json',
    JSON.stringify({ phase: 'pack-install-public-workflow' }),
  );
  await mkdir(join(candidate, '.scratch'), { recursive: true });
  await execute(process.execPath, ['tests/release-pack.mjs'], {
    ...env,
    PROCEED_TEST_NPM_CLI: npm,
    PROCEED_TEST_AUTOMATIC_PACKAGE: '1',
    PROCEED_TEST_ARTIFACT_DIR: join(candidate, '.scratch/retained-automatic-artifact'),
  });
  const retained = join(candidate, '.scratch/retained-automatic-artifact');
  const manifest = JSON.parse(await readFile(join(retained, 'artifact.json')));
  assert.equal(manifest.cleanup, 'pass');
  const bytes = await readFile(join(retained, manifest.filename));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  // Package bytes contain only the already admitted public package allowlist.
  // Retain exact local bytes and inventory, never raw TAP, fixtures or authority.
  await mkdir('/evidence/artifact');
  await cp(retained, '/evidence/artifact', { recursive: true });
  await writeFile(
    '/evidence/artifact/candidate.json',
    JSON.stringify({
      identity: 'local-unreleased-candidate-not-public-preview',
      sha256: manifest.sha256,
      versionDisposition: 'required-before-PR',
    }),
  );
  results.push({ id: 'AUTO-INSTALLED-BYTES-PUBLIC-MCP-AUTOMATIC-RESPOND', status: 'PASS' });
} catch {
  results.push({ id: 'AUTO-PACKAGE-ADMISSION', status: 'FAIL' });
} finally {
  // Preserve safe phase/exit diagnostics even when the package procedure fails.
  try {
    const root = join(candidate, '.scratch/preview-package');
    for (const name of await readdir(root)) {
      if (!/^run-[A-Za-z0-9_-]+-(?:progress|[a-z-]+-exit|cleanup|smoke)\.json$/.test(name))
        continue;
      const value = JSON.parse(await readFile(join(root, name)));
      await writeFile(`/evidence/${name}`, JSON.stringify(value));
    }
  } catch {
    /* no package phase reached */
  }
  cleanup = (await readdir('/proc')).filter((n) => /^\d+$/.test(n)).every((n) => baseline.has(n));
  if (cleanup) await rm(candidate, { recursive: true });
  clearTimeout(timer);
  const assertions = results.length === 3 && results.every((item) => item.status === 'PASS');
  console.log(
    JSON.stringify({
      assertions: assertions ? 'PASS' : 'FAIL',
      cleanup: cleanup ? 'PASS' : 'UNVERIFIED',
      results,
    }),
  );
  process.exitCode = assertions && cleanup ? 0 : 1;
}
