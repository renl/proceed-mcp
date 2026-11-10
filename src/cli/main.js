// Public CLI dispatch (design section 2). One command group per checkpoint;
// `doctor` remains a documented target that this build does not implement, so
// it fails as an invalid command rather than pretending to check anything.
import { join, resolve } from 'node:path';
import { writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { TELEGRAM_TOKEN_ENV } from '../config/portable-config.js';
import {
  CliError,
  EXIT_CODE,
  blockedPrerequisite,
  invalidArgument,
  storageFailure,
} from '../errors.js';
import {
  awaitSecureAvailability,
  probeOccupancy,
  spawnDetachedBroker,
  startupConflict,
  startupTimeout,
  PROBE_TIMEOUT_MS,
  STARTUP_BUDGET_MS,
  STARTUP_DEADLINE_ENV,
} from '../broker/availability.js';
import { lifecycleEnvelopeProblem } from '../broker/lifecycle-envelope.js';
import { startupToolFailure } from '../broker/startup-failure.js';
import {
  createSecureLocalClient,
  secureExchange,
  LocalRequestError,
  SecureChannelError,
} from '../http/local-client.js';
import { LOCAL_WAIT_TIMEOUT_MS, LOCAL_REQUEST_TIMEOUT_MS } from '../http/local-client.js';
import { createToolExecutor } from '../mcp/execution.js';
import { createRegistrationBinding } from '../mcp/registration.js';
import { runMcpServer } from '../mcp/server.js';
import { createOperatorKeyFile, validateOperatorKeyFileOption } from '../harness/operator-key.js';
import { harnessIdProblem } from '../harness/identifiers.js';
import { startPortableRuntime } from '../broker/portable-runtime.js';
import {
  defaultCredentialFile,
  loadCredentialFile,
  provisionCredentialFile,
  readTokenFromStdin,
  validateCredentialFileOption,
} from '../state/credential-file.js';
import { readLocalCredential } from '../state/credentials.js';
import { readOwnerCredential } from '../state/owner-credentials.js';
import { readSecureOwnership } from '../state/ownership.js';
import { resolveStateDir, statePaths } from '../state/paths.js';
import { addOrigin, addOwner, initializeState, loadPortableConfiguration } from '../state/store.js';
import { createTelegramClient } from '../telegram/client.js';
import { renderPortableHumanOutcome } from '../telegram/portable-render.js';
import { PAIRING_CODE_PATTERN, isPlainObject, isUtcTimestamp } from '../util/values.js';
import { parseArguments, requireOptions } from './args.js';

const PACKAGE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TOKEN_FILE_OPTION = 'telegram-token-file';
const STOP_BUDGET_MS = 30_000;
// Automatic startup accepts one environment token shape: 1-4096 non-whitespace
// ASCII bytes (0x21-0x7e). Unlike file or stdin input there is no line terminator
// to remove, so the value is never trimmed, normalized or echoed.
const MAX_ENVIRONMENT_TOKEN_BYTES = 4096;

const USAGE = [
  'proceed-mcp - Telegram approval broker for OpenCode V2 sessions',
  '',
  'Usage:',
  '  proceed-mcp init [--state-dir <directory>]',
  '  proceed-mcp owner add <owner_id> --label <label> [--state-dir <directory>]',
  '  proceed-mcp telegram provision --token-stdin [--telegram-token-file <absolute-file>] [--state-dir <directory>]',
  '  proceed-mcp harness keygen --operator-key-file <absolute-file> [--state-dir <directory>]',
  '  proceed-mcp serve [--state-dir <directory>] [--secure-local] [--telegram-token-file <absolute-file>]',
  '  proceed-mcp pair [--state-dir <directory>] [--telegram-token-file <absolute-file>]',
  '  proceed-mcp mcp --owner <owner_id> [--harness-id <harness_id>] [--state-dir <directory>] [--telegram-token-file <absolute-file>]',
  '  proceed-mcp stop [--state-dir <directory>]',
  '  proceed-mcp status [--request <request_id>] [--json] [--state-dir <directory>]',
  '  proceed-mcp retry <request_id> [--state-dir <directory>]',
  '  proceed-mcp origin add <origin_id> --url <url> --password-env <name> [--state-dir <directory>]',
  '',
  'State directory: --state-dir, then PROCEED_STATE_DIR, then <home>/.proceed-mcp.',
  'Owner ids: [a-z0-9_-]{1,64}; labels: 1-128 characters, display only.',
  'Origin URL (previous configuration schema only): http://127.0.0.1:<explicit-port>',
  'with no path, query, fragment or credentials.',
  '',
  'The Telegram token is never stored in state or passed in command arguments.',
  'Automatic startup selects one source, in this order: --telegram-token-file, then a nonempty',
  `private ${TELEGRAM_TOKEN_ENV} in the launch environment, then the default credential file.`,
  'For the file route, "telegram provision --token-stdin" writes that file once, owner-only, outside',
  'this repository and the state directory; only the broker reads it. That file is not encrypted and',
  'other processes running as the same account can read it.',
  'Environment mode needs the token supplied privately again for each fresh launch. Changing the',
  'launch value does not change an already running broker: stop it and start its replacement through',
  'the supported commands instead.',
  'For the trusted harness, "harness keygen" writes one create-only, owner-only operator credential',
  'outside this repository, the state directory and MCP configuration. It enrolls nothing and approves',
  'no work; the paired human confirms the matching public fingerprint in the private chat.',
  '`mcp`, `pair`, `status` and `stop` require the secure local channel; a legacy HTTP broker must be',
  'stopped through its own interface and restarted with `serve --secure-local` or provisioned automatic startup.',
  'This checkpoint runs portable schema 2 setup: init, owner add, pair, serve, mcp and status.',
  'Local waiting, Telegram question display and paired-human Approve, Reject and Respond are available. Respond text is instructions, not approval.',
  'Client and transport timeouts limit how long a waiting call can wait, and a timeout does not cancel the durable request.',
  'A lost waiting call does not cancel the durable request.',
  'MCP Events are unsupported in this build, and automatic resumption after a timeout is unavailable.',
  '`mcp` starts or reuses one shared local broker when the state is safely unowned; closing the',
  'adapter never stops that broker. `stop` authenticates and matches the instance before a graceful stop.',
  '`doctor` is a documented target that this build does not implement.',
  '',
  'Exit codes: 0 completed, 2 invalid arguments or configuration, 3 unavailable prerequisite,',
  '            4 storage or integrity failure. Diagnostics are written to stderr.',
  '',
].join('\n');

function commandStatePaths(options, env) {
  return statePaths(resolveStateDir({ option: options.get('state-dir'), env }));
}

// The automatic launcher hands its child one absolute instant (design section 5).
// A foreground invocation carries none and keeps its open-ended lifetime, so this
// is a private propagation input rather than a public option.
function startupDeadlineFrom(env) {
  const raw = env[STARTUP_DEADLINE_ENV];
  if (typeof raw !== 'string' || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// One budget: every prerequisite awaited after this point is charged to the same
// original attempt, never to a fresh child or probe.
function remainingStartupBudget(startedAt) {
  return STARTUP_BUDGET_MS - (performance.now() - startedAt);
}

// Design section 5 requires a startup-dependent call to return by its deadline.
// A local prerequisite read cannot be cancelled, so the standalone command ends at
// the deadline instead of waiting past it; nothing has been launched, owned or
// written at that point.
function abandonedStartupTimeout() {
  const error = startupTimeout();
  error.expiredWhilePending = true;
  return error;
}

async function withinStartupBudget(startedAt, work) {
  const remaining = remainingStartupBudget(startedAt);
  if (remaining <= 0) throw startupTimeout();
  let timer;
  const expiry = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(abandonedStartupTimeout()), remaining);
  });
  try {
    return await Promise.race([work(), expiry]);
  } finally {
    clearTimeout(timer);
  }
}

