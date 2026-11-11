// Owner-only filesystem protection for state and credential files.
// POSIX: 0700 directories and 0600 files validated by mode bits. Windows: a
// fixed OS metadata query supplies observations about ownership, volume, type
// and the complete DACL; this module validates them, applies the protection
// policy and refuses when the required evidence is missing. The query never
// decides that an object is safe and never receives secret content.
//
// The Windows boundary is the trusted current local account against ordinary
// other accounts. The installed package, the Node runtime, the Windows
// installation and the launch host are trusted prerequisites. Repeated
// metadata snapshots detect observed changes; they do not pin native objects,
// revoke handles opened earlier or prove historical confidentiality.
import { execFile } from 'node:child_process';
import { chmod, mkdir, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, parse } from 'node:path';
import { promisify } from 'node:util';
import { storageFailure } from '../errors.js';
import { parseStrictJson } from '../harness/helper-protocol.js';

const execFileAsync = promisify(execFile);

const POSIX_DIRECTORY_MODE = 0o700;

// One admission attempt shares one budget. Each invocation is capped by the
// time actually left and the last second is reserved for termination and
// settlement, so no query starts without room to observe or refuse.
const WINDOWS_ATTEMPT_BUDGET_MS = 20_000;
const WINDOWS_SETTLEMENT_RESERVE_MS = 1_000;
const WINDOWS_MAX_OUTPUT_BYTES = 256 * 1024;
const WINDOWS_MAX_TARGETS = 64;
const WINDOWS_MAX_INPUT_BYTES = 32 * 1024;

const OBSERVATION_VERSION = 1;
const SE_DACL_PRESENT = 0x0004;
const FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
const FILE_ALL_ACCESS = 0x001f01ff;
const FILE_GENERIC_READ = 0x120089;
const FILE_GENERIC_READ_DIRECTORY = 0x1200a9;
const FILE_GENERIC_WRITE = 0x120116;
const FILE_GENERIC_EXECUTE = 0x1200a0;
const GENERIC_ALL = 0x10000000;
const GENERIC_EXECUTE = 0x20000000;
const GENERIC_WRITE = 0x40000000;
const GENERIC_READ = 0x80000000;
const ACE_OBJECT_INHERIT = 0x0001;
const ACE_CONTAINER_INHERIT = 0x0002;
// A new directory hands full access to files and to subdirectories only when its
// entry carries both inheritance forms.
const ACE_CHILD_INHERITANCE = ACE_OBJECT_INHERIT | ACE_CONTAINER_INHERIT;
const ACE_NO_PROPAGATE = 0x0004;
const ACE_INHERIT_ONLY = 0x0008;
// Object, container, no-propagate, inherit-only and inherited. Any other bit is
// an entry form this policy does not understand and is refused.
const ACE_KNOWN_FLAGS = 0x001f;
const RIGHT_DELETE = 0x00010000;
const RIGHT_DELETE_CHILD = 0x00000040;
const RIGHT_WRITE_EA = 0x00000010;
const RIGHT_WRITE_ATTRIBUTES = 0x00000100;
const RIGHT_WRITE_DAC = 0x00040000;
const RIGHT_WRITE_OWNER = 0x00080000;
// Applied instead of "unknown bits refuse": these are the rights that let an
// ordinary other account replace, delete or re-secure the selected component.
// Plain read/list/traverse and creation-only child rights are not included.
const ANCESTOR_FORBIDDEN_RIGHTS =
  RIGHT_WRITE_DAC |
  RIGHT_WRITE_OWNER |
  RIGHT_DELETE |
  RIGHT_DELETE_CHILD |
  RIGHT_WRITE_EA |
  RIGHT_WRITE_ATTRIBUTES;
const SYSTEM_SID = 'S-1-5-18';
const ADMINISTRATORS_SID = 'S-1-5-32-544';
const KNOWN_EXECUTION_POLICIES = new Set([
  'restricted',
  'allsigned',
  'remotesigned',
  'unrestricted',
  'bypass',
  'undefined',
]);

