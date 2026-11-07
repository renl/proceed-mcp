// TEST ONLY. Synthetic offline transport and run-owned process observation.
// No env token injection, IPC readiness or production-only endpoints.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports, registerHooks } from 'node:module';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const self = new URL(import.meta.url);
const root = self.searchParams.get('root');
if (!root || !resolve(root).includes('/fixtures/')) throw Error('isolated fixture root required');
const installed = self.searchParams.get('installed');
if (installed) {
  if (resolve(process.argv[1]) !== installed)
    throw Error('automatic child must use same installed entry');
  const packageRoot = dirname(dirname(installed)) + '/';
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context);
      if (
        context.parentURL?.startsWith('file:') &&
        fileURLToPath(context.parentURL).startsWith(packageRoot) &&
        result.url.startsWith('file:') &&
        !fileURLToPath(result.url).startsWith(packageRoot)
      )
        throw Error('installed package attempted repository fallback');
      return result;
    },
  });
}
const manifest = join(root, 'owned-processes.jsonl');
// Reuse the existing deterministic expiry clock only when explicitly selected.
if (process.env.PROCEED_TEST_CLOCK) {
  const clock = new URL('./portable-clock-preload.mjs', import.meta.url);
  clock.searchParams.set('clock', process.env.PROCEED_TEST_CLOCK);
  await import(clock.href);
}
const record = (value) => fs.appendFileSync(manifest, `${JSON.stringify(value)}\n`);
record({
  event: 'start',
  pid: process.pid,
  parent: process.ppid,
  command: process.argv[2],
  at: Date.now(),
});
process.once('exit', () => record({ event: 'exit', pid: process.pid }));
// Witness actual public publication/admission, not periodic polling alone.
// Fixed metadata only. Never retain response bodies or startup output.
const stdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  if (String(chunk).includes('broker ready on https://127.0.0.1:'))
    record({ event: 'ready-publication', pid: process.pid, at: Date.now() });
  return stdoutWrite(chunk, ...args);
};
const responseEnd = http.ServerResponse.prototype.end;
http.ServerResponse.prototype.end = function (chunk, ...args) {
  if (this.req?.url === '/v1/ready' && this.statusCode === 200) {
    try {
      const body = JSON.parse(String(chunk));
      if (body.service === 'proceed-mcp' && body.local_ready === true)
        record({ event: 'ready-admission', pid: process.pid, at: Date.now() });
    } catch {
      /* not a completed readiness envelope */
    }
  }
  return responseEnd.call(this, chunk, ...args);
};
const credentialIndex = process.argv.indexOf('--telegram-token-file');
const credential = credentialIndex < 0 ? undefined : process.argv[credentialIndex + 1];
// Deterministic filesystem-failure scheduling at the real handle boundary.
// Only an explicitly selected synthetic file inside this run can be affected.
// These hooks never manufacture successful protection or change product results.
const fault = process.env.PROCEED_TEST_CREDENTIAL_FAULT;
const faultFile = process.env.PROCEED_TEST_CREDENTIAL_FAULT_FILE;
const stage = process.env.PROCEED_TEST_DEADLINE_STAGE;
const delayed = async (name) => {
  record({ event: 'deadline-phase-delay', phase: name, pid: process.pid, at: Date.now() });
  await new Promise((done) => setTimeout(done, 152000));
};
if (process.argv[2] === 'serve' && stage === 'entry') await delayed('entry');
if (process.argv[2] === 'serve' && stage === 'final-ready') {
  const serverListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    const callback = args.at(-1);
    if (typeof callback === 'function')
      args[args.length - 1] = () => {
        void delayed('final-ready').then(callback);
      };
    return serverListen.apply(this, args);
  };
}
if (fault) {
  if (!faultFile || !resolve(faultFile).startsWith(`${resolve(root)}/`))
    throw Error('fault target must belong to this isolated run');
  const open = fsp.open.bind(fsp);
  fsp.open = async (path, ...args) => {
    if (String(path) !== faultFile) return open(path, ...args);
    if (fault === 'load-slow' && process.argv[2] === 'serve') {
      record({ event: 'credential-fault', fault, pid: process.pid });
      await new Promise((done) => setTimeout(done, 2000));
    }
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
    if (fault === 'load-unsafe-handle' || fault === 'lock-unsafe-handle') {
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
      if (
        [
          'write-failure',
          'write-replacement',
          'lock-write-failure',
          'lock-write-replacement',
        ].includes(fault)
      ) {
        if (fault.endsWith('replacement')) {
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
// Hold an actual journal close during shutdown. The test releases its own gate,
// never kills a flushing process or substitutes a successful drain.
const journalOpen = fsp.open.bind(fsp);
fsp.open = async (path, ...args) => {
  if (process.argv[2] === 'serve' && stage === 'ownership' && String(path).endsWith('/broker.lock'))
    await delayed('ownership');
  if (process.argv[2] === 'serve' && stage === 'recovery' && String(path).endsWith('/journal.log'))
    await delayed('recovery');
  const handle = await journalOpen(path, ...args);
  if (String(path).endsWith('/journal.log')) {
    const close = handle.close.bind(handle);
    handle.close = async () => {
      const gate = join(root, 'hold-journal-close');
      if (fs.existsSync(gate)) {
        record({ event: 'journal-close-held', pid: process.pid });
        const end = performance.now() + 40000;
        while (fs.existsSync(gate) && performance.now() < end)
          await new Promise((done) => setTimeout(done, 25));
      }
      return close();
    };
  }
  return handle;
};
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
