// Lifecycle envelope contract (design section 4). Readiness adoption and the
// control routes compare the same closed field set against the stable protected
// record, so a listener that publishes extra fields, a string `paired`, an
// invented Telegram state or a different diagnostic PID is never adopted as this
// instance. Comparisons describe lifecycle consistency, not channel authenticity.
export const LIFECYCLE_FIELDS = Object.freeze([
  'instance',
  'lifecycle_version',
  'local_ready',
  'paired',
  'pid',
  'port',
  'schema_version',
  'service',
  'telegram',
]);

// Observed local transport state, never evidence of human receipt or future
// connectivity. `code` is null except for a currently observed failure.
export const TELEGRAM_STATES = new Set(['disabled', 'starting', 'active', 'retrying', 'stopped']);

export const TELEGRAM_FAILURE_CODES = new Set([
  'TOKEN_MISSING',
  'TOKEN_REJECTED',
  'POLLER_CONFLICT',
  'TELEGRAM_UNAVAILABLE',
  'TELEGRAM_TIMEOUT',
  'TELEGRAM_RATE_LIMITED',
  'TELEGRAM_REJECTED',
  'STORAGE_FAILURE',
  'UNKNOWN',
]);

function shapeProblem(body) {
  const keys = Object.keys(body).sort();
  if (keys.length !== LIFECYCLE_FIELDS.length) return true;
  return keys.some((key, index) => key !== LIFECYCLE_FIELDS[index]);
}

function telegramProblem(telegram) {
  if (telegram === null || typeof telegram !== 'object' || Array.isArray(telegram)) return true;
  const keys = Object.keys(telegram).sort();
  if (keys.length !== 2 || keys[0] !== 'code' || keys[1] !== 'state') return true;
  if (!TELEGRAM_STATES.has(telegram.state)) return true;
  return telegram.code !== null && !TELEGRAM_FAILURE_CODES.has(telegram.code);
}

// Returns null for an acceptable envelope, `malformed` for a payload outside the
// defined lifecycle vocabulary, or `mismatch` for a well-formed payload that
// describes a different instance, port or process than the stable record.
export function lifecycleEnvelopeProblem(body, record) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'malformed';
  if (shapeProblem(body)) return 'malformed';
  if (body.schema_version !== 1 || body.service !== 'proceed-mcp' || body.lifecycle_version !== 1) {
    return 'malformed';
  }
  if (body.local_ready !== true) return 'malformed';
  if (typeof body.paired !== 'boolean') return 'malformed';
  if (telegramProblem(body.telegram)) return 'malformed';
  if (body.instance !== record.instance || body.port !== record.port) return 'mismatch';
  if (!Number.isInteger(body.pid) || body.pid <= 0 || body.pid !== record.pid) return 'mismatch';
  return null;
}
