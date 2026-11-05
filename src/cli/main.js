// Public CLI dispatch (design section 2). One command group per checkpoint;
// `doctor` remains a documented target that this build does not implement, so
// it fails as an invalid command rather than pretending to check anything.
import { TELEGRAM_TOKEN_ENV } from '../config/portable-config.js';
import {
  CliError,
  EXIT_CODE,
  blockedPrerequisite,
  invalidArgument,
  storageFailure,
} from '../errors.js';
import { createLocalClient, LocalRequestError } from '../http/local-client.js';
import { LOCAL_WAIT_TIMEOUT_MS } from '../http/local-client.js';
import { createToolExecutor } from '../mcp/execution.js';
import { createRegistrationBinding } from '../mcp/registration.js';
import { runMcpServer } from '../mcp/server.js';
import { startPortableRuntime } from '../broker/portable-runtime.js';
import { readLocalCredential } from '../state/credentials.js';
import { readOwnerCredential } from '../state/owner-credentials.js';
import { resolveStateDir, statePaths } from '../state/paths.js';
import { addOrigin, addOwner, initializeState, loadPortableConfiguration } from '../state/store.js';
import { createTelegramClient } from '../telegram/client.js';
import { renderPortableHumanOutcome } from '../telegram/portable-render.js';
import { PAIRING_CODE_PATTERN, isPlainObject, isUtcTimestamp } from '../util/values.js';
import { parseArguments, requireOptions } from './args.js';

const USAGE = [
  'proceed-mcp - Telegram approval broker for OpenCode V2 sessions',
  '',
  'Usage:',
  '  proceed-mcp init [--state-dir <directory>]',
  '  proceed-mcp owner add <owner_id> --label <label> [--state-dir <directory>]',
  '  proceed-mcp serve [--state-dir <directory>]',
  '  proceed-mcp pair [--state-dir <directory>]',
  '  proceed-mcp mcp --owner <owner_id> [--state-dir <directory>]',
  '  proceed-mcp status [--request <request_id>] [--json] [--state-dir <directory>]',
  '  proceed-mcp retry <request_id> [--state-dir <directory>]',
  '  proceed-mcp origin add <origin_id> --url <url> --password-env <name> [--state-dir <directory>]',
  '',
  'State directory: --state-dir, then PROCEED_STATE_DIR, then <home>/.proceed-mcp.',
  'Owner ids: [a-z0-9_-]{1,64}; labels: 1-128 characters, display only.',
  'Origin URL (previous configuration schema only): http://127.0.0.1:<explicit-port>',
  'with no path, query, fragment or credentials.',
  '',
  'The Telegram token is read from the environment, never from state or arguments.',
  'This checkpoint runs portable schema 2 setup: init, owner add, pair, serve, mcp and status.',
  'Local waiting, Telegram question display and paired-human Approve, Reject and Respond are available. Respond text is instructions, not approval.',
  'Client and transport timeouts limit how long a waiting call can wait, and a timeout does not cancel the durable request.',
  'A lost waiting call does not cancel the durable request.',
  'MCP Events are unsupported in this build, and automatic resumption after a timeout is unavailable.',
  '`mcp` prepares real request authority through the running broker; request_approval creates',
  'or replays one request and waits for its resolution. When the token is set, `serve` consumes',
  'private-chat pairing updates and sends each approval question to the paired chat.',
  '`pair` obtains a one-use five-minute pairing code from the running broker; `retry`',
  'reports its operation as unavailable; `origin add` refuses schema 2 state.',
  '`doctor` is a documented target that this build does not implement.',
  '',
  'Exit codes: 0 completed, 2 invalid arguments or configuration, 3 unavailable prerequisite,',
  '            4 storage or integrity failure. Diagnostics are written to stderr.',
  '',
].join('\n');

function commandStatePaths(options, env) {
  return statePaths(resolveStateDir({ option: options.get('state-dir'), env }));
}

