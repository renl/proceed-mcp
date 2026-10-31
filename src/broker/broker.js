// The local broker: single writer of the durable journal, owner of the request
// lifecycle and of the one pairing (design sections 1-6). It exposes operations
// to the local HTTP API, the Telegram poller and the delivery worker; both
// effectful adapters commit through the same serialized transaction chain.
import { BrokerError, invalidRequest, notFound, storageFailure, unavailable } from '../errors.js';
import {
  createBrokerState,
  applyMutations,
  deliveryCandidates,
  idempotencyKey,
  pendingRequests,
  requestView,
} from './state.js';
import { decisionPromptText } from './prompt.js';
import { OriginError, isSessionId } from '../opencode/client.js';
import {
  CLIENT_REQUEST_ID_PATTERN,
  PAIRING_CODE_PATTERN,
  REQUEST_ID_PATTERN,
  randomCallbackToken,
  randomPairingCode,
  randomRequestId,
  promptIdForRequest,
  scalarLength,
  sha256Hex,
  utcTimestamp,
} from '../util/values.js';
import { assertTelegramLength, renderRequestMessage } from '../telegram/render.js';

export const PAIRING_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const DEFAULT_EXPIRES_IN_SECONDS = 3600;
export const MIN_EXPIRES_IN_SECONDS = 60;
export const MAX_EXPIRES_IN_SECONDS = 86400;
const MAX_SESSION_LABEL = 200;

function noop() {}

export function validateRequestInput(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw invalidRequest('request body must be a JSON object');
  }
  const sessionId = body.session_id;
  if (!isSessionId(sessionId)) {
    throw invalidRequest('session_id must be an OpenCode session identifier');
  }
  if (
    typeof body.client_request_id !== 'string' ||
    !CLIENT_REQUEST_ID_PATTERN.test(body.client_request_id)
  ) {
    throw invalidRequest('client_request_id must be 1-128 ASCII letters, digits, "_" or "-"');
  }
  if (typeof body.action !== 'string') throw invalidRequest('action is required');
  const actionLength = scalarLength(body.action);
  if (actionLength < 1 || actionLength > 1000) {
    throw invalidRequest('action must be 1-1000 characters');
  }
  const context = body.context === undefined ? '' : body.context;
  if (typeof context !== 'string') throw invalidRequest('context must be a string');
  if (scalarLength(context) > 1000) throw invalidRequest('context must be at most 1000 characters');

  const expiresInSeconds =
    body.expires_in_seconds === undefined ? DEFAULT_EXPIRES_IN_SECONDS : body.expires_in_seconds;
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < MIN_EXPIRES_IN_SECONDS ||
    expiresInSeconds > MAX_EXPIRES_IN_SECONDS
  ) {
    throw invalidRequest('expires_in_seconds must be an integer between 60 and 86400');
  }

  return {
    session_id: sessionId,
    client_request_id: body.client_request_id,
    action: body.action,
    context,
    expires_in_seconds: expiresInSeconds,
  };
}

function sessionLabel(session, sessionId) {
  const title = typeof session?.title === 'string' ? session.title.trim() : '';
  if (title === '') return sessionId;
  return scalarLength(title) > MAX_SESSION_LABEL
    ? [...title].slice(0, MAX_SESSION_LABEL).join('')
    : title;
}

function originErrorToBroker(error) {
  if (!(error instanceof OriginError)) {
    return unavailable('the configured origin could not be reached', 'ORIGIN_UNAVAILABLE');
  }
  if (error.code === 'AUTH_REQUIRED') {
    return unavailable(
      'the configured origin rejected its credentials; set the password for this origin',
      'AUTH_REQUIRED',
      { retryable: false },
    );
  }
  if (error.code === 'SESSION_NOT_FOUND') {
    return unavailable('the origin does not know this session', 'ORIGIN_UNAVAILABLE', {
      retryable: false,
    });
  }
  if (error.code === 'UNSUPPORTED_RESPONSE' || error.code === 'LOCATION_NOT_FOUND') {
    return unavailable(
      'the origin returned an unsupported response; this host version is not admitted',
      'UNSUPPORTED_HOST',
      { retryable: false },
    );
  }
  return unavailable('the configured origin could not be reached', 'ORIGIN_UNAVAILABLE');
}

