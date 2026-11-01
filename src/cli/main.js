// Public CLI dispatch (design section 2). One command group per checkpoint;
// `doctor` remains a documented target that this build does not implement, so
// it fails as an invalid command rather than pretending to check anything.
import { TELEGRAM_TOKEN_ENV } from '../config/portable-config.js';
import { CliError, EXIT_CODE, blockedPrerequisite, invalidArgument } from '../errors.js';
import { createLocalClient, LocalRequestError } from '../http/local-client.js';
import { runMcpServer } from '../mcp/server.js';
import { startBrokerRuntime } from '../broker/runtime.js';
import { readLocalCredential } from '../state/credentials.js';
import { readOwnerCredential } from '../state/owner-credentials.js';
import { resolveStateDir, statePaths } from '../state/paths.js';
import {
  addOrigin,
  addOwner,
  initializeState,
  loadConfiguration,
  loadPortableConfiguration,
} from '../state/store.js';
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
  return blockedPrerequisite(`${message} (${code})`, code);
}

function controlClient(paths, config) {
  return readLocalCredential(paths.controlCredentialFile, 'the control credential').then((token) =>
    createLocalClient({ port: config.broker.port, token }),
  );
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
      '     this build advertises the tool catalog and answers every tools/call with',
      '     ENHANCEMENT_UNAVAILABLE, so no approval can be prepared or resolved yet)',
      '  4. Broker startup, pairing and request delivery are later checkpoints: "serve", "pair",',
      '     "status" and "retry" in this build still read the previous configuration schema',
      '     and refuse this schema 2 state until their own switch lands.',
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
  const config = await loadConfiguration(paths);
  const runtime = await startBrokerRuntime({
    paths,
    config,
    env,
    logger: (message) => stderr.write(`proceed-mcp: ${message}\n`),
  });

  stdout.write(`proceed-mcp: broker ready on http://127.0.0.1:${runtime.port}\n`);
  stdout.write(`proceed-mcp: state directory ${paths.stateDir}\n`);
  await waitForSignal();
  await runtime.stop();
  stdout.write('proceed-mcp: broker stopped\n');
  return EXIT_CODE.OK;
}

async function runPair(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  noPositionals(positionals, 'pair');

  const paths = commandStatePaths(options, env);
  const config = await loadConfiguration(paths);
  const client = await controlClient(paths, config);

  let response;
  try {
    response = await client.request('POST', '/v1/pairing', {});
  } catch (error) {
    throw asCliFailure(error);
  }
  if (response.status !== 201) throw failureFromResponse(response);

  stdout.write(
    [
      `Pairing code: ${response.body.code}`,
      `Valid until ${response.body.expires_at} (one use, five minutes).`,
      '',
      'In the paired human private chat with the bot:',
      '  1. send /start',
      `  2. send /pair ${response.body.code}`,
      '',
      'The code is shown only here; it is never logged or stored in plain text.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

// Design section 2: one stdio MCP server for the operator-selected transport
// principal. Only schema-2 owner state is read, and only that owner's protected
// credential; no harness URL, password, host admission or broker port is needed to
// serve the catalog, and stdout is left to protocol messages alone.
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
  // owner credential is a startup blocker. The later execution unit is the only
  // consumer of the value, so it is never logged, returned or written anywhere.
  await readOwnerCredential(paths.ownerCredentialFile(owner.owner_id), owner.owner_id);

  await runMcpServer();
  return EXIT_CODE.OK;
}

function describeRequest(request) {
  return [
    `${request.request_id}  ${request.resolution}  delivery=${request.delivery_state}  telegram=${request.telegram_state}`,
    `  origin=${request.origin_id}  session=${request.session_id}`,
    `  action=${JSON.stringify(request.action)}`,
    `  expires=${request.expires_at}`,
    ...(request.delivery_error === null || request.delivery_error === undefined
      ? []
      : [`  delivery_error=${request.delivery_error.code}: ${request.delivery_error.message}`]),
  ].join('\n');
}

async function runStatus(argv, { stdout, env }) {
  const { positionals, options, flags } = parseArguments(argv, {
    valueOptions: ['state-dir', 'request'],
    flagOptions: ['json'],
  });
  noPositionals(positionals, 'status');

  const paths = commandStatePaths(options, env);
  const config = await loadConfiguration(paths);
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

  if (flags.has('json')) {
    stdout.write(`${JSON.stringify({ schema_version: 1, requests }, null, 2)}\n`);
    return EXIT_CODE.OK;
  }

  const pairing = response.body.pairing?.paired === true ? 'paired' : 'not paired';
  stdout.write(
    [
      `Broker ${response.body.broker?.pid} on port ${response.body.broker?.port} (${pairing})`,
      requests.length === 0 ? 'No requests.' : requests.map(describeRequest).join('\n'),
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runRetry(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  if (positionals.length !== 1) {
    throw invalidArgument('retry requires exactly one request_id');
  }

  const paths = commandStatePaths(options, env);
  const config = await loadConfiguration(paths);
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
  if (response.status !== 200 && response.status !== 202) throw failureFromResponse(response);

  stdout.write(
    [
      `${response.body.request_id}: delivery ${response.body.delivery_state}`,
      response.status === 202
        ? 'Delivery reconciliation is scheduled; the persisted prompt ID and text are unchanged.'
        : 'Nothing to resume: this request has no pending delivery.',
      '',
    ].join('\n'),
  );
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
