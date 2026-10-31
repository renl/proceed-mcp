// TEST ONLY. Controlled HTTP host/fault/topology fixture; never a product server.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openSync, closeSync } from 'node:fs';

const [role, destination] = process.argv.slice(2);
const sockets = new Set();
let armed;
const admissions = new Map();
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 65536) { req.destroy(); return; }
  }
  const body = Buffer.concat(chunks);
  if (role === 'fault') {
    // Destination is fixed at launch, never read from requests/advertised URLs.
    const upstream = http.request(`${destination}${req.url}`, {
      method: req.method, headers: req.headers, timeout: 1000,
    }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => {
        let id;
        try { id = JSON.parse(body).id; } catch { /* non-JSON is forwarded */ }
        if (req.method === 'POST' && req.url === '/api/session/target/prompt' && id === armed) {
          armed = undefined;
          // Upstream completed admission, but not one response byte is delivered.
          process.send({ kind: 'response-lost', id });
          req.socket.destroy();
        } else {
          res.writeHead(response.statusCode, response.headers);
          res.end(Buffer.concat(parts));
        }
      });
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => { res.destroy(); });
    upstream.end(body);
    return;
  }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/redirect') {
    res.writeHead(302, { location: 'http://example.invalid/must-not-follow' });
    res.end('{}');
    return;
  }
  if (req.method === 'POST' && req.url === '/api/session/target/prompt') {
    const input = JSON.parse(body);
    const old = admissions.get(input.id);
    if (old && JSON.stringify(old) !== JSON.stringify(input)) { res.writeHead(400); res.end('{}'); return; }
    admissions.set(input.id, input);
    res.end(JSON.stringify({ data: { ...input, sessionID: 'target', type: 'user' } }));
  } else if (req.url === '/api/session/target/message?type=user') {
    res.end(JSON.stringify({ data: [...admissions.values()] }));
  } else res.end(JSON.stringify({ data: [], fixtureAuthorization: req.headers.authorization ?? null }));
});
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
process.on('message', (event) => {
  if (event.kind === 'arm') { armed = event.id; process.send({ kind: 'armed' }); }
});
// A finite failsafe even if the test supervisor is interrupted.
setTimeout(() => process.exit(90), 15000).unref();
if (role === 'intermediate') {
  const errorFile = openSync('leaf-stderr.log', 'w');
  const leaf = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf'], {
    env: process.env, stdio: ['ignore', 'ignore', errorFile, 'ipc'], windowsHide: true,
    // Deliberately independent lifetime: exercise cleanup of an orphan rather
    // than the platform's ordinary attached-child lifetime on parent exit.
    detached: true,
  });
  closeSync(errorFile);
  leaf.on('message', (event) => {
    if (event.kind === 'ready') {
      process.send({ kind: 'ready', descendant: leaf.pid, port: event.port });
    }
  });
  process.on('message', (event) => {
    if (event.kind === 'exit-intermediate') process.exit(0);
  });
} else {
  server.listen(0, '127.0.0.1', () => process.send({
    kind: role === 'never-ready' ? 'listening' : 'ready', port: server.address().port,
  }));
}
