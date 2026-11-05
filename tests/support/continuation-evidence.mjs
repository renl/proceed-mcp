// TEST ONLY. Protocol reads and evidence checks; not a product API or attestation.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

const copy = (value) => structuredClone(value);
const marker = (message, request) => message.id === `msg_${request.request_id.slice(4)}` ||
  (typeof message.text === 'string' && message.text.includes(request.request_id));

// A controlled case asks the model to emit this exact sentence. This is a
// deliberately narrow test oracle, NOT a normative assistant output schema.
export function acknowledgementText(request) {
  const outcome = { approved: 'approval', rejected: 'rejection; no approval',
    responded: 'instructions only; no approval' }[request.resolution];
  assert.ok(outcome, 'human resolution required');
  return `Request ${request.request_id}: ${outcome}. Action=${JSON.stringify(request.action)}; ` +
    `context=${JSON.stringify(request.context)}; response=${JSON.stringify(request.response_text)}.`;
}

export function assertPromptRecord(text, request) {
  // Locate the design's embedded JSON data record without prescribing its
  // heading, whitespace or fences. Only a complete exact record is accepted.
  const expected = { schema_version: 1, ...request };
  let found = false;
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    for (let end = text.lastIndexOf('}'); end > start; end = text.lastIndexOf('}', end - 1)) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed.request_id !== request.request_id) continue;
        assert.deepEqual(parsed, expected, 'prompt decision intent changed');
        found = true;
      } catch (error) {
        if (error.code === 'ERR_ASSERTION') throw error;
      }
    }
  }
  assert.ok(found, 'missing exact decision JSON data record');
}

async function history(get, session, type) {
  const messages = new Map();
  const visited = new Set();
  let cursor;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ type, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    else query.set('order', 'desc');
    const path = `/api/session/${encodeURIComponent(session)}/message?${query}`;
    const body = await get(path);
    assert.ok(Array.isArray(body.data), 'history envelope');
    for (const message of body.data) {
      assert.equal(message.type, type, 'history type');
      assert.equal(typeof message.id, 'string', 'history ID');
      assert.ok(!messages.has(message.id), 'overlapping history pages');
      messages.set(message.id, copy(message));
    }
    cursor = body.cursor?.next;
    if (!cursor) return [...messages.values()];
    assert.ok(!visited.has(cursor), 'history cursor cycle');
    visited.add(cursor);
  }
  assert.fail('history pagination budget exhausted; incomplete evidence');
}

async function snapshot(get, sessions, assistantText) {
  const result = {};
  for (const session of sessions) {
    const user = await history(get, session, 'user');
    const assistantRaw = await history(get, session, 'assistant');
    // Extraction must be grounded in the pinned running-host assistant schema.
    // No assumed assistant `text` field is part of the public protocol here.
    const assistant = assistantRaw.map((raw) => {
      const extracted = assistantText(copy(raw));
      const textParts = typeof extracted === 'string' ? [extracted] : extracted?.textParts;
      assert.ok(Array.isArray(textParts) && textParts.every((text) => typeof text === 'string'),
        'missing actual assistant content');
      // Join ONLY for conservative marker detection, never as acknowledgement
      // semantics. The controlled oracle requires exactly one intact text part.
      return { id: raw.id, type: raw.type, text: textParts.join(''), textParts,
        extracted, raw };
    });
    const path = `/api/session/${encodeURIComponent(session)}/inbox`;
    const inbox = await get(path);
    assert.ok(Array.isArray(inbox.data), 'inbox envelope');
    result[session] = { user, assistant, inbox: copy(inbox.data) };
  }
  return result;
}

function extend(previous, current) {
  for (const session of Object.keys(previous)) {
    for (const type of ['user', 'assistant']) {
      for (const old of previous[session][type]) {
        assert.deepEqual(current[session][type].find((item) => item.id === old.id), old,
          'history disappeared or changed; evidence incomplete');
      }
    }
  }
}

function assertResult(baseline, current, request, prompt, sessions) {
  const [target, other] = sessions;
  for (const session of sessions) {
    const before = baseline[session];
    const after = current[session];
    for (const type of ['user', 'assistant']) {
      assert.ok(!before[type].some((item) => marker(item, request)),
        'preexisting decision content cannot prove this case');
    }
    const inputs = after.user.filter((item) => marker(item, request));
    const acknowledgements = after.assistant.filter((item) => marker(item, request));
    if (session === other) {
      assert.equal(inputs.length, 0, 'wrong-session decision input');
      assert.equal(acknowledgements.length, 0, 'wrong-session acknowledgement');
      assert.ok(!after.inbox.some((item) => marker(item, request)), 'wrong-session inbox');
      continue;
    }
    assert.equal(session, target);
    assert.equal(inputs.length, 1, 'exactly one matching decision input');
    assert.equal(inputs[0].id, prompt.id, 'stable history ID');
    assert.equal(inputs[0].text, prompt.text, 'history must preserve exact persisted payload');
    assert.ok(!after.inbox.some((item) => marker(item, request)), 'input still queued');
    assert.equal(acknowledgements.length, 1, 'exactly one decision acknowledgement');
    assert.deepEqual(acknowledgements[0].textParts, [acknowledgementText(request)],
      'actual acknowledgement must preserve outcome/action/context/response');
    assert.ok(!acknowledgements[0].extracted?.observations?.error &&
      !acknowledgements[0].extracted?.observations?.retry,
    'acknowledgement with error/retry is inconclusive');
  }
}

