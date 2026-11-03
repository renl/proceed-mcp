// TEST ONLY: design4/5 C3/7 real text writers. No raw grammar, Telegram or public proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { Journal } from '../src/journal/journal.js';
import { readJournal } from '../src/journal/framing.js';
import { createPortableBroker } from '../src/broker/portable.js';
import { bounded } from './support/managed-spike.mjs';

const at = Date.parse('2026-11-04T00:00:00Z'), opts = { timeout: 12000 };
const iso = n => new Date(n).toISOString(), dec = n => 'dec_' + n.toString(16).padStart(32, '0');
const tick = () => new Promise(r => setImmediate(r));
const capture = f => Promise.resolve().then(f).then(value => ({ value }), error => ({ error }));
const storage = e => e?.exitCode === 4 && e.code === 'STORAGE_FAILURE';
const cursor = n => ({ op: 'telegram.cursor', last_update_id: n });
function gate() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function native(work) {
  const root = resolve('.scratch/c3-text-writers'); await mkdir(root, { recursive: true });
  const dir = await mkdtemp(join(root, 'run-')), path = join(dir, 'journal.log'); let b, j, file;
  const releases = [], h = { keys: [], tokens: [], now: at, clocks: 0, ids: 0, logs: [],
    writing: async () => {}, syncing: async () => {}, generate: () => dec(h.ids),
    get b() { return b; }, get j() { return j; }, bytes: () => readFile(path),
    rows: async () => readJournal(await readFile(path)).transactions.map(t => t.mutations),
    count: () => [h.clocks, h.ids, j.sequence, b.telegramCursor()],
    fields: (kind, extra = {}, i = 0) => ({ ...(kind === 'command' ? { requestId: h.keys[i].requestId } : {}),
      replyPromptId: 70 + i, messageId: 90, userId: '00071', chatId: '00081', updateId: 10, text: '  yes \u{1f600}\n ', ...extra }),
    callback: (extra = {}, i = 0) => ({ requestId: h.keys[i].requestId, callbackToken: h.tokens[i],
      messageId: 7 + i, userId: '00071', chatId: '00081', callbackQueryId: 'private-query', updateId: 10, resolution: 'approved', ...extra }),
    call: (kind, extra = {}, i = 0) => b[kind === 'reply' ? 'resolveReply' : 'resolveCommand'](h.fields(kind, extra, i)),
    ready() { for (const name of ['resolveReply', 'resolveCommand']) assert.equal(typeof b[name], 'function', `selected ${name} writer absent`); },
    hold(phase) { const entered = gate(), released = gate(); releases.push(released.release);
      h[phase] = async () => { entered.release(); await released.promise; };
      return { entered: () => bounded(() => entered.promise, 1500, phase), release: released.release }; },
    async close() { await b?.close(); await j?.close(); },
    async start() { const initial = await Journal.open(path), sequence = initial.sequence; await initial.close();
      file = await open(path, 'a'); j = new Journal(path, {
        write: async (...args) => { await h.writing(); if (h.fail === 'writing') throw new Error('private write fault'); return file.write(...args); },
        sync: async () => { await h.syncing(); if (h.fail === 'syncing') throw new Error('private sync fault'); return file.sync(); }, close: () => file.close(),
      }, sequence);
      b = createPortableBroker({ journal: j, owners: [{ owner_id: 'a', label: 'A' }], port: 43189,
        clock: () => { h.clocks++; if (h.now instanceof Error) throw h.now; return h.now; },
        generateDecisionId: () => { h.ids++; return h.generate(); }, logger: (...a) => h.logs.push(a) }); },
    async reopen() { await h.close(); const saved = h.now; h.now = at + 2000; await h.start(); h.now = NaN;
      const n = h.count(); await b.recover(); assert.deepEqual(h.count().slice(0, 2), n.slice(0, 2)); h.now = saved; },
    async create(opened = true, prompt = true) { h.now = at + 1000; const k = await b.reserveHandle({ ownerId: 'a' }), i = h.keys.length;
      h.keys.push({ ownerId: 'a', requestId: k.request_id, capability: k.request_capability });
      await b.createRequest({ ownerId: 'a', requestHandle: k.request_handle, capability: k.request_capability,
        clientRequestId: 'same', action: 'Question?', context: '', expiresInSeconds: 60 });
      const p = await b.preparePresentation({ requestId: k.request_id }); h.tokens.push(p.callback_token);
      await b.recordPresentationSent({ requestId: k.request_id, callbackToken: p.callback_token, chatId: '00081', messageId: 7 + i });
      if (opened) await b.openResponse({ ...h.callback({ updateId: 2 + i }, i) });
      if (opened && prompt) await b.recordPromptSent({ requestId: k.request_id, chatId: '00081', messageId: 70 + i }); },
  };
  try { await h.start(); await b.recover(); const c = await b.pairingChallenge();
    await b.completePairing({ code: c.code, userId: '00071', chatId: '00081', updateId: 1 });
    await bounded(() => work(h), 9500, 'text writer fixture');
  } finally { releases.forEach(r => r()); h.fail = null; h.writing = h.syncing = async () => {};
    try { await h.close(); } finally { await file?.close().catch(() => {}); await rm(dir, { recursive: true, force: true });
      await assert.rejects(access(dir), { code: 'ENOENT' }); } }
}
function privateAbsent(h, value) { const text = JSON.stringify(value);
  for (const s of ['00071', '00081', 'private-query', ...h.tokens, ...h.keys.map(k => k.capability)]) assert.equal(text.includes(s), false); }