function noPositionals(positionals, command) {
  if (positionals.length > 0) {
    throw invalidArgument(
      `${command} takes no positional arguments (received "${positionals[0]}")`,
    );
  }
}

// A missing or unreachable broker is an unavailable prerequisite, not a crash.
function asCliFailure(error) {
  if (error instanceof CliError) return error;
  if (error instanceof LocalRequestError) {
    return blockedPrerequisite(
      'the broker is not reachable; start "proceed-mcp serve" and try again',
      'BROKER_UNAVAILABLE',
    );
  }
  return error;
}

function failureFromResponse(response) {
  const code = response.body?.error?.code ?? 'BROKER_REJECTED';
  const message = response.body?.error?.message ?? 'the broker rejected the request';
  if (response.status === 400 || response.status === 404 || response.status === 409) {
    return invalidArgument(`${message} (${code})`, code);
  }
  // A runtime whose deadline processing failed is still listening, so this is an
  // operational storage refusal to act on, not a prerequisite to wait out.
  if (response.status === 500 && code === 'STORAGE_FAILURE') {
    return storageFailure(`${message} (${code})`, code);
  }
  return blockedPrerequisite(`${message} (${code})`, code);
}

// Design section 3 temporary checkpoint: pairing and request retry are absent
// from this build, so their broker classification is reported verbatim instead
// of printing a challenge or a delivery state that does not exist.
function unavailableResponse(response) {
  const error = response.body?.error;
  if (response.status === 503 && error?.code === 'ENHANCEMENT_UNAVAILABLE') {
    throw blockedPrerequisite(error.message, error.code);
  }
  throw failureFromResponse(response);
}

function controlClient(paths, config) {
  return readLocalCredential(paths.controlCredentialFile, 'the control credential').then((token) =>
    createLocalClient({ port: config.broker.port, token }),
  );
}

// A 201 is the only pairing success a consumer may act on, and its two fields are
// revalidated before anything reaches the operator: a malformed success is an
// unavailable prerequisite, never a code or deadline to guess around.
function pairingChallengeFrom(response) {
  if (response.status !== 201) throw failureFromResponse(response);
  const { code, expires_at: expiresAt } = isPlainObject(response.body) ? response.body : {};
  if (typeof code !== 'string' || !PAIRING_CODE_PATTERN.test(code) || !isUtcTimestamp(expiresAt)) {
    throw blockedPrerequisite(
      'the broker returned a malformed pairing challenge; no pairing code was issued',
      'PAIRING_CHALLENGE_INVALID',
    );
  }
  return { code, expiresAt };
}