// Fixed metadata-only query. Paths arrive only through PROCEED_ACL_TARGETS and
// are never interpolated into this text. It reports observations; it never
// reports or computes safety and never touches content. The DACL is reported
// from the security descriptor bytes in order, not from a typed rule view that
// can omit or flatten entries.
const WINDOWS_METADATA_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$accountSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  '$installerSid = $null',
  "try { $installerSid = (New-Object System.Security.Principal.NTAccount('NT SERVICE\\TrustedInstaller')).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $installerSid = $null }",
  "$targets = @($env:PROCEED_ACL_TARGETS -split [char]10 | Where-Object { $_ -ne '' })",
  '$entries = New-Object System.Collections.ArrayList',
  'foreach ($target in $targets) {',
  '  $entry = [ordered]@{ path = $target; status = "unavailable"; volume = $null; object = $null }',
  '  try { $item = Get-Item -LiteralPath $target -Force -ErrorAction Stop }',
  '  catch [System.Management.Automation.ItemNotFoundException] { $entry["status"] = "absent"; [void]$entries.Add([pscustomobject]$entry); continue }',
  '  catch { $entry["status"] = "unavailable"; [void]$entries.Add([pscustomobject]$entry); continue }',
  '  $kind = "unsupported"',
  '  if ($item.PSIsContainer) { $kind = "directory" } elseif ($item -is [System.IO.FileInfo]) { $kind = "file" }',
  '  $volume = $null',
  '  try {',
  '    $driveRoot = [System.IO.Path]::GetPathRoot($target)',
  '    $drive = New-Object System.IO.DriveInfo($driveRoot)',
  '    $fixed = ($drive.DriveType -eq [System.IO.DriveType]::Fixed)',
  '    $driveType = "unsupported"',
  '    if ($fixed) { $driveType = "fixed" }',
  '    $volume = [pscustomobject]@{ root = $driveRoot; drive_type = $driveType; filesystem = [string]$drive.DriveFormat; persistent_acls = $fixed }',
  '  } catch { $volume = $null }',
  '  $acl = $null',
  '  try { $acl = Get-Acl -LiteralPath $target -ErrorAction Stop } catch { $acl = $null }',
  '  if ($null -eq $volume -or $null -eq $acl) { [void]$entries.Add([pscustomobject]$entry); continue }',
  '  try {',
  '    $header = $acl.GetSecurityDescriptorBinaryForm()',
  '    $control = [uint32]([System.BitConverter]::ToUInt16($header, 2))',
  '    $ownerSid = $null',
  '    try { $ownerSid = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $ownerSid = $null }',
  '    $complete = ($null -ne $ownerSid)',
  '    $aces = New-Object System.Collections.ArrayList',
  // The descriptor bytes this query already holds carry the complete DACL. The
  // typed $acl.Access projection omits entries it cannot map to a file-system
  // rule and can flatten callback forms, so rights in those forms would never
  // reach the refusal policy. Every raw entry is reported in descriptor order.
  '    $descriptor = New-Object System.Security.AccessControl.RawSecurityDescriptor($header, 0)',
  '    $rawAcl = $descriptor.DiscretionaryAcl',
  '    $dacl = "present"',
  '    if (($control -band 4) -eq 0) { $dacl = "absent" }',
  '    if ($dacl -eq "present" -and $null -eq $rawAcl) { $dacl = "null" }',
  '    if ($dacl -eq "absent" -and $null -ne $rawAcl) { throw "unsupported security descriptor" }',
  '    $count = 0',
  '    $declared = 0',
  '    if ($null -ne $rawAcl) {',
  '      $count = [int]$rawAcl.Count',
  // The serialized ACL states its own entry count, so a list that omits,
  // repeats or reorders entries cannot pass as a complete observation.
  '      $aclBytes = New-Object -TypeName byte[] -ArgumentList ([int]$rawAcl.BinaryLength)',
  '      $rawAcl.GetBinaryForm($aclBytes, 0)',
  '      $declared = [int]([System.BitConverter]::ToUInt16($aclBytes, 4))',
  '    }',
  '    if ($count -ne $declared) { throw "unsupported access control list accounting" }',
  '    for ($index = 0; $index -lt $count; $index += 1) {',
  '      $ace = $rawAcl[$index]',
  '      $type = "unknown"',
  '      $sid = $null',
  '      $mask = $null',
  '      $flags = [int]$ace.AceFlags',
  // Ordinary single-SID allow/deny entries keep their identity and full 32-bit
  // mask. Object and conditional (callback) entries are reported as their own
  // forms so the refusal policy sees them; any other form stays unknown.
  '      if ($ace -is [System.Security.AccessControl.CommonAce]) {',
  '        if ($ace.AceType -eq [System.Security.AccessControl.AceType]::AccessAllowed) { $type = "allow" }',
  '        elseif ($ace.AceType -eq [System.Security.AccessControl.AceType]::AccessDenied) { $type = "deny" }',
  '      } elseif ($ace -is [System.Security.AccessControl.ObjectAce]) { $type = "object" }',
  '      elseif ($ace -is [System.Security.AccessControl.CustomAce]) {',
  '        if ($ace.AceType -ge 9 -and $ace.AceType -le 12) { $type = "conditional" }',
  '      }',
  '      if ($type -eq "allow" -or $type -eq "deny") {',
  '        $sid = [string]$ace.SecurityIdentifier.Value',
  // Widen the signed access mask to 64 bits before masking so a mask whose
  // high bit is set keeps all 32 bits instead of failing or narrowing.
  '        if ($ace.AccessMask -isnot [int]) { throw "unsupported access mask" }',
  '        $mask = [uint32]([int64]$ace.AccessMask -band [int64]4294967295)',
  '        if ($sid -eq "") { $sid = $null; $complete = $false }',
  '      }',
  '      [void]$aces.Add([pscustomobject]@{ type = $type; sid = $sid; mask = $mask; flags = $flags })',
  '    }',
  '    $entry["volume"] = $volume',
  '    $entry["object"] = [pscustomobject]@{ kind = $kind; attributes = [uint32]$item.Attributes; owner_sid = $ownerSid; control = $control; dacl = $dacl; aces = @($aces) }',
  '    if ($complete) { $entry["status"] = "present" } else { $entry["status"] = "unavailable" }',
  '  } catch { $entry["status"] = "unavailable" }',
  '  [void]$entries.Add([pscustomobject]$entry)',
  '}',
  'ConvertTo-Json -InputObject ([pscustomobject]@{ version = 1; account_sid = $accountSid; trusted_installer_sid = $installerSid; entries = @($entries) }) -Compress -Depth 6',
].join('\n');

