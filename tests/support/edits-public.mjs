// TEST ONLY: real public state producers and client, offline transport observations.
import assert from 'node:assert/strict';
import { publicPoller, rows, update, paired } from './poller-public.mjs';
import { success } from './portable-waiting.mjs';
export const controls = 'editMessageReplyMarkup', status = 'editMessageText';
export const retired = 'telegram.controls.retired', shown = 'telegram.status.shown';
export const message = (id = 700) => ({ message_id: id, date: 1793664000, chat: { id: 81, type: 'private' } });
export const mutations = bytes => rows(bytes).flat();
export const records = (bytes, op) => mutations(bytes).filter(m => m.op === op);
export const calls = (r, method) => r.events.filter(e => e.kind === 'request' && e.url.endsWith(`/${method}`));
export const run = (work, mode = '') => publicPoller(work, mode, { mcp: true });
export function envelope(req, method, body) {
  assert.equal(req.url, `https://api.telegram.org/botoffline-synthetic-token/${method}`);
  assert.equal(req.options.method, 'POST'); assert.equal(req.options.agent, false);
  assert.deepEqual(req.options.headers, { 'content-type': 'application/json', accept: 'application/json',
    'content-length': String(Buffer.byteLength(JSON.stringify(req.body))) });
  assert.equal(req.deadline, 20000); assert.deepEqual(req.body, body);
}
export async function receipt(h, r, op) {
  return h.wait(r, e => e.kind === 'committed' && e.mutations.some(m => m.op === op), op);
}
export async function setup(h) {
  h.response(h.r, h.initial, [update(7, h.code)]);
  const confirmation = await h.request(h.r, 'sendMessage');
  assert.deepEqual(confirmation.body, { chat_id: '81', text: paired });
  h.response(h.r, confirmation, message(699)); const poll = await h.request(h.r, 'getUpdates', 1);
  const a = await h.connect(), p = success(await a.call('prepare_approval', { session_label: 'terminal <caller>' }));
  const key = { request_id: p.request_id, request_capability: p.request_capability };
  let settled = false;
  const pending = a.call('request_approval', { request_handle: p.request_handle, request_capability: p.request_capability,
    client_request_id: 'public-edit', action: 'Proceed <exact>?', context: 'line one\nline two & unchanged', expires_in_seconds: 60 }, { id: 42, ms: 14000 });
  pending.then(() => { settled = true; });
  const question = await h.request(h.r, 'sendMessage', 1);
  const before = mutations(question.bytes);
  assert.equal(before.filter(m => m.op === 'request.create').length, 1);
  assert.equal(before.filter(m => m.op === 'telegram.presentation.prepare').length, 1);
  assert.equal(records(question.bytes, 'telegram.presentation.sent').length, 0);
  h.response(h.r, question, message()); await receipt(h, h.r, 'telegram.presentation.sent');
  const mapped = records(await h.bytes(), 'telegram.presentation.sent');
  assert.equal(mapped.length, 1); assert.equal(mapped[0].request_id, p.request_id);
  assert.equal(mapped[0].chat_id, '81'); assert.equal(mapped[0].message_id, 700);
  assert.equal(settled, false, 'question receipt does not resolve original wait');
  const terminal = success(await a.call('cancel_approval', key));
  assert.equal(terminal.resolution, 'cancelled'); assert.equal(terminal.response_text, null);
  assert.match(terminal.decision_id, /^dec_[a-f0-9]{32}$/);
  const outcome = await pending; assert.equal(outcome.frame.id, 42); assert.deepEqual(success(outcome), terminal);
  const view = () => a.call('get_approval', key).then(success);
  await receipt(h, h.r, 'request.returned');
  const current = await view(); assert.deepEqual(current, { ...terminal, delivery_state: 'returned' });
  const close = async () => { await h.stop(a.resource); a.peer.assertComplete(); };
  return { a, p, key, poll, question, terminal, current, view, close };
}
export async function edit(h, q, method, r = h.r, index = 0) {
  const req = await h.request(r, method, index);
  const body = { chat_id: '81', message_id: 700 };
  if (method === controls) body.reply_markup = { inline_keyboard: [] };
  else {
    // Independent exact rendering oracle: captured terminal pair plus original caller strings.
    body.text = q.question.body.text.replace('Resolution: pending', 'Resolution: cancelled')
      .replace('Delivery: not_applicable', `Delivery: ${q.current.delivery_state}`);
    assert.equal(records(req.bytes, retired).length, 1, 'durable retirement before status');
  }
  envelope(req, method, body);
  assert.equal(records(req.bytes, method === controls ? retired : shown).length, 0);
  return req;
}
export async function finish(h, q, r = h.r, method = controls, req) {
  req ??= await edit(h, q, method, r); h.response(r, req, message());
  await receipt(h, r, method === controls ? retired : shown);
  if (method === controls) await finish(h, q, r, status);
}
