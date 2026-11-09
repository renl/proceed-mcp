// Packaged private exchange helper (design section 2). The TUI parent creates
// this child with slots 3 and 4 as private pipes: 3 is parent-to-child and 4 is
// child-to-parent. The child serves exactly one broker exchange and exits; it
// never listens, never discovers a key file and never provides a generic proxy.
//
// It receives the operator credential only in the admitted `exchange` frame,
// performs the unchanged protected TLS-PSK exchange over the four closed harness
// routes, and returns exactly one parsed broker response or one fixed local error.
// Nothing is written to stdout or stderr: those are the parent's zero-output
// tripwires, so a byte there aborts the exchange instead of becoming a diagnostic.
import fs from 'node:fs';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { LOCAL_PRODUCT_RESPONSE_BYTES, createSecureLocalClient } from '../http/local-client.js';
import { isPlainObject } from '../util/values.js';
import {
  MAX_EXCHANGE_BUDGET_MS,
  NODE_VERSION_PATTERN,
  PROTOCOL_SCHEMA_VERSION,
  createFrameChannel,
  encodeFrame,
  helloProblem,
} from './helper-protocol.js';
import { exchangeProblem, routeFor } from './helper-operations.js';

// The final second of the exchange is reserved for owned cleanup, so no new
// protected read or network phase starts after this point.
const CLEANUP_RESERVE_MS = 1000;
const MINIMUM_NODE_MAJOR = 24;

function writeFrame(value) {
  const frame = encodeFrame(value);
  let offset = 0;
  while (offset < frame.length) {
    offset += fs.writeSync(4, frame, offset, frame.length - offset);
  }
}

function writeError(exchangeId, code) {
  writeFrame({
    schema_version: PROTOCOL_SCHEMA_VERSION,
    type: 'error',
    exchange_id: exchangeId,
    code,
  });
}

// A single take that also gives up when the step's own slice of the budget ends.
// The underlying take never rejects, so a lost race leaves nothing unhandled.
function takeWithin(channel, milliseconds) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(
      () => {
        if (settled) return;
        settled = true;
        resolve({ timeout: true });
      },
      Math.max(1, milliseconds),
    );
    channel.take().then((outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    });
  });
}

// The child's timer starts at entry and is only ever capped by the parent's
// absolute deadline; it is never extended after handoff.
function remainingStep(startedAt, cap) {
  return Math.min(cap, MAX_EXCHANGE_BUDGET_MS - (performance.now() - startedAt));
}