function unavailableFailure(message) {
  return storageFailure(message, 'PROTECTION_UNAVAILABLE');
}

function unverifiedFailure(message) {
  return storageFailure(message, 'PROTECTION_UNVERIFIED');
}

// Fixed, secret-free guidance. No payload, SID, path or child output is echoed.
const UNSUPPORTED_PLACE_GUIDANCE =
  'use a dedicated local fixed NTFS directory that is owned by the current Windows account and restricted to it';

function isSid(value) {
  return typeof value === 'string' && /^S-\d-\d+(-\d+)+$/.test(value);
}

function sameSid(left, right) {
  return typeof left === 'string' && typeof right === 'string' && left === right;
}

function isMask(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

// Windows path comparison is case-insensitive after normalising separators and
// trailing separators. This is equality of the same spelling, not a prefix test.
function normalizeWindowsPath(value) {
  let text = String(value).replaceAll('/', '\\');
  while (text.length > 3 && text.endsWith('\\')) text = text.slice(0, -1);
  return text.toLowerCase();
}

function driveRootOf(value) {
  return normalizeWindowsPath(parse(value).root);
}

function chainLevels(path) {
  const { root } = parse(path);
  const parts = String(path)
    .slice(root.length)
    .split(/[\\/]/)
    .filter((name) => name !== '');
  const levels = [[root]];
  let prefix = root;
  for (const part of parts) {
    prefix = join(prefix, part);
    levels.push([prefix]);
  }
  return levels;
}

// Depth-ordered groups so the volume root is observed first and a descendant is
// never queried before every one of its ancestors has been admitted.
function groupedLevels(targets) {
  const levels = [];
  for (const target of targets) {
    const chain = chainLevels(target);
    for (let depth = 0; depth < chain.length; depth += 1) {
      levels[depth] ??= [];
      for (const path of chain[depth]) {
        if (
          !levels[depth].some((known) => normalizeWindowsPath(known) === normalizeWindowsPath(path))
        ) {
          levels[depth].push(path);
        }
      }
    }
  }
  return levels;
}

function batchedTargets(paths) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const path of paths) {
    const size = Buffer.byteLength(path, 'utf8') + 1;
    if (
      current.length > 0 &&
      (current.length >= WINDOWS_MAX_TARGETS || bytes + size > WINDOWS_MAX_INPUT_BYTES)
    ) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function environmentValues(name) {
  const values = new Set();
  for (const [key, value] of Object.entries(process.env ?? {})) {
    if (key.toUpperCase() !== name) continue;
    values.add(typeof value === 'string' ? value : null);
  }
  return values;
}

// The trusted OS installation root is taken from the launch environment, not
// from any executable's self-description. Inconsistent or relative settings
// refuse rather than guessing a tool location.
function trustedWindowsRoot() {
  const values = new Set([...environmentValues('SYSTEMROOT'), ...environmentValues('WINDIR')]);
  if (values.size !== 1) {
    throw unavailableFailure(
      `the Windows system directory setting is missing or inconsistent; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  const [root] = [...values];
  if (
    typeof root !== 'string' ||
    root === '' ||
    !isAbsolute(root) ||
    !/^[a-zA-Z]:[\\/]/.test(root) ||
    /[\u0000\r\n]/.test(root)
  ) {
    throw unavailableFailure(
      `the Windows system directory setting is unusable; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return root;
}

// A caller-provided process restriction is preserved, never weakened and never
// invented: an unrecognised or contradictory value refuses the attempt.
function preservedExecutionPolicy() {
  const values = environmentValues('PSEXECUTIONPOLICYPREFERENCE');
  if (values.size === 0) return null;
  if (values.size > 1) {
    throw unavailableFailure(
      `the Windows script process restriction setting is inconsistent; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  const [value] = [...values];
  if (typeof value !== 'string' || !KNOWN_EXECUTION_POLICIES.has(value.trim().toLowerCase())) {
    throw unavailableFailure(
      `the Windows script process restriction setting is not understood; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return value.trim();
}

// An explicit secret-free child environment, not a filtered copy of the parent.
function queryEnvironment(root, policy, targets) {
  const environment = {
    SystemRoot: root,
    WINDIR: root,
    PROCEED_ACL_TARGETS: targets.join('\n'),
  };
  if (policy !== null) environment.PSExecutionPolicyPreference = policy;
  return environment;
}

function toolPath(root, segments) {
  return join(root, ...segments);
}

function remainingQueryBudget(deadline) {
  const remaining = deadline - Date.now() - WINDOWS_SETTLEMENT_RESERVE_MS;
  if (remaining <= 0) {
    throw unavailableFailure(
      `the Windows protection check ran out of time in this attempt; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return Math.min(remaining, WINDOWS_ATTEMPT_BUDGET_MS);
}

function exactFields(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== fields.length) return false;
  return fields.every((field) => Object.hasOwn(value, field));
}

function decodeAce(value) {
  if (!exactFields(value, ['type', 'sid', 'mask', 'flags'])) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  if (
    !['allow', 'deny', 'object', 'conditional', 'unknown'].includes(value.type) ||
    !Number.isInteger(value.flags) ||
    value.flags < 0 ||
    value.flags > 0xff
  ) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  if (value.type === 'allow' || value.type === 'deny') {
    if (!isSid(value.sid) || !isMask(value.mask)) {
      throw unverifiedFailure(
        'the Windows protection report is not a complete metadata observation',
      );
    }
  } else if (value.sid !== null || value.mask !== null) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  return value;
}

function decodeEntry(value) {
  if (!exactFields(value, ['path', 'status', 'volume', 'object'])) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  if (value.status === 'absent' || value.status === 'unavailable') {
    if (value.volume !== null || value.object !== null) {
      throw unverifiedFailure(
        'the Windows protection report is not a complete metadata observation',
      );
    }
    return value;
  }
  if (value.status !== 'present') {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  const volume = value.volume;
  if (!exactFields(volume, ['root', 'drive_type', 'filesystem', 'persistent_acls'])) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  if (
    typeof volume.root !== 'string' ||
    normalizeWindowsPath(volume.root) !== driveRootOf(value.path) ||
    !['fixed', 'unsupported'].includes(volume.drive_type) ||
    typeof volume.filesystem !== 'string' ||
    typeof volume.persistent_acls !== 'boolean'
  ) {
    throw unverifiedFailure('the Windows volume observation is inconsistent');
  }
  const object = value.object;
  if (!exactFields(object, ['kind', 'attributes', 'owner_sid', 'control', 'dacl', 'aces'])) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  if (
    !['directory', 'file', 'unsupported'].includes(object.kind) ||
    !isMask(object.attributes) ||
    !isMask(object.control) ||
    !(object.owner_sid === null || isSid(object.owner_sid)) ||
    !['absent', 'null', 'present'].includes(object.dacl) ||
    !Array.isArray(object.aces)
  ) {
    throw unverifiedFailure('the Windows protection report is not a complete metadata observation');
  }
  // A present or null DACL is announced by the descriptor control mask; an
  // absent DACL is announced by its absence. Contradictory reports refuse.
  const announcesDacl = (object.control & SE_DACL_PRESENT) !== 0;
  if (announcesDacl !== (object.dacl !== 'absent')) {
    throw unverifiedFailure('the Windows protection report has contradictory descriptor state');
  }
  for (const ace of object.aces) decodeAce(ace);
  return value;
}

function decodeObservation(bytes, targets) {
  let payload;
  try {
    payload = parseStrictJson(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), 'utf8'));
  } catch {
    throw unverifiedFailure(
      `the Windows protection report could not be read; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (
    !exactFields(payload, ['version', 'account_sid', 'trusted_installer_sid', 'entries']) ||
    payload.version !== OBSERVATION_VERSION ||
    !isSid(payload.account_sid) ||
    !(payload.trusted_installer_sid === null || isSid(payload.trusted_installer_sid)) ||
    !Array.isArray(payload.entries)
  ) {
    throw unverifiedFailure(
      `the Windows protection report is not a supported observation; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (payload.entries.length !== targets.length) {
    throw unverifiedFailure(
      'the Windows protection report does not cover exactly the requested paths',
    );
  }
  for (let index = 0; index < targets.length; index += 1) {
    const entry = decodeEntry(payload.entries[index]);
    if (
      typeof entry.path !== 'string' ||
      normalizeWindowsPath(entry.path) !== normalizeWindowsPath(targets[index])
    ) {
      throw unverifiedFailure(
        'the Windows protection report does not cover exactly the requested paths',
      );
    }
  }
  return payload;
}

async function queryMetadata(targets, deadline) {
  const root = trustedWindowsRoot();
  const policy = preservedExecutionPolicy();
  const timeout = remainingQueryBudget(deadline);
  const environment = queryEnvironment(root, policy, targets);
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execFileAsync(
      toolPath(root, ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe']),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_METADATA_SCRIPT],
      {
        timeout,
        maxBuffer: WINDOWS_MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: environment,
      },
    ));
  } catch {
    // The child exception, its stderr and its exit status are not published.
    throw unavailableFailure(
      `the Windows protection check is unavailable on this system; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (typeof stderr === 'string' && stderr.trim() !== '') {
    throw unavailableFailure(
      `the Windows protection check reported a problem; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  // A response that arrives after the attempt's own deadline, or that leaves no
  // room to settle, is not an observation this attempt may use: the shared
  // budget is judged on the time actually consumed, not on the requested limit.
  if (Date.now() >= deadline - WINDOWS_SETTLEMENT_RESERVE_MS) {
    throw unavailableFailure(
      `the Windows protection check did not answer within this attempt; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return decodeObservation(stdout ?? '', targets);
}

function expandRights(mask, kind) {
  let expanded = mask;
  if ((mask & GENERIC_READ) !== 0) {
    expanded |= kind === 'directory' ? FILE_GENERIC_READ_DIRECTORY : FILE_GENERIC_READ;
  }
  if ((mask & GENERIC_WRITE) !== 0) expanded |= FILE_GENERIC_WRITE;
  if ((mask & GENERIC_EXECUTE) !== 0) expanded |= FILE_GENERIC_EXECUTE;
  if ((mask & GENERIC_ALL) !== 0) expanded |= FILE_ALL_ACCESS;
  return expanded >>> 0;
}

function trustedPrincipals(context) {
  const trusted = new Set([context.accountSid, SYSTEM_SID, ADMINISTRATORS_SID]);
  if (context.trustedInstallerSid !== null) trusted.add(context.trustedInstallerSid);
  return trusted;
}

function presentEntry(entry, description) {
  if (entry.status === 'unavailable') {
    throw unverifiedFailure(
      `the Windows protection of ${description} could not be observed; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (entry.status !== 'present') {
    throw unverifiedFailure(
      `the Windows protection of ${description} is not established; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  const object = entry.object;
  if (
    entry.volume.drive_type !== 'fixed' ||
    entry.volume.persistent_acls !== true ||
    entry.volume.filesystem.toLowerCase() !== 'ntfs'
  ) {
    throw unverifiedFailure(
      `the storage of ${description} is not supported local fixed NTFS storage; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (object.kind === 'unsupported') {
    throw unverifiedFailure(
      `the type of ${description} could not be established; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if ((object.attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0) {
    throw unverifiedFailure(
      `the protected path ${description} is redirected or replaced through a reparse point; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (object.dacl !== 'present' || object.aces.length === 0) {
    throw unverifiedFailure(
      `the Windows permissions of ${description} are missing, empty or unreadable; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return object;
}

function assertKnownAceShape(ace, description) {
  if ((ace.flags & ~ACE_KNOWN_FLAGS) !== 0) {
    throw unverifiedFailure(
      `the Windows permissions of ${description} use an unsupported entry form; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (ace.type !== 'allow') {
    throw unverifiedFailure(
      `the Windows permissions of ${description} are not completely understood; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
}

// Dedicated objects (state, credentials, keys, locks, journal, configuration)
// admit only the current account, with an applicable full-access grant.
function admitDedicated(entry, context, description) {
  const object = presentEntry(entry, description);
  if (!sameSid(object.owner_sid, context.accountSid)) {
    throw unverifiedFailure(
      `the Windows owner of ${description} is not the current account; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  let applicableFullAccess = false;
  for (const ace of object.aces) {
    assertKnownAceShape(ace, description);
    if (!sameSid(ace.sid, context.accountSid)) {
      throw unverifiedFailure(
        `the Windows permissions of ${description} grant another principal; ${UNSUPPORTED_PLACE_GUIDANCE}`,
      );
    }
    if ((ace.flags & ACE_INHERIT_ONLY) !== 0) continue;
    const rights = expandRights(ace.mask, object.kind);
    if ((rights & FILE_ALL_ACCESS) === FILE_ALL_ACCESS) applicableFullAccess = true;
  }
  if (!applicableFullAccess) {
    throw unverifiedFailure(
      `the Windows permissions of ${description} do not grant the current account full access; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  return object;
}

// Shared ancestors may belong to the OS or the local administrators; they may
// not let another account replace, delete or re-secure the selected component.
function admitAncestor(entry, context, trusted, description) {
  const object = presentEntry(entry, description);
  if (object.kind !== 'directory') {
    throw unverifiedFailure(
      `the Windows ancestor of ${description} is not a directory; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  if (!trusted.has(object.owner_sid)) {
    throw unverifiedFailure(
      `the Windows owner of an ancestor of ${description} is not a trusted principal; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
  for (const ace of object.aces) {
    assertKnownAceShape(ace, description);
    if (trusted.has(ace.sid)) continue;
    if ((ace.flags & ACE_INHERIT_ONLY) !== 0) continue;
    const rights = expandRights(ace.mask, 'directory');
    if ((rights & ANCESTOR_FORBIDDEN_RIGHTS) !== 0) {
      throw unverifiedFailure(
        `an ancestor of ${description} could be replaced or re-secured by another account; ${UNSUPPORTED_PLACE_GUIDANCE}`,
      );
    }
  }
  return object;
}

// A component that does not exist yet is admitted through its parent: an
// inheritable foreign grant that could mutate or replace the new child refuses
// before it is created. An inherit-only entry does not apply to the parent
// itself, but inheritance makes it apply to the child this attempt would create,
// so it is evaluated here rather than skipped.
function assertProspectiveChildren(entry, context, trusted, description) {
  const object = presentEntry(entry, description);
  for (const ace of object.aces) {
    if (trusted.has(ace.sid)) continue;
    if ((ace.flags & (ACE_OBJECT_INHERIT | ACE_CONTAINER_INHERIT)) === 0) continue;
    const rights = expandRights(ace.mask, 'directory');
    if ((rights & ANCESTOR_FORBIDDEN_RIGHTS) !== 0) {
      throw unverifiedFailure(
        `a new protected directory beside ${description} would inherit access for another account; ${UNSUPPORTED_PLACE_GUIDANCE}`,
      );
    }
  }
  return object;
}

// A new directory must pass account-only full access to both of its possible
// child kinds: files arrive through object inheritance and subdirectories
// through container inheritance, so one without the other leaves a gap.
function assertProtectedInheritance(object, context, description) {
  let inheritsFullAccess = false;
  for (const ace of object.aces) {
    if (ace.type !== 'allow' || !sameSid(ace.sid, context.accountSid)) continue;
    if ((ace.flags & ACE_INHERIT_ONLY) !== 0) continue;
    if ((ace.flags & ACE_NO_PROPAGATE) !== 0) continue;
    if ((ace.flags & (ACE_OBJECT_INHERIT | ACE_CONTAINER_INHERIT)) !== ACE_CHILD_INHERITANCE) {
      continue;
    }
    const rights = expandRights(ace.mask, 'directory');
    if ((rights & FILE_ALL_ACCESS) === FILE_ALL_ACCESS) inheritsFullAccess = true;
  }
  if (!inheritsFullAccess) {
    throw unverifiedFailure(
      `the new protected directory ${description} would not pass account-only full access to its children; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
}

// The current-account identity is fixed for one attempt: a report that changes
// it mid-attempt is a partial or substituted observation.
function consistentContext(current, payload) {
  if (current === null) {
    return {
      accountSid: payload.account_sid,
      trustedInstallerSid: payload.trusted_installer_sid,
    };
  }
  if (
    payload.account_sid !== current.accountSid ||
    payload.trusted_installer_sid !== current.trustedInstallerSid
  ) {
    throw unverifiedFailure('the Windows protection report changed during one admission attempt');
  }
  return current;
}

// Depth-ordered admission of requested objects and their existing ancestors.
// The root is observed first and a descendant is queried only after every one of
// its ancestors has been admitted. One attempt shares one deadline. The last
// observation is returned so a creation attempt can judge its parent.
async function admitWindowsLevels(levels, { targets, allowMissingTail, deadline }) {
  let context = null;
  let deepest = null;
  for (let depth = 0; depth < levels.length; depth += 1) {
    const lastLevel = depth === levels.length - 1;
    for (const batch of batchedTargets(levels[depth])) {
      const payload = await queryMetadata(batch, deadline);
      context = consistentContext(context, payload);
      const trusted = trustedPrincipals(context);
      for (let index = 0; index < batch.length; index += 1) {
        const path = batch[index];
        const entry = payload.entries[index];
        const description = `the protected path ${path}`;
        if (entry.status !== 'present') {
          if (allowMissingTail && lastLevel && entry.status === 'absent') {
            deepest = entry;
            continue;
          }
          presentEntry(entry, description);
          continue;
        }
        if (targets.some((known) => normalizeWindowsPath(known) === normalizeWindowsPath(path))) {
          admitDedicated(entry, context, description);
        } else {
          admitAncestor(entry, context, trusted, description);
        }
        deepest = entry;
      }
    }
  }
  return { context, deepest };
}

async function admitWindowsTargets(targets, { allowMissingTail = false } = {}) {
  const levels = groupedLevels(targets);
  const admitted = await admitWindowsLevels(levels, {
    targets,
    allowMissingTail,
    deadline: Date.now() + WINDOWS_ATTEMPT_BUDGET_MS,
  });
  return admitted.context;
}

async function protectNewWindowsDirectory(directory, accountSid, deadline) {
  const root = trustedWindowsRoot();
  try {
    await execFileAsync(
      toolPath(root, ['System32', 'icacls.exe']),
      [directory, '/inheritance:r', '/grant:r', `*${accountSid}:(OI)(CI)F`],
      {
        timeout: remainingQueryBudget(deadline),
        maxBuffer: WINDOWS_MAX_OUTPUT_BYTES,
        windowsHide: true,
        env: { SystemRoot: root, WINDIR: root },
      },
    );
  } catch {
    throw unavailableFailure(
      `the new protected directory ${directory} could not be protected; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
}

async function assertEmptyDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (cause) {
    throw storageFailure(
      `could not confirm the new protected directory ${directory} is empty`,
      'PROTECTION_UNVERIFIED',
      cause,
    );
  }
  if (entries.length !== 0) {
    throw unverifiedFailure(
      `the new protected directory ${directory} is no longer empty; ${UNSUPPORTED_PLACE_GUIDANCE}`,
    );
  }
}

async function createWindowsProtectedDirectory(directory, { inheritsProtection }) {
  const deadline = Date.now() + WINDOWS_ATTEMPT_BUDGET_MS;
  const ancestors = chainLevels(directory).slice(0, -1);
  const admitted = await admitWindowsLevels(ancestors, {
    targets: [],
    allowMissingTail: false,
    deadline,
  });
  assertProspectiveChildren(
    admitted.deepest,
    admitted.context,
    trustedPrincipals(admitted.context),
    `the new protected directory ${directory}`,
  );

  let created = false;
  try {
    // One component at a time and never recursively: an existing directory is
    // reported as a collision instead of being adopted as this attempt's object.
    await mkdir(directory);
    created = true;
  } catch (cause) {
    if (cause?.code !== 'EEXIST') {
      throw storageFailure(`could not create directory ${directory}`, 'STORAGE_FAILURE', cause);
    }
  }

  // Observe the resulting object before this attempt changes anything: the
  // applied or inherited descriptor must admit the current account only. A
  // collision is admitted as it stands and is never repaired or re-permissioned.
  let context = admitted.context;
  const observed = await queryMetadata([directory], deadline);
  context = consistentContext(context, observed);
  const object = admitDedicated(
    observed.entries[0],
    context,
    `the protected directory ${directory}`,
  );
  if (!created) return;

  assertProtectedInheritance(object, context, `the new protected directory ${directory}`);
  if (inheritsProtection) return;

  // Only the empty directory this attempt created is protected. An entry that
  // appeared since creation is preserved, and the current type, inheritance and
  // descriptor are re-observed immediately before the permissions change.
  await assertEmptyDirectory(directory);
  const before = await queryMetadata([directory], deadline);
  context = consistentContext(context, before);
  admitDedicated(before.entries[0], context, `the protected directory ${directory}`);
  await protectNewWindowsDirectory(directory, context.accountSid, deadline);
  const applied = await queryMetadata([directory], deadline);
  context = consistentContext(context, applied);
  admitDedicated(applied.entries[0], context, `the protected directory ${directory}`);
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

// Shared Windows admission entry for readers and writers that must not read or
// write secret bytes before the object and its existing ancestry are admitted.
// The optional `fail` mapper keeps a caller's own classification (for example the
// secure ownership conflict) instead of inventing a new public code.
export async function verifyWindowsProtection(targets, { allowMissingTail = false, fail } = {}) {
  if (process.platform !== 'win32') return;
  try {
    await admitWindowsTargets(targets, { allowMissingTail });
  } catch (error) {
    if (typeof fail === 'function') {
      throw fail(error);
    }
    throw error;
  }
}

// Admission for an existing dedicated directory that must already pass
// account-only full access to the files and directories created inside it. The
// directory is admitted and never repaired or re-permissioned, so an unsafe
// parent refuses instead of being fixed.
export async function verifyWindowsInheritableDirectory(directory, { fail } = {}) {
  if (process.platform !== 'win32') return;
  const deadline = Date.now() + WINDOWS_ATTEMPT_BUDGET_MS;
  try {
    const admitted = await admitWindowsLevels(chainLevels(directory), {
      targets: [directory],
      allowMissingTail: false,
      deadline,
    });
    assertProtectedInheritance(
      admitted.deepest.object,
      admitted.context,
      `the directory ${directory}`,
    );
  } catch (error) {
    if (typeof fail === 'function') throw fail(error);
    throw error;
  }
}

// Creates a directory and protects it. `inheritsProtection` marks a child of an
// already-protected directory: POSIX still needs its own mode, while Windows
// checks the inherited descriptor that the child actually received.
export async function createProtectedDirectory(directory, { inheritsProtection = false } = {}) {
  if (process.platform === 'win32') {
    await createWindowsProtectedDirectory(directory, { inheritsProtection });
    return;
  }

  try {
    await mkdir(directory, { recursive: true, mode: POSIX_DIRECTORY_MODE });
  } catch (cause) {
    throw storageFailure(`could not create directory ${directory}`, 'STORAGE_FAILURE', cause);
  }
  await chmod(directory, POSIX_DIRECTORY_MODE);
  await assertPosixOwnerOnly([directory]);
}

export async function verifyOwnerOnly(targets) {
  if (targets.length === 0) return;
  if (process.platform === 'win32') {
    await admitWindowsTargets(targets);
    return;
  }
  await assertPosixOwnerOnly(targets);
}