function noPositionals(positionals, command) {
  if (positionals.length > 0) {
    throw invalidArgument(
      `${command} takes no positional arguments (received "${positionals[0]}")`,
    );
  }
}

// Options carry paths, never token values. A relative or ambiguous source is
// invalid input before any state is read, so a missing state directory and a
// malformed option stay distinguishable classifications. Foreground serving is
// the only mode where a file option plus a nonempty environment token is
// ambiguous; automatic startup ignores an inherited token entirely.
function tokenFileFrom(options, env, { conflict = false } = {}) {
  const requested = options.get(TOKEN_FILE_OPTION);
  if (requested === undefined) return { file: undefined };
  const file = validateCredentialFileOption(requested);
  const envToken = env[TELEGRAM_TOKEN_ENV];
  if (conflict && envToken !== undefined && envToken !== '') {
    throw invalidArgument(
      `--${TOKEN_FILE_OPTION} cannot be combined with ${TELEGRAM_TOKEN_ENV}; choose one credential source`,
    );
  }
  return { file };
}

// A secure-admission failure is never reported as an ordinary transport error: an
// established listener that cannot prove the expected channel is a conflict.
function channelCliFailure(error) {
  if (error instanceof SecureChannelError) {
    if (error.code === 'BROKER_INSTANCE_CONFLICT') {
      return blockedPrerequisite(
        'the configured listener could not prove the expected secure local channel (BROKER_INSTANCE_CONFLICT)',
        'BROKER_INSTANCE_CONFLICT',
      );
    }
    return blockedPrerequisite('the secure broker is not reachable', 'BROKER_UNAVAILABLE');
  }
  return error;
}

