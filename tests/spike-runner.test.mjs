import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCommitBeforeEffect, assertPublicRestart, deliverAfterActualTimeout,
  authenticatedReader, runTimeoutCase } from './support/spike-runner.mjs';

const pending = { request_id: `req_${'a'.repeat(32)}`, session_id: 'target', origin_id: 'fixture',
  resolution: 'pending', response_text: null, resolved_at: null };
const accepted = { ...pending, resolution: 'responded', response_text: ' yes\n ',
  resolved_at: '2026-10-31T00:00:00Z' };
const prompt = { id: `msg_${'a'.repeat(32)}`, text: 'exact fixture payload\n ' };

test('DURABILITY-CONTRACT: public restart consumer covers pending and three accepted delivery stages', async () => {
  for (const [request, outbox] of [[pending, null], ...['pending', 'admitted', 'delivered']
    .map((delivery_state) => [{ ...accepted, delivery_state }, prompt])]) {
    let restarted = false;
    const io = {
      async restartBroker() { restarted = true; },
      async brokerGet(path) { assert.ok(restarted); assert.match(path, /session_id=target$/); return request; },
      async readCommitted() { return { request, prompt: outbox }; },
    };
    await assertPublicRestart(io, request, outbox);
    await assertCommitBeforeEffect(io.readCommitted, request, outbox);
    io.readCommitted = async () => ({ request: pending, prompt: null });
    if (outbox) await assert.rejects(assertPublicRestart(io, request, outbox), /before request\/resolution commit/);
  }
});

test('DURABILITY-NEG: public status cannot substitute for committed exact outbox or lost restart state', async () => {
  for (const committed of [null, { request: accepted, prompt: null },
    { request: accepted, prompt: { ...prompt, text: prompt.text.trim() } }]) {
    await assert.rejects(assertCommitBeforeEffect(async () => committed, accepted, prompt));
  }
  await assert.rejects(assertPublicRestart({ restartBroker: async () => {},
    brokerGet: async () => pending, readCommitted: async () => ({ request: accepted, prompt }) },
  accepted, prompt), /public restart state changed/);
});

test('TIMEOUT-SEQUENCE: pending and withheld while unsettled, actual host timeout, same host, then human', async () => {
  const order = [];
  const names = ['armReceiptFault', 'invokeHost', 'observePending', 'assertHostCallUnsettled',
    'observeWithheld', 'observeActualHostTimeout', 'assertSameHost',
    'resolveThroughPairedTelegram', 'waitForAcknowledgement'];
  const io = Object.fromEntries(names.map((name) => [name, async () => { order.push(name); }]));
  await deliverAfterActualTimeout(io);
  assert.deepEqual(order, [...names.slice(0, 5), 'assertHostCallUnsettled', ...names.slice(5)]);
  for (const stop of ['observePending', 'observeWithheld', 'assertHostCallUnsettled', 'observeActualHostTimeout', 'assertSameHost']) {
    order.length = 0;
    await assert.rejects(deliverAfterActualTimeout({ ...io, [stop]: async () => { throw Error(stop); } }),
      new RegExp(stop));
    assert.ok(!order.includes('resolveThroughPairedTelegram'));
  }
});

test('RUNNER-RED-CONTRACT: no adapters/extractor means failure, never fixture fallback or skip', async () => {
  await assert.rejects(deliverAfterActualTimeout({}), /RED: missing production armReceiptFault/);
  await assert.rejects(runTimeoutCase({}, pending, ['target', 'other']), /missing get adapter/);
  for (const url of ['http://localhost:80', 'http://127.0.0.1:080', 'http://127.0.0.1:65536',
    'http://127.0.0.1:80/other', 'https://127.0.0.1:80']) {
    assert.throws(() => authenticatedReader(url, 'Basic fixture'));
  }
});
