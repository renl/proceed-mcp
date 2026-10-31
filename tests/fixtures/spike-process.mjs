// TEST ONLY. Synthetic adapter/descendant, not OpenCode or Telegram proof.
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const mode = process.argv[2];
if (mode === 'tree') {
  process.on('message', (message) => { if (message.kind === 'exit-root') process.exit(9); });
  const child = spawn(process.execPath, [process.argv[1], 'leaf'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  child.on('message', () => process.send({ kind: 'ready', descendant: child.pid }));
} else if (mode === 'adapter') {
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const request = JSON.parse(line);
    // A real filesystem commit in a fake adapter, NOT product journal proof.
    const file = await open('fixture-request.json', 'wx');
    await file.writeFile(JSON.stringify({ request_id: 'fixture-request', resolution: 'pending' }));
    await file.sync();
    await file.close();
    process.send({ kind: 'durable-created' });
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id,
      result: { content: [{ type: 'text', text: 'fixture receipt' }] } })}\n`);
  });
  process.send({ kind: 'adapter-ready' });
} else if (mode !== 'never-ready') process.send({ kind: 'ready' });
setInterval(() => {}, 1000);