function legacyUpgrade() {
  return blockedPrerequisite(
    'the running broker uses the legacy local channel; stop it through its own Ctrl+C or operator interface, then restart with "serve --secure-local" or supply the token privately on the next automatic launch, or provision the token file for automatic startup (BROKER_INSTANCE_CONFLICT)',
    'BROKER_INSTANCE_CONFLICT',
  );
}

async function secureRecordOrThrow(lockFile) {
  const record = await readSecureOwnership(lockFile);
  if (record.absent === true) {
    throw blockedPrerequisite(
      'no broker is running for this state directory; start "proceed-mcp serve" or use automatically started startup',
      'BROKER_UNAVAILABLE',
    );
  }
  if (record.schemaVersion === 1) throw legacyUpgrade();
  return record;
}

// Broker-dependent work waits for the one shared availability attempt; a failed
// attempt becomes the documented tool-level prerequisite rather than an approval
// or a fabricated outcome. The CLI classification is kept on the local error so
// the adapter's fixed mapping still publishes the safe command template; the
// underlying exception, child or TLS text is never forwarded.
function gateClient(client, availability) {
  return {
    async request(...args) {
      try {
        await availability;
      } catch (error) {
        throw new LocalRequestError(
          error?.code ?? 'BROKER_UNAVAILABLE',
          startupToolFailure(error).message,
        );
      }
      return client.request(...args);
    },
  };
}

function packageEntryPoint() {
  const entry = process.argv[1];
  if (typeof entry === 'string' && entry !== '') return resolve(entry);
  return join(PACKAGE_ROOT, 'bin', 'proceed-mcp.js');
}

