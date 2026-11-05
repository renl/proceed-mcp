// TEST ONLY public stdio relay. Host command: node this-file node bin/... mcp ...
// Named-pipe/Unix-socket address is run-owned harness IPC, not a product endpoint.
import { spawn } from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';

function frames(stream, consume) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (text) => {
    buffer += text;
    assert.ok(Buffer.byteLength(buffer) <= 65536, 'relay frame budget');
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line) consume(JSON.parse(line));
    }
  });
}
const channel = process.env.PROCEED_TEST_CHANNEL;
assert.ok(channel, 'run-owned IPC channel required');
const socket = net.connect(channel);
const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC']
  .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
const child = spawn(process.argv[2], process.argv.slice(3), {
  env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
const send = (value) => socket.write(`${JSON.stringify(value)}\n`);
let selection; let heldId; let initializeId;
const fail = () => { child.kill(); socket.destroy(); process.exitCode = 1; process.stdin.destroy(); };
const timer = setTimeout(fail, 150000);
socket.on('connect', () => send({ kind: 'relay-ready', pid: process.pid, descendant: child.pid }));
socket.on('error', fail);
socket.on('close', fail);
child.on('error', fail);
child.on('exit', () => { clearTimeout(timer); fail(); });
child.stderr.resume(); // Never forward product diagnostics into MCP stdout/evidence.
frames(socket, (message) => {
  assert.equal(message.kind, 'arm');
  assert.ok(!selection);
  selection = message;
  send({ kind: 'armed' });
});
frames(process.stdin, (frame) => {
  if (frame.method === 'initialize') {
    assert.equal(frame.params?.protocolVersion, '2025-11-25');
    initializeId = frame.id;
  }
  if (frame.method === 'tools/call' && frame.params?.name === 'request_approval') {
    assert.ok(selection, 'selected tool cannot run before relay is armed');
  }
  if (frame.method === 'tools/call' && frame.params?.name === 'request_approval' &&
      frame.params.arguments?.client_request_id === selection?.clientRequestId) {
    assert.equal(heldId, undefined, 'duplicate selected call');
    assert.equal(frame.params._meta?.['ai.opencode/sessionID'], selection.sessionId);
    heldId = frame.id;
    send({ kind: 'host-call', id: frame.id });
  }
  child.stdin.write(`${JSON.stringify(frame)}\n`);
});
frames(child.stdout, (frame) => {
  if (initializeId !== undefined && frame.id === initializeId) {
    assert.equal(frame.result?.protocolVersion, '2025-11-25');
    send({ kind: 'handshake-observed', protocolVersion: frame.result.protocolVersion });
    initializeId = undefined;
  }
  if (heldId !== undefined && frame.id === heldId && ('result' in frame || 'error' in frame)) {
    assert.equal(frame.result?.isError, false, 'only successful receipt may be withheld');
    const receipt = frame.result.structuredContent;
    assert.equal(receipt.client_request_id, selection.clientRequestId);
    assert.equal(receipt.session_id, selection.sessionId);
    assert.equal(receipt.resolution, 'pending');
    send({ kind: 'receipt-withheld', receipt });
  } else process.stdout.write(`${JSON.stringify(frame)}\n`);
});
