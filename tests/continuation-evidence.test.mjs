import assert from 'node:assert/strict';
import test from 'node:test';
import { acknowledgementText, collectWithClock, collectContinuationEvidence }
  from './support/continuation-evidence.mjs';
import { composeTimeoutIO } from './support/spike-runner.mjs';
import { extractAssistant } from './support/assistant-extraction.mjs';

function fixture(resolution = 'responded') {
  const request = { request_id: `req_${'a'.repeat(32)}`, origin_id: 'fixture',
    session_id: 'ses_target', action: 'deploy', context: 'fixture only', resolution,
    response_text: resolution === 'responded' ? ' yes, approved\n"keep this" ' : null,
    resolved_at: '2026-10-31T00:00:00Z' };
  const prompt = { id: `msg_${'a'.repeat(32)}`,
    text: `Fixture heading\n${JSON.stringify({ schema_version: 1, ...request })}` };
  let now = 0;
  let delivered = false;
  let replayed = false;
  const histories = Object.fromEntries(['ses_target', 'ses_other'].map((session) =>
    [session, { user: [{ id: `old_${session}`, type: 'user', text: 'unrelated' }],
      assistant: [{ id: `old_ack_${session}`, type: 'assistant', fixtureContent: 'unrelated' }] }]));
  const durable = { request: structuredClone(request), prompt: { ...prompt } };
  const paths = [];
  const state = { request, prompt, durable, histories, paths, onReplay() {}, onTick() {},
    afterDeliver() {}, readDurable: () => durable };
  const io = {
    async brokerGet(path) {
      assert.equal(path, `/v1/requests/${request.request_id}?session_id=ses_target`);
      return structuredClone(request);
    },
    async get(path) {
      paths.push(path);
      const url = new URL(path, 'http://fixture.invalid');
      const [, , , encodedSession, resource] = url.pathname.split('/');
      const session = decodeURIComponent(encodedSession);
      assert.ok(histories[session], 'unknown session');
      if (resource === 'inbox') return { data: [] };
      assert.equal(resource, 'message');
      const type = url.searchParams.get('type');
      const cursor = url.searchParams.get('cursor');
      if (cursor) assert.equal(url.searchParams.has('order'), false);
      // Always paginate so baseline and result require complete traversal.
      const all = structuredClone(histories[session][type]);
      return cursor ? { data: all.slice(1), cursor: {} } :
        { data: all.slice(0, 1), cursor: { next: 'fixture_page_2' } };
    },
    assistantText: (raw) => raw.fixtureContent,
    async readDurable() { return structuredClone(state.readDurable()); },
    async deliver() {
      assert.equal(delivered, false);
      delivered = true;
      histories.ses_target.user.push({ ...prompt, type: 'user' });
      histories.ses_target.assistant.push({ id: 'new_ack', type: 'assistant',
        fixtureContent: acknowledgementText(request) });
      state.afterDeliver();
    },
    async replay() { replayed = true; state.onReplay(); },
  };
  const clock = { now: () => now, async sleep(ms) {
    assert.ok(delivered && replayed);
    now += ms;
    state.onTick(now);
  } };
  return { ...state, state, io, clock, advance(ms) { now += ms; }, run: () =>
    collectWithClock(io, request, ['ses_target', 'ses_other'], clock) };
}

test('EVIDENCE-01: both-session paginated provenance, exact content and measured replay window', async () => {
  for (const resolution of ['approved', 'rejected', 'responded']) {
    const f = fixture(resolution);
    const evidence = await f.run();
    assert.equal(evidence.elapsed, 30000);
    assert.equal(evidence.samples.length, 16);
    assert.equal(evidence.baseline.ses_target.assistant.length, 1);
    const final = evidence.samples.at(-1).sessions;
    assert.equal(final.ses_target.assistant[1].raw.fixtureContent, acknowledgementText(f.request));
    assert.equal(final.ses_other.assistant.length, 1);
    assert.ok(f.paths.some((path) => path.includes('cursor=fixture_page_2')));
    assert.equal(evidence.durable.prompt.text, f.prompt.text);
    assert.ok(evidence.reads.some((read) => read.boundary === 'broker'));
  }
});

