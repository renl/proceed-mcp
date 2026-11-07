// TEST ONLY. Synthetic protocol setup, never human/TUI or live Telegram proof.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { portable, until } from './portable-waiting.mjs';

export const qualificationScope = Object.freeze({
  harness_id: 'qualification',
  owner_id: 'shared',
});
const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
const post = (h, path, key, body) => h.http(path, key, { method: 'POST', body });

// This is deliberately separate from fixture setup. The later driver must pass
// two independently observed CURRENT product-rendered fingerprints. A caller's
// fixture-only values prove this guard, not rendered enrollment.
export async function confirmQualificationEnrollment(h, operator, proposal, displayed) {
  assert.equal(displayed.local, operator.keyId, 'local displayed fingerprint mismatch');
  assert.equal(displayed.broker, proposal.key_id, 'broker displayed fingerprint mismatch');
  assert.equal(proposal.key_id, operator.keyId, 'substituted enrollment proposal');
  assert.equal(proposal.harness_id, qualificationScope.harness_id);
  assert.equal(proposal.owner_id, qualificationScope.owner_id);
  h.fixture.text(`/harness ${proposal.enrollment_id}`);
  const message = await until(
    () =>
      h.fixture.messages.find(
        (m) =>
          m.text.includes(operator.keyId) &&
          m.reply_markup?.inline_keyboard
            ?.flat()
            .some((b) => /^he:[a-f0-9]{32}$/.test(b.callback_data)),
      ),
    'matching paired enrollment callback',
    h.signal,
  );
  assert.ok(!message.text.includes(operator.credential));
  const callback = message.reply_markup.inline_keyboard
    .flat()
    .find((b) => b.callback_data.startsWith('he:'));
  h.fixture.choose(message, 'he');
  await until(
    async () => {
      const response = await post(
        h,
        '/v1/harness/enrollments',
        operator.credential,
        qualificationScope,
      );
      return response.status === 200 && (await response.json()).state === 'enrolled';
    },
    'paired fixture confirmation activates synthetic operator',
    h.signal,
  );
  // Callback tokens remain private. Only a digest may enter the setup summary.
  return { callbackFingerprint: fingerprint(callback.callback_data), keyId: operator.keyId };
}

export async function withQualificationBroker(work) {
  assert.equal(process.platform, 'linux', 'contained Linux setup required');
  assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');
  const root = '/run/proceed/qualification-private';
  await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'operator-'));
  try {
    return await portable(
      async (h) => {
        assert.equal(h.shared, null, 'setup starts no second owner adapter');
        const file = join(directory, 'operator.token');
        const output = await h.cli('harness', 'keygen', '--operator-key-file', file);
        const bytes = await readFile(file, 'utf8');
        assert.match(bytes, /^hop_[a-f0-9]{64}\n$/);
        const info = await lstat(file);
        assert.equal(info.mode & 0o777, 0o600);
        assert.equal(info.uid, process.geteuid());
        assert.equal(info.nlink, 1);
        const operator = { file, credential: bytes.trim(), keyId: fingerprint(bytes.trim()) };
        assert.ok(output.includes(operator.keyId) && !output.includes(operator.credential));
        const owner = (
          await readFile(join(h.state, 'credentials/owner.shared.token'), 'utf8')
        ).trim();
        for (const key of [owner, h.control]) {
          const response = await post(h, '/v1/harness/enrollments', key, qualificationScope);
          assert.equal(response.status, 403);
          assert.equal((await response.json()).error.code, 'FORBIDDEN');
        }
        const response = await post(
          h,
          '/v1/harness/enrollments',
          operator.credential,
          qualificationScope,
        );
        assert.equal(response.status, 202);
        const proposal = await response.json();
        assert.equal(proposal.state, 'pending');
        assert.equal(proposal.key_id, operator.keyId);
        const pending = () =>
          post(h, '/v1/harness/pending', operator.credential, {
            ...qualificationScope,
            session_id: 'setup-session',
          });
        assert.equal(
          (await pending()).status,
          401,
          'unconfirmed proposal has no operator authority',
        );
        const noWork = async () => {
          const status = await h.http('/v1/status', h.control);
          assert.equal(status.status, 200);
          assert.deepEqual((await status.json()).requests, [], 'setup must create no work');
        };
        await noWork();
        await work({ ...h, operator, proposal, owner, pending, noWork });
        await noWork();
        for (const text of [
          JSON.stringify(h.fixture.calls),
          await readFile(join(h.state, 'journal.log'), 'utf8'),
        ])
          assert.ok(
            !text.includes(operator.credential),
            'operator secret absent from chat/journal',
          );
      },
      { connectAdapter: false },
    );
  } finally {
    await rm(directory, { recursive: true });
    await assert.rejects(access(directory), { code: 'ENOENT' });
  }
}
