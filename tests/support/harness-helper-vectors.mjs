// TEST ONLY. Design section 2, private TUI/helper byte-stream contract.
// These bytes are adversarial inputs, not a production parser or helper API.
export const exchangeId = '0123456789abcdef0123456789abcdef';
export function frame(value) {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(bytes.length);
  return Buffer.concat([prefix, bytes]);
}
export function hello(deadline = Date.now() + 10000) {
  return { schema_version: 1, type: 'hello', exchange_id: exchangeId, deadline_unix_ms: deadline };
}
export function invalidHelloVectors() {
  const valid = hello();
  const length = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n);
    return b;
  };
  return [
    ['zero-length', length(0)],
    ['oversized-length', length(81921)],
    ['invalid-utf8', Buffer.from([0, 0, 0, 1, 0xff])],
    ['bom', frame('\ufeff' + JSON.stringify(valid))],
    [
      'duplicate-key',
      frame(
        JSON.stringify(valid).replace(
          '"schema_version":1',
          '"schema_version":1,"schema_version":1',
        ),
      ),
    ],
    ['additional-key', frame({ ...valid, operator_key_file: '/never/load/this' })],
    ['wrong-version', frame({ ...valid, schema_version: 2 })],
    ['wrong-order', frame({ ...valid, type: 'exchange' })],
    ['wrong-id', frame({ ...valid, exchange_id: 'x'.repeat(32) })],
    ['expired', frame(hello(Date.now() - 1))],
    ['extended-budget', frame(hello(Date.now() + 20000))],
  ];
}

// After a valid ready: never accept generic proxy inputs or key-file authority.
// A malformed credential means these cases must be rejected before any I/O.
export function forbiddenExchangeVectors() {
  const base = {
    schema_version: 1,
    type: 'exchange',
    exchange_id: exchangeId,
    port: 1,
    lock_file: '/never/read/broker.lock',
    operator_credential: 'not-authority',
    operation: 'pending',
    presentation_id: null,
    body: { harness_id: 'qualification', owner_id: 'shared', session_id: 'transport-session' },
  };
  return [
    ['no-authority', base],
    ['key-path-not-authority', { ...base, operator_key_file: '/never/load/operator.key' }],
    ...['ready', 'start', 'stop', 'https://example.invalid/', '/v1/ready'].map((operation) => [
      'closed-operation-' + operation,
      { ...base, operation },
    ]),
    ['custom-url', { ...base, url: 'https://example.invalid/' }],
    ['custom-headers', { ...base, headers: { Authorization: 'not-authority' } }],
  ];
}

// Syntactically valid synthetic authority isolates closed-operation validation
// from credential validation. It is not an enrolled key or production secret.
export const syntheticOperator = `hop_${'a7'.repeat(32)}`;
export function closedExchangeVectors(lockFile = '/never/read/broker.lock') {
  const base = {
    schema_version: 1,
    type: 'exchange',
    exchange_id: exchangeId,
    port: 1,
    lock_file: lockFile,
    operator_credential: syntheticOperator,
    operation: 'pending',
    presentation_id: null,
    body: { harness_id: 'qualification', owner_id: 'shared', session_id: 'transport-session' },
  };
  return [
    ...['ready', 'start', 'stop', '/v1/ready', 'https://example.invalid/'].map((operation) => [
      `authorized-closed-${operation}`,
      { ...base, operation },
    ]),
    ...[
      'url',
      'method',
      'headers',
      'proxy',
      'operator_key_file',
      'owner_token',
      'control_token',
    ].map((key) => [`authorized-extra-${key}`, { ...base, [key]: 'forbidden' }]),
    ['authorized-extra-body', { ...base, body: { ...base.body, choice: 'approve' } }],
    ['authorized-wrong-presentation', { ...base, presentation_id: 'hpr_' + 'b'.repeat(32) }],
  ];
}

export function ready(version = '24.22.2') {
  return {
    schema_version: 1,
    type: 'ready',
    exchange_id: exchangeId,
    runtime: 'node',
    node_version: version,
  };
}

// Child-to-parent adversarial bytes. A composition driver must send them via
// the actual private output pipe, not call a production parser directly.
export function invalidChildVectors() {
  const valid = ready();
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(81921);
  return [
    ['child-zero-length', Buffer.alloc(4)],
    ['child-oversized-length', prefix],
    ['child-partial-prefix', Buffer.from([0, 0])],
    ['child-partial-body', frame(valid).subarray(0, 12)],
    ['child-invalid-utf8', Buffer.from([0, 0, 0, 1, 0xff])],
    ['child-bom', frame('\ufeff' + JSON.stringify(valid))],
    ['child-invalid-json', frame('{')],
    [
      'child-duplicate-key',
      frame(JSON.stringify(valid).replace('"runtime":"node"', '"runtime":"bun","runtime":"node"')),
    ],
    ['child-bun', frame({ ...valid, runtime: 'bun' })],
    ['child-old-node', frame(ready('23.9.0'))],
    ['child-invalid-version', frame(ready('24.22.2-injected'))],
    ['child-version-too-long', frame(ready('2'.repeat(33)))],
    ['child-extra-field', frame({ ...valid, diagnostic: syntheticOperator })],
    ['child-wrong-id', frame({ ...valid, exchange_id: 'f'.repeat(32) })],
    ['child-wrong-version', frame({ ...valid, schema_version: 2 })],
    [
      'child-response-before-ready',
      frame({
        schema_version: 1,
        type: 'response',
        exchange_id: exchangeId,
        status: 200,
        body: { schema_version: 1, presentation: null },
      }),
    ],
    ['child-extra-ready', Buffer.concat([frame(valid), frame(valid)])],
    ['child-trailing-byte', Buffer.concat([frame(valid), Buffer.from([0])])],
    ['child-direction-limit', Buffer.alloc(98305, 0x20)],
  ];
}
