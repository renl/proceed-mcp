// Native pure controls only. No TUI, broker, credentials or model is launched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { ordinaryApiAttacks } from './support/harness-host-api-attacks.mjs';
import {
  exerciseRenderedProduct,
  ordinaryAttackCases,
} from './support/harness-rendered-product.mjs';
import {
  assertPluginInventory,
  assertServiceInventory,
  builtinOrigins,
} from './support/harness-plugin-inventory.mjs';
import {
  assertTransportPlan,
  transportExpectations,
} from './support/harness-runtime-transport.mjs';
import {
  assertAttackNonEffect,
  assertBoundOutcome,
  assertRetainedLoser,
  assertOriginalCallRouting,
  assertNoAuthorityLeak,
  assertUnauthenticatedListener,
} from './support/harness-qualification-assertions.mjs';

const plugin = '/run/proceed/state/service-config/plugins/proceed-qualification';
const entry = `${plugin}/tui.ts`;
const loader = (stage, target = plugin, origin = entry) =>
  `level=DEBUG message="plugin operation started" component=plugin stage=${stage} target=${target} entrypoint=${origin} role=cli`;
const completed = (n = builtinOrigins.length + 1) =>
  `level=INFO message="plugin reconciliation completed" component=plugin plugins=${n} role=cli`;

