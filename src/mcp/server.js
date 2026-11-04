// Stdio MCP adapter (design sections 2 and 3). It serves one protected transport
// principal chosen by the operator and speaks only standard MCP over
// newline-delimited JSON-RPC: no harness API, password, host version admission or
// proprietary session metadata. Tool execution forwards to the authenticated
// loopback broker, so preparation reserves real durable authority, cancellation
// closes only the authorized pending request, and acknowledgement records the
// capability holder's receipt of the matching terminal outcome through the same
// authority. The waiting tool creates or replays its request once per invocation
// and keeps that one invocation waiting on the broker's bounded poll. Only an
// error-free write callback of an original terminal wait result reports that one
// successful write, and no tool result claims a Telegram presentation, a human
// decision, caller receipt or acknowledgement. Closing stdin starts cleanup
// immediately: submitted work that has not begun never reaches the broker.
import { createInterface } from 'node:readline';
import {
  CLIENT_REQUEST_ID_PATTERN,
  DECISION_ID_PATTERN,
  REQUEST_CAPABILITY_PATTERN,
  REQUEST_HANDLE_PATTERN,
  REQUEST_ID_PATTERN,
} from '../util/values.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const SERVER_NAME = 'proceed-mcp';
export const SERVER_VERSION = '0.0.0';

// JSON Schema patterns reuse the format identifiers the broker validates, so the
// catalog cannot advertise a shape the product would not accept.
const pattern = (expression) => ({ type: 'string', pattern: expression.source });

const INSTRUCTIONS = [
  'proceed-mcp asks the paired human operator to approve, reject or respond to one stated action and returns the recorded outcome to the waiting MCP call.',
  'Call prepare_approval first: prepare_approval is available in this build and reserves durable request identity and a private request capability through the running local broker, sending no question to the human.',
  'Then call request_approval with the returned request_handle and request_capability; that single call creates or reuses the one request and keeps waiting for its resolution, expiry or cancellation, and returns that outcome itself.',
  'Client and transport timeouts limit how long that waiting call can wait, and a client timeout does not cancel the durable request.',
  'Keep the request capability private and retain it with its request_handle and request_id, because it is the only authority for a later get_approval, cancel_approval or acknowledge_approval call.',
  'Never echo, print or otherwise expose the request capability in an assistant message or a Telegram message.',
  'Sharing the request capability with another caller under the same transport principal grants request authority for that one request alone, and that sharing does not transfer or redirect the original waiting call.',
  'The transport principal and the request capability cannot by themselves establish an event route or any automatic agent activity.',
  'When a request is created, this build sends its approval question to the paired private chat over Telegram with Approve, Reject and Respond controls and durably maps the message it validated, so the human can see the exact action while the call keeps waiting; that paired human resolves this request alone, with an explicit Approve or Reject, or with Respond instructions that are never approval.',
  'Only an explicit Approve grants approval. Reject records rejection. Respond records request-specific instructions only after valid correlated text. Approval-like words in Respond text never grant approval.',
  'Call get_approval with the retained request_id and request_capability to observe that exact request: an authorized read returns the committed representation of a pending request, applies expiry first and reports an expired request as expired, and NOT_FOUND covers an unused reservation, an unknown request or denied authority alike.',
  'A lost waiting call does not cancel the durable request, so the retained request_id and request_capability keep the recorded outcome available through capability-authorized retrieval.',
  'Call cancel_approval with the retained request_id and request_capability to close only that pending request before its deadline: an authorized cancellation returns the committed cancelled representation, repeating it on an already resolved request returns the same outcome unchanged, expiry wins at the deadline, and NOT_FOUND covers an unused reservation, an unknown request or denied authority alike.',
  'acknowledge_approval records receipt of a terminal decision you already retrieved: call it with the retained request_id, request_capability and that exact decision_id, and it returns the same request marked confirmed.',
  'A received terminal decision_id must be acknowledged with acknowledge_approval, and in the subsequent assistant turn acknowledge the matching request_id and report that request outcome to the operator; deduplicate by request_id and decision_id before acting on it.',
  'Retrieval and acknowledgement never create another decision, and retrieval does not wake an agent or start a new assistant turn.',
  'A rejection forbids the requested action; a response is instructions only and never an approval; pending, expired, cancelled and failed requests grant nothing, so an action that still needs approval requires a new request.',
  'MCP Events are unsupported in this build, so no event route can deliver a decision, and automatic resumption after a timeout is unavailable.',
].join('\n');

