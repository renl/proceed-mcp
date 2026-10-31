// TEST ONLY orchestration/consumer contract. No live adapters or product imports.
import assert from 'node:assert/strict';
import http from 'node:http';
import { collectContinuationEvidence } from './continuation-evidence.mjs';
import { extractAssistant } from './assistant-extraction.mjs';

// Fixed URL and auth are supplied in memory by the isolated environment owner.
// Native HTTP avoids redirect/proxy routing and never discovers another origin.
export function authenticatedReader(origin, authorization) {
  assert.match(origin, /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/);
  assert.ok(Number(origin.split(':').at(-1)) <= 65535);
  assert.match(authorization, /^(Basic|Bearer) \S+$/);
  return (path, signal) => new Promise((done, fail) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//') && !path.includes('#'));
    const request = http.get(`${origin}${path}`, {
      headers: { authorization }, signal: signal ?
        AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), timeout: 10000,
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) response.destroy(new Error('evidence response budget'));
        else chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        try {
          assert.equal(response.statusCode, 200, 'authenticated public read failed; no redirects');
          done(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) { fail(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('public read 10s deadline')));
    request.on('error', fail);
  });
}

const projectRequest = (value, expected) => Object.fromEntries(
  Object.keys(expected).map((key) => [key, value?.[key]]));

// readCommitted is an implementation-selected read-only journal decoder, not
// a test endpoint. It must reject invalid/unflushed records. Fixture success
// cannot attest that decoder or OS flush; actual restart proof is also required.
export async function assertCommitBeforeEffect(readCommitted, expected, prompt) {
  const committed = await readCommitted();
  assert.deepEqual(projectRequest(committed?.request, expected), expected,
    'external effect before request/resolution commit');
  if (prompt) assert.deepEqual(committed.prompt, prompt, 'outbox must commit with decision');
  else assert.equal(committed.prompt, null, 'pending request must not contain decision outbox');
}

export async function assertPublicRestart(io, expected, prompt) {
  await io.restartBroker(); // same state, host must stay alive
  const path = `/v1/requests/${encodeURIComponent(expected.request_id)}?session_id=` +
    encodeURIComponent(expected.session_id);
  const recovered = await io.brokerGet(path);
  assert.deepEqual(projectRequest(recovered, expected), expected, 'public restart state changed');
  await assertCommitBeforeEffect(io.readCommitted, expected, prompt);
}

// These names are test consumer seams, not new production commands/events.
// The actual host's timeout extractor remains source/environment-dependent.
export async function deliverAfterActualTimeout(io, signal) {
  for (const name of ['armReceiptFault', 'invokeHost', 'observePending', 'observeWithheld',
    'assertHostCallUnsettled', 'observeActualHostTimeout', 'assertSameHost',
    'resolveThroughPairedTelegram', 'waitForAcknowledgement']) {
    assert.equal(typeof io[name], 'function', `RED: missing production ${name} adapter`);
  }
  await io.armReceiptFault(signal);
  const invocation = await io.invokeHost(signal);
  const created = await io.observePending(invocation, signal);
  await io.assertHostCallUnsettled(invocation, signal);
  await io.observeWithheld(invocation, signal);
  await io.assertHostCallUnsettled(invocation, signal);
  // Must read actual host tool-error evidence, never rpcPeer's synthetic timer.
  await io.observeActualHostTimeout(invocation, signal);
  await io.assertSameHost(signal);
  await io.resolveThroughPairedTelegram(signal);
  await io.waitForAcknowledgement(signal);
  return created;
}

export function composeTimeoutIO(io) {
  // Collector baselines BEFORE invoking deliver. Replay must preserve the host,
  // restart only broker/same state and use the already configured fault origin.
  return { ...io,
    assistantText: extractAssistant,
    deliver: (signal) => deliverAfterActualTimeout(io, signal),
  };
}

export function runTimeoutCase(io, request, sessions) {
  return collectContinuationEvidence(composeTimeoutIO(io), request, sessions);
}
