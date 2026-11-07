// TEST ONLY. Existing outer lifecycle, broker/Telegram setup only. NO OpenCode.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, appendFile, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { networkInterfaces } from 'node:os';
import {
  withQualificationBroker,
  confirmQualificationEnrollment,
} from './harness-qualification-setup.mjs';
import { stageQualification, isolatedLinuxEnvironment } from './harness-linux-plan.mjs';

const evidence = '/run/proceed/evidence';
await mkdir(evidence, { recursive: true });
const progress = (phase) =>
  appendFile(join(evidence, 'progress.jsonl'), `${JSON.stringify({ phase })}\n`);
let failure;
try {
  const deadline = Date.now() + 15000;
  while (
    !(await access('/run/proceed-authorized').then(
      () => true,
      () => false,
    ))
  ) {
    assert.ok(Date.now() < deadline, 'inspected policy release deadline');
    await delay(25);
  }
  assert.ok(
    Object.values(networkInterfaces())
      .flat()
      .every((i) => i.internal),
  );
  assert.equal((await readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
  await progress('broker-public-setup');
  const work = '/run/proceed/work';
  await mkdir(work);
  for (const name of ['bin', 'src', 'tests']) await symlink(`/payload/${name}`, join(work, name));
  process.chdir(work);
  process.env.PROCEED_TEST_FIXTURES = '/run/proceed/managed-fixtures';
  process.env.PROCEED_TEST_ISOLATED_PID_NAMESPACE = '1';
  let controls;
  await withQualificationBroker(async (h) => {
    await progress('stage-product-and-test-entries');
    const env = isolatedLinuxEnvironment('/run/proceed/host-state');
    for (const key of ['HOME', 'XDG_DATA_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_CONFIG_DIR'])
      await mkdir(env[key], { recursive: true });
    const staging = await stageQualification(
      env,
      evidence,
      '/payload',
      '/run/proceed/staged',
      {
        state_dir: h.state,
        harness_id: 'qualification',
        owner_id: 'shared',
        operator_key_file: h.operator.file,
      },
      JSON.parse(await readFile('/payload/input-paths.json', 'utf8')),
    );
    await writeFile(join(evidence, 'staging.json'), JSON.stringify(staging));
    await progress('fingerprint-substitution-controls');
    const before = h.fixture.calls.length;
    for (const displayed of [
      { local: '0'.repeat(64), broker: h.proposal.key_id },
      { local: h.operator.keyId, broker: '0'.repeat(64) },
    ])
      await assert.rejects(confirmQualificationEnrollment(h, h.operator, h.proposal, displayed));
    await assert.rejects(
      confirmQualificationEnrollment(
        h,
        h.operator,
        { ...h.proposal, key_id: '0'.repeat(64) },
        { local: h.operator.keyId, broker: '0'.repeat(64) },
      ),
    );
    assert.equal(
      h.fixture.calls.slice(before).some((c) => c.method === 'answerCallbackQuery'),
      false,
    );
    assert.equal((await h.pending()).status, 401);
    await progress('fixture-only-matching-confirmation-NOT-rendered-proof');
    const confirmation = await confirmQualificationEnrollment(h, h.operator, h.proposal, {
      local: h.operator.keyId,
      broker: h.proposal.key_id,
    });
    const pending = await h.pending();
    assert.equal(pending.status, 200);
    assert.deepEqual(await pending.json(), { schema_version: 1, presentation: null });
    await h.noWork();
    controls = {
      ...confirmation,
      scope: { harness_id: 'qualification', owner_id: 'shared' },
      roles: ['operator', 'owner', 'control'],
      adapterCount: 0,
      unconfirmedDenied: true,
      substitutedFingerprintsDenied: true,
      setupWork: 0,
      enrollmentProof: 'Synthetic broker/Telegram only. Product-rendered comparison UNRUN',
      runtimeInventory: 'UNRUN',
      hostStarted: false,
    };
  });
  await progress('owned-broker-fixture-key-cleanup-complete');
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify({
      status: 'PASS',
      controls,
      cleanup:
        'inner process trees, fixture listener, managed directory and operator directory absent',
    }),
  );
} catch (error) {
  failure = error.message;
  await writeFile(
    join(evidence, 'result.json'),
    JSON.stringify({
      status: 'FAIL',
      failure,
      cleanup: 'outer exact namespace destruction required',
    }),
  );
}
process.exitCode = failure ? 1 : 0;
