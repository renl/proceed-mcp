// TEST ONLY. Active add-harness-approval-channel design sections 1-3.
// Real broker/TLS/files, synthetic paired-chat transport. NOT OpenCode/TUI proof.
// Run via: node tests/run-automatic-startup.mjs harness
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { portable, until } from './support/portable-waiting.mjs';

assert.equal(process.platform, 'linux', 'BLOCKED: use the maintained isolated runner');
assert.equal(process.versions.node, '24.22.2');
assert.equal(process.env.PROCEED_TEST_FIXTURES, '/fixtures');
assert.equal(process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE, '1');

const scope = { harness_id: 'qualification', owner_id: 'shared' };
const credential = () => `hop_${randomBytes(32).toString('hex')}`;
const fingerprint = (key) => createHash('sha256').update(key).digest('hex');
const post = (h, path, key, body, headers = {}) =>
  h.http(path, key, { method: 'POST', body, headers });

async function error(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.schema_version, 1);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'schema_version']);
  assert.deepEqual(Object.keys(body.error).sort(), ['code', 'message', 'retryable']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  assert.equal(typeof body.error.retryable, 'boolean');
}

async function enroll(h, key) {
  const response = await post(h, '/v1/harness/enrollments', key, scope);
  assert.equal(response.status, 202, 'new synthetic operator proposal must be admitted');
  const proposal = await response.json();
  assert.equal(proposal.schema_version, 1);
  assert.equal(proposal.state, 'pending');
  assert.equal(proposal.key_id, fingerprint(key));
  assert.equal(proposal.harness_id, scope.harness_id);
  assert.equal(proposal.owner_id, scope.owner_id);
  assert.match(proposal.enrollment_id, /^hen_[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(proposal.expires_at)));
  const replay = await post(h, '/v1/harness/enrollments', key, scope);
  assert.equal(replay.status, 202);
  assert.deepEqual(await replay.json(), proposal, 'replay cannot renew the enrollment');
  const pendingBody = { ...scope, session_id: 'session-a' };
  await error(await post(h, '/v1/harness/pending', key, pendingBody), 401, 'AUTH_REQUIRED');
  await error(
    await post(h, '/v1/harness/enrollments', credential(), scope),
    409,
    'ENROLLMENT_BUSY',
  );
  // Setup submits the actual enrollment ID through the existing chat consumer.
  // No internal broker methods, state edits or new product test APIs.
  h.fixture.text(`/harness ${proposal.enrollment_id}`);
  const message = await until(
    () =>
      h.fixture.messages.find((m) =>
        m.reply_markup?.inline_keyboard
          ?.flat()
          .some((b) => /^he:[a-f0-9]{32}$/.test(b.callback_data)),
      ),
    'paired-chat enrollment confirmation controls',
    h.signal,
  );
  assert.ok(message.text.includes(proposal.key_id), 'paired human can compare public fingerprint');
  assert.ok(!message.text.includes(key), 'no operator credential in enrollment message');
  const confirm = message.reply_markup.inline_keyboard
    .flat()
    .find((b) => b.callback_data.startsWith('he:')).callback_data;
  h.fixture.enqueue({
    callback_query: {
      id: 'wrong-pairing',
      from: { id: 8, is_bot: false },
      message,
      data: confirm,
    },
  });
  // Observe completion of this callback, not completion of the next long poll.
  // The latter cannot finish until a future update is enqueued by this test.
  await until(
    () =>
      h.fixture.calls.some(
        (call) =>
          call.method === 'answerCallbackQuery' && call.body.callback_query_id === 'wrong-pairing',
      ),
    'wrong-sender callback acknowledged before checking authority',
    h.signal,
  );
  await error(await post(h, '/v1/harness/pending', key, pendingBody), 401, 'AUTH_REQUIRED');
  h.fixture.choose(message, 'he');
  await until(
    async () => {
      const observed = await post(h, '/v1/harness/enrollments', key, scope);
      const value = await observed.json();
      return observed.status === 200 && value.state === 'enrolled';
    },
    'matching paired confirmation activates key',
    h.signal,
  );
  const status = await h.http('/v1/status', h.control);
  assert.equal(status.status, 200);
  assert.deepEqual((await status.json()).requests, [], 'enrollment never approves or creates work');
}

test('HARNESS-KEYGEN: public create-only protected operator file', { timeout: 65000 }, () =>
  portable(
    async (h) => {
      const directory = join(dirname(h.state), 'operator-credentials');
      await mkdir(directory, { mode: 0o700 });
      const file = join(directory, 'operator.token');
      const output = await h.cli('harness', 'keygen', '--operator-key-file', file);
      const bytes = await readFile(file, 'utf8');
      assert.match(bytes, /^hop_[a-f0-9]{64}\n$/);
      const info = await lstat(file);
      assert.equal(info.isFile(), true);
      assert.equal(info.mode & 0o777, 0o600);
      assert.equal(info.uid, process.geteuid());
      assert.equal(info.nlink, 1);
      assert.ok(output.includes(fingerprint(bytes.trim())));
      assert.ok(!output.includes(bytes.trim()), 'keygen never exports private authority');
      const repeat = await h.start('harness', 'keygen', '--operator-key-file', file);
      repeat.child.stdin.end();
      await until(() => repeat.closed, 'existing destination refused', h.signal);
      assert.equal(repeat.child.exitCode, 2);
      assert.equal(await readFile(file, 'utf8'), bytes, 'existing key never replaced');
      assert.deepEqual((await (await h.http('/v1/status', h.control)).json()).requests, []);
    },
    { strictProtocol: true },
  ),
);

