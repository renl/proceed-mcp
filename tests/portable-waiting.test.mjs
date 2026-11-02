// Active delta: Exact originating-session delivery / Portable waiting-call outcome delivery.
// OFFLINE public product integration. Synthetic Telegram updates are not human/live proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { managed } from './support/managed-spike.mjs';
import { portable, success, authority, question, ask, get, until, telegramFixture } from './support/portable-waiting.mjs';

test('FIXTURE: only controlled Telegram transport, listener teardown', async () => {
  const fixture = await telegramFixture();
  try {
    fixture.text('/pair synthetic');
    const response = await fetch(`${fixture.address}/getUpdates`, { method: 'POST', body: '{}',
      signal: AbortSignal.timeout(1000) });
    const value = await response.json();
    assert.equal(value.result[0].message.text, '/pair synthetic');
    assert.equal(value.result[0].message.from.is_bot, false);
    const abort = new AbortController();
    const pending = fetch(`${fixture.address}/getUpdates`, { method: 'POST', body: '{"offset":999}', signal: abort.signal });
    pending.catch(() => {});
    await until(() => fixture.calls.some(c => c.method === 'getUpdates' && c.body.offset === 999), 'held fixture poll');
    abort.abort(); await assert.rejects(pending, e => e.name === 'AbortError');
    const lifecycle = await managed(async (context) => {
      const preload = pathToFileURL(resolve('tests/fixtures/portable-telegram-preload.mjs'));
      preload.searchParams.set('fixture', fixture.address);
      const child = await context.start([process.execPath, '--import', preload.href, '--input-type=module',
        '--eval', `import https from 'node:https';
          const req = https.request('https://api.telegram.org/botoffline-synthetic-token/getMe',
            {method:'POST'}, res => {
              let bytes=''; res.on('data', b => bytes+=b); res.on('end', () => {
                process.send({kind:'fixture-result', ok:JSON.parse(bytes).result.is_bot === true});
              });
            }); req.end('{}');`, '--', '--state-dir', context.directory]);
      assert.equal((await child.wait('fixture-result')).ok, true, 'preload forwards only synthetic platform transport');
    });
    assert.ifError(lifecycle.cleanupError);
    assert.ifError(lifecycle.assertionError);
  } finally { await fixture.close(); }
});

