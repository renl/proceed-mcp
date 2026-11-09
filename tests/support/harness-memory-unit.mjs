// TEST ONLY. Core objects with memory journal/update adapters, never a server.
import assert from 'node:assert/strict';
import { createPortableBroker } from '../../src/broker/portable.js';
import { createPortableTelegramPoller } from '../../src/telegram/portable-poller.js';

export const scope = { harnessId: 'unit', ownerId: 'shared', sessionId: 'unit-session' };
export const keyId = 'a'.repeat(64);
export const turns = async () => {
  for (let n = 0; n < 400; n++) await Promise.resolve();
};
const gate = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

export async function memoryHarness(t, { enrolled = true } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-11-09T00:00:00Z') });
  const transactions = [];
  let token = 0,
    updateId = 0,
    block = null,
    fail = false;
  const cores = [],
    pollers = [],
    holds = [];
  const journal = {
    async recover() {
      return { transactions: structuredClone(transactions), validLength: 0, fileBytes: 0 };
    },
    async ensureHarnessFormat() {},
    async append(mutations) {
      const held = block;
      block = null;
      if (held) {
        held.entered = true;
        await held.release.promise;
      }
      if (fail) {
        fail = false;
        const error = new Error('injected memory append failure');
        error.code = 'STORAGE_FAILURE';
        throw error;
      }
      transactions.push({ mutations: structuredClone(mutations) });
    },
  };
  const make = async () => {
    const core = createPortableBroker({
      journal,
      owners: [{ owner_id: scope.ownerId, label: 'Unit owner' }],
      port: 1,
      clock: () => Date.now(),
      generatePairingCode: () => 'b'.repeat(32),
      generateCallbackToken: () => (++token).toString(16).padStart(32, '0'),
    });
    cores.push(core);
    await core.recover();
    return core;
  };
  const core = await make();
  await core.pairingChallenge();
  await core.completePairing({
    code: 'b'.repeat(32),
    userId: '71',
    chatId: '81',
    updateId: ++updateId,
  });
  const enroll = async (fingerprint = keyId) => {
    const proposal = await core.proposeEnrollment({ ...scope, keyId: fingerprint });
    const notice = await core.enrollmentNotice({
      enrollmentId: proposal.enrollment_id,
      userId: '71',
      chatId: '81',
      updateId: ++updateId,
    });
    assert.deepEqual(
      await core.resolveEnrollmentCallback({
        kind: 'confirm',
        token: notice.confirm_token,
        userId: '71',
        chatId: '81',
        updateId: ++updateId,
      }),
      { result: 'confirmed' },
    );
  };
  if (enrolled) await enroll();
  const create = async (sessionId = scope.sessionId, route = true) => {
    const harnessRoute = { harnessId: scope.harnessId, sessionId };
    const authority = await core.reserveHandle({
      ownerId: scope.ownerId,
      ...(route ? { harnessRoute } : {}),
    });
    const input = {
      ownerId: scope.ownerId,
      capability: authority.request_capability,
      requestHandle: authority.request_handle,
      clientRequestId: `unit-${sessionId}`,
      action: 'Unit question',
      context: 'Memory only',
      ...(route ? { harnessRoute } : {}),
    };
    const { request } = await core.createRequest(input);
    return { authority, input, request };
  };
  const command = (text = `/harness_revoke ${keyId}`, from = 71, chat = 81, type = 'private') => ({
    update_id: ++updateId,
    message: { from: { id: from, is_bot: false }, chat: { id: chat, type }, text },
  });
  const consume = (batch) => {
    let polls = 0;
    const sends = [];
    const poller = createPortableTelegramPoller({
      broker: core,
      telegram: {
        async updates(_offset, { signal }) {
          if (++polls === 1) return batch;
          return new Promise((resolve) => {
            if (signal.aborted) resolve([]);
            else signal.addEventListener('abort', () => resolve([]), { once: true });
          });
        },
        async sendMessage(value) {
          sends.push(value);
          return { message_id: 1 };
        },
        async answerCallbackQuery() {
          return true;
        },
      },
    });
    pollers.push(poller);
    poller.start();
    return {
      async done({ stopped = false } = {}) {
        // Fixed microtask draining, not a wall-clock wait or external polling.
        await turns();
        assert.ok(stopped ? poller.diagnostic() !== null : polls === 2, 'memory batch must settle');
        await poller.stop();
        return sends;
      },
    };
  };
  t.after(async () => {
    holds.forEach((held) => held.release.resolve());
    block?.release.resolve();
    await Promise.all(pollers.map((poller) => poller.stop()));
    await Promise.all(cores.map((item) => item.close()));
    t.mock.timers.reset();
  });
  return {
    core,
    create,
    enroll,
    make,
    command,
    consume,
    transactions,
    hold() {
      const held = { entered: false, release: gate() };
      holds.push(held);
      block = held;
      return {
        get entered() {
          return held.entered;
        },
        release: held.release.resolve,
      };
    },
    failAppend() {
      fail = true;
    },
  };
}

export async function boundDecision(core, request) {
  const presentation = await core.pendingPresentation(scope);
  assert.equal(presentation.request_id, request.request_id);
  return {
    ...scope,
    keyId,
    requestId: request.request_id,
    presentationId: presentation.presentation_id,
    choice: 'reject',
    responseText: null,
  };
}
