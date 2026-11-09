// TEST ONLY. Integrated composition adapters, no entrypoint or launch side effect.
// Real observations must be supplied by the maintained contained runner. Memory
// tests of this orchestration are proxies, not public-host/human/wire proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compositionSourceFrame } from './harness-composition-readiness.mjs';
import { exerciseRenderedProduct } from './harness-rendered-product.mjs';
import {
  decodeMcpCapture,
  assertRegisteredWrapperCapture,
} from './harness-transparent-capture.mjs';
import { assertBoundRetainedOutcome } from './harness-qualification-assertions.mjs';

const digest = (v) => createHash('sha256').update(v).digest('hex');

// Actual protected-broker/private-capture adapters. Does not create a request or
// connect an owner adapter. The real host alone starts the transparent stdio entry.
export function requestResultWireAdapter(h, { scenario, wait, now = () => performance.now() }) {
  assert.equal(scenario, 'request-to-originating-result');
  assert.equal(h.shared, null, 'host owns the sole owner adapter');
  assert.equal(typeof wait, 'function');
  const presentations = new Map(),
    lastPending = new Map();
  const scope = { harness_id: 'qualification', owner_id: 'shared' };
  const post = async (path, body) => {
    const response = await h.http(path, h.operator.credential, { method: 'POST', body });
    assert.equal(response.status, 200);
    return response.json();
  };
  const lines = async (name) => {
    const bytes = await readFile('/run/proceed/qualification-private/' + name);
    assert.ok(bytes.length <= 16 * 1048576);
    return bytes
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((s) => JSON.parse(s));
  };
  const observe = async (presentation) => {
    assert.deepEqual(
      presentations.get(presentation.presentation_id),
      presentation,
      'presentation must come from the actual pending wire',
    );
    const status = await post('/v1/harness/presentations/' + presentation.presentation_id, {
      ...scope,
      session_id: presentation.session_id,
      request_id: presentation.request_id,
    });
    assert.equal(status.request_id, presentation.request_id);
    return { presentation: structuredClone(presentation), status };
  };
  return Object.freeze({
    connection: 'composition-shared-owner',
    async captureArmed() {
      const marker = JSON.parse(
        await readFile('/run/proceed/qualification-private/mcp-armed.json', 'utf8'),
      );
      return marker.connection === 'composition-shared-owner' && marker.capture === 'ATTACHED';
    },
    async waitPending(session_id) {
      let presentation;
      await wait('concurrent-product-pending', async () => {
        const tick = now();
        assert.ok(Number.isFinite(tick));
        if (tick - (lastPending.get(session_id) ?? -Infinity) < 1000) return false;
        lastPending.set(session_id, tick);
        const body = await post('/v1/harness/pending', { ...scope, session_id });
        assert.equal(body.schema_version, 1);
        if (body.presentation === null) return false;
        assert.equal(body.presentation.session_id, session_id);
        presentation = structuredClone(body.presentation);
        presentations.set(presentation.presentation_id, structuredClone(presentation));
        return true;
      });
      return presentation;
    },
    observe,
    async waitRetainedOutcome(presentation) {
      let retained;
      await wait('matching-product-retained-outcome', async () => {
        retained = (await observe(presentation)).status;
        return retained.resolution !== 'pending';
      });
      return retained;
    },
    readPrivateCapture: () => lines('mcp.jsonl'),
    readPrivateCallbacks: () => lines('wrapper.jsonl'),
    verifyCompletion(result, status) {
      assert.equal(result.assertion, 'AUTOMATED_COMPOSITION_PROXY');
      assert.equal(result.human, 'UNRUN');
      assert.equal(new Set(result.request_ids).size, 3);
      assert.deepEqual(
        status.requests.map((r) => r.request_id).sort(),
        [...result.request_ids].sort(),
      );
      assert.ok(
        status.requests.every((r) => ['approved', 'rejected', 'responded'].includes(r.resolution)),
      );
    },
  });
}

