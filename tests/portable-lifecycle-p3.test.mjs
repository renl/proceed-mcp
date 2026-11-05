// TEST ONLY: assembled lifecycle proof. Offline transport is not live Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { lifecycle, gate } from './support/lifecycle-p3.mjs';
import { until } from './support/portable-waiting.mjs';

const opts = { timeout: 60000 };
const role = body => body.reply_markup?.force_reply ? 'prompt' : body.reply_markup?.inline_keyboard ? 'question' : 'reply';
const wait = (h, check, label) => until(check, label, h.signal);
const receipt = (h, op, p) => wait(h, async () => (await h.records(op, p)).length === 1, op);
const cancel = async (h, p) => {
  const r = await h.request(`/v1/requests/${p.request_id}/cancel`, { method: 'POST', body: {}, capability: p.request_capability });
  assert.equal(r.status, 200); assert.equal(r.body.resolution, 'cancelled'); return r.body;
};

test('C3-P3D-STOP: all three fences precede held poll/late question/prompt drain and ordered close', opts, () => lifecycle(async h => {
  const release = gate(), entered = new Set(); h.releaseOnCleanup(release);
  let armed = false;
  const telegram = h.wrap({ sendMessage: async (send, body, options) => {
    const result = await send(body, options);
    if (armed && role(body) !== 'reply') { entered.add(role(body)); await release.promise; }
    return result;
  } });
  const runtime = await h.start(telegram); await h.pair();
  const p = await h.create('opened prompt');
  await h.mapped(p); await receipt(h, 'telegram.presentation.sent', p);
  armed = true; await h.opened(p);
  await wait(h, () => entered.has('prompt'), 'actual prompt result held');
  const second = await h.create('late question');
  await wait(h, () => entered.has('question'), 'actual question result held');
  await cancel(h, p); await cancel(h, second);
  const held = h.hold('telegram.cursor');
  h.fixture.enqueue({ message: null }); await held.entered;
  const signals = ['updates', 'sendMessage'].flatMap(name => h.calls.filter(c => c.name === name).map(c => c.args.at(-1)?.signal)).filter(Boolean);
  assert.ok(signals.filter(s => !s.aborted).length >= 3, 'all three real worker transports are armed');
  h.events.length = 0;
  const stop = runtime.stop(); let complete = false; stop.then(() => { complete = true; });
  assert.equal(runtime.ready, false); assert.equal(runtime.stop(), stop);
  assert.ok(signals.every(s => s.aborted), 'synchronous shared stop before awaiting any drain');
  await wait(h, () => h.transports.every(t => t.closed), 'actual Telegram request transports close while poll commit remains held');
  const calls = h.calls.length; release.release();
  await delay(1100);
  assert.equal(complete, false); assert.deepEqual(h.events, [], 'held real poll sync prevents any close or receipt install');
  await access(h.paths.brokerLockFile); held.release(); await stop;
  for (const [op, target] of [['telegram.prompt.sent', p], ['telegram.presentation.sent', second]]) {
    assert.equal((await h.records(op, target)).length, 1, 'valid late result drains exactly once after terminal resolution');
    assert.ok(h.events.indexOf(`commit:${op}`) < h.events.indexOf('core-close'));
  }
  assert.deepEqual(h.events.filter(e => e.endsWith('-close')), ['listener-close', 'core-close', 'journal-close']);
  await assert.rejects(access(h.paths.brokerLockFile), { code: 'ENOENT' });
  const bytes = await readFile(h.paths.journalFile); await delay(1100);
  assert.equal(h.calls.length, calls, 'no poll/send/prompt/ack/edit/retry starts after stop');
  assert.deepEqual(await readFile(h.paths.journalFile), bytes, 'late ticks do not touch closed storage');
  assert.equal(runtime.stop(), stop); assert.equal(runtime.ready, false);
  assert.equal((await h.records('telegram.prompt.failed', p)).length, 0);
}));

test('C3-P3D-SEND-ONLY: real opening recovers and prompt sends without question edit methods', opts, () => lifecycle(async h => {
  let block = false;
  const runtime = await h.start(h.wrap({ sendMessage: async (send, body, options) => {
    if (block && role(body) === 'prompt') {
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject({ code: 'CANCELLED' }), { once: true }));
    }
    return send(body, options);
  } }));
  await h.pair(); const p = await h.create('send-only recovery');
  await h.mapped(p); await receipt(h, 'telegram.presentation.sent', p);
  block = true; await h.opened(p);
  await wait(h, () => h.calls.some(c => c.name === 'sendMessage' && role(c.args[0]) === 'prompt'), 'prompt admitted');
  await runtime.stop(); assert.equal((await h.records('telegram.prompt.sent', p)).length, 0);
  const telegram = h.wrap(); delete telegram.editMessageText; delete telegram.editMessageReplyMarkup;
  const before = h.calls.length, next = await h.start(telegram);
  await receipt(h, 'telegram.prompt.sent', p);
  const fresh = h.calls.slice(before);
  assert.equal(fresh.filter(c => c.name === 'sendMessage' && role(c.args[0]) === 'prompt').length, 1);
  assert.equal(fresh.some(c => c.name.startsWith('edit')), false);
  const prompt = h.fixture.messages.find(m => m.text.includes(p.request_id) && m.reply_markup?.force_reply);
  assert.deepEqual(prompt.reply_markup, { force_reply: true });
  h.fixture.text('send-only exact response', prompt);
  await receipt(h, 'request.resolve.telegram', p);
  const r = await h.request(`/v1/requests/${p.request_id}`, { capability: p.request_capability });
  assert.equal(r.body.resolution, 'responded'); assert.equal(r.body.response_text, 'send-only exact response');
  assert.equal(next.ready, true);
}));

