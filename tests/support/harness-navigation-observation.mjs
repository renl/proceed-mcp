// TEST ONLY. Public message assertions and fail-closed current-frame observation.
// Pinned 2.2.5 DialogSelectRow normal selection is styled, not a current dot.
// A source-verified theme profile is mandatory. Synthetic profiles prove only
// observer logic, never actual host rendering or active theme identity.
import assert from 'node:assert/strict';

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

export function highlightedOrdinal(frame, profile) {
  assert.ok(frame && typeof frame.text === 'string' && Array.isArray(frame.styles));
  assert.ok(profile && profile.renderer === 'normal', 'unknown renderer/theme profile');
  const valid = (s) =>
    s &&
    typeof s.bold === 'boolean' &&
    ['fg', 'bg'].every(
      (k) =>
        typeof s[k] === 'string' &&
        /^(?:\d{1,3},){2}\d{1,3}$/.test(s[k]) &&
        s[k].split(',').every((v) => +v <= 255),
    );
  assert.ok(valid(profile.selected) && valid(profile.normal));
  assert.notEqual(profile.selected.bg, profile.normal.bg, 'bold/focus alone is insufficient');
  const lines = frame.text.split('\n');
  assert.equal(lines.filter((s) => s.includes('Select the Proceed session')).length, 1);
  assert.equal(frame.text.includes('Open Proceed question?'), false, 'stale/overlapping dialog');
  const selected = [];
  const seen = new Set();
  for (let row = 0; row < lines.length; row++) {
    const match = /^\s*(Session \d+)\b/.exec(lines[row]);
    if (!match) continue; // Search focus/title styling is not a row selection.
    assert.equal(seen.has(match[1]), false, 'duplicate ordinal');
    seen.add(match[1]);
    const start = lines[row].indexOf(match[1]);
    const cells = frame.styles[row]?.slice(start, start + match[1].length);
    assert.equal(cells?.length, match[1].length, 'missing styled cells');
    const matches = (expected) =>
      cells.every(
        (s) => s && s.fg === expected.fg && s.bg === expected.bg && s.bold === expected.bold,
      );
    if (matches(profile.selected)) selected.push(match[1]);
    else assert.ok(matches(profile.normal), 'unknown/ambiguous row style');
  }
  assert.equal(selected.length, 1, 'missing/ambiguous live normal selection');
  return selected[0];
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
