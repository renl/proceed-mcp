// TEST ONLY stdio JSON-RPC receipt fault, never a production MCP implementation.
// argv: executable, ...args; env: none. Config arrives privately over harness IPC.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const child = spawn(process.argv[2], process.argv.slice(3), {
  env: process.env, shell: false, windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
});
let heldId;
process.on('message', (message) => {
  if (message.kind === 'hold') { heldId = message.id; process.send({ kind: 'armed' }); }
  else child.send(message);
});
child.on('message', (message) => process.send(message));
child.on('error', () => process.exit(1));
child.on('exit', () => process.exit(1));
child.stderr.resume(); // No raw output retained or forwarded.
process.stdin.pipe(child.stdin);
createInterface({ input: child.stdout }).on('line', (line) => {
  const frame = JSON.parse(line);
  if (frame.id === heldId && ('result' in frame || 'error' in frame)) {
    process.send({ kind: 'receipt-withheld' });
  } else process.stdout.write(`${line}\n`);
});
process.send({ kind: 'ready', descendant: child.pid });
