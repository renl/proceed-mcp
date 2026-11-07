// Native controls verify the scanner and W3 test completeness, NOT real TLS proof.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { scanRequiredCaptures } from './support/harness-transport-fixtures.mjs';

test('W3 raw scanner fails closed on missing, malformed or leaking complete capture', () => {
  const surfaces = ['tui', 'telegram', 'journal', 'diagnostics', 'evidence'];
  const safe = Object.fromEntries(surfaces.map((s) => [s, Buffer.from('safe complete bytes')]));
  assert.equal(scanRequiredCaptures(safe, ['private-marker'], surfaces).status, 'PASS');
  for (const surface of surfaces) {
    const missing = { ...safe };
    delete missing[surface];
    assert.throws(
      () => scanRequiredCaptures(missing, ['private-marker'], surfaces),
      /missing raw capture/,
    );
    assert.throws(() =>
      scanRequiredCaptures(
        { ...safe, [surface]: 'not a raw buffer' },
        ['private-marker'],
        surfaces,
      ),
    );
    assert.throws(
      () =>
        scanRequiredCaptures(
          { ...safe, [surface]: Buffer.from('prefix private-marker suffix') },
          ['private-marker'],
          surfaces,
        ),
      /authority leaked/,
    );
  }
});

test('W3 maintained composition uses actual product loader/operator client and fail-closed export', async () => {
  const helper = await readFile(
    new URL('./support/harness-runtime-transport.mjs', import.meta.url),
    'utf8',
  );
  assert.match(helper, /loadOperatorKeyFile/);
  assert.match(helper, /createOperatorLocalClient/);
  const fixtures = await readFile(
    new URL('./support/harness-transport-fixtures.mjs', import.meta.url),
    'utf8',
  );
  for (const id of [
    'limit-exact',
    'limit-over',
    'original-budget',
    'handshake-stall',
    'abort',
    'reconnect',
    'record-next',
    'record-during',
    'relay',
    'redirect',
  ])
    assert.ok(fixtures.includes(`'${id}'`));
  const runner = await readFile(
    new URL('./support/harness-linux-runner.mjs', import.meta.url),
    'utf8',
  );
  assert.ok(runner.indexOf('scan-pass.json') < runner.indexOf("'transport-summary.json'"));
  assert.match(runner, /created && !transport/);
});