function assertDurable(durable, request) {
  assert.ok(durable && durable.request && durable.prompt, 'missing durable snapshot');
  assert.deepEqual(durable.request, request, 'persisted decision changed');
  assert.equal(durable.prompt.id, `msg_${request.request_id.slice(4)}`, 'persisted stable ID');
  assert.equal(typeof durable.prompt.text, 'string');
  assertPromptRecord(durable.prompt.text, request);
}

// Injected clock is ONLY for deterministic offline self-tests. No duration,
// count, intentVerified or caller success flag is accepted as evidence.
export async function collectWithClock(io, request, sessions, clock) {
  request = copy(request); // Pin the predeclared case, not mutable caller flags.
  assert.equal(sessions.length, 2);
  assert.notEqual(sessions[0], sessions[1]);
  assert.equal(sessions[0], request.session_id, 'target session binding');
  for (const name of ['get', 'brokerGet', 'assistantText', 'readDurable', 'deliver', 'replay']) {
    assert.equal(typeof io[name], 'function', `BLOCKED: missing ${name} adapter`);
  }
  if (request.request_id !== undefined) assert.match(request.request_id, /^req_[a-f0-9]{32}$/);
  const reads = [];
  const get = async (path) => {
    const body = copy(await io.get(path));
    reads.push({ boundary: 'opencode', path, body: copy(body) });
    return body;
  };
  const assertAccepted = async () => {
    const path = `/v1/requests/${encodeURIComponent(request.request_id)}?session_id=` +
      encodeURIComponent(request.session_id);
    const body = copy(await io.brokerGet(path));
    reads.push({ boundary: 'broker', path, body: copy(body) });
    assert.deepEqual(Object.fromEntries(Object.keys(request).map((key) => [key, body[key]])),
      request, 'public accepted decision differs from predeclared case');
  };
  const baseline = await snapshot(get, sessions, io.assistantText);
  const created = await io.deliver(); // Real Telegram AFTER actual host timeout.
  if (request.request_id === undefined) {
    // Product allocates the random ID and accepted timestamp, not the test.
    // Bind the previously observed pending receipt AFTER the earlier baseline.
    assert.match(created?.request_id ?? '', /^req_[a-f0-9]{32}$/, 'missing actual created request');
    for (const key of ['origin_id', 'session_id', 'action', 'context']) {
      assert.equal(created[key], request[key], `created ${key} differs from case`);
    }
    assert.equal(created.resolution, 'pending', 'creation must be observed pending');
    const path = `/v1/requests/${created.request_id}?session_id=${encodeURIComponent(request.session_id)}`;
    const accepted = copy(await io.brokerGet(path));
    reads.push({ boundary: 'broker', path, body: copy(accepted) });
    for (const [key, value] of Object.entries(request)) assert.deepEqual(accepted[key], value,
      `accepted ${key} differs from case`);
    assert.equal(accepted.request_id, created.request_id, 'accepted request identity changed');
    assert.equal(typeof accepted.resolved_at, 'string', 'accepted timestamp missing');
    request = Object.fromEntries(['request_id', 'origin_id', 'session_id', 'action', 'context',
      'resolution', 'response_text', 'resolved_at'].map((key) => [key, accepted[key]]));
  }
  await assertAccepted();
  const durable = copy(await io.readDurable());
  assertDurable(durable, request);
  let current = await snapshot(get, sessions, io.assistantText);
  extend(baseline, current);
  assertResult(baseline, current, request, durable.prompt, sessions);
  await io.replay(); // Future runner: broker restart, same state, fixed origin.
  const start = clock.now();
  assert.ok(Number.isFinite(start));
  let elapsed = 0;
  const samples = [];
  do {
    const started = clock.now() - start;
    assert.ok(Number.isFinite(started) && started >= elapsed, 'nonmonotonic snapshot start');
    await assertAccepted();
    const restarted = copy(await io.readDurable());
    assertDurable(restarted, request);
    assert.deepEqual(restarted, durable, 'durable payload changed across replay');
    const next = await snapshot(get, sessions, io.assistantText);
    extend(current, next);
    assertResult(baseline, next, request, durable.prompt, sessions);
    current = next;
    const measured = clock.now() - start;
    assert.ok(Number.isFinite(measured) && measured >= elapsed, 'nonmonotonic observation');
    // A stalled observer cannot claim continuous bounded duplicate observation.
    assert.ok(measured - elapsed <= 5000, 'observation gap exceeds 5 seconds');
    elapsed = measured;
    samples.push({ started, elapsed, sessions: copy(current) });
    // Completing a slow early read after the edge is not a final observation.
    // Every public read in the final snapshot must START after the full window.
    if (started >= 30000) break;
    await clock.sleep(Math.max(0, Math.min(2000, 30000 - elapsed)));
  } while (samples.length < 100);
  assert.ok(elapsed >= 30000, 'full measured 30-second replay window required');
  assert.ok(samples.at(-1).started >= 30000, 'final snapshot must start after replay window');
  return { baseline, durable, reads, samples, elapsed, kind: 'test-only collected evidence' };
}

// Real runner entry: no clock/window injection, real monotonic elapsed time.
// Each external adapter must honor its AbortSignal; no live adapters exist yet.
export function collectContinuationEvidence(io, request, sessions) {
  const signal = AbortSignal.timeout(120000);
  const bounded = {};
  for (const name of ['get', 'brokerGet', 'readDurable', 'deliver', 'replay']) {
    if (typeof io[name] === 'function') {
      bounded[name] = (...args) => io[name](...args, signal);
    }
  }
  bounded.assistantText = io.assistantText;
  return collectWithClock(bounded, request, sessions, {
    now: () => performance.now(), sleep: (ms) => sleep(ms, undefined, { signal }),
  });
}
