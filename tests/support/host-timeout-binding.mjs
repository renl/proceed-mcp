// TEST ONLY. Offline assertions do NOT attest the provenance of a live binding.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { prerequisites } from './host-calibration.mjs';

const need = (value, code) => assert.ok(value, `HOST_TIMEOUT: ${code}`);
export function protectedTimeoutBinding(binding) {
  prerequisites(binding);
  need(['direct', 'codemode'].includes(binding.mode), 'MODE');
  need(typeof binding.toolName === 'string' && binding.toolName.includes('calibration_wait'), 'INNER_TOOL_PROJECTION_REQUIRED');
  need(Number.isInteger(binding.executionMs) && binding.executionMs > 0 &&
    binding.executionMs <= 120000, 'BOUNDED_EXECUTION_OVERRIDE');
  need(/^[a-f0-9]{64}$/.test(binding.configHash ?? ''), 'CONFIG_HASH');
  need(binding.schemaCompared === true, 'TARGET_SCHEMA_NOT_COMPARED');
  for (const hook of ['arm', 'invoke', 'history', 'alive', 'identity', 'stop'])
    need(typeof binding[hook] === 'function', `MISSING_${hook.toUpperCase()}`);
  return binding;
}

// Attach BEFORE any stimulus; clock belongs to this collector, not the fixture.
export function prearm(source, clock = () => performance.now()) {
  const events = []; let malformed = false;
  const listener = raw => {
    try {
      const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
      need(record && typeof record.event === 'string', 'OBSERVER_SHAPE');
      events.push({ ...record, at: clock() });
    } catch { malformed = true; }
  };
  source.on('record', listener);
  return { events, assertValid: () => need(!malformed, 'MALFORMED_OBSERVER'),
    close: () => source.off('record', listener) };
}

export function inspectHostError({ events, before, page, sessionID, path, toolName,
  executionMs, toleranceMs, observedAt }) {
  need(Number.isFinite(toleranceMs) && toleranceMs >= 0 && toleranceMs < executionMs, 'TIMING_BOUND');
  need(path === `/api/session/${encodeURIComponent(sessionID)}/message?type=assistant&limit=100&order=desc`, 'HISTORY_PROVENANCE');
  need(Array.isArray(before) && page && Array.isArray(page.data) && page.cursor &&
    (page.cursor.next === null || page.cursor.next === undefined), 'COMPLETE_SINGLE_PAGE_REQUIRED');
  // Pagination belongs to the protected collector. Never silently certify partial history.
  const sequence = ['observer-ready', 'initialize', 'initialized', 'catalog', 'call'];
  let index = -1;
  for (const event of sequence) {
    const matches = events.map((e, i) => [e, i]).filter(([e]) => e.event === event);
    need(matches.length === 1 && matches[0][1] > index, 'PROTOCOL_ORDER');
    index = matches[0][1];
  }
  const call = events[index];
  need(events.slice(0, index + 1).every((e, i, all) => Number.isFinite(e.at) &&
    (i === 0 || e.at >= all[i - 1].at)), 'OBSERVER_MONOTONIC_ORDER');
  need(call.sessionID === sessionID && call.id !== undefined && Number.isFinite(call.at), 'TRUSTED_CALL_CONTEXT');
  need(!events.some(e => ['result', 'eof', 'protocol-error'].includes(e.event)), 'CALL_NOT_HELD');
  const elapsedMs = observedAt - call.at;
  need(Number.isFinite(elapsedMs) && elapsedMs >= executionMs - toleranceMs &&
    elapsedMs <= executionMs + toleranceMs, 'EXECUTION_INTERVAL');
  const matches = page.data.filter(r => r.type === 'assistant' && !before.includes(r.id))
    .flatMap(r => (r.content ?? []).map((part, partIndex) => ({ r, part, partIndex })))
    .filter(({ part }) => part.type === 'tool' && part.name === toolName &&
      part.state?.status === 'error');
  need(matches.length === 1, 'EXACT_HOST_TOOL_ERROR_REQUIRED');
  const { r, part, partIndex } = matches[0];
  need(typeof r.id === 'string' && typeof part.id === 'string' &&
    typeof part.state.error?.type === 'string' && part.state.error.type.length &&
    typeof part.state.error?.message === 'string' && part.state.error.message.length, 'STRUCTURED_HOST_ERROR');
  // Tool projection IDs are retained, NOT guessed equal to JSON-RPC IDs.
  return { messageID: r.id, partIndex, toolID: part.id, callID: call.id,
    error: { ...part.state.error }, elapsedMs, path, stage: 'PRELIMINARY_HOST_ERROR',
    timeoutEstablished: false, supportEligible: false };
}

export async function collectHostError(binding, { toleranceMs, signal }) {
  const b = protectedTimeoutBinding(binding);
  need(signal instanceof AbortSignal, 'FINITE_SIGNAL_REQUIRED');
  // Independent total cap even if a protected adapter ignores cancellation.
  const bounded = async (operation, ms) => {
    let timer;
    try { return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('HOST_TIMEOUT: COLLECTOR_DEADLINE_NOT_HOST_PROOF')), ms);
    })]); } finally { clearTimeout(timer); }
  };
  const sessionID = b.sessions[0].id;
  let observer, result;
  try {
    await bounded(async () => {
    signal.throwIfAborted();
    await b.identity(signal);
    const baseline = await b.history(sessionID, signal), beforePage = baseline.page;
    const expectedPath = `/api/session/${encodeURIComponent(sessionID)}/message?type=assistant&limit=100&order=desc`;
    need(baseline.path === expectedPath, 'BASELINE_PROVENANCE');
    need(Array.isArray(beforePage.data) && beforePage.cursor && !beforePage.cursor.next, 'BASELINE_HISTORY');
    observer = await b.arm(signal); // Must resolve with listener already attached.
    need(observer && typeof observer.assertValid === 'function' && typeof observer.close === 'function', 'ARMED_OBSERVER');
    await b.invoke(sessionID, signal); // Receipt alone is never proof.
    const observed = await b.history(sessionID, signal);
    observer.assertValid();
    result = inspectHostError({ events: observer.events, before: beforePage.data.map(r => r.id), page: observed.page,
      sessionID, path: observed.path,
      toolName: b.toolName, executionMs: b.executionMs, toleranceMs, observedAt: performance.now() });
    need(await b.alive(signal), 'HOST_AND_SERVER_MUST_REMAIN_ALIVE');
    await b.identity(signal);
    }, b.executionMs + 10000);
  } finally {
    observer?.close();
    need((await bounded(() => b.stop(), 10000))?.clean === true, 'CLEANUP_NOT_VERIFIED');
  }
  return result;
}
