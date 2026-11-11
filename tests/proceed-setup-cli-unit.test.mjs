// Contract: add-proceed-owned-telegram-setup/design.md decisions 1-2.
// Public CLI dispatch with memory-only dependencies. No terminal/OS proof.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memory, SECRET, ENV_NAME } from './fixtures/proceed-credential-memory.mjs';
const m = await memory();
const credential = await import('../src/state/credential-file.js');
const count = (name) => m.current.events.filter(([event]) => event === name).length;
function restored(result) {
  assert.equal(result.stream.isRaw, result.originalRaw, 'original terminal mode restored');
  for (const name of ['data', 'end', 'error', 'close', 'keypress'])
    assert.equal(
      result.stream.listenerCount(name),
      new Map(result.listeners).get(name) ?? 0,
      `owned ${name} listeners released`,
    );
}

test('SETUP-PRIVATE: Proceed enters private mode before input and restores it after submit', async () => {
  let prompt;
  for (const token of [SECRET, '!', '~'.repeat(4096)]) {
    m.reset();
    const result = await m.invoke({ stream: m.terminal([token, '\r']) });
    assert.equal(result.code, 0);
    assert.equal(m.current.entries.get(m.file)?.bytes.toString(), `${token}\n`);
    assert.ok(
      m.current.events.findIndex(([name, value]) => name === 'raw' && value === true) <
        m.current.events.findIndex(([name]) => name === 'input'),
    );
    assert.ok(result.stderr.length > 0, 'fixed prompt uses operator stderr, not protocol stdout');
    prompt ??= result.stderr;
    assert.equal(result.stderr, prompt, 'prompt reveals neither length nor masking characters');
    assert.match(result.stdout, /same account|same-account/);
    assert.ok(!/valid token|paired successfully|approval received/i.test(result.stdout));
    restored(result);
  }
});

test('SETUP-EDIT: backspace removes a byte without displaying it and preserves prior raw mode', async () => {
  m.reset();
  const result = await m.invoke({
    stream: m.terminal([`${SECRET}x`, '\x7f', '\r'], { isRaw: true }),
  });
  assert.equal(result.code, 0);
  assert.equal(m.current.entries.get(m.file)?.bytes.toString(), `${SECRET}\n`);
  restored(result);
});

test('SETUP-INPUT-REFUSAL: cancellation, EOF, invalid bytes and stream errors never write', async (t) => {
  for (const [name, chunks, settings] of [
    ['cancel', [SECRET, '\x03']],
    ['EOF', [SECRET, null]],
    ['empty submit', ['\r']],
    ['whitespace', [`${SECRET} `, '\r']],
    ['NUL', [`${SECRET}\0`, '\r']],
    ['non-ASCII', [Buffer.from([0xc3, 0xa9]), '\r']],
    ['overlong', ['x'.repeat(4097), '\r']],
    [
      'read error',
      [],
      {
        onRead(stream) {
          stream.destroy(new Error(SECRET));
        },
      },
    ],
  ])
    await t.test(name, async () => {
      m.reset();
      const result = await m.invoke({ stream: m.terminal(chunks, settings) });
      assert.equal(result.code, 2);
      assert.ok(count('input') > 0, 'exercise input failure, not an earlier command refusal');
      assert.equal(count('write'), 0);
      restored(result);
    });
});

test('SETUP-DEADLINE: private input expires at 60 seconds and releases its terminal', async (t) => {
  m.reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = await m.invoke({
    stream: m.terminal([], {
      onRead() {
        t.mock.timers.tick(60000);
      },
    }),
  });
  assert.equal(result.code, 2);
  assert.ok(count('input') > 0, 'deadline exercised after private input readiness');
  assert.equal(count('write'), 0);
  restored(result);
});

test('SETUP-MODE: unavailable private facility refuses without reading or echoed fallback', async () => {
  m.reset();
  const result = await m.invoke({ stream: m.terminal([], { rawUnavailable: true }) });
  assert.equal(result.code, 3);
  assert.equal(count('input'), 0);
  assert.equal(count('write'), 0);
  restored(result);
});

