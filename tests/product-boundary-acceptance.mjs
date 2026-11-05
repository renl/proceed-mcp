// TEST ONLY finite product-boundary entry. No credentials or live host discovery.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { publicHTTP, hostAdapters, exactTool, assertTimeout, poll, BoundaryError } from './support/public-host.mjs';
import { runTimeoutCase, assertPublicRestart } from './support/spike-runner.mjs';
import { acknowledgementText } from './support/continuation-evidence.mjs';
import { bounded } from './support/managed-spike.mjs';
import { extractAssistant } from './support/assistant-extraction.mjs';

const cli = resolve('bin/proceed-mcp.js');

// Default command really invokes the product; exit 2 is not readiness.
// Missing state means no command may start a service or read global config.
export async function productPrerequisites() {
  await mkdir('tests/.artifacts', { recursive: true });
  const directory = await mkdtemp(resolve('tests/.artifacts/product-entry-'));
  const results = [];
  try {
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
      .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    for (const args of [['serve'], ['status', '--json'], ['mcp', '--origin', 'spike']]) {
      const result = spawnSync(process.execPath, [cli, ...args, '--state-dir', join(directory, 'absent')],
        { env, timeout: 5000, maxBuffer: 65536, windowsHide: true, input: '' });
      if (result.error) throw new BoundaryError('ENVIRONMENT', 'PRODUCT_PROCESS_UNAVAILABLE');
      results.push({ command: args[0], exit: result.status });
    }
    if (results.some((item) => item.exit !== 3)) {
      throw new BoundaryError('PRODUCT_PREREQUISITE', results.map((item) => `${item.command}=${item.exit}`).join(','));
    }
    return results; // Necessary only; never the acceptance result.
  } finally { await rm(directory, { recursive: true, maxRetries: 3, retryDelay: 100 }); }
}

