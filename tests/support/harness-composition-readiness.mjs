// TEST ONLY. Render evidence, not process-alive or fixture-callback readiness.
export const productReadyText = 'Proceed harness ready for qualification (owner shared).';
// Small, fail-closed projection of the pinned host's synchronized cell updates.
// Only completed frames count. Repainting cells replaces old text, never appends it.
export function compositionCurrentFrame(ansi, { styled = false } = {}) {
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
      // Style observation deliberately supports ASCII cells only, not guessed
      // Unicode widths/autowrap. The existing text readiness projection is unchanged.
      if (styled && (token.length !== 1 || token.charCodeAt(0) > 126)) return '';
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
