// TEST ONLY. Lexical inventory, never cell reconstruction or qualification.
import { createHash } from 'node:crypto';
import { openSync, readSync, fstatSync, closeSync, lstatSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  verifyRetainedProductCapture,
  productRetainedPaths,
} from './harness-composition-retention.mjs';
import { compositionSourceFrame } from './harness-composition-readiness.mjs';

const hash = (b) => createHash('sha256').update(b).digest('hex');
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const cpName = (n) => 'U+' + hex(n).padStart(4, '0');
const compare = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);
export const tokenLimits = Object.freeze({
  input: 30062,
  tokens: 16384,
  unique: 1024,
  output: 2097152,
});
export const inventoryRefusal = () => ({ complete: false, reason: 'INVENTORY_REFUSED' });
const modes = new Set([25, 1000, 1002, 1003, 1006, 1049, 2004, 2026, 2027, 2031]);

// Numeric cell operands are classes, not exported coordinates. Only the finite
// known mode/query/SGR vocabulary is retained, never arbitrary string payloads.
function csiIdentifier(body, final) {
  const match = /^([<=>?]?)([0-9;:]*)([ -/]*)$/.exec(body);
  if (!match) return 'CSI:OTHER:' + hex(final);
  const [, privateByte, params, intermediate] = match;
  if (intermediate.length > 4) return 'CSI:OTHER:' + hex(final);
  const values = params.split(';');
  const numeric = values.length <= 32 && values.every((v) => /^\d{1,4}$/.test(v));
  let detail = params === '' ? 'EMPTY' : 'PARAMETERS';
  if (numeric) {
    const ns = values.map(Number);
    if (privateByte === '?' && [104, 108].includes(final) && ns.every((n) => modes.has(n)))
      detail = ns.join(';');
    else if (!privateByte && final === 109 && ns.every((n) => n <= 255)) detail = ns.join(';');
    else if (
      [
        '>0q',
        '6n',
        '?u',
        'c',
        '14t',
        '?1016$p',
        '?1004$p',
        '?2004$p',
        '?2026$p',
        '?2027$p',
        '?2031$p',
        '>4;1m',
        '>4;0m',
        '>5u',
      ].includes(body + String.fromCharCode(final))
    )
      detail = ns.join(';');
  }
  return `CSI:${[...privateByte].map((c) => hex(c.charCodeAt(0))).join('') || 'NONE'}:${[...intermediate].map((c) => hex(c.charCodeAt(0))).join('') || 'NONE'}:${hex(final)}:${detail}`;
}