async function runInit(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  noPositionals(positionals, 'init');

  const result = await initializeState(commandStatePaths(options, env));
  stdout.write(
    [
      `Initialized proceed-mcp state at ${result.stateDir}`,
      `Configuration schema version: ${result.config.schema_version}`,
      `Control credential written to ${result.controlCredentialFile} (value not shown)`,
      'Empty journal created; pairing, requests and decisions are not configured yet.',
      '',
      'Remaining setup - this command verified none of it:',
      '  1. proceed-mcp owner add <owner_id> --label <label>   (with the broker stopped)',
      `  2. Set ${TELEGRAM_TOKEN_ENV} in the broker environment; the Telegram token is never stored in state.`,
      '  3. proceed-mcp mcp --owner <owner_id>   (stdio MCP for that transport principal;',
      '     prepare_approval reserves real request authority through the running broker, and',
      '     request_approval creates that one request and waits for its resolution, expiry or',
      '     cancellation, and a configured serve presents that question in the paired private',
      '     chat and records that human Approve, Reject or Respond)',
      '  4. proceed-mcp serve starts the loopback broker and "status" reports it.',
      '     "pair" obtains a one-use code from that running broker for private-chat pairing;',
      '     retry remains a later checkpoint that reports its operation as unavailable rather',
      '     than pretending to succeed.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runOwnerAdd(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, {
    valueOptions: ['state-dir', 'label'],
  });
  if (positionals.length !== 1) {
    throw invalidArgument('owner add requires exactly one owner_id');
  }
  requireOptions(options, ['label']);

  const result = await addOwner(commandStatePaths(options, env), {
    ownerId: positionals[0],
    label: options.get('label'),
  });

  stdout.write(
    [
      `Added owner ${result.owner.owner_id} (label ${JSON.stringify(result.owner.label)})`,
      `Owner credential written to ${result.ownerCredentialFile} (value not shown)`,
      'No service was started; broker and MCP wiring are later steps.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runOwnerCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'add') {
    throw invalidArgument('owner supports only "add"');
  }
  return runOwnerAdd(rest, context);
}

async function runOriginAdd(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, {
    valueOptions: ['state-dir', 'url', 'password-env'],
  });
  if (positionals.length !== 1) {
    throw invalidArgument('origin add requires exactly one origin_id');
  }
  requireOptions(options, ['url', 'password-env']);

  const result = await addOrigin(commandStatePaths(options, env), {
    originId: positionals[0],
    url: options.get('url'),
    passwordEnv: options.get('password-env'),
  });

  stdout.write(
    [
      `Added origin ${result.origin.origin_id} -> ${result.origin.url}`,
      `Password is read from the environment variable ${result.origin.password_env} (value not stored)`,
      `MCP origin credential written to ${result.originCredentialFile} (value not shown)`,
      'No service was started; pairing is a later step.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runOriginCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'add') {
    throw invalidArgument('origin supports only "add"');
  }
  return runOriginAdd(rest, context);
}

function waitForSignal() {
  return new Promise((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function runServe(argv, { stdout, stderr, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  noPositionals(positionals, 'serve');

  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  // The environmental token selects the fixed-origin client; no token means no
  // Telegram traffic at all and keeps local-only readiness.
  const token = env[TELEGRAM_TOKEN_ENV];
  const telegram = token === undefined || token === '' ? null : createTelegramClient({ token });
  const runtime = await startPortableRuntime({
    paths,
    config,
    telegram,
    logger: (message) => stderr.write(`proceed-mcp: ${message}\n`),
  });

  stdout.write(`proceed-mcp: broker ready on http://127.0.0.1:${runtime.port}\n`);
  stdout.write(`proceed-mcp: state directory ${paths.stateDir}\n`);
  // Local readiness does not depend on the token: one diagnostic after success only.
  if (telegram === null) {
    stderr.write(
      `proceed-mcp: Telegram unavailable: set ${TELEGRAM_TOKEN_ENV} and restart serve; local broker only\n`,
    );
  }
  await waitForSignal();
  await runtime.stop();
  stdout.write('proceed-mcp: broker stopped\n');
  return EXIT_CODE.OK;
}

async function runPair(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  noPositionals(positionals, 'pair');

  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  const client = await controlClient(paths, config);

  let response;
  try {
    response = await client.request('POST', '/v1/pairing', {});
  } catch (error) {
    throw asCliFailure(error);
  }
  // The challenge is the operator's own new setup material, written only after the
  // broker's committed response: no partial code and no paired-success claim.
  const challenge = pairingChallengeFrom(response);
  stdout.write(`Pairing code: ${challenge.code}\nExpires at: ${challenge.expiresAt}\n`);
  return EXIT_CODE.OK;
}

// Design section 2: one stdio MCP server for the operator-selected transport
// principal. Only schema-2 owner state is read, and only that owner's protected
// credential; no harness URL, password, host admission or proprietary metadata is
// needed to serve the catalog, and stdout is left to protocol messages alone. Tool
// execution uses that credential against the configured loopback broker port, so
// preparation reserves real authority and the waiting call waits on a longer deadline.
async function runMcp(argv, { env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir', 'owner'] });
  noPositionals(positionals, 'mcp');
  requireOptions(options, ['owner']);

  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  const ownerId = options.get('owner');
  const owner = config.owners.find((entry) => entry.owner_id === ownerId);
  if (owner === undefined) {
    throw invalidArgument(
      `owner ${ownerId} is not configured; run "proceed-mcp owner add ${ownerId} --label <label>"`,
    );
  }

  // Fail closed when the principal has no usable authority: a missing or damaged
  // owner credential is a startup blocker. The value authorizes broker calls only,
  // so it is never logged, returned or written anywhere.
  const credential = await readOwnerCredential(
    paths.ownerCredentialFile(owner.owner_id),
    owner.owner_id,
  );
  const client = createLocalClient({ port: config.broker.port, token: credential });
  // The waiting call keeps its own longer deadline, because one broker poll
  // turnover is slower than an ordinary management exchange.
  const waitClient = createLocalClient({
    port: config.broker.port,
    token: credential,
    timeoutMs: LOCAL_WAIT_TIMEOUT_MS,
  });

  // The executor owns this adapter's private registration: it is created lazily by
  // the first implemented call, renewed while the adapter lives, and released here.
  // Closing stdin fences new work immediately and one close covers ordinary and
  // lifecycle traffic under the single shutdown budget.
  const executor = createToolExecutor({
    client,
    waitClient,
    registration: createRegistrationBinding({ client }),
  });
  try {
    await runMcpServer({
      execute: executor.execute,
      // The one successful-write report for an eligible original wait outcome: the
      // executor selects eligibility, and the report never delays or repeats this result.
      onResultWritten: (message, response) => executor.reportWritten(response.result),
      onInputClosed: () => {
        void executor.close();
      },
    });
  } finally {
    await executor.close();
  }
  return EXIT_CODE.OK;
}

// Design section 7 human status: the transport principal and a display-only caller
// label replace the retired origin/session fields. A pending resolution only records
// that no decision exists yet, so presentation wording follows the broker-reported
// Telegram state instead of assuming an unsent message; a waiting presentation is
// described as waiting, never as human receipt, and an expired request is an explicit
// non-approval closure. Nothing here claims Events, delivery or approval.
const NEXT_ACTION = {
  pending: 'wait for the pending Telegram presentation; it is not yet sent',
  sent: 'wait for the paired human to select Approve, Reject or Respond',
  expired: 'create a new approval request if approval is still needed',
  approved: 'review the recorded resolution and its delivery state before relying on it',
  rejected: 'review the recorded resolution and its delivery state before relying on it',
  responded: 'review the recorded response and its delivery state before relying on it',
  cancelled: 'create a new approval request if approval is still needed',
};

// Selected presentation notes (proposal C3 Product-Copy Annex): the note follows the
// recorded presentation state, never token presence or a presumed receipt.
const PRESENTATION_NOTE = {
  pending: 'Presentation is still pending: not yet sent, and no decision was recorded.',
  sent: 'Telegram accepted a question message. Human receipt is not confirmed, and no decision was recorded.',
  failed:
    'A Telegram presentation attempt failed. No successful message mapping is recorded, and no decision was recorded.',
};

function pendingNote(request) {
  const note =
    PRESENTATION_NOTE[request.telegram_state] ??
    'No decision was recorded; review the recorded Telegram state above.';
  return `  ${note}`;
}

// Next action for a pending request depends on the reported presentation state, so an
// already-sent or failed presentation is never advised to wait for an unsent message.
function nextActionFor(request) {
  if (request.resolution !== 'pending') {
    return NEXT_ACTION[request.resolution] ?? 'review the recorded state above';
  }
  if (request.telegram_state === 'pending') return NEXT_ACTION.pending;
  return request.telegram_state === 'sent'
    ? NEXT_ACTION.sent
    : 'review the recorded Telegram and delivery state above';
}

function describeRequest(request) {
  const lines = [
    `${request.request_id}  ${request.resolution}`,
    `  owner_id=${request.owner_id}`,
    `  session_label=${JSON.stringify(request.session_label)}` +
      '  (display only; not a verified session identity)',
    `  action=${JSON.stringify(request.action)}`,
    `  expires=${request.expires_at}`,
    `  resolution=${request.resolution}  telegram_state=${request.telegram_state}` +
      `  delivery_state=${request.delivery_state}`,
    ...(request.delivery_error === null || request.delivery_error === undefined
      ? []
      : [`  delivery_error=${request.delivery_error.code}: ${request.delivery_error.message}`]),
  ];
  if (request.resolution === 'pending') {
    lines.push(pendingNote(request));
  }
  if (request.resolution === 'expired') {
    lines.push('  Expired is a non-approval outcome: this request closed without a decision.');
  }
  // One shared recorded-outcome composition: the committed resolution selects the
  // prefix and the current ledger the suffix, so status restates no second wording.
  const outcome = renderPortableHumanOutcome(request.resolution, request.delivery_state);
  if (outcome !== null) lines.push(`  ${outcome}`);
  lines.push(`  next action: ${nextActionFor(request)}`);
  return lines.join('\n');
}

async function runStatus(argv, { stdout, env }) {
  const { positionals, options, flags } = parseArguments(argv, {
    valueOptions: ['state-dir', 'request'],
    flagOptions: ['json'],
  });
  noPositionals(positionals, 'status');

  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  const client = await controlClient(paths, config);

  let response;
  try {
    response = await client.request('GET', '/v1/status');
  } catch (error) {
    throw asCliFailure(error);
  }
  if (response.status !== 200) throw failureFromResponse(response);

  let requests = Array.isArray(response.body.requests) ? response.body.requests : [];
  const wanted = options.get('request');
  if (wanted !== undefined) {
    requests = requests.filter((request) => request.request_id === wanted);
    if (requests.length === 0) throw invalidArgument(`no request ${wanted} in this broker`);
  }

  // The versioned CLI document carries requests only: the broker details and
  // any future pairing/delivery state stay out of this stable machine shape.
  if (flags.has('json')) {
    stdout.write(`${JSON.stringify({ schema_version: 1, requests }, null, 2)}\n`);
    return EXIT_CODE.OK;
  }

  stdout.write(
    [
      `Broker ${response.body.broker?.pid} on port ${response.body.broker?.port}`,
      requests.length === 0 ? 'No requests.' : requests.map(describeRequest).join('\n'),
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runRetry(argv, { env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  if (positionals.length !== 1) {
    throw invalidArgument('retry requires exactly one request_id');
  }

  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  const client = await controlClient(paths, config);

  let response;
  try {
    response = await client.request(
      'POST',
      `/v1/requests/${encodeURIComponent(positionals[0])}/retry`,
      {},
    );
  } catch (error) {
    throw asCliFailure(error);
  }
  unavailableResponse(response);
  return EXIT_CODE.OK;
}

async function dispatch(argv, context) {
  const [command, ...rest] = argv;

  if (command === undefined) {
    context.stdout.write(USAGE);
    return EXIT_CODE.INVALID;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    context.stdout.write(USAGE);
    return EXIT_CODE.OK;
  }
  if (command === 'init') return runInit(rest, context);
  if (command === 'owner') return runOwnerCommand(rest, context);
  if (command === 'origin') return runOriginCommand(rest, context);
  if (command === 'serve') return runServe(rest, context);
  if (command === 'pair') return runPair(rest, context);
  if (command === 'mcp') return runMcp(rest, context);
  if (command === 'status') return runStatus(rest, context);
  if (command === 'retry') return runRetry(rest, context);

  throw invalidArgument(
    `unknown command "${command}"; run "proceed-mcp --help" for the commands in this build`,
  );
}

export async function run(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;

  try {
    return await dispatch(argv, { stdout, stderr, env });
  } catch (error) {
    if (error instanceof CliError) {
      stderr.write(`proceed-mcp: ${error.message}\n`);
      return error.exitCode;
    }
    stderr.write(`proceed-mcp: unexpected failure: ${error?.message ?? 'unknown error'}\n`);
    return EXIT_CODE.STORAGE;
  }
}
