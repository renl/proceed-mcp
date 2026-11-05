// TEST ONLY: actual client construction, offline HTTPS interception, not Telegram proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { createTelegramClient, TelegramError } from '../src/telegram/client.js';
const methods = ['sendMessage', 'editMessageText', 'editMessageReplyMarkup'];
async function intercepted(work) {
  const original = https.request; let reply, observed;
  https.request = (url, options, callback) => {
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    req.end = bytes => {
      observed = { url, options, body: JSON.parse(bytes) };
      const res = new EventEmitter(); res.statusCode = reply.status; callback(res);
      res.emit('data', Buffer.from(JSON.stringify(reply.body))); res.emit('end');
    }; return req;
  };
  try { await work(createTelegramClient({ token: 'synthetic-private-token' }), value => { reply = value; }, () => observed); }
  finally { https.request = original; }
}
for (const method of methods) for (const status of [409, 200]) test(`MC409-${method}-${status}: nonretryable redacted method refusal`, { timeout: 3000 }, () => intercepted(async (client, respond, observed) => {
  respond({ status, body: { ok: false, error_code: status === 409 ? 400 : 409, description: 'PRIVATE_409 not modified polling conflict' } });
  const payload = { chat_id: '81', message_id: 7, text: 'private question' };
  await assert.rejects(client[method](payload), e => {
    assert.ok(e instanceof TelegramError); assert.equal(e.code, 'TELEGRAM_REJECTED');
    assert.equal(e.retryable, false); assert.equal(e.retryAfter, null);
    assert.ok(!/PRIVATE_409|private question|synthetic-private-token|api.telegram.org/.test(e.message)); return true;
  });
  assert.equal(observed().url, `https://api.telegram.org/botsynthetic-private-token/${method}`);
  assert.equal(observed().options.method, 'POST'); assert.deepEqual(observed().body, payload);
}));
test('MC409-ENVELOPE: independent API401 and HTTP429 precedence over message409 fallback', { timeout: 3000 }, () => intercepted(async (client, respond) => {
  for (const method of methods) for (const [status, error_code, expected, retryable] of [
    [200, 401, 'TOKEN_REJECTED', false], [409, 401, 'TOKEN_REJECTED', false],
    [429, 409, 'TELEGRAM_RATE_LIMITED', true], [409, 429, 'TELEGRAM_RATE_LIMITED', true],
  ]) {
    respond({ status, body: { ok: false, error_code } });
    await assert.rejects(client[method]({}), e => e.code === expected && e.retryable === retryable);
  }
}));
test('MC409-CONTROLS: poll conflict and existing credential/rate/server precedence', { timeout: 3000 }, () => intercepted(async (client, respond) => {
  const cases = [
    ['updates', 409, 409, {}, 'POLLER_CONFLICT', false, null],
    ...methods.flatMap(method => [
      [method, 401, 409, {}, 'TOKEN_REJECTED', false, null],
      [method, 429, 429, { retry_after: 3 }, 'TELEGRAM_RATE_LIMITED', true, 3],
      [method, 409, 409, { retry_after: 3 }, 'TELEGRAM_RATE_LIMITED', true, 3],
      [method, 503, 409, {}, 'TELEGRAM_UNAVAILABLE', true, null],
    ]),
  ];
  for (const [method, status, code, parameters, expected, retryable, floor] of cases) {
    respond({ status, body: { ok: false, error_code: code, parameters } });
    await assert.rejects(client[method]({}), e => e.code === expected && e.retryable === retryable && e.retryAfter === floor);
  }
}));
