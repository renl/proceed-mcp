// TEST ONLY transport injection. No product imports, decision/reset API or live access.
import http from 'node:http';
import https from 'node:https';
import { dirname } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';

const target = new URL(import.meta.url).searchParams.get('fixture');
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target)) throw Error('offline fixture required');
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = dirname(state);
if (process.platform === 'win32') process.env.PATHEXT = '.EXE';
process.env.PROCEED_TELEGRAM_BOT_TOKEN = 'offline-synthetic-token';
const request = http.request.bind(http);
http.request = (url, options, callback) => {
  const address = new URL(url);
  if (address.hostname !== '127.0.0.1' || address.protocol !== 'http:') {
    throw Error('offline harness forbids nonloopback HTTP');
  }
  return request(url, options, callback);
};
https.request = (url, options, callback) => {
  const address = new URL(url);
  if (address.origin !== 'https://api.telegram.org'
    || !/^\/botoffline-synthetic-token\/[A-Za-z]+$/.test(address.pathname)) {
    throw Error('offline harness forbids external HTTPS');
  }
  return request(`${target}/${address.pathname.split('/').at(-1)}`, options, callback);
};
syncBuiltinESMExports();
process.on('message', (message) => {
  if (message.kind === 'stop') process.emit('SIGTERM');
});
process.channel?.unref();
process.send?.({ kind: 'ready' });
