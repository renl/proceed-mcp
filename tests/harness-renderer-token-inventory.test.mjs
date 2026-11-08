import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  tokenInventory,
  prefixInventory,
  tokenLimits,
  inventoryRefusal,
  completeLexicalSummary,
} from './support/harness-renderer-token-inventory.mjs';

const bytes = (s) => Buffer.from(s);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const operations = (r) => r.tokens.map((t) => t.operation);

test('complete lexical summary continues beyond decoder refusal and retains later phases and clusters without payloads', () => {
  const raw = bytes(
    '\x1b[?1049h\x1b[?2026h\x1b[H\u2299\x1b[?2026l\x1b[?2027h\x1b[?2026hA\u0301\u203a\ufe0f\x1b]99;PRIVATE_SECRET\x1b\\\x1b[?2026l\x1b[?1049l',
  );
  const r = completeLexicalSummary(raw);
  assert.equal(r.complete, true);
  assert.equal(r.bytes, raw.length);
  assert.equal(r.sha256, hash(raw));
  assert.equal(r.updates.frames, 2);
  assert.equal(r.prefixes.length, 2);
  assert.ok(r.prefixes.every((p) => p.reason === 'UNSUPPORTED_GLYPH'));
  assert.ok(r.operations.some((o) => o.operation === 'CSI/CSI:3F:NONE:68:2027/COMPLETE/BETWEEN'));
  assert.ok(r.operations.some((o) => o.operation === 'CSI/CSI:3F:NONE:6C:1049/COMPLETE/TRAILING'));
  assert.deepEqual(
    r.clusters.map((c) => c.codepoints),
    [
      ['U+0041', 'U+0301'],
      ['U+203A', 'U+FE0F'],
    ],
  );
  assert.equal(r.semantics, 'UNPROVEN');
  assert.equal(r.productProfile, null);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|\x1b/);
  assert.equal(r.controlPolicy.scope, 'CONTROL_ONLY_NOT_CELL_PROOF');
  assert.equal(r.controlPolicy.prefixes[0].supported, true);
  assert.equal(r.controlPolicy.prefixes[1].reason, 'UNSAFE_UNICODE_PHASE');
  const opaque = completeLexicalSummary(
    bytes('\x1b[?1049h\x1b[?2026h\x1b[H\u2299\x1b]99;PRIVATE_SECRET\x1b\\\x1b[?2026l'),
  );
  assert.equal(opaque.controlPolicy.full.reason, 'UNSUPPORTED_OSC_PAYLOAD');
  assert.equal(opaque.controlPolicy.full.originalOffset, 22);
  const multiple = completeLexicalSummary(
    bytes('\x1b[?1049h\x1b[?2026h\x1b]99;PRIVATE_SECRET\x1b\\\x1b[999z\x1b[?2026l'),
  );
  assert.deepEqual(
    multiple.controlPolicy.failures.map((f) => f.reason),
    ['UNSUPPORTED_OSC_PAYLOAD', 'UNSUPPORTED_CONTROL'],
  );
  assert.deepEqual(
    multiple.controlPolicy.failures.map((f) => f.scope),
    ['ORIGINAL_CONTROL_PROJECTION', 'AFTER_RECORDED_EXCLUSIONS'],
  );
  assert.equal(multiple.controlPolicy.full.supported, false);
  assert.equal(multiple.controlPolicy.afterRecordedExclusions.supported, true);
  assert.doesNotMatch(JSON.stringify(multiple), /PRIVATE_SECRET|\x1b/);
  const trailing = completeLexicalSummary(bytes('\u2299\x1b]99;PRIVATE_SECRET'));
  assert.equal(trailing.complete, true);
  assert.equal(trailing.framingComplete, false);
  assert.ok(trailing.operations.some((o) => o.operation.includes('TRUNCATED')));
  assert.deepEqual(completeLexicalSummary(Buffer.alloc(tokenLimits.input + 1)), inventoryRefusal());
});

