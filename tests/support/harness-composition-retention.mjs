// TEST ONLY. Closed diagnostics and existing composition lifecycle fault handling.
import assert from 'node:assert/strict';
import {
  compositionSnapshot,
  compositionErrorCode,
  compositionGuardJournal,
} from './harness-composition-readiness.mjs';
import { scanRequiredCaptures, freezeTransportSecrets } from './harness-transport-fixtures.mjs';
import { decodeMcpCapture, assertPrivateCaptureReceipt } from './harness-transparent-capture.mjs';
import { safeTransportFailure } from './harness-runtime-transport.mjs';

// Raw private MCP/callback captures are not publishable surfaces. Preparation
// capabilities are expected only at their contract-defined paths on the original
// connection. Inspect raw bytes AND decoded frames before deriving any summary.
// The six-surface public exporter and its blanket capability refusal stay intact.
export function scanIntegratedPrivateCaptures(
  { mcp, callbacks, other = [], receipts, secretLedger, scenarioSuccess = false, stage = () => {} },
  secrets,
) {
  stage('SECRET_CLASSIFICATION');
  assert.deepEqual(secrets, freezeTransportSecrets(secretLedger));
  stage('SEAL_RECEIPT');
  assertPrivateCaptureReceipt(mcp, receipts?.mcp);
  assertPrivateCaptureReceipt(callbacks, receipts?.callbacks);
  const inputs = [mcp, callbacks, ...other];
  stage('FILE_BOUNDS');
  assert.ok(inputs.every(Buffer.isBuffer));
  const bytes = inputs.reduce((n, b) => n + b.length, 0);
  stage('ACCOUNTING');
  collectionAdmit(bytes, collectionLimits.contents);
  rendererWork(bytes, inputs.length, secrets.length, bytes);
  const parse = (bytes) =>
    bytes.length === 0
      ? []
      : bytes
          .toString('utf8')
          .trim()
          .split('\n')
          .map((s) => JSON.parse(s));
  stage('CORRELATION');
  const capture = decodeMcpCapture(parse(mcp), 'composition-shared-owner', {
    allowEmptyDirections: true,
  });
  const prepared = new Map();
  for (const { message } of capture.calls)
    if (message.method === 'tools/call' && message.params.name === 'prepare_approval') {
      assert.ok(!prepared.has(message.id), 'duplicate originating preparation');
      assert.ok(
        typeof message.params._meta?.['ai.opencode/sessionID'] === 'string' &&
          message.params._meta['ai.opencode/sessionID'].length > 0,
      );
      prepared.set(message.id, message.params._meta?.['ai.opencode/sessionID']);
    }
  const capabilities = new Map();
  const requestIds = new Set(),
    handles = new Set();
  for (const { message } of capture.results)
    if (prepared.has(message.id)) {
      const p = message.result?.structuredContent;
      if (message.error !== undefined || message.result?.isError === true) continue;
      assert.match(p?.request_capability, /^cap_[a-f0-9]{64}$/);
      assert.match(p?.request_id, /^req_[a-f0-9]{32}$/);
      assert.match(p?.request_handle, /^hdl_[a-f0-9]{32}$/);
      assert.ok(!capabilities.has(p.request_capability), 'duplicate preparation capability');
      assert.ok(
        !requestIds.has(p.request_id) && !handles.has(p.request_handle),
        'inconsistent preparation identity',
      );
      requestIds.add(p.request_id);
      handles.add(p.request_handle);
      capabilities.set(p.request_capability, {
        session: prepared.get(message.id),
        request: p.request_id,
        handle: p.request_handle,
      });
    }
  if (scenarioSuccess) {
    assert.ok(mcp.length && callbacks.length, 'successful scenario workflow captures required');
    assert.equal(capabilities.size, 3, 'all three actual preparations must be captured');
    assert.equal(prepared.size, 3, 'successful scenario has exactly three prepare calls');
  }
  const waiting = new Map();
  for (const { message } of capture.calls) {
    if (message.method !== 'tools/call' || message.params.name !== 'request_approval') continue;
    assert.ok(!waiting.has(message.id));
    const binding = capabilities.get(message.params.arguments.request_capability);
    assert.ok(binding, 'unmatched request capability');
    assert.equal(binding.session, message.params._meta?.['ai.opencode/sessionID']);
    assert.equal(binding.handle, message.params.arguments.request_handle);
    waiting.set(message.id, binding);
  }
  if (scenarioSuccess) assert.equal(waiting.size, 3);
  const returned = new Set();
  for (const { message } of capture.results) {
    assert.ok(!returned.has(message.id), 'duplicate original result');
    returned.add(message.id);
    if (waiting.has(message.id) && message.result?.structuredContent) {
      assert.equal(message.result.structuredContent.request_id, waiting.get(message.id).request);
    }
  }
  const inspect = (value, path = [], allowed = null) => {
    stage('SECRET_CLASSIFICATION');
    if (typeof value === 'string') {
      for (const secret of secrets)
        assert.equal(value.includes(secret), false, 'private authority leak');
      assert.equal(
        /hop_[a-f0-9]{64}|(?:sk-|ghp_)[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_.-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(
          value,
        ),
        false,
      );
      const matches = value.match(/cap_[a-f0-9]{64}/g) ?? [];
      for (const cap of matches)
        assert.ok(
          allowed?.some(
            (a) => path.join('.') === a.path && value === (a.value ?? cap) && cap === a.cap,
          ),
          'capability outside its original private protocol field',
        );
    } else if (value && typeof value === 'object')
      for (const [key, child] of Object.entries(value)) {
        // Names are decoded JSON strings too. Private protocol exceptions are
        // for correlated values only and must never authorize a property name.
        inspect(key);
        assert.equal(
          /^(?:authorization|credential|operator_credential|owner_token|control_token|psk|secret)$/i.test(
            key,
          ),
          false,
          'unknown private authority field',
        );
        inspect(child, [...path, key], allowed);
      }
  };
  const checkBytes = (bytes) => {
    stage('SECRET_CLASSIFICATION');
    for (const secret of secrets)
      assert.equal(bytes.includes(Buffer.from(secret)), false, 'raw private authority leak');
  };
  for (const bytes of inputs) checkBytes(bytes);
  for (const { message } of [...capture.calls, ...capture.results]) {
    checkBytes(Buffer.from(JSON.stringify(message)));
    stage('CORRELATION');
    let allowed;
    if (prepared.has(message.id) && message.result && message.result.isError !== true) {
      const body = message.result.structuredContent;
      allowed = [
        { path: 'result.structuredContent.request_capability', cap: body.request_capability },
      ];
      assert.equal(message.result.content.length, 1);
      assert.equal(message.result.content[0].type, 'text');
      assert.deepEqual(JSON.parse(message.result.content[0].text), body);
      allowed.push({
        path: 'result.content.0.text',
        cap: body.request_capability,
        value: message.result.content[0].text,
      });
    } else if (message.method === 'tools/call' && message.params.name === 'request_approval') {
      const cap = message.params.arguments.request_capability;
      assert.ok(capabilities.has(cap), 'unmatched request capability');
      assert.equal(capabilities.get(cap)?.session, message.params._meta?.['ai.opencode/sessionID']);
      assert.equal(capabilities.get(cap).handle, message.params.arguments.request_handle);
      allowed = [{ path: 'params.arguments.request_capability', cap }];
    }
    inspect(message, [], allowed);
  }
  const callbackStarts = new Map();
  for (const callback of parse(callbacks)) {
    stage('CORRELATION');
    let allowed;
    if (['prepare-started', 'wait-started'].includes(callback.phase)) {
      assert.ok(typeof callback.coreCallID === 'string' && callback.coreCallID.length > 0);
      assert.ok(!callbackStarts.has(callback.coreCallID));
      callbackStarts.set(callback.coreCallID, {
        phase: callback.phase,
        session: callback.sessionID,
      });
    }
    if (['prepare-returned', 'wait-returned'].includes(callback.phase)) {
      assert.deepEqual(
        callbackStarts.get(callback.coreCallID),
        {
          phase: callback.phase.replace('-returned', '-started'),
          session: callback.sessionID,
        },
        'unmatched original callback',
      );
      callbackStarts.delete(callback.coreCallID);
    }
    if (
      callback.phase === 'prepare-returned' &&
      callback.value?.output?.request_capability !== undefined
    ) {
      const p = callback.value?.output;
      assert.deepEqual(capabilities.get(p?.request_capability), {
        session: callback.sessionID,
        request: p?.request_id,
        handle: p?.request_handle,
      });
      allowed = [{ path: 'value.output.request_capability', cap: p.request_capability }];
    }
    if (callback.phase === 'wait-returned' && callback.value?.output?.request_id !== undefined) {
      assert.ok(
        [...waiting.values()].some(
          (b) =>
            b.session === callback.sessionID && b.request === callback.value?.output?.request_id,
        ),
        'unmatched wait callback',
      );
    }
    inspect(callback, [], allowed);
  }
  if (scenarioSuccess) {
    stage('CORRELATION');
    assert.equal(callbackStarts.size, 0, 'successful scenario has no unfinished callbacks');
    for (const phase of ['prepare-returned', 'wait-returned'])
      assert.equal(parse(callbacks).filter((c) => c.phase === phase).length, 3);
  }
  for (const bytes of other) {
    inspect(bytes.toString('utf8'));
    for (const value of parse(bytes)) inspect(value);
  }
  return {
    status: 'PASS',
    bytes,
    files: inputs.length,
    hashes: inputs.map(digest),
    scope: 'Raw private protocol capture only. No raw export.',
  };
}

export function admitIntegratedPrivateInventory(captures, seals, stage = () => {}) {
  stage('SEAL_RECEIPT');
  assertPrivateCaptureReceipt(captures.get('mcp.jsonl'), seals.mcp);
  assertPrivateCaptureReceipt(captures.get('wrapper.jsonl'), seals.callbacks);
  assertPrivateCaptureReceipt(captures.get('composition-public-api.jsonl'), seals.api.api);
  const n = seals.api.actionSequence;
  stage('PROCESSED_ACTION');
  assert.ok(Number.isSafeInteger(n) && n >= 0 && n <= 64);
  for (let i = 1; i <= n; i++) {
    assert.ok(captures.has(`composition-action-${i}.json`), 'missing processed action input');
    assert.ok(
      captures.has(`composition-action-result-${i}.json`),
      'missing processed action output',
    );
  }
  stage('FILE_INVENTORY');
  assert.equal(typeof seals.api.serviceInventoryWritten, 'boolean');
  assert.equal(
    captures.has('composition-service-inventory.json'),
    seals.api.serviceInventoryWritten,
  );
  return { mcp: seals.mcp, callbacks: seals.callbacks };
}
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

// Export names are wire/archive identities, not retained basenames. The outer
// progress.jsonl is a mutable lifecycle journal and is never admitted evidence.
export const productRetainedPaths = Object.freeze({
  'scan-pass.json': 'scan-pass.json',
  'composition-observations.json': 'composition-observations.json',
  'transcript.ansi': 'transcript.ansi',
  'plugin-diagnostics.log': 'plugin-diagnostics.log',
  'progress.jsonl': 'inner-progress.jsonl',
});

export async function verifyRetainedProductCapture({
  read,
  expected,
  mapping = productRetainedPaths,
}) {
  const names = ['scan-pass.json', ...productCaptureFiles];
  assert.deepEqual(Object.keys(mapping), names);
  assert.deepEqual(Object.keys(expected), names);
  const paths = Object.values(mapping);
  assert.equal(new Set(paths.map((p) => String(p).toLowerCase())).size, names.length);
  for (const name of names) {
    assert.match(mapping[name], /^[a-z][a-z0-9.-]*$/);
    assert.equal(mapping[name], productRetainedPaths[name]);
    assert.deepEqual(Object.keys(expected[name]), ['bytes', 'sha256']);
    assert.ok(Number.isSafeInteger(expected[name].bytes) && expected[name].bytes >= 0);
    assert.match(expected[name].sha256, /^[a-f0-9]{64}$/);
  }
  collectionAdmit(
    names.reduce((n, name) => n + expected[name].bytes, 0),
    collectionLimits.detail,
  );
  const admitted = new Map();
  for (const name of names) {
    // The reader must enforce bounded regular-file/no-link IO. No detail is
    // returned to a consumer until the complete five-file set is admitted.
    const bytes = await read(mapping[name], expected[name].bytes);
    assert.ok(Buffer.isBuffer(bytes));
    assert.deepEqual(expected[name], { bytes: bytes.length, sha256: digest(bytes) });
    admitted.set(name, Buffer.from(bytes));
    if (name === 'scan-pass.json') {
      const scan = JSON.parse(bytes.toString('utf8'));
      assertCompositionExport(scan);
      assert.deepEqual(
        scan.files,
        Object.fromEntries(productCaptureFiles.map((n) => [n, expected[n]])),
      );
    }
  }
  return admitted;
}

// Filesystem categories are not product scan meanings. Keep the renderer's
// state/evidence schema closed while adapting only this private product route.
export async function productCaptureReadFile(state, path, surface, used, io, expected) {
  assert.ok(['state', 'evidence', 'diagnostics', 'journal', 'api'].includes(surface));
  try {
    return await rendererReadFile(
      state,
      path,
      surface === 'evidence' ? 'evidence' : 'state',
      used,
      io,
      expected,
    );
  } catch {
    // Existing renderer checkpoints identify the assertion without exposing its
    // size/path/error operands. IO/identity refusals stay a private-file failure.
    scanRefuse(
      state.reason === 'OVERFLOW' && state.stage === 'PER_FILE_SIZE'
        ? 'FILE_BOUNDS'
        : state.reason === 'OVERFLOW' && state.stage === 'TOTAL_SIZE'
          ? 'ACCOUNTING'
          : 'PRIVATE_FILE',
    );
  }
}

export async function productCaptureInputs(stateRoot, wirePath, io, allowApi = false) {
  const journal = await productCaptureReadFile({}, stateRoot + '/journal.log', 'journal', 0, io);
  const api = await productCaptureReadFile({}, wirePath, 'api', journal.length, io);
  if (!allowApi) assert.equal(api.length, 0);
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
      if (entry.isDirectory())
        chunks.push(await productCaptureLogs(path, accounting, depth + 1, io, now));
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
  stage = () => {},
) {
  stage('FILE_INVENTORY');
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
        stage('FILE_BOUNDS');
        collectionAdmit(size, collectionLimits.file);
        planned += size;
        S += size;
        if (/\.log(?:$|[.-])/.test(path) || path === roots.state + '/pty.raw') S += size;
        paths += Buffer.byteLength(path);
        N++;
      }
      stage('ACCOUNTING');
      collectionAdmit(planned, collectionLimits.contents);
      // Exact projection: complete path/content inventory plus duplicated logs,
      // raw PTY and all explicit product surfaces. No renderer fixture substitution.
      S += paths + collectionLimits.detail; // Reserve bounded derived export bytes.
      collectionAdmit(S, collectionLimits.surfaces);
      rendererWork(planned, N, secrets.length, S);
      for (const [path, e] of membership) {
        if (e.metadata[0] !== 'file') continue;
        stage('PRIVATE_FILE');
        const bytes = await productCaptureReadFile(state, path, e.surface, F, io, e.metadata);
        F += bytes.length;
        entries.push({ path, bytes });
      }
      stage('FILE_INVENTORY');
    },
  );
  assert.equal(result.complete, true);
  stage('ACCOUNTING');
  collectionAdmit(F, collectionLimits.contents);
  return entries;
}

