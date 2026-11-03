// TEST ONLY: intercept the worker's fulfilled-client continuation before the real writer.
import { createPortableBroker } from '../../src/broker/portable.js';
import { Journal } from '../../src/journal/journal.js';
const mode = new URL(import.meta.url).searchParams.get('method');
const method = mode === 'controls' ? 'recordControlsRetired' : 'recordStatusShown';
// Discover the production prototype without recovery, writes, state or receipts.
const prototype = Object.getPrototypeOf(createPortableBroker({
  journal: { append: Journal.prototype.append, recover: Journal.prototype.recover }, owners: [], port: 0,
}));
const writer = prototype[method];
let release, armed = true;
process.on('message', m => { if (m.kind === 'release-writer') release?.(); });
if (['controls', 'status'].includes(mode)) prototype[method] = async function (input) {
  if (armed) {
    armed = false;
    // The actual worker reaches this call only after awaiting and validating its
    // actual fixed-origin client's fulfilled Message. No receipt writer has run.
    process.channel?.ref();
    process.send?.({ kind: 'fulfilled-before-writer', method, input });
    await new Promise(done => { release = done; });
  }
  process.send?.({ kind: 'real-writer-entry', method, input });
  const value = await writer.call(this, input);
  process.send?.({ kind: 'real-writer-result', method, value });
  process.channel?.unref();
  return value;
};
const preload = new URL('./poller-public-preload.mjs', import.meta.url);
preload.searchParams.set('mode', `${mode}-hold`);
await import(preload.href);
