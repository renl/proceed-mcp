// Immutable loopback origin topology for one OpenCode V2 host (design section 2).
import { invalidArgument } from '../errors.js';

export const LOOPBACK_HOST = '127.0.0.1';

// The operator's literal text is authoritative: a WHATWG URL parse would expand
// IPv4 aliases (127.1, 2130706433, 0x7f000001) into 127.0.0.1 and drop the
// default http port, so topology validation never delegates to that parser.
const AUTHORITY = /^http:\/\/([^/?#]*)([\s\S]*)$/i;
const PORT_DIGITS = /^[0-9]{1,5}$/;
const EDGE_WHITESPACE = /^[\u0000-\u0020]+|[\u0000-\u0020]+$/g;

// Returns the canonical wire origin. Every rejection is an invalid-argument
// outcome: a remote or ambiguous topology must never be silently substituted.
export function normalizeOriginUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw invalidArgument('--url requires a non-empty value');
  }

  const text = raw.replace(EDGE_WHITESPACE, '');
  if (/^https:/i.test(text)) {
    throw invalidArgument(
      '--url must use the http scheme; https is not supported for a loopback host',
    );
  }

  const match = AUTHORITY.exec(text);
  if (match === null) {
    throw invalidArgument('--url is not a valid absolute URL using the http scheme');
  }

  const [, authority, remainder] = match;
  if (authority.includes('@')) {
    throw invalidArgument(
      '--url must not embed credentials; the password is read from --password-env',
    );
  }

  const colon = authority.lastIndexOf(':');
  const host = colon === -1 ? authority : authority.slice(0, colon);
  if (host !== LOOPBACK_HOST) {
    throw invalidArgument(`--url host must be the literal loopback address ${LOOPBACK_HOST}`);
  }

  const portText = colon === -1 ? '' : authority.slice(colon + 1);
  if (portText === '') {
    throw invalidArgument('--url must include an explicit port');
  }
  if (!PORT_DIGITS.test(portText)) {
    throw invalidArgument('--url port must be an integer in 1-65535');
  }

  const port = Number(portText);
  if (port < 1 || port > 65535) {
    throw invalidArgument('--url port must be an integer in 1-65535');
  }
  // Keep the stored binding byte-identical to the accepted literal text.
  if (String(port) !== portText) {
    throw invalidArgument('--url port must be written literally, without leading zeros');
  }

  if (remainder === '' || remainder === '/') {
    return { url: `http://${LOOPBACK_HOST}:${port}`, port };
  }
  if (remainder.startsWith('/')) {
    throw invalidArgument('--url must not include a path');
  }
  if (remainder.startsWith('?')) {
    throw invalidArgument('--url must not include a query string');
  }
  if (remainder.startsWith('#')) {
    throw invalidArgument('--url must not include a fragment');
  }

  throw invalidArgument(
    `--url must be exactly http://${LOOPBACK_HOST}:<explicit port> with no credentials, path, query or fragment`,
  );
}