async function run() {
  const version = process.versions.node ?? '';
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  // A genuine Node runtime, no Bun marker, and the minimum supported major. A
  // newer version meets the minimum without being a compatibility claim.
  if (process.versions.bun !== undefined) return 1;
  if (!Number.isInteger(major) || major < MINIMUM_NODE_MAJOR) return 1;
  if (!NODE_VERSION_PATTERN.test(version)) return 1;

  const startedAt = performance.now();
  // Readiness is only announced after both private descriptors really exist.
  try {
    fs.fstatSync(3);
    fs.fstatSync(4);
  } catch {
    return 1;
  }

  const socket = new net.Socket({ fd: 3, readable: true, writable: false });
  const channel = createFrameChannel(socket);
  const controller = new AbortController();
  const lifetime = { cancelled: false };
  const cancel = () => {
    lifetime.cancelled = true;
    controller.abort();
  };
  // Parent death closes slot 3: that is the child's abort signal for protected
  // reads and any TLS/HTTP work already in flight.
  socket.on('end', cancel);
  socket.on('close', cancel);

  try {
    const hello = await takeWithin(channel, remainingStep(startedAt, MAX_EXCHANGE_BUDGET_MS));
    // Before a valid hello the child exits silently: an uncorrelated frame would
    // be a protocol claim it has no exchange to attach to.
    if (hello.timeout === true || hello.eof === true || hello.failure !== undefined) return 1;
    if (helloProblem(hello.frame) !== null) return 1;

    const exchangeId = hello.frame.exchange_id;
    const deadlineUnixMs = hello.frame.deadline_unix_ms;
    const budget = remainingStep(startedAt, deadlineUnixMs - Date.now());
    if (!(budget > CLEANUP_RESERVE_MS)) {
      writeError(exchangeId, 'EXCHANGE_DEADLINE');
      return 1;
    }
    writeFrame({
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'ready',
      exchange_id: exchangeId,
      runtime: 'node',
      node_version: version,
    });

    const incoming = await takeWithin(channel, budget - CLEANUP_RESERVE_MS);
    if (incoming.timeout === true) {
      writeError(exchangeId, 'EXCHANGE_DEADLINE');
      return 1;
    }
    if (incoming.eof === true) {
      writeError(exchangeId, 'EXCHANGE_CANCELLED');
      return 1;
    }
    if (incoming.failure !== undefined) {
      writeError(exchangeId, incoming.failure);
      return 1;
    }
    // Authority is admitted only for the exact closed operation, binding and
    // body, and only while the exchange's own budget still has active work left.
    if (exchangeProblem(incoming.frame, exchangeId) !== null) {
      writeError(exchangeId, 'HELPER_PROTOCOL_INVALID');
      return 1;
    }
    const frame = incoming.frame;
    // The hello's own absolute deadline is the only extra time this exchange may
    // consume; the exchange frame cannot carry or extend it.
    const activeMs =
      remainingStep(startedAt, Math.min(budget, deadlineUnixMs - Date.now())) - CLEANUP_RESERVE_MS;
    if (!(activeMs > 0)) {
      writeError(exchangeId, 'EXCHANGE_DEADLINE');
      return 1;
    }

    let timedOut = false;
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(1, activeMs),
    );
    let response;
    try {
      const client = createSecureLocalClient({
        port: frame.port,
        lockFile: frame.lock_file,
        token: frame.operator_credential,
        // The parent's remaining active-work budget, never a fresh exchange.
        timeoutMs: activeMs,
        maxResponseBytes: LOCAL_PRODUCT_RESPONSE_BYTES,
      });
      response = await client.request(
        'POST',
        routeFor(frame.operation, frame.presentation_id),
        frame.body,
        {},
        { signal: controller.signal },
      );
    } catch (error) {
      if (lifetime.cancelled) {
        writeError(exchangeId, 'EXCHANGE_CANCELLED');
        return 1;
      }
      if (timedOut) {
        writeError(exchangeId, 'EXCHANGE_DEADLINE');
        return 1;
      }
      // A listener that cannot prove the expected channel is never rewritten as
      // an ordinary reachability failure.
      writeError(
        exchangeId,
        error?.code === 'BROKER_INSTANCE_CONFLICT'
          ? 'BROKER_INSTANCE_CONFLICT'
          : 'BROKER_UNAVAILABLE',
      );
      return 1;
    } finally {
      clearTimeout(timer);
    }

    if (
      !Number.isInteger(response?.status) ||
      response.status < 200 ||
      response.status > 599 ||
      !isPlainObject(response.body)
    ) {
      writeError(exchangeId, 'BROKER_RESPONSE_INVALID');
      return 1;
    }
    // Exactly one complete parsed broker response, with no echoed authority and
    // no raw headers or socket data.
    writeFrame({
      schema_version: PROTOCOL_SCHEMA_VERSION,
      type: 'response',
      exchange_id: exchangeId,
      status: response.status,
      body: response.body,
    });
    return 0;
  } catch {
    return 1;
  } finally {
    socket.destroy();
  }
}

// Unhandled failures must stay silent and non-successful rather than printing a
// message the parent would treat as a tripwire.
process.on('uncaughtException', () => process.exit(1));
process.on('unhandledRejection', () => process.exit(1));

const exitCode = await run().catch(() => 1);
process.exit(exitCode);