export function tokenInventory(bytes, limits = tokenLimits) {
  try {
    for (const k of Object.keys(tokenLimits))
      if (!Number.isSafeInteger(limits[k]) || limits[k] < 1 || limits[k] > tokenLimits[k]) throw 0;
    if (!Buffer.isBuffer(bytes) || bytes.length > limits.input) throw 0;
    const tokens = [],
      counts = new Map(),
      codepoints = new Map(),
      ascii = new Map();
    let i = 0,
      syncing = false,
      frames = 0,
      balanceErrors = 0,
      lastCompleteEnd = 0;
    const add = (start, kind, operation, framing = 'COMPLETE', scalars = 0) => {
      if (tokens.length >= limits.tokens) throw 0;
      const key = kind + '/' + operation + '/' + framing;
      if (!counts.has(key) && counts.size >= limits.unique) throw 0;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      tokens.push({ start, end: i, kind, operation, framing, scalars });
    };
    while (i < bytes.length) {
      const start = i,
        b = bytes[i++];
      if (b === 27) {
        if (i === bytes.length) {
          add(start, 'ESC', 'ESC', 'TRUNCATED');
          continue;
        }
        const next = bytes[i++];
        if (next === 91) {
          const paramStart = i;
          while (i < bytes.length && bytes[i] >= 48 && bytes[i] <= 63) i++;
          while (i < bytes.length && bytes[i] >= 32 && bytes[i] <= 47) i++;
          if (i === bytes.length) {
            add(start, 'CSI', 'CSI', 'TRUNCATED');
            continue;
          }
          if (bytes[i] < 64 || bytes[i] > 126) {
            add(start, 'CSI', 'CSI', 'MALFORMED');
            continue;
          }
          const final = bytes[i++],
            body = bytes.subarray(paramStart, i - 1).toString('ascii');
          if (body === '?2026' && [104, 108].includes(final)) {
            if (final === 104) {
              if (syncing) balanceErrors++;
              syncing = true;
            } else {
              if (!syncing) balanceErrors++;
              else {
                frames++;
                lastCompleteEnd = i;
              }
              syncing = false;
            }
          }
          add(start, 'CSI', csiIdentifier(body, final));
        } else if ([93, 80, 95, 94, 88].includes(next)) {
          const kind = { 93: 'OSC', 80: 'DCS', 95: 'APC', 94: 'PM', 88: 'SOS' }[next];
          const payloadStart = i;
          let framing = 'TRUNCATED',
            end = i;
          while (i < bytes.length) {
            if (next === 93 && bytes[i] === 7) {
              end = i++;
              framing = 'BEL';
              break;
            }
            if (bytes[i] === 27 && bytes[i + 1] === 92) {
              end = i;
              i += 2;
              framing = 'ST';
              break;
            }
            i++;
          }
          let operation = kind + ':OPAQUE';
          if (kind === 'OSC') {
            // Bounded header inspection, never retain or print the payload.
            const header = bytes
              .subarray(payloadStart, Math.min(end, payloadStart + 6))
              .toString('latin1');
            const m = /^(\d{1,4})(?:;|$)/.exec(header);
            if (m && [0, 4, 10, 11, 12, 22, 66, 99, 112, 1337, 7501].includes(+m[1])) {
              const p = payloadStart + m[0].length;
              operation =
                `OSC:${+m[1]}:` +
                (end === p ? 'EMPTY' : end === p + 1 && bytes[p] === 63 ? 'QUERY' : 'OPAQUE');
              if (+m[1] === 4 && end - p <= 5) {
                const query = /^(\d{1,3});\?$/.exec(bytes.subarray(p, end).toString('latin1'));
                if (query && +query[1] <= 255) operation = 'OSC:4:INDEX_QUERY';
              }
            }
          } else if (
            kind === 'DCS' &&
            end - payloadStart >= 2 &&
            bytes[payloadStart] === 43 &&
            bytes[payloadStart + 1] === 113
          )
            operation = 'DCS:2B:71:OPAQUE';
          else if (kind === 'APC' && end > payloadStart && bytes[payloadStart] === 71)
            operation = 'APC:47:OPAQUE';
          add(start, kind, operation, framing);
        } else {
          if (next < 32 || next > 126) {
            add(start, 'ESC', 'ESC', 'MALFORMED');
            continue;
          }
          while (next >= 32 && next <= 47 && i < bytes.length && bytes[i] >= 32 && bytes[i] <= 47)
            i++;
          if (next >= 32 && next <= 47) {
            if (i === bytes.length) {
              add(start, 'ESC', 'ESC', 'TRUNCATED');
              continue;
            }
            if (bytes[i] < 48 || bytes[i] > 126) {
              add(start, 'ESC', 'ESC', 'MALFORMED');
              continue;
            }
            i++;
          }
          add(
            start,
            'ESC',
            'ESC:' +
              (i - start <= 8 ? [...bytes.subarray(start + 1, i)].map(hex).join(':') : 'OTHER'),
          );
        }
      } else if (b < 32 || b === 127) add(start, 'CONTROL', cpName(b));
      else if (b < 127) {
        while (i < bytes.length && bytes[i] >= 32 && bytes[i] < 127) i++;
        for (let at = start; at < i; at++) {
          const cp = cpName(bytes[at]);
          ascii.set(cp, (ascii.get(cp) ?? 0) + 1);
        }
        add(start, 'TEXT', 'ASCII', 'COMPLETE', i - start);
      } else {
        const length =
          b >= 194 && b <= 223 ? 2 : b >= 224 && b <= 239 ? 3 : b >= 240 && b <= 244 ? 4 : 0;
        let cp;
        try {
          if (!length || start + length > bytes.length) throw 0;
          const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
            bytes.subarray(start, start + length),
          );
          cp = text.codePointAt(0);
        } catch {
          add(
            start,
            'UNKNOWN',
            'UTF8',
            length && start + length > bytes.length ? 'TRUNCATED' : 'INVALID',
          );
          continue;
        }
        i = start + length;
        const name = cpName(cp);
        if (!codepoints.has(name) && codepoints.size >= limits.unique) throw 0;
        codepoints.set(name, (codepoints.get(name) ?? 0) + 1);
        add(start, cp >= 128 && cp <= 159 ? 'CONTROL' : 'GLYPH', name, 'COMPLETE', 1);
      }
    }
    const framingComplete = tokens.every(
      (t) => !['TRUNCATED', 'MALFORMED', 'INVALID'].includes(t.framing),
    );
    let phase = 'STARTUP';
    for (const t of tokens) {
      if (t.operation === 'CSI:3F:NONE:68:2026') phase = 'UPDATE';
      t.phase =
        t.start >= lastCompleteEnd && lastCompleteEnd > 0 && phase !== 'UPDATE'
          ? 'TRAILING'
          : phase;
      if (t.operation === 'CSI:3F:NONE:6C:2026') phase = 'BETWEEN';
    }
    const result = {
      complete: true,
      reason: 'NONE',
      bytes: bytes.length,
      sha256: hash(bytes),
      framingComplete,
      updates: { frames, open: syncing, balanceErrors, lastCompleteEnd },
      operations: [...counts].sort(compare).map(([operation, count]) => ({ operation, count })),
      codepoints: [...codepoints].sort(compare).map(([codepoint, count]) => ({ codepoint, count })),
      asciiCodepoints: [...ascii].sort(compare).map(([codepoint, count]) => ({ codepoint, count })),
      stringPayloads: 'OPAQUE_NOT_DECODED',
      tokens,
      cellWidths: 'UNKNOWN',
      analysis: 'UNPROVEN',
      productProfile: null,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > limits.output) throw 0;
    return result;
  } catch {
    return inventoryRefusal();
  }
}