export function productCaptureExport(
  captures,
  secrets,
  complete,
  overflow,
  details,
  inventory,
  stage = () => {},
) {
  stage('FILE_INVENTORY');
  if (inventory !== undefined) {
    assert.deepEqual(Object.keys(inventory), compositionSurfaces);
    for (const surface of compositionSurfaces) {
      assert.ok(
        Array.isArray(inventory[surface]) && inventory[surface].length > 0,
        'nonempty required surface inventory',
      );
      for (const source of inventory[surface]) {
        assert.ok(typeof source === 'string' && source.length > 0);
      }
    }
  }
  stage('SCAN');
  const { scan, captures: frozenCaptures } = scanFrozenComposition({
    captures,
    secrets,
    complete,
    overflow,
    measured: true,
  });
  stage('EXPORT');
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
  if (inventory !== undefined) scan.inventory = structuredClone(inventory);
  stage('ACCOUNTING');
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
  'rendered-product-picker-dismissal',
  'actual-host-exit',
  'integrated-capture-armed',
  'integrated-transport-outcomes',
  'integrated-enrollment-display',
  'integrated-public-action',
  'integrated-original-result',
  'integrated-current-cells',
  'integrated-losing-channel',
  'concurrent-product-pending',
  'matching-product-retained-outcome',
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
export function failureSnapshot({ error, phase, keys, state, now, deadline, lastLoopGuard }) {
  let sampledGuard = null;
  if (lastLoopGuard) {
    const projection = compositionGuardJournal();
    projection.record('loopadmit', lastLoopGuard);
    sampledGuard = projection.value().records[0];
  }
  return freeze({
    transport: safeTransportFailure(own(error, 'transportFailure')),
    phase: phases.has(phase) ? phase : 'UNLISTED_PHASE',
    errorCode: compositionErrorCode(error),
    keys: Object.fromEntries(
      ['ctrlG', 'enter', 'exit'].map((name) => {
        const v = own(keys, name);
        return [name, Number.isSafeInteger(v) && v >= 0 ? v : null];
      }),
    ),
    guard: compositionSnapshot({ ...state, now, deadline }),
    lastLoopGuard: sampledGuard,
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
  allowExit = true,
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
    if (!observe().exited && !exitSent && allowExit) requestExit();
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

// Closed driver-clock observations. Wrapper durations have a separate origin.
export function cleanupMilestones(now) {
  const origin = now();
  let deadline = null;
  let timely = false;
  const events = [];
  const record = (stage) => {
    assert.ok(['EXIT_KEY', 'MARKER_OBSERVED', 'SIGTERM', 'SIGKILL'].includes(stage));
    if (events.some((e) => e.stage === stage)) return;
    const at = now();
    if (stage === 'MARKER_OBSERVED') timely = deadline !== null && at < deadline;
    events.push({ stage, ms: Math.max(0, Math.floor(at - origin)) });
  };
  return {
    begin(budget) {
      assert.equal(deadline, null);
      assert.ok(Number.isFinite(budget) && budget >= 0 && budget <= 15000);
      deadline = now() + Math.max(0, budget);
      return deadline;
    },
    record,
    value(wrapper) {
      let milestones = null;
      const clock = own(wrapper, 'clock'),
        entry = own(wrapper, 'entry'),
        returned = own(wrapper, 'returned');
      if (
        clock === 'WRAPPER_MONOTONIC_MS' &&
        Number.isSafeInteger(entry) &&
        entry >= 0 &&
        entry <= 210000 &&
        (returned === undefined ||
          (Number.isSafeInteger(returned) && returned >= entry && returned <= 210000))
      ) {
        milestones = {
          clock,
          ENTRY: entry,
          RETURN: returned ?? null,
        };
      }
      return {
        clock: 'DRIVER_MONOTONIC_MS',
        events: structuredClone(events),
        deadlineMs: deadline === null ? null : Math.max(0, Math.floor(deadline - origin)),
        timely,
        wrapper: milestones,
      };
    },
  };
}

export function safeCleanupObservation(value) {
  const time = (v) => (Number.isSafeInteger(v) && v >= 0 && v <= 210000 ? v : null);
  if (own(value, 'clock') !== 'DRIVER_MONOTONIC_MS') return null;
  const input = own(value, 'events');
  const events = [];
  if (Array.isArray(input)) {
    for (let n = 0; n < 4; n++) {
      const event = own(input, String(n));
      const stage = own(event, 'stage'),
        ms = time(own(event, 'ms'));
      if (
        ['EXIT_KEY', 'MARKER_OBSERVED', 'SIGTERM', 'SIGKILL'].includes(stage) &&
        ms !== null &&
        !events.some((e) => e.stage === stage) &&
        (!events.length || ms >= events.at(-1).ms)
      )
        events.push({ stage, ms });
    }
  }
  const wrapper = own(value, 'wrapper');
  const entry = time(own(wrapper, 'ENTRY')),
    returned = time(own(wrapper, 'RETURN'));
  return {
    clock: 'DRIVER_MONOTONIC_MS',
    events,
    deadlineMs: time(own(value, 'deadlineMs')),
    timely: own(value, 'timely') === true && events.some((e) => e.stage === 'MARKER_OBSERVED'),
    wrapper:
      own(wrapper, 'clock') === 'WRAPPER_MONOTONIC_MS' && entry !== null
        ? {
            clock: 'WRAPPER_MONOTONIC_MS',
            ENTRY: entry,
            RETURN: returned !== null && returned >= entry ? returned : null,
          }
        : null,
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
  'PRODUCER_CLOSE',
  'LISTENER_CLOSE',
  'HOST_STREAMS',
  'PROCESS_ABSENCE',
  'PRIVATE_FILE',
  'SEAL_RECEIPT',
  'PROCESSED_ACTION',
  'CORRELATION',
  'SECRET_CLASSIFICATION',
  'FILE_INVENTORY',
  'FILE_BOUNDS',
  'ACCOUNTING',
  'SCAN',
  'EXPORT',
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
      : scanReasons.includes(stage)
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
    let lastLoopGuard = null;
    if (own(at, 'lastLoopGuard')) {
      const sampled = compositionGuardJournal();
      sampled.record('loopadmit', own(at, 'lastLoopGuard'));
      const { sequence, stage, ...projection } = sampled.value().records[0];
      lastLoopGuard = projection;
    }
    failureAt = {
      transport: safeTransportFailure(own(at, 'transport')),
      phase: phases.has(own(at, 'phase')) ? own(at, 'phase') : 'UNLISTED_PHASE',
      errorCode: compositionErrorCode({ code: own(at, 'errorCode') }),
      keys: keys(own(at, 'keys')),
      guard,
      lastLoopGuard,
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
    cleanupObservation: safeCleanupObservation(get('cleanupObservation')),
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
