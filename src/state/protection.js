// Owner-only filesystem protection for state and credential files.
// POSIX: 0700 directories and 0600 files validated by mode bits. Windows: an
// owner-restricted DACL validated through Get-Acl, because a requested POSIX
// mode proves nothing there (design section 2). The state directory is
// protected before any credential exists inside it, so children inherit an
// owner-only ACL; verification failure is always a hard failure.
import { execFile } from 'node:child_process';
import { chmod, mkdir, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { storageFailure } from '../errors.js';

const execFileAsync = promisify(execFile);

const POSIX_DIRECTORY_MODE = 0o700;
const WINDOWS_ACL_TIMEOUT_MS = 20_000;

// Sets (mode=protect) or verifies (mode=verify) an owner-only DACL for every
// target in one PowerShell invocation. Targets arrive through the environment
// so no path is ever interpolated into the script text.
const WINDOWS_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  "$targets = @($env:PROCEED_ACL_TARGETS -split [char]10 | Where-Object { $_ -ne '' })",
  '$results = New-Object System.Collections.ArrayList',
  'foreach ($target in $targets) {',
  '  $entry = [pscustomobject]@{ path = $target; ok = $false; reason = "" }',
  "  if ($env:PROCEED_ACL_MODE -eq 'protect') {",
  '    $grant = if (Test-Path -LiteralPath $target -PathType Container) { "*${sid}:(OI)(CI)F" } else { "*${sid}:F" }',
  '    $null = & icacls $target /inheritance:r /grant:r $grant 2>&1',
  '    if ($LASTEXITCODE -ne 0) { $entry.reason = "icacls_failed"; [void]$results.Add($entry); continue }',
  '  }',
  '  $acl = Get-Acl -LiteralPath $target',
  '  $ownerSid = ""',
  '  try { $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $ownerSid = "" }',
  '  $foreign = 0',
  '  foreach ($rule in $acl.Access) {',
  '    $ruleSid = ""',
  '    try { $ruleSid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $ruleSid = "" }',
  '    if ($rule.AccessControlType -ne "Allow" -or $ruleSid -ne $sid) { $foreign++ }',
  '  }',
  '  if ($ownerSid -ne $sid) { $entry.reason = "owner_not_current_account" }',
  '  elseif ($foreign -gt 0) { $entry.reason = "additional_acl_entries" }',
  '  else { $entry.ok = $true }',
  '  [void]$results.Add($entry)',
  '}',
  'ConvertTo-Json -InputObject @($results) -Compress -Depth 4',
].join('\n');

function describeExecFailure(error) {
  if (error?.code === 'ENOENT') return 'the ACL helper command is unavailable';
  if (error?.killed) return 'the ACL helper command timed out';
  const detail = String(error?.stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .slice(0, 2)
    .join(' ');
  return detail === ''
    ? 'the ACL helper command failed'
    : `the ACL helper command failed: ${detail.slice(0, 300)}`;
}

// Windows PowerShell must resolve its own core modules, so a PSModulePath that
// points at a newer PowerShell installation is removed for the child process.
function windowsAclEnvironment(targets, mode) {
  const environment = { ...process.env };
  delete environment.PSModulePath;
  environment.PROCEED_ACL_TARGETS = targets.join('\n');
  environment.PROCEED_ACL_MODE = mode;
  return environment;
}

async function applyWindowsAcl(targets, mode) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_ACL_SCRIPT],
      {
        timeout: WINDOWS_ACL_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        windowsHide: true,
        env: windowsAclEnvironment(targets, mode),
      },
    ));
  } catch (cause) {
    const action = mode === 'protect' ? 'protect' : 'verify';
    throw storageFailure(
      `could not ${action} state files: ${describeExecFailure(cause)}`,
      'PROTECTION_UNAVAILABLE',
      cause,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(String(stdout).trim());
  } catch (cause) {
    throw storageFailure(
      'could not verify state file protection: unexpected ACL verifier output',
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const failures = entries.filter((entry) => entry?.ok !== true);
  if (entries.length !== targets.length || failures.length > 0) {
    const detail = failures
      .map((entry) => `${entry?.path ?? 'unknown path'} (${entry?.reason || 'unverified'})`)
      .join('; ');
    throw storageFailure(
      `state files are not restricted to the current Windows account: ${detail}`,
      'PROTECTION_UNVERIFIED',
    );
  }
}

async function assertPosixOwnerOnly(targets) {
  const failures = [];
  for (const target of targets) {
    let info;
    try {
      info = await stat(target);
    } catch (cause) {
      throw storageFailure(`could not inspect ${target}`, 'PROTECTION_UNVERIFIED', cause);
    }
    const mode = info.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      failures.push(`${target} (mode ${mode.toString(8)})`);
    }
  }
  if (failures.length > 0) {
    throw storageFailure(
      `state files grant access to other accounts: ${failures.join('; ')}`,
      'PROTECTION_UNVERIFIED',
    );
  }
}

// Creates a directory and protects it. `inheritsProtection` marks a child of an
// already-protected directory: POSIX still needs its own mode, while Windows
// inheritance already yields an owner-only ACL.
export async function createProtectedDirectory(directory, { inheritsProtection = false } = {}) {
  try {
    await mkdir(directory, { recursive: true, mode: POSIX_DIRECTORY_MODE });
  } catch (cause) {
    throw storageFailure(`could not create directory ${directory}`, 'STORAGE_FAILURE', cause);
  }

  if (process.platform === 'win32') {
    if (!inheritsProtection) await applyWindowsAcl([directory], 'protect');
    return;
  }
  await chmod(directory, POSIX_DIRECTORY_MODE);
  await assertPosixOwnerOnly([directory]);
}

export async function verifyOwnerOnly(targets) {
  if (targets.length === 0) return;
  if (process.platform === 'win32') {
    await applyWindowsAcl(targets, 'verify');
    return;
  }
  await assertPosixOwnerOnly(targets);
}
