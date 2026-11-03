// TEST ONLY: actual client construction, no Telegram socket/TLS/receipt proof.
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join, dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Journal } from '../../src/journal/journal.js';
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
const mode = new URL(import.meta.url).searchParams.get('mode');
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = dirname(state);
process.env.PROCEED_TELEGRAM_BOT_TOKEN = 'offline-synthetic-token';
if (process.platform === 'win32') process.env.PATHEXT = '.EXE';
const bytes = () => { try { return readFileSync(join(state, 'journal.log')).toString('base64'); } catch { return ''; } };
const emit = (kind, extra = {}) => process.send?.({ kind, ...extra });
if (mode === 'partial-start') globalThis.setInterval = () => {
  emit('startup-fault'); throw Error('synthetic presentation timer creation failure');
};
const requests = new Map(); let serial = 0, consuming = false, release, begin, cleanup = false;
const open = fs.open;
fs.open = async (...args) => {
  const file = await open(...args);
  if (String(args[0]) !== join(state, 'journal.log')) return file;
  const sync = file.sync.bind(file), write = file.write.bind(file), close = file.close.bind(file);
  file.write = async (...a) => { const result = await write(...a); emit('write', { bytes: bytes() }); return result; };
  file.sync = async () => {
     if ((consuming && ['hold', 'fail'].includes(mode)) || (consuming === 'sent' && mode === 'receipt-hold')) {
      emit('flush-entered', { bytes: bytes() });
      if (mode === 'fail') throw Error('synthetic flush failure');
      await new Promise(done => { release = done; });
    }
    await sync(); emit('flush', { bytes: bytes() });
  };
  file.close = async () => { await close(); emit('storage-close', { bytes: bytes() }); };
  return file;
};
const append = Journal.prototype.append;
Journal.prototype.append = async function (mutations) {
   consuming = mutations.some(m => m.op === 'telegram.presentation.sent') ? 'sent' : mutations.some(m => m.op === 'pairing.challenge.consume');
  emit('append-entered', { mutations });
  try { const value = await append.call(this, mutations); emit('committed', { mutations, bytes: bytes() }); return value; }
  finally { consuming = false; }
};
const local = http.request.bind(http);
http.request = (url, options, callback) => {
  const address = new URL(url);
  if (address.origin !== `http://127.0.0.1:${address.port}`) throw Error('offline HTTP guard');
  return local(url, options, response => {
    emit('local-response', { path: address.pathname, status: response.statusCode }); callback(response);
  });
};
http.get = https.get = globalThis.fetch = () => { throw Error('offline transport guard'); };
https.request = (url, options, callback) => {
  const address = new URL(url);
  if (address.origin !== 'https://api.telegram.org' || !/^\/botoffline-synthetic-token\/[A-Za-z]+$/.test(address.pathname)) throw Error('offline HTTPS guard');
  const id = ++serial, req = new EventEmitter();
  requests.set(id, { req, callback });
   req.setTimeout = (ms, callback) => { req.deadline = ms; req.timeout = callback; return req; };
  req.end = body => emit('request', { id, url, options, deadline: req.deadline, body: JSON.parse(String(body)), bytes: bytes() });
  req.destroy = () => {
    if (mode === 'late' && !cleanup) process.channel?.ref();
    emit('destroy', { id }); return req;
  };
  return req;
};
syncBuiltinESMExports();
process.on('message', m => {
  if (m.kind === 'go') begin();
  if (m.kind === 'stop') { process.emit('SIGTERM'); emit('stop-observed'); }
   if (m.kind === 'release') { cleanup = true; release?.(); process.channel?.unref(); }
   if (m.kind === 'fault') {
     const item = requests.get(m.id);
     if (m.fault === 'timeout') item.req.timeout();
     else item.req.emit('error', Error('SYNTHETIC_PRIVATE_DETAIL'));
     emit('fault-delivered', { id: m.id });
   }
  if (m.kind === 'response') {
    const item = requests.get(m.id); requests.delete(m.id);
    const res = new PassThrough(); res.statusCode = m.status ?? 200;
    item.callback(res); res.end(m.raw ?? JSON.stringify({ ok: true, result: m.result }));
    emit('response-delivered', { id: m.id });
    if (mode === 'late') process.channel?.unref();
  }
});
emit('ready');
await new Promise(done => { begin = done; });
process.channel?.unref();