async function unchanged(h, action) { const bytes = await h.bytes(), view = h.b.snapshot(), n = h.count(); await action();
  assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), view); assert.deepEqual(h.count(), n); }
for (const phase of ['writing', 'syncing']) test(`TW-CAL-${phase}: real prefixes, barrier/fault and clock-free reopen`, opts, () => native(async h => {
  await h.create(); await h.create(); assert.deepEqual(h.b.responseWork(), { prompts: [] });
  const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick(); const before = h.b.snapshot(), held = h.hold(phase); let done = false;
  const p = capture(() => h.b.cancelRequest(h.keys[0])).then(r => { done = true; return r; });
  try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await bounded(() => wait, 1500, 'calibration wait')).error));
  h.fail = null; h[phase] = async () => {}; await h.reopen();
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'cancelled');
  h.now = at + 61000; assert.equal((await h.b.readRequest(h.keys[1])).resolution, 'expired');
}));
for (const kind of ['reply', 'command']) {
  test(`TW-RAW-${kind}: malformed primitives reject before blocked queue`, opts, () => native(async h => {
    await h.create(); h.ready(); const f = h.fields(kind), method = kind === 'reply' ? 'resolveReply' : 'resolveCommand';
    const bad = [undefined, null, [], 'x', ...Object.keys(f).map(k => { const v = { ...f }; delete v[k]; return v; }),
      ...Object.keys(f).flatMap(k => [undefined, {}, [f[k]], true].map(v => ({ ...f, [k]: v }))),
      ...Object.keys(f).filter(k => kind === 'reply' || k !== 'replyPromptId').map(k => ({ ...f, [k]: null })),
      ...['messageId', 'replyPromptId'].flatMap(k => [0, -1, 1.5, '70', Number.MAX_SAFE_INTEGER + 1].map(v => ({ ...f, [k]: v }))),
      ...[-1, 1.5, '10', Number.MAX_SAFE_INTEGER].map(updateId => ({ ...f, updateId })),
      ...['', '\ud800', '\udc00', 'a\ud800b', 'x'.repeat(4097), '\u{1f600}'.repeat(4097)].map(text => ({ ...f, text })),
      ...[{ userId: '0' }, { chatId: '-81' }, { userId: 71 }, ...(kind === 'command' ? [{ requestId: 'bad' }] : [])].map(e => ({ ...f, ...e }))];
    const held = h.hold('syncing'), p = capture(() => h.b.advanceCursor(5));
    try { await held.entered(); const n = h.count(); for (const input of bad)
      await assert.rejects(bounded(() => Promise.resolve().then(() => h.b[method](input)), 500, 'raw validation'), e => e?.code === 'INVALID_ARGUMENT' && e.exitCode === 2);
      assert.deepEqual(h.count(), n); } finally { held.release(); await p; }
  }));
  test(`TW-BIND-${kind}: full prompt role, opening and independent actor before stale/clock`, opts, () => native(async h => {
    await h.create(); await h.create(); await h.create(false); h.ready(); h.now = NaN;
    const extras = [{ userId: '71' }, { chatId: '81' }, { userId: '71', updateId: 0 }, { replyPromptId: 7 }, { replyPromptId: 99 },
      ...(kind === 'command' ? [{ replyPromptId: 71 }, { requestId: 'req_' + 'f'.repeat(32) },
        { requestId: h.keys[2].requestId, replyPromptId: null }, { requestId: h.keys[1].requestId }] : [])];
    await unchanged(h, async () => { for (const extra of extras) assert.deepEqual(await h.call(kind, extra), { result: 'refused' });
      for (const updateId of [0, 1, 3]) assert.deepEqual(await h.call(kind, { updateId, ...(kind === 'reply' ? { requestId: 'bad' } : {}) }), { result: 'stale' }); });
    await h.b.close(); h.now = at + 2000; await h.reopen(); h.now = NaN;
    await unchanged(h, async () => assert.deepEqual(await h.call(kind, { chatId: '81' }), { result: 'refused' }));
  }));
  for (const context of kind === 'reply' ? [70] : [null, 70]) test(`TW-RECORD-${kind}-${context}: actual exact source/text, copy/status/recovery`, opts, () => native(async h => {
    await h.create(true, context !== null); await h.create(); h.ready();
    const text = context === null ? '\u{1f600}'.repeat(4096) : ' /respond not-a-command\n yes ', extra = { replyPromptId: context, text };
    if (kind === 'reply') extra.requestId = h.keys[1].requestId;
    const before = h.b.snapshot().requests[0], n = h.count(), r = await h.call(kind, extra), saved = structuredClone(r.request);
    assert.deepEqual(r, { result: 'recorded', request: { ...before, resolution: 'responded', response_text: text,
      resolved_at: iso(h.now), decision_id: dec(1), delivery_state: 'unavailable' } });
    assert.equal(h.clocks, n[0] + 1); assert.equal(h.ids, n[1] + 1); const row = (await h.rows()).at(-1);
    assert.equal(row.length, 2); assert.deepEqual(row.find(m => m.op !== 'telegram.cursor'), { op: 'request.resolve.telegram',
      request_id: h.keys[0].requestId, decision_id: dec(1), resolution: 'responded', response_text: text, resolved_at: iso(h.now),
      user_id: '00071', chat_id: '00081', update_id: 10, delivery_state: 'unavailable',
      source: { kind, message_id: 90, callback_query_id: null, callback_token: null, reply_prompt_id: context } });
    assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(10)); privateAbsent(h, [r, h.logs]);
    assert.equal((await h.b.status()).requests[0].response_text, text); r.request.event_capability.status = 'evil'; r.request.response_text = 'evil';
    const bytes = await h.bytes(); await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], saved); assert.deepEqual(await h.bytes(), bytes);
    h.now = NaN; await unchanged(h, async () => assert.deepEqual(await h.call(kind, { replyPromptId: context }), { result: 'stale' }));
    const counts = h.count(); assert.deepEqual(await h.call(kind, { replyPromptId: context, updateId: 11 }), { result: 'retained', request: saved });
    assert.deepEqual(h.count().slice(0, 2), counts.slice(0, 2)); assert.deepEqual((await h.rows()).at(-1), [cursor(11)]);
    await unchanged(h, async () => assert.deepEqual(await h.call(kind, { userId: '71', updateId: 12 }), { result: 'refused' }));
  }));
  for (const mode of ['live', 'detached', 'invalid', 'lost-during-flush']) test(`TW-WAIT-${kind}-${mode}: initial ledger and flush/install before matching wake`, opts, () => native(async h => {
    await h.create(); await h.create(); h.ready(); const abort = new AbortController(), siblingAbort = new AbortController(); let valid = true, woke = false, siblingWoke = false;
    const wait = capture(() => h.b.waitRequest({ ...h.keys[0], signal: abort.signal, registration: { valid: () => valid } })).then(r => {
      woke = true; if (r.value?.state === 'terminal') { assert.equal(h.b.telegramCursor(), 10); assert.equal(h.b.snapshot().requests[0].response_text, h.fields(kind).text); assert.equal(h.b.snapshot().requests[0].decision_id, r.value.request.decision_id); } return r; });
    const sibling = capture(() => h.b.waitRequest({ ...h.keys[1], signal: siblingAbort.signal })).then(r => { siblingWoke = true; return r; });
    await tick(); if (mode === 'detached') { abort.abort(); await wait; } if (mode === 'invalid') valid = false;
    const before = h.b.snapshot(), position = h.b.telegramCursor(), held = h.hold('syncing'); let done = false;
    const p = capture(() => h.call(kind)).then(r => { done = true; return r; });
    try { await held.entered(); assert.equal(done, false); assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), position);
      assert.equal(siblingWoke, false); if (mode === 'live' || mode === 'lost-during-flush') assert.equal(woke, false);
      if (mode === 'lost-during-flush') { valid = false; abort.abort(); await wait; }
    } finally { held.release(); await p; h.syncing = async () => {};
      try { assert.equal(siblingWoke, false); } finally { siblingAbort.abort(); await sibling; } }
    const r = (await p).value; assert.equal(r.result, 'recorded'); assert.equal(r.request.delivery_state, ['live', 'lost-during-flush'].includes(mode) ? 'pending' : 'unavailable');
    if (mode === 'live') assert.deepEqual((await bounded(() => wait, 1500, 'original wait')).value, { state: 'terminal', request: r.request });
    else { abort.abort(); await wait; } await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], r.request);
    const confirmed = await h.b.acknowledgeRequest({ ...h.keys[0], decisionId: r.request.decision_id }); assert.equal(confirmed.delivery_state, 'confirmed');
    assert.equal((await h.b.returnedRequest({ ...h.keys[0], decisionId: r.request.decision_id })).delivery_state, 'confirmed');
  }));
  test(`TW-TIME-ID-${kind}: one sample, deadline equality, preappend invalid clock/identity remains usable`, opts, () => native(async h => {
    await h.create(); h.ready(); const before = h.b.snapshot(), bytes = await h.bytes(), ids = h.ids;
    for (const now of [new Error('private clock'), NaN, Infinity, '0', 1e20, at]) { h.now = now;
      await assert.rejects(Promise.resolve().then(() => h.call(kind)), storage); assert.deepEqual(await h.bytes(), bytes);
      assert.deepEqual(h.b.snapshot(), before); assert.equal(h.ids, ids); }
    h.now = at + 60999; for (const generate of [() => null, () => ['bad'], () => 'bad', () => { throw new Error('private identity'); }]) {
      h.generate = generate; await assert.rejects(Promise.resolve().then(() => h.call(kind)), storage); assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before); }
    h.generate = () => dec(99); const wait = h.b.waitRequest(h.keys[0]); await tick();
    h.now = at + 61000; const n = h.count(), r = await h.call(kind);
    assert.equal(r.result, 'expired'); assert.equal(r.request.resolution, 'expired'); assert.equal(r.request.response_text, null);
    assert.equal(h.clocks, n[0] + 1); assert.equal(h.ids, n[1] + 1); const row = (await h.rows()).at(-1);
    assert.equal(row.length, 2); assert.deepEqual(row.find(m => m.op !== 'telegram.cursor'), { op: 'request.expire', request_id: h.keys[0].requestId,
      decision_id: dec(99), resolved_at: iso(h.now), delivery_state: 'pending' }); assert.deepEqual(row.find(m => m.op === 'telegram.cursor'), cursor(10));
    assert.deepEqual(await bounded(() => wait, 1500, 'expiry wait'), { state: 'terminal', request: r.request });
    await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], r.request);
  }));
  test(`TW-EARLY-${kind}: whitespace is instructions one millisecond before deadline`, opts, () => native(async h => {
    await h.create(); h.ready(); h.now = at + 60999; const n = h.count(), r = await h.call(kind, { text: ' ' });
    assert.equal(r.result, 'recorded'); assert.equal(r.request.resolution, 'responded'); assert.equal(r.request.response_text, ' ');
    assert.equal(h.clocks, n[0] + 1); assert.equal(h.ids, n[1] + 1); await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], r.request);
  }));
  test(`TW-RETAIN-${kind}: terminal cursor-only flush, no sibling wake or private outcome to foreign actor`, opts, () => native(async h => {
    await h.create(); await h.create(); h.ready(); const saved = await h.b.cancelRequest(h.keys[0]);
    const abort = new AbortController(); let woke = false, done = false;
    const wait = capture(() => h.b.waitRequest({ ...h.keys[1], signal: abort.signal })).then(r => { woke = true; return r; }); await tick();
    h.now = NaN; await unchanged(h, async () => assert.deepEqual(await h.call(kind, { userId: '71' }), { result: 'refused' }));
    const n = h.count(), before = h.b.snapshot(), held = h.hold('syncing'), p = capture(() => h.call(kind)).then(r => { done = true; return r; });
    try { await held.entered(); assert.equal(done, false); assert.equal(woke, false); assert.deepEqual(h.b.snapshot(), before); assert.equal(h.b.telegramCursor(), 3); }
    finally { held.release(); await p; h.syncing = async () => {};
      try { assert.equal(woke, false); } finally { abort.abort(); await wait; } }
    assert.deepEqual((await p).value, { result: 'retained', request: saved }); assert.deepEqual(h.count().slice(0, 2), n.slice(0, 2));
    assert.deepEqual((await h.rows()).at(-1), [cursor(10)]); await unchanged(h, async () => assert.deepEqual(await h.call(kind), { result: 'stale' }));
  }));
}
for (const stage of ['pending-stale', 'terminal-stale', 'terminal-newer']) for (const [context, replyPromptId] of [['unknown', 99], ['request-role', 7], ['wrong-request', 71]])
  test(`TW-CONTEXT-${stage}-${context}: full command binding before classification or outcome`, opts, () => native(async h => {
    await h.create(); await h.create(); h.ready();
    if (stage !== 'pending-stale') await h.b.cancelRequest(h.keys[0]);
    h.now = NaN; const bytes = await h.bytes(), view = h.b.snapshot(), n = h.count();
    const result = await h.call('command', { replyPromptId, updateId: stage === 'terminal-newer' ? 10 : 3 });
    assert.deepEqual({ result, journalUnchanged: bytes.equals(await h.bytes()), stateUnchanged: isDeepStrictEqual(h.b.snapshot(), view), n: h.count() },
      { result: { result: 'refused' }, journalUnchanged: true, stateUnchanged: true, n });
  }));
