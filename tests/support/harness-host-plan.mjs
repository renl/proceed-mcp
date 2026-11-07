// TEST ONLY. Pure preparation for an unqualified MSYS PTY driver. Does not spawn.
import assert from 'node:assert/strict';
import { win32 } from 'node:path';

export const pins = Object.freeze({
  host: '2.2.5',
  plugin: '2.2.5',
  client: '2.2.5',
  script: '2.40.2',
  source: '9bbb8ce18c80f099e0e448775f59d965ead40a21',
});

export const hostBudgets = Object.freeze({
  aggregate: 300000,
  teardownReserve: 45000,
  readiness: 60000,
  interaction: 15000,
  outer: 310000,
});

// Fail closed before staging or spawn. These are missing mechanisms, not permissions
// to install an adapter, alter a firewall or accept source flags as network proof.
export const launchBlockers = Object.freeze([
  {
    check: 'owned-process-containment',
    status: 'BLOCKED',
    reason:
      'MSYS script exposes PTY I/O, not a Windows descendant ownership boundary. EOF and root exit do not guarantee private serve child exit. No race-free owned PID registry, termination and absence mechanism is established.',
  },
  {
    check: 'external-egress-isolation',
    status: 'BLOCKED',
    reason:
      'The candidate has no process-scoped egress enforcement or descendant-attributed network observation. Disabled model fetch and updater flags do not block other host traffic. No firewall or network adapter change is authorized.',
  },
]);

export function isolatedWindowsEnvironment(root, parent, toolPath) {
  assert.ok(win32.isAbsolute(root), 'absolute run root required');
  assert.ok(toolPath, 'explicit tool PATH required');
  const at = (name) => win32.join(root, name);
  // Deliberate allowlist, not {...process.env}. No host auth/provider/config inheritance.
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC']) {
    const found = Object.keys(parent).find((entry) => entry.toLowerCase() === key.toLowerCase());
    if (found) env[key] = parent[found];
  }
  return {
    ...env,
    PATH: toolPath,
    TERM: 'xterm-256color',
    HOME: at('home'),
    USERPROFILE: at('home'),
    OPENCODE_TEST_HOME: at('home'),
    XDG_DATA_HOME: at('data'),
    XDG_CACHE_HOME: at('cache'),
    XDG_CONFIG_HOME: at('config'),
    XDG_STATE_HOME: at('state'),
    OPENCODE_CONFIG_DIR: at('service-config'),
    ProgramData: at('program-data'),
    TEMP: at('temp'),
    TMP: at('temp'),
    TMPDIR: at('temp'),
    OPENCODE_CONFIG_PROJECT_DISABLE: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
  };
}

function shellQuote(value) {
  assert.ok(!/[\r\n\0]/.test(value), 'no shell control characters');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function scriptArguments({ host, transcript }) {
  assert.ok(win32.isAbsolute(host), 'explicit absolute host executable required');
  assert.ok(win32.isAbsolute(transcript), 'absolute run-owned transcript required');
  // MSYS path translation and Windows native console compatibility are still UNPROVEN.
  // No silent fallback to a different host, PTY package or console adapter.
  const command = `${shellQuote(host.replaceAll('\\', '/'))} --standalone`;
  return [
    '--command',
    command,
    '--return',
    '--quiet',
    '--flush',
    '--echo',
    'never',
    '--log-out',
    transcript,
    '--output-limit',
    '1048576',
  ];
}

// Future live runner must wait for BOTH the fixture event and PTY-rendered title.
// This is a minimal transcript predicate, not a terminal emulator or visual proof.
export function dialogObserved(events, transcript, id, prompt = false) {
  const phase = prompt ? 'prompt-requested' : 'select-requested';
  const title = prompt ? `Proceed response ${id}` : `Proceed qualification ${id}`;
  const plain = transcript.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  return (
    events.some((event) => event.phase === phase && event.id === id) &&
    new RegExp(`${title}(?![0-9])`).test(plain)
  );
}

export const interactionPlan = Object.freeze([
  { id: 1, open: '\x07', title: 'Proceed qualification 1', keys: '\x1b', outcome: 'dismissed' },
  { id: 2, open: '\x07', title: 'Proceed qualification 2', keys: '\r', outcome: 'reject' },
  { id: 3, open: '\x07', title: 'Proceed qualification 3', keys: 'Respond\r', outcome: 'prompt' },
  { id: 3, title: 'Proceed response 3', keys: 'approved\r', outcome: 'respond' },
]);
