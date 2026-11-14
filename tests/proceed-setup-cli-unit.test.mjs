// Contract: add-proceed-owned-telegram-setup/design.md decisions 1-2.
// Public CLI dispatch with memory-only dependencies. No terminal/OS proof.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { memory, SECRET, ENV_NAME } from './fixtures/proceed-credential-memory.mjs';
const m = await memory();
const credential = await import('../src/state/credential-file.js');
const { readTokenFromTerminal } = await import('../src/cli/terminal-input.js');
const count = (name) => m.current.events.filter(([event]) => event === name).length;
function trackTimers(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const outstanding = new Set();
  const schedule = globalThis.setTimeout;
  const clear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = schedule(() => {
      outstanding.delete(timer);
      callback(...args);
    }, delay);
    outstanding.add(timer);
    return timer;
  });
  t.mock.method(globalThis, 'clearTimeout', (timer) => {
    outstanding.delete(timer);
    return clear(timer);
  });
  return () => assert.equal(outstanding.size, 0, 'no reader deadline remains scheduled');
}
function restored(result) {
  assert.equal(result.stream.isRaw, result.originalRaw, 'original terminal mode restored');
  for (const name of ['data', 'end', 'error', 'close', 'keypress'])
    assert.equal(
      result.stream.listenerCount(name),
      new Map(result.listeners).get(name) ?? 0,
      `owned ${name} listeners released`,
    );
  if (count('input') > 0 && !result.stream.destroyed && !result.stream.readableEnded)
    assert.equal(result.stream.isPaused(), true, 'reader-started input activity stopped');
}

// Design decisions 1-2: real Node Readable behavior, synthetic terminal mode only.
// These units prove ownership cleanup, not native terminal enforcement or exit.
test('SETUP-LIFECYCLE: release idle input and preserve caller-active input', async (t) => {
  for (const prior of ['idle', 'paused', 'flowing']) {
    for (const outcome of ['submit', 'cancel']) {
      await t.test(`${prior} ${outcome}`, async (t) => {
        const timersReleased = trackTimers(t);
        m.reset();
        const stream = m.terminal([], { isRaw: prior === 'flowing', onRead() {} });
        t.after(() => stream.destroy());
        const received = [];
        const callerData = (chunk) => received.push(chunk.toString());
        const callerEnd = () => {};
        stream.on('end', callerEnd);
        if (prior === 'flowing') {
          stream.on('data', callerData);
          await nextTurn();
        } else if (prior === 'paused') stream.pause();
        const originalRaw = stream.isRaw;
        const listeners = stream.eventNames().map((name) => [name, stream.listeners(name)]);
        const pending = readTokenFromTerminal(stream, { stderr: { write() {} } });
        let completed = false;
        const result = pending.then(
          (value) => {
            completed = true;
            return { value };
          },
          (error) => {
            completed = true;
            return { error };
          },
        );
        await nextTurn();
        stream.push(Buffer.from(outcome === 'submit' ? `${SECRET}\r` : '\x03'));
        await nextTurn();
        const completedFromInput = completed;
        if (!completed) t.mock.timers.tick(60000);
        const settled = await result;
        timersReleased();
        assert.equal(completedFromInput, true, 'reader consumes input without caller restart');
        if (outcome === 'submit') assert.equal(settled.value, SECRET);
        else assert.equal(settled.error?.name, 'CliError');
        assert.equal(stream.isRaw, originalRaw);
        assert.equal(stream.destroyed, false, 'shared input stays open');
        for (const name of ['data', 'end', 'error', 'close'])
          assert.deepEqual(stream.listeners(name), new Map(listeners).get(name) ?? []);
        if (prior === 'flowing') {
          stream.push(Buffer.from('caller-after-cleanup'));
          await nextTurn();
          assert.ok(received.includes('caller-after-cleanup'), 'caller continues without restart');
        } else {
          assert.equal(stream.isPaused(), true, 'input acquired by reader stops');
          stream.on('data', callerData);
          stream.resume();
          stream.push(Buffer.from('reused-after-cleanup'));
          await nextTurn();
          assert.ok(received.includes('reused-after-cleanup'), 'input can be reused');
        }
        assert.equal(stream.listeners('end').includes(callerEnd), true);
      });
    }
  }
});

