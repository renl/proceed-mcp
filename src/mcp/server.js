// Stdio MCP adapter (design section 3). It keeps no Telegram credential, makes
// no human decisions and talks only to its own configured origin binding. The
// requesting session is taken solely from trusted `_meta` metadata.
import { createInterface } from 'node:readline';
import { LocalRequestError } from '../http/local-client.js';
import { CLIENT_REQUEST_ID_PATTERN, REQUEST_ID_PATTERN, scalarLength } from '../util/values.js';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
export const SESSION_META_KEY = 'ai.opencode/sessionID';
export const SERVER_NAME = 'proceed-mcp';
export const SERVER_VERSION = '0.0.0';

const INSTRUCTIONS = [
  'proceed-mcp routes approval requests to the human operator of this machine.',
  'request_approval durably records one request and returns its receipt promptly; it does not wait for the human.',
  'Do not perform the requested action while a request is pending. Wait for the decision input that the',
  'operator sends into this session. A rejection forbids the requested action. A response is instructions only:',
  'it is not approval, and any action that still needs approval requires a new request.',
  'After receiving a decision, state its request ID and outcome so the operator can confirm delivery.',
].join(' ');

const TOOLS = [
  {
    name: 'request_approval',
    description:
      'Durably create one approval request for this session and return its receipt immediately. Does not wait for the human.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['client_request_id', 'action'],
      properties: {
        client_request_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
        action: { type: 'string', minLength: 1, maxLength: 1000 },
        context: { type: 'string', maxLength: 1000 },
        expires_in_seconds: { type: 'integer', minimum: 60, maximum: 86400 },
      },
    },
  },
  {
    name: 'get_approval',
    description:
      'Read this session own request, applying expiry first. Has no delivery side effect.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_id'],
      properties: { request_id: { type: 'string', pattern: '^req_[a-f0-9]{32}$' } },
    },
  },
  {
    name: 'cancel_approval',
    description:
      'Cancel this session own pending request. An existing terminal outcome is returned unchanged.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['request_id'],
      properties: { request_id: { type: 'string', pattern: '^req_[a-f0-9]{32}$' } },
    },
  },
];

class ToolError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.retryable = retryable;
  }
}

function errorResult(code, message, retryable = false) {
  const envelope = { schema_version: 1, error: { code, message, retryable } };
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
    isError: true,
  };
}

function successResult(view) {
  return {
    content: [{ type: 'text', text: JSON.stringify(view) }],
    structuredContent: view,
    isError: false,
  };
}

function validateArguments(name, args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new ToolError('INVALID_ARGUMENT', 'tool arguments must be an object');
  }
  const allowed = {
    request_approval: ['client_request_id', 'action', 'context', 'expires_in_seconds'],
    get_approval: ['request_id'],
    cancel_approval: ['request_id'],
  }[name];
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key))
      throw new ToolError('INVALID_ARGUMENT', `unexpected argument ${key}`);
  }

  if (name === 'request_approval') {
    if (
      typeof args.client_request_id !== 'string' ||
      !CLIENT_REQUEST_ID_PATTERN.test(args.client_request_id)
    ) {
      throw new ToolError(
        'INVALID_ARGUMENT',
        'client_request_id must be 1-128 ASCII letters, digits, "_" or "-"',
      );
    }
    if (
      typeof args.action !== 'string' ||
      scalarLength(args.action) < 1 ||
      scalarLength(args.action) > 1000
    ) {
      throw new ToolError('INVALID_ARGUMENT', 'action must be 1-1000 characters');
    }
    if (
      args.context !== undefined &&
      (typeof args.context !== 'string' || scalarLength(args.context) > 1000)
    ) {
      throw new ToolError('INVALID_ARGUMENT', 'context must be at most 1000 characters');
    }
    if (
      args.expires_in_seconds !== undefined &&
      (!Number.isInteger(args.expires_in_seconds) ||
        args.expires_in_seconds < 60 ||
        args.expires_in_seconds > 86400)
    ) {
      throw new ToolError(
        'INVALID_ARGUMENT',
        'expires_in_seconds must be an integer between 60 and 86400',
      );
    }
    return {
      client_request_id: args.client_request_id,
      action: args.action,
      context: args.context ?? '',
      ...(args.expires_in_seconds === undefined
        ? {}
        : { expires_in_seconds: args.expires_in_seconds }),
    };
  }

  if (typeof args.request_id !== 'string' || !REQUEST_ID_PATTERN.test(args.request_id)) {
    throw new ToolError('NOT_FOUND', 'request not found');
  }
  return { request_id: args.request_id };
}

