// TEST ONLY direct HTTP client process. It never binds a listener or forwards HTTP.
// Started by the owned containment launcher; credentials/config arrive via IPC.
import assert from 'node:assert/strict';
import { publicHTTP } from './public-host.mjs';
let exchange; let selected; let suppressed = false; let busy = false;
let fenced = false; let held = [];
process.on('message', async (message) => {
  try {
    if (message.kind === 'configure') {
      assert.ok(!exchange, 'immutable gate binding');
      assert.match(message.authorization, /^Basic \S+$/);
      exchange = publicHTTP(message.origin, message.authorization);
      process.send({ kind: 'ready' });
      return;
    }
    if (message.kind === 'select') {
      assert.ok(exchange && !selected);
      selected = { path: message.path, id: message.id };
      assert.match(selected.id, /^msg_[a-f0-9]{32}$/);
      process.send({ kind: 'armed' });
      return;
    }
    if (message.kind === 'discard-held') {
      held = []; fenced = false;
      process.send({ kind: 'discarded' });
      return;
    }
    assert.equal(message.kind, 'exchange');
    assert.ok(exchange && !busy, 'serialized gate exchanges');
    if (fenced) {
      assert.ok(held.length < 100, 'gate held-exchange budget');
      held.push(message);
      process.send({ kind: 'reconciliation-fenced', serial: message.serial });
      return;
    }
    busy = true;
    const match = selected && !suppressed && message.method === 'POST' &&
      message.path === selected.path && message.body?.id === selected.id;
    const body = await exchange(message.method, message.path, message.body);
    if (match) {
      assert.equal(body.data?.id, selected.id);
      assert.equal(body.data?.type, 'user');
      assert.equal(body.data?.sessionID, decodeURIComponent(selected.path.split('/')[3]));
      assert.equal(body.data?.payload?.text, message.body.text);
      assert.equal(body.data?.delivery, message.body.delivery);
      suppressed = true;
      // Completion evidence precedes the transport error consumed by broker.
      process.send({ kind: 'host-completed', id: selected.id, body });
      // Expose loss to production, but fence its NEXT reconciliation exchange
      // until broker-only crash. Independent evidence reads bypass this client.
      fenced = true;
      process.send({ kind: 'result', serial: message.serial, transportLoss: true });
      process.send({ kind: 'suppressed', id: selected.id });
    } else process.send({ kind: 'result', serial: message.serial, body });
  } catch (error) {
    process.send({ kind: 'failure', serial: message.serial,
      category: error.kind ?? 'BEHAVIOR', code: error.code ?? 'GATE_ASSERTION' });
  } finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
