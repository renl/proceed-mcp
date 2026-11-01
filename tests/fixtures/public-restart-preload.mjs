// TEST ONLY: unchanged clock; completed real sync and earliest listener evidence.
import './runtime-scheduling-preload.mjs';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { Server } from 'node:net';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const state = process.argv[process.argv.indexOf('--state-dir') + 1];
const journal = join(state, 'journal.log');
const originalOpen = fs.open, emit = Server.prototype.emit;
let flushed = null, syncs = 0;
fs.open = async function (path, ...args) {
  const fh = await originalOpen.call(this, path, ...args);
  if (String(path) === journal) {
    const sync = fh.sync.bind(fh);
    fh.sync = async () => {
      const value = await sync();
      flushed = readFileSync(journal).toString('base64'); syncs++;
      return value;
    };
  }
  return fh;
};
syncBuiltinESMExports();
Server.prototype.emit = function (event, ...args) {
  if (event === 'listening') process.send?.({ kind: 'startup-proof', syncs,
    flushed, bytes: readFileSync(journal).toString('base64') });
  return emit.call(this, event, ...args);
};
