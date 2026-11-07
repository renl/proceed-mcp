// Fixed MCP mapping for startup/availability failures (design section 5).
//
// The tool-error vocabulary is closed: each local startup classification becomes
// one existing tool code plus an actionable command template. Raw exception,
// child, TLS or path text is never forwarded, so a redacted failure still tells
// the operator the safe next step. Any unknown classification stays a generic
// unavailable prerequisite.
const FAILURES = new Map([
  [
    'BROKER_INSTANCE_CONFLICT',
    {
      code: 'BROKER_UNAVAILABLE',
      message:
        'the local broker uses an unsupported local channel; stop it through its own Ctrl+C or operator interface, then restart it with "proceed-mcp serve --secure-local" or provision the automatic-startup token file',
    },
  ],
  [
    'TELEGRAM_CREDENTIAL_UNAVAILABLE',
    {
      code: 'BROKER_UNAVAILABLE',
      message:
        'the automatic-startup Telegram credential is missing or unusable; run "proceed-mcp telegram provision --token-stdin" or select the correct safe file',
    },
  ],
  [
    'PROTECTION_UNVERIFIED',
    {
      code: 'STORAGE_FAILURE',
      message:
        'protected broker storage could not be verified; select dedicated protected storage or repair it explicitly outside startup',
    },
  ],
  [
    'STORAGE_FAILURE',
    {
      code: 'STORAGE_FAILURE',
      message:
        'protected broker storage or journal state failed; preserve the state directory and investigate storage before a new attempt',
    },
  ],
  [
    'STATE_NOT_OWNED',
    {
      code: 'BROKER_UNAVAILABLE',
      message:
        'broker state ownership is uncertain; preserve the state directory and investigate ownership before a new attempt',
    },
  ],
  [
    'BROKER_STARTUP_TIMEOUT',
    {
      code: 'BROKER_UNAVAILABLE',
      message:
        'the broker did not become ready within the startup deadline; inspect "proceed-mcp status" before a new attempt',
    },
  ],
]);

const FALLBACK = {
  code: 'BROKER_UNAVAILABLE',
  message:
    'the local broker could not be provided automatically; inspect "proceed-mcp status" and the setup instructions',
};

export function startupToolFailure(error) {
  return FAILURES.get(error?.code) ?? FALLBACK;
}