const negatives = {
  'unrelated acknowledgement with request ID but wrong action': (f) => {
    f.state.afterDeliver = () => { f.histories.ses_target.assistant[1].fixtureContent =
      acknowledgementText({ ...f.request, action: 'unrelated action' }); };
  },
  'preexisting exact acknowledgement': (f) => {
    f.histories.ses_target.assistant[0].fixtureContent = acknowledgementText(f.request);
  },
  'preexisting decision input': (f) => {
    f.histories.ses_target.user[0] = { ...f.prompt, type: 'user' };
  },
  'caller flags and counts cannot replace missing acknowledgement': (f) => {
    f.io.intentVerified = true;
    f.io.otherSessionDecisionInputs = 0;
    f.io.duplicateObservationMs = 30000;
    f.state.afterDeliver = () => { f.histories.ses_target.assistant.pop(); };
  },
  'wrong outcome': (f) => {
    f.state.afterDeliver = () => { f.histories.ses_target.assistant[1].fixtureContent =
      acknowledgementText({ ...f.request, resolution: 'approved' }); };
  },
  'public accepted decision swapped': (f) => {
    f.io.brokerGet = async () => ({ ...f.request, resolution: 'approved' });
  },
  'public decision changes after replay': (f) => {
    f.state.onReplay = () => { f.io.brokerGet = async () => ({ ...f.request, resolved_at: 'changed' }); };
  },
  'trimmed response intent': (f) => {
    f.state.afterDeliver = () => { f.histories.ses_target.assistant[1].fixtureContent =
      acknowledgementText({ ...f.request, response_text: f.request.response_text.trim() }); };
  },
  'missing actual content extraction': (f) => { f.io.assistantText = () => undefined; },
  'swapped session histories': (f) => {
    f.state.afterDeliver = () => {
      [f.histories.ses_target, f.histories.ses_other] =
        [f.histories.ses_other, f.histories.ses_target];
    };
  },
  'wrong-session acknowledgement': (f) => {
    f.state.afterDeliver = () => f.histories.ses_other.assistant.push({ id: 'wrong',
      type: 'assistant', fixtureContent: acknowledgementText(f.request) });
  },
  'wrong-session input': (f) => {
    f.state.afterDeliver = () => f.histories.ses_other.user.push({ ...f.prompt, type: 'user' });
  },
  'second matching decision input': (f) => {
    f.state.afterDeliver = () => f.histories.ses_target.user.push({ ...f.prompt,
      id: 'duplicate_input', type: 'user' });
  },
  'mutated history payload': (f) => {
    f.state.afterDeliver = () => { f.histories.ses_target.user[1].text += ' '; };
  },
  'mutated persisted stable ID': (f) => {
    f.state.onReplay = () => { f.durable.prompt.id = 'msg_changed'; };
  },
  'mutated persisted payload bytes': (f) => {
    f.state.onReplay = () => { f.durable.prompt.text += ' '; };
  },
  'mutated accepted resolution': (f) => {
    f.state.onReplay = () => { f.durable.request.resolution = 'approved'; };
  },
  'persisted prompt contains swapped outcome': (f) => {
    f.durable.prompt.text = JSON.stringify({ schema_version: 1, ...f.request, resolution: 'approved' });
  },
  'missing durability reader': (f) => { delete f.io.readDurable; },
  'missing durable proof': (f) => { f.state.readDurable = () => null; },
  'missing production deliver adapter': (f) => { delete f.io.deliver; },
  'late duplicate at full-window edge': (f) => {
    f.state.onTick = (now) => {
      if (now === 30000) f.histories.ses_target.assistant.push({ id: 'late_duplicate',
        type: 'assistant', fixtureContent: acknowledgementText(f.request) });
    };
  },
  'late wrong-session acknowledgement': (f) => {
    f.state.onTick = (now) => {
      if (now === 30000) f.histories.ses_other.assistant.push({ id: 'late_wrong',
        type: 'assistant', fixtureContent: acknowledgementText(f.request) });
    };
  },
  'observer gap masquerading as long observation': (f) => { f.clock.sleep = async () => {
    f.clock.now = () => 30000;
  }; },
  'short or stalled clock despite caller duration flag': (f) => {
    f.io.duplicateObservationMs = 30000;
    f.clock.sleep = async () => {};
  },
  'clock reversal': (f) => { f.clock.sleep = async () => { f.clock.now = () => -1; }; },
  'truncated history after replay': (f) => {
    f.state.onReplay = () => { f.histories.ses_target.assistant.shift(); };
  },
  'cursor cycle': (f) => { f.io.get = async () => ({ data: [], cursor: { next: 'loop' } }); },
  'pending inbox is not delivery': (f) => {
    const get = f.io.get;
    f.io.get = async (path) => path.includes('/ses_target/inbox') ?
      { data: [{ ...f.prompt, type: 'user' }] } : get(path);
  },
};

for (const [name, mutate] of Object.entries(negatives)) {
  test(`EVIDENCE-NEG: ${name}`, async () => {
    const f = fixture();
    mutate(f);
    await assert.rejects(f.run(), { code: 'ERR_ASSERTION' });
  });
}

test('EVIDENCE-02: real entry fails missing public adapters; no mock/live fallback', async () => {
  const f = fixture();
  await assert.rejects(collectContinuationEvidence({}, f.request, ['ses_target', 'ses_other']),
    /BLOCKED: missing get adapter/);
});

