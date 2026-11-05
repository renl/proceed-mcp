// SPIKE-VERSION-001: ordinary product admission, never host calibration.
// Active design sections 3/6/7; journal pairing is setup, not proof.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createFileHeader, encodeFrame } from '../src/journal/framing.js';
import { guards, stopped } from './support/startup-guards.mjs';

test('VERSION-EMPTY: ordinary well-shaped unknown host is UNSUPPORTED_HOST', () => guards(
  async ({ state, config, cli, start }) => {
    const calls = [];
    const host = createServer((request, response) => {
      calls.push({ path: request.url, method: request.method,
        authenticated: request.headers.authorization ===
          `Basic ${Buffer.from('opencode:offline-fixture-not-a-secret').toString('base64')}` });
      response.setHeader('content-type', 'application/json');
      if (request.url === '/api/info') {
        response.end(JSON.stringify({ version: 'unreviewed-fixture-build', pid: 12345 }));
      } else if (request.url === '/api/session/ses_fixture') {
        response.end(JSON.stringify({ data: { id: 'ses_fixture', title: 'Fixture',
          time: { created: 1 } } }));
      } else {
        response.statusCode = 404;
        response.end('{}');
      }
    });
    await new Promise((done, reject) => {
      host.once('error', reject);
      host.listen(0, '127.0.0.1', done);
    });
    const port = host.address().port;
    try {
      cli('origin', 'add', 'fixture', '--url', `http://127.0.0.1:${port}`,
        '--password-env', 'PROCEED_TEST_HOST_PASSWORD');
      const journal = join(state, 'journal.log');
      const bytes = Buffer.concat([createFileHeader(), encodeFrame({ sequence: 1,
        committedAt: '2026-01-01T00:00:00.000Z', mutations: [{ op: 'pairing.set',
          pairing: { user_id: '123', chat_id: '123', paired_at: '2026-01-01T00:00:00.000Z' } }],
      })]);
      await writeFile(journal, bytes);
      const child = await start();
      await child.wait('broker-ready');
      const credential = (await readFile(join(state, 'credentials/origin.fixture.token'), 'utf8')).trim();
      const result = await fetch(`http://127.0.0.1:${config.broker.port}/v1/requests`, {
        method: 'POST', signal: AbortSignal.timeout(3000),
        headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: 'ses_fixture', client_request_id: 'unknown_version',
          action: 'Controlled offline request', context: '' }),
      });
      const body = await result.json();
      await stopped(child);
      assert.ok(calls.some((call) => call.path === '/api/info'), 'actual version diagnostic requested');
      assert.ok(calls.every((call) => call.authenticated), 'fixed-origin Basic authentication retained');
      assert.deepEqual({ status: result.status, code: body.error?.code },
        { status: 503, code: 'UNSUPPORTED_HOST' },
        'empty reviewed support set must refuse a well-shaped unlisted host');
      assert.deepEqual(await readFile(journal), bytes, 'no durable request for an unsupported host');
      assert.ok(calls.every((call) => call.method === 'GET'), 'no decision prompt admission');
    } finally {
      host.closeAllConnections();
      await new Promise((done) => host.close(done));
      // Verify this run-owned listener was released, not just requested closed.
      assert.equal(host.listening, false);
    }
  }));
