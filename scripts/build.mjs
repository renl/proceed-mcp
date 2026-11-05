// Build validation for the shipped package. The artifact is runnable ESM, so
// there is no transpile step; this script proves the shipped graph parses, the
// declared executable exists, and production sources never reach into tests.
import { readFile, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOTS = ['bin', 'src'];
const failures = [];

async function collectJavaScript(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJavaScript(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));

const binTargets = Object.values(manifest.bin ?? {});
if (binTargets.length === 0) {
  failures.push('package.json declares no bin entry');
}
for (const target of binTargets) {
  const absolute = join(projectRoot, target);
  const info = await stat(absolute).catch(() => null);
  if (info === null) {
    failures.push(`bin target ${target} does not exist`);
    continue;
  }
  const firstLine = (await readFile(absolute, 'utf8')).split('\n', 1)[0];
  if (!firstLine.startsWith('#!/usr/bin/env node')) {
    failures.push(`bin target ${target} is missing its node shebang`);
  }
}

const sources = [];
for (const root of SOURCE_ROOTS) {
  sources.push(...(await collectJavaScript(join(projectRoot, root))));
}

for (const file of sources) {
  const relativePath = relative(projectRoot, file).split('\\').join('/');
  const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (syntax.status !== 0) {
    failures.push(`${relativePath} fails a syntax check: ${syntax.stderr.trim()}`);
  }

  const text = await readFile(file, 'utf8');
  if (/from\s+['"][^'"]*tests\//.test(text) || /require\(\s*['"][^'"]*tests\//.test(text)) {
    failures.push(`${relativePath} imports from tests/; production must not depend on tests`);
  }
}

if (sources.length === 0) {
  failures.push('no production sources were found');
}

const engines = manifest.engines?.node;
if (typeof engines !== 'string' || engines.length === 0) {
  failures.push('package.json must declare a provisional engines.node target');
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`build: ${failure}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(
    `build: ${sources.length} production modules parse; bin target(s) ${binTargets.join(', ')} ready\n`,
  );
}
