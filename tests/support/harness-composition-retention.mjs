// TEST ONLY. Closed diagnostics and existing composition lifecycle fault handling.
import assert from 'node:assert/strict';
import {
  compositionSnapshot,
  compositionErrorCode,
  compositionGuardJournal,
} from './harness-composition-readiness.mjs';
import { scanRequiredCaptures } from './harness-transport-fixtures.mjs';

const phases = new Set([
  'policy',
  'inspected-policy',
  'synthetic-enrollment',
  'compiled-product-start',
  'public-session-and-product-ready',
  'product-setup',
  'public-session-create',
  'host-session-sync',
  'public-command-eligibility',
  'rendered-host-and-product-registration',
  'rendered-product-session-picker',
  'rendered-product-empty-result',
  'physical-helper-absence',
  'exact-product-PluginCleanup',
  'actual-host-exit',
]);
const own = (object, name) => {
  try {
    return Object.getOwnPropertyDescriptor(object, name)?.value;
  } catch {
    return undefined;
  }
};
const freeze = (value) => {
  for (const item of Object.values(value)) if (item && typeof item === 'object') freeze(item);
  return Object.freeze(value);
};
export function failureSnapshot({ error, phase, keys, state, now, deadline }) {
  return freeze({
    phase: phases.has(phase) ? phase : 'UNLISTED_PHASE',
    errorCode: compositionErrorCode(error),
    keys: Object.fromEntries(
      ['ctrlG', 'enter', 'exit'].map((name) => {
        const v = own(keys, name);
        return [name, Number.isSafeInteger(v) && v >= 0 ? v : null];
      }),
    ),
    guard: compositionSnapshot({ ...state, now, deadline }),
  });
}

export async function waitCompositionPhase({ predicate, now, deadline, pause, overflow }) {
  while (now() < deadline) {
    if (overflow()) throw Object.assign(Error('capture limit'), { code: 'CAPTURE_LIMIT' });
    if ((await predicate()) && now() < deadline && !overflow()) return;
    await pause();
  }
  throw Object.assign(Error('phase deadline'), { code: 'PHASE_DEADLINE' });
}

export async function settleCompositionHost({
  observe,
  exitSent,
  requestExit,
  terminate,
  now,
  deadline,
  pause,
  graceMs = 10000,
  termMs = 2000,
}) {
  let termination = 'NOT_REQUESTED';
  const wait = async (budget) => {
    const until = Math.min(deadline, now() + budget);
    while (!observe().closed && now() < until) await pause();
  };
  if (!observe().closed) {
    if (!observe().exited && !exitSent) requestExit();
    await wait(graceMs);
    if (!observe().closed) {
      termination = 'SIGTERM_REQUESTED';
      terminate('SIGTERM');
      await wait(termMs);
    }
    if (!observe().closed) {
      termination = 'SIGKILL_REQUESTED';
      terminate('SIGKILL');
      await wait(Math.max(0, deadline - now()));
    }
  }
  return {
    exitObserved: observe().exited === true,
    closeObserved: observe().closed === true,
    termination,
  };
}

export const compositionSurfaces = Object.freeze([
  'tui',
  'telegram',
  'journal',
  'diagnostics',
  'evidence',
  'api',
]);
export function assertCompositionExport(scan) {
  assert.equal(own(scan, 'status'), 'PASS', 'composition scan refused');
  assert.deepEqual(own(scan, 'surfaces'), compositionSurfaces, 'composition scan incomplete');
}
const scanReasons = Object.freeze([
  'MISSING',
  'INCOMPLETE',
  'OVERFLOW',
  'SECRET_SET',
  'SECRET_MATCH',
  'COLLECTION',
  'WRITE',
  'UNKNOWN',
]);
// Private object identity, not exception text/code provided by an arbitrary IO
// dependency. Only locally recognized branches receive a precise classification.
const scanFailures = new WeakMap();
const scanRefuse = (reason) => {
  const error = Error('composition scan refused');
  scanFailures.set(error, reason);
  throw error;
};
export function compositionScanReason(error, stage) {
  return (
    scanFailures.get(error) ??
    (stage === 'COLLECTION' && own(error, 'code') === 'ENOENT'
      ? 'MISSING'
      : ['COLLECTION', 'WRITE', 'MISSING'].includes(stage)
        ? stage
        : 'UNKNOWN')
  );
}
export function scanFrozenComposition({ captures, secrets, complete, overflow }) {
  if (complete !== true) scanRefuse('INCOMPLETE');
  if (overflow !== false) scanRefuse('OVERFLOW');
  // Four role authorities plus every generated negative-fixture authority.
  // The driver passes the complete pinned transportFixtures set unchanged.
  if (!(
    Array.isArray(secrets) &&
    secrets.length >= 4 &&
    new Set(secrets).size === secrets.length &&
    secrets.every((s) => typeof s === 'string' && s.length > 0)
  ))
    scanRefuse('SECRET_SET');
  const requiredSecrets = Object.freeze(secrets.slice());
  const frozen = {};
  for (const surface of compositionSurfaces) {
    if (!Buffer.isBuffer(captures?.[surface])) scanRefuse('MISSING');
    if (captures[surface].length > 8388608) scanRefuse('OVERFLOW');
    frozen[surface] = Buffer.from(captures[surface]);
  }
  for (const bytes of Object.values(frozen))
    for (const secret of requiredSecrets)
      if (bytes.includes(Buffer.from(secret))) scanRefuse('SECRET_MATCH');
  const scan = scanRequiredCaptures(frozen, requiredSecrets, compositionSurfaces);
  return { captures: frozen, scan };
}