test('QUAL-PREFLIGHT is bounded NO-LAUNCH and cannot claim runtime readiness', () => {
  const result = spawnSync(
    process.execPath,
    ['tests/run-harness-host.mjs', '--qualification-preflight'],
    {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'QUALIFICATION-NO-LAUNCH');
  assert.equal(report.runtime, 'UNRUN');
  assert.ok(report.blocked.length > 0);
});

test('QUAL-INVENTORY: source built-ins plus observed staged external entry, not count-only', () => {
  const options = { plugin, entry, complete: true };
  const evidence = assertPluginInventory([loader('read'), completed()], options);
  assert.equal(evidence.builtinOrigins.length, 14);
  assert.equal(evidence.externalOrigins[0].entrypoint, entry);
  const builtin = {
    id: 'bundled',
    source: { type: 'builtin' },
    features: { server: true },
    state: { status: 'active' },
  };
  const staged = {
    id: 'qualification',
    source: { type: 'local', path: plugin },
    features: { tui: true },
    state: { status: 'active' },
  };
  assertServiceInventory([builtin, staged], { plugin });
  for (const extra of [
    { ...staged, source: { type: 'local', path: '/user-plugin' } },
    { ...staged, source: { type: 'package', target: 'user-plugin' } },
    { ...staged, features: { tui: true, server: true } },
  ])
    assert.throws(() => assertServiceInventory([builtin, extra], { plugin }));
  for (const lines of [
    [completed()],
    [loader('read'), completed(16)],
    [loader('read', '/extra'), completed()],
    [loader('read', plugin, '/extra/tui.ts'), completed()],
    [loader('prepare'), completed()],
    [loader('read'), completed(), loader('load', 'user-plugin')],
  ])
    assert.throws(() => assertPluginInventory(lines, options));
  assert.throws(() =>
    assertPluginInventory([loader('read'), completed()], { ...options, complete: false }),
  );
});

test('QUAL-TRANSPORT-PLAN: actual runtime controls cannot omit role/admission cases or escape private files', () => {
  const plan = {
    schema_version: 1,
    cases: Object.keys(transportExpectations).map((id) => ({
      id,
      port: 12345,
      key_file: `/run/proceed/qualification-private/${id}/key`,
      lock_file: `/run/proceed/qualification-private/${id}/broker.lock`,
      body: {
        harness_id: 'qualification',
        owner_id: id === 'foreign' ? 'foreign' : 'shared',
        session_id: 'transport-session',
      },
    })),
  };
  assertTransportPlan(plan);
  for (const mutate of [
    (p) => p.cases.pop(),
    (p) => {
      p.cases[0].key_file = '/payload/operator.key';
    },
    (p) => {
      p.cases[0].lock_file = '/run/proceed/qualification-private/../broker.lock';
    },
    (p) => {
      p.cases[0].body.human = true;
    },
    (p) => {
      p.cases[0].id = 'unknown';
    },
  ]) {
    const changed = structuredClone(plan);
    mutate(changed);
    assert.throws(() => assertTransportPlan(changed));
  }
});

const presentation = {
  request_id: 'request-a',
  presentation_id: 'presentation-a',
  session_id: 'session-a',
};
const pending = {
  presentation,
  status: {
    request_id: 'request-a',
    decision_id: null,
    resolution: 'pending',
    response_text: null,
  },
};
const winner = {
  schema_version: 1,
  request_id: 'request-a',
  decision_id: 'decision-a',
  accepted: true,
  resolution: 'responded',
  response_text: 'approved',
};

// Scripted frames exercise orchestration only. Never an actual-host operand.
function syntheticNavigation(writes, session) {
  const picker = { frame: 'Select the Proceed session\n\u2503    Session 1 preview', token: 1 };
  const confirmation = {
    frame: [
      'Open Proceed question?',
      'Session 1',
      'Navigation only - no decision',
      'Title:',
      session.title,
      'Session ID:',
      session.id,
      '',
      'Open question   Cancel',
    ].join('\n'),
    token: 2,
    geometry: { width: 100, height: 50, resizeSequence: 0 },
  };
  let current;
  return {
    waitHighlightedSession: async () => {
      assert.deepEqual(writes, ['\x07']);
      return (current = picker);
    },
    waitIdentityConfirmation: async () => {
      assert.deepEqual(writes, ['\x07', '\r']);
      return (current = confirmation);
    },
    currentNavigationFrame: async () => current,
  };
}

test('QUAL-RENDERED driver control cannot substitute missing attacks, callback results or approval-like Respond', async () => {
  // Deliberately synthetic I/O to validate the test, not rendered/product proof.
  const question = {
    ...presentation,
    session_label: 'equal labels',
    action: 'Inert action',
    context: 'Inert context',
    expires_at: 'synthetic deadline',
  };
  const writes = [];
  const session = { id: question.session_id, title: 'equal host titles' };
  let terminal = false;
  const driver = {
    stdin: { write: (bytes) => writes.push(bytes) },
    ...syntheticNavigation(writes, session),
    observe: async () => ({
      presentation: question,
      status: terminal ? { ...pending.status, ...winner } : pending.status,
    }),
    waitRendered: async (fields) => {
      assert.ok(fields.includes(question.request_id));
      assert.ok(fields.includes(question.expires_at));
    },
    ordinaryAttacks: async (_presentation, afterEach) => {
      for (const id of ordinaryAttackCases) await afterEach(id);
    },
    waitCurrentProductDialog: async () => {},
    waitResponsePrompt: async () => {},
    waitRetainedOutcome: async () => {
      terminal = true;
      const { accepted, ...retained } = winner;
      return retained;
    },
  };
  await exerciseRenderedProduct(driver, question, 'respond', session);
  assert.deepEqual(writes, ['\x07', '\r', '\r', 'Respond\r', 'approved\r']);
  writes.length = 0;
  terminal = false;
  await assert.rejects(
    exerciseRenderedProduct(
      { ...driver, ordinaryAttacks: async () => [] },
      question,
      'respond',
      session,
    ),
    /missing real ordinary-API attack/,
  );
  writes.length = 0;
  await assert.rejects(
    exerciseRenderedProduct(
      { ...driver, waitRetainedOutcome: async () => ({ ...winner, resolution: 'approved' }) },
      question,
      'respond',
      session,
    ),
  );
});

test('QUAL-PICKER: missing/currently lost UI stops keys before a choice, never reopens it', async () => {
  const question = {
    ...presentation,
    session_label: 'equal request labels',
    action: 'Action',
    context: 'Context',
    expires_at: 'synthetic deadline',
  };
  const session = { id: question.session_id, title: 'equal host titles' };
  for (const stage of ['picker', 'question', 'attack']) {
    const writes = [];
    let attacked = false;
    const driver = {
      stdin: { write: (bytes) => writes.push(bytes) },
      observe: async () => ({ ...pending, presentation: question }),
      ...syntheticNavigation(writes, session),
      waitRendered: async (fields) => {
        assert.deepEqual(fields, [
          question.request_id,
          question.session_label,
          question.action,
          question.context,
          question.expires_at,
          'Approve',
          'Reject',
          'Respond',
        ]);
        if (stage === 'question') throw new Error('complete question not currently visible');
      },
      waitCurrentProductDialog: async () => {
        if (attacked) throw new Error('dialog was dismissed by ordinary API');
      },
      ordinaryAttacks: async (_p, afterEach) => {
        attacked = true;
        await afterEach(ordinaryAttackCases[0]);
      },
    };
    if (stage === 'picker')
      driver.waitHighlightedSession = async () => {
        throw new Error('live highlight not established');
      };
    await assert.rejects(exerciseRenderedProduct(driver, question, 'reject', session));
    assert.deepEqual(writes, stage === 'picker' ? ['\x07'] : ['\x07', '\r', '\r']);
  }
  await assert.rejects(
    exerciseRenderedProduct({}, question, 'approve', { ...session, id: 'foreign-session' }),
    /picker must target the bound host ID/,
  );
});

test('QUAL-API-HELPER unit control requires admitted form and non-resuming synthetic record', async () => {
  const calls = [];
  const client = {
    session: {
      form: {
        create: async (input) => {
          calls.push(['create', input]);
          return { id: 'native-form' };
        },
        reply: async (input) => {
          calls.push(['reply', input]);
        },
      },
      synthetic: async (input) => {
        calls.push(['synthetic', input]);
        return { id: 'synthetic-record' };
      },
    },
  };
  const result = await ordinaryApiAttacks({
    client,
    sessionID: presentation.session_id,
    presentation,
    observe: async () => structuredClone(pending),
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, ['native-form-reply', 'synthetic-record']);
  assert.equal(calls[1][1].formID, 'native-form');
  assert.equal(calls[2][1].resume, false);
  const leaking = structuredClone(pending);
  leaking.status.resolution = 'approved';
  let observed = 0;
  await assert.rejects(
    ordinaryApiAttacks({
      client,
      sessionID: presentation.session_id,
      presentation,
      observe: async () => (++observed === 1 ? pending : leaking),
      signal: new AbortController().signal,
    }),
    /ordinary API traffic/,
  );
});

test('QUAL-AUTHORITY: native reply/RPC/command claims cannot alter the authoritative binding', () => {
  assertAttackNonEffect(pending, structuredClone(pending));
  for (const mutate of [
    (p) => {
      p.status.resolution = 'approved';
    },
    (p) => {
      p.status.decision_id = 'new';
    },
    (p) => {
      p.presentation.request_id = 'foreign';
    },
    (p) => {
      p.presentation = null;
    },
  ]) {
    const changed = structuredClone(pending);
    mutate(changed);
    assert.throws(() => assertAttackNonEffect(pending, changed));
  }
});

test('QUAL-OUTCOMES: Respond is instructions, first winner unchanged, late/foreign outcomes rejected', () => {
  assertBoundOutcome(presentation, winner, 'respond', 'approved');
  assertRetainedLoser(winner, { ...winner, accepted: false });
  for (const [choice, resolution] of [
    ['approve', 'approved'],
    ['reject', 'rejected'],
  ])
    assertBoundOutcome(presentation, { ...winner, resolution, response_text: null }, choice);
  for (const changed of [
    { ...winner, resolution: 'approved' },
    { ...winner, request_id: 'foreign' },
    { ...winner, accepted: false },
  ])
    assert.throws(() => assertBoundOutcome(presentation, changed, 'respond', 'approved'));
  assert.throws(() =>
    assertRetainedLoser(winner, { ...winner, accepted: false, resolution: 'approved' }),
  );
});

test('QUAL-ORIGINAL-CALL: both real ingress metadata values and original result IDs are required', () => {
  const expected = ['a', 'b'].map((s, i) => ({
    session_id: `session-${s}`,
    request_id: `request-${s}`,
    prepare_id: i * 2 + 1,
    wait_id: i * 2 + 2,
    resolution: i ? 'responded' : 'rejected',
    response_text: i ? 'approved' : null,
  }));
  const calls = expected.flatMap((e) =>
    [
      [e.prepare_id, 'prepare_approval'],
      [e.wait_id, 'request_approval'],
    ].map(([id, name]) => ({
      connection: 'shared',
      message: {
        id,
        method: 'tools/call',
        params: { name, arguments: {}, _meta: { 'ai.opencode/sessionID': e.session_id } },
      },
    })),
  );
  const results = expected.toReversed().map((e) => ({
    connection: 'shared',
    message: {
      id: e.wait_id,
      result: {
        structuredContent: {
          request_id: e.request_id,
          resolution: e.resolution,
          response_text: e.response_text,
        },
      },
    },
  }));
  assertOriginalCallRouting(calls, results, expected);
  for (const mutate of [
    (c) => {
      delete c[0].message.params._meta;
    },
    (c) => {
      c[3].message.params._meta['ai.opencode/sessionID'] = 'session-a';
    },
    (c) => {
      c[2].connection = 'second-adapter';
    },
    (c) => {
      c[0].message.params.arguments.session_id = 'session-a';
    },
  ]) {
    const changed = structuredClone(calls);
    mutate(changed);
    assert.throws(() => assertOriginalCallRouting(changed, results, expected));
  }
  const redirected = structuredClone(results);
  redirected[0].message.id = expected[0].wait_id;
  assert.throws(() => assertOriginalCallRouting(calls, redirected, expected));
});

test('QUAL-PRIVACY: complete pre-redaction captures and real failed-listener attempts required', () => {
  const captures = Object.fromEntries(
    ['tui', 'telegram', 'journal', 'diagnostics', 'mcp', 'evidence'].map((s) => [
      s,
      'synthetic safe bytes',
    ]),
  );
  const secrets = ['hop_synthetic-marker', 'psk-marker', 'capability-marker'];
  const authority = {
    operatorAndTransport: secrets.slice(0, 2),
    requestCapabilities: secrets.slice(2),
  };
  assertNoAuthorityLeak(captures, authority);
  for (const surface of Object.keys(captures))
    for (const secret of secrets)
      if (!(surface === 'mcp' && secret === secrets[2]))
        assert.throws(() => assertNoAuthorityLeak({ ...captures, [surface]: secret }, authority));
  assertNoAuthorityLeak({ ...captures, mcp: secrets[2] }, authority);
  const missing = { ...captures };
  delete missing.journal;
  assert.throws(() => assertNoAuthorityLeak(missing, authority));
  const hello = Buffer.from([0x16, 0x03, 0x03, 0x00]);
  assertUnauthenticatedListener(hello, secrets);
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from('Authorization: Bearer x'),
    Buffer.from(secrets[0]),
  ])
    assert.throws(() => assertUnauthenticatedListener(bytes, secrets));
});
