// TEST ONLY. Render evidence, not process-alive or fixture-callback readiness.
export const productReadyText = 'Proceed harness ready for qualification (owner shared).';
// Opt-in offline source-layout observer, not a terminal emulator or RGB profile.
// OpenTUI 738067f47e940dcec3f5aab74868908574335c6c, native/src/ansi.zig
// and terminal.zig queryTerminalSend. Phase restrictions here are decoder policy,
// not a claim about cross-function emitter ordering. No opaque string is ignored.
export function compositionSourceFrame(ansi) {
  const refuse = (reason, byteOffset = 0, operation = null) => ({
    supported: false,
    reason,
    byteOffset,
    operation,
  });
  if (typeof ansi !== 'string' || new TextEncoder().encode(ansi).length > 1048576)
    return refuse('CAPTURE_LIMIT');
  const tokens =
    ansi.match(
      /\x1b[P_](?:[^\x1b]|\x1b(?!\\))*\x1b\\|\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]/gu,
    ) ?? [];
  if (tokens.join('') !== ansi) return refuse('INCOMPLETE_ESCAPE');
  const lastCompleteUpdate = tokens.lastIndexOf('\x1b[?2026l');
  // Exact query constants. In particular APC is only a=q, never transmit/delete.
  const queries = new Set([
    '\x1bP+q4d73\x1b\\',
    '\x1b_Gi=31337,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\',
    '\x1b]99;i=opentui-notifications:p=?;\x1b\\',
    '\x1b]1337;Capabilities\x1b\\',
    '\x1b]7501;?\x1b\\',
    '\x1b]10;?\x07',
    '\x1b]11;?\x07',
    '\x1b[>0q',
    '\x1b[6n',
    '\x1b[?u',
    '\x1b[c',
    '\x1b[14t',
    ...[1004, 1016, 2004, 2026, 2027, 2031].map((n) => `\x1b[?${n}$p`),
  ]);
  let rows = [],
    styles = [],
    row = null,
    col = null,
    saved,
    style = { fg: null, bg: null, bold: false },
    syncing = false,
    frames = 0,
    generation = 0,
    discardedFrameGeneration = null,
    alt = false,
    tainted = false,
    frame = null,
    offset = 0;
  const reset = () => {
    rows = [];
    styles = [];
    frame = null;
    tainted = false;
    generation++;
  };
  for (const [index, token] of tokens.entries()) {
    const start = offset;
    offset += new TextEncoder().encode(token).length;
    const bad = (reason, operation = null) => refuse(reason, start, operation);
    if (token === '\x1b[?2026h') {
      if (syncing) return bad('NESTED_UPDATE');
      syncing = true;
      continue;
    }
    if (token === '\x1b[?2026l') {
      if (!syncing) return bad('UNMATCHED_UPDATE');
      if (tainted) return bad('UNRESYNCHRONIZED_PAINT');
      syncing = false;
      frames++;
      frame = {
        text: rows.map((r) => r.join('')).join('\n'),
        styles: styles.map((r) => r.slice()),
        generation,
        frames,
        cursor: { row, col },
      };
      continue;
    }
    if (queries.has(token)) {
      // Queries may recur between frames. Do not allow new probes inside paint.
      if (syncing) return bad('UNSAFE_QUERY_PHASE');
      continue;
    }
    if (token === '\x1b]66;w=1; \x1b\\' || token === '\x1b]66;s=2; \x1b\\') {
      // A probe may paint background spaces and move the cursor. Its endpoint
      // depends on terminal support. Only a full clear/new generation recovers.
      if (syncing || frames || alt) return bad('UNSAFE_PROBE_PHASE', 66);
      tainted = true;
      frame = null;
      row = col = null;
      continue;
    }
    if (token.startsWith('\x1b]')) {
      const op = /^\x1b\](\d+)/.exec(token)?.[1];
      if (token === '\x1b]12;default\x07') {
        // ansi.zig:309 resetCursorColorFallback at the pinned SHA. Distinct
        // from OSC12 RGB assignment (:298) and OSC112 reset (:308).
        // Observed AFTER alternate-screen discard, not before it. Restrict to
        // trailing/outside-update, after the last completed update and discard.
        // This is observer policy, not an emitter-order guarantee. No cell,
        // coordinate, save register, generation or current frame is restored.
        if (
          syncing ||
          alt ||
          discardedFrameGeneration !== generation ||
          !frames ||
          index <= lastCompleteUpdate
        )
          return bad('UNSAFE_CURSOR_RESET_PHASE', 12);
        continue;
      }
      // session.zig:1163-1176 at the pin above emits non-cell program metadata.
      // Admit only the complete source-conformant variant verified in the bound
      // prefix. This is not a general status parser or permissive base64 decoder.
      if (token === '\x1b]7501;state=idle:app=opencode\x1b\\') {
        // Placement is narrow observer policy, not global source call ordering.
        if (!alt || syncing || frames) return bad('UNSAFE_PROGRAM_STATUS_PHASE', 7501);
        continue;
      }
      if (/^\x1b\]4;(?:\d{1,3};\?)(?:;\d{1,3};\?)*\x07$/.test(token)) {
        const indices = token
          .slice(4, -1)
          .split(';')
          .filter((_, i) => i % 2 === 0);
        if (syncing || indices.some((n) => +n > 255)) return bad('UNSAFE_PALETTE_QUERY', 4);
        continue;
      }
      // Finite source-defined cursor/pointer/title forms, not terminal palette.
      if (
        /^\x1b\]12;#[0-9a-fA-F]{6}\x07$/.test(token) ||
        token === '\x1b]112\x07' ||
        token === '\x1b]22;default\x1b\\' ||
        token === '\x1b]22;\x1b\\' ||
        /^\x1b\]0;[\x20-\x7e]{0,256}\x07$/.test(token)
      )
        continue;
      return bad('UNSUPPORTED_OSC_PAYLOAD', op && +op <= 9999 ? +op : null);
    }
    if (token.startsWith('\x1bP') || token.startsWith('\x1b_'))
      return bad('UNSUPPORTED_STRING_PAYLOAD');
    if (token === '\x1b[?1049h' || token === '\x1b[?1049l') {
      if (syncing || alt === token.endsWith('h')) return bad('UNSAFE_GENERATION');
      const discardingFrame = alt && frame?.generation === generation;
      alt = token.endsWith('h');
      reset();
      discardedFrameGeneration = discardingFrame ? generation : null;
      saved = undefined;
      // Entering the cleared alternate screen starts at home. Exit discards it.
      row = alt ? 0 : null;
      col = alt ? 0 : null;
      continue;
    }
    if (token === '\x1b[2J') {
      reset();
      continue;
    }
    if (token === '\x1b[s') {
      // CSI s/u stores coordinates, not a stack. A later un-restored save is
      // meaningful and valid. Unknown initial coordinates remain unknown.
      saved = { row, col, generation };
      continue;
    }
    if (token === '\x1b[u') {
      if (!saved || saved.generation !== generation) return bad('UNMATCHED_RESTORE');
      ({ row, col } = saved);
      continue;
    }
    const position = /^\x1b\[(\d*);?(\d*)H$/.exec(token);
    if (position) {
      row = +(position[1] || 1) - 1;
      col = +(position[2] || 1) - 1;
      if (row < 0 || row >= 40 || col < 0 || col >= 120) return bad('GEOMETRY');
      if (!syncing) frame = null;
      continue;
    }
    if (/^\x1b\[\?25[hl]$/.test(token) || /^\x1b\[[0-6] q$/.test(token)) continue;
    if (
      /^\x1b\[\?(?:1000|1002|1003|1006|2004|2031)[hl]$/.test(token) ||
      ['\x1b[>4;1m', '\x1b[>4;0m', '\x1b[>5u', '\x1b[<u'].includes(token)
    ) {
      if (syncing) return bad('UNSAFE_INPUT_PHASE');
      continue;
    }
    if (token === '\x1b[?2027h') {
      // Only the ten lone scalars below are modeled under all width methods.
      if (syncing || frames) return bad('UNSAFE_UNICODE_PHASE');
      continue;
    }
    if (/^\x1b\[[0-9;]*m$/.test(token)) {
      if (token !== '\x1b[m' && token.slice(2, -1).split(';').includes(''))
        return bad('UNSUPPORTED_SGR');
      const codes = token
        .slice(2, -1)
        .split(';')
        .map((v) => Number(v || 0));
      for (let i = 0; i < codes.length; i++) {
        const n = codes[i],
          key = n === 38 ? 'fg' : 'bg';
        if (n === 0) style = { fg: null, bg: null, bold: false };
        else if (n === 1 || n === 22) style = { ...style, bold: n === 1 };
        else if (n === 39 || n === 49) style = { ...style, [n === 39 ? 'fg' : 'bg']: null };
        else if ((n === 38 || n === 48) && codes[i + 1] === 5) {
          const index = codes[i + 2];
          if (!Number.isInteger(index) || index < 0 || index > 255) return bad('UNSUPPORTED_SGR');
          style = { ...style, [key]: `index:${index}` };
          i += 2;
        } else if ((n === 38 || n === 48) && codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5);
          if (rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
            return bad('UNSUPPORTED_SGR');
          style = { ...style, [key]: rgb.join(',') };
          i += 4;
        } else return bad('UNSUPPORTED_SGR');
      }
      continue;
    }
    if (token.startsWith('\x1b')) return bad('UNSUPPORTED_CONTROL');
    // Source map ranges and exhaustive utf8_test:2047-2063 at the pinned SHA.
    // No cluster, combining/variation selector, C1 or unknown scalar is skipped.
    // U+203A: tests/unicode-width-map.zon:13 (202F..205F), width 1.
    // U+2299: tests/unicode-width-map.zon:16 (2190..2319), width 1.
    // tests/utf8_test.zig:2047-2063 checks every scalar in every WidthMethod.
    // utf8.zig charWidth/eawToWidth and GraphemeWidthState do not license
    // clusters here. VS16/ZWJ/combining scalars still refuse the whole prefix.
    if (!/^[\x20-\x7e\u00b7\u2026\u203a\u2299\u2503\u2579\u2580\u2584\u2588\u25cf]$/.test(token))
      return bad('UNSUPPORTED_GLYPH');
    if (tainted || row === null || col === null) return bad('UNKNOWN_PAINT_POSITION');
    if (!syncing) return bad('UNSYNCHRONIZED_PAINT');
    if (row >= 40 || col >= 120) return bad('GEOMETRY');
    rows[row] ??= [];
    styles[row] ??= [];
    while (rows[row].length < col) rows[row].push(' ');
    rows[row][col] = token;
    styles[row][col] = Object.freeze({ ...style });
    col++;
  }
  if (syncing) return refuse('INCOMPLETE_UPDATE', offset);
  if (!frame) return refuse('NO_CURRENT_FRAME', offset);
  return { supported: true, ...frame };
}

// Small, fail-closed projection of the pinned host's synchronized cell updates.
// Only completed frames count. Repainting cells replaces old text, never appends it.
export function compositionCurrentFrame(ansi, { styled = false, sourceMarkerCells = false } = {}) {
  let rows = [],
    styles = [],
    style = { fg: null, bg: null, bold: false },
    row = 0,
    col = 0,
    saved = [0, 0],
    frame = '',
    frameStyles = [],
    syncing = false;
  const tokens =
    ansi.match(
      /\x1b[P_](?:[^\x1b]|\x1b(?!\\))*\x1b\\|\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]/gu,
    ) ?? [];
  if (tokens.join('') !== ansi) return ''; // Incomplete escape sequence.
  for (const token of tokens) {
    if (token === '\x1b[?2026h') {
      if (styled && syncing) return '';
      syncing = true;
      continue;
    }
    if (token === '\x1b[?2026l') {
      if (syncing) {
        frame = rows.map((r) => r.join('')).join('\n');
        frameStyles = styles.map((r) => r.slice());
      }
      syncing = false;
      continue;
    }
    if (token.startsWith('\x1b]')) {
      if (styled) return ''; // No unverified palette/title/control mutations.
      continue;
    }
    // Pinned startup capability queries (DCS termcap and APC graphics). They
    // precede the first screen and do not paint terminal cells.
    if (token.startsWith('\x1bP') || token.startsWith('\x1b_')) {
      if (frame || syncing) return ''; // Not supported inside a rendered frame.
      continue;
    }
    if (token.startsWith('\x1b[')) {
      const position = /^\x1b\[(\d*);?(\d*)[Hf]$/.exec(token);
      if (!syncing && (position || /[JK]$/.test(token))) frame = '';
      if (position) {
        row = +(position[1] || 1) - 1;
        col = +(position[2] || 1) - 1;
        if (styled && (row < 0 || row >= 100 || col < 0 || col >= 300)) return '';
      } else if (token === '\x1b[s') saved = [row, col];
      else if (token === '\x1b[u') [row, col] = saved;
      else if (/^\x1b\[(?:2|3)J$/.test(token) || token === '\x1b[?1049h') {
        rows = [];
        styles = [];
        frame = '';
        frameStyles = [];
      } else if (token === '\x1b[K' || token === '\x1b[0K') {
        rows[row]?.splice(col);
        styles[row]?.splice(col);
      } else if (token === '\x1b[2K') {
        rows[row] = [];
        styles[row] = [];
      } else if (/^\x1b\[[0-9;]*m$/.test(token) && styled) {
        if (token !== '\x1b[m' && token.slice(2, -1).split(';').includes('')) return '';
        const codes = token
          .slice(2, -1)
          .split(';')
          .map((v) => Number(v || 0));
        for (let i = 0; i < codes.length; i++) {
          const code = codes[i];
          if (code === 0) style = { fg: null, bg: null, bold: false };
          else if (code === 1 || code === 22) style = { ...style, bold: code === 1 };
          else if (code === 39 || code === 49)
            style = { ...style, [code === 39 ? 'fg' : 'bg']: null };
          else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
            const rgb = codes.slice(i + 2, i + 5);
            if (rgb.length !== 3 || rgb.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
              return '';
            style = { ...style, [code === 38 ? 'fg' : 'bg']: rgb.join(',') };
            i += 4;
          } else return ''; // Unknown attributes/colors cannot imply selection.
        }
      } else if (/^\x1b\[[0-9]* q$/.test(token))
        continue; // Cursor style, no cell change.
      else if (styled && !/^\x1b\[\?25[hl]$/.test(token)) return '';
      else if (!/^\x1b\[(?:[0-9;]*m|[?<>][0-9;]*[hlucq]|[0-9;?]*\$p|[0-9;]*[ntcq])$/.test(token)) {
        if (styled) return '';
        // Unsupported cursor/erase operations must not preserve a stale success.
        rows = [];
        frame = '';
        syncing = false;
      }
      continue;
    }
    if (token === '\r') col = 0;
    else if (token === '\n') row++;
    else if (token >= ' ' && row < 100 && col < 300) {
      // Opt-in calibration source-buffer model, NOT terminal width calibration.
      // @opentui/core 0.8.0, 738067f47e940dcec3f5aab74868908574335c6c:
      // native/tests/unicode-width-map.zon:27-29, utf8_test.zig:2047-2063
      // assign bare U+25CF one cell in all supported width methods. No other
      // Unicode/grapheme is admitted (including VS16). Never infer a CUP that
      // was not observed. Absolute cursor handling above remains unchanged.
      const sourceMarker = sourceMarkerCells && token === '\u25cf';
      if (styled && !sourceMarker && (token.length !== 1 || token.charCodeAt(0) > 126)) return '';
      if (!syncing) frame = '';
      rows[row] ??= [];
      styles[row] ??= [];
      while (rows[row].length < col) rows[row].push(' ');
      styles[row][col] = Object.freeze({ ...style });
      rows[row][col++] = token;
    } else if (styled) return '';
  }
  if (syncing || !frame) return '';
  return styled ? { text: frame, styles: frameStyles } : frame;
}

function readyToast(text) {
  const rows = text.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const start = /┃  (Proceed harness.*)┃/.exec(rows[i]);
    if (!start) continue;
    const left = start.index,
      right = start.index + start[0].length - 1;
    let reconstructed = '';
    for (let j = i; j < Math.min(rows.length, i + 8); j++) {
      if (rows[j][left] !== '┃' || rows[j][right] !== '┃') break;
      const content = rows[j].slice(left + 1, right);
      if (!content.startsWith('  ')) break;
      const part = content
        .slice(2)
        .replace(/ {2,}x *$/, '')
        .trimEnd();
      if (!part) break;
      reconstructed += (j === i ? '' : ' ') + part;
      if (reconstructed.startsWith(productReadyText)) return true;
      if (!productReadyText.startsWith(reconstructed)) break;
    }
  }
  return false;
}
export function compositionRenderEvidence(text) {
  return {
    hostFrameSeen: text.includes('2.2.5') && text.includes('Ask anything'),
    productReadySeen: readyToast(text),
    pickerTitleSeen: text.includes('Select the Proceed session'),
    emptyResultSeen: text.includes('selected session has no pending question'),
  };
}

export const openTitle = 'Proceed harness: open the pending question for a session';
export function observeCompositionSelectors(context, session) {
  const command = context.keymap.commands().find((item) => item.id === 'proceed.harness.open');
  const resolved = context.data.session.get(session);
  return {
    commandEligible:
      !!command &&
      command.title === openTitle &&
      (typeof command.enabled === 'function'
        ? command.enabled() === true
        : command.enabled !== false) &&
      context.keymap.active().some((item) => item.key === 'ctrl+g' && item.title === openTitle),
    session: resolved?.id === session ? session : null,
  };
}

// The generation label binds test observations only. Host setup/reconcile logs,
// not that label, establish activation. Identical reconciles do not replace it.
export function compositionActivation(text, { target, entry }) {
  const lines = text
    .split('\n')
    .filter((line) => /component=plugin(?: |$)/.test(line) && /role=cli(?: |$)/.test(line));
  const field = (line, name) => {
    const value = line.match(new RegExp(`(?:^| )${name}=("(?:[^"\\\\]|\\\\.)*"|[^ ]+)`))?.[1];
    return value?.startsWith('"') ? JSON.parse(value) : value;
  };
  let run,
    setup,
    origin = false,
    active = false,
    invalid = false;
  for (const line of lines) {
    const currentRun = field(line, 'run');
    if (!run) run = currentRun;
    if (!run || currentRun !== run) return null;
    if (field(line, 'target') === target) {
      if (
        field(line, 'stage') === 'read' &&
        field(line, 'entrypoint') === 'file://' + entry &&
        line.includes('operation completed')
      )
        origin = true;
      if (field(line, 'plugin') === 'proceed.harness') {
        if (field(line, 'stage') === 'cleanup') invalid = true;
        if (field(line, 'stage') === 'setup') {
          if (line.includes('operation started')) {
            if (setup) invalid = true;
            setup = field(line, 'id');
            active = false;
          }
          if (line.includes('operation failed')) invalid = true;
          if (line.includes('operation completed') && setup === field(line, 'id')) active = true;
        }
      }
    }
  }
  // Completion of reconcile follows the host's active=true assignment.
  const completed = lines.some(
    (line, i) =>
      line.includes('plugin reconciliation completed') &&
      lines
        .slice(0, i)
        .some(
          (prior) =>
            field(prior, 'target') === target &&
            field(prior, 'id') === setup &&
            prior.includes('operation completed') &&
            field(prior, 'stage') === 'setup',
        ),
  );
  return origin && active && completed && !invalid ? { run, setup } : null;
}

// Read only named own data properties. Unknown values, accessors and nested
// objects never become diagnostic text or identity matches. No recursive walk.
const own = (object, name) => {
  try {
    return Object.getOwnPropertyDescriptor(object, name)?.value;
  } catch {
    return undefined;
  }
};
const text = (value) => typeof value === 'string' && value.length > 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const sameText = (a, b) => text(a) && text(b) && a === b;
const present = (value) => value !== null && typeof value === 'object';

export function compositionSnapshot(input) {
  const get = (name) => own(input, name);
  const binding = get('binding'),
    activation = get('activation'),
    request = get('request'),
    response = get('response'),
    live = get('live');
  const frame = get('frame'),
    frameToken = get('frameToken');
  const now = get('now'),
    deadline = get('deadline');
  const equal = (a, ak, b, bk = ak) => sameText(own(a, ak), own(b, bk));
  const checks = {
    hostRunning: get('exited') === false,
    captureWithinLimit: get('overflow') === false,
    originalDeadlineOpen: integer(now) && integer(deadline) && now < deadline,
    bindingPresent: present(binding),
    activationPresent: present(activation),
    requestParsePresent: present(request),
    responseParsePresent: present(response),
    liveParsePresent: present(live),
    hostRunMatch: equal(activation, 'run', binding, 'hostRun'),
    setupPresent: text(own(activation, 'setup')),
    setupMatch: equal(activation, 'setup', binding, 'hostSetup'),
    completedSupportedFrame: text(frame),
    hostFrameSeen: text(frame) && compositionRenderEvidence(frame).hostFrameSeen,
    responseRunMatch: equal(response, 'run', binding),
    responseGenerationMatch: equal(response, 'generation', binding),
    liveRunMatch: equal(live, 'run', binding),
    liveGenerationMatch: equal(live, 'generation', binding),
    liveTrue: own(live, 'live') === true,
    requestGenerationMatch: equal(request, 'generation', binding),
    requestRunMatch: equal(request, 'run', binding),
    requestSequenceMatch:
      integer(own(request, 'request')) &&
      own(request, 'request') > 0 &&
      own(response, 'request') === own(request, 'request'),
    frameEquality: sameText(own(request, 'frame'), frame),
    currentOffsetValid: integer(frameToken) && frameToken > 0,
    exactPositionMatch:
      integer(frameToken) && frameToken > 0 && own(request, 'frameToken') === frameToken,
    responseLiveTrue: own(response, 'live') === true,
    commandEligible: own(response, 'commandEligible') === true,
    sessionMatch: equal(response, 'session', binding),
  };
  const age = (value) => (integer(now) && integer(value) && value <= now ? now - value : null);
  return {
    admitted: Object.values(checks).every((value) => value === true),
    provenance: compositionGuardProvenance({
      ...compositionGuardProvenance(get('provenance')),
      requestSequence: own(request, 'request'),
    }),
    checks,
    failed: Object.keys(checks).filter((name) => checks[name] !== true),
    currentOffset: integer(frameToken) ? frameToken : null,
    requestedOffset: integer(own(request, 'frameToken')) ? own(request, 'frameToken') : null,
    originalRemainingMs: integer(now) && integer(deadline) ? Math.max(0, deadline - now) : null,
    localRequestAgeMs: age(get('requestWrittenAt')),
    localResponseAgeMs: age(get('responseReadAt')),
    clockProvenance: 'DRIVER_DATE_NOW_FILE_WRITE_AND_READ_NOT_SELECTOR_SAMPLE',
  };
}

export function compositionAdmission(input) {
  return compositionSnapshot(input).admitted;
}

// One actual-mode route for loop and final render diagnostics. Never fall back
// to the unstyled observer when source decoding refuses a cumulative prefix.
export function compositionReadinessFrame(ansi, pickerCapture) {
  return pickerCapture ? (compositionSourceFrame(ansi).text ?? '') : compositionCurrentFrame(ansi);
}

// Closed diagnostics only. No raw identity, frame, path, log or error text.
function compositionGuardProvenance(input) {
  const select = (name, values) => {
    const value = own(input, name);
    return values.includes(value) ? value : 'UNKNOWN';
  };
  const hash = own(input, 'prefixSha256');
  const sequence = own(input, 'requestSequence');
  return {
    observer: select('observer', ['SOURCE_LAYOUT', 'UNSTYLED']),
    operands: select('operands', ['LOOP_SAMPLE', 'LAST_LOOP_SAMPLE_NOT_CURRENT']),
    activation: select('activation', ['OBSERVED', 'NOT_OBSERVED']),
    prefixSha256: typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash) ? hash : null,
    requestSequence: integer(sequence) && sequence > 0 ? sequence : null,
  };
}

// Do not claim a fresh asynchronous activation read at failure/cleanup. Preserve
// all last-loop operands together, including the exact mode and prefix binding.
export function compositionLastGuardSample(state) {
  return {
    ...state,
    provenance: {
      ...own(state, 'provenance'),
      operands: 'LAST_LOOP_SAMPLE_NOT_CURRENT',
    },
  };
}

export function compositionCanRequestFresh(state, snapshot) {
  const c = snapshot.checks;
  return (
    c.originalDeadlineOpen &&
    c.hostRunning &&
    c.captureWithinLimit &&
    c.hostRunMatch &&
    c.setupMatch &&
    c.hostFrameSeen &&
    c.liveRunMatch &&
    c.liveGenerationMatch &&
    c.liveTrue &&
    (!state.request ||
      state.request.frameToken !== state.frameToken ||
      state.request.frame !== state.frame ||
      state.response?.request === state.request.request)
  );
}

// Keep a bounded tail with monotonic sequence and explicit truncation. Callers
// provide only compositionSnapshot output, never raw observations or errors.
export function compositionGuardJournal() {
  const records = [];
  let sequence = 0,
    dropped = 0,
    lastFinalRefusal = null;
  return {
    record(stage, snapshot) {
      if (!['loopadmit', 'finaladmit', 'finalrefuse', 'CleanupENTRY'].includes(stage))
        throw Error('unknown guard stage');
      // Rebuild the closed scalar projection, never spread caller metadata.
      const schema = compositionSnapshot(null);
      const checks = {};
      for (const name of Object.keys(schema.checks)) {
        const value = own(own(snapshot, 'checks'), name);
        if (typeof value !== 'boolean') throw Error('unsafe guard projection');
        checks[name] = value;
      }
      const safe = {
        admitted: Object.values(checks).every((v) => v),
        checks,
        failed: Object.keys(checks).filter((name) => !checks[name]),
        provenance: compositionGuardProvenance(own(snapshot, 'provenance')),
      };
      for (const name of [
        'currentOffset',
        'requestedOffset',
        'originalRemainingMs',
        'localRequestAgeMs',
        'localResponseAgeMs',
      ]) {
        const value = own(snapshot, name);
        if (value !== null && !integer(value)) throw Error('unsafe guard projection');
        safe[name] = value;
      }
      safe.clockProvenance = schema.clockProvenance;
      if (records.length === 128) {
        records.shift();
        dropped++;
      }
      records.push({ sequence: ++sequence, stage, ...safe });
      if (stage === 'finalrefuse') lastFinalRefusal = records.at(-1);
    },
    value: () => ({ records: records.slice(), dropped, lastFinalRefusal }),
  };
}

// Same original deadline throughout. observe performs the async loader read,
// then synchronously samples frame/files. onAdmit MUST be synchronous: no await
// may separate final evaluated snapshot from the single normal input write.
export async function awaitCompositionKeyAdmission({
  observe,
  requestFresh,
  pause,
  now,
  deadline,
  record,
  onAdmit,
}) {
  while (now() < deadline) {
    const loop = await observe();
    const snapshot = compositionSnapshot({ ...loop, now: now(), deadline });
    record('loopadmit', snapshot);
    if (loop.exited) throw Object.assign(new Error('host exited'), { code: 'HOST_EXITED' });
    if (loop.overflow) throw Object.assign(new Error('capture limit'), { code: 'CAPTURE_LIMIT' });
    if (snapshot.admitted) {
      const final = await observe();
      const evaluated = compositionSnapshot({ ...final, now: now(), deadline });
      record(evaluated.admitted ? 'finaladmit' : 'finalrefuse', evaluated);
      if (evaluated.admitted) {
        onAdmit(final, evaluated);
        return;
      }
      if (final.exited) throw Object.assign(new Error('host exited'), { code: 'HOST_EXITED' });
      if (final.overflow)
        throw Object.assign(new Error('capture limit'), { code: 'CAPTURE_LIMIT' });
      requestFresh(final, evaluated);
    } else requestFresh(loop, snapshot);
    await pause();
  }
  throw Object.assign(new Error('render readiness deadline'), { code: 'READINESS_DEADLINE' });
}

// Pinned public Context.keymap.commands lists reachable commands. The fixture
// separately checks active keys. Neither observation invokes a command callback.
export async function awaitCompositionRender({ observe, pause, now, deadline, record }) {
  while (now() < deadline) {
    const state = await observe();
    record({
      ...state.rendered,
      commandEligible: state.commandEligible === true,
    });
    if (state.exited) throw Object.assign(new Error('host exited'), { code: 'HOST_EXITED' });
    if (state.overflow)
      throw Object.assign(new Error('capture limit'), {
        code: 'CAPTURE_LIMIT',
      });
    if (state.admitted === true) return;
    await pause();
  }
  throw Object.assign(new Error('render readiness deadline'), {
    code: 'READINESS_DEADLINE',
  });
}

export function compositionErrorCode(error) {
  return [
    'HOST_EXITED',
    'CAPTURE_LIMIT',
    'READINESS_DEADLINE',
    'PHASE_DEADLINE',
    'CAPTURE_SCAN_REFUSED',
    'ERR_ASSERTION',
    'ENOENT',
    'EACCES',
    'ETIMEDOUT',
  ].includes(own(error, 'code'))
    ? own(error, 'code')
    : 'CONTROL_ASSERTION_OR_IO';
}