// Live binding is SDET-owned and deliberately absent until production assembly,
// journal format and isolated environment exist. It must not supply fixture IO.
export async function runProductAcceptance(binding) {
  const controller = new AbortController();
  const signal = controller.signal;
  let failure; let cleanupFailure; let evidence;
  try {
    await bounded(async () => {
    // Nothing launches before the containment/environment gates pass.
    await binding.assertEnvironment(signal);
    await binding.containment.verify(signal);
    const config = await binding.prepare(signal); // protected IPC, no .env/global discovery
    const { origin, hostAuthorization, brokerOrigin,
      sessions, originId, timeoutCalibration, toolName } = config;
    assert.equal(sessions.length, 2);
    assert.notEqual(sessions[0], sessions[1]);
    assert.ok(timeoutCalibration?.independentEvidence, 'ENVIRONMENT: calibrated actual timeout required');
    assert.match(toolName, /request_approval$/);
    await binding.containment.runCLI([cli, 'init', '--state-dir', config.stateDir], signal);
    await binding.containment.runCLI([cli, 'origin', 'add', originId, '--url', origin,
      '--password-env', config.passwordEnv, '--state-dir', config.stateDir], signal);
    const http = publicHTTP(origin, hostAuthorization);
    const host = hostAdapters(http, sessions[0]);
    const { originAuthorization } = await binding.readRunOwnedCredential(config.stateDir, originId, signal);
    const brokerHTTP = publicHTTP(brokerOrigin, originAuthorization);
    const brokerGet = (path, s = signal) => brokerHTTP('GET', path, undefined, s);
    const before = await host.info(signal);
    const identity = await host.session(signal);
    assert.equal(identity.data?.id, sessions[0]);
    const sameHost = async () => {
      const after = await host.info(signal);
      assert.equal(after.pid, before.pid, 'BEHAVIOR: host changed');
      assert.equal(after.version, before.version, 'BEHAVIOR: version changed');
      assert.equal((await host.session(signal)).data?.time?.created, identity.data.time.created);
      await binding.containment.assertHostAlive(signal);
    };
    // Arms ordered fsync-completion + receipt/Telegram/admission effect barriers
    // BEFORE starting broker/MCP. Decoder is bound later to SE's selected format.
    await binding.observers.arm(signal);
    await binding.gate.start({ origin, authorization: hostAuthorization }, signal);
    let broker = await binding.containment.launchBroker({ command: process.execPath,
      args: [cli, 'serve', '--state-dir', config.stateDir], gate: binding.gate,
      observers: binding.observers }, signal);
    await broker.ready(signal); // auth public read AND actual owned listener
    // Code is delivered privately to the operator; the human pairs in real Telegram.
    await binding.human.pairThroughCLI({ command: process.execPath,
      args: [cli, 'pair', '--state-dir', config.stateDir] }, signal);
    const restartBroker = async () => {
      await sameHost();
      const gatePid = binding.gate.pid;
      await broker.stop(signal);
      await broker.assertAbsentAndListenerReleased(signal);
      await binding.gate.discardHeldResult(signal); // old broker's serial cannot reach the new broker
      broker = await binding.containment.launchBroker({ command: process.execPath,
        args: [cli, 'serve', '--state-dir', config.stateDir], gate: binding.gate,
        observers: binding.observers }, signal);
      await broker.ready(signal);
      assert.equal(binding.gate.pid, gatePid, 'BEHAVIOR: gate replaced on broker restart');
      await sameHost();
    };
    const clientRequestId = `spike_${randomBytes(8).toString('hex')}`;
    const request = { origin_id: originId, session_id: sessions[0], action: 'controlled no-op',
      context: 'Product-boundary timeout acceptance', resolution: 'responded', response_text: ' yes\n ' };
    let created;
    const selectedTool = async () => {
      const found = exactTool(await host.tools(signal), toolName, clientRequestId);
      assert.ok(found.length <= 1, 'BEHAVIOR: duplicate original tool call');
      return found[0];
    };
    const readPending = async () => {
      const pending = await brokerGet(`/v1/requests/${created.request_id}?session_id=${encodeURIComponent(sessions[0])}`);
      for (const key of ['request_id', 'origin_id', 'session_id', 'client_request_id',
        'action', 'context', 'created_at', 'expires_at']) {
        assert.equal(pending[key], created[key], `BEHAVIOR: pending ${key} changed`);
      }
      assert.equal(pending.resolution, 'pending', 'BEHAVIOR: timeout closed request');
      assert.equal(pending.resolved_at, null);
      assert.equal(pending.response_text, null);
      assert.equal(pending.delivery_state, 'not_applicable');
      assert.ok(Date.parse(pending.expires_at) > Date.now(), 'BEHAVIOR: expired before human window');
      return pending;
    };
    const io = {
      get: (path, s) => http('GET', path, undefined, s), brokerGet,
      readDurable: () => binding.observers.readCommitted(created.request_id, signal),
      armReceiptFault: () => binding.receipt.arm({ clientRequestId }, signal),
      async invokeHost() {
        // Public input schedules the real host/model; never calls a fake MCP peer.
        // The run-isolated host config wires the real product mcp command through
        // the test receipt relay with an execution timeout, direct tools only.
        const template = acknowledgementText({ ...request, request_id: '<actual-request-id>' });
        await host.invoke(`msg_${randomBytes(16).toString('hex')}`,
          `Call ${toolName} exactly once with ${JSON.stringify({ client_request_id: clientRequestId,
            action: request.action, context: request.context, expires_in_seconds: 600 })}. ` +
          `Do not perform any action. After the later human decision, emit exactly this sentence, ` +
          `replacing <actual-request-id> with its request ID: ${template}`, signal);
      },
      async observePending() {
        created = await binding.receipt.observedReceipt(signal);
        assert.equal(created.client_request_id, clientRequestId);
        assert.equal(created.action, request.action); assert.equal(created.context, request.context);
        await readPending();
        await binding.observers.assertFlushedBeforeEffects(created.request_id, 'pending', signal);
        const expected = Object.fromEntries(['request_id', 'origin_id', 'session_id', 'client_request_id',
          'action', 'context', 'expires_at', 'resolution', 'resolved_at', 'response_text', 'delivery_state']
          .map((key) => [key, created[key]]));
        await assertPublicRestart({ restartBroker, brokerGet,
          readCommitted: () => binding.observers.readCommitted(created.request_id, signal) }, expected, null);
        return created;
      },
      async assertHostCallUnsettled() {
        const part = await poll(selectedTool, Boolean, signal, 'HOST_TOOL_NOT_INVOKED');
        assert.equal(part.state.status, 'running', 'BEHAVIOR: tool already settled');
      },
      observeWithheld: () => binding.receipt.assertWithheld(signal),
      async observeActualHostTimeout() {
        const part = await poll(selectedTool, (item) => item?.state?.status === 'error',
          signal, 'ACTUAL_HOST_TIMEOUT_NOT_OBSERVED', 30000);
        assertTimeout(part, timeoutCalibration);
      },
      // Mandatory public reread AFTER actual timeout, BEFORE opening human gate.
      assertPendingAfterTimeout: readPending,
      assertSameHost: sameHost,
      async resolveThroughPairedTelegram() {
        await binding.gate.select({ path: `/api/session/${encodeURIComponent(sessions[0])}/prompt`,
          id: `msg_${created.request_id.slice(4)}` }, signal);
        await binding.human.openWindow({ request: created, outcome: 'responded',
          responseText: request.response_text }, signal); // real paired-human UI, no decision API
      },
      async waitForAcknowledgement() {
        await binding.gate.waitHostCompletedAndSuppressed(signal);
        await binding.gate.waitProductionLossObserved(signal);
        await binding.observers.assertFlushedBeforeEffects(created.request_id, 'responded', signal);
        await binding.observers.assertIndependentAdmission(http, created.request_id, signal);
        await poll(() => brokerGet(`/v1/requests/${created.request_id}?session_id=${encodeURIComponent(sessions[0])}`),
          (value) => value.resolution === 'responded', signal, 'HUMAN_DECISION_NOT_RECORDED', 30000);
        const committed = await io.readDurable();
        await assertPublicRestart({ restartBroker, brokerGet, readCommitted: io.readDurable },
          { ...committed.request }, committed.prompt);
        // Gate admission release/reconciliation is production-owned. Wait for
        // public history prose before the stricter collector assertions.
        const expected = acknowledgementText({ ...request, request_id: created.request_id });
        await poll(() => host.assistant(signal), (messages) => messages.some((message) =>
          extractAssistant(message).textParts.some((text) => text === expected)),
        signal, 'EXACT_ASSISTANT_ACKNOWLEDGEMENT_NOT_OBSERVED', 30000);
      },
      async replay() {
        await restartBroker();
        // Real retry command; not a fake replay flag or direct POST from tests.
        await binding.containment.runCLI([cli, 'retry', created.request_id,
          '--state-dir', config.stateDir], signal);
        await sameHost();
      },
    };
    evidence = await runTimeoutCase(io, request, sessions);
    await binding.observers.verifyOrderingAndRestartEvidence(signal);
    }, 180000, 'PRODUCT_BOUNDARY_TOTAL_DEADLINE');
  } catch (error) { failure = error; }
  finally {
    controller.abort();
    try { await bounded(() => binding.containment.cleanupAndVerify(), 15000, 'CLEANUP_DEADLINE'); }
    catch (error) { cleanupFailure = error; }
  }
  if (failure || cleanupFailure) {
    const category = failure?.kind ?? (failure?.code === 'ERR_ASSERTION' ? 'BEHAVIOR' : 'BINDING_OR_HARNESS');
    throw new AggregateError([failure, cleanupFailure].filter(Boolean),
      `assertions=${failure ? `RED(${category})` : 'PASS'} cleanup=${cleanupFailure ? 'RED' : 'PASS'}`);
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await productPrerequisites();
    if (process.argv[2] !== '--isolated-live') throw new BoundaryError('ENVIRONMENT', 'ISOLATED_LIVE_NOT_AUTHORIZED');
    const path = resolve('tests/bindings/product-spike.mjs');
    try { await access(path); } catch { throw new BoundaryError('BINDING_PREREQUISITE', 'PRODUCT_ASSEMBLY_AND_CONTAINMENT_MISSING'); }
    const { createBinding } = await import(pathToFileURL(path));
    await runProductAcceptance(await createBinding());
    console.log('PASS: one direct-tool Respond timeout/lost-admission/restart/replay case; not full matrix');
  } catch (error) {
    // Never print underlying errors/requests: may contain secrets/private text.
    console.error(error instanceof BoundaryError || error instanceof AggregateError ? error.message :
      'RED: BINDING_OR_HARNESS prerequisite failed');
    process.exitCode = 1;
  }
}
