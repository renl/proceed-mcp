// TEST ONLY: observe ordinary core settlement, fault actual run-owned Journal I/O.
// No replacement business result, production endpoint or synthetic history.
import fs from 'node:fs/promises';
import https from 'node:https';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { Journal } from '../../src/journal/journal.js';
import { createPortableBroker } from '../../src/broker/portable.js';

const state = process.argv[process.argv.indexOf('--state-dir') + 1];
const emit = (kind, extra = {}) => process.send?.({ kind, ...extra });
let armed, active, release, broker;
const view = () => broker?.snapshot().requests;
const prototype = Object.getPrototypeOf(createPortableBroker({
  journal: { append: Journal.prototype.append, recover: Journal.prototype.recover }, owners: [], port: 0,
}));
for (const name of ['openResponse', 'resolveCallback', 'resolveReply', 'resolveCommand']) {
  const original = prototype[name];
  prototype[name] = function (...args) { broker = this; return original.apply(this, args); };
}
const wait = prototype.waitRequest;
prototype.waitRequest = function (...args) {
  broker = this;
  return wait.apply(this, args).then(value => {
    emit('wait-settled', { value, requests: view() });
    return value;
  });
};
const append = Journal.prototype.append;
Journal.prototype.append = async function (...args) {
  const selected = armed && args[0].some(m => m.op === armed.op);
  if (!selected) return append.apply(this, args);
  active = armed; armed = null;
  emit('fault-append', { mutations: args[0] });
  try { return await append.apply(this, args); }
  finally { active = null; }
};
const open = fs.open;
fs.open = async (...args) => {
  const handle = await open(...args);
  if (String(args[0]) !== join(state, 'journal.log')) return handle;
  const write = handle.write.bind(handle), sync = handle.sync.bind(handle);
  handle.write = async (...a) => {
    if (active?.mode === 'write-fail') {
      emit('write-failed', { requests: view() });
      throw Error('SYNTHETIC_PRIVATE_STORAGE_DETAIL');
    }
    return write(...a);
  };
  handle.sync = async () => {
    if (active) {
      emit('flush-entered', { requests: view() });
      if (active.mode === 'sync-fail') throw Error('SYNTHETIC_PRIVATE_STORAGE_DETAIL');
      await new Promise(done => { release = done; });
    }
    await sync();
    if (active) emit('flush-complete', { requests: view() });
  };
  return handle;
};
const request = https.request;
https.request = (...args) => {
  if (new URL(args[0]).pathname.endsWith('/answerCallbackQuery')) emit('ack-start', { requests: view() });
  const req = request(...args), end = req.end.bind(req);
  if (new URL(args[0]).pathname.endsWith('/sendMessage')) req.end = body => {
    const payload = JSON.parse(String(body));
    const role = payload.reply_markup?.force_reply ? 'prompt' : /^(Approval|Rejection|Instructions) recorded/.test(payload.text) ? 'outcome' : null;
    if (role) emit('ui-start', { role, requests: view() });
    return end(body);
  };
  return req;
};
syncBuiltinESMExports();
process.on('message', m => {
  if (m.kind === 'arm-journal') { armed = { op: m.op, mode: m.mode }; emit('journal-armed'); }
  if (m.kind === 'release-journal') { release?.(); release = null; }
});