export function createMcpAdapter({ client, originId }) {
  const exchange = async (method, path, body) => {
    try {
      return await client.request(method, path, body);
    } catch (error) {
      if (error instanceof LocalRequestError) {
        throw new ToolError('ORIGIN_UNAVAILABLE', 'the local broker is not reachable', true);
      }
      throw error;
    }
  };

  const unwrap = (response) => {
    if (response.status >= 200 && response.status < 300) return response.body;
    const code = response.body?.error?.code ?? 'ORIGIN_UNAVAILABLE';
    const message = response.body?.error?.message ?? 'the broker rejected the request';
    const retryable = response.body?.error?.retryable === true;
    throw new ToolError(code, message, retryable);
  };

  return {
    async requestApproval(sessionId, args) {
      const response = await exchange('POST', '/v1/requests', { session_id: sessionId, ...args });
      const view = unwrap(response);
      if (view?.origin_id !== originId) {
        throw new ToolError(
          'ORIGIN_UNAVAILABLE',
          'the broker returned another origin binding',
          false,
        );
      }
      return view;
    },
    async getApproval(sessionId, args) {
      const response = await exchange(
        'GET',
        `/v1/requests/${encodeURIComponent(args.request_id)}?session_id=${encodeURIComponent(sessionId)}`,
      );
      return unwrap(response);
    },
    async cancelApproval(sessionId, args) {
      const response = await exchange(
        'POST',
        `/v1/requests/${encodeURIComponent(args.request_id)}/cancel`,
        { session_id: sessionId },
      );
      return unwrap(response);
    },
  };
}

export async function runMcpServer({ adapter, stdin = process.stdin, stdout = process.stdout }) {
  const write = (message) =>
    new Promise((resolve) => {
      stdout.write(`${JSON.stringify(message)}\n`, () => resolve());
    });

  const handleCall = async (message) => {
    const name = message.params?.name;
    const args = message.params?.arguments ?? {};
    if (!TOOLS.some((tool) => tool.name === name)) {
      throw Object.assign(new Error(`unknown tool ${name}`), { jsonRpcCode: -32601 });
    }
    const sessionId = message.params?._meta?.[SESSION_META_KEY];
    if (typeof sessionId !== 'string' || sessionId === '') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: errorResult('MISSING_SESSION_CONTEXT', 'no trusted session metadata was supplied'),
      };
    }

    let validated;
    try {
      validated = validateArguments(name, args);
    } catch (error) {
      return { jsonrpc: '2.0', id: message.id, result: errorResult(error.code, error.message) };
    }

    try {
      const view =
        name === 'request_approval'
          ? await adapter.requestApproval(sessionId, validated)
          : name === 'get_approval'
            ? await adapter.getApproval(sessionId, validated)
            : await adapter.cancelApproval(sessionId, validated);
      return { jsonrpc: '2.0', id: message.id, result: successResult(view) };
    } catch (error) {
      if (error instanceof ToolError) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: errorResult(error.code, error.message, error.retryable),
        };
      }
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: errorResult('ORIGIN_UNAVAILABLE', 'the request could not be completed', true),
      };
    }
  };

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
      try {
        return await handleCall(message);
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: error.message },
        };
      }
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
