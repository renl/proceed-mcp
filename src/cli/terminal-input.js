// Private interactive token input owned by Proceed (design decision 1).
//
// The token is read from a trusted terminal with echo disabled before any secret
// character is consumed. Only one fixed prompt reaches the operator, nothing is
// echoed, no length or masking character is shown, and the original terminal mode,
// every owned listener and the input activity this attempt started are released on
// success and on every failure path. Input use the caller already had is captured
// before acquisition and is never paused, destroyed or closed. Losing the private
// facility is a prerequisite refusal, never a fallback to echoed input.
import { blockedPrerequisite, invalidArgument } from '../errors.js';
import {
  MAX_TOKEN_BYTES,
  TOKEN_INPUT_TIMEOUT_MS,
  parseTokenInput,
} from '../state/credential-file.js';

export const PROVISION_PROMPT = 'Telegram bot token (input is hidden, then press Enter): ';

const INTERRUPT = 0x03;
const BACKSPACE = 0x7f;
const DELETE_PREVIOUS = 0x08;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

const TERMINAL_GUIDANCE =
  'private terminal input is unavailable; use a trusted unrecorded terminal, or use --token-stdin with a trusted nonterminal source (PREREQUISITE_UNAVAILABLE)';

function unavailable() {
  return blockedPrerequisite(TERMINAL_GUIDANCE, 'PREREQUISITE_UNAVAILABLE');
}

function wrongInputMode() {
  return invalidArgument(
    'telegram provision without --token-stdin requires a trusted interactive terminal; use --token-stdin for a nonterminal source',
  );
}

// Reads exactly one token from one interactive terminal. Enter submits, backspace
// removes the previous entered byte without displaying it, Ctrl+C cancels, EOF
// before submission is a failure, and the whole exchange is bounded.
export function readTokenFromTerminal(
  stream,
  { stderr = process.stderr, prompt = PROVISION_PROMPT, timeoutMs = TOKEN_INPUT_TIMEOUT_MS } = {},
) {
  if (stream === undefined || stream === null) return Promise.reject(wrongInputMode());
  if (stream.isTTY !== true) return Promise.reject(wrongInputMode());
  if (typeof stream.setRawMode !== 'function') return Promise.reject(unavailable());
  const originalRaw = stream.isRaw === true;
  // Capture the caller's input use before acquisition changes it (decision 1).
  const callerFlowing = stream.readableFlowing === true;
  try {
    // Echo is disabled before a single secret character is consumed.
    stream.setRawMode(true);
  } catch {
    // Raw mode may already have changed; restore it without consuming input.
    try {
      stream.setRawMode(originalRaw);
    } catch {
      // The terminal is already gone; nothing is left to restore.
    }
    return Promise.reject(unavailable());
  }
  return new Promise((resolve, reject) => {
    const entered = [];
    const owned = [];
    let settled = false;
    let timer = null;
    // Ownership-limited cleanup: release only what this attempt acquired and
    // attempt every applicable action even if one restoration action fails.
    const release = () => {
      for (const [name, handler] of owned) {
        try {
          stream.removeListener(name, handler);
        } catch {
          // Keep releasing the remaining owned resources.
        }
      }
      owned.length = 0;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Stop reading this attempt started, without disabling caller input use.
      if (
        !callerFlowing &&
        typeof stream.pause === 'function' &&
        !stream.destroyed &&
        !stream.readableEnded
      ) {
        try {
          stream.pause();
        } catch {
          // The terminal is already gone; nothing is left to stop.
        }
      }
      try {
        stream.setRawMode(originalRaw);
      } catch {
        // The terminal is already gone; nothing is left to restore.
      }
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      release();
      reject(error);
    };
    const submit = () => {
      if (settled) return;
      settled = true;
      release();
      try {
        stderr?.write?.('\n');
      } catch {
        // The completion newline cannot be shown; settle with a secret-free
        // failure instead of letting the output exception escape the input
        // callback and leave the exchange pending.
        reject(unavailable());
        return;
      }
      try {
        resolve(parseTokenInput(Buffer.from(entered)));
      } catch (error) {
        reject(error);
      }
    };
    const onData = (chunk) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      for (const byte of bytes) {
        if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
          submit();
          return;
        }
        if (byte === INTERRUPT) {
          fail(invalidArgument('the Telegram token input was cancelled; nothing was written'));
          return;
        }
        if (byte === BACKSPACE || byte === DELETE_PREVIOUS) {
          entered.pop();
          continue;
        }
        entered.push(byte);
        if (entered.length > MAX_TOKEN_BYTES) {
          fail(invalidArgument('the Telegram token exceeds the accepted 1-4096 byte bound'));
          return;
        }
      }
    };
    const listen = (name, handler) => {
      owned.push([name, handler]);
      stream.on(name, handler);
    };
    try {
      listen('data', onData);
      listen('end', () =>
        fail(invalidArgument('the Telegram token input ended before the token was submitted')),
      );
      listen('error', () =>
        fail(invalidArgument('the Telegram token input could not be read from the terminal')),
      );
      listen('close', () =>
        fail(invalidArgument('the Telegram token input ended before the token was submitted')),
      );
      // Reading starts for this attempt even when the caller paused input, and
      // cleanup stops it again when the caller was not already consuming input.
      if (!callerFlowing && typeof stream.resume === 'function' && !stream.destroyed)
        stream.resume();
      stderr?.write?.(prompt);
    } catch {
      // Partial setup failures restore the terminal and reject without echoing
      // the underlying exception, which may carry supplied input.
      fail(unavailable());
      return;
    }
    // The deadline starts at prompt readiness and covers the whole exchange.
    timer = setTimeout(() => {
      fail(invalidArgument('the Telegram token input did not complete within 60 seconds'));
    }, timeoutMs);
  });
}
