// Stdio MCP adapter (design sections 2 and 3). It serves one protected transport
// principal chosen by the operator and speaks only standard MCP over
// newline-delimited JSON-RPC: no harness API, password, host version admission or
// proprietary session metadata. Tool execution needs the broker and is a later
// authorized unit, so every tools/call answers ENHANCEMENT_UNAVAILABLE instead of
// pretending to prepare, wait for or deliver a decision.
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
  'Call prepare_approval first: it reserves durable request identity and a private request capability, and sends no question to the human.',
  'Then call request_approval with the returned request_handle and request_capability; that call waits for the human resolution, expiry or cancellation and returns the outcome itself.',
  'Keep the request capability private and retain it with its request_handle and request_id, because it is the only authority for a later get_approval, cancel_approval or acknowledge_approval call.',
  'Never echo, print or otherwise expose the request capability in an assistant message or a Telegram message.',
  'A received terminal decision_id must be acknowledged with acknowledge_approval and reported to the operator with its request_id and outcome; deduplicate by request_id and decision_id before acting on it.',
  'A rejection forbids the requested action; a response is instructions only and never an approval; pending, expired, cancelled and failed requests grant nothing, so an action that still needs approval requires a new request.',
  'Tool execution is not implemented in this build: every tools/call returns ENHANCEMENT_UNAVAILABLE, so this catalog advertises the workflow without preparing, waiting for or delivering any decision.',
].join('\n');

const NOT_EXECUTED = 'This build returns ENHANCEMENT_UNAVAILABLE instead of executing the call.';

// Design section 3 tool contracts. Argument names, required sets and bounds are
// the reviewed public interface; the effects are the target behavior of the later
// execution unit, and each description says so rather than implying it exists.
const TOOLS = [
  {
    name: 'prepare_approval',
    description: `Reserve durable request identity and a private request capability for one later approval; no Telegram question is sent. ${NOT_EXECUTED}`,
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
    description: `Create or reuse the request of an authorized prepared handle and keep this call waiting for the human resolution, expiry or cancellation; the actual outcome is this call's result. ${NOT_EXECUTED}`,
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
    description: `Read only the capability-authorized request, applying expiry before the read; no delivery side effect. ${NOT_EXECUTED}`,
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
    description: `Cancel only the capability-authorized pending request; a terminal outcome that already exists is returned unchanged. ${NOT_EXECUTED}`,
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
    description: `Record that the capability holder received the matching terminal outcome; idempotent, never creating a second decision or a continuation. ${NOT_EXECUTED}`,
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

// Tool error envelope (design section 3). Nothing in this build may stand in for
// a prepared handle, a waiting outcome or a recorded decision, so a known tool
// reports the missing execution unit and claims no effect.
const EXECUTION_UNAVAILABLE = Object.freeze({
  schema_version: 1,
  error: {
    code: 'ENHANCEMENT_UNAVAILABLE',
    message: 'MCP tool execution is not implemented in this build; only catalog discovery runs',
    retryable: false,
  },
});

function unavailableResult() {
  return {
    content: [{ type: 'text', text: JSON.stringify(EXECUTION_UNAVAILABLE) }],
    structuredContent: EXECUTION_UNAVAILABLE,
    isError: true,
  };
}

export async function runMcpServer({ stdin = process.stdin, stdout = process.stdout } = {}) {
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
      return { jsonrpc: '2.0', id: message.id, result: unavailableResult() };
    }
    if (typeof message.id === 'undefined') return null;
    return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'method not found' } };
  };

  const lines = createInterface({ input: stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let chain = Promise.resolve();

  lines.on('line', (line) => {
    const text = line.trim();
    if (text === '') return;
    chain = chain.then(async () => {
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
        if (response !== null) await write(response);
      }
    });
  });

  const closed = new Promise((resolve) => {
    lines.on('close', () => {
      chain.then(resolve, resolve);
    });
  });
  await closed;
  return {};
}
