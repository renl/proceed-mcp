// TEST ONLY: observe earliest real listen; graceful CLI signal; deny all network clients.
import { Server } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
const emit = Server.prototype.emit;
Server.prototype.emit = function (event, ...args) {
  if (event === 'listening') process.send?.({ kind: 'listening', bytes: readFileSync(join(state, 'journal.log')).toString('base64') });
  return emit.call(this, event, ...args);
};
const deny = () => { process.send?.({ kind: 'network-attempt' }); throw new Error('synthetic network withheld'); };
http.request = https.request = http.get = https.get = globalThis.fetch = deny;
syncBuiltinESMExports();
process.on('message', m => { if (m.kind === 'stop') process.emit('SIGTERM'); });
process.channel?.unref();
