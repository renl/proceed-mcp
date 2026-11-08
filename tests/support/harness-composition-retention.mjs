// TEST ONLY. Closed diagnostics and existing composition lifecycle fault handling.
import assert from 'node:assert/strict';
import {
  compositionSnapshot,
  compositionErrorCode,
  compositionGuardJournal,
} from './harness-composition-readiness.mjs';
import { scanRequiredCaptures } from './harness-transport-fixtures.mjs';
import { lstat, open, opendir } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  rendererMetadataInventory,
  rendererReadFile,
  rendererWork,
  collectionAdmit,
  collectionLimits,
  inventoryLimits,
  digest,
  parseRendererArchive,
} from './harness-renderer-observation.mjs';

export const productCaptureFiles = Object.freeze([
  'composition-observations.json',
  'transcript.ansi',
  'plugin-diagnostics.log',
  'progress.jsonl',
]);

// Filesystem categories are not product scan meanings. Keep the renderer's
// state/evidence schema closed while adapting only this private product route.
export function productCaptureReadFile(state, path, surface, used, io, expected) {
  assert.ok(['state', 'evidence', 'diagnostics', 'journal', 'api'].includes(surface));
  return rendererReadFile(state, path, surface === 'evidence' ? 'evidence' : 'state', used, io, expected);
}

export async function productCaptureInputs(stateRoot, wirePath, io) {
  const journal = await productCaptureReadFile({}, stateRoot + '/journal.log', 'journal', 0, io);
  const api = await productCaptureReadFile({}, wirePath, 'api', journal.length, io);
  assert.equal(api.length, 0);
  return { journal, api };
}

export async function productCaptureLogs(
  root,
  accounting,
  depth = 0,
  io = { lstat, open, opendir, flags: constants, allocate: Buffer.alloc },
  now = Date.now,
) {
  assert.ok(depth <= Number(inventoryLimits.depth) && now() < accounting.deadline);
  const chunks = [];
  const directory = await io.opendir(root, { bufferSize: 1 });
  try {
    for (;;) {
      assert.ok(now() < accounting.deadline);
      const entry = await directory.read();
      if (!entry) break;
      const path = root + '/' + entry.name;
      accounting.entries++;
      accounting.paths += Buffer.byteLength(path);
      assert.ok(accounting.entries <= Number(inventoryLimits.entries));
      assert.ok(Buffer.byteLength(path) <= Number(inventoryLimits.path));
      assert.ok(accounting.paths <= Number(inventoryLimits.paths));
      assert.equal(entry.isSymbolicLink(), false);
      if (entry.isDirectory()) chunks.push(await productCaptureLogs(path, accounting, depth + 1, io, now));
      else if (/\.log(?:[.-].*)?$/.test(entry.name)) {
        const bytes = await productCaptureReadFile({}, path, 'diagnostics', accounting.bytes, io);
        accounting.bytes += bytes.length;
        chunks.push(bytes);
      }
    }
  } finally {
    await directory.close();
  }
  return Buffer.concat(chunks);
}

// Reuse traversal/read admission, NOT the renderer surface set or scan marker.
export async function collectProductCapture(
  roots,
  extras,
  secrets,
  endpoint,
  io = { lstat, open, opendir, flags: constants, allocate: Buffer.alloc },
) {
  const state = {},
    entries = [];
  let F = extras.reduce((n, e) => n + e.bytes.length, 0);
  const result = await rendererMetadataInventory(
    roots,
    endpoint,
    io,
    inventoryLimits,
    Date.now,
    async (membership) => {
      let planned = F,
        paths = 0,
        N = extras.length,
        S = F;
      for (const [path, e] of membership) {
        if (e.metadata[0] !== 'file') continue;
        const size = Number(e.metadata[3]);
        collectionAdmit(size, collectionLimits.file);
        planned += size;
        S += size;
        if (/\.log(?:$|[.-])/.test(path) || path === roots.state + '/pty.raw') S += size;
        paths += Buffer.byteLength(path);
        N++;
      }
      collectionAdmit(planned, collectionLimits.contents);
      // Exact projection: complete path/content inventory plus duplicated logs,
      // raw PTY and all explicit product surfaces. No renderer fixture substitution.
      S += paths + collectionLimits.detail; // Reserve bounded derived export bytes.
      collectionAdmit(S, collectionLimits.surfaces);
      rendererWork(planned, N, secrets.length, S);
      for (const [path, e] of membership) {
        if (e.metadata[0] !== 'file') continue;
        const bytes = await productCaptureReadFile(state, path, e.surface, F, io, e.metadata);
        F += bytes.length;
        entries.push({ path, bytes });
      }
    },
  );
  assert.equal(result.complete, true);
  collectionAdmit(F, collectionLimits.contents);
  return entries;
}