export function prefixInventory(bytes, binding, expectedHash) {
  try {
    const { initialBytes, movedBytes } = binding ?? {};
    if (!Buffer.isBuffer(bytes) || bytes.length > tokenLimits.input || hash(bytes) !== expectedHash)
      throw 0;
    if (
      ![initialBytes, movedBytes].every((n) => Number.isSafeInteger(n) && n > 0) ||
      initialBytes >= movedBytes ||
      movedBytes > bytes.length
    )
      throw 0;
    const full = tokenInventory(bytes);
    if (!full.complete) throw 0;
    const prefixes = [initialBytes, movedBytes].map((end) => {
      const inventory = tokenInventory(bytes.subarray(0, end));
      if (!inventory.complete) throw 0;
      return { end, tokenBoundary: full.tokens.some((t) => t.end === end), inventory };
    });
    const result = { complete: true, reason: 'NONE', full, prefixes };
    if (Buffer.byteLength(JSON.stringify(result)) > tokenLimits.output) throw 0;
    return result;
  } catch {
    return inventoryRefusal();
  }
}

// Single already-admitted capture only. No arbitrary run/path argument or I/O
// during import. Pins come from the active tasks' scan/transfer admission record.
const capture = '.scratch/harness-host/run-linux-itJBOr';
const pins = {
  'scan-pass.json': [2894, 'e4cdc30d131c3d7592ce7970cfbab368940f4671370018e253eeb210d3690a77'],
  'binding.json': [1296, '4f28dc0757844731ce37815a8953dd2c9b36169b30468a31c7a4bb78b391dbf2'],
  'observations.json': [344, 'a9e96f0cffb9fe3c1da0772e416d1a663da0c1d97de7072a46cc0390b5b17b68'],
  'fixture.jsonl': [12877, '88fc28ad2bb1dda665e4140d62d7acf0ae049296aa9e6abd38f08414e59ebb59'],
  'transcript.ansi': [30062, '103dbe6b23a006072b1415b8d5b0153f0709688ddc67c3733b8a7bb19090c323'],
};
function pinnedRead(name) {
  const [length, digest] = pins[name],
    path = resolve(capture, name);
  return boundedRead(path, length, digest);
}
function boundedRead(path, length, digest, root = capture) {
  for (const dir of ['.scratch', '.scratch/harness-host', root])
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw 0;
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== length) throw 0;
  if (root !== capture && before.nlink !== 1) throw 0;
  const fd = openSync(path, 'r');
  try {
    const stat = fstatSync(fd);
    if (stat.ino !== before.ino || stat.dev !== before.dev || stat.size !== length) throw 0;
    const b = Buffer.alloc(length + 1);
    let offset = 0;
    while (offset < b.length) {
      const n = readSync(fd, b, offset, b.length - offset, offset);
      if (!n) break;
      offset += n;
    }
    const after = fstatSync(fd),
      pathAfter = lstatSync(path);
    for (const s of [after, pathAfter])
      for (const k of ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs']) if (s[k] !== before[k]) throw 0;
    if (offset !== length || hash(b.subarray(0, length)) !== digest) throw 0;
    return b.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

// Lexical coverage is complete even when the cell decoder stops early. Group
// opaque controls without publishing their payloads or interpreting semantics.
export function completeLexicalSummary(bytes) {
  try {
    const inventory = tokenInventory(bytes);
    if (!inventory.complete) throw 0;
    const operations = new Map();
    const clusters = [];
    let runStart = null,
      runEnd = null;
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const finishRun = () => {
      if (runStart === null) return;
      const text = bytes.subarray(runStart, runEnd).toString('utf8');
      for (const { segment, index } of segmenter.segment(text)) {
        const cps = [...segment].map((c) => cpName(c.codePointAt(0)));
        if (cps.length > 1 && /[^\x20-\x7e]/u.test(segment))
          clusters.push({
            start: runStart + Buffer.byteLength(text.slice(0, index)),
            codepoints: cps,
          });
      }
      runStart = runEnd = null;
    };
    for (const t of inventory.tokens) {
      if (['TEXT', 'GLYPH'].includes(t.kind)) {
        runStart ??= t.start;
        runEnd = t.end;
      } else finishRun();
      if (t.kind === 'TEXT') continue;
      const key = `${t.kind}/${t.operation}/${t.framing}/${t.phase}`;
      if (!operations.has(key)) operations.set(key, []);
      operations.get(key).push(t.start);
    }
    finishRun();
    const prefixes = inventory.tokens
      .filter((t) => t.operation === 'CSI:3F:NONE:6C:2026')
      .map((t) => {
        const prefix = bytes.subarray(0, t.end);
        const result = compositionSourceFrame(prefix.toString('utf8'));
        return {
          bytes: t.end,
          sha256: hash(prefix),
          supported: result.supported,
          reason: result.reason ?? 'NONE',
          byteOffset: result.byteOffset ?? null,
        };
      });
    // Separate canonical control-policy audit. Remove ALL paint, not just the
    // first refused glyph. This cannot establish cells, widths or readiness.
    const controlTokens = inventory.tokens.filter((t) => !['TEXT', 'GLYPH'].includes(t.kind));
    const controlProjection = (end, excluded = new Set()) => {
      const selected = controlTokens.filter((t) => t.end <= end && !excluded.has(t.start));
      const projected = Buffer.concat(selected.map((t) => bytes.subarray(t.start, t.end)));
      const decoded = compositionSourceFrame(projected.toString('utf8'));
      let offset = 0,
        originalOffset = null;
      for (const t of selected) {
        if (offset === decoded.byteOffset) originalOffset = t.start;
        offset += t.end - t.start;
      }
      return {
        bytes: end,
        supported: decoded.supported,
        reason: decoded.reason ?? 'NONE',
        originalOffset,
      };
    };
    const excluded = new Set(),
      controlFailures = [];
    let terminalControlResult;
    for (let n = 0; n <= controlTokens.length; n++) {
      terminalControlResult = controlProjection(bytes.length, excluded);
      if (terminalControlResult.supported || terminalControlResult.originalOffset === null) break;
      const t = controlTokens.find((t) => t.start === terminalControlResult.originalOffset);
      if (!t || excluded.has(t.start)) throw 0;
      if (controlFailures.length >= tokenLimits.unique) throw 0;
      controlFailures.push({
        ...terminalControlResult,
        operation: t.operation,
        phase: t.phase,
        scope: excluded.size ? 'AFTER_RECORDED_EXCLUSIONS' : 'ORIGINAL_CONTROL_PROJECTION',
      });
      excluded.add(t.start);
    }
    const result = {
      complete: true,
      bytes: bytes.length,
      sha256: inventory.sha256,
      tokenCount: inventory.tokens.length,
      operationCount: inventory.operations.length,
      framingComplete: inventory.framingComplete,
      updates: inventory.updates,
      codepoints: inventory.codepoints,
      clusters,
      operations: [...operations]
        .sort(compare)
        .map(([operation, offsets]) => ({ operation, count: offsets.length, offsets })),
      prefixes,
      controlPolicy: {
        scope: 'CONTROL_ONLY_NOT_CELL_PROOF',
        prefixes: prefixes.map((p) => controlProjection(p.bytes)),
        full: controlProjection(bytes.length),
        failures: controlFailures,
        afterRecordedExclusions: terminalControlResult,
      },
      stringPayloads: 'OPAQUE_NOT_DECODED',
      semantics: 'UNPROVEN',
      productProfile: null,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > tokenLimits.output) throw 0;
    return result;
  } catch {
    return inventoryRefusal();
  }
}

export async function admittedProductInventory() {
  try {
    const root = '.scratch/harness-host/run-linux-xTk2c7';
    const expected = Object.fromEntries(
      [
        [
          'scan-pass.json',
          1027,
          '7cc40e2ce24ec09bab22540c32e1a5e222475f24869b9c17153b08d0e20e9a01',
        ],
        [
          'composition-observations.json',
          16740,
          'df333cf59977edcee5b5cd191ca19ebdc1b9397b9b9dfab4f91ab6c3b4985fb0',
        ],
        [
          'transcript.ansi',
          20542,
          '38624126391d3a664e56b43ba6220293f9d73e611df99c8124b311c4e216c893',
        ],
        [
          'plugin-diagnostics.log',
          29962,
          '8b20a66cd1df4f91eff564422b8eac60fea5bd514ad8e55963060f1b5a3c44ab',
        ],
        ['progress.jsonl', 265, 'aae5d40dd5d12920863ea8cd21910f0a91414d203a90d53a9ae5f10faefca8e3'],
      ].map(([name, bytes, sha256]) => [name, { bytes, sha256 }]),
    );
    const admitted = await verifyRetainedProductCapture({
      expected,
      read: async (path, length) => {
        const name = Object.keys(productRetainedPaths).find(
          (n) => productRetainedPaths[n] === path,
        );
        return boundedRead(resolve(root, path), length, expected[name].sha256, root);
      },
    });
    return completeLexicalSummary(admitted.get('transcript.ansi'));
  } catch {
    return inventoryRefusal();
  }
}
export function admittedCaptureInventory() {
  try {
    const scan = JSON.parse(pinnedRead('scan-pass.json'));
    if (
      scan.status !== 'PASS' ||
      scan.scope !== 'renderer-only' ||
      scan.productSixSurfaceGate !== 'NOT_APPLICABLE_NOT_PASSED'
    )
      throw 0;
    const data = {};
    for (const name of ['binding.json', 'observations.json', 'fixture.jsonl', 'transcript.ansi']) {
      const records = scan.files.filter((r) => r.path === '/run/proceed/evidence/' + name);
      if (
        records.length !== 1 ||
        records[0].bytes !== pins[name][0] ||
        records[0].sha256 !== pins[name][1]
      )
        throw 0;
      data[name] = pinnedRead(name);
    }
    const binding = JSON.parse(data['binding.json']),
      observations = JSON.parse(data['observations.json']);
    const fixture = data['fixture.jsonl']
      .toString('utf8')
      .trim()
      .split('\n')
      .map((s) => JSON.parse(s));
    if (
      binding.TERM !== 'xterm-256color' ||
      binding.COLORTERM !== 'ABSENT' ||
      binding.geometry.rows !== 40 ||
      binding.geometry.columns !== 120 ||
      observations.runtime.bun !== '1.4.4' ||
      observations.productProfile !== null
    )
      throw 0;
    if (!fixture.some((e) => e.themeMode === 'dark')) throw 0;
    return prefixInventory(
      data['transcript.ansi'],
      observations.diagnostic,
      pins['transcript.ansi'][1],
    );
  } catch {
    return inventoryRefusal();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--admitted-product-capture') {
    const result = await admittedProductInventory();
    console.log(JSON.stringify(result));
    if (!result.complete) process.exitCode = 1;
  } else {
    const result =
      process.argv.length === 3 && process.argv[2] === '--admitted-capture'
        ? admittedCaptureInventory()
        : inventoryRefusal();
    if (result.complete) {
      const serialized = JSON.stringify(result) + '\n';
      const output = resolve(capture, 'token-inventory-' + hash(serialized) + '.json');
      // Exclusive creation or exact bounded reuse, never overwrite an artifact.
      try {
        if (Buffer.byteLength(serialized) > tokenLimits.output) throw 0;
        try {
          writeFileSync(output, serialized, { flag: 'wx' });
        } catch (error) {
          if (error?.code !== 'EEXIST') throw 0;
          boundedRead(output, Buffer.byteLength(serialized), hash(serialized));
        }
        console.log(
          JSON.stringify({
            complete: true,
            bytes: Buffer.byteLength(serialized),
            sha256: hash(serialized),
            tokens: result.full.tokens.length,
            prefixes: result.prefixes.map((p) => ({
              end: p.end,
              sha256: p.inventory.sha256,
              tokenBoundary: p.tokenBoundary,
              updates: p.inventory.updates,
            })),
            operations: result.full.operations,
            codepoints: result.full.codepoints,
            updates: result.full.updates,
          }),
        );
      } catch {
        console.log(JSON.stringify(inventoryRefusal()));
        process.exitCode = 1;
      }
    } else {
      console.log(JSON.stringify(result));
      process.exitCode = 1;
    }
  }
}
