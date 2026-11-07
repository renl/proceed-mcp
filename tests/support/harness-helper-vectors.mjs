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