test('SETUP-PREREQUISITES: missing state and existing destination refuse before token input', async (t) => {
  for (const [name, settings, expected] of [
    ['missing state', { noState: true }, 3],
    ['existing destination', {}, 2],
  ])
    await t.test(name, async () => {
      m.reset(settings);
      if (!settings.noState) m.add(m.file, 'file').bytes = Buffer.from('retained-existing');
      const result = await m.invoke({
        stdinMode: true,
        stream: m.terminal([SECRET, null], { isTTY: false }),
      });
      assert.equal(result.code, expected);
      assert.equal(count('input'), 0);
      assert.equal(count('open'), 0, 'existing credential never opened for comparison');
      assert.equal(count('write'), 0);
    });
});

test('SETUP-ARGUMENTS: rejected token values are not reproduced or read as input', async (t) => {
  for (const args of [
    [SECRET],
    [`--${SECRET}`],
    ['--token', SECRET],
    ['--token-stdin', '--token-stdin'],
  ])
    await t.test(`argument form ${args.length}-${args[0].startsWith('--')}`, async () => {
      m.reset();
      const result = await m.invoke({ args });
      assert.equal(result.code, 2);
      assert.equal(count('input'), 0);
      assert.equal(count('write'), 0);
    });
});

test('SETUP-PATH: unsafe ancestry and separated missing destinations refuse before consuming stdin', async (t) => {
  for (const name of ['unsafe ancestry', 'inside state with missing parents'])
    await t.test(name, async () => {
      m.reset();
      if (name === 'unsafe ancestry') m.current.entries.get(m.home).info.mode = 0o777;
      else m.current.destination = m.path.join(m.stateDir, 'new', 'nested', 'telegram.token');
      const result = await m.invoke({
        stdinMode: true,
        stream: m.terminal([SECRET, null], { isTTY: false }),
      });
      assert.equal(result.code, 4);
      assert.equal(count('input'), 0);
      assert.equal(count('write'), 0);
    });
});

test('SETUP-STDIN: explicit nonterminal mode retains EOF/validation and refuses TTY input', async () => {
  m.reset();
  let result = await m.invoke({
    stdinMode: true,
    stream: m.terminal([`${SECRET}\r\n`, null], { isTTY: false }),
    env: { [ENV_NAME]: 'SYNTHETIC_UNUSED_ENVIRONMENT' },
  });
  assert.equal(result.code, 0);
  assert.equal(m.current.entries.get(m.file)?.bytes.toString(), `${SECRET}\n`);
  assert.equal(count('raw'), 0);
  m.reset();
  result = await m.invoke({ stdinMode: true });
  assert.equal(result.code, 2);
  assert.equal(count('input'), 0);
  m.reset();
  result = await m.invoke({
    stream: m.terminal([SECRET, null], { isTTY: false }),
    env: { [ENV_NAME]: SECRET },
  });
  assert.equal(result.code, 2, 'no implicit mode switch or environment capture');
  assert.equal(count('input'), 0);
  assert.equal(count('write'), 0);
});

test('SETUP-STDIN-DEADLINE: explicit input still requires EOF inside its deadline', async (t) => {
  m.reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const stream = m.terminal([], {
    isTTY: false,
    onRead() {
      t.mock.timers.tick(60000);
    },
  });
  await assert.rejects(credential.readTokenFromStdin(stream), { code: 'INVALID_ARGUMENT' });
  assert.equal(stream.destroyed, true);
});

test('SETUP-PARSER: existing byte contract remains bounded without trimming or truncation', () => {
  for (const value of ['!', SECRET, '~'.repeat(4096)])
    for (const ending of ['', '\n', '\r\n'])
      assert.equal(credential.parseTokenInput(Buffer.from(value + ending)), value);
  for (const value of ['', ' ', '\n', '\ufeffx', 'x\0', 'x\ny', 'x'.repeat(4097), 'x\r'])
    assert.throws(() => credential.parseTokenInput(Buffer.from(value)), {
      code: 'INVALID_ARGUMENT',
    });
});
