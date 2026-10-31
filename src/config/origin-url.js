// Immutable loopback origin topology for one OpenCode V2 host (design section 2).
import { invalidArgument } from '../errors.js';

export const LOOPBACK_HOST = '127.0.0.1';

// Returns the canonical wire origin. Every rejection is an invalid-argument
// outcome: a remote or ambiguous topology must never be silently substituted.
export function normalizeOriginUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw invalidArgument('--url requires a non-empty value');
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw invalidArgument('--url is not a valid absolute URL');
  }

  if (parsed.protocol !== 'http:') {
    throw invalidArgument(
      '--url must use the http scheme; https is not supported for a loopback host',
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw invalidArgument(
      '--url must not embed credentials; the password is read from --password-env',
    );
  }
  if (parsed.hostname !== LOOPBACK_HOST) {
    throw invalidArgument(`--url host must be the literal loopback address ${LOOPBACK_HOST}`);
  }
  if (parsed.port === '') {
    throw invalidArgument('--url must include an explicit port');
  }

  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidArgument('--url port must be an integer in 1-65535');
  }
  if (parsed.pathname !== '/') {
    throw invalidArgument('--url must not include a path');
  }
  if (parsed.search !== '') {
    throw invalidArgument('--url must not include a query string');
  }
  if (parsed.hash !== '') {
    throw invalidArgument('--url must not include a fragment');
  }

  return { url: `http://${LOOPBACK_HOST}:${port}`, port };
}