// A missing or unreachable broker stays an unavailable prerequisite; a secure
// admission failure is classified by the caller that knows the channel context.
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
  const { positionals, options, flags } = parseArguments(argv, {
    valueOptions: ['state-dir', TOKEN_FILE_OPTION],
    flagOptions: ['secure-local'],
  });
  noPositionals(positionals, 'serve');

  const { file } = tokenFileFrom(options, env, { conflict: true });
  const paths = commandStatePaths(options, env);
  const config = await loadPortableConfiguration(paths);
  const logger = (message) => stderr.write(`proceed-mcp: ${message}\n`);

  // Without either new option this remains the legacy foreground HTTP listener
  // with schema-1 ownership and environment-only token input. It gains neither a
  // secure channel nor a lifecycle route.
  if (file === undefined && !flags.has('secure-local')) {
    const token = env[TELEGRAM_TOKEN_ENV];
    const telegram = token === undefined || token === '' ? null : createTelegramClient({ token });
    const runtime = await startPortableRuntime({ paths, config, telegram, logger });
    stdout.write(`proceed-mcp: broker ready on http://127.0.0.1:${runtime.port}\n`);
    stdout.write(`proceed-mcp: state directory ${paths.stateDir}\n`);
    // Local readiness does not depend on the token: one diagnostic after success only.
    if (telegram === null) {
      stderr.write(
        `proceed-mcp: Telegram unavailable: set ${TELEGRAM_TOKEN_ENV} and restart serve; local broker only\n`,
      );
    }
    await Promise.race([waitForSignal(), runtime.stopped]);
    await runtime.stop();
    stdout.write('proceed-mcp: stopped\n');
    return EXIT_CODE.OK;
  }

  // Secure file mode loads the credential here, before ownership, so an unsafe
  // file refuses without creating any ownership record. Secure foreground mode
  // needs no token file and keeps its own environment input. An automatic child
  // also refuses to begin when its caller's original budget has already expired.
  const startupDeadlineAt = startupDeadlineFrom(env);
  if (startupDeadlineAt !== null && Date.now() >= startupDeadlineAt) throw startupTimeout();
  const token =
    file === undefined
      ? env[TELEGRAM_TOKEN_ENV] === undefined || env[TELEGRAM_TOKEN_ENV] === ''
        ? null
        : env[TELEGRAM_TOKEN_ENV]
      : await loadCredentialFile({ file, stateDir: paths.stateDir });
  const telegram = token === null ? null : createTelegramClient({ token });
  const runtime = await startPortableRuntime({
    paths,
    config,
    telegram,
    logger,
    secure: true,
    startupDeadlineAt,
  });

  stdout.write(`proceed-mcp: broker ready on https://127.0.0.1:${runtime.port}\n`);
  stdout.write(`proceed-mcp: state directory ${paths.stateDir}\n`);
  if (telegram === null) {
    stderr.write(`proceed-mcp: Telegram unavailable: no token was supplied; local broker only\n`);
  }
  // An authenticated stop drains the same runtime as Ctrl+C, so either ending
  // completes the same graceful stop.
  await Promise.race([waitForSignal(), runtime.stopped]);
  await runtime.stop();
  stdout.write('proceed-mcp: broker stopped\n');
  return EXIT_CODE.OK;
}

// Explicit, create-only provisioning (design sections 1-2). The token arrives
// only through non-TTY stdin, no broker is started, and the destination is never
// overwritten, truncated, deleted or read for comparison.
async function runProvision(argv, { stdout, stdin, env }) {
  const { positionals, options, flags } = parseArguments(argv, {
    valueOptions: ['state-dir', TOKEN_FILE_OPTION],
    flagOptions: ['token-stdin'],
  });
  noPositionals(positionals, 'telegram provision');
  if (!flags.has('token-stdin')) {
    throw invalidArgument('telegram provision requires --token-stdin');
  }
  const requested = options.get(TOKEN_FILE_OPTION);
  if (requested !== undefined) validateCredentialFileOption(requested);

  const paths = commandStatePaths(options, env);
  await loadPortableConfiguration(paths);
  const file =
    requested === undefined ? defaultCredentialFile({ stateDir: paths.stateDir }) : requested;
  const token = await readTokenFromStdin(stdin);
  await provisionCredentialFile({ file, stateDir: paths.stateDir, token });
  stdout.write(
    `Provisioned the automatic-startup Telegram credential at ${file} (value not shown).\n` +
      'This file is owner-only, not encrypted, and readable by other processes using the same account.\n' +
      'The broker alone loads it; do not pass the token to the MCP adapter environment.\n',
  );
  return EXIT_CODE.OK;
}

async function runTelegramCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'provision') {
    throw invalidArgument('telegram supports only "provision"');
  }
  return runProvision(rest, context);
}