export function createBroker({ paths, config, clients, clock = () => Date.now(), logger = noop }) {
  const state = createBrokerState();
  const startedAt = utcTimestamp(clock());
  let journal = null;
  let queue = Promise.resolve();
  let closed = false;

  const nowIso = () => utcTimestamp(clock());

  const enqueue = (task) => {
    const run = queue.then(task);
    queue = run.then(noop, noop);
    return run;
  };

  const applyAndCommit = async (mutations, committedAt) => {
    await journal.append(mutations, { committedAt });
    applyMutations(state, mutations);
  };

  const commit = (mutations) => enqueue(() => applyAndCommit(mutations, nowIso()));

  // A critical section samples the clock, re-reads state and commits without
  // competing with another transaction (single-winner decisions, expiry first).
  const critical = (task) =>
    enqueue(async () => {
      const commitNow = (mutations, committedAt = nowIso()) =>
        applyAndCommit(mutations, committedAt);
      return task(commitNow);
    });

  const origin = (originId) => {
    const binding = config.origins.find((entry) => entry.origin_id === originId);
    if (binding === undefined) throw invalidRequest(`unknown origin ${originId}`);
    return binding;
  };

  const client = (originId) => {
    const entry = clients.get(originId);
    if (entry === undefined) {
      throw unavailable(
        `origin ${originId} is not configured for this broker`,
        'ORIGIN_UNAVAILABLE',
        {
          retryable: false,
        },
      );
    }
    return entry;
  };

  const expireIfDue = async (request, commitNow) => {
    if (request.resolution !== 'pending') return false;
    if (clock() < Date.parse(request.expires_at)) return false;
    await commitNow([
      {
        op: 'request.resolve',
        request_id: request.request_id,
        resolution: 'expired',
        resolved_at: nowIso(),
        decided_by: null,
        source_update_id: null,
        response_text: null,
        outbox: null,
      },
    ]);
    return true;
  };

  const sameRequest = (existing, input) =>
    existing.action === input.action &&
    existing.context === input.context &&
    existing.duration_seconds === input.expires_in_seconds;

  const replayOrConflict = (existing, input) => {
    if (!sameRequest(existing, input)) {
      throw new BrokerError(
        'IDEMPOTENCY_CONFLICT',
        409,
        'this client_request_id was already used with a different action, context or duration',
      );
    }
    return { status: 200, request: requestView(existing) };
  };

  const identify = async (originId, sessionId) => {
    const adapter = client(originId);
    try {
      const info = await adapter.info();
      const session = await adapter.session(sessionId);
      return {
        version: info.version,
        pid: info.pid,
        sessionLabel: sessionLabel(session, sessionId),
        sessionCreatedAt: typeof session?.time?.created === 'number' ? session.time.created : null,
      };
    } catch (error) {
      throw originErrorToBroker(error);
    }
  };

  return {
    state,
    config,
    paths,
    startedAt,
    clock,
    nowIso,
    commit,
    critical,
    origin,
    client,
    sessionLabel,

    attachJournal(opened) {
      journal = opened;
    },

    // Replays committed transactions before the broker reports readiness.
    async recover() {
      if (journal === null) throw storageFailure('the journal is not attached', 'STORAGE_FAILURE');
      const { transactions } = await journal.recover();
      for (const record of transactions) applyMutations(state, record.mutations);
      return { records: transactions.length };
    },

    async createRequest(originId, body) {
      const input = validateRequestInput(body);
      origin(originId);
      if (state.pairing === null) {
        throw unavailable(
          'no human is paired; run "proceed-mcp pair" and have the human pair first',
          'NOT_PAIRED',
          { retryable: false },
        );
      }

      const key = idempotencyKey({
        originId,
        sessionId: input.session_id,
        clientRequestId: input.client_request_id,
      });
      const known = state.idempotency.get(key);
      if (known !== undefined) return replayOrConflict(state.requests.get(known), input);

      const identity = await identify(originId, input.session_id);
      const binding = origin(originId);
      const createdAt = nowIso();
      const expiresAt = utcTimestamp(Date.parse(createdAt) + input.expires_in_seconds * 1000);
      const requestId = randomRequestId();
      const request = {
        schema_version: 1,
        request_id: requestId,
        client_request_id: input.client_request_id,
        origin_id: originId,
        origin_url: binding.url,
        origin_version: identity.version,
        origin_pid: identity.pid,
        session_id: input.session_id,
        session_label: identity.sessionLabel,
        session_created_at: identity.sessionCreatedAt,
        action: input.action,
        context: input.context,
        duration_seconds: input.expires_in_seconds,
        created_at: createdAt,
        expires_at: expiresAt,
        resolution: 'pending',
        resolved_at: null,
        response_text: null,
        decided_by: null,
        source_update_id: null,
        telegram_state: 'pending',
        delivery_state: 'not_applicable',
        delivery_error: null,
        callback_token: randomCallbackToken(),
        pairing_user_id: state.pairing.user_id,
        pairing_chat_id: state.pairing.chat_id,
        presentation: {
          chat_id: null,
          message_id: null,
          response_opened: false,
          reply_prompt_ids: [],
          resolved_announced_at: null,
          delivered_announced_at: null,
        },
      };

      try {
        assertTelegramLength(renderRequestMessage(request));
      } catch {
        throw invalidRequest(
          'the request cannot be rendered in one Telegram message; shorten the action or context',
        );
      }

      return critical(async (commitNow) => {
        const replayId = state.idempotency.get(key);
        if (replayId !== undefined) return replayOrConflict(state.requests.get(replayId), input);
        await commitNow([{ op: 'request.create', request }]);
        logger(`request ${requestId} created for origin ${originId}`);
        return { status: 201, request: requestView(state.requests.get(requestId)) };
      });
    },

    // Owned read; applies expiry before returning the representation.
    readRequest(requestId, sessionId) {
      if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
        throw notFound();
      }
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined || request.session_id !== sessionId) throw notFound();
        await expireIfDue(request, commitNow);
        return requestView(state.requests.get(requestId));
      });
    },

    cancelRequest(requestId, sessionId) {
      if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) throw notFound();
      if (!isSessionId(sessionId))
        throw invalidRequest('session_id must be an OpenCode session identifier');
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined || request.session_id !== sessionId) throw notFound();
        await expireIfDue(request, commitNow);
        const fresh = state.requests.get(requestId);
        if (fresh.resolution !== 'pending') return requestView(fresh);
        await commitNow([
          {
            op: 'request.resolve',
            request_id: requestId,
            resolution: 'cancelled',
            resolved_at: nowIso(),
            decided_by: null,
            source_update_id: null,
            response_text: null,
            outbox: null,
          },
        ]);
        return requestView(state.requests.get(requestId));
      });
    },

    // Records one human resolution and its exact outbox in one transaction,
    // together with the Telegram cursor that carried the decision.
    resolveFromTelegram({ requestId, resolution, responseText, userId, chatId, updateId }) {
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined) throw notFound();
        if (request.resolution !== 'pending') {
          return { changed: false, request: state.requests.get(requestId), expired: false };
        }
        if (await expireIfDue(request, commitNow)) {
          return { changed: false, request: state.requests.get(requestId), expired: true };
        }

        const resolvedAt = nowIso();
        const resolved = {
          ...state.requests.get(requestId),
          resolution,
          resolved_at: resolvedAt,
          response_text: responseText ?? null,
        };
        const outbox = {
          request_id: requestId,
          prompt_id: promptIdForRequest(requestId),
          text: decisionPromptText(resolved),
          state: 'pending',
          attempts: 0,
          next_attempt_at: resolvedAt,
          error: null,
          admitted_at: null,
          delivered_at: null,
          created_at: resolvedAt,
        };
        await commitNow([
          {
            op: 'request.resolve',
            request_id: requestId,
            resolution,
            resolved_at: resolvedAt,
            decided_by: { user_id: userId, chat_id: chatId },
            source_update_id: updateId,
            response_text: responseText ?? null,
            outbox,
          },
          ...(updateId === null || updateId === undefined
            ? []
            : [{ op: 'telegram.cursor', last_update_id: updateId }]),
        ]);
        return { changed: true, request: state.requests.get(requestId), expired: false };
      });
    },

    // Durable presentation bookkeeping: message IDs, reply prompts, announced
    // state. Sent/edit work is re-derived from these fields after a restart.
    recordPresentation(requestId, presentation, telegramState, updateId = null) {
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined) throw notFound();
        await commitNow([
          {
            op: 'request.presentation',
            request_id: requestId,
            presentation,
            ...(telegramState === undefined ? {} : { telegram_state: telegramState }),
          },
          ...(updateId === null ? [] : [{ op: 'telegram.cursor', last_update_id: updateId }]),
        ]);
        return state.requests.get(requestId);
      });
    },

    advanceCursor(updateId) {
      if (state.lastUpdateId === updateId) return Promise.resolve();
      return commit([{ op: 'telegram.cursor', last_update_id: updateId }]);
    },

    createPairingChallenge() {
      if (state.pairing !== null) {
        throw new BrokerError('ALREADY_PAIRED', 409, 'a human is already paired with this broker');
      }
      const code = randomPairingCode();
      const createdAt = nowIso();
      const expiresAt = utcTimestamp(clock() + PAIRING_CHALLENGE_TTL_MS);
      return critical(async (commitNow) => {
        if (state.pairing !== null) {
          throw new BrokerError(
            'ALREADY_PAIRED',
            409,
            'a human is already paired with this broker',
          );
        }
        await commitNow([
          {
            op: 'pairing.challenge',
            hash: sha256Hex(code),
            created_at: createdAt,
            expires_at: expiresAt,
          },
        ]);
        return { code, expires_at: expiresAt };
      });
    },

    findChallenge(code) {
      if (typeof code !== 'string' || !PAIRING_CODE_PATTERN.test(code)) return null;
      const challenge = state.challenges.get(sha256Hex(code));
      if (challenge === undefined || challenge.consumed_at !== null) return null;
      if (clock() >= Date.parse(challenge.expires_at)) return null;
      return challenge;
    },

    completePairing({ code, userId, chatId, updateId }) {
      return critical(async (commitNow) => {
        const challenge = state.challenges.get(sha256Hex(code));
        if (
          challenge === undefined ||
          challenge.consumed_at !== null ||
          clock() >= Date.parse(challenge.expires_at) ||
          state.pairing !== null
        ) {
          return { paired: false };
        }
        await commitNow([
          { op: 'pairing.challenge.consume', hash: challenge.hash, consumed_at: nowIso() },
          {
            op: 'pairing.set',
            pairing: { user_id: userId, chat_id: chatId, paired_at: nowIso() },
          },
          { op: 'telegram.cursor', last_update_id: updateId },
        ]);
        return { paired: true };
      });
    },

    // Operator-authorized resume of a blocked or scheduled delivery. Reuses the
    // persisted prompt ID and payload; never reopens the request.
    retryRequest(requestId) {
      if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) throw notFound();
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined) throw notFound();
        const outbox = state.outbox.get(requestId);
        if (outbox === undefined) {
          if (!['approved', 'rejected', 'responded'].includes(request.resolution)) {
            return { status: 200, request: requestView(request) };
          }
          throw storageFailure('the delivery outbox is missing', 'STORAGE_FAILURE');
        }
        if (request.delivery_state === 'delivered') {
          return { status: 200, request: requestView(request) };
        }
        const nextAttempt = nowIso();
        const resumed = request.delivery_state === 'blocked' ? 'pending' : request.delivery_state;
        await commitNow([
          {
            op: 'request.delivery',
            request_id: requestId,
            delivery_state: resumed,
            delivery_error: null,
            outbox: {
              ...outbox,
              state: resumed,
              error: null,
              next_attempt_at: nextAttempt,
            },
          },
        ]);
        return { status: 202, request: requestView(state.requests.get(requestId)) };
      });
    },

    // Delivery bookkeeping is written by the delivery worker only.
    recordDelivery({ requestId, deliveryState, deliveryError = null, outbox }) {
      return critical(async (commitNow) => {
        const request = state.requests.get(requestId);
        if (request === undefined) throw notFound();
        await commitNow([
          {
            op: 'request.delivery',
            request_id: requestId,
            delivery_state: deliveryState,
            delivery_error: deliveryError,
            outbox,
          },
        ]);
        return state.requests.get(requestId);
      });
    },

    // Expiry sweep: at least once per second while healthy (design section 4).
    expireDueRequests() {
      return critical(async (commitNow) => {
        const now = clock();
        for (const request of pendingRequests(state)) {
          if (now < Date.parse(request.expires_at)) continue;
          await commitNow([
            {
              op: 'request.resolve',
              request_id: request.request_id,
              resolution: 'expired',
              resolved_at: nowIso(),
              decided_by: null,
              source_update_id: null,
              response_text: null,
              outbox: null,
            },
          ]);
        }
      });
    },

    deliveryCandidates: () => deliveryCandidates(state),
    outboxFor: (requestId) => state.outbox.get(requestId) ?? null,

    status() {
      const requests = [...state.requests.values()]
        .sort((left, right) => left.created_at.localeCompare(right.created_at))
        .map(requestView);
      return {
        schema_version: 1,
        broker: { pid: process.pid, port: config.broker.port, started_at: startedAt },
        pairing:
          state.pairing === null
            ? { paired: false }
            : { paired: true, paired_at: state.pairing.paired_at },
        requests,
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      await queue.catch(noop);
      await journal?.close();
    },
  };
}
