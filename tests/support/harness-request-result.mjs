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
import {
  productPickerInterval,
  productPickerObservation,
  productPickerDismissal,
} from './harness-navigation-observation.mjs';
import { readJournal } from '../../src/journal/framing.js';

const digest = (v) => createHash('sha256').update(v).digest('hex');

// Actual protected-broker/private-capture adapters. Does not create a request or
// connect an owner adapter. The real host alone starts the transparent stdio entry.
export function requestResultWireAdapter(
  h,
  {
    scenario,
    wait,
    now = () => performance.now(),
    readPrivate = (name) => readFile('/run/proceed/qualification-private/' + name),
  },
) {
  assert.equal(scenario, 'request-to-originating-result');
  assert.equal(h.shared, null, 'host owns the sole owner adapter');
  assert.equal(typeof wait, 'function');
  const presentations = new Map(),
    lastPending = new Map();
  const scope = { harness_id: 'qualification', owner_id: 'shared' };
  let transportPrefix = null;
  const post = async (path, body) => {
    const response = await h.http(path, h.operator.credential, { method: 'POST', body });
    assert.equal(response.status, 200);
    return response.json();
  };
  const lines = async (name) => {
    const bytes = await readPrivate(name);
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
    async beginScenario() {
      assert.equal(transportPrefix, null);
      transportPrefix = await lines('composition-wire.jsonl');
    },
    async captureArmed() {
      const marker = JSON.parse((await readPrivate('mcp-armed.json')).toString());
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
    readInteractionExchanges: async () => (await lines('composition-wire.jsonl')).length,
    async requestCapabilities() {
      const capture = decodeMcpCapture(await lines('mcp.jsonl'), 'composition-shared-owner');
      return capture.results.flatMap(({ message }) =>
        message.result?.structuredContent?.request_capability
          ? [message.result.structuredContent.request_capability]
          : [],
      );
    },
    async assertSingleDurableEffect(presentation, retained) {
      const bytes = await readFile(h.state + '/journal.log');
      const journal = readJournal(bytes);
      assert.equal(
        journal.validLength,
        bytes.length,
        'durable proof cannot accept an incomplete tail',
      );
      const mutations = journal.transactions
        .flatMap((t) => t.mutations)
        .filter(
          (m) => /^request\.resolve\./.test(m.op) && m.request_id === presentation.request_id,
        );
      assert.equal(mutations.length, 1, 'exactly one durable decision effect');
      assert.equal(mutations[0].decision_id, retained.decision_id);
      const accepted = (await lines('composition-wire.jsonl')).filter(
        (r) =>
          r.path === '/v1/harness/decisions' &&
          r.body?.accepted === true &&
          r.body.request_id === presentation.request_id,
      );
      assert.equal(accepted.length, 1, 'one actual accepted operator-wire effect');
      assert.equal(accepted[0].body.decision_id, retained.decision_id);
      assert.equal(accepted[0].cipher.name, 'PSK-AES256-GCM-SHA384');
      assert.equal(
        accepted[0].helpers.length,
        1,
        'accepted choice must traverse the genuine private helper',
      );
      const helper = accepted[0].helpers[0];
      assert.equal(helper.executable, '/usr/local/bin/node');
      assert.equal(helper.argv.length, 2);
      assert.ok(helper.argv[1].endsWith('/src/harness/operator-helper.js'));
      for (const fd of [helper.fd3, helper.fd4]) assert.match(fd, /^(socket|pipe):\[\d+\]$/);
    },
    async assertStaleAndLosingNonEffect(presentation, retained) {
      const response = await post('/v1/harness/decisions', {
        ...scope,
        session_id: presentation.session_id,
        request_id: presentation.request_id,
        presentation_id: presentation.presentation_id,
        choice: 'reject',
        response_text: null,
      });
      assert.equal(response.accepted, false);
      for (const field of ['request_id', 'decision_id', 'resolution', 'response_text'])
        assert.deepEqual(response[field], retained[field]);
      const message = h.fixture.messages.find(
        (m) =>
          m.text.includes(presentation.request_id) &&
          m.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data?.startsWith('a:')),
      );
      assert.ok(message, 'actual losing Telegram surface must exist');
      const before = h.fixture.calls.length;
      const batchesBefore = h.fixture.batches.length;
      h.fixture.choose(message, 'a');
      await wait('integrated-losing-channel', () =>
        h.fixture.batches
          .slice(batchesBefore)
          .flatMap((b) => b.updates)
          .some((u) => {
            const q = u.callback_query;
            return (
              q?.message.message_id === message.message_id &&
              q.data.startsWith('a:') &&
              h.fixture.calls
                .slice(before)
                .some(
                  (c) => c.method === 'answerCallbackQuery' && c.body.callback_query_id === q.id,
                )
            );
          }),
      );
      assert.deepEqual((await observe(presentation)).status, retained);
      await this.assertSingleDurableEffect(presentation, retained);
    },
    async assertOldCannotResolveNew(old, current) {
      const retained = (await observe(old)).status;
      await post('/v1/harness/decisions', {
        ...scope,
        session_id: old.session_id,
        request_id: old.request_id,
        presentation_id: old.presentation_id,
        choice: 'approve',
        response_text: null,
      });
      assert.deepEqual((await observe(old)).status, retained);
      assert.equal((await observe(current)).status.resolution, 'pending');
      await this.assertSingleDurableEffect(old, retained);
    },
    async directAttack(id, presentation) {
      const capabilities = await this.requestCapabilities();
      const credential =
        id === 'direct-broker-owner'
          ? h.owner
          : id === 'direct-broker-capability'
            ? capabilities[0]
            : h.owner;
      assert.ok(credential);
      const response = await h.http('/v1/harness/decisions', credential, {
        method: 'POST',
        body: {
          ...scope,
          session_id: presentation.session_id,
          request_id: presentation.request_id,
          presentation_id: presentation.presentation_id,
          choice: 'approve',
          response_text: null,
        },
        ...(id === 'direct-broker-basic'
          ? {
              headers: {
                authorization: 'Basic ' + Buffer.from('opencode:' + credential).toString('base64'),
              },
            }
          : {}),
      });
      assert.ok([401, 403].includes(response.status));
    },
    async verifyCompletion(result, status) {
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
      const wire = await lines('composition-wire.jsonl');
      assert.ok(Array.isArray(transportPrefix), 'transport phase boundary required');
      assert.deepEqual(wire.slice(0, transportPrefix.length), transportPrefix);
      const scenarioWire = wire.slice(transportPrefix.length);
      assert.equal(
        scenarioWire.filter((r) => r.path === '/v1/harness/pending' && r.helpers.length > 0).length,
        5,
        'only the five confirmed genuine navigation paths may query pending through a product helper',
      );
      assert.equal(
        scenarioWire.filter((r) => r.path === '/v1/harness/decisions' && r.body.accepted === true)
          .length,
        3,
      );
    },
  });
}