// Create-only operator credential (design section 1). The command takes a path,
// never a secret; it refuses an existing destination, reports only the nonsecret
// destination and public fingerprint, and neither enrolls the key nor approves
// work.
async function runHarnessKeygen(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, {
    valueOptions: ['state-dir', 'operator-key-file'],
  });
  noPositionals(positionals, 'harness keygen');
  requireOptions(options, ['operator-key-file']);
  const file = validateOperatorKeyFileOption(options.get('operator-key-file'));
  const paths = commandStatePaths(options, env);
  const result = await createOperatorKeyFile({ file, stateDir: paths.stateDir });
  stdout.write(
    [
      `Operator credential written to ${result.file} (value not shown).`,
      `Operator key fingerprint (key_id): ${result.keyId}`,
      'This file is owner-only and not encrypted; other processes using the same account can read it.',
      'Keep it outside repositories and MCP configuration, and load it only in the trusted local TUI.',
      'The key is not enrolled yet and approves no work. In the paired private chat, send',
      '"/harness <enrollment_id>" from the TUI setup and confirm only the matching fingerprint.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runHarnessCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'keygen') {
    throw invalidArgument('harness supports only "keygen"');
  }
  return runHarnessKeygen(rest, context);
}

// Automatic startup selects a source only for an admitted cold launch: an absent
// or exactly empty environment value is not a source and leaves the default file.
function environmentTokenProblem() {
  return blockedPrerequisite(
    `the ${TELEGRAM_TOKEN_ENV} value is not a usable Telegram token; supply 1-4096 private non-whitespace ASCII bytes in ${TELEGRAM_TOKEN_ENV} for the next launch, or select a safe token file (TELEGRAM_CREDENTIAL_UNAVAILABLE)`,
    'TELEGRAM_CREDENTIAL_UNAVAILABLE',
  );
}

function environmentTokenFrom(env) {
  const value = env[TELEGRAM_TOKEN_ENV];
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_ENVIRONMENT_TOKEN_BYTES) {
    throw environmentTokenProblem();
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) throw environmentTokenProblem();
  }
  return value;
}

// Launch the installed broker entry point from this same package using the
// current runtime executable and one selected source. Selection happens only for
// an admitted cold launch, so reusing a matching healthy broker loads, validates
// or defaults nothing: an explicitly selected file wins, then a nonempty command
// environment value, then the existing default file. A selected-source failure
// never falls back, and only the selected environment value travels to the child,
// never into arguments or a serialized launch description.
function launchAutomaticBroker({ paths, file, env, deadlineAt }) {
  const environmentToken = file === undefined ? environmentTokenFrom(env) : null;
  const selectedFile =
    file ??
    (environmentToken === null ? defaultCredentialFile({ stateDir: paths.stateDir }) : null);
  try {
    spawnDetachedBroker({
      executable: packageEntryPoint(),
      args:
        environmentToken === null
          ? ['serve', '--telegram-token-file', selectedFile, '--state-dir', paths.stateDir]
          : ['serve', '--secure-local', '--state-dir', paths.stateDir],
      cwd: PACKAGE_ROOT,
      environment: env,
      environmentToken,
      deadlineAt,
    });
  } catch {
    // A synchronous launch failure becomes a fixed availability classification,
    // never raw spawn arguments, options or an environment dump.
    throw blockedPrerequisite(
      'the broker could not be launched for automatic startup; inspect "proceed-mcp status" before a new attempt (BROKER_UNAVAILABLE)',
      'BROKER_UNAVAILABLE',
    );
  }
}

