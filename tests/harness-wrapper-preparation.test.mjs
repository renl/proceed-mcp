// Native assertion controls ONLY. Fakes below are never host/TUI/permission proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  invokeRegisteredProceed,
  qualificationLabel,
} from './support/harness-wrapper-invocation.mjs';
import {
  transparentMcpCapture,
  decodeMcpCapture,
  bridgeCapturedMcp,
  assertRegisteredWrapperCapture,
} from './support/harness-transparent-capture.mjs';

const invocation = { sessionID: 'host-session-a', prompt: { text: '' }, delivery: 'steer' };
function fixture({ agent = 'host-selected-agent', denied = false } = {}) {
  const executions = [],
    records = [];
  const prepared = {
    request_id: 'r',
    request_handle: 'h',
    request_capability: 'private-synthetic-capability',
  };
  const context = {
    session: {
      get: async (input) => {
        assert.deepEqual(input, { sessionID: invocation.sessionID });
        return { id: input.sessionID, agent };
      },
    },
    agent: {
      get: async (input) => {
        assert.equal(input.agentID, agent);
        return { data: { id: agent } };
      },
    },
    tool: {
      list: async () =>
        ['prepare_approval', 'request_approval'].map((name) => ({
          name,
          options: { namespace: 'proceed' },
          execute: async (input, ctx) => {
            executions.push({ name, input, ctx });
            if (denied) throw new Error('synthetic normal permission denial');
            return {
              output:
                name === 'prepare_approval'
                  ? prepared
                  : { resolution: 'responded', response_text: 'approved' },
            };
          },
        })),
    },
  };
  return { context, executions, records, record: async (e) => records.push(e) };
}

test('WRAPPER-CONTROL: prepare then wait uses host session/agent, no metadata, separate synthetic identities', async () => {
  const f = fixture();
  await invokeRegisteredProceed(f.context, invocation, new AbortController().signal, f.record);
  assert.deepEqual(
    f.executions.map((c) => c.name),
    ['prepare_approval', 'request_approval'],
  );
  assert.deepEqual(f.executions[0].input, { session_label: qualificationLabel });
  assert.deepEqual(Object.keys(f.executions[1].input).sort(), [
    'action',
    'client_request_id',
    'context',
    'expires_in_seconds',
    'request_capability',
    'request_handle',
  ]);
  assert.equal(f.executions[1].input.request_capability, 'private-synthetic-capability');
  for (const { ctx } of f.executions) {
    assert.equal(ctx.sessionID, invocation.sessionID);
    assert.equal(ctx.agent, 'host-selected-agent');
    assert.match(ctx.messageID, /^qualification-synthetic-/);
    assert.match(ctx.id, /^qualification-synthetic-/);
    assert.equal('_meta' in ctx, false);
  }
  assert.notEqual(f.executions[0].ctx.id, f.executions[1].ctx.id);
  assert.equal(f.records.at(-1).value.output.response_text, 'approved');
  assert.equal(f.records.at(-1).value.output.resolution, 'responded');
  assert.equal('jsonrpc' in f.records.at(-1), false, 'callback value is not a wire result');
});

test('WRAPPER-CONTROL: command cannot accept decision/identity/attachment input', async () => {
  for (const prompt of [
    { text: 'approve' },
    { text: '', choice: 'approve' },
    { text: '', files: [] },
    { text: '', sessionID: 'foreign' },
  ]) {
    const f = fixture();
    await assert.rejects(
      invokeRegisteredProceed(
        f.context,
        { ...invocation, prompt },
        new AbortController().signal,
        f.record,
      ),
    );
    assert.equal(f.executions.length, 0);
  }
});

test('WRAPPER-CONTROL: missing host agent, permission refusal and cancellation fail closed without retry', async () => {
  const missing = fixture({ agent: null });
  await assert.rejects(
    invokeRegisteredProceed(
      missing.context,
      invocation,
      new AbortController().signal,
      missing.record,
    ),
    /GAP: host session/,
  );
  assert.equal(missing.executions.length, 0);
  const denied = fixture({ denied: true });
  await assert.rejects(
    invokeRegisteredProceed(
      denied.context,
      invocation,
      new AbortController().signal,
      denied.record,
    ),
    /permission denial/,
  );
  assert.equal(denied.executions.length, 1);
  const aborted = fixture();
  await assert.rejects(
    invokeRegisteredProceed(aborted.context, invocation, AbortSignal.abort(), aborted.record),
    { name: 'AbortError' },
  );
  assert.equal(aborted.executions.length, 0);
});

