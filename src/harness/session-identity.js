// Session identity display for the local harness picker and confirmation (design
// section 3). Pure formatting and admission: no I/O, no host state, no
// authority. The values shown here are captured snapshot values, never a live
// highlight, foreground tab or reused pending slot.

export const IDENTITY_LINE_CELLS = 40;
export const MIN_DISPLAY_WIDTH = 80;
export const MIN_DISPLAY_HEIGHT = 24;

// A complete identity that cannot be placed in the bounded dialog is refused,
// never shortened. This cap already exceeds the line budget of the smallest
// admitted terminal, so it only rejects clearly oversized host text early.
const MAX_IDENTITY_CELLS = 400;
const PREVIEW_CELLS = 21;
const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

// Only established inert, lossless cell widths are admitted. Printable ASCII is
// the initial source-reasoned case; anything else (wide, combining, emoji,
// control, bidi, lone surrogate, empty) could render differently from the exact
// captured value, so it refuses instead of being sanitized into another identity.
export function identityDisplayProblem(value) {
  if (typeof value !== 'string' || value === '') return 'MISSING';
  if (value.length > MAX_IDENTITY_CELLS) return 'OVERSIZED';
  if (!PRINTABLE_ASCII.test(value)) return 'UNSUPPORTED_TEXT';
  return null;
}

// Explicit lines of at most 40 cells. A split is a visual line break: the lines
// concatenate back to the exact value, so no character is dropped, added or
// normalized.
export function identityLines(value) {
  const lines = [];
  for (let index = 0; index < value.length; index += IDENTITY_LINE_CELLS) {
    lines.push(value.slice(index, index + IDENTITY_LINE_CELLS));
  }
  return lines;
}

// Short, clearly partial picker preview. The exact ID is deliberately not
// concatenated into this row and no complete identity is claimed here.
export function identityPreview(value) {
  if (identityDisplayProblem(value) !== null) return 'title preview unavailable';
  if (value.length <= PREVIEW_CELLS + 3) return value;
  return `${value.slice(0, PREVIEW_CELLS)}...`;
}

// Complete identity body for the mandatory confirmation. The ordinal identifies
// the selected row, the two blocks carry the complete title and the exact opaque
// ID, and the fixed notice states that navigation grants no decision.
export function confirmationMessage({ ordinal, title, id }) {
  const lines = [
    ordinal,
    'Session title:',
    ...identityLines(title),
    'Exact session ID:',
    ...identityLines(id),
    '',
    'Navigation only - no decision',
  ];
  return { message: lines.join('\n'), lineCount: lines.length };
}

// Unknown geometry refuses: only integer public dimensions are usable.
export function displayGeometry(renderer) {
  const width = renderer?.width;
  const height = renderer?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  return { width, height };
}

// Conservative budget for the default medium dialog: the quarter-screen top
// offset, header, footer and gaps in both pinned layout variants, and one bottom
// safety row. `lineCount` is the complete preformatted message length. No
// scrolling or automatic wrapping is assumed.
export function geometryAdmits({ width, height }, lineCount) {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width < MIN_DISPLAY_WIDTH || height < MIN_DISPLAY_HEIGHT) return false;
  if (!Number.isInteger(lineCount) || lineCount < 1) return false;
  return Math.ceil(height / 4) + lineCount + 10 <= height - 1;
}
