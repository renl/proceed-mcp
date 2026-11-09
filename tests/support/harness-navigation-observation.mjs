// TEST ONLY. Public message assertions and fail-closed current-frame observation.
// Pinned 2.2.5 DialogSelectRow normal selection is styled, not a current dot.
// Interval roles are emitted identities, not a theme profile or pixel claim.
// Injected IO proves only the mechanism, never host rendering or input authority.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compositionSourceFrame } from './harness-composition-readiness.mjs';
import { identityPreview } from '../../src/harness/session-identity.js';

// Private capture evidence only. No result from this route authorizes an Enter.
export function productPickerObservation(raw, binding, snapshot, previous) {
  assert.ok(Buffer.isBuffer(raw) && raw.length <= 1048576);
  const frozen = structuredClone({ binding, snapshot });
  const base = {
    ...frozen,
    bytes: raw.length,
    sha256: createHash('sha256').update(raw).digest('hex'),
    previousSha256: previous?.sha256 ?? null,
    qualification: 'UNQUALIFIED',
    selectionProfile: null,
  };
  const refuse = (reason) => ({ ...base, supported: false, reason });
  try {
    if (previous) {
      assert.ok(raw.length > previous.bytes);
      assert.equal(
        createHash('sha256').update(raw.subarray(0, previous.bytes)).digest('hex'),
        previous.sha256,
      );
    }
    assert.equal(binding.scope, 'product-capture');
    assert.ok(binding.run && binding.setup && binding.executable && binding.config);
    assert.equal(binding.geometry?.width, 120);
    assert.equal(binding.geometry?.height, 40);
    assert.ok(
      Number.isSafeInteger(binding.geometry.resizeSequence) && binding.geometry.resizeSequence >= 0,
    );
    assert.ok(Array.isArray(snapshot) && snapshot.length >= 2 && snapshot.length <= 8);
    assert.equal(new Set(snapshot.map((s) => s.id)).size, snapshot.length);
    snapshot.forEach((s, n) => {
      assert.deepEqual(Object.keys(s).sort(), ['id', 'ordinal', 'title']);
      assert.ok(typeof s.id === 'string' && s.id.length > 0);
      assert.equal(typeof s.title, 'string');
      assert.equal(s.ordinal, `Session ${n + 1}`);
    });
    const frame = compositionSourceFrame(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    if (!frame.supported) return refuse('UNSUPPORTED_DECODER');
    assert.ok(frame.frames > 0 && frame.generation > 0 && Array.isArray(frame.styles));
    assert.equal(frame.text.includes('Open Proceed question?'), false);
    assert.equal(frame.text.includes('\u25cf'), false, 'product has no current marker');
    const lines = frame.text.split('\n');
    assert.equal(lines.filter((s) => s.includes('Select the Proceed session')).length, 1);
    const rows = snapshot.map((s) => {
      const label = `${s.ordinal} - ${identityPreview(s.title)}`;
      const matches = lines.flatMap((line, row) => {
        const col = line.indexOf(label);
        return col < 0 ? [] : [{ row, col, line }];
      });
      assert.equal(matches.length, 1);
      const { row, col, line } = matches[0];
      assert.match(line.slice(0, col), /^ *$/);
      assert.match(line.slice(col + label.length), /^ *$/);
      const cells = frame.styles[row]?.slice(col, col + label.length);
      assert.equal(cells?.length, label.length);
      assert.ok(cells.every((c) => validStyle(c, (v) => v === null || rgb(v) || indexed(v))));
      assert.ok(cells.every((c) => JSON.stringify(c) === JSON.stringify(cells[0])));
      return { ordinal: s.ordinal, id: s.id, label, row, col, style: cells[0] };
    });
    assert.equal(lines.filter((s) => /Session \d+ - /.test(s)).length, rows.length);
    assert.ok(rows.every((r, n) => !n || r.row > rows[n - 1].row));
    return {
      ...base,
      supported: true,
      reason: 'NONE',
      rows,
      frames: frame.frames,
      screen: frame.generation,
    };
  } catch {
    return refuse('UNBOUND_OR_INCOMPLETE_CELLS');
  }
}

export function productPickerInterval(before, after) {
  // Interval facts are not reusable profiles. Unknown semantic bindings refuse
  // qualification even when emitted identities visibly transfer between rows.
  try {
    assert.ok(before.supported && after.supported);
    assert.deepEqual(before.binding, after.binding);
    assert.deepEqual(before.snapshot, after.snapshot);
    assert.equal(before.screen, after.screen);
    assert.ok(after.frames > before.frames && after.bytes > before.bytes);
    assert.equal(after.previousSha256, before.sha256);
    assert.deepEqual(
      before.rows.map(({ style, ...r }) => r),
      after.rows.map(({ style, ...r }) => r),
    );
    assert.ok(before.rows[0].style.bold && after.rows[1].style.bold);
    assert.ok(before.rows.slice(1).every((r) => !r.style.bold));
    assert.ok(after.rows.filter((_, n) => n !== 1).every((r) => !r.style.bold));
    assert.deepEqual(before.rows[0].style, after.rows[1].style);
    assert.deepEqual(before.rows[1].style, after.rows[0].style);
    for (let n = 2; n < before.rows.length; n++) {
      assert.deepEqual(before.rows[n].style, before.rows[1].style);
      assert.deepEqual(after.rows[n].style, before.rows[1].style);
    }
    assert.notEqual(before.rows[0].style.bg, before.rows[1].style.bg);
    return {
      qualification: 'UNQUALIFIED',
      reason: 'MISSING_SEMANTIC_BINDING',
      emittedTransfer: true,
      selectionProfile: null,
    };
  } catch {
    return {
      qualification: 'UNQUALIFIED',
      reason: 'INVALID_INTERVAL',
      emittedTransfer: false,
      selectionProfile: null,
    };
  }
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function assertNavigationBinding(binding) {
  assert.equal(binding.scope, 'product-capture');
  for (const key of ['executable', 'package', 'config', 'wrapper'])
    assert.match(binding[key], /^[a-f0-9]{64}$/);
  assert.equal(binding.source, '9bbb8ce18c80f099e0e448775f59d965ead40a21');
  assert.equal(binding.rendererSource, '738067f47e940dcec3f5aab74868908574335c6c');
  assert.equal(binding.sourceBinding, 'PINNED_IMAGE_PROVENANCE_NOT_RUNTIME_ACCESSOR');
  assert.equal(typeof binding.configBytes, 'string');
  assert.equal(hash(binding.configBytes), binding.config);
  for (const key of ['run', 'setup']) assert.ok(typeof binding[key] === 'string' && binding[key]);
  for (const key of ['version', 'bun', 'node'])
    assert.ok(typeof binding.runtime[key] === 'string' && binding.runtime[key]);
  assert.equal(binding.runtime.version, '2.2.5');
  assert.ok(binding.environment && Object.keys(binding.environment).length > 0);
  assert.ok(Object.values(binding.environment).every((v) => typeof v === 'string'));
  assert.ok(Array.isArray(binding.terminalResponsePolicy) && binding.terminalResponsePolicy.length);
  assert.ok(Array.isArray(binding.inputs) && binding.inputs.length > 0);
  assert.deepEqual(
    binding.inputs.map((s) => s.path),
    binding.payload,
  );
  assert.equal(new Set(binding.payload).size, binding.payload.length);
  for (const entry of binding.inputs) {
    assert.match(entry.path, /^[a-zA-Z0-9_./-]+$/);
    assert.ok(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  }
  for (const path of [
    'package.json',
    'src/harness/tui-entry.js',
    'bin/proceed-mcp.js',
    'tests/fixtures/harness-composition/tui.ts',
  ])
    assert.ok(binding.payload.includes(path));
  assert.equal(binding.inputs.find((s) => s.path === 'package.json').sha256, binding.package);
  assert.equal(
    binding.inputs.find((s) => s.path === 'tests/fixtures/harness-composition/tui.ts').sha256,
    binding.wrapper,
  );
}

// Private synchronous final-admission mechanism. The caller owns observation
// continuity and must invalidate on any gap or observed input/theme/capability
// change. No returned observation/profile can be imported into another instance.
// Real composition keeps this route closed. Static callers inject recorder IO.
export function createProductNavigationObserver({
  binding,
  snapshot,
  sample,
  now,
  deadline,
  moveDown,
  enter,
}) {
  const admitted = structuredClone(binding);
  const sessions = structuredClone(snapshot);
  let stage = 'INITIAL',
    initial,
    moved,
    identity,
    selected;
  let lastClock = -Infinity;
  const clock = () => {
    const tick = readProductPickerClock(now);
    assert.ok(tick >= lastClock, 'picker clock reversed');
    lastClock = tick;
    assertProductPickerDeadline(() => tick, deadline);
  };
  const fence = (work) => {
    try {
      assert.notEqual(stage, 'INVALID');
      clock();
      return work();
    } catch {
      stage = 'INVALID';
      assert.fail('navigation admission refused');
    }
  };
  const read = () => {
    assertNavigationBinding(admitted);
    const current = sample(); // Independent public snapshot, never inferred rows.
    assert.deepEqual(structuredClone(current.binding), admitted);
    assert.deepEqual(current.snapshot, sessions);
    assert.equal(current.live.live, true);
    assert.equal(current.live.run, admitted.run);
    assert.equal(current.live.generation, admitted.setup);
    assert.deepEqual(current.live.geometry, admitted.geometry);
    assert.deepEqual(current.live.snapshot, sessions);
    assert.ok(Buffer.isBuffer(current.raw) && current.raw.length <= 1048576);
    return current;
  };
  const observe = (previous) => {
    const current = read();
    const observation = productPickerObservation(
      current.raw,
      current.binding,
      current.snapshot,
      previous && current.raw.length !== previous.bytes ? previous : undefined,
    );
    assert.equal(observation.supported, true);
    if (previous && current.raw.length === previous.bytes)
      assert.equal(observation.sha256, previous.sha256);
    return observation;
  };
  const unchangedPicker = (previous) => {
    const fresh = observe(previous);
    // Conservative fence: any output since the last admitted role observation
    // needs new interval proof, even an apparently identical repaint.
    assert.deepEqual(fresh, { ...previous, previousSha256: null });
    return fresh;
  };
  const samePrefix = (raw, previous) => {
    assert.ok(raw.length > previous.bytes);
    assert.equal(hash(raw.subarray(0, previous.bytes)), previous.sha256);
  };
  return Object.freeze({
    invalidate() {
      stage = 'INVALID';
    },
    initial() {
      return fence(() => {
        assert.equal(stage, 'INITIAL');
        initial = observe();
        assert.ok(initial.rows[0].style.bold);
        assert.ok(initial.rows.slice(1).every((r) => !r.style.bold));
        stage = 'READY_TO_MOVE';
        return structuredClone(initial);
      });
    },
    moveDown() {
      return fence(() => {
        assert.equal(stage, 'READY_TO_MOVE');
        unchangedPicker(initial);
        stage = 'AWAIT_MOVED';
        clock();
        moveDown(); // One causally bracketed physical movement, not a callback result.
      });
    },
    moved() {
      return fence(() => {
        assert.equal(stage, 'AWAIT_MOVED');
        moved = observe(initial);
        assert.equal(moved.frames, initial.frames + 1);
        assert.equal(productPickerInterval(initial, moved).emittedTransfer, true);
        stage = 'PICKER';
        return structuredClone(moved); // Still UNQUALIFIED and null profile.
      });
    },
    pickerEnter(session) {
      return fence(() => {
        assert.equal(stage, 'PICKER');
        assert.deepEqual(session, sessions[1]);
        unchangedPicker(moved);
        selected = structuredClone(session);
        stage = 'AWAIT_IDENTITY';
        clock(); // Last operation before the bounded input callback.
        enter();
      });
    },
    identity() {
      return fence(() => {
        assert.equal(stage, 'AWAIT_IDENTITY');
        const current = read();
        samePrefix(current.raw, moved);
        const frame = compositionSourceFrame(
          new TextDecoder('utf-8', { fatal: true }).decode(current.raw),
        );
        assert.ok(
          frame.supported && frame.generation === moved.screen && frame.frames > moved.frames,
        );
        assertCurrentIdentityFrame(frame.text, selected, admitted.geometry);
        identity = {
          bytes: current.raw.length,
          sha256: hash(current.raw),
          frames: frame.frames,
          screen: frame.generation,
          text: frame.text,
        };
        stage = 'IDENTITY';
        return structuredClone(identity);
      });
    },
    openQuestion() {
      return fence(() => {
        assert.equal(stage, 'IDENTITY');
        const current = read();
        assert.equal(current.raw.length, identity.bytes);
        assert.equal(hash(current.raw), identity.sha256);
        const frame = compositionSourceFrame(
          new TextDecoder('utf-8', { fatal: true }).decode(current.raw),
        );
        assert.ok(
          frame.supported &&
            frame.generation === identity.screen &&
            frame.frames === identity.frames,
        );
        assert.equal(frame.text, identity.text);
        assertCurrentIdentityFrame(frame.text, selected, admitted.geometry);
        stage = 'DONE';
        clock();
        enter(); // Navigation only. No pending/decision or callback authority here.
      });
    },
  });
}

// A positive host-frame predicate, not absence in arbitrary terminal bytes.
export function productPickerDismissal(raw, binding, previous, hostFrame) {
  try {
    assert.ok(previous?.supported && Buffer.isBuffer(raw));
    assert.deepEqual(binding, previous.binding);
    assert.ok(raw.length > previous.bytes && raw.length <= 1048576);
    assert.equal(
      createHash('sha256').update(raw.subarray(0, previous.bytes)).digest('hex'),
      previous.sha256,
    );
    const frame = compositionSourceFrame(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    assert.ok(
      frame.supported && frame.generation === previous.screen && frame.frames > previous.frames,
    );
    assert.ok(frame.text.includes('2.2.5') && frame.text.includes('Ask anything'));
    assert.ok(
      !/Select the Proceed session|Open Proceed question\?|Session \d+ - /.test(frame.text),
    );
    const normalize = (s) =>
      s
        .split('\n')
        .map((line) => line.replace(/ +$/, ''))
        .join('\n')
        .replace(/\n+$/, '');
    assert.equal(typeof hostFrame, 'string');
    assert.equal(normalize(frame.text), normalize(hostFrame));
    return {
      supported: true,
      reason: 'NONE',
      bytes: raw.length,
      sha256: createHash('sha256').update(raw).digest('hex'),
      screen: frame.generation,
      frames: frame.frames,
      hostFrameSha256: createHash('sha256').update(normalize(hostFrame)).digest('hex'),
    };
  } catch {
    return { supported: false, reason: 'DISMISSAL_UNPROVEN' };
  }
}

export function readProductPickerClock(now) {
  let current;
  try {
    current = now();
  } catch {
    assert.fail('picker clock unavailable');
  }
  assert.ok(typeof current === 'number' && Number.isFinite(current), 'picker clock invalid');
  return current;
}

export function assertProductPickerDeadline(now, deadline) {
  assert.ok(typeof deadline === 'number' && Number.isFinite(deadline), 'picker deadline invalid');
  const current = readProductPickerClock(now);
  assert.ok(current < deadline, 'picker deadline elapsed during final validation');
}

export function issueProductPickerExit({ snapshot, exit, exitCount }) {
  assert.equal(exitCount(), 0);
  const { raw, binding, previous, hostFrame, now, deadline } = snapshot();
  const dismissal = productPickerDismissal(raw, binding, previous, hostFrame);
  assert.equal(dismissal.supported, true, 'dismissal unproven');
  // Hashing/decoding can consume the remaining budget even without an await.
  assertProductPickerDeadline(now, deadline);
  exit(); // Only bounded key accounting follows admission, never more observation.
  return dismissal;
}

// A closed input alphabet: never hand a generic stdin to this mode.
export async function captureProductPicker(driver) {
  assert.equal(driver.selectionProfile, null);
  let initial, moved, dismissal;
  initial = await driver.observe();
  assert.equal(initial.supported, true, 'picker unproven');
  if (initial.supported) {
    await driver.moveDown(); // Exactly one diagnostic physical movement.
    moved = await driver.observe(initial);
    assert.equal(moved.supported, true, 'moved picker unproven');
  }
  const dismissalBaseline = await driver.dismiss(moved ?? initial);
  assert.equal(dismissalBaseline.supported, true);
  dismissal = await driver.observeDismissal(dismissalBaseline);
  assert.equal(dismissal.supported, true, 'dismissal unproven');
  return {
    mode: 'PRODUCT_PICKER_CAPTURE_ONLY',
    selectionProfile: null,
    qualification: 'UNQUALIFIED',
    initial,
    moved: moved ?? null,
    dismissal,
    dismissalBaseline,
    interval: moved ? productPickerInterval(initial, moved) : null,
    enter: 0,
  };
}

const rgb = (v) =>
  typeof v === 'string' &&
  /^(?:\d{1,3},){2}\d{1,3}$/.test(v) &&
  v.split(',').every((n) => +n <= 255);
const indexed = (v) =>
  typeof v === 'string' && /^index:(?:0|[1-9]\d{0,2})$/.test(v) && +v.slice(6) <= 255;
function validStyle(s, color) {
  return (
    s &&
    Object.keys(s).sort().join(',') === 'bg,bold,fg' &&
    typeof s.bold === 'boolean' &&
    ['fg', 'bg'].every((k) => color(s[k]))
  );
}
function selectedLabel(rows, profile) {
  const selected = [];
  const seen = new Set();
  for (const { label, cells, current } of rows) {
    assert.equal(typeof current, 'boolean', 'unknown row role');
    assert.equal(seen.has(label), false, 'duplicate label');
    seen.add(label);
    assert.equal(cells?.length, label.length, 'missing styled cells');
    const matches = (expected) =>
      cells.every(
        (s) =>
          validStyle(s, (v) => v === null || rgb(v) || indexed(v)) &&
          s.fg === expected.fg &&
          s.bg === expected.bg &&
          s.bold === expected.bold,
      );
    if (matches(profile.selected)) selected.push(label);
    else
      assert.ok(
        matches(profile.inactive[current ? 'current' : 'ordinary']),
        'unknown/ambiguous row style',
      );
  }
  assert.equal(selected.length, 1, 'missing/ambiguous live normal selection');
  return selected[0];
}

// Private offline fixture adapter. This is not product-profile qualification.
// confirmRenderedNavigation never supplies an offline context.
function fixtureHighlightedLabel(raw, labels, profile, binding) {
  assert.equal(profile?.scope, 'fixture-only');
  assert.equal(profile.renderer, 'normal');
  assert.deepEqual(profile.binding, binding, 'fixture binding mismatch');
  assert.deepEqual(
    Object.keys(binding).sort(),
    ['host', 'theme', 'geometry', 'generation', 'transcriptHash', 'bytes', 'frames'].sort(),
  );
  for (const key of ['host', 'theme'])
    assert.ok(typeof binding[key] === 'string' && binding[key].length > 0);
  assert.match(binding.transcriptHash, /^[a-f0-9]{64}$/);
  for (const key of ['generation', 'bytes', 'frames'])
    assert.ok(Number.isSafeInteger(binding[key]) && binding[key] > 0);
  assert.equal(typeof raw, 'string');
  assert.ok(Buffer.byteLength(raw) <= 1048576);
  assert.equal(Buffer.byteLength(raw), binding.bytes, 'fixture byte binding mismatch');
  assert.equal(
    createHash('sha256').update(raw).digest('hex'),
    binding.transcriptHash,
    'fixture prefix mismatch',
  );
  const { rows: height, columns: width } = binding.geometry;
  // The reused finite source decoder projects only this admitted geometry.
  assert.deepEqual(binding.geometry, { rows: 40, columns: 120 });
  const frame = compositionSourceFrame(raw);
  assert.equal(frame.supported, true);
  assert.equal(frame.generation, binding.generation, 'fixture generation mismatch');
  assert.equal(frame.frames, binding.frames, 'fixture update mismatch');
  assert.ok(Array.isArray(frame.styles));
  assert.equal(frame.text.includes('Open Proceed question?'), false, 'stale/overlapping dialog');
  const lines = frame.text.split('\n');
  assert.ok(lines.length <= height && lines.every((s) => s.length <= width));
  assert.ok(Array.isArray(labels) && labels.length >= 2 && labels.length <= height);
  assert.equal(new Set(labels).size, labels.length, 'duplicate label');
  assert.deepEqual(Object.keys(profile.inactive).sort(), ['current', 'ordinary']);
  const styles = [profile.selected, profile.inactive.current, profile.inactive.ordinary];
  assert.ok(styles.every((s) => validStyle(s, (v) => v === null || indexed(v))));
  for (const s of styles.slice(1)) {
    assert.notEqual(profile.selected.bg, null, 'default is not indexed selection');
    assert.notEqual(profile.selected.bg, s.bg, 'bold/current marker alone is insufficient');
  }
  let markers = 0;
  const rows = labels.map((label) => {
    assert.match(label, /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/);
    const occurrences = [];
    lines.forEach((line, row) => {
      for (let col = line.indexOf(label); col >= 0; col = line.indexOf(label, col + 1))
        occurrences.push({ row, col });
    });
    assert.equal(occurrences.length, 1, 'missing/duplicate label');
    const { row, col } = occurrences[0];
    const prefix = lines[row].slice(0, col);
    assert.match(prefix, /^ *(?:\u25cf +)?$/, 'unknown/ambiguous row role');
    assert.match(lines[row].slice(col + label.length), /^ *$/, 'overlapping label');
    const current = prefix.includes('\u25cf');
    if (current) markers++;
    return { label, cells: frame.styles[row]?.slice(col, col + label.length), current };
  });
  assert.equal(markers, 1, 'missing/ambiguous current role');
  assert.equal(
    [...frame.text].filter((c) => c === '\u25cf').length,
    markers,
    'unassociated current marker',
  );
  return selectedLabel(rows, profile);
}

const titleLabel = /^(?:Session )?title:\s*$/i;
const idLabel = /^(?:Exact )?(?:session )?ID:\s*$/i;
export function assertIdentityMessage(message, session) {
  assert.equal(typeof message, 'string');
  const lines = message.split('\n');
  assert.ok(
    lines.every((line) => /^[\x20-\x7e]*$/.test(line) && line.length <= 40),
    'inert explicit lines <=40 cells',
  );
  assert.ok(lines.includes('Navigation only - no decision'));
  assert.ok(lines.includes(session.ordinal), 'selected unique ordinal missing');
  const t = lines.findIndex((line) => titleLabel.test(line));
  const i = lines.findIndex((line) => idLabel.test(line));
  assert.equal(lines.filter((line) => titleLabel.test(line)).length, 1);
  assert.equal(lines.filter((line) => idLabel.test(line)).length, 1);
  assert.equal(lines.filter((line) => line === session.ordinal).length, 1);
  assert.ok(t >= 0 && i > t, 'separately labelled complete identity blocks missing');
  // Empty separators are layout, never identity data. Nonempty line content is
  // joined without trimming/normalization, so changed or omitted characters fail.
  const title = lines
    .slice(t + 1, i)
    .filter((line) => line !== '')
    .join('');
  const idLines = [];
  for (const line of lines.slice(i + 1)) {
    if (line === '') break;
    idLines.push(line);
  }
  assert.equal(title, session.title, 'complete title reconstruction');
  assert.equal(idLines.join(''), session.id, 'complete exact ID reconstruction');
  return lines.length;
}

export function highlightedOrdinal(frame, profile, { offlineFixture } = {}) {
  if (offlineFixture) {
    return fixtureHighlightedLabel(frame, offlineFixture.labels, profile, offlineFixture.binding);
  }
  assert.ok(frame && typeof frame.text === 'string' && Array.isArray(frame.styles));
  assert.ok(profile && profile.renderer === 'normal', 'unknown renderer/theme profile');
  // Preserve the legacy RGB boundary. Offline indexed/historical evidence is
  // intentionally not a new route to a live Enter, even with forged metadata.
  assert.deepEqual(Object.keys(profile).sort(), ['normal', 'renderer', 'selected']);
  assert.ok(validStyle(profile.selected, rgb) && validStyle(profile.normal, rgb));
  assert.notEqual(profile.selected.bg, profile.normal.bg, 'bold/focus alone is insufficient');
  const lines = frame.text.split('\n');
  assert.equal(lines.filter((s) => s.includes('Select the Proceed session')).length, 1);
  assert.equal(frame.text.includes('Open Proceed question?'), false, 'stale/overlapping dialog');
  const rows = [];
  const seen = new Set();
  for (let row = 0; row < lines.length; row++) {
    const match = /^\s*(Session \d+)\b/.exec(lines[row]);
    if (!match) continue; // Search focus/title styling is not a row selection.
    assert.equal(seen.has(match[1]), false, 'duplicate ordinal');
    seen.add(match[1]);
    const start = lines[row].indexOf(match[1]);
    const cells = frame.styles[row]?.slice(start, start + match[1].length);
    assert.equal(cells?.length, match[1].length, 'missing styled cells');
    rows.push({ label: match[1], cells, current: false });
  }
  return selectedLabel(rows, {
    selected: profile.selected,
    inactive: { ordinary: profile.normal },
  });
}

export function assertCurrentIdentityFrame(frame, session, { width, height }) {
  assert.ok(Number.isInteger(width) && Number.isInteger(height) && width >= 80 && height >= 24);
  const rows = frame.split('\n');
  assert.equal(
    rows.filter((r) => r.includes('Open Proceed question?')).length,
    1,
    'wrong/stale confirmation',
  );
  assert.equal(frame.includes('Select the Proceed session'), false, 'old picker still present');
  const start = rows.findIndex((r) => r.trim() === session.ordinal);
  const end = rows.findIndex(
    (r, n) => n > start && r.includes('Open question') && r.includes('Cancel'),
  );
  assert.ok(
    start >= 0 && end > start && end < height,
    'identity and both controls must share current screen',
  );
  const left = rows[start].indexOf(session.ordinal);
  // Screen padding is not identity. Refuse edge whitespace operands because this
  // adapter cannot distinguish their final spaces from terminal padding.
  assert.equal(session.title.trim(), session.title);
  assert.equal(session.id.trim(), session.id);
  const body = rows.slice(start, end).map((r) => r.slice(left).trimEnd());
  while (body.at(-1) === '') body.pop();
  const L = assertIdentityMessage(body.join('\n'), session);
  assert.ok(Math.ceil(height / 4) + L + 10 <= height - 1, 'complete body exceeds source budget');
}

// Each Enter gets a new observation immediately before writing, under the same
// interaction deadline. No resolved callback, current dot or accumulated text
// can stand in for the live frame. Adapters must derive frames from real PTY I/O.
export async function confirmRenderedNavigation(driver, session) {
  const picked = await driver.waitHighlightedSession(session);
  const current = await driver.currentNavigationFrame();
  assert.equal(current.frame, picked.frame, 'selection changed after observation');
  assert.equal(current.token, picked.token, 'stale picker observation');
  assert.deepEqual(current.geometry, picked.geometry, 'resized picker');
  assert.deepEqual(current.styledFrame, picked.styledFrame, 'selection style changed');
  assert.equal(current.styledFrame?.text, current.frame, 'text/style frame mismatch');
  const { width, height, resizeSequence } = current.geometry ?? {};
  assert.ok(Number.isInteger(width) && width >= 80 && width <= 300);
  assert.ok(Number.isInteger(height) && height >= 24 && height <= 100);
  assert.ok(Number.isSafeInteger(resizeSequence) && resizeSequence >= 0);
  assert.ok(current.frame.split('\n').length <= height);
  assert.ok(current.frame.split('\n').every((line) => line.length <= width));
  const ordinal = highlightedOrdinal(current.styledFrame, driver.selectionProfile);
  driver.stdin.write('\r');
  const expected = { ...session, ordinal };
  const shown = await driver.waitIdentityConfirmation(expected);
  const final = await driver.currentNavigationFrame();
  assert.equal(final.frame, shown.frame, 'confirmation replaced after observation');
  assert.equal(final.token, shown.token, 'stale confirmation observation');
  assert.deepEqual(final.geometry, shown.geometry, 'resized confirmation');
  assertCurrentIdentityFrame(final.frame, expected, final.geometry);
  driver.stdin.write('\r'); // Open question, NOT a domain decision.
}
