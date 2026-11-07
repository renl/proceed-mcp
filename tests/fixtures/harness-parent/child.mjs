// TEST ONLY. Finite hostile peer on the actual private descriptor boundary.
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { encodeFrame, FrameReader } from '../../../src/harness/helper-protocol.js';
const mode = process.argv[2];
writeFileSync(
  `/run/proceed/parent-private/${mode}.json`,
  JSON.stringify({
    pid: process.pid,
    executable: process.execPath,
    node: process.versions.node,
    bun: process.versions.bun ?? null,
    environment: process.env,
  }),
);
const input = createReadStream(null, { fd: 3 });
const output = createWriteStream(null, { fd: 4 });
const reader = new FrameReader();
const watchdog = setTimeout(() => process.exit(90), 12000);
if (mode === 'hung-child-force') process.on('SIGTERM', () => {});
const finish = (bytes, code = 0) =>
  output.end(bytes, () => {
    clearTimeout(watchdog);
    input.destroy();
    process.exit(code);
  });
input.on('data', (bytes) => {
  for (const value of reader.push(bytes)) {
    if (value.type === 'hello') {
      if (mode === 'malformed-child') return finish(Buffer.from([0, 0, 0, 1, 0x7b]));
      if (mode === 'oversized-child') return finish(Buffer.from([0, 1, 0x40, 1]));
      if (mode === 'partial-child') return finish(Buffer.from([0, 0, 0, 5, 0x7b]));
      if (mode === 'parent-eof') return finish(Buffer.alloc(0));
      const ready = {
        schema_version: 1,
        type: 'ready',
        exchange_id: value.exchange_id,
        runtime: mode === 'bun-not-node' ? 'bun' : 'node',
        node_version: mode === 'unsupported-node' ? '22.0.0' : process.versions.node,
      };
      if (mode === 'wrong-id') ready.exchange_id = 'f'.repeat(32);
      if (mode === 'wrong-version') ready.schema_version = 2;
      if (mode === 'wrong-order') ready.type = 'response';
      output.write(encodeFrame(ready));
    } else {
      if (['invocation-cancel', 'exchange-deadline', 'hung-child-force'].includes(mode)) return;
      if (mode === 'stdout-tripwire') process.stdout.write('synthetic-noise');
      if (mode === 'stderr-tripwire') process.stderr.write('synthetic-noise');
      const response = encodeFrame({
        schema_version: 1,
        type: 'response',
        exchange_id: value.exchange_id,
        status: 200,
        body: { schema_version: 1, presentation: null },
      });
      if (mode === 'extra-child-frame') return finish(Buffer.concat([response, response]));
      if (mode === 'response-with-open-pipes') {
        output.write(response);
        return;
      }
      finish(response, mode === 'response-then-nonzero-exit' ? 1 : 0);
    }
  }
});
input.on('error', () => process.exit(1));
output.on('error', () => process.exit(1));
