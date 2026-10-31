// Public CLI dispatch for the setup checkpoint. Only the commands implemented
// in this build are dispatched; every other name is an invalid argument rather
// than a silent no-op. One checkpoint adds one command group.
import { TELEGRAM_TOKEN_ENV } from '../config/config.js';
import { CliError, EXIT_CODE, invalidArgument } from '../errors.js';
import { resolveStateDir, statePaths } from '../state/paths.js';
import { addOrigin, initializeState } from '../state/store.js';
import { parseArguments, requireOptions } from './args.js';

const USAGE = [
  'proceed-mcp - Telegram approval broker for OpenCode V2 sessions',
  '',
  'Usage:',
  '  proceed-mcp init [--state-dir <directory>]',
  '  proceed-mcp origin add <origin_id> --url <url> --password-env <name> [--state-dir <directory>]',
  '',
  'State directory: --state-dir, then PROCEED_STATE_DIR, then <home>/.proceed-mcp.',
  'Origin URL: http://127.0.0.1:<explicit-port> with no path, query, fragment or credentials.',
  '',
  'Other commands (serve, pair, mcp, doctor, status, retry) are not implemented in this build.',
  '',
  'Exit codes: 0 completed, 2 invalid arguments or configuration, 3 unavailable prerequisite,',
  '            4 storage or integrity failure. Diagnostics are written to stderr.',
  '',
].join('\n');

function commandStatePaths(options, env) {
  return statePaths(resolveStateDir({ option: options.get('state-dir'), env }));
}

async function runInit(argv, { stdout, env }) {
  const { positionals, options } = parseArguments(argv, { valueOptions: ['state-dir'] });
  if (positionals.length > 0) {
    throw invalidArgument(`init takes no positional arguments (received "${positionals[0]}")`);
  }

  const result = await initializeState(commandStatePaths(options, env));
  stdout.write(
    [
      `Initialized proceed-mcp state at ${result.stateDir}`,
      `Configuration schema version: ${result.config.schema_version}`,
      `Control credential written to ${result.controlCredentialFile} (value not shown)`,
      '',
      'Remaining setup - this command verified none of it:',
      '  1. proceed-mcp origin add <origin_id> --url http://127.0.0.1:<port> --password-env <PASSWORD_ENV>',
      `  2. Set ${TELEGRAM_TOKEN_ENV} in the broker environment; the Telegram token is never stored in state.`,
      '  3. Pairing, MCP wiring, session continuation and release support are not configured yet.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
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
      'No service was started; pairing and session continuation are not configured yet.',
      '',
    ].join('\n'),
  );
  return EXIT_CODE.OK;
}

async function runOriginCommand(argv, context) {
  const [subcommand, ...rest] = argv;
  if (subcommand !== 'add') {
    throw invalidArgument('origin supports only "add" in this build');
  }
  return runOriginAdd(rest, context);
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
  if (command === 'origin') return runOriginCommand(rest, context);

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