export function productCaptureExport(captures, secrets, complete, overflow, details) {
  const { scan, captures: frozenCaptures } = scanFrozenComposition({
    captures,
    secrets,
    complete,
    overflow,
    measured: true,
  });
  assert.deepEqual(Object.keys(details), productCaptureFiles);
  // Every exact export byte must already be in its product scan surface.
  for (const [name, bytes] of Object.entries(details)) {
    assert.ok(Buffer.isBuffer(bytes));
    const surface =
      name === 'transcript.ansi'
        ? 'tui'
        : name === 'plugin-diagnostics.log'
          ? 'diagnostics'
          : 'evidence';
    assert.ok(
      frozenCaptures[surface].includes(bytes) ||
        (name === 'plugin-diagnostics.log' && frozenCaptures.evidence.includes(bytes)),
    );
  }
  scan.files = Object.fromEntries(
    Object.entries(details).map(([name, bytes]) => [
      name,
      { bytes: bytes.length, sha256: digest(bytes) },
    ]),
  );
  collectionAdmit(
    Buffer.byteLength(JSON.stringify(scan)) +
      Object.values(details).reduce((n, b) => n + b.length, 0),
    collectionLimits.detail,
  );
  return {
    scan,
    details: Object.fromEntries(
      Object.entries(details).map(([name, bytes]) => [name, Buffer.from(bytes)]),
    ),
  };
}

export async function transferProductCapture(transfer) {
  let remaining = collectionLimits.detail;
  const bytes = parseRendererArchive(
    await transfer('scan-pass.json', remaining + 4096),
    'scan-pass.json',
    remaining,
  );
  remaining -= bytes.length;
  const scan = JSON.parse(bytes.toString('utf8'));
  assertCompositionExport(scan);
  assert.deepEqual(Object.keys(scan.files), productCaptureFiles);
  const admitted = new Map([['scan-pass.json', bytes]]);
  for (const name of productCaptureFiles) {
    const b = parseRendererArchive(await transfer(name, remaining + 4096), name, remaining);
    remaining -= b.length;
    assert.deepEqual(scan.files[name], { bytes: b.length, sha256: digest(b) });
    admitted.set(name, b);
  }
  return admitted;
}

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
export function scanFrozenComposition({ captures, secrets, complete, overflow, measured = false }) {
  if (complete !== true) scanRefuse('INCOMPLETE');
  if (overflow !== false) scanRefuse('OVERFLOW');
  // The driver validates complete producer coverage and normalizes duplicates
  // once before freezing. This scan boundary still refuses malformed sets.
  if (!(
    Array.isArray(secrets) &&
    secrets.length >= 4 &&
    new Set(secrets).size === secrets.length &&
    secrets.every((s) => typeof s === 'string' && s.length > 0)
  ))
    scanRefuse('SECRET_SET');
  const requiredSecrets = Object.freeze(secrets.slice());
  if (measured) {
    const S = compositionSurfaces.reduce((n, s) => n + (captures?.[s]?.length ?? 0), 0);
    collectionAdmit(S, collectionLimits.surfaces);
    rendererWork(0, 0, secrets.length, S);
  }
  const frozen = {};
  for (const surface of compositionSurfaces) {
    if (!Buffer.isBuffer(captures?.[surface])) scanRefuse('MISSING');
    if (captures[surface].length > (measured ? collectionLimits.surfaces : 8388608))
      scanRefuse('OVERFLOW');
    frozen[surface] = Buffer.from(captures[surface]);
  }
  for (const bytes of Object.values(frozen))
    for (const secret of requiredSecrets)
      if (bytes.includes(Buffer.from(secret))) scanRefuse('SECRET_MATCH');
  for (const bytes of Object.values(frozen))
    if (
      /cap_[a-f0-9]{64}|(?:sk-|ghp_)[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
        bytes.toString('utf8'),
      )
    )
      scanRefuse('SECRET_MATCH');
  const scan = measured
    ? {
        status: 'PASS',
        surfaces: compositionSurfaces,
        hashes: Object.fromEntries(compositionSurfaces.map((s) => [s, digest(frozen[s])])),
      }
    : scanRequiredCaptures(frozen, requiredSecrets, compositionSurfaces);
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
