// Stdio MCP adapter (design sections 2 and 3). It serves one protected transport
// principal chosen by the operator and speaks only standard MCP over
// newline-delimited JSON-RPC: no harness API, password, host version admission or
// proprietary session metadata. Tool execution forwards to the authenticated
// loopback broker, so preparation reserves real durable authority and the
// reserved management calls report the broker's denial; the waiting tool is a
// later authorized unit and still answers ENHANCEMENT_UNAVAILABLE rather than
// pretending to wait for or deliver a decision. Closing stdin starts cleanup
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
  'proceed-mcp asks the paired human operator to approve, reject or respond to one stated action, and returns their decision to the waiting MCP call.',
  'Call prepare_approval first: prepare_approval is available in this build and reserves durable request identity and a private request capability through the running local broker, sending no question to the human.',
  'Then call request_approval with the returned request_handle and request_capability; that call waits for the human resolution, expiry or cancellation and returns the outcome itself.',
  'Keep the request capability private and retain it with its request_handle and request_id, because it is the only authority for a later get_approval, cancel_approval or acknowledge_approval call.',
  'Never echo, print or otherwise expose the request capability in an assistant message or a Telegram message.',
  'request_approval returns ENHANCEMENT_UNAVAILABLE in this build: no question is sent and no human outcome is delivered yet.',
  'Call get_approval with the retained request_id and request_capability to observe that exact request: an authorized read returns the committed representation of a pending request, applies expiry first and reports an expired request as expired, and NOT_FOUND covers an unused reservation, an unknown request or denied authority alike.',
  'cancel_approval is not enabled in this build, so a reserved management call returns NOT_FOUND and a wrong capability is indistinguishable from an unused reservation.',
  'acknowledge_approval is unavailable at this checkpoint and cannot record receipt yet, so a terminal outcome you have already seen stays unacknowledged until a later build enables it.',
  'A received terminal decision_id must be acknowledged with acknowledge_approval and reported to the operator with its request_id and outcome; deduplicate by request_id and decision_id before acting on it.',
  'A rejection forbids the requested action; a response is instructions only and never an approval; pending, expired, cancelled and failed requests grant nothing, so an action that still needs approval requires a new request.',
].join('\n');

// Retrieval is the one observation this build enables, so its description names
// the readable states and the single denial instead of claiming that every call
// is a reserved-only denial.
const GET_AVAILABLE =
  'Available in this build for a created request: an authorized read returns the committed representation of a pending request, applies expiry first and reports an expired request as expired, and NOT_FOUND covers an unused reservation, an unknown request or denied authority.';

// These two producers are not enabled here, so each description says so plainly
// rather than implying a management success this build cannot deliver.
const CANCELLATION_UNAVAILABLE =
  'Cancellation is not enabled in this build: cancel_approval returns NOT_FOUND for every call, and a wrong capability is indistinguishable from an unused reservation.';

// Acknowledgement availability belongs to its own later cut, not to waiting, so
// the interim disclosure states the gap without tying it to that implementation.
const ACKNOWLEDGEMENT_UNAVAILABLE =
  'acknowledge_approval is unavailable at this checkpoint and cannot record receipt yet, so no delivery is reported and no outcome is marked returned.';

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
      'Create or reuse the request of an authorized prepared handle and keep this call waiting for the human resolution, expiry or cancellation; the result of this call is the actual outcome. request_approval returns ENHANCEMENT_UNAVAILABLE in this build, so no question is sent and no outcome exists yet.',
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
    description: `Cancel only the capability-authorized pending request; a terminal outcome that already exists is returned unchanged. ${CANCELLATION_UNAVAILABLE}`,
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
    description: `Record that the capability holder received the matching terminal outcome; idempotent, never creating a second decision or a continuation. ${ACKNOWLEDGEMENT_UNAVAILABLE}`,
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
  onInputClosed,
} = {}) {
  const write = (message) =>
    new Promise((resolve) => {
      stdout.write(`${JSON.stringify(message)}\n`, () => resolve());
    });

  const handle = async (message) => {
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
        result: await execute(name, message.params?.arguments),
      };
    }
    if (typeof message.id === 'undefined') return null;
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } };
  };

  const lines = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let chain = Promise.resolve();
  // Design section 3/7: the closure fence is raised before the serialized chain
  // drains, so queued work never reaches the broker after EOF and no response is
  // written to closed input.
  let closed = false;

  lines.on('line', (line) => {
    if (closed) return;
    const text = line.trim();
    if (text === '') return;
    chain = chain.then(async () => {
      if (closed) return;
      let message;
      try {
        message = JSON.parse(text);
      } catch {
        await write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        return;
      }
      const responses = Array.isArray(message) ? message : [message];
      for (const item of responses) {
        const response = await handle(item);
        if (closed) return;
        if (response !== null) await write(response);
      }
    });
  });

  await new Promise((resolve) => {
    lines.on('close', () => {
      closed = true;
      // Cleanup starts here, not after the chain drains: the execution owner fences
      // new and in-flight broker work and closes its own transport once.
      onInputClosed?.();
      chain.then(resolve, resolve);
    });
  });
  return {};
}
