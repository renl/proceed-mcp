// TEST ONLY. Runner owns the adapter process, streams, private sink and teardown.
import assert from 'node:assert/strict';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertOriginalCallRouting } from './harness-qualification-assertions.mjs';
import { createHash } from 'node:crypto';

// Receipt of completed private writes, not a claim of scenario success. A killed
// producer without this receipt cannot be replaced by an empty file assumption.
export function privateCaptureWriter(maxBytes = 16 * 1048576) {
  const hash = createHash('sha256');
  let bytes = 0,
    failed = false,
    sealed = false;
  return {
    written(chunk) {
      if (sealed) throw Error('private writer sealed');
      bytes += chunk.length;
      if (bytes > maxBytes) {
        failed = true;
        throw Error('private file limit');
      }
      hash.update(chunk);
    },
    failed() {
      failed = true;
    },
    seal() {
      if (sealed) throw Error('private writer sealed');
      sealed = true;
      return { complete: !failed, bytes, sha256: hash.digest('hex') };
    },
  };
}

export function assertPrivateCaptureReceipt(bytes, receipt, step = () => {}) {
  step('SCHEMA');
  assert.ok(Buffer.isBuffer(bytes));
  assert.ok(receipt && typeof receipt === 'object');
  assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'complete', 'sha256']);
  for (const key of ['bytes', 'complete', 'sha256'])
    assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(receipt, key), 'value'));
  assert.equal(typeof receipt.complete, 'boolean');
  assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes >= 0);
  assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
  step('COMPLETE');
  assert.equal(receipt.complete, true, 'private writer incomplete');
  step('LENGTH');
  assert.equal(receipt.bytes, bytes.length, 'private writer byte coverage');
  step('HASH');
  assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
}

export function transparentMcpCapture(connection, persist, maxBytes = 1048576) {
  assert.ok(typeof connection === 'string' && connection.length > 0);
  assert.ok(Number.isSafeInteger(maxBytes) && maxBytes > 0);
  let sequence = 0;
  let bytes = 0;
  let persisted = Promise.resolve();
  const tap = (direction) =>
    new Transform({
      transform(chunk, encoding, done) {
        const raw = Buffer.from(chunk);
        bytes += raw.length;
        if (bytes > maxBytes) return done(new Error('MCP private capture ceiling exceeded'));
        const event = {
          connection,
          sequence: sequence++,
          direction,
          base64: raw.toString('base64'),
        };
        // Preserve exact bytes, including framing, metadata, IDs and capabilities.
        // Persistence must finish before forwarding. No parsing/rewrite on the wire.
        persisted = persisted.then(() => persist(event));
        persisted.then(() => done(null, raw), done);
      },
    });
  return { ingress: tap('host-to-adapter'), egress: tap('adapter-to-host') };
}

export async function bridgeCapturedMcp({
  hostInput,
  hostOutput,
  adapterInput,
  adapterOutput,
  persist,
  connection,
  signal,
}) {
  const taps = transparentMcpCapture(connection, persist);
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  const run = async (source, tap, destination) => {
    try {
      await pipeline(source, tap, destination, { signal: combined });
    } catch (error) {
      controller.abort(error);
      throw error;
    }
  };
  // Attach BOTH directions before returning control to the invocation driver.
  const outcomes = await Promise.allSettled([
    run(hostInput, taps.ingress, adapterInput),
    run(adapterOutput, taps.egress, hostOutput),
  ]);
  const failure = outcomes.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
}

export function decodeMcpCapture(events, connection, { allowEmptyDirections = false } = {}) {
  assert.ok(Array.isArray(events) && (allowEmptyDirections || events.length > 0));
  for (const e of events) {
    assert.deepEqual(Object.keys(e).sort(), ['base64', 'connection', 'direction', 'sequence']);
    assert.equal(e.connection, connection);
    assert.equal(Buffer.from(e.base64, 'base64').toString('base64'), e.base64);
  }
  for (const e of events) assert.ok(['host-to-adapter', 'adapter-to-host'].includes(e.direction));
  const result = {};
  for (const direction of ['host-to-adapter', 'adapter-to-host']) {
    const selected = events.filter((e) => e.direction === direction);
    for (const e of selected) assert.equal(e.connection, connection);
    const raw = Buffer.concat(selected.map((e) => Buffer.from(e.base64, 'base64')));
    if (allowEmptyDirections && raw.length === 0) {
      result[direction] = [];
      continue;
    }
    assert.equal(raw.at(-1), 10, 'incomplete MCP frame or missing direction');
    result[direction] = raw
      .toString('utf8')
      .trim()
      .split('\n')
      .map((line) => ({ connection, message: JSON.parse(line) }));
  }
  assert.deepEqual(
    events.map((e) => e.sequence),
    events.map((_, i) => i),
  );
  return { calls: result['host-to-adapter'], results: result['adapter-to-host'] };
}

// expected comes from independent public broker/presentation observations, not
// from the callback or the wire capture being checked. List sessions in creation
// order. The scenario requires completion in the opposite order.
export function assertRegisteredWrapperCapture({ calls, results }, callbacks, expected) {
  assert.equal(expected.length, 2);
  const bindings = expected.map((e) => {
    const original = (name) => {
      const found = calls.filter(
        (c) =>
          c.message.method === 'tools/call' &&
          c.message.params.name === name &&
          c.message.params._meta?.['ai.opencode/sessionID'] === e.session_id,
      );
      assert.equal(found.length, 1, 'missing or duplicated actual originating call');
      return found[0].message.id;
    };
    const prepare_id = original('prepare_approval');
    const wait_id = original('request_approval');
    for (const [phase, id] of [
      ['prepare', prepare_id],
      ['wait', wait_id],
    ]) {
      const wire = results.filter((r) => r.message.id === id);
      assert.equal(wire.length, 1, 'missing or duplicated original wire result');
      assert.equal(wire[0].connection, calls[0].connection);
      assert.equal(wire[0].message.error, undefined);
      assert.notEqual(wire[0].message.result?.isError, true);
      const body = wire[0].message.result?.structuredContent;
      assert.ok(body, 'NoContent/callback value cannot replace MCP structured result');
      assert.equal(body.request_id, e.request_id);
      const returned = callbacks.filter(
        (c) => c.phase === `${phase}-returned` && c.sessionID === e.session_id,
      );
      assert.equal(returned.length, 1);
      assert.deepEqual(
        returned[0].value.output,
        body,
        'registered callback output differs from wire result',
      );
      assert.match(returned[0].coreCallID, /^qualification-synthetic-/);
      assert.notEqual(returned[0].coreCallID, id, 'synthetic core call ID is not MCP wire ID');
    }
    return { ...e, prepare_id, wait_id };
  });
  assertOriginalCallRouting(calls, results, bindings);
  const waiting = results.filter((r) => bindings.some((e) => e.wait_id === r.message.id));
  assert.deepEqual(
    waiting.map((r) => r.message.id),
    bindings.map((e) => e.wait_id).reverse(),
    'waiting results must complete in reverse creation order',
  );
}