test('EVIDENCE-EDGE: early target read cannot hide duplicate arriving as collection crosses 30s', async () => {
  const f = fixture();
  const get = f.io.get;
  let injected = false;
  f.io.get = async (path) => {
    const body = await get(path);
    // At 28s the target assistant list was already read. Delay a later read
    // through the boundary, then add an acknowledgement the early list missed.
    if (!injected && f.clock.now() === 28000 && path.includes('/ses_other/inbox')) {
      injected = true;
      f.advance(2001);
      f.histories.ses_target.assistant.push({ id: 'crossing_duplicate', type: 'assistant',
        fixtureContent: acknowledgementText(f.request) });
    }
    return body;
  };
  await assert.rejects(f.run(), /exactly one decision acknowledgement/);
  assert.equal(injected, true);
});

test('TIMEOUT-COLLECTOR: accepted sequence composes with grounded raw history and replay evidence', async () => {
  const f = fixture();
  const normalize = () => {
    for (const session of Object.values(f.histories)) {
      for (const raw of session.assistant) {
        if (!raw.content) Object.assign(raw, { id: `msg_${raw.id}`, time: { created: 1 },
          agent: 'fixture', model: { id: 'fixture', providerID: 'fixture' },
          content: [{ type: 'text', text: raw.fixtureContent }] });
      }
    }
  };
  normalize();
  f.state.afterDeliver = normalize;
  const order = [];
  const io = { ...f.io };
  for (const name of ['armReceiptFault', 'invokeHost', 'observePending', 'observeWithheld',
    'assertHostCallUnsettled', 'observeActualHostTimeout', 'assertPendingAfterTimeout', 'assertSameHost',
    'resolveThroughPairedTelegram']) io[name] = async () => {
    assert.ok(f.paths.some((path) => path.includes('ses_other/inbox')), 'baseline first');
    order.push(name);
  };
  io.waitForAcknowledgement = f.io.deliver;
  const evidence = await collectWithClock(composeTimeoutIO(io), f.request,
    ['ses_target', 'ses_other'], f.clock);
  assert.ok(order.indexOf('observeActualHostTimeout') < order.indexOf('resolveThroughPairedTelegram'));
  assert.ok(evidence.samples.at(-1).started >= 30000);
  assert.equal(evidence.samples.at(-1).sessions.ses_target.assistant[1]
    .extracted.completionEstablished, false);
});

for (const kind of ['empty', 'reasoning', 'partial-text', 'split-text', 'error', 'retry']) {
  test(`ASSISTANT-COLLECTOR-NEG: ${kind} cannot prove the controlled acknowledgement`, async () => {
    const f = fixture();
    const convert = (raw) => Object.assign(raw, { id: `msg_${raw.id}`, time: { created: 1 },
      agent: 'fixture', model: { id: 'fixture', providerID: 'fixture' },
      content: [{ type: 'text', text: raw.fixtureContent }] });
    for (const session of Object.values(f.histories)) session.assistant.forEach(convert);
    f.io.assistantText = extractAssistant;
    f.state.afterDeliver = () => {
      const raw = convert(f.histories.ses_target.assistant[1]);
      const text = acknowledgementText(f.request);
      if (kind === 'empty') raw.content = [];
      if (kind === 'reasoning') raw.content = [{ type: 'reasoning', text }];
      if (kind === 'partial-text') raw.content = [{ type: 'text', text: text.slice(0, -5) }];
      if (kind === 'split-text') raw.content = [
        { type: 'text', text: text.slice(0, 20) }, { type: 'text', text: text.slice(20) }];
      if (kind === 'error') raw.error = { type: 'fixture', message: 'fixture failure' };
      if (kind === 'retry') raw.retry = { attempt: 1, at: 2,
        error: { type: 'fixture', message: 'fixture retry' } };
    };
    await assert.rejects(f.run(), { code: 'ERR_ASSERTION' });
  });
}

test('EVIDENCE-LIVE-BINDING: baseline precedes product-generated ID/time; immutable case still checked', async () => {
  for (const mutate of [false, true]) {
    const f = fixture();
    const { request_id, resolved_at, ...caseIntent } = f.request;
    const deliver = f.io.deliver;
    f.io.deliver = async () => {
      assert.ok(f.paths.some((path) => path.includes('ses_other/inbox')));
      await deliver();
      return { ...f.request, resolution: 'pending', action: mutate ? 'changed' : f.request.action };
    };
    const run = () => collectWithClock(f.io, caseIntent, ['ses_target', 'ses_other'], f.clock);
    if (mutate) await assert.rejects(run(), /created action differs from case/);
    else assert.ok((await run()).samples.at(-1).started >= 30000);
  }
});
