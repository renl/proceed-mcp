// TEST ONLY: ordinary production producer composition and real-writer barriers.
import { createPortableBroker } from '../../src/broker/portable.js';
import { Journal } from '../../src/journal/journal.js';
import { createPortablePresentationWorker } from '../../src/telegram/portable-presentation.js';
import { createTelegramClient } from '../../src/telegram/client.js';
const mode = new URL(import.meta.url).searchParams.get('method');
const prototype = Object.getPrototypeOf(createPortableBroker({
  journal: { append: Journal.prototype.append, recover: Journal.prototype.recover }, owners: [], port: 0,
}));
const emit = (kind, extra = {}) => process.send?.({ kind, ...extra });
let broker, extra, releaseWriter, releaseReturned, armed = true;
const prepare = prototype.preparePresentation;
prototype.preparePresentation = function (input) { broker = this; return prepare.call(this, input); };
const shown = prototype.recordStatusShown, returned = prototype.returnedRequest;
prototype.recordStatusShown = async function (input) {
  if (['stale', 'poststop', 'returned'].includes(mode) && armed) {
    armed = false; process.channel?.ref();
    emit('fulfilled-before-writer', { input });
    await new Promise(done => { releaseWriter = done; });
  }
  emit('real-writer-entry', { input });
  const value = await shown.call(this, input);
  emit('real-writer-result', { value }); process.channel?.unref(); return value;
};
prototype.returnedRequest = async function (input) {
  if (mode === 'returned') {
    process.channel?.ref(); emit('returned-held');
    await new Promise(done => { releaseReturned = done; });
  }
  return returned.call(this, input);
};
const acknowledge = prototype.acknowledgeRequest;
prototype.acknowledgeRequest = function (input) {
  emit('acknowledge-entered'); return acknowledge.call(this, input);
};
process.on('message', async m => {
  if (m.kind === 'release-returned' || m.kind === 'release') releaseReturned?.();
  if (m.kind === 'release-writer' || m.kind === 'release') releaseWriter?.();
  try {
    if (m.kind === 'copy-start') {
      // Both workers prepare the same real pending request before either send
      // result. No token, mapping, receipt or terminal state is synthesized.
      extra = createPortablePresentationWorker({ broker,
        telegram: createTelegramClient({ token: 'offline-synthetic-token' }) });
      extra.start(); emit('copy-started');
    }
    if (m.kind === 'copy-stop' || m.kind === 'stop') { await extra?.stop(); emit('copy-stopped'); }
  } catch (error) { emit('fixture-failure', { message: error.message }); }
});
const preload = new URL('./poller-public-preload.mjs', import.meta.url);
preload.searchParams.set('mode', mode === 'flush' ? 'status-hold' : '');
await import(preload.href);