// Bound current cells only. No cumulative ANSI-stripped substring search, expected
// screen injection, profile import or private host dialog getter. Unsupported
// layouts fail closed. Only the established lossless 40-cell continuation
// policy is accepted. No guessed wrapping/scrolling or text normalization.
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
  const rows = frame.text.split('\n');
  const labels = ['Request ID:', 'Session label:', 'Action:', 'Context:', 'Expires:'];
  const title = 'Proceed approval request';
  assert.equal(rows.filter((r) => r.trim() === title).length, 1, 'ambiguous question');
  const start = rows.findIndex((r) => r.trim() === title);
  const left = rows[start].indexOf(title);
  let row = start + 2;
  const exact = (value) => {
    assert.ok(row < binding.geometry.height, 'question outside current geometry');
    assert.equal(rows[row]?.slice(0, left).trim(), '', 'foreign question column');
    assert.equal(rows[row]?.slice(left, left + value.length), value, 'changed current cells');
    assert.equal(rows[row]?.slice(left + value.length).trim(), '', 'ambiguous current cells');
    row++;
  };
  assert.equal(rows[start + 1]?.trim(), '', 'missing question separator');
  for (const [index, field] of [
    'request_id',
    'session_label',
    'action',
    'context',
    'expires_at',
  ].entries()) {
    assert.equal(typeof presentation[field], 'string');
    assert.equal(
      rows.filter((r) => r.trim() === labels[index]).length,
      1,
      'repeated/missing label',
    );
    exact(labels[index]);
    for (const source of presentation[field].split('\n')) {
      assert.match(source, /^[\x20-\x7e]+$/, 'unsupported question value');
      for (let i = 0; i < source.length; i += 40) {
        const line = source.slice(i, i + 40);
        // As with identity admission, edge spaces cannot be distinguished from
        // terminal padding. Refuse rather than normalize an ambiguous operand.
        assert.equal(line.trim(), line, 'ambiguous question padding');
        exact(line);
      }
    }
  }
  exact('');
  exact('Choose Reject, Respond or Approve.');
  exact('Dismissing this dialog sends no decision.');
  for (const control of ['Reject', 'Respond', 'Approve'])
    assert.equal(
      rows.filter((s, n) => n >= row && n < binding.geometry.height && s.trim() === control).length,
      1,
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

// Maintained actual composition driver. The inner entry supplies file/PTY IO and
// the existing public navigation bridge. Tests can replace IO, never the scenario
// or its current-cell/selection/result assertions. No resource starts on import.
export function compositionRequestResultDriver({
  wire,
  io,
  bridge,
  binding,
  executionBinding,
  runtime,
  wait,
  now,
  deadline,
  ready,
}) {
  const sessions = structuredClone(runtime.sessions);
  assert.equal(sessions.length, 2);
  let sequence = 0;
  const pendingInvocations = new Set();
  const clock = () => {
    assert.ok(now() < deadline);
    assert.deepEqual(io.readBinding(), binding);
    const live = io.readLive();
    assert.equal(live.live, true);
    assert.equal(live.run, binding.run);
    assert.equal(live.generation, binding.setup);
    assert.deepEqual(live.geometry, binding.geometry);
    assert.deepEqual(live.snapshot, sessions);
  };
  const action = async (kind, data = {}, invocation = false) => {
    clock();
    const request = {
      run: binding.run,
      generation: binding.setup,
      request: ++sequence,
      kind,
      ...data,
    };
    io.writeAction(request);
    let response;
    await wait('integrated-public-action', () => {
      clock();
      response = io.readAction(request.request);
      return response !== null && (invocation || response.state !== 'STARTED');
    });
    assert.equal(response.request, request.request);
    assert.equal(response.run, binding.run);
    assert.equal(response.generation, binding.setup);
    assert.equal(response.error, undefined, `public action ${kind} refused`);
    if (invocation) assert.equal(response.state, 'STARTED');
    else assert.equal(response.state, 'COMPLETE');
    return { request, response };
  };
  const frame = () => {
    clock();
    const raw = Buffer.from(io.readRaw());
    const cells = compositionSourceFrame(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    assert.equal(cells.supported, true);
    return { raw, cells };
  };
  const fresh = async (previousFrames, predicate) => {
    let state;
    await wait('integrated-current-cells', () => {
      state = frame();
      return state.cells.frames > previousFrames && predicate(state);
    });
    return state;
  };
  const sameInput = (state, bytes) => {
    clock();
    const current = frame();
    assert.deepEqual(current.raw, state.raw);
    clock();
    assert.deepEqual(io.readRaw(), state.raw);
    io.send(bytes);
  };
  const driver = {
    ...wire,
    async readPublicSessions() {
      clock();
      return structuredClone(sessions);
    },
    invokeRegistered(sessionID) {
      assert.ok(sessions.some((s) => s.id === sessionID));
      const task = (async () => {
        const { request } = await action('invoke', { sessionID }, true);
        await wait('integrated-original-result', () => {
          clock();
          const next = io.readAction(request.request);
          assert.equal(next?.error, undefined, 'registered invocation refused');
          return next?.state === 'COMPLETE';
        });
      })();
      pendingInvocations.add(task);
      task.finally(() => pendingInvocations.delete(task)).catch(() => {});
      return task;
    },
    async abortInvocations() {
      if (pendingInvocations.size) await action('abort');
    },
    async forSession(session) {
      assert.ok(sessions.some((s) => JSON.stringify(s) === JSON.stringify(session)));
      let question,
        last,
        navigation,
        replacement,
        questionProof,
        currentPresentation,
        replacementExchanges;
      const checkQuestion = (presentation) => {
        currentPresentation = presentation;
        clock();
        question ??= currentQuestionAdapter({
          binding,
          readBinding: io.readBinding,
          readLive: io.readLive,
          readRaw: io.readRaw,
          now,
          deadline,
        });
        questionProof = question.check(presentation);
        return frame();
      };
      const choices = (presentation) => {
        const state = checkQuestion(presentation);
        const lines = state.cells.text.split('\n');
        const rows = ['Reject', 'Respond', 'Approve'].map((label) => {
          const indices = lines.flatMap((line, row) => (line.trim() === label ? [row] : []));
          assert.equal(indices.length, 1);
          const row = indices[0],
            col = lines[row].indexOf(label);
          const cells = state.cells.styles[row].slice(col, col + label.length);
          assert.equal(cells.length, label.length);
          assert.ok(cells.every((s) => JSON.stringify(s) === JSON.stringify(cells[0])));
          return { label, row, col, style: cells[0] };
        });
        return {
          ...state,
          supported: true,
          binding,
          snapshot: ['reject', 'respond', 'approve'],
          rows,
          frames: state.cells.frames,
          screen: state.cells.generation,
          bytes: state.raw.length,
          sha256: digest(state.raw),
          previousSha256: null,
        };
      };
      const navigate = async (selected, presentation) => {
        assert.deepEqual(selected, session);
        const base = frame().cells.frames;
        navigation = await bridge({
          executionBinding,
          runtime,
          run: binding.run,
          setup: binding.setup,
          intendedSession: session,
          readExecutionBinding: io.readExecutionBinding,
          readObservation: io.readObservation,
          writeObservation: io.writeObservation,
          readRaw: io.readRaw,
          now,
          deadline,
          pause: io.pause,
          allowQuestion: true,
          openPicker: () => io.send('\x07'),
          moveDown: () => io.send('\x1b[B'),
          moveUp: () => io.send('\x1b[A'),
          pickerEnter: () => io.send('\r'),
          openQuestion: () => io.send('\r'),
        });
        await ready(() => navigation.openPicker());
        await fresh(base, ({ cells }) => cells.text.includes('Select the Proceed session'));
        const initial = await navigation.initial();
        await navigation.moveDown();
        await fresh(initial.frames, () => true);
        let moved = await navigation.moved();
        if (sessions[0].id === session.id) {
          await navigation.moveBack();
          await fresh(moved.frames, () => true);
          moved = await navigation.returned();
        }
        await navigation.pickerEnter();
        await fresh(moved.frames, ({ cells }) => cells.text.includes('Open Proceed question?'));
        const identity = await navigation.identity();
        await navigation.openQuestion();
        await fresh(
          identity.frames,
          ({ cells }) =>
            cells.text.includes(presentation.request_id) &&
            cells.text.split('\n').some((s) => s.trim() === 'Approve'),
        );
        checkQuestion(presentation);
        last = frame();
      };
      return {
        observe: wire.observe,
        waitRetainedOutcome: wire.waitRetainedOutcome,
        stdin: {
          write(bytes) {
            assert.equal(bytes, '\x1b', 'unfenced decision input is forbidden');
            if (replacement) sameInput(replacement, bytes);
            else {
              question.input(currentPresentation, () => sameInput(last, bytes), bytes);
              question.invalidate();
            }
          },
        },
        navigateCurrentSession: navigate,
        async waitRendered() {
          assert.ok(questionProof);
        },
        async waitCurrentProductDialog(p) {
          last = checkQuestion(p);
        },
        async ordinaryAttacks(p, afterEach) {
          for (const id of ['native-form-reply', 'synthetic-record', 'public-rpc']) {
            await action(id, { sessionID: session.id, presentation: p });
            await afterEach(id);
          }
          for (const id of [
            'direct-broker-basic',
            'direct-broker-owner',
            'direct-broker-capability',
          ]) {
            await wire.directAttack(id, p);
            await afterEach(id);
          }
        },
        async programmaticCommandAttack(p) {
          last = checkQuestion(p);
          replacementExchanges = await wire.readInteractionExchanges();
          question.invalidate();
          navigation.invalidate();
          await action('programmatic-command', { presentation: p });
        },
        async waitReplacementNavigation() {
          replacement = await fresh(
            last.cells.frames,
            ({ raw }) => productPickerObservation(raw, binding, sessions).supported,
          );
          assert.equal(replacement.cells.text.includes('Proceed approval request'), false);
          assert.equal(
            await wire.readInteractionExchanges(),
            replacementExchanges,
            'replacement cannot query pending or decide without genuine confirmation',
          );
        },
        async waitDismissed() {
          const baseline = replacement ?? last;
          const previous = {
            ...questionProof,
            supported: true,
            binding,
            frames: baseline.cells.frames,
            screen: baseline.cells.generation,
            bytes: baseline.raw.length,
            sha256: digest(baseline.raw),
          };
          await fresh(
            baseline.cells.frames,
            ({ raw }) => productPickerDismissal(raw, binding, previous, io.hostFrame()).supported,
          );
        },
        async chooseCurrentQuestion(p, choice) {
          const other = sessions.find((s) => s.id !== session.id);
          const switched = await action('switch-foreground', {
            sessionID: other.id,
            presentation: p,
          });
          assert.equal(switched.response.foreground, other.id);
          let selected = 0;
          let state = choices(p);
          assert.ok(state.rows[0].style.bold && state.rows.slice(1).every((r) => !r.style.bold));
          const target = ['reject', 'respond', 'approve'].indexOf(choice);
          assert.ok(target >= 0);
          // Even default Reject needs a causal transfer, not a `current` option.
          for (const next of target === 0 ? [1, 0] : target === 1 ? [1] : [1, 2]) {
            const before = state;
            sameInput(before, next > selected ? '\x1b[B' : '\x1b[A');
            await fresh(before.frames, () => true);
            state = choices(p);
            state.previousSha256 = digest(state.raw.subarray(0, before.bytes));
            assert.equal(
              productPickerInterval(before, state, selected, next).emittedTransfer,
              true,
            );
            selected = next;
          }
          question.input(p, () => sameInput(state, '\r'), '\r');
          question.invalidate();
          last = state;
        },
        async waitResponsePrompt(p) {
          last = await fresh(
            last.cells.frames,
            ({ cells }) =>
              cells.text.includes('Proceed response for ' + p.request_id) &&
              cells.text.includes('never an approval'),
          );
        },
        async submitCurrentResponse(p, text) {
          assert.equal(text, 'approved');
          assert.ok(last.cells.text.includes('Proceed response for ' + p.request_id));
          assert.ok(Date.parse(p.expires_at) > Date.now());
          sameInput(last, text + '\r');
        },
      };
    },
  };
  return driver;
}

export async function runCompositionRequestResult(options) {
  return exerciseRequestToOriginatingResult(compositionRequestResultDriver(options));
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
        await exerciseRenderedProduct(rendered, presentations[n], 'replace', sessions[n]);
        rendered = await driver.forSession(sessions[n]);
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
    await driver.assertOldCannotResolveNew(presentations[0], responsePresentation);
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
