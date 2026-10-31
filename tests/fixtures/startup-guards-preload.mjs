// TEST ONLY: offline transport refusal and read-only startup observation.
// Never imported by production; no supported-version override or live traffic.
import https from 'node:https';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { join, basename, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const state = process.argv[process.argv.indexOf('--state-dir') + 1];
const lock = join(state, 'broker.lock');
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = dirname(state);
// managed-spike intentionally strips ambient shell settings; Windows ACL
// subprocesses need executable suffix resolution, not a protection bypass.
if (process.platform === 'win32') process.env.PATHEXT = '.EXE';
process.env.PROCEED_TELEGRAM_BOT_TOKEN = 'offline-fixture-not-a-token';
process.env.PROCEED_TEST_HOST_PASSWORD = 'offline-fixture-not-a-secret';
https.request = () => {
  const request = new EventEmitter();
  request.setTimeout = () => request;
  request.destroy = () => {};
  request.end = () => queueMicrotask(() => request.emit('error', new Error('offline only')));
  return request;
};
const originalOpen = fs.open;
fs.open = async function (path, ...args) {
  if (basename(String(path)) === 'journal.log') {
    process.send?.({ kind: 'journal-open', ownerPresent: existsSync(lock) });
  }
  return originalOpen.call(this, path, ...args);
};
const originalRead = fs.readFile;
fs.readFile = async function (path, ...args) {
  if (String(path) === lock && existsSync(lock)
    && readFileSync(lock, 'utf8') === 'READ_DENIED') {
    throw Object.assign(new Error('test-owned unreadable record'), { code: 'EACCES' });
  }
  return originalRead.call(this, path, ...args);
};
syncBuiltinESMExports();
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  if (String(chunk).includes('broker ready on')) process.send?.({ kind: 'broker-ready' });
  return write(chunk, ...args);
};
process.on('message', (message) => {
  if (message.kind === 'stop') process.emit('SIGTERM');
});
// The CLI's signal handlers own graceful shutdown; IPC must not keep it alive.
process.channel?.unref();
process.send?.({ kind: 'ready' });