// Retrieval is the one observation this build enables, so its description names
// the readable states and the single denial instead of claiming that every call
// is a reserved-only denial.
const GET_AVAILABLE =
  'Available in this build for a created request: an authorized read returns the committed representation of a pending request, applies expiry first and reports an expired request as expired, and NOT_FOUND covers an unused reservation, an unknown request or denied authority.';

// Cancellation is a real producer in this build: it closes only the authorized
// pending request and keeps one stable outcome, so its description states that
// rather than implying a management success this build cannot deliver.
const CANCELLATION_AVAILABLE =
  'Available in this build for a created request: an authorized cancellation closes only that pending request and returns the committed cancelled representation, while repeating it on an already resolved request returns the same outcome unchanged; an unused reservation or denied authority is NOT_FOUND.';

// Acknowledgement is a real producer in this build: it records the capability
// holder's receipt of the matching terminal outcome, and returning that request
// as confirmed is evidence of acknowledgement, not of an adapter's result write.
const ACKNOWLEDGEMENT_AVAILABLE =
  'Available in this build for a request whose capability the caller holds: an authorized acknowledgement records receipt of the matching terminal decision_id and returns the committed representation marked confirmed, a repeat returns that same representation unchanged, a pending request or a different decision_id is DECISION_MISMATCH, and NOT_FOUND covers an unused reservation or denied authority.';

// Design section 3 tool contracts. Argument names, required sets and bounds are
// the reviewed public interface. Each description states what this build actually
// does, so prepare availability is never mistaken for a waiting outcome.
const TOOLS = [
  {
    name: 'prepare_approval',
    description:
      'Reserve durable request identity and a private request capability for one later approval; no Telegram question is sent. prepare_approval is available in this build and writes that reservation through the running local broker.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        session_label: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
  {
    name: 'request_approval',
    description:
      'Create or reuse the request of an authorized prepared handle exactly once and keep this call waiting for its resolution, expiry or cancellation; this call returns the recorded terminal representation as its own result, and after an error-free write of that result it reports that single successful write to the delivery ledger without waiting for the report reply. This build displays that request as an approval question in the paired private chat, validates the returned message before mapping it, and correlates the paired human Approve, Reject or Respond to that one request.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_handle', 'request_capability', 'client_request_id', 'action', 'context'],
      properties: {
        request_handle: pattern(REQUEST_HANDLE_PATTERN),
        request_capability: pattern(REQUEST_CAPABILITY_PATTERN),
        client_request_id: pattern(CLIENT_REQUEST_ID_PATTERN),
        action: { type: 'string', minLength: 1, maxLength: 1000 },
        context: { type: 'string', maxLength: 1000 },
        expires_in_seconds: { type: 'integer', minimum: 60, maximum: 86400, default: 3600 },
      },
    },
  },
  {
    name: 'get_approval',
    description: `Read only the capability-authorized request, applying expiry before the read; no delivery side effect. ${GET_AVAILABLE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_id', 'request_capability'],
      properties: {
        request_id: pattern(REQUEST_ID_PATTERN),
        request_capability: pattern(REQUEST_CAPABILITY_PATTERN),
      },
    },
  },
  {
    name: 'cancel_approval',
    description: `Cancel only the capability-authorized pending request; a terminal outcome that already exists is returned unchanged. ${CANCELLATION_AVAILABLE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_id', 'request_capability'],
      properties: {
        request_id: pattern(REQUEST_ID_PATTERN),
        request_capability: pattern(REQUEST_CAPABILITY_PATTERN),
      },
    },
  },
  {
    name: 'acknowledge_approval',
    description: `Record that the capability holder received the matching terminal outcome; idempotent, never creating a second decision or a continuation. ${ACKNOWLEDGEMENT_AVAILABLE}`,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_id', 'request_capability', 'decision_id'],
      properties: {
        request_id: pattern(REQUEST_ID_PATTERN),
        request_capability: pattern(REQUEST_CAPABILITY_PATTERN),
        decision_id: pattern(DECISION_ID_PATTERN),
      },
    },
  },
];