test('lexical inventory covers every byte without exporting text or string payloads', () => {
  const raw = bytes(
    '\x1b[?2031h\x1b]11;?\x07\x1bP+qPRIVATE_SECRET\x1b\\\x1b_GPRIVATE_SECRET\x1b\\\x1b(B\r\nPRIVATE_SECRET\u25cf',
  );
  const r = tokenInventory(raw);
  assert.equal(r.complete, true);
  assert.equal(r.framingComplete, true);
  assert.equal(r.sha256, hash(raw));
  let end = 0;
  for (const t of r.tokens) {
    assert.equal(t.start, end);
    assert.ok(t.end > t.start);
    end = t.end;
  }
  assert.equal(end, raw.length);
  assert.deepEqual(
    r.tokens.map((t) => t.kind),
    ['CSI', 'OSC', 'DCS', 'APC', 'ESC', 'CONTROL', 'CONTROL', 'TEXT', 'GLYPH'],
  );
  assert.ok(operations(r).includes('CSI:3F:NONE:68:2031'));
  assert.deepEqual(r.codepoints, [{ codepoint: 'U+25CF', count: 1 }]);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SECRET|\x1b/);
  assert.equal(r.analysis, 'UNPROVEN');
  assert.equal(r.productProfile, null);
  assert.equal(r.cellWidths, 'UNKNOWN');
  const special = tokenInventory(bytes('\ufeff\ufffd\u0085'));
  assert.deepEqual(special.codepoints, [
    { codepoint: 'U+0085', count: 1 },
    { codepoint: 'U+FEFF', count: 1 },
    { codepoint: 'U+FFFD', count: 1 },
  ]);
  assert.deepEqual(
    special.tokens.map((t) => t.kind),
    ['GLYPH', 'GLYPH', 'CONTROL'],
  );
});

test('OSC has bounded known identifiers, payload classes and BEL/ST framing', () => {
  for (const id of [4, 10, 11, 66, 99, 1337, 7501]) {
    for (const ending of ['\x07', '\x1b\\']) {
      const r = tokenInventory(bytes(`\x1b]${id};?${ending}`));
      assert.equal(r.tokens[0].operation, `OSC:${id}:QUERY`);
      assert.equal(r.tokens[0].framing, ending === '\x07' ? 'BEL' : 'ST');
    }
  }
  const opaque = tokenInventory(bytes('\x1b]9999;PRIVATE_SECRET\x07\x1b]66;PRIVATE_SECRET\x1b\\'));
  assert.deepEqual(operations(opaque), ['OSC:OPAQUE', 'OSC:66:OPAQUE']);
  assert.doesNotMatch(JSON.stringify(opaque), /PRIVATE_SECRET|9999/);
  assert.equal(tokenInventory(bytes('\x1b]4;255;?\x07')).tokens[0].operation, 'OSC:4:INDEX_QUERY');
  assert.equal(tokenInventory(bytes('\x1b]4;256;?\x07')).tokens[0].operation, 'OSC:4:OPAQUE');
  assert.equal(tokenInventory(bytes('\x1b]112\x07')).tokens[0].operation, 'OSC:112:EMPTY');
  const high = tokenInventory(Buffer.from([27, 93, 0xb1, 0xb1, 59, 63, 7]));
  assert.equal(high.tokens[0].operation, 'OSC:OPAQUE');
});

test('CSI parameters retain only finite SGR/mode/query vocabulary, not coordinates', () => {
  const r = tokenInventory(
    bytes('\x1b[16;35H\x1b[38;5;232;48;5;216;1m\x1b[?9999h\x1b[>4;1m\x1b[?2026$p'),
  );
  assert.deepEqual(operations(r), [
    'CSI:NONE:NONE:48:PARAMETERS',
    'CSI:NONE:NONE:6D:38;5;232;48;5;216;1',
    'CSI:3F:NONE:68:PARAMETERS',
    'CSI:3E:NONE:6D:4;1',
    'CSI:3F:24:70:2026',
  ]);
  assert.doesNotMatch(JSON.stringify(r), /16;35|9999/);
  // A parameter longer than the input limit refuses, not unbounded retention.
  assert.deepEqual(
    tokenInventory(bytes('\x1b[' + '1'.repeat(tokenLimits.input) + 'm')),
    inventoryRefusal(),
  );
});