// Bound current cells only. No cumulative ANSI-stripped substring search, expected
// screen injection, profile import or private host dialog getter. Unsupported
// layouts fail closed. This intentionally does not guess wrapping/scrolling.
export function observeCurrentQuestion({ raw, live, binding, presentation, previous }) {
  assert.ok(Buffer.isBuffer(raw) && raw.length > 0 && raw.length <= 1048576);
  assert.equal(live.live, true);
  assert.equal(live.run, binding.run);
  assert.equal(live.generation, binding.setup);
  assert.deepEqual(live.geometry, binding.geometry);
  if (previous) {
    assert.ok(raw.length >= previous.bytes);
    assert.equal(digest(raw.subarray(0, previous.bytes)), previous.sha256);
    assert.deepEqual(previous.presentation, presentation);
    assert.deepEqual(previous.binding, binding);
  }
  const frame = compositionSourceFrame(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  assert.equal(frame.supported, true, 'unsupported current cells');
  assert.ok(frame.frames > 0 && frame.generation > 0);
  if (previous) {
    assert.equal(frame.generation, previous.screen);
    assert.ok(frame.frames >= previous.frames);
  }
  for (const field of ['request_id', 'session_label', 'action', 'context', 'expires_at']) {
    assert.equal(typeof presentation[field], 'string');
    assert.ok(frame.text.includes(presentation[field]), `incomplete current ${field}`);
  }
  for (const control of ['Reject', 'Respond', 'Approve'])
    assert.ok(
      frame.text.split('\n').some((s) => s.trim() === control),
      `missing ${control} control`,
    );
  assert.equal(frame.text.includes('Open Proceed question?'), false);
  return Object.freeze({
    binding: structuredClone(binding),
    presentation: structuredClone(presentation),
    bytes: raw.length,
    sha256: digest(raw),
    frames: frame.frames,
    screen: frame.generation,
  });
}

// Use prepared actual PTY/public-wrapper IO, never an expected-frame provider.
// Each choice write rechecks current raw prefix, fixed inputs and setup lifetime
// synchronously after asynchronous public reads. Navigation retains its own
// independently accepted identity/selection fences.
export function currentQuestionAdapter({ readRaw, readLive, readBinding, binding, now, deadline }) {
  const fixed = structuredClone(binding);
  let previous,
    invalid = false,
    last = -Infinity;
  const check = (presentation) => {
    assert.equal(invalid, false);
    try {
      const tick = now();
      assert.ok(Number.isFinite(tick) && tick >= last && tick < deadline);
      last = tick;
      assert.deepEqual(readBinding(), fixed);
      const raw = Buffer.from(readRaw());
      const live = structuredClone(readLive());
      const observed = observeCurrentQuestion({
        raw,
        live,
        binding: fixed,
        presentation,
        previous,
      });
      assert.deepEqual(readLive(), live);
      assert.deepEqual(readRaw(), raw);
      assert.deepEqual(readBinding(), fixed);
      const final = now();
      assert.ok(Number.isFinite(final) && final >= tick && final < deadline);
      assert.equal(invalid, false);
      last = final;
      previous = observed;
      return observed;
    } catch {
      invalid = true;
      assert.fail('current question admission refused');
    }
  };
  return Object.freeze({
    check,
    input(presentation, write, bytes) {
      check(presentation);
      assert.equal(typeof write, 'function');
      assert.equal(invalid, false);
      write(bytes);
    },
    invalidate() {
      invalid = true;
    },
  });
}

// Driver owns real resources. Its invoke promise is the actual registered host
// command completion. A pending request cannot be replaced by a callback record.
// Capture must already be armed, before the sole adapter is started by the host.
export async function exerciseRequestToOriginatingResult(driver) {
  assert.equal(await driver.captureArmed(), true);
  const sessions = structuredClone(await driver.readPublicSessions());
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0].id, sessions[1].id);
  assert.equal(sessions[0].title, sessions[1].title);
  const invocations = [];
  try {
    for (const session of sessions) {
      const invocation = Promise.resolve(driver.invokeRegistered(session.id));
      invocation.catch(() => {}); // Drained in finally even on an earlier admission failure.
      invocations.push(invocation);
    }
    const presentations = await Promise.all(sessions.map((s) => driver.waitPending(s.id)));
    assert.notEqual(presentations[0].request_id, presentations[1].request_id);
    for (let n = 0; n < 2; n++) {
      assert.equal(presentations[n].session_id, sessions[n].id);
      const observed = await driver.observe(presentations[n]);
      assert.equal(
        observed.status.resolution,
        'pending',
        'both sessions pending before first decision',
      );
      assert.deepEqual(observed.presentation, presentations[n]);
    }
    const expected = [];
    for (const n of [1, 0]) {
      // Every call gets a new navigation bridge and question lifetime, not a
      // historical profile or recovered identity from the preceding session.
      let rendered = await driver.forSession(sessions[n]);
      assert.equal(
        typeof rendered.chooseCurrentQuestion,
        'function',
        'actual integration requires fresh selected-choice input fencing',
      );
      if (n === 1) {
        await exerciseRenderedProduct(rendered, presentations[n], 'dismiss', sessions[n]);
        rendered = await driver.forSession(sessions[n]);
        assert.equal(typeof rendered.chooseCurrentQuestion, 'function');
      }
      const choice = n === 1 ? 'approve' : 'reject';
      await exerciseRenderedProduct(rendered, presentations[n], choice, sessions[n]);
      const retained = (await driver.observe(presentations[n])).status;
      assertBoundRetainedOutcome(presentations[n], retained, choice);
      await driver.assertSingleDurableEffect(presentations[n], retained);
      await driver.assertStaleAndLosingNonEffect(presentations[n], retained);
      expected[n] = {
        ...presentations[n],
        decision_id: retained.decision_id,
        resolution: retained.resolution,
        response_text: retained.response_text,
      };
    }
    await Promise.all(invocations);
    const capture = decodeMcpCapture(await driver.readPrivateCapture(), driver.connection);
    assertRegisteredWrapperCapture(capture, await driver.readPrivateCallbacks(), expected);
    // Separate request: the occupied slot is now released, Respond text must
    // never change the already-tested approve/reject effects or become approval.
    const responseInvocation = Promise.resolve(driver.invokeRegistered(sessions[0].id));
    responseInvocation.catch(() => {});
    invocations.push(responseInvocation);
    const responsePresentation = await driver.waitPending(sessions[0].id);
    assert.equal(
      presentations.some((p) => p.request_id === responsePresentation.request_id),
      false,
    );
    const responding = await driver.forSession(sessions[0]);
    assert.equal(typeof responding.chooseCurrentQuestion, 'function');
    await exerciseRenderedProduct(responding, responsePresentation, 'respond', sessions[0]);
    const responseRetained = (await driver.observe(responsePresentation)).status;
    assertBoundRetainedOutcome(responsePresentation, responseRetained, 'respond', 'approved');
    await driver.assertSingleDurableEffect(responsePresentation, responseRetained);
    await responseInvocation;
    const completeCapture = decodeMcpCapture(await driver.readPrivateCapture(), driver.connection);
    const newCalls = completeCapture.calls
      .slice(capture.calls.length)
      .filter((c) => c.message.method === 'tools/call');
    assert.equal(newCalls.length, 2);
    assert.deepEqual(
      newCalls.map((c) => c.message.params.name),
      ['prepare_approval', 'request_approval'],
    );
    for (const call of newCalls) {
      assert.equal(call.message.params._meta?.['ai.opencode/sessionID'], sessions[0].id);
      assert.equal('harness_route' in call.message.params.arguments, false);
      assert.equal('session_id' in call.message.params.arguments, false);
      const result = completeCapture.results.filter((r) => r.message.id === call.message.id);
      assert.equal(result.length, 1);
      assert.equal(result[0].message.error, undefined);
      assert.notEqual(result[0].message.result?.isError, true);
      const body = result[0].message.result?.structuredContent;
      assert.equal(body?.request_id, responsePresentation.request_id);
      if (call.message.params.name === 'request_approval') {
        assert.equal(body.decision_id, responseRetained.decision_id);
        assert.equal(body.resolution, 'responded');
        assert.equal(body.response_text, 'approved');
      }
    }
    return {
      request_ids: [...presentations, responsePresentation].map((p) => p.request_id),
      assertion: 'AUTOMATED_COMPOSITION_PROXY',
      human: 'UNRUN',
    };
  } finally {
    // Cancellation belongs to the existing runner's lifetime and is not durable
    // request cancellation. Drain rejections without leaving unhandled tasks.
    await driver.abortInvocations();
    await Promise.allSettled(invocations);
  }
}
