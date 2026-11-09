// TEST ONLY. Observe the real broker response without changing dispatch or TLS.
import http from 'node:http';
import { appendFileSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, request, response, ...rest) {
  if (
    event === 'request' &&
    ['/v1/harness/pending', '/v1/harness/decisions'].includes(request.url)
  ) {
    const chunks = [];
    const end = response.end;
    const write = response.write;
    response.write = function (bytes, ...args) {
      if (bytes) chunks.push(Buffer.from(bytes));
      return write.call(this, bytes, ...args);
    };
    response.end = function (bytes, ...args) {
      if (bytes) chunks.push(Buffer.from(bytes));
      const helpers = [];
      for (const pid of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
        try {
          const argv = readFileSync(`/proc/${pid}/cmdline`).toString().split('\0').filter(Boolean);
          if (!argv[1]?.endsWith('/src/harness/operator-helper.js')) continue;
          helpers.push({
            pid: Number(pid),
            executable: readlinkSync(`/proc/${pid}/exe`),
            argv,
            fd3: readlinkSync(`/proc/${pid}/fd/3`),
            fd4: readlinkSync(`/proc/${pid}/fd/4`),
          });
        } catch {
          /* exited process is not evidence */
        }
      }
      appendFileSync(
        '/run/proceed/qualification-private/composition-wire.jsonl',
        JSON.stringify({
          method: request.method,
          path: request.url,
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString()),
          cipher: request.socket.getCipher(),
          helpers,
        }) + '\n',
        { mode: 0o600 },
      );
      return end.call(this, bytes, ...args);
    };
  }
  return emit.call(this, event, request, response, ...rest);
};