test('all splits preserve concatenated bytes, split prefixes explicitly report truncation', () => {
  const sequences = [
    '\x1b[38;5;216m',
    '\x1b]11;?\x1b\\',
    '\x1bP+qopaque\x1b\\',
    '\x1b(B',
    '\u25cf',
    '\u{1F600}',
  ];
  for (const s of sequences) {
    const b = bytes(s),
      expected = tokenInventory(b);
    for (let i = 1; i < b.length; i++) {
      assert.deepEqual(tokenInventory(Buffer.concat([b.subarray(0, i), b.subarray(i)])), expected);
      assert.equal(tokenInventory(b.subarray(0, i)).framingComplete, false);
    }
  }
});

test('truncated, malformed, invalid UTF-8 and unknown glyphs are never silently dropped', () => {
  for (const s of ['\x1b', '\x1b[?20', '\x1b]11;?', '\x1bP+q', '\x1b(', '\x1b_opaque']) {
    const r = tokenInventory(bytes(s));
    assert.equal(r.complete, true);
    assert.equal(r.framingComplete, false);
    assert.equal(r.tokens.at(-1).framing, 'TRUNCATED');
    assert.equal(r.tokens.at(-1).end, bytes(s).length);
  }
  for (const b of [
    Buffer.from([0xff]),
    Buffer.from([0xc0, 0xaf]),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from([0xf4, 0x90, 0x80, 0x80]),
    Buffer.from([0xe2, 0x97]),
  ]) {
    const r = tokenInventory(b);
    assert.equal(r.framingComplete, false);
    assert.equal(r.tokens[0].kind, 'UNKNOWN');
    assert.equal(r.tokens.at(-1).end, b.length);
  }
  const r = tokenInventory(bytes('\x1b[\x00\u0301\ufe0f\u{1F600}'));
  assert.equal(r.tokens[0].framing, 'MALFORMED');
  assert.equal(r.tokens[1].kind, 'CONTROL');
  assert.deepEqual(
    r.codepoints.map((x) => x.codepoint),
    ['U+0301', 'U+1F600', 'U+FE0F'],
  );
  assert.equal(r.cellWidths, 'UNKNOWN');
});

test('update balance is token based, never counted from an opaque payload', () => {
  const r = tokenInventory(bytes('\x1b]66;\x1b[?2026h\x07\x1b[?2026hX\x1b[?2026l'));
  assert.deepEqual(r.updates, {
    frames: 1,
    open: false,
    balanceErrors: 0,
    lastCompleteEnd: r.bytes,
  });
  assert.equal(tokenInventory(bytes('\x1b[?2026h')).updates.open, true);
  assert.equal(tokenInventory(bytes('\x1b[?2026h\x1b[?2026h\x1b[?2026l')).updates.balanceErrors, 1);
  assert.equal(tokenInventory(bytes('\x1b[?2026l')).updates.balanceErrors, 1);
});

