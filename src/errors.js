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