test('SETUP-LIFECYCLE: partial setup and premature close release acquired resources', async (t) => {
  for (const failure of ['raw acquisition', 'listener installation', 'prompt output', 'close']) {
    await t.test(failure, async (t) => {
      const timersReleased = trackTimers(t);
      m.reset();
      const stream = m.terminal([], { onRead() {} });
      t.after(() => stream.destroy());
      const callerEnd = () => {};
      stream.on('end', callerEnd);
      const setRawMode = stream.setRawMode.bind(stream);
      if (failure === 'raw acquisition') {
        stream.setRawMode = (value) => {
          setRawMode(value);
          if (value) throw new Error(SECRET);
          return stream;
        };
      }
      const on = stream.on.bind(stream);
      if (failure === 'listener installation') {
        stream.on = (name, listener) => {
          on(name, listener);
          if (name === 'end') throw new Error(SECRET);
          return stream;
        };
      }
      const result = readTokenFromTerminal(stream, {
        stderr: {
          write() {
            if (failure === 'prompt output') throw new Error(SECRET);
          },
        },
      }).then(
        () => ({ succeeded: true }),
        (error) => ({ error }),
      );
      if (failure === 'close') {
        await nextTurn();
        stream.emit('close');
      }
      const { error } = await result;
      timersReleased();
      assert.ok(error, 'failure rejects');
      assert.ok(!error.message.includes(SECRET), 'failure does not expose exception content');
      assert.equal(stream.isRaw, false, 'partial raw-mode acquisition restored');
      assert.equal(stream.destroyed, false);
      for (const name of ['data', 'error', 'close']) assert.deepEqual(stream.listeners(name), []);
      assert.deepEqual(stream.listeners('end'), [callerEnd]);
      if (failure !== 'raw acquisition')
        assert.equal(stream.isPaused(), true, 'acquired input activity released');
    });
  }
});

test('SETUP-LIFECYCLE: completion output failure rejects safely after releasing input', { timeout: 1000 }, async (t) => {
  const timersReleased = trackTimers(t);
  m.reset();
  const stream = m.terminal([], { onRead() {} });
  t.after(() => stream.destroy());
  const result = readTokenFromTerminal(stream, {
    stderr: {
      write(text) {
        if (text === '\n') throw new Error(SECRET);
      },
    },
  }).then(
    () => ({ succeeded: true }),
    (error) => ({ error }),
  );
  await nextTurn();
  assert.doesNotThrow(
    () => stream.emit('data', Buffer.from(`${SECRET}\r`)),
    'output failure must settle the reader rather than escape the input callback',
  );
  const { error } = await result;
  assert.ok(error, 'output failure rejects');
  assert.ok(!error.message.includes(SECRET), 'raw exception content stays private');
  timersReleased();
  assert.equal(stream.isRaw, false);
  assert.equal(stream.isPaused(), true);
  assert.equal(stream.destroyed, false);
  for (const name of ['data', 'end', 'error', 'close'])
    assert.deepEqual(stream.listeners(name), []);
});

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
    assert.match(result.stdout, /plaintext/i);
    assert.ok(!/owner.only|same.account protection|prepare.*inheritance/i.test(result.stdout));
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

test('SETUP-LIFECYCLE: credential write failure occurs after input release', async () => {
  m.reset({ writeFailure: true });
  const stream = m.terminal([SECRET, '\r']);
  try {
    const result = await m.invoke({ stream });
    assert.notEqual(result.code, 0);
    assert.equal(count('write'), 1, 'accepted input reaches persistence failure');
    restored(result);
    assert.equal(stream.destroyed, false, 'persistence failure does not close shared input');
  } finally {
    stream.destroy();
  }
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
  for (const name of ['redirected ancestry', 'inside state with missing parents'])
    await t.test(name, async () => {
      m.reset();
      if (name === 'redirected ancestry')
        m.current.entries.get(m.home).info.isSymbolicLink = () => true;
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

test('SETUP-PATH: installation container refuses before either input mode', async (t) => {
  for (const stdinMode of [false, true])
    await t.test(stdinMode ? 'explicit stdin' : 'private terminal', async () => {
      m.reset();
      m.current.destination = m.path.join(m.root, 'SyntheticInstall', 'missing', 'telegram.token');
      const result = await m.invoke({
        stdinMode,
        stream: m.terminal([SECRET, null], { isTTY: !stdinMode }),
      });
      assert.equal(result.code, 4);
      assert.match(result.stderr, /PROTECTION_UNVERIFIED/);
      assert.equal(count('input'), 0);
      assert.equal(count('open'), 0);
      assert.equal(count('write'), 0);
      assert.equal(count('read'), 0);
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