test('input/token/unique/output bounds refuse with the same closed result', () => {
  assert.equal(
    tokenInventory(bytes('\r\n'), { ...tokenLimits, tokens: 2, unique: 2 }).complete,
    true,
  );
  for (const [b, limits] of [
    [bytes('xx'), { ...tokenLimits, input: 1 }],
    [bytes('\r\n'), { ...tokenLimits, tokens: 1 }],
    [bytes('\r\n'), { ...tokenLimits, unique: 1 }],
    [bytes('x'), { ...tokenLimits, output: 1 }],
    [bytes('x'), { ...tokenLimits, input: Infinity }],
    [bytes('x'), { ...tokenLimits, input: tokenLimits.input + 1 }],
  ])
    assert.deepEqual(tokenInventory(b, limits), inventoryRefusal());
  const raw = bytes('x'),
    r = tokenInventory(raw);
  const size = Buffer.byteLength(JSON.stringify(r));
  assert.deepEqual(tokenInventory(raw, { ...tokenLimits, output: size }), r);
  assert.deepEqual(tokenInventory(raw, { ...tokenLimits, output: size - 1 }), inventoryRefusal());
  assert.equal(tokenInventory(Buffer.alloc(tokenLimits.input, 32)).bytes, tokenLimits.input);
  assert.deepEqual(tokenInventory(Buffer.alloc(tokenLimits.input + 1, 32)), inventoryRefusal());
});

test('phase annotations preserve startup, whole updates, intervening and trailing bytes', () => {
  const raw = bytes('\x1b[?2031h\x1b[?2026hX\x1b[?2026lY\x1b[?2026hZ\x1b[?2026lQ');
  assert.deepEqual(
    tokenInventory(raw).tokens.map((t) => t.phase),
    ['STARTUP', 'UPDATE', 'UPDATE', 'UPDATE', 'BETWEEN', 'UPDATE', 'UPDATE', 'UPDATE', 'TRAILING'],
  );
  const ascii = tokenInventory(bytes('XXY'));
  assert.deepEqual(ascii.asciiCodepoints, [
    { codepoint: 'U+0058', count: 2 },
    { codepoint: 'U+0059', count: 1 },
  ]);
  assert.equal(tokenInventory(bytes('\x1b\x07')).tokens[0].framing, 'MALFORMED');
});

test('exact full hash binds monotonic byte prefixes, split tokens and UTF-8 boundaries', () => {
  const raw = bytes('A\x1b[?2026h\u25cf\x1b[?2026lZ');
  const r = prefixInventory(raw, { initialBytes: 4, movedBytes: raw.length - 1 }, hash(raw));
  assert.equal(r.complete, true);
  assert.equal(r.prefixes[0].tokenBoundary, false);
  assert.equal(r.prefixes[0].inventory.framingComplete, false);
  assert.equal(r.prefixes[1].tokenBoundary, true);
  assert.equal(r.prefixes[1].inventory.updates.frames, 1);
  for (const p of r.prefixes) assert.equal(p.inventory.sha256, hash(raw.subarray(0, p.end)));
  for (const binding of [
    { initialBytes: 0, movedBytes: 2 },
    { initialBytes: 2, movedBytes: 2 },
    { initialBytes: 3, movedBytes: 2 },
    { initialBytes: 1, movedBytes: raw.length + 1 },
    { initialBytes: 1.5, movedBytes: 3 },
  ])
    assert.deepEqual(prefixInventory(raw, binding, hash(raw)), inventoryRefusal());
  assert.deepEqual(
    prefixInventory(raw, { initialBytes: 1, movedBytes: 2 }, '0'.repeat(64)),
    inventoryRefusal(),
  );
  assert.deepEqual(prefixInventory(raw, null, hash(raw)), inventoryRefusal());
  const many = Buffer.alloc(10000, 10);
  assert.equal(tokenInventory(many).complete, true);
  assert.deepEqual(
    prefixInventory(many, { initialBytes: 9998, movedBytes: 9999 }, hash(many)),
    inventoryRefusal(),
  );
  const utf8 = bytes('A\u25cfZ');
  const split = prefixInventory(utf8, { initialBytes: 2, movedBytes: 4 }, hash(utf8));
  assert.equal(split.prefixes[0].inventory.tokens.at(-1).framing, 'TRUNCATED');
  assert.equal(split.prefixes[1].inventory.framingComplete, true);
});