test('PORT-A: preparation and request authority, not labels or agent identity', { timeout: 65000 }, () => portable(async (h) => {
  const before = h.fixture.messages.length;
  const a = await h.prepare(), b = await h.prepare();
  assert.ok(a.request_id !== b.request_id && a.request_handle !== b.request_handle
    && a.request_capability !== b.request_capability, 'equal labels allocate independent authority');
  const reserved = await h.shared.call('get_approval', authority(a)).outcome;
  assert.ok(reserved.frame.result?.isError === true
    && reserved.frame.result.structuredContent?.error?.code === 'NOT_FOUND', 'preparation is not an actionable approval');
  assert.equal(h.fixture.messages.length, before, 'preparation creates no Telegram question');
  const wait = ask(h.shared, a, 101);
  await until(async () => (await get(h.shared, a)).resolution === 'pending', 'created pending request', h.signal);
  const foreign = await h.connect('foreign');
  const denied = async (connection, name, args) => {
    const outcome = await connection.call(name, args).outcome;
    assert.equal(outcome.kind, 'response');
    const result = outcome.frame.result;
    assert.ok(result?.isError === true && result.structuredContent?.error?.code === 'NOT_FOUND',
      'wrong capability/principal denies without existence disclosure');
    assert.ok(!JSON.stringify(result).includes(a.request_id), 'denial discloses no request');
  };
  for (const connection of [h.shared, foreign]) {
    const key = connection === h.shared ? b.request_capability : a.request_capability;
    await denied(connection, 'request_approval', { ...question(a), request_capability: key });
    for (const name of ['get_approval', 'cancel_approval', 'acknowledge_approval']) {
      await denied(connection, name, { request_id: a.request_id, request_capability: key,
        ...(name === 'acknowledge_approval' ? { decision_id: `dec_${'0'.repeat(32)}` } : {}) });
    }
  }
  const missing = await h.shared.call('get_approval', { request_id: a.request_id }).outcome;
  assert.ok(missing.frame.result?.isError === true, 'ID alone cannot recover capability');
  assert.equal((await get(h.shared, a)).resolution, 'pending', 'denied cancellation does not mutate');
  // Another RPC context under this SAME principal deliberately receives the key.
  const cancel = success(await h.shared.call('cancel_approval', authority(a), 102).outcome);
  assert.equal(cancel.resolution, 'cancelled', 'transferred key authorizes same-principal cancellation');
  const outcome = await wait.outcome;
  assert.equal(outcome.frame.id, 101, 'authority transfer never redirects original response');
  assert.equal(success(outcome).resolution, 'cancelled');
  // Controlled caller-side timeout, NOT an observed OpenCode execution timeout.
  const lost = h.shared.peer.call('tools/call', { name: 'request_approval', arguments: question(b) },
    { id: 103, ms: 250 });
  const message = await until(() => h.fixture.messages.find((m) => m.text.includes(b.request_id)
    && m.reply_markup?.inline_keyboard), 'second actionable question', h.signal);
  assert.equal((await lost.outcome).kind, 'timeout', 'caller stops waiting without a human outcome');
  h.shared.resource.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled',
    params: { requestId: 103, reason: 'cancel approval' } })}\n`);
  assert.equal((await get(h.shared, b)).resolution, 'pending', 'protocol reason is not business cancellation');
  h.fixture.choose(message, 'a');
  const retained = await until(async () => {
    const value = await get(h.shared, b);
    return value.resolution === 'approved' && value;
  }, 'retained key retrieves late human outcome', h.signal);
  assert.ok(/^dec_[a-f0-9]{32}$/.test(retained.decision_id), 'stable terminal identity');
  assert.ok(['unverified', 'unsupported'].includes(retained.event_capability.status), 'no verified Events from fixture');
  assert.ok(!h.shared.peer.unmatched.some((frame) => frame.id === 103), 'cancelled invocation gets no replacement result');
  const reconnected = await h.restart();
  const recovered = await get(reconnected, b);
  assert.equal(recovered.decision_id, retained.decision_id, 'durable late outcome survives orderly broker restart');
  assert.equal(recovered.resolution, 'approved');
}));

test('PORT-B: one shared stdio, concurrent reverse-order actual Approve/Reject/Respond results', { timeout: 65000 }, () => portable(async (h) => {
  const prepared = [await h.prepare(), await h.prepare(), await h.prepare()];
  const waits = prepared.map((p, i) => ask(h.shared, p, 200 + i));
  const presentations = await Promise.all(prepared.map((p) => until(() => h.fixture.messages.find((m) =>
    m.text.includes(p.request_id) && m.reply_markup?.inline_keyboard), 'actual Telegram question', h.signal)));
  for (let i = 0; i < 3; i++) {
    h.shared.peer.beforeDeadline(waits[i], 'must wait, no receipt or implicit approval');
    assert.equal((await get(h.shared, prepared[i])).resolution, 'pending');
    assert.ok(presentations[i].text.includes('same label'), 'prepared display label rendered');
  }
  const responseText = ' yes approved\n  instructions only 🧪 ';
  h.fixture.choose(presentations[2], 't');
  const prompt = await until(() => h.fixture.messages.find((m) => m.text.includes(prepared[2].request_id)
    && m.reply_markup?.force_reply === true), 'actual ForceReply prompt', h.signal);
  h.shared.peer.beforeDeadline(waits[2], 'Respond button alone is not a decision');
  h.fixture.text(responseText, prompt);
  const responded = success(await waits[2].outcome);
  assert.equal((await waits[2].outcome).frame.id, 202);
  assert.equal(responded.request_id, prepared[2].request_id);
  assert.equal(responded.resolution, 'responded');
  assert.equal(responded.response_text, responseText);
  h.shared.peer.beforeDeadline(waits[0], 'first unrelated call still waiting');
  h.shared.peer.beforeDeadline(waits[1], 'second unrelated call still waiting');
  for (const [i, button, resolution] of [[1, 'r', 'rejected'], [0, 'a', 'approved']]) {
    h.fixture.choose(presentations[i], button);
    const outcome = await waits[i].outcome, value = success(outcome);
    assert.equal(outcome.frame.id, 200 + i);
    assert.equal(value.request_id, prepared[i].request_id);
    assert.equal(value.resolution, resolution);
    assert.equal(value.response_text, null);
  }
  for (let i = 0; i < 3; i++) {
    const original = success(await waits[i].outcome);
    const reread = await get(h.shared, prepared[i]);
    assert.equal(reread.decision_id, original.decision_id);
    assert.equal(reread.resolution, original.resolution);
    assert.ok(!JSON.stringify(reread).includes(prepared[i].request_capability), 'representation never echoes key');
    const ack = success(await h.shared.call('acknowledge_approval', {
      ...authority(prepared[i]), decision_id: original.decision_id }).outcome);
    assert.equal(ack.delivery_state, 'confirmed');
  }
}));