export async function runMcpServer({
  stdin = process.stdin,
  stdout = process.stdout,
  execute,
  onResultWritten,
  onInputClosed,
} = {}) {
  // One serialized stdout writer: concurrent invocations may settle in any order,
  // but no two frames can interleave inside one newline-delimited message. A frame
  // settles with its own outcome instead of a rejection, so a failed write releases
  // its queue ownership and the frames behind it still write in order, and only an
  // error-free callback for a still-usable stream counts as a successful write.
  const CLOSED_STREAM = new Error('stdout is not writable');
  // The closure fence is raised before in-flight work drains, so queued work never
  // reaches the broker after EOF and no response is written to closed input.
  let closed = false;
  // Callback ownership of the frames already handed to stdout, so EOF can abandon a
  // write whose callback may never arrive instead of waiting for it indefinitely.
  const pendingWrites = new Set();
  let writing = Promise.resolve();
  const write = (message) => {
    const frame = writing.then(
      () =>
        new Promise((resolve) => {
          let settled = false;
          const settle = (error) => {
            if (settled) return;
            settled = true;
            pendingWrites.delete(settle);
            // A destroyed stream cannot have delivered these bytes, whatever its
            // callback reports, so that is a failed write rather than evidence.
            resolve(error ?? (stdout.destroyed === true ? CLOSED_STREAM : null));
          };
          // A frame queued behind another must not start on closed input: EOF
          // abandons it as a failed write, so its invocation stays unreported.
          if (closed) return settle(CLOSED_STREAM);
          pendingWrites.add(settle);
          try {
            stdout.write(`${JSON.stringify(message)}\n`, settle);
          } catch (error) {
            settle(error);
          }
        }),
    );
    writing = frame;
    return frame;
  };

  const handle = async (message, signal) => {
    if (typeof message !== 'object' || message === null || typeof message.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32600, message: 'invalid request' },
      };
    }

    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        },
      };
    }
    if (
      message.method === 'notifications/initialized' ||
      message.method === 'notifications/cancelled'
    ) {
      return null;
    }
    if (message.method === 'ping') {
      return { jsonrpc: '2.0', id: message.id, result: {} };
    }
    if (message.method === 'tools/list') {
      return { jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } };
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (!TOOLS.some((tool) => tool.name === name)) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `unknown tool ${String(name)}` },
        };
      }
      // An adapter started without a broker connection must not answer as if the
      // call executed; that is a wiring failure, not a product outcome.
      if (typeof execute !== 'function') {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: 'tool execution is not connected' },
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: await execute(name, message.params?.arguments, { signal }),
      };
    }
    if (typeof message.id === 'undefined') return null;
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } };
  };

  const lines = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY });
  // Design sections 3 and 7: one slow call must not block an unrelated call, so
  // each request is dispatched on its own. Correlation keeps the exact JSON-RPC
  // ID type, so numeric `7` and string `"7"` are two independent invocations.
  const active = new Map();
  const inflight = new Set();

  const track = (task) => {
    inflight.add(task);
    const forget = () => inflight.delete(task);
    task.then(forget, forget);
    return task;
  };

  // Successful-write reporting is optional ordinary wiring: the executor decides
  // whether this exact result is an eligible original wait outcome. A throw or a
  // failed report never becomes a protocol error, a second frame or a late retry.
  const admitReport = (entry, message, response) => {
    if (typeof onResultWritten !== 'function' || entry === null) return null;
    try {
      const attempt = onResultWritten(message, response);
      if (typeof attempt?.abort !== 'function' || typeof attempt.settled?.then !== 'function') {
        return null;
      }
      return attempt;
    } catch {
      return null;
    }
  };

  const dispatch = async (message) => {
    const id = message?.id;
    const cancellable = typeof id === 'number' || typeof id === 'string';
    const entry = cancellable
      ? { cancelled: false, controller: new AbortController(), reportAbort: null }
      : null;
    if (entry !== null) active.set(id, entry);
    // Settling releases the invocation, so a later cancellation for this exact ID is
    // an ordinary no-op rather than an adapter-wide abort.
    const release = () => {
      if (entry !== null && active.get(id) === entry) active.delete(id);
    };
    let response;
    try {
      response = await handle(message, entry?.controller.signal);
    } catch {
      // An unexpected local failure is a protocol error, never a tool outcome.
      response = {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32603, message: 'internal error' },
      };
    }
    // A cancelled invocation, and everything after EOF, writes nothing: neither a
    // frame nor successful-write evidence may be produced from it.
    if (response === null || closed || entry?.cancelled === true) return release();
    const failed = await write(response);
    // A callback error, a synchronous throw, a destroyed stream, a write abandoned by
    // EOF, a cancellation or EOF processed before the callback: all are failed or
    // suppressed writes.
    if (failed !== null || closed || entry?.cancelled === true) return release();
    const attempt = admitReport(entry, message, response);
    if (attempt === null) return release();
    // An admitted report has its own tracked lifetime beyond this completed
    // invocation, so the entry stays addressable until it settles: a later
    // cancellation aborts that exact transport instead of admitting another report.
    entry.reportAbort = attempt.abort;
    attempt.settled.then(release, release);
  };

  // Protocol cancellation identifies one invocation by its own request ID and
  // closes only that transport. It supplies no business cancellation authority.
  const cancelInvocation = (message) => {
    const entry = active.get(message.params?.requestId);
    if (entry === undefined) return;
    entry.cancelled = true;
    entry.controller.abort();
    // A report admitted by this invocation's earlier write ends with it: the result
    // frame may exist already, but its report may not continue or be repeated.
    entry.reportAbort?.();
  };

  lines.on('line', (line) => {
    if (closed) return;
    const text = line.trim();
    if (text === '') return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      void track(
        write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }),
      );
      return;
    }
    for (const item of Array.isArray(message) ? message : [message]) {
      if (item?.method === 'notifications/cancelled') cancelInvocation(item);
      else void track(dispatch(item));
    }
  });

  await new Promise((resolve) => {
    lines.on('close', () => {
      closed = true;
      // Callback ownership of a frame already handed to stdout is abandoned here: that
      // callback may never arrive, and its invocation must not outlast the shared
      // shutdown budget. A late callback finds the frame already settled, so it can
      // neither revive the writer nor become successful-write evidence.
      for (const settle of [...pendingWrites]) settle(CLOSED_STREAM);
      // Cleanup starts here, not after in-flight work drains: the execution owner
      // fences new and in-flight broker work and closes its own transport once,
      // while every invocation settles without writing to closed input.
      for (const entry of active.values()) {
        entry.cancelled = true;
        entry.controller.abort();
        // A report admitted before EOF is aborted with its invocation; the executor
        // also fences its own transports under the same shutdown budget.
        entry.reportAbort?.();
      }
      onInputClosed?.();
      Promise.allSettled([...inflight]).then(resolve);
    });
  });
  return {};
}