export function retainProgress(previous, phase, extra = {}) {
  return {
    ...previous,
    ...extra,
    phase,
    phases: [...(previous?.phases ?? []), phase],
    ...(previous?.containerExit !== undefined ? { containerExit: previous.containerExit } : {}),
  };
}

export async function persistCompositionDiagnostic(io, input) {
  const bytes = JSON.stringify(safeCompositionDiagnostic(input));
  await io.write(bytes);
  await io.commit();
}

// Revalidate at the outer export boundary. Unknown fields are never retained.
export function safeCompositionDiagnostic(input) {
  const get = (name) => own(input, name);
  const choice = (value, allowed, fallback = 'UNRUN') =>
    allowed.includes(value) ? value : fallback;
  const count = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  const keys = (value) =>
    Object.fromEntries(['ctrlG', 'enter', 'exit'].map((name) => [name, count(own(value, name))]));
  const at = get('failureAt');
  let failureAt = null;
  if (at) {
    const journal = compositionGuardJournal();
    journal.record('finalrefuse', own(at, 'guard'));
    const { sequence, stage, ...guard } = journal.value().records[0];
    failureAt = {
      phase: phases.has(own(at, 'phase')) ? own(at, 'phase') : 'UNLISTED_PHASE',
      errorCode: compositionErrorCode({ code: own(at, 'errorCode') }),
      keys: keys(own(at, 'keys')),
      guard,
    };
  }
  const life = get('lifecycle');
  return {
    status: choice(get('status'), ['PASS', 'FAIL'], 'FAIL'),
    failure:
      get('failure') === 'COMPOSITION_CONTROL_FAILURE' ? 'COMPOSITION_CONTROL_FAILURE' : null,
    phase: phases.has(get('phase')) ? get('phase') : 'UNLISTED_PHASE',
    errorCode: compositionErrorCode({ code: get('errorCode') }),
    failureAt,
    keys: keys(get('keys')),
    lifecycle: {
      exitObserved: own(life, 'exitObserved') === true,
      closeObserved: own(life, 'closeObserved') === true,
      termination: choice(
        own(life, 'termination'),
        ['NOT_REQUESTED', 'SIGTERM_REQUESTED', 'SIGKILL_REQUESTED'],
        'NOT_REQUESTED',
      ),
    },
    productCleanup: choice(get('productCleanup'), ['OBSERVED', 'UNRUN']),
    hostExit: choice(get('hostExit'), ['PASS', 'UNRUN']),
    rawScan: choice(get('rawScan'), ['PASS', 'REFUSED', 'UNRUN']),
    scanReason:
      get('rawScan') === 'REFUSED'
        ? choice(get('scanReason'), scanReasons, 'UNKNOWN')
        : get('rawScan') === 'PASS'
          ? 'NONE'
          : 'UNRUN',
    commandEligibility: choice(get('commandEligibility'), ['FRESH_SAME_GENERATION', 'UNRUN']),
    currentScreen: 'UNPROVEN',
    hostLoadingInventory: 'UNRUN_WITHOUT_SCANNED_OBSERVATIONS',
    elapsed: count(get('elapsed')),
  };
}
