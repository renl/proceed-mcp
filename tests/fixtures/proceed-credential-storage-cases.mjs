// Shared contract suite. The actual product admission logic judges synthetic observations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SECRET } from './proceed-credential-memory.mjs';
export function storageCases(m, credential) {
  const events = () => m.current.events;
  const writes = () => events().filter(([name]) => name === 'write');
  const setup = () =>
    credential.provisionCredentialFile({ file: m.file, stateDir: m.stateDir, token: SECRET });
  const load = () => credential.loadCredentialFile({ file: m.file, stateDir: m.stateDir });
  function existing() {
    m.add(m.file, 'file').bytes = Buffer.from(`${SECRET}\n`);
  }
  function safeError(error) {
    assert.equal(error.code, 'PROTECTION_UNVERIFIED');
    assert.ok(!error.message.includes(SECRET));
    return true;
  }
  test(`${m.platform}: STORE-SUCCESS create-only persistence and later broker loading`, async () => {
    m.reset();
    const retained = m.snapshot();
    await setup();
    assert.equal(m.current.entries.get(m.file).bytes.toString(), `${SECRET}\n`);
    assert.deepEqual(m.snapshot(), retained);
    assert.ok(events().some(([name]) => name === 'sync'));
    if (m.platform === 'win32') {
      const written = events().findIndex(([name]) => name === 'write');
      assert.ok(
        events()
          .slice(0, written)
          .some(([name, target]) => name === 'admit' && target === m.file),
      );
      const flushed = events().findIndex(([name]) => name === 'sync');
      assert.ok(
        events()
          .slice(flushed + 1)
          .some(([name, target]) => name === 'admit' && target === m.file),
      );
    }
    m.current.events = [];
    assert.equal(await load(), SECRET);
    if (m.platform === 'win32') {
      const read = events().findIndex(([name]) => name === 'read');
      assert.ok(
        events()
          .slice(0, read)
          .some(([name, target]) => name === 'admit' && target === m.file),
      );
      assert.ok(
        events()
          .slice(read + 1)
          .some(([name, target]) => name === 'admit' && target === m.file),
      );
      assert.ok(
        m.current.queries.every(
          ({ args, options }) => !JSON.stringify({ args, options }).includes(SECRET),
        ),
      );
    }
  });
  test(`${m.platform}: STORE-DIRECTORIES missing dedicated components are admitted before descent`, async () => {
    m.reset();
    const destination = m.path.join(m.parent, 'new', 'nested', 'telegram.token');
    await credential.provisionCredentialFile({
      file: destination,
      stateDir: m.stateDir,
      token: SECRET,
    });
    assert.equal(m.current.entries.get(destination).bytes.toString(), `${SECRET}\n`);
    if (m.platform === 'win32') {
      const mkdirs = events().filter(([name]) => name === 'mkdir');
      for (let index = 0; index < mkdirs.length; index++) {
        const position = events().indexOf(mkdirs[index]);
        const next =
          index + 1 < mkdirs.length
            ? events().indexOf(mkdirs[index + 1])
            : events().findIndex(([name]) => name === 'write');
        assert.ok(
          events()
            .slice(position + 1, next)
            .some(([name, target]) => name === 'admit' && target === mkdirs[index][1]),
        );
      }
    }
  });
  test(`${m.platform}: STORE-COLLISION preserves initial and racing destinations`, async (t) => {
    for (const race of [false, true])
      await t.test(race ? 'exclusive-create race' : 'initial collision', async () => {
        m.reset({ race });
        if (!race) existing();
        await assert.rejects(setup(), { code: 'TELEGRAM_CREDENTIAL_EXISTS' });
        assert.equal(writes().length, 0);
        assert.ok(!events().some(([name]) => name === 'read' || name === 'unlink'));
        assert.equal(
          m.current.entries.get(m.file).bytes.toString(),
          race ? 'racing-existing' : `${SECRET}\n`,
        );
      });
  });
  test(`${m.platform}: STORE-IDENTITY opened wrong identity, kind or links refuses before content`, async (t) => {
    for (const [name, openedInfo] of [
      ['identity', (v) => ({ ...v, ino: v.ino + 1 })],
      ['multiple links', (v) => ({ ...v, nlink: 2 })],
      ['nonregular', (v) => ({ ...v, isFile: () => false })],
    ])
      await t.test(name, async () => {
        m.reset({ openedInfo });
        existing();
        await assert.rejects(load(), safeError);
        assert.ok(!events().some(([event]) => event === 'read'));
      });
  });
  test(`${m.platform}: STORE-RECHECK identity or ancestry change discards loaded token`, async (t) => {
    for (const [name, afterRead] of [
      [
        'identity',
        (entry) => {
          entry.info.ino++;
        },
      ],
      [
        'ancestry',
        () => {
          m.current.entries.get(m.home).info.isSymbolicLink = () => true;
        },
      ],
      [
        'directory protection',
        () => {
          m.current.entries.get(m.parent).info.mode = 0o777;
          m.current.metadata = (entry) => {
            if (entry.path === m.parent && entry.object) entry.object.owner_sid = 'S-1-5-18';
            return entry;
          };
        },
      ],
    ])
      await t.test(name, async () => {
        m.reset({ afterRead });
        existing();
        await assert.rejects(load(), safeError);
      });
  });
  test(`${m.platform}: STORE-WRITE-RECHECK changed ancestry cannot report success`, async () => {
    m.reset({
      afterSync() {
        m.current.entries.get(m.home).info.isSymbolicLink = () => true;
      },
    });
    await assert.rejects(setup(), safeError);
  });
  test(`${m.platform}: STORE-CLEANUP uncertain created file preserved on write failure`, async () => {
    m.reset({ writeFailure: true });
    await assert.rejects(setup());
    assert.ok(m.current.entries.has(m.file));
    assert.ok(!events().some(([name]) => name === 'unlink'));
  });
  test(`${m.platform}: STORE-SEPARATION missing parents never put a credential inside state/config`, async (t) => {
    for (const forbidden of [
      m.stateDir,
      m.packageRoot,
      m.path.join(m.home, '.config', 'opencode'),
      m.path.join(m.home, '.opencode'),
    ])
      await t.test(m.path.basename(forbidden), async () => {
        m.reset();
        const destination = m.path.join(forbidden, 'not-created', 'nested', 'telegram.token');
        await assert.rejects(
          credential.provisionCredentialFile({
            file: destination,
            stateDir: m.stateDir,
            token: SECRET,
          }),
          safeError,
        );
        assert.equal(writes().length, 0);
      });
  });
  test(`${m.platform}: STORE-BOUNDS oversized/malformed selected content never becomes a token`, async () => {
    for (const value of ['', 'bad token\n', 'x'.repeat(4099)]) {
      m.reset();
      existing();
      m.current.entries.get(m.file).bytes = Buffer.from(value);
      await assert.rejects(load(), { code: 'TELEGRAM_CREDENTIAL_UNAVAILABLE' });
    }
  });
  test(`${m.platform}: STORE-READ-BOUND content growth cannot cause an unbounded read`, async () => {
    m.reset({ openedInfo: (v) => ({ ...v, size: 0 }) });
    existing();
    m.current.entries.get(m.file).bytes = Buffer.from('x'.repeat(4099));
    await assert.rejects(load(), { code: 'TELEGRAM_CREDENTIAL_UNAVAILABLE' });
    for (const [name, , length] of events())
      if (name === 'read')
        assert.ok(
          Number.isInteger(length) && length <= 4098,
          'bound actual content access, not only the earlier size observation',
        );
  });
}