test(
  'HARNESS-ENROLL: paired confirmation, role separation and secret exclusion',
  { timeout: 65000 },
  () =>
    portable(
      async (h) => {
        const key = credential();
        await enroll(h, key);
        const owner = (
          await readFile(join(h.state, 'credentials/owner.shared.token'), 'utf8')
        ).trim();
        for (const ordinary of [owner, h.control]) {
          await error(await post(h, '/v1/harness/enrollments', ordinary, scope), 403, 'FORBIDDEN');
          await error(await post(h, '/v1/harness/decisions', ordinary, {}), 403, 'FORBIDDEN');
        }
        await error(
          await post(h, '/v1/harness/pending', credential(), {
            ...scope,
            session_id: 'session-a',
          }),
          401,
          'AUTH_REQUIRED',
        );
        await error(
          await post(h, '/v1/harness/pending', key, {
            ...scope,
            owner_id: 'foreign',
            session_id: 'session-a',
          }),
          403,
          'FORBIDDEN',
        );
        await error(await h.http('/v1/ready', key), 403, 'FORBIDDEN');
        const pending = await post(h, '/v1/harness/pending', key, {
          ...scope,
          session_id: 'session-a',
        });
        assert.equal(pending.status, 200, 'positive control excludes blanket denial stubs');
        assert.deepEqual(await pending.json(), { schema_version: 1, presentation: null });
        for (const text of [
          JSON.stringify(h.fixture.calls),
          (await readFile(join(h.state, 'journal.log'))).toString(),
        ])
          assert.ok(!text.includes(key), 'no plaintext operator authority in chat or journal');
      },
      { strictProtocol: true },
    ),
);

test(
  'HARNESS-BINDING: isolated sessions, busy, reverse outcomes and inert stale bindings',
  { timeout: 65000 },
  () =>
    portable(
      async (h) => {
        const key = credential();
        await enroll(h, key);
        const owner = (
          await readFile(join(h.state, 'credentials/owner.shared.token'), 'utf8')
        ).trim();
        const reserve = async (session) => {
          const response = await post(h, '/v1/handles', owner, {
            session_label: 'equal labels',
            harness_route: { harness_id: scope.harness_id, session_id: session },
          });
          assert.equal(response.status, 201);
          return response.json();
        };
        const create = (session, handle, clientId) =>
          post(
            h,
            '/v1/requests',
            owner,
            {
              request_handle: handle.request_handle,
              client_request_id: clientId,
              action: 'Synthetic isolated question',
              context: 'Not executable',
              expires_in_seconds: 60,
              harness_route: { harness_id: scope.harness_id, session_id: session },
            },
            { 'X-Proceed-Request-Capability': handle.request_capability },
          );
        const present = async (session) => {
          const response = await post(h, '/v1/harness/pending', key, {
            ...scope,
            session_id: session,
          });
          assert.equal(response.status, 200);
          return (await response.json()).presentation;
        };
        const decide = (p, choice, response_text = null) =>
          post(h, '/v1/harness/decisions', key, {
            ...scope,
            session_id: p.session_id,
            request_id: p.request_id,
            presentation_id: p.presentation_id,
            choice,
            response_text,
          });
        const a = await reserve('session-a'),
          b = await reserve('session-b');
        assert.equal((await create('session-a', a, 'a')).status, 201);
        assert.equal((await create('session-b', b, 'b')).status, 201);
        const pa = await present('session-a'),
          pb = await present('session-b');
        for (const [p, handle, session] of [
          [pa, a, 'session-a'],
          [pb, b, 'session-b'],
        ]) {
          assert.equal(p.request_id, handle.request_id);
          assert.equal(p.session_id, session);
          assert.equal(p.action, 'Synthetic isolated question');
          assert.equal(p.context, 'Not executable');
          assert.match(p.presentation_id, /^hpr_[a-f0-9]{32}$/);
        }
        assert.equal((await create('session-a', a, 'a')).status, 200);
        assert.deepEqual(
          await present('session-a'),
          pa,
          'replay preserves presentation and deadline',
        );
        const second = await reserve('session-a');
        await error(await create('session-a', second, 'second'), 409, 'SESSION_BUSY');
        await error(
          await decide({ ...pa, presentation_id: pb.presentation_id }, 'approve'),
          404,
          'NOT_FOUND',
        );
        const respond = await decide(pb, 'respond', 'approved');
        assert.equal(respond.status, 200);
        const instructions = await respond.json();
        assert.equal(instructions.accepted, true);
        assert.equal(instructions.resolution, 'responded');
        assert.equal(instructions.response_text, 'approved');
        const rejected = await decide(pa, 'reject');
        assert.equal(rejected.status, 200);
        const winner = await rejected.json();
        assert.equal(winner.accepted, true);
        assert.equal(winner.resolution, 'rejected');
        const loser = await decide(pa, 'approve');
        assert.equal(loser.status, 200);
        assert.deepEqual(await loser.json(), { ...winner, accepted: false });
        assert.equal((await create('session-a', second, 'second')).status, 201);
        const fresh = await present('session-a');
        assert.notEqual(fresh.presentation_id, pa.presentation_id);
        assert.equal((await decide(pa, 'approve')).status, 200);
        assert.deepEqual(
          await present('session-a'),
          fresh,
          'late old choice cannot resolve new work',
        );
        const approved = await decide(fresh, 'approve');
        assert.equal(approved.status, 200);
        assert.equal((await approved.json()).resolution, 'approved');
      },
      { strictProtocol: true },
    ),
);
