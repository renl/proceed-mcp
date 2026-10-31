// TEST ONLY: no product request, credentials, timer-result, or execution bypass.
import { createInterface } from 'node:readline';
import { performance } from 'node:perf_hooks';

const emit = (event, fields = {}) => process.stderr.write(JSON.stringify({ event, at: performance.now(), ...fields }) + '\n');
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
let initialized = false, notified = false, catalog = false, pending;
const lines = createInterface({ input: process.stdin });
emit('observer-ready', { pid: process.pid });
lines.on('line', line => {
  try {
    if (line.length > 16384) throw new Error('FRAME_BUDGET');
    const r = JSON.parse(line);
    if (r.jsonrpc !== '2.0') throw new Error('JSONRPC');
    if (r.method === 'initialize' && !initialized && r.params?.protocolVersion === '2025-11-25') {
      initialized = true; emit('initialize');
      send(r.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} },
        serverInfo: { name: 'test-calibration', version: '0.0.0' } });
    } else if (r.method === 'notifications/initialized' && initialized) {
      notified = true; emit('initialized');
    } else if (r.method === 'tools/list' && notified) {
      catalog = true; emit('catalog'); send(r.id, { tools: [{ name: 'calibration_wait',
        description: 'Controlled test wait; never an approval.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
    } else if (r.method === 'tools/call' && catalog && !pending && r.params?.name === 'calibration_wait' &&
      typeof r.params?._meta?.['ai.opencode/sessionID'] === 'string' &&
      r.id !== undefined && r.params.arguments && Object.keys(r.params.arguments).length === 0) {
      pending = r; emit('call', { id: r.id, sessionID: r.params._meta['ai.opencode/sessionID'] });
      // Deliberately no response: only the controlled release below sends a result.
    } else if (r.method === 'notifications/cancelled' && pending && r.params?.requestId === pending.id) {
      emit('cancel', { id: pending.id }); // Observation only; not a timeout verdict.
    } else if (r.method === 'notifications/calibration/release' && pending) {
      emit('result', { id: pending.id }); send(pending.id, { content: [{ type: 'text', text: 'controlled release' }] });
      pending = undefined;
    } else throw new Error('ORDER_OR_SHAPE');
  } catch {
    emit('protocol-error');
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid calibration request' } }) + '\n');
  }
});
lines.on('close', () => { emit('eof'); });
