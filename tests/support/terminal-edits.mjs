// TEST ONLY: real core producers and Journal, controlled transport, no Telegram.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Journal } from '../../src/journal/journal.js';
import { readJournal } from '../../src/journal/framing.js';
import { createPortableBroker } from '../../src/broker/portable.js';
import { createPortablePresentationWorker } from '../../src/telegram/portable-presentation.js';
export const at = Date.parse('2026-11-03T00:00:00Z');
export const turn = () => new Promise(r => setImmediate(r));
export const message = (id = 7) => ({ message_id: id, date: 1793664000, chat: { id: 81, type: 'private' } });
const timer = setTimeout, clear = clearTimeout;
export async function until(check, ms = 900) {
  const end = performance.now() + ms;
  while (performance.now() < end) { if (await check()) return; await turn(); }
  assert.fail('terminal edit observation deadline');
}
export async function terminalEdits(t, work) {
  const root = resolve('.scratch/c2c-iii'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log');
  const releases = [], workers = [], logs = [], calls = []; let b, j, file, watchdog, samples = 0;
  const progress = phase => writeFile(join(dir, 'progress.json'), JSON.stringify({ phase }));
  const h = { now: at, syncing: async () => {}, calls, logs, get b() { return b; }, samples: () => samples,
    defer() { let resolvePromise, settled = false; const promise = new Promise(r => { resolvePromise = r; });
      const release = value => { settled = true; resolvePromise(value); }; releases.push(release); return { promise, release, get settled() { return settled; } }; },
    rows: async () => readJournal(await readFile(path)).transactions.flatMap(x => x.mutations),
    view: () => b.snapshot().requests.find(r => r.request_id === h.key.requestId),
    async reopen() {
      for (const w of workers) await w.stop(); await b?.close(); await j?.close();
      const initial = await Journal.open(path), sequence = initial.sequence; await initial.close(); file = await open(path, 'a');
      j = new Journal(path, { write: (...a) => file.write(...a), sync: async () => { await h.syncing(); await file.sync(); }, close: () => file.close() }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189, clock: () => { samples++; return h.now; } }); await b.recover();
    },
    async create(copies = [7], live = false) {
      const key = await b.reserveHandle({ ownerId: 'a' }); h.key = { ownerId: 'a', requestId: key.request_id, capability: key.request_capability };
      await b.createRequest({ ...h.key, requestHandle: key.request_handle, clientRequestId: 'edit', action: 'Question? <&>', context: '', expiresInSeconds: 60 });
      const prepared = await b.preparePresentation({ requestId: key.request_id });
      for (const messageId of copies) await b.recordPresentationSent({ requestId: key.request_id, callbackToken: prepared.callback_token, chatId: '81', messageId });
      const waiting = live ? b.waitRequest(h.key) : null; await turn(); await b.cancelRequest(h.key); if (waiting) await waiting;
    },
    fields(entry) { return { requestId: entry.request_id, chatId: entry.chat_id, messageId: entry.message_id, decisionId: entry.decision_id, ...(entry.kind === 'status' ? { deliveryState: entry.delivery_state } : {}) }; },
    async retire() { for (const e of b.presentationWork().edits) if (e.kind === 'controls') await b.recordControlsRetired(h.fields(e)); },
    evidence(kind) { return b[kind === 'ack' ? 'acknowledgeRequest' : 'returnedRequest']({ ...h.key, decisionId: h.view().decision_id }); },
    start(edit = async (_, p) => message(p.message_id), broker = b, traffic = null) {
      const telegram = { sendMessage: async () => assert.fail('terminal request must not resend') };
      for (const method of ['editMessageReplyMarkup', 'editMessageText']) telegram[method] = (payload, options) => {
        calls.push({ method, payload, ...options }); return edit(method, payload, options);
      };
      const w = createPortablePresentationWorker({ broker, telegram, logger: line => logs.push(line), traffic }); workers.push(w); w.start(); return w;
    },
  };
  const lifecycle = async () => {
    try {
      await progress('setup'); await h.reopen(); const c = await b.pairingChallenge(); await b.completePairing({ code: c.code, userId: '71', chatId: '81', updateId: 1 });
      t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: at }); await progress('assertions'); await work(h);
    } finally {
      for (const release of releases) release(); h.syncing = async () => {}; await progress('teardown');
      try { for (const w of workers) await w.stop(); await b?.close(); await j?.close(); }
      finally { t.mock.timers.reset(); await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); await assert.rejects(access(dir), { code: 'ENOENT' }); }
    }
  };
  try { await Promise.race([lifecycle(), new Promise((_, reject) => { watchdog = timer(() => { for (const release of releases) release(); reject(new Error('terminal edit aggregate deadline including cleanup')); }, 6000); })]); }
  finally { clear(watchdog); }
}