for (const replyPromptId of [null, 70]) test(`TW-CONTROL-command-${replyPromptId}: fully bound stale and terminal`, opts, () => native(async h => {
  await h.create(true, replyPromptId !== null); h.ready(); h.now = NaN;
  await unchanged(h, async () => assert.deepEqual(await h.call('command', { replyPromptId, updateId: 2 }), { result: 'stale' }));
  h.now = at + 2000; const saved = await h.b.cancelRequest(h.keys[0]); h.now = NaN; const n = h.count();
  assert.deepEqual(await h.call('command', { replyPromptId, updateId: 10 }), { result: 'retained', request: saved });
  assert.deepEqual(h.count().slice(0, 2), n.slice(0, 2)); assert.deepEqual((await h.rows()).at(-1), [cursor(10)]);
  await unchanged(h, async () => assert.deepEqual(await h.call('command', { replyPromptId, updateId: 10 }), { result: 'stale' }));
}));
for (const producer of ['cancel', 'expiry', 'callback', 'reply', 'command']) test(`TW-ID-${producer}: actual global source history blocks both text writers`, opts, () => native(async h => {
  await h.create(); await h.create(); h.ready(); h.generate = () => dec(88);
  if (producer === 'cancel') await h.b.cancelRequest(h.keys[0]);
  else if (producer === 'expiry') { h.now = at + 61000; await h.b.readRequest(h.keys[0]); }
  else if (producer === 'callback') await h.b.resolveCallback(h.callback()); else await h.call(producer);
  h.now = at + 2000; await h.reopen(); const bytes = await h.bytes(), before = h.b.snapshot();
  for (const kind of ['reply', 'command']) { await assert.rejects(Promise.resolve().then(() => h.call(kind, { updateId: 11 }, 1)), e => e?.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION');
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before); }
  for (const writer of [() => h.b.cancelRequest(h.keys[1]), () => { h.now = at + 61000; return h.b.readRequest(h.keys[1]); }]) {
    await assert.rejects(Promise.resolve().then(writer), e => e?.exitCode === 4 && e.code === 'JOURNAL_IDENTIFIER_COLLISION');
    assert.deepEqual(await h.bytes(), bytes); assert.deepEqual(h.b.snapshot(), before); }
  h.now = at + 2000;
  h.generate = () => dec(89); assert.equal((await h.call('command', { updateId: 11 }, 1)).result, 'recorded');
}));
for (const first of ['reply', 'command', 'cancel', 'expiry', 'callback', 'cursor', 'duplicate']) test(`TW-RACE-${first}: serialized first winner and cursor, no late identity`, opts, () => native(async h => {
  await h.create(); h.ready(); if (first === 'expiry') h.now = at + 61000;
  const held = h.hold('syncing'), n = h.ids;
  const p = capture(() => ['reply', 'command', 'duplicate'].includes(first) ? h.call(first === 'command' ? 'command' : 'reply') :
    first === 'cancel' ? h.b.cancelRequest(h.keys[0]) : first === 'expiry' ? h.b.readRequest(h.keys[0]) : first === 'cursor' ? h.b.advanceCursor(10) : h.b.resolveCallback(h.callback())); let follower, cancel;
  try { await held.entered(); h.now = NaN; follower = capture(() => h.call(first === 'command' ? 'reply' : 'command', { updateId: first === 'duplicate' || first === 'cursor' ? 10 : 11 }));
    if (first === 'reply' || first === 'command') cancel = capture(() => h.b.cancelRequest(h.keys[0])); }
  finally { held.release(); await p; h.syncing = async () => {}; }
  const winner = h.b.snapshot().requests[0], r = (await follower).value;
  assert.deepEqual(r, first === 'duplicate' || first === 'cursor' ? { result: 'stale' } : { result: 'retained', request: winner });
  if (cancel) assert.deepEqual((await cancel).value, winner); assert.equal(h.ids, n + (first === 'cursor' ? 0 : 1));
  assert.equal(winner.resolution, first === 'cancel' ? 'cancelled' : first === 'expiry' ? 'expired' : first === 'callback' ? 'approved' : first === 'cursor' ? 'pending' : 'responded');
  const closures = (await h.rows()).flat().filter(m => ['request.resolve.telegram', 'request.cancel', 'request.expire'].includes(m.op)); assert.equal(closures.length, first === 'cursor' ? 0 : 1);
  if (!['duplicate', 'cursor'].includes(first)) assert.deepEqual((await h.rows()).at(-1), [cursor(11)]);
  await h.reopen(); assert.deepEqual(h.b.snapshot().requests[0], winner);
}));
for (const kind of ['reply', 'command']) for (const phase of ['writing', 'syncing']) test(`TW-FAULT-${kind}-${phase}: actual append fence, wait failure and uncertain-frame recovery`, opts, () => native(async h => {
  await h.create(); h.ready(); const wait = capture(() => h.b.waitRequest(h.keys[0])); await tick();
  const before = h.b.snapshot(), held = h.hold(phase), p = capture(() => h.call(kind)); let follower, n;
  try { await held.entered(); n = h.count(); follower = capture(() => h.call(kind === 'reply' ? 'command' : 'reply', { updateId: 11 })); h.fail = phase; } finally { held.release(); }
  assert.ok(storage((await p).error)); assert.ok(storage((await follower).error)); assert.ok(storage((await bounded(() => wait, 1500, 'failed wait')).error));
  assert.deepEqual(h.b.snapshot(), before); assert.deepEqual(h.count(), n); await assert.rejects(Promise.resolve().then(() => h.call(kind)), storage);
  h.fail = null; h[phase] = async () => {}; await h.reopen(); assert.equal(h.b.telegramCursor(), phase === 'writing' ? 2 : 10);
  assert.equal(h.b.snapshot().requests[0].resolution, phase === 'writing' ? 'pending' : 'responded');
}));
test('TW-LIFE: unrecovered/closed admission and close drains accepted text', opts, () => native(async h => {
  await h.create(); h.ready(); await h.close(); h.now = at + 2000; await h.start();
  await assert.rejects(Promise.resolve().then(() => h.call('reply')), storage); h.now = NaN; await h.b.recover(); h.now = at + 2000;
  const held = h.hold('writing'), p = capture(() => h.call('reply')); let closing, done = false;
  try { await held.entered(); closing = h.b.close().then(() => { done = true; }); await tick(); assert.equal(done, false);
    await assert.rejects(Promise.resolve().then(() => h.call('command', { updateId: 11 })), storage); }
  finally { held.release(); await p; await closing; h.writing = async () => {}; }
  assert.equal((await p).value.result, 'recorded'); await h.reopen(); assert.equal(h.b.snapshot().requests[0].resolution, 'responded');
}));
