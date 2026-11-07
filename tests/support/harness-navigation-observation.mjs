// TEST ONLY. Public message assertions and fail-closed current-frame observation.
// Source: pinned 2.2.5 DialogSelectRow new-design active gutter is U+2503.
// Legacy background-only selection is deliberately not guessed by this text adapter.
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

export function highlightedOrdinal(frame) {
  assert.equal(typeof frame, 'string');
  assert.ok(frame.includes('Select the Proceed session'), 'wrong current picker');
  assert.equal(frame.includes('Open Proceed question?'), false, 'stale/overlapping dialog');
  const selected = frame.split('\n').flatMap((line) => {
    const match = /^\s*\u2503 +(?:[\u25aa\u25cf] +)?(Session \d+)\b/.exec(line);
    return match ? [match[1]] : [];
  });
  assert.equal(selected.length, 1, 'missing/ambiguous live active selection bar');
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
  const ordinal = highlightedOrdinal(current.frame);
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
