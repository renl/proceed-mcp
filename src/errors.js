// Command outcome contract for the public CLI. See design section 2.
export const EXIT_CODE = Object.freeze({
  OK: 0,
  INVALID: 2,
  BLOCKED: 3,
  STORAGE: 4,
});

export class CliError extends Error {
  constructor(message, { exitCode, code } = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode ?? EXIT_CODE.INVALID;
    this.code = code ?? 'INVALID_ARGUMENT';
  }
}

export function invalidArgument(message, code = 'INVALID_ARGUMENT') {
  return new CliError(message, { exitCode: EXIT_CODE.INVALID, code });
}

export function blockedPrerequisite(message, code = 'PREREQUISITE_UNAVAILABLE') {
  return new CliError(message, { exitCode: EXIT_CODE.BLOCKED, code });
}

export function storageFailure(message, code = 'STORAGE_FAILURE', cause) {
  const error = new CliError(message, { exitCode: EXIT_CODE.STORAGE, code });
  if (cause !== undefined) error.cause = cause;
  return error;
}

// Broker outcome classification (design section 3). The HTTP status and the
// error code travel together so the MCP adapter can return the documented tool
// error without reinterpreting a failure.
export class BrokerError extends Error {
  constructor(code, status, message, { retryable = false } = {}) {
    super(message);
    this.name = 'BrokerError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }

  toEnvelope() {
    return {
      schema_version: 1,
      error: { code: this.code, message: this.message, retryable: this.retryable },
    };
  }
}

export function invalidRequest(message, code = 'INVALID_ARGUMENT') {
  return new BrokerError(code, 400, message);
}

export function notFound(message = 'request not found') {
  return new BrokerError('NOT_FOUND', 404, message);
}

// Authentication and role separation for the local API: a missing or unknown
// Bearer credential discloses nothing, and a valid credential aimed at another
// route group is a plain refusal.
export function authRequired(message = 'a protected local credential is required') {
  return new BrokerError('AUTH_REQUIRED', 401, message);
}

export function forbidden(message = 'this credential cannot use that route') {
  return new BrokerError('FORBIDDEN', 403, message);
}

// Design section 6: a host without a reviewed support entry is never a
// supported product session, so admission fails closed and is not retryable.
export function unsupportedHost(
  message = 'the origin host version is not supported by this release',
) {
  return new BrokerError('UNSUPPORTED_HOST', 503, message, { retryable: false });
}

export function conflict(message, code = 'IDEMPOTENCY_CONFLICT') {
  return new BrokerError(code, 409, message);
}

export function unavailable(message, code = 'ORIGIN_UNAVAILABLE', { retryable = true } = {}) {
  return new BrokerError(code, 503, message, { retryable });
}
