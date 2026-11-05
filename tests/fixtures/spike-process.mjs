// TEST ONLY. Synthetic adapter/descendant, not OpenCode or Telegram proof.
import { spawn } from 'node:child_process';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const mode = process.argv[2];
if (mode === 'tree') {
  process.on('message', (message) => { if (message.kind === 'exit-root') process.exit(9); });
  const child = spawn(process.execPath, [process.argv[1], 'leaf'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
  });
  child.on('message', () => process.send({ kind: 'ready', descendant: child.pid }));
} else if (mode === 'adapter') {
  let initialized = false;
  let creationDelay = 0;
  process.on('message', (message) => {
    if (message.kind === 'creation-delay') {
      creationDelay = message.ms;
      process.send({ kind: 'delay-configured' });
    }
  });
  createInterface({ input: process.stdin }).on('line', async (line) => {
    const request = JSON.parse(line);
    const reply = (result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0',
      id: request.id, result })}\n`);
    if (request.method === 'initialize') {
      reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} },
        serverInfo: { name: 'fixture-only', version: '0' } });
      return;
    }
    if (request.method === 'notifications/initialized') { initialized = true; return; }
    if (request.method === 'tools/list' && initialized) {
      reply({ tools: [{ name: 'request_approval', inputSchema: { type: 'object' } }] });
      return;
    }
    if (request.method !== 'tools/call' || !initialized) process.exit(8);
    // Nonmatching frames must not resolve the selected call or be swallowed.
    for (const frame of [
      { jsonrpc: '2.0', method: 'notifications/message', params: { data: 'fixture-only' } },
      { jsonrpc: '2.0', id: '7', result: { fixture: 'string id is not numeric id' } },
      { jsonrpc: '2.0', id: 'server-question', method: 'ping' },
    ]) process.stdout.write(`${JSON.stringify(frame)}\n`);
    await delay(creationDelay);
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
