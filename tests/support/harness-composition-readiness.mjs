// TEST ONLY. Render evidence, not process-alive or fixture-callback readiness.
export const productReadyText = 'Proceed harness ready for qualification (owner shared).';
// Small, fail-closed projection of the pinned host's synchronized cell updates.
// Only completed frames count. Repainting cells replaces old text, never appends it.
export function compositionCurrentFrame(ansi) {
  let rows = [],
    row = 0,
    col = 0,
    saved = [0, 0],
    frame = '',
    syncing = false;
  const tokens =
    ansi.match(
      /\x1b[P_](?:[^\x1b]|\x1b(?!\\))*\x1b\\|\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]/gu,
    ) ?? [];
  if (tokens.join('') !== ansi) return ''; // Incomplete escape sequence.
  for (const token of tokens) {
    if (token === '\x1b[?2026h') {
      syncing = true;
      continue;
    }
    if (token === '\x1b[?2026l') {
      if (syncing) frame = rows.map((r) => r.join('')).join('\n');
      syncing = false;
      continue;
    }
    if (token.startsWith('\x1b]')) continue;
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
      } else if (token === '\x1b[s') saved = [row, col];
      else if (token === '\x1b[u') [row, col] = saved;
      else if (/^\x1b\[(?:2|3)J$/.test(token) || token === '\x1b[?1049h') rows = [];
      else if (token === '\x1b[K' || token === '\x1b[0K') rows[row]?.splice(col);
      else if (token === '\x1b[2K') rows[row] = [];
      else if (/^\x1b\[[0-9]* q$/.test(token))
        continue; // Cursor style, no cell change.
      else if (!/^\x1b\[(?:[0-9;]*m|[?<>][0-9;]*[hlucq]|[0-9;?]*\$p|[0-9;]*[ntcq])$/.test(token)) {
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
      if (!syncing) frame = '';
      rows[row] ??= [];
      while (rows[row].length < col) rows[row].push(' ');
      rows[row][col++] = token;
    }
  }
  return syncing ? '' : frame;
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

export function compositionAdmission({
  binding,
  activation,
  frame,
  frameToken,
  request,
  response,
  live,
  exited,
  now,
  deadline,
}) {
  return (
    !exited &&
    now < deadline &&
    !!activation &&
    activation.run === binding.hostRun &&
    !!frame &&
    compositionRenderEvidence(frame).hostFrameSeen &&
    response?.run === binding.run &&
    response?.generation === binding.generation &&
    live?.run === binding.run &&
    live?.generation === binding.generation &&
    live?.live === true &&
    request?.generation === binding.generation &&
    request?.run === binding.run &&
    response?.request === request?.request &&
    request?.frame === frame &&
    Number.isSafeInteger(frameToken) &&
    frameToken > 0 &&
    request?.frameToken === frameToken &&
    response?.live === true &&
    response?.commandEligible === true &&
    response?.session === binding.session
  );
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
    'ERR_ASSERTION',
    'ENOENT',
    'EACCES',
    'ETIMEDOUT',
  ].includes(error?.code)
    ? error.code
    : 'CONTROL_ASSERTION_OR_IO';
}