test('C3-P3D-PARTIAL: later client construction fault aborts started poller and fences presentation before release', opts, () => lifecycle(async h => {
  const initial = h.wrap(); delete initial.editMessageText; delete initial.editMessageReplyMarkup;
  const first = await h.start(initial); await h.pair(); const p = await h.create('partial start pending'); await first.stop();
  const before = h.calls.length;
  const telegram = h.wrap(); let reads = 0;
  const send = telegram.sendMessage;
  Object.defineProperty(telegram, 'sendMessage', { get() {
    // Assembly gate, presentation constructor, prompt gate, then prompt constructor.
    if (++reads === 4) throw Error('TEST_ONLY_PROMPT_CONSTRUCTION');
    return send;
  } });
  h.events.length = 0;
  const held = h.hold('telegram.presentation.prepare'); let settled = false;
  const failed = assert.rejects(h.start(telegram), /TEST_ONLY_PROMPT_CONSTRUCTION/).then(() => { settled = true; });
  await held.entered;
  assert.equal(reads, 4, 'fault reached after presentation start, not early startup');
  const newCalls = h.calls.slice(before);
  assert.equal(newCalls.filter(c => c.name === 'updates').length, 1, 'started poll is positive armed-peer control');
  assert.equal(newCalls.find(c => c.name === 'updates').args[1].signal.aborted, true);
  assert.equal(newCalls.some(c => c.name !== 'updates'), false, 'queued presentation cannot send after partial-start fence');
  await wait(h, () => h.transports.every(t => t.closed), 'partial-start actual poll transport closes');
  await delay(1100); assert.equal(settled, false); assert.deepEqual(h.events, []);
  await access(h.paths.brokerLockFile); held.release(); await failed;
  assert.deepEqual(h.events, ['commit:telegram.presentation.prepare', 'listener-close', 'core-close', 'journal-close']);
  assert.equal((await h.records('telegram.presentation.prepare', p)).length, 1, 'admitted allocation drains, not a fabricated send receipt');
  assert.equal((await h.records('telegram.presentation.sent', p)).length, 0);
  assert.equal((await h.records('telegram.presentation.failed', p)).length, 0);
  await assert.rejects(access(h.paths.brokerLockFile), { code: 'ENOENT' });
  const bytes = await readFile(h.paths.journalFile);
  await delay(1100); assert.equal(h.calls.length, before + 1);
  assert.deepEqual(await readFile(h.paths.journalFile), bytes, 'no post-close write');
  const restarted = await h.start(); assert.equal(restarted.ready, true, 'owned port/storage reusable after partial start');
}));

