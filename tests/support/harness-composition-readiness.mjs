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
      /\x1b\](?:[^\x07\x1b]|\x1b(?!\\))*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|[^\x1b]/gu,
    ) ?? [];
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
    if (token.startsWith('\x1b[')) {
      const position = /^\x1b\[(\d*);?(\d*)[Hf]$/.exec(token);
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
    hostFrameSeen: text.includes('2.2.5'),
    productReadySeen: readyToast(text),
    pickerTitleSeen: text.includes('Select the Proceed session'),
    emptyResultSeen: text.includes('selected session has no pending question'),
  };
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
    if (
      state.rendered.hostFrameSeen &&
      state.rendered.productReadySeen &&
      state.commandEligible === true
    )
      return;
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