async function runPair(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, {
    valueOptions: ['state-dir', TOKEN_FILE_OPTION],
  });
  noPositionals(positionals, 'pair');

  const attemptStart = performance.now();
  const { file, paths, config, control } = await withinStartupBudget(attemptStart, async () => {
    const { file } = tokenFileFrom(options, env);
    const paths = commandStatePaths(options, env);
    const config = await loadPortableConfiguration(paths);
    const control = await readLocalCredential(
      paths.controlCredentialFile,
      'the control credential',
    );
    return { file, paths, config, control };
  });

  // Design sections 1 and 3: pairing ensures the same shared broker availability
  // before the control-authenticated challenge, so an initial pairing needs no
  // manual broker terminal. A secure foreground broker is reused without a token
  // file, and a launch candidate still races on the exclusive ownership record.
  const record = await awaitSecureAvailability({
    lockFile: paths.brokerLockFile,
    port: config.broker.port,
    token: control,
    budgetMs: remainingStartupBudget(attemptStart),
    launch: ({ deadlineAt }) => launchAutomaticBroker({ paths, file, env, deadlineAt }),
  });

  let response;
  try {
    response = await secureExchange({
      lock: record,
      token: control,
      method: 'POST',
      path: '/v1/pairing',
      body: {},
      timeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw channelCliFailure(error);
  }
  // The challenge is the operator's own new setup material, written only after the
  // broker's committed response: no partial code and no paired-success claim.
  const challenge = pairingChallengeFrom(response);
  stdout.write(`Pairing code: ${challenge.code}\nExpires at: ${challenge.expiresAt}\n`);
  return EXIT_CODE.OK;
}

// Design section 3: one stdio MCP server for the operator-selected transport
// principal. Only schema-2 owner state is read, and only that owner's protected
// credential; no harness URL, password, host admission or proprietary metadata is
// needed to serve the catalog, and stdout is left to protocol messages alone. Tool
// execution uses that credential against the configured loopback broker port, so
// preparation reserves real authority and the waiting call waits on a longer
// deadline. One availability attempt starts at adapter launch: it never blocks
// initialization or catalog traffic, and broker-dependent calls await its shared
// result. The adapter passes only the nonsecret credential path to a detached
// broker child; it never opens that file.
async function runMcp(argv, { env }) {
  const { positionals, options } = parseArguments(argv, {
    valueOptions: ['state-dir', 'owner', 'harness-id', TOKEN_FILE_OPTION],
  });
  noPositionals(positionals, 'mcp');
  requireOptions(options, ['owner']);

  // Opting this adapter into the configured host namespace is explicit: the
  // harness identity is validated here and only transport metadata may name the
  // session route. Omission keeps Telegram-only behavior.
  const harnessId = options.get('harness-id');
  if (harnessId !== undefined) {
    const problem = harnessIdProblem(harnessId);
    if (problem !== null) throw invalidArgument(problem);
  }

  // The one availability attempt starts at adapter launch: prerequisites, launch
  // and adoption all share this original budget.
  const attemptStart = performance.now();
  const { file, paths, config, credential } = await withinStartupBudget(attemptStart, async () => {
    const { file } = tokenFileFrom(options, env);
    const paths = commandStatePaths(options, env);
    const config = await loadPortableConfiguration(paths);
    const ownerId = options.get('owner');
    const owner = config.owners.find((entry) => entry.owner_id === ownerId);
    if (owner === undefined) {
      throw invalidArgument(
        `owner ${ownerId} is not configured; run "proceed-mcp owner add ${ownerId} --label <label>"`,
      );
    }
    // Fail closed when the principal has no usable authority: a missing or
    // damaged owner credential is a startup blocker. The value authorizes broker
    // calls only, so it is never logged, returned or written anywhere.
    const credential = await readOwnerCredential(
      paths.ownerCredentialFile(owner.owner_id),
      owner.owner_id,
    );
    return { file, paths, config, credential };
  });
  const controller = new AbortController();
  const availability = awaitSecureAvailability({
    lockFile: paths.brokerLockFile,
    port: config.broker.port,
    token: credential,
    budgetMs: remainingStartupBudget(attemptStart),
    signal: controller.signal,
    launch: ({ deadlineAt }) => launchAutomaticBroker({ paths, file, env, deadlineAt }),
  });
  // A failed attempt is reported through broker-dependent calls, never as a
  // process crash during initialization.
  availability.catch(() => {});

  const client = gateClient(
    createSecureLocalClient({
      port: config.broker.port,
      lockFile: paths.brokerLockFile,
      token: credential,
    }),
    availability,
  );
  // The waiting call keeps its own longer deadline, because one broker poll
  // turnover is slower than an ordinary management exchange.
  const waitClient = gateClient(
    createSecureLocalClient({
      port: config.broker.port,
      lockFile: paths.brokerLockFile,
      token: credential,
      timeoutMs: LOCAL_WAIT_TIMEOUT_MS,
    }),
    availability,
  );

  // The executor owns this adapter's private registration: it is created lazily by
  // the first implemented call, renewed while the adapter lives, and released here.
  // Closing stdin fences new work immediately and one close covers ordinary and
  // lifecycle traffic under the single shutdown budget.
  const executor = createToolExecutor({
    client,
    waitClient,
    registration: createRegistrationBinding({ client }),
    harnessId: harnessId ?? null,
  });
  try {
    await runMcpServer({
      execute: executor.execute,
      // The one successful-write report for an eligible original wait outcome: the
      // executor selects eligibility, and the report never delays or repeats this result.
      onResultWritten: (message, response) => executor.reportWritten(response.result),
      onInputClosed: () => {
        // EOF abandons discovery immediately; a launched detached candidate keeps
        // its own finite startup responsibility.
        controller.abort();
        void executor.close();
      },
    });
  } finally {
    controller.abort();
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
  const control = await readLocalCredential(paths.controlCredentialFile, 'the control credential');
  const record = await secureRecordOrThrow(paths.brokerLockFile);

  let response;
  try {
    response = await secureExchange({
      lock: record,
      token: control,
      method: 'GET',
      path: '/v1/status',
      timeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw channelCliFailure(error);
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
  await loadPortableConfiguration(paths);
  const control = await readLocalCredential(paths.controlCredentialFile, 'the control credential');
  const record = await secureRecordOrThrow(paths.brokerLockFile);

  let response;
  try {
    response = await secureExchange({
      lock: record,
      token: control,
      method: 'POST',
      path: `/v1/requests/${encodeURIComponent(positionals[0])}/retry`,
      body: {},
      timeoutMs: LOCAL_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw channelCliFailure(error);
  }
  unavailableResponse(response);
  return EXIT_CODE.OK;
}

// Explicit operator stop (design section 6): authenticate and match the instance,
// then request graceful stop. It never signals a recorded PID, never sends a
// control Bearer to establish listener identity, and treats only a definitely
// absent record plus an explicit connection refusal as an idempotent success.
async function runStop(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  noPositionals(positionals, 'stop');

  // Design section 6: the whole 30000 ms command budget covers prerequisites and
  // the final success check, not just the shutdown exchange. Every phase is
  // admitted only while real time remains, and no phase gets a fresh clamp that
  // would hide an expired caller budget.
  const deadline = performance.now() + STOP_BUDGET_MS;
  const remaining = () => deadline - performance.now();
  const ensureBudget = () => {
    if (remaining() <= 0) {
      throw blockedPrerequisite(
        'the broker stop was not confirmed in time; ownership is preserved (BROKER_STOP_TIMEOUT)',
        'BROKER_STOP_TIMEOUT',
      );
    }
  };

  const paths = commandStatePaths(options, env);
  ensureBudget();
  const config = await loadPortableConfiguration(paths);
  ensureBudget();
  const control = await readLocalCredential(paths.controlCredentialFile, 'the control credential');
  ensureBudget();

  const record = await readSecureOwnership(paths.brokerLockFile);
  // An uncancellable read that settles after the deadline is not success and may
  // not admit the occupancy probe.
  ensureBudget();
  if (record.absent === true) {
    const probe = await probeOccupancy(config.broker.port, {
      timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1, remaining())),
    });
    ensureBudget();
    if (probe === 'refused') {
      stdout.write('No broker is running for this state directory.\n');
      return EXIT_CODE.OK;
    }
    throw startupConflict(
      'the configured port is occupied without a matching ownership record (BROKER_INSTANCE_CONFLICT)',
    );
  }
  if (record.schemaVersion === 1) throw legacyUpgrade();

  // Readiness is admitted over the secure channel first; a stop never sends a
  // control credential to an endpoint that has not proven the channel.
  let readiness;
  try {
    readiness = await secureExchange({
      lock: record,
      token: control,
      method: 'GET',
      path: '/v1/ready',
      timeoutMs: Math.min(1000, Math.max(1, remaining())),
      maxBytes: 16_384,
    });
  } catch (error) {
    throw channelCliFailure(error);
  }
  ensureBudget();
  if (readiness.status !== 200 || lifecycleEnvelopeProblem(readiness.body, record) !== null) {
    throw startupConflict(
      'the broker did not confirm matching readiness (BROKER_INSTANCE_CONFLICT)',
    );
  }

  let accepted;
  try {
    accepted = await secureExchange({
      lock: record,
      token: control,
      method: 'POST',
      path: '/v1/shutdown',
      body: { instance: record.instance },
      timeoutMs: Math.max(1, remaining()),
      maxBytes: 16_384,
    });
  } catch (error) {
    throw channelCliFailure(error);
  }
  // Expiry while the shutdown exchange was pending refuses the result instead of
  // treating a late 202 as an accepted stop.
  ensureBudget();
  if (accepted.status === 409) {
    throw startupConflict(
      'the broker instance changed before stop was accepted (BROKER_INSTANCE_CONFLICT)',
    );
  }
  if (accepted.status !== 202) throw failureFromResponse(accepted);
  if (
    accepted.body?.schema_version !== 1 ||
    accepted.body?.instance !== record.instance ||
    accepted.body?.stopping !== true
  ) {
    throw startupConflict(
      'the broker returned no supported stop acceptance (BROKER_INSTANCE_CONFLICT)',
    );
  }

  // A 202 means stop accepted, not complete: wait for the exact record to
  // disappear and the matching listener to cease, without force-killing anything.
  for (;;) {
    // The polling delay may consume the last of the budget: a continuation that
    // starts after expiry cannot open another protected read.
    ensureBudget();
    const current = await readSecureOwnership(paths.brokerLockFile);
    ensureBudget();
    if (current.absent === true) {
      const probe = await probeOccupancy(config.broker.port, {
        timeoutMs: Math.min(PROBE_TIMEOUT_MS, Math.max(1, remaining())),
      });
      // An expired observation is not an idempotent success.
      ensureBudget();
      if (probe === 'refused') {
        stdout.write('Broker stopped.\n');
        return EXIT_CODE.OK;
      }
    }
    ensureBudget();
    await delay(Math.min(100, Math.max(1, remaining())));
  }
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
  if (command === 'telegram') return runTelegramCommand(rest, context);
  if (command === 'harness') return runHarnessCommand(rest, context);
  if (command === 'serve') return runServe(rest, context);
  if (command === 'pair') return runPair(rest, context);
  if (command === 'mcp') return runMcp(rest, context);
  if (command === 'stop') return runStop(rest, context);
  if (command === 'status') return runStatus(rest, context);
  if (command === 'retry') return runRetry(rest, context);

  throw invalidArgument(
    `unknown command "${command}"; run "proceed-mcp --help" for the commands in this build`,
  );
}

export async function run(argv, io) {
  // Only the standalone executable has no injected io; an embedding caller always
  // supplies streams and receives the exit code instead.
  const standalone = io === undefined;
  io = io ?? {};
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const stdin = io.stdin ?? process.stdin;

  try {
    return await dispatch(argv, { stdout, stderr, env, stdin });
  } catch (error) {
    if (error instanceof CliError) {
      const message = `proceed-mcp: ${error.message}\n`;
      if (standalone && error.expiredWhilePending === true) {
        // The documented startup deadline is stricter than an uncancellable pending
        // prerequisite read. No detached process, ownership record or secret write
        // exists at this point, so the standalone command ends exactly at its
        // deadline with a synchronous diagnostic rather than waiting past it.
        try {
          writeSync(2, message);
        } catch {
          /* stderr is unavailable; the exit code still classifies the failure */
        }
        process.exit(error.exitCode);
      }
      stderr.write(message);
      return error.exitCode;
    }
    stderr.write(`proceed-mcp: unexpected failure: ${error?.message ?? 'unknown error'}\n`);
    return EXIT_CODE.STORAGE;
  }
}