test('C3-P3D-PARTIAL-LATE: all three consumers started before timer failure, admitted core turns drain without transport revival', opts, () => lifecycle(async h => {
  let block = false;
  const first = await h.start(h.wrap({ sendMessage: async (send, body, options) => {
    if (block && role(body) === 'prompt') await new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject({ code: 'CANCELLED' }), { once: true }));
    return send(body, options);
  } }));
  await h.pair(); const p = await h.create('late partial opening');
  await h.mapped(p); await receipt(h, 'telegram.presentation.sent', p); block = true; await h.opened(p);
  await first.stop();
  const sendOnly = h.wrap({ sendMessage: async (send, body, options) => {
    if (role(body) === 'prompt') await new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject({ code: 'CANCELLED' }), { once: true }));
    return send(body, options);
  } }); delete sendOnly.editMessageText; delete sendOnly.editMessageReplyMarkup;
  const setup = await h.start(sendOnly); const q = await h.create('late partial question'); await setup.stop();
  const prototype = Object.getPrototypeOf(first.broker), prepare = prototype.prepareResponsePrompt;
  const interval = globalThis.setInterval, held = h.hold('telegram.presentation.prepare');
  let intervals = 0, promptAdmissions = 0, settled = false;
  prototype.prepareResponsePrompt = function (...args) { promptAdmissions++; return prepare.apply(this, args); };
  globalThis.setInterval = (...args) => {
    if (++intervals === 3) throw Error('TEST_ONLY_THIRD_CONSUMER_TIMER');
    return interval(...args);
  };
  h.events.length = 0; const before = h.calls.length;
  const failed = assert.rejects(h.start(), /TEST_ONLY_THIRD_CONSUMER_TIMER/).then(() => { settled = true; });
  try {
    await held.entered; assert.equal(intervals, 3); assert.equal(promptAdmissions, 1, 'real prompt admission queued before late startup fault');
    const calls = h.calls.slice(before);
    assert.equal(calls.length, 1); assert.equal(calls[0].name, 'updates'); assert.equal(calls[0].args[1].signal.aborted, true);
    await wait(h, () => h.transports.every(t => t.closed), 'late partial poll socket close');
    await delay(1100); assert.equal(settled, false); assert.deepEqual(h.events, []);
    await access(h.paths.brokerLockFile); held.release(); await failed;
  } finally {
    held.release();
    try { await failed; } finally { globalThis.setInterval = interval; prototype.prepareResponsePrompt = prepare; }
  }
  assert.deepEqual(h.events, ['commit:telegram.presentation.prepare', 'listener-close', 'core-close', 'journal-close']);
  assert.equal((await h.records('telegram.presentation.prepare', q)).length, 1);
  assert.equal((await h.records('telegram.prompt.sent', p)).length, 0, 'queued prompt admission cannot send or invent a receipt after startup fault');
  const bytes = await readFile(h.paths.journalFile); await delay(1100);
  assert.equal(h.calls.length, before + 1); assert.deepEqual(await readFile(h.paths.journalFile), bytes);
}));

for (const origin of ['prompt', 'question', 'poll']) test(`C3-P3D-401-${origin}: real client rejection fences armed peers before throwing logger, valid peer receipts still drain`, opts, () => lifecycle(async h => {
  const release = gate(), target = gate(), entered = new Set();
  h.releaseOnCleanup(release); h.releaseOnCleanup(target);
  let armed = false, rejectPoll = false, rejected = false;
  const telegram = h.wrap({
    sendMessage: async (send, body, options) => {
      const r = role(body);
      if (armed && r !== 'reply') {
        if (origin === r) { entered.add(r); await target.promise; return send(body, options); }
        const value = await send(body, options); entered.add(r); await release.promise; return value;
      }
      return send(body, options);
    },
    updates: async (poll, offset, options) => {
      if (rejectPoll) { entered.add('poll'); await target.promise; }
      return poll(offset, options);
    },
  });
  const runtime = await h.start(telegram, { log: line => {
    if (line.includes('credential') || line.includes('TOKEN_REJECTED')) {
      const signals = h.calls.map(c => c.args.at(-1)?.signal).filter(Boolean);
      assert.ok(signals.every(s => s.aborted), 'all peer fences precede fallible logging');
      rejected = true; throw Error('TEST_ONLY_LOGGER');
    }
  } });
  await h.pair(); const p = await h.create('fanout opened');
  await h.mapped(p); await receipt(h, 'telegram.presentation.sent', p);
  armed = true; await h.opened(p);
  await wait(h, () => entered.has('prompt'), 'armed prompt');
  const q = await h.create('fanout question'); await wait(h, () => entered.has('question'), 'armed question');
  if (origin === 'poll') {
    rejectPoll = true; h.fixture.enqueue({ message: null });
    await wait(h, () => entered.has('poll'), 'armed next poll');
  }
  h.fixture.observe((call, res) => {
    const r = call.method === 'getUpdates' ? 'poll' : call.method === 'sendMessage' ? role(call.body) : null;
    if (r !== origin) return false;
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error_code: 401, description: 'TEST_ONLY_PRIVATE_DETAIL' })); return true;
  });
  target.release(); await wait(h, () => rejected, 'real client credential fanout');
  await wait(h, () => h.transports.every(t => t.closed), 'credential stop destroys actual peer transports');
  assert.equal(runtime.ready, true, 'Telegram cessation is not local shutdown');
  const count = h.calls.length; release.release();
  const peer = origin === 'prompt' ? q : p, op = origin === 'prompt' ? 'telegram.presentation.sent' : 'telegram.prompt.sent';
  await receipt(h, op, peer);
  if (origin === 'poll') await receipt(h, 'telegram.presentation.sent', q);
  const status = await h.request('/v1/status', { token: (await readFile(h.paths.controlCredentialFile, 'utf8')).trim() });
  assert.equal(status.status, 200); await cancel(h, p); await cancel(h, q);
  await h.create('local creation after credential stop');
  await delay(1100); assert.equal(h.calls.length, count, 'no worker poll/send/reply/ack/edit/retry after credential stop');
  assert.ok(h.logs.every(line => !line.includes('TEST_ONLY_PRIVATE_DETAIL')));
}));
