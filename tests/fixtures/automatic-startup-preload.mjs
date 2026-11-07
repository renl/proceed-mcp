// TEST ONLY. Synthetic offline transport and run-owned process observation.
// No env token injection, IPC readiness or production-only endpoints.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';

const self = new URL(import.meta.url);
const root = self.searchParams.get('root');
if (!root || !resolve(root).includes('/fixtures/')) throw Error('isolated fixture root required');
const manifest = join(root, 'owned-processes.jsonl');
const record = (value) => fs.appendFileSync(manifest, `${JSON.stringify(value)}\n`);
record({ event: 'start', pid: process.pid, parent: process.ppid, command: process.argv[2] });
process.once('exit', () => record({ event: 'exit', pid: process.pid }));
const credentialIndex = process.argv.indexOf('--telegram-token-file');
const credential = credentialIndex < 0 ? undefined : process.argv[credentialIndex + 1];
// Deterministic filesystem-failure scheduling at the real handle boundary.
// Only an explicitly selected synthetic file inside this run can be affected.
// These hooks never manufacture successful protection or change product results.
const fault = process.env.PROCEED_TEST_CREDENTIAL_FAULT;
const faultFile = process.env.PROCEED_TEST_CREDENTIAL_FAULT_FILE;
if (fault) {
  if (!faultFile || !resolve(faultFile).startsWith(`${resolve(root)}/`))
    throw Error('fault target must belong to this isolated run');
  const open = fsp.open.bind(fsp);
  fsp.open = async (path, ...args) => {
    if (String(path) !== faultFile) return open(path, ...args);
    if (fault === 'load-deadline' && process.argv[2] === 'serve') {
      // A real pending credential-open phase, not a shortened product clock.
      // The child's 150000 ms startup budget must expire before it can publish.
      record({ event: 'credential-fault', fault, pid: process.pid });
      await new Promise((done) => setTimeout(done, 152000));
    }
    if (fault === 'load-substitute') {
      await fsp.rename(faultFile, `${faultFile}.original`);
      await fsp.writeFile(faultFile, 'SYNTHETIC_REPLACEMENT\n', { mode: 0o600 });
      record({ event: 'credential-fault', fault, pid: process.pid });
    }
    const handle = await open(path, ...args);
    if (fault === 'load-unsafe-handle') {
      await handle.chmod(0o644);
      record({ event: 'credential-fault', fault, pid: process.pid });
    }
    const read = handle.readFile.bind(handle);
    handle.readFile = async (...parameters) => {
      record({ event: 'credential-content-read', pid: process.pid });
      if (fault === 'load-read-failure') {
        record({ event: 'credential-fault', fault, pid: process.pid });
        throw Object.assign(Error('synthetic read failure'), { code: 'EIO' });
      }
      return read(...parameters);
    };
    const write = handle.writeFile.bind(handle);
    handle.writeFile = async (...parameters) => {
      if (fault === 'write-failure' || fault === 'write-replacement') {
        if (fault === 'write-replacement') {
          await fsp.rename(faultFile, `${faultFile}.original`);
          await fsp.writeFile(faultFile, 'SYNTHETIC_REPLACEMENT\n', { mode: 0o600 });
        }
        record({ event: 'credential-fault', fault, pid: process.pid });
        throw Object.assign(Error('synthetic write failure'), { code: 'EIO' });
      }
      return write(...parameters);
    };
    return handle;
  };
}
for (const [owner, names] of [
  [fs, ['open', 'openSync', 'readFile', 'readFileSync']],
  [fsp, ['open', 'readFile']],
]) {
  for (const name of names) {
    const original = owner[name].bind(owner);
    owner[name] = (path, ...args) => {
      const selected = String(path);
      if (credential && selected === credential)
        record({
          event: 'credential-access',
          pid: process.pid,
          adapter: process.argv[2] === 'mcp',
        });
      if (selected.endsWith('/journal.log') && name.startsWith('open'))
        record({ event: 'journal-open', pid: process.pid });
      return original(path, ...args);
    };
  }
}
const originalSpawn = cp.spawn;
cp.spawn = (file, args, options) => {
  const forbidden = ['PROCEED_TELEGRAM_BOT_TOKEN'];
  record({
    event: 'launch',
    pid: process.pid,
    privateEnvironment: forbidden.some((key) => Boolean(options?.env?.[key])),
    privateArguments: (Array.isArray(args) ? args : []).some((value) =>
      /SYNTHETIC_CHECKPOINT|SYNTHETIC_INHERITED|Bearer /.test(String(value)),
    ),
    shell: Boolean(options?.shell),
  });
  // Observe real production launch/lifetime. Do not change detached/stdio/env.
  if (file === process.execPath && Array.isArray(args)) args = ['--import', self.href, ...args];
  return originalSpawn(file, args, options);
};
const originalRequest = http.request.bind(http);
const originalHttpsRequest = https.request.bind(https);
http.request = (url, ...args) => {
  const host =
    typeof url === 'object' && !(url instanceof URL)
      ? (url.hostname ?? url.host)
      : new URL(url).hostname;
  if (host !== '127.0.0.1') throw Error('offline checkpoint refuses nonloopback HTTP');
  return originalRequest(url, ...args);
};
https.request = (url, ...args) => {
  if (
    typeof url === 'object' &&
    !(url instanceof URL) &&
    (url.hostname ?? url.host) === '127.0.0.1'
  )
    return originalHttpsRequest(url, ...args);
  const address = new URL(url);
  if (address.hostname === '127.0.0.1') return originalHttpsRequest(url, ...args);
  if (address.origin !== 'https://api.telegram.org')
    throw Error('offline checkpoint refuses external HTTPS');
  record({ event: 'telegram', pid: process.pid, method: address.pathname.split('/').at(-1) });
  // Preserve existing fixed-origin client call shape, replacing only its wire.
  return originalRequest(
    `http://127.0.0.1:${fs.readFileSync(join(root, 'telegram-port'), 'utf8')}/${address.pathname.split('/').at(-1)}`,
    ...args,
  );
};
syncBuiltinESMExports();