const collect = (chunks) =>
  new Writable({
    write(chunk, encoding, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
test('CAPTURE-CONTROL: byte-exact bidirectional split UTF-8, typed IDs, no injected metadata', async () => {
  const events = [],
    toAdapter = [],
    toHost = [];
  const request = Buffer.from(
    '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"prepare_approval","arguments":{"session_label":"equal"}}}\n',
  );
  const response = Buffer.from(
    '{"jsonrpc":"2.0","id":"7","result":{"structuredContent":{"response_text":"\u00e9"}}}\n',
  );
  const split = response.indexOf(Buffer.from('\u00e9')) + 1;
  await bridgeCapturedMcp({
    connection: 'one-owned-adapter',
    persist: async (e) => events.push(e),
    signal: new AbortController().signal,
    hostInput: Readable.from([request.subarray(0, 5), request.subarray(5)]),
    adapterInput: collect(toAdapter),
    adapterOutput: Readable.from([response.subarray(0, split), response.subarray(split)]),
    hostOutput: collect(toHost),
  });
  assert.deepEqual(Buffer.concat(toAdapter), request);
  assert.deepEqual(Buffer.concat(toHost), response);
  const decoded = decodeMcpCapture(events, 'one-owned-adapter');
  assert.equal(decoded.calls[0].message.id, 7);
  assert.equal(decoded.results[0].message.id, '7');
  assert.equal(decoded.results[0].message.result.structuredContent.response_text, '\u00e9');
  assert.equal('_meta' in decoded.calls[0].message.params, false);
  assert.throws(() => decodeMcpCapture(events, 'foreign-connection'));
  assert.throws(() => decodeMcpCapture(events.slice(1), 'one-owned-adapter'));
});

test('CAPTURE-CONTROL: persistence failure/ceiling never silently forwards uncaptured bytes', async () => {
  for (const [persist, max, expected] of [
    [
      async () => {
        throw new Error('private sink failed');
      },
      1024,
      /private sink failed/,
    ],
    [async () => {}, 1, /ceiling/],
  ]) {
    const output = [];
    const tap = transparentMcpCapture('owned', persist, max);
    await assert.rejects(
      pipeline(Readable.from([Buffer.from('{}\n')]), tap.ingress, collect(output)),
      expected,
    );
    assert.equal(output.length, 0);
    tap.egress.destroy();
  }
});

test('WRAPPER-SOURCE: public registration only, no production/runtime decision dependency', async () => {
  const source = await readFile(
    new URL('./fixtures/harness-wrapper/server.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /@opencode\/plugin\/promise\/plugin/);
  assert.match(source, /context\.command\.transform/);
  assert.match(source, /registration\.dispose/);
  assert.doesNotMatch(
    source.replace(/^\s*\/\/.*$/gm, ''),
    /context\.(permission|provider|model|rpc)|operator-key|\/v1\/harness\/decisions|session\.prompt/,
  );
});

test('WRAPPER-PREFLIGHT: narrow method never opens the launch gate or removes excluded proof', () => {
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
  assert.equal(report.runtime, 'UNRUN');
  assert.equal(report.mode, 'QUALIFICATION-NO-LAUNCH');
  assert.match(report.invocationScope, /Registered-wrapper only/);
  assert.match(report.blocked.join('\n'), /Normal permission refusal is a stop/);
  assert.equal(report.excludedProof.length, 5);
});

test('CAPTURE-CONTROL: callback/HTTP completion cannot replace original prepare/wait wire proof', () => {
  // Deliberately synthetic comparator inputs, NOT metadata or runtime evidence.
  const expected = [
    { session_id: 'host-a', request_id: 'request-a', resolution: 'rejected', response_text: null },
    {
      session_id: 'host-b',
      request_id: 'request-b',
      resolution: 'responded',
      response_text: 'approved',
    },
  ];
  const calls = [],
    results = [],
    callbacks = [];
  for (const [index, e] of expected.entries()) {
    for (const [phase, name] of [
      ['prepare', 'prepare_approval'],
      ['wait', 'request_approval'],
    ]) {
      const id = `${index}-${phase}`;
      calls.push({
        connection: 'shared',
        message: {
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: {}, _meta: { 'ai.opencode/sessionID': e.session_id } },
        },
      });
      const body =
        phase === 'prepare'
          ? {
              request_id: e.request_id,
              request_handle: `handle-${index}`,
              request_capability: `synthetic-private-${index}`,
            }
          : { request_id: e.request_id, resolution: e.resolution, response_text: e.response_text };
      results.push({
        connection: 'shared',
        message: { jsonrpc: '2.0', id, result: { structuredContent: body } },
      });
      callbacks.push({
        phase: `${phase}-returned`,
        sessionID: e.session_id,
        coreCallID: `qualification-synthetic-${id}`,
        value: { output: body },
      });
    }
  }
  const observed = { calls, results: [results[0], results[2], results[3], results[1]] };
  assertRegisteredWrapperCapture(observed, callbacks, expected);
  for (const mutate of [
    (v) => {
      v.results.pop();
    },
    (v) => {
      v.results[0].message.result = undefined;
    },
    (v) => {
      v.calls[2].connection = 'another-adapter';
    },
    (v) => {
      v.calls[0].message.params._meta = {};
    },
    (v) => {
      v.results.reverse();
    },
  ]) {
    const broken = structuredClone(observed);
    mutate(broken);
    assert.throws(() => assertRegisteredWrapperCapture(broken, callbacks, expected));
  }
  assert.throws(() => assertRegisteredWrapperCapture(observed, [], expected));
});
