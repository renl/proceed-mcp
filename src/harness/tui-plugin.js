// TUI-only harness interaction (design sections 1-3). This module is imported by
// the packaged `tui` entry and receives the host context; it imports no host UI
// peer itself, so portable entry points stay free of the plugin SDK.
//
// The operator credential is loaded once and kept only in this setup generation's
// closure. The TUI performs no TLS exchange itself: every broker exchange is
// delegated to one short-lived application-owned Node helper over parent-created
// private pipes, which carries the unchanged protected TLS-PSK admission, the
// remaining 10000 ms budget and the 64 KiB response ceiling. A command can open
// the local interaction, but only the operator's completed dialog choice can
// submit a decision; command arguments and RPC inputs are ignored. The complete
// question is displayed in full beside its three choices or not opened at all.
// Dismissal, replacement, a resize, an expired deadline, disposal and Cleanup
// send nothing, and the immutable deadline also aborts an exchange already in
// flight.
import { runHelperExchange, HelperChannelError } from './node-helper.js';
import { resolveStateDir, statePaths } from '../state/paths.js';
import { loadPortableConfiguration } from '../state/store.js';
import { REQUEST_ID_PATTERN, isPlainObject } from '../util/values.js';
import {
  ENROLLMENT_ID_PATTERN,
  OPERATOR_KEY_ID_PATTERN,
  PRESENTATION_ID_PATTERN,
  harnessIdProblem,
  ownerIdProblem,
  sessionProblem,
} from './identifiers.js';
import { loadOperatorKeyFile, validateOperatorKeyFileOption } from './operator-key.js';
import {
  confirmationMessage,
  displayGeometry,
  geometryAdmits,
  identityDisplayProblem,
  identityLines,
  identityPreview,
} from './session-identity.js';

export const HARNESS_TUI_ID = 'proceed.harness';
// Trusted harness interaction is claimed only for the pinned, reviewed host.
export const SUPPORTED_TUI_HOST_VERSION = '2.2.5';
export const ENROLL_COMMAND = 'proceed.harness.enroll';
export const ENROLL_BIND = 'ctrl+e';
export const OPEN_QUESTION_COMMAND = 'proceed.harness.open';
export const OPEN_QUESTION_BIND = 'ctrl+g';

const OPTION_KEYS = Object.freeze(['state_dir', 'harness_id', 'owner_id', 'operator_key_file']);
const RESOLUTIONS = new Set(['approved', 'rejected', 'responded', 'expired', 'cancelled']);

// A broker refusal or an unreadable reply is reported by code, never by echoing
// an authority value.
class HarnessRequestError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessRequestError';
    this.code = code;
  }
}

// Broker and caller text is rendered inertly: CR/LF are normalized and terminal
// control, escape and C1 sequences are removed before display.
const UNSAFE_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
function inert(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n?/g, '\n').replace(UNSAFE_TEXT, ' ');
}

function disabled(context, message, variant = 'error') {
  context?.ui?.toast?.show({ message: inert(message), variant, duration: 30000 });
}

// The nonsecret configuration is exactly these four options. Anything else is a
// configuration error rather than a silently accepted extension.
function readOptions(raw) {
  if (!isPlainObject(raw)) {
    throw new Error('the Proceed harness integration requires its four configured options');
  }
  const unexpected = Object.keys(raw).find((key) => !OPTION_KEYS.includes(key));
  if (unexpected !== undefined) {
    throw new Error(`the Proceed harness integration does not accept the option ${unexpected}`);
  }
  for (const key of OPTION_KEYS) {
    if (typeof raw[key] !== 'string' || raw[key] === '') {
      throw new Error(`the Proceed harness integration requires the option ${key}`);
    }
  }
  const problem = harnessIdProblem(raw.harness_id) ?? ownerIdProblem(raw.owner_id);
  if (problem !== null) throw new Error(problem);
  validateOperatorKeyFileOption(raw.operator_key_file);
  return {
    stateDir: resolveStateDir({ option: raw.state_dir, env: {} }),
    harnessId: raw.harness_id,
    ownerId: raw.owner_id,
    operatorKeyFile: raw.operator_key_file,
  };
}

function errorText(error) {
  const message = inert(error?.message ?? 'the broker request failed');
  return typeof error?.code === 'string' && error.code !== ''
    ? `${message} (${error.code})`
    : message;
}

function showError(context, error) {
  context.ui.toast.show({
    message: `Proceed harness: ${errorText(error)}`,
    variant: 'error',
    duration: 30000,
  });
}

// One local interaction owns its session picker, identity confirmation,
// question/response dialogs, the public resize listener it attached and any
// exchange it started. A newer interaction, disposal or Cleanup fences it before
// its next phase, so a completion that arrives after replacement is inert: it
// cannot open another dialog, start another helper exchange or reuse an old
// presentation. The fence is local only; the durable request stays pending, and
// no broker admission or decision is queued behind it.
function beginInteraction(generation) {
  const replaced = generation.interaction;
  generation.interaction = null;
  if (replaced !== null) {
    replaced.active = false;
    releaseInteraction(replaced);
    replaced.controller.abort();
  }
  const interaction = {
    active: true,
    invalidated: false,
    controller: new AbortController(),
    teardowns: new Set(),
  };
  generation.interaction = interaction;
  return interaction;
}

// Attachment cleanup belongs to the interaction that owns it, so a replacement,
// disposal or Cleanup removes it even while a dialog promise is still
// outstanding.
function releaseInteraction(interaction) {
  for (const teardown of [...interaction.teardowns]) {
    interaction.teardowns.delete(teardown);
    try {
      teardown();
    } catch {
      // Cleanup failure cannot reopen authority; the fence already applied.
    }
  }
}

function disposeInteraction(generation, interaction) {
  interaction.active = false;
  releaseInteraction(interaction);
  if (generation.interaction === interaction) generation.interaction = null;
}

// A continuation may act only while its own interaction and the setup
// generation that owns it are both still active. An invalidated interaction is
// fenced too: a resize, an expiry or a lost display admission ends its stage and
// every successor stage, so a late dialog completion cannot open a prompt or
// submit a choice.
function interactionActive(generation, interaction) {
  return generation.active && interaction.active && !interaction.invalidated;
}

// A resize invalidates the affected stage and its successors even when the new
// geometry would still fit: the admission was observed for one dialog instance
// only, so a fresh open is required. An exchange this interaction already owns is
// aborted at once (design section 2), so a stalled reply cannot keep its pending
// take alive until another deadline. The listener belongs to the interaction, so
// replacement, disposal and Cleanup remove it while a dialog is still open.
function watchDisplayResize(context, interaction) {
  const renderer = context.renderer;
  if (typeof renderer?.on !== 'function' || typeof renderer?.removeListener !== 'function') {
    return null;
  }
  const onResize = () => {
    interaction.invalidated = true;
    interaction.controller.abort();
  };
  renderer.on('resize', onResize);
  const detach = () => {
    renderer.removeListener('resize', onResize);
  };
  interaction.teardowns.add(detach);
  return detach;
}

// The immutable request deadline is a hard fence (design section 2): at that
// instant the interaction is invalidated and its owned exchange aborted, so a
// late question or Respond completion can neither open a prompt nor submit. The
// timer is owned by the interaction and released on replacement, disposal or
// Cleanup. No deadline is renewed, no pending slot is substituted, nothing is
// retried and the durable request is not cancelled.
function armImmutableExpiry(interaction, presentation) {
  const expiresAt = Date.parse(presentation.expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  const remaining = expiresAt - Date.now();
  if (!(remaining > 0)) return false;
  const timer = setTimeout(() => {
    interaction.invalidated = true;
    interaction.controller.abort();
  }, remaining);
  const clear = () => clearTimeout(timer);
  interaction.teardowns.add(clear);
  return true;
}

// One operator-route exchange through the private helper. A non-2xx reply is the
// broker's versioned envelope and its code travels unchanged; a fixed local
// helper code never becomes a broker claim.
async function exchange(generation, interaction, operation, body, presentationId = null) {
  if (generation.disabled) throw new HelperChannelError('HELPER_PROTOCOL_INVALID');
  // A fenced interaction never reaches executable resolution or spawn.
  if (!interactionActive(generation, interaction)) {
    throw new HelperChannelError('EXCHANGE_CANCELLED');
  }
  const response = await runHelperExchange({
    operation,
    body,
    presentationId,
    port: generation.port,
    lockFile: generation.lockFile,
    operatorCredential: generation.credential,
    signal: interaction.controller.signal,
    isActive: () => interactionActive(generation, interaction),
    // Unconfirmed owned cleanup disables further helper exchanges for this
    // generation instead of reporting success.
    onUnconfirmedCleanup: () => {
      generation.disabled = true;
    },
  });
  if (response.status >= 200 && response.status < 300) return response.body;
  const error = isPlainObject(response.body?.error) ? response.body.error : {};
  throw new HarnessRequestError(
    typeof error.code === 'string' ? error.code : 'BROKER_RESPONSE_INVALID',
    typeof error.message === 'string' ? error.message : 'the broker refused the request',
  );
}

function enrollmentFrom(body, { keyId, harnessId, ownerId }) {
  if (!isPlainObject(body) || body.schema_version !== 1) return null;
  if (body.harness_id !== harnessId || body.owner_id !== ownerId) return null;
  if (typeof body.key_id !== 'string' || !OPERATOR_KEY_ID_PATTERN.test(body.key_id)) return null;
  if (body.key_id !== keyId) return { state: 'mismatch', brokerKeyId: body.key_id };
  if (body.state === 'enrolled') {
    return body.enrollment_id === null && body.expires_at === null
      ? { state: 'enrolled', brokerKeyId: body.key_id }
      : null;
  }
  if (body.state !== 'pending') return null;
  if (typeof body.enrollment_id !== 'string' || !ENROLLMENT_ID_PATTERN.test(body.enrollment_id)) {
    return null;
  }
  if (typeof body.expires_at !== 'string' || !Number.isFinite(Date.parse(body.expires_at))) {
    return null;
  }
  return {
    state: 'pending',
    brokerKeyId: body.key_id,
    enrollmentId: body.enrollment_id,
    expiresAt: body.expires_at,
  };
}

function enrollmentMessage(enrollment, { keyId, harnessId, ownerId }) {
  const lines = [
    `Harness: ${harnessId}`,
    `Owner: ${ownerId}`,
    `Operator key fingerprint (this TUI): ${keyId}`,
    `Broker fingerprint: ${inert(enrollment.brokerKeyId)}`,
  ];
  if (enrollment.state === 'mismatch') {
    lines.push(
      '',
      'State: unavailable',
      'The broker reported a different operator fingerprint. This TUI claims no',
      'decision authority for that enrollment and will not submit a choice.',
    );
    return lines.join('\n');
  }
  lines.push(`State: ${enrollment.state}`);
  if (enrollment.state === 'pending') {
    lines.push(
      `Enrollment: ${enrollment.enrollmentId}`,
      `Expires: ${enrollment.expiresAt}`,
      '',
      `Send "/harness ${enrollment.enrollmentId}" privately to the bot, compare the`,
      'fingerprint above with this display, then confirm in that private chat.',
      'Confirming authorizes this operator key to resolve requests; it approves no work.',
    );
  } else {
    lines.push(
      '',
      'This operator key may resolve this broker pending requests through this TUI.',
      'It approves nothing by itself, and only the paired private chat can revoke it.',
    );
  }
  return lines.join('\n');
}

async function proposeEnrollment(generation, context) {
  if (!generation.active) return;
  const interaction = beginInteraction(generation);
  try {
    let enrollment;
    try {
      const body = await exchange(generation, interaction, 'enrollments', {
        harness_id: generation.harnessId,
        owner_id: generation.ownerId,
      });
      enrollment = enrollmentFrom(body, generation);
    } catch (error) {
      if (!interactionActive(generation, interaction)) return;
      showError(context, error);
      return;
    }
    if (!interactionActive(generation, interaction)) return;
    if (enrollment === null) {
      disabled(context, 'Proceed harness: the broker returned an unusable enrollment response.');
      return;
    }
    await context.ui.dialog.alert({
      title: 'Proceed harness operator enrollment',
      message: enrollmentMessage(enrollment, generation),
    });
  } finally {
    disposeInteraction(generation, interaction);
  }
}

function presentationFrom(body, { harnessId, ownerId, sessionId }) {
  if (!isPlainObject(body) || body.schema_version !== 1) return { ok: false };
  if (body.presentation === null) return { ok: true, presentation: null };
  const value = body.presentation;
  if (!isPlainObject(value)) return { ok: false };
  if (
    typeof value.presentation_id !== 'string' ||
    !PRESENTATION_ID_PATTERN.test(value.presentation_id)
  ) {
    return { ok: false };
  }
  if (typeof value.request_id !== 'string' || !REQUEST_ID_PATTERN.test(value.request_id)) {
    return { ok: false };
  }
  if (
    value.harness_id !== harnessId ||
    value.owner_id !== ownerId ||
    value.session_id !== sessionId ||
    sessionProblem(value.session_id) !== null
  ) {
    return { ok: false };
  }
  if (
    typeof value.session_label !== 'string' ||
    value.session_label === '' ||
    typeof value.action !== 'string' ||
    value.action === '' ||
    typeof value.context !== 'string' ||
    typeof value.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(value.expires_at))
  ) {
    return { ok: false };
  }
  return { ok: true, presentation: value };
}

// The complete immutable question, taken only from the captured presentation
// (design sections 1 and 2). Every value is placed in full: a value longer than
// the established lossless cell width becomes continuation lines that
// concatenate back to the exact captured string, so an admitted question is
// never a shortened, guessed-wrap or normalized variant. Text whose terminal
// cell width is not established is refused rather than displayed as a different
// value. The cell width is the established display unit, not a question-size
// contract: whether this question is admitted is decided by the public geometry
// of this terminal, not by a fixed length limit.
function questionValueLines(value) {
  const rendered = inert(value);
  if (rendered === '') return null;
  const lines = [];
  for (const source of rendered.split('\n')) {
    if (source === '') {
      lines.push('');
      continue;
    }
    // Each established-width slice is checked on its own, so this tests only
    // that the terminal cell width is known and the slice is not empty. The
    // identity value cap does not become a maximum question size.
    for (const line of identityLines(source)) {
      if (identityDisplayProblem(line) !== null) return null;
      lines.push(line);
    }
  }
  return lines;
}

// One admitted complete question, or null when a captured value has no
// established lossless display. Approval is never the initial choice.
function questionDisplay(presentation) {
  const blocks = [
    ['Request ID', presentation.request_id],
    ['Session label', presentation.session_label],
    ['Action', presentation.action],
    ['Context', presentation.context],
    ['Expires', presentation.expires_at],
  ];
  const lines = ['Proceed approval request', ''];
  for (const [label, value] of blocks) {
    const valueLines = questionValueLines(value);
    if (valueLines === null) return null;
    lines.push(`${label}:`, ...valueLines);
  }
  lines.push('', 'Choose Reject, Respond or Approve.', 'Dismissing this dialog sends no decision.');
  return { message: lines.join('\n'), lineCount: lines.length };
}

// A question that cannot be shown completely beside Reject/Respond/Approve
// opens no actionable dialog. The complete request text is never truncated or
// edited, and nothing is resolved, cancelled or retried: the operator is told to
// enlarge the terminal and reopen, or to use Telegram.
function refuseQuestion(context) {
  context.ui.toast.show({
    message:
      'Proceed: the complete question cannot be displayed here. ' +
      'Enlarge the terminal and reopen, or use Telegram. No question was opened.',
    variant: 'warning',
    duration: 30000,
  });
}

// Admission uses the public renderer dimensions and the conservative dialog
// budget already established for the identity confirmation. Unknown geometry or
// insufficient space refuses before an actionable dialog exists.
function admitQuestion(context, presentation) {
  const display = questionDisplay(presentation);
  const admitted = displayGeometry(context.renderer);
  if (display === null || admitted === null || !geometryAdmits(admitted, display.lineCount)) {
    refuseQuestion(context);
    return null;
  }
  return display;
}

// The candidate list is captured once per interaction. Only the opaque ID is an
// option value, never the title, ordinal or preview. Each row carries a unique
// short ordinal and, at most, a clearly partial title preview, so equal and long
// titles stay separate candidates.
function sessionSnapshot(context) {
  let listed = [];
  try {
    listed = context.data.session.list();
  } catch {
    listed = [];
  }
  const entries = Array.isArray(listed) ? listed : [];
  const snapshot = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.id !== 'string' || entry.id === '') continue;
    snapshot.push({
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title : null,
      ordinal: `Session ${snapshot.length + 1}`,
    });
  }
  return snapshot;
}

// A returned option value is resolved against this interaction's snapshot, never
// against the foreground tab, the first matching title or other screen text.
function snapshotCandidate(snapshot, value) {
  if (typeof value !== 'string') return null;
  return snapshot.find((candidate) => candidate.id === value) ?? null;
}

// The host record must still be the captured candidate: same opaque ID and the
// same unchanged title. A missing record, a foreign ID or a changed title
// refuses this interaction rather than silently confirming another identity.
function hostRecordMatches(context, candidate) {
  if (candidate.title === null) return false;
  let record;
  try {
    record = context.data.session.get(candidate.id);
  } catch {
    return false;
  }
  return isPlainObject(record) && record.id === candidate.id && record.title === candidate.title;
}

async function verifyCandidate(context, candidate) {
  if (hostRecordMatches(context, candidate)) return true;
  // Preserve the previous best-effort refresh before refusing.
  try {
    await context.data.session.sync(candidate.id);
  } catch {
    return false;
  }
  return hostRecordMatches(context, candidate);
}

function refuseDisplay(context) {
  context.ui.toast.show({
    message:
      'Proceed: the complete selected session identity cannot be displayed here. ' +
      'Enlarge the terminal and reopen, or use Telegram. No question was opened.',
    variant: 'warning',
    duration: 30000,
  });
}

// One additional navigation step. The operator sees the complete captured title
// and exact opaque ID, with the selected ordinal, next to the Open question and
// Cancel controls in the current dialog. Only a still-current `true` advances.
// This stage opens no question by itself, grants no decision authority and never
// rewrites the confirmed identity.
async function confirmSelection(generation, interaction, context, candidate) {
  if (
    identityDisplayProblem(candidate.title) !== null ||
    identityDisplayProblem(candidate.id) !== null
  ) {
    refuseDisplay(context);
    return false;
  }
  const { message, lineCount } = confirmationMessage({
    ordinal: candidate.ordinal,
    title: candidate.title,
    id: candidate.id,
  });
  const admitted = displayGeometry(context.renderer);
  if (admitted === null || !geometryAdmits(admitted, lineCount)) {
    refuseDisplay(context);
    return false;
  }
  if (typeof context.ui.dialog.confirm !== 'function') {
    refuseDisplay(context);
    return false;
  }
  const detach = watchDisplayResize(context, interaction);
  if (detach === null) {
    refuseDisplay(context);
    return false;
  }
  let answer;
  try {
    answer = await context.ui.dialog.confirm({
      title: 'Open Proceed question?',
      message,
      label: { confirm: 'Open question', cancel: 'Cancel' },
    });
  } finally {
    interaction.teardowns.delete(detach);
    detach();
  }
  // `false`, `undefined`, dismissal, a replaced/disposed interaction, an
  // invalidated stage and a lost display admission all do nothing.
  if (answer !== true) return false;
  if (!interactionActive(generation, interaction)) return false;
  const current = displayGeometry(context.renderer);
  if (
    current === null ||
    current.width !== admitted.width ||
    current.height !== admitted.height ||
    !geometryAdmits(current, lineCount)
  ) {
    refuseDisplay(context);
    return false;
  }
  return true;
}

// Only a documented session the host can still resolve may receive a question.
// The foreground session, tab order and recent activity are never substitutes.
async function chooseSession(generation, interaction, context) {
  const snapshot = sessionSnapshot(context);
  if (snapshot.length === 0) {
    context.ui.toast.show({
      message: 'Proceed: no documented session is available to attach a question to.',
      variant: 'warning',
      duration: 20000,
    });
    return null;
  }
  const choice = await context.ui.dialog.select({
    title: 'Select the Proceed session whose pending question to open',
    options: snapshot.map((candidate) => ({
      title: `${candidate.ordinal} - ${identityPreview(candidate.title)}`,
      value: candidate.id,
    })),
  });
  // A replaced or disposed picker completion grants nothing and opens nothing.
  if (choice === undefined || !interactionActive(generation, interaction)) return null;
  const candidate = snapshotCandidate(snapshot, choice);
  if (candidate === null) {
    context.ui.toast.show({
      message: 'Proceed: that choice is not one of the captured sessions; no question was opened.',
      variant: 'warning',
      duration: 20000,
    });
    return null;
  }
  if (!(await verifyCandidate(context, candidate))) {
    if (!interactionActive(generation, interaction)) return null;
    context.ui.toast.show({
      message: 'Proceed: that session cannot be resolved; no question was opened.',
      variant: 'warning',
      duration: 20000,
    });
    return null;
  }
  if (!interactionActive(generation, interaction)) return null;
  return candidate;
}

function decisionFrom(body, presentation) {
  if (!isPlainObject(body) || body.schema_version !== 1) return null;
  if (body.request_id !== presentation.request_id) return null;
  if (typeof body.accepted !== 'boolean' || !RESOLUTIONS.has(body.resolution)) return null;
  if (body.decision_id !== null && typeof body.decision_id !== 'string') return null;
  if (body.response_text !== null && typeof body.response_text !== 'string') return null;
  return body;
}

function retainedStatus(body, presentation) {
  if (!isPlainObject(body) || body.schema_version !== 1) return null;
  if (body.request_id !== presentation.request_id) return null;
  if (!RESOLUTIONS.has(body.resolution) && body.resolution !== 'pending') return null;
  return body;
}

// A transport failure is uncertainty, not a failed commit: refresh the
// authoritative binding once and report what it says. Nothing is replayed.
async function reportTransportUncertainty(generation, interaction, context, presentation) {
  if (!interactionActive(generation, interaction)) return;
  try {
    const body = await exchange(
      generation,
      interaction,
      'presentation',
      {
        harness_id: generation.harnessId,
        owner_id: generation.ownerId,
        session_id: presentation.session_id,
        request_id: presentation.request_id,
      },
      presentation.presentation_id,
    );
    if (!interactionActive(generation, interaction)) return;
    const status = retainedStatus(body, presentation);
    context.ui.toast.show({
      message:
        status === null
          ? 'Proceed: the outcome could not be confirmed. Refresh before retrying.'
          : `Proceed: the broker reports ${inert(status.resolution)}. This retry changed nothing.`,
      variant: 'warning',
      duration: 30000,
    });
  } catch {
    if (!interactionActive(generation, interaction)) return;
    context.ui.toast.show({
      message: 'Proceed: the outcome could not be confirmed. Refresh before retrying.',
      variant: 'warning',
      duration: 30000,
    });
  }
}

async function submitDecision(generation, interaction, context, presentation, choice, text) {
  if (!interactionActive(generation, interaction)) return;
  // The broker is authoritative, but a dialog completed after the immutable
  // deadline must not even attempt a mutation.
  if (!(Date.parse(presentation.expires_at) > Date.now())) {
    context.ui.toast.show({
      message: 'Proceed: this question reached its deadline; no decision was sent.',
      variant: 'warning',
      duration: 20000,
    });
    return;
  }
  let body;
  try {
    body = await exchange(
      generation,
      interaction,
      'decisions',
      {
        harness_id: generation.harnessId,
        owner_id: generation.ownerId,
        session_id: presentation.session_id,
        request_id: presentation.request_id,
        presentation_id: presentation.presentation_id,
        choice,
        response_text: choice === 'respond' ? text : null,
      },
      presentation.presentation_id,
    );
  } catch (error) {
    if (!interactionActive(generation, interaction)) return;
    if (error instanceof HarnessRequestError) {
      showError(context, error);
      return;
    }
    // A local helper failure before authority handoff cannot have submitted
    // anything, so it is reported as a local failure rather than uncertainty.
    if (error instanceof HelperChannelError && error.submitted === false) {
      showError(context, error);
      return;
    }
    await reportTransportUncertainty(generation, interaction, context, presentation);
    return;
  }
  if (!interactionActive(generation, interaction)) return;
  const decision = decisionFrom(body, presentation);
  if (decision === null) {
    disabled(context, 'Proceed harness: the broker returned an unusable decision response.');
    return;
  }
  context.ui.toast.show({
    message: decision.accepted
      ? `Proceed recorded ${inert(decision.resolution)} for ${inert(presentation.request_id)}.`
      : `Proceed already recorded ${inert(decision.resolution)}; this retry changed nothing.`,
    variant: 'info',
    duration: 30000,
  });
}

// Opening the interaction never accepts a choice, and the captured presentation
// binding is what a choice may resolve. A dismissed dialog, an unknown choice, a
// disposal or a Cleanup generation submits nothing.
async function openQuestion(generation, context) {
  if (!generation.active) return;
  const interaction = beginInteraction(generation);
  try {
    const candidate = await chooseSession(generation, interaction, context);
    if (candidate === null || !interactionActive(generation, interaction)) return;
    if (!(await confirmSelection(generation, interaction, context, candidate))) return;
    if (!interactionActive(generation, interaction)) return;
    // Reverify the same ID and unchanged title immediately before the exact
    // captured route is queried; the foreground or current pending slot is never
    // substituted for it.
    if (!(await verifyCandidate(context, candidate))) {
      if (!interactionActive(generation, interaction)) return;
      context.ui.toast.show({
        message: 'Proceed: that session changed or cannot be resolved; reopen to select it again.',
        variant: 'warning',
        duration: 20000,
      });
      return;
    }
    if (!interactionActive(generation, interaction)) return;
    const sessionId = candidate.id;
    let pending;
    try {
      const body = await exchange(generation, interaction, 'pending', {
        harness_id: generation.harnessId,
        owner_id: generation.ownerId,
        session_id: sessionId,
      });
      pending = presentationFrom(body, {
        harnessId: generation.harnessId,
        ownerId: generation.ownerId,
        sessionId,
      });
    } catch (error) {
      if (!interactionActive(generation, interaction)) return;
      showError(context, error);
      return;
    }
    if (!interactionActive(generation, interaction)) return;
    if (!pending.ok) {
      disabled(context, 'Proceed harness: the broker returned an unusable presentation.');
      return;
    }
    const presentation = pending.presentation;
    if (presentation === null) {
      context.ui.toast.show({
        message: 'Proceed: the selected session has no pending question.',
        variant: 'info',
        duration: 15000,
      });
      return;
    }
    if (!(Date.parse(presentation.expires_at) > Date.now())) {
      context.ui.toast.show({
        message: 'Proceed: this question reached its deadline and cannot be answered.',
        variant: 'warning',
        duration: 20000,
      });
      return;
    }
    // The complete immutable question must be currently displayable beside its
    // three choices. A question this terminal cannot show in full opens no
    // actionable dialog, and the immutable deadline is armed before that dialog
    // exists so its expiry fences the question and any Respond successor.
    const display = admitQuestion(context, presentation);
    if (display === null) return;
    if (!armImmutableExpiry(interaction, presentation)) {
      context.ui.toast.show({
        message: 'Proceed: this question reached its deadline and cannot be answered.',
        variant: 'warning',
        duration: 20000,
      });
      return;
    }
    const detach = watchDisplayResize(context, interaction);
    if (detach === null) {
      refuseQuestion(context);
      return;
    }
    // The resize fence stays attached to this interaction for the whole
    // question stage and its Respond successor: the admission was observed for
    // one dialog instance, so a resize during either outstanding dialog ends the
    // stage and every successor. Disposal, replacement and Cleanup release the
    // listener through the interaction that owns it.
    const choice = await context.ui.dialog.select({
      title: display.message,
      current: 'reject',
      options: [
        { title: 'Reject', value: 'reject' },
        { title: 'Respond', value: 'respond' },
        { title: 'Approve', value: 'approve' },
      ],
    });
    // A dismissed, resized, expired, replaced or disposed question grants
    // nothing, and an expired or resized one cannot open its Respond successor.
    if (choice === undefined || !interactionActive(generation, interaction)) return;
    if (choice !== 'approve' && choice !== 'reject' && choice !== 'respond') return;
    let text = null;
    if (choice === 'respond') {
      const answer = await context.ui.dialog.prompt({
        title: `Proceed response for ${inert(presentation.request_id)}`,
        description: 'Text is recorded as instructions for this request and is never an approval.',
        placeholder: 'Instructions for the requested action',
      });
      if (answer === undefined || !interactionActive(generation, interaction)) return;
      text = answer;
    }
    await submitDecision(generation, interaction, context, presentation, choice, text);
  } finally {
    disposeInteraction(generation, interaction);
  }
}

export const harnessTuiDefinition = {
  id: HARNESS_TUI_ID,
  async setup(context) {
    if (context?.app?.version !== SUPPORTED_TUI_HOST_VERSION) {
      disabled(
        context,
        `Proceed harness supports OpenCode ${SUPPORTED_TUI_HOST_VERSION} only; this TUI reports ` +
          `${String(context?.app?.version)}. The channel stays disabled.`,
        'warning',
      );
      return;
    }
    let options;
    let config;
    let loaded;
    try {
      options = readOptions(context.options);
      const paths = statePaths(options.stateDir);
      config = await loadPortableConfiguration(paths);
      if (!(config.owners ?? []).some((entry) => entry?.owner_id === options.ownerId)) {
        throw new Error(
          `owner ${options.ownerId} is not configured; run "proceed-mcp owner add ${options.ownerId} --label <label>"`,
        );
      }
      loaded = await loadOperatorKeyFile({
        file: options.operatorKeyFile,
        stateDir: paths.stateDir,
      });
    } catch (error) {
      disabled(context, `Proceed harness is disabled: ${errorText(error)}`);
      return;
    }

    // The credential and the mutable generation live only in this closure. Each
    // exchange hands a transient copy to one short-lived private helper over
    // parent-created pipes; nothing here reads owner, control or Telegram
    // credentials and no key path ever leaves the TUI.
    const generation = {
      active: true,
      disabled: false,
      interaction: null,
      harnessId: options.harnessId,
      ownerId: options.ownerId,
      keyId: loaded.keyId,
      credential: loaded.credential,
      port: config.broker.port,
      lockFile: statePaths(options.stateDir).brokerLockFile,
    };

    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: ENROLL_COMMAND,
          title: 'Proceed harness: propose or observe operator enrollment',
          bind: ENROLL_BIND,
          // The command opens setup; it never enrolls or decides by itself.
          run: () => proposeEnrollment(generation, context),
        },
        {
          id: OPEN_QUESTION_COMMAND,
          title: 'Proceed harness: open the pending question for a session',
          bind: OPEN_QUESTION_BIND,
          // Arguments and programmatic dispatch can open this interaction, never
          // supply its answer: the operator's dialog completion is the only path.
          run: () => openQuestion(generation, context),
        },
      ],
      bindings: [ENROLL_COMMAND, OPEN_QUESTION_COMMAND],
    }));

    context.ui.toast.show({
      message:
        `Proceed harness ready for ${options.harnessId} (owner ${options.ownerId}). ` +
        `Operator key fingerprint ${loaded.keyId}. Run ${ENROLL_COMMAND} to propose or ` +
        `observe enrollment.`,
      variant: 'info',
      duration: 30000,
    });

    return () => {
      // Fence this generation first so no late dialog result can submit, then
      // abort the interaction it still owns.
      generation.active = false;
      const interaction = generation.interaction;
      generation.interaction = null;
      if (interaction !== null) {
        interaction.active = false;
        releaseInteraction(interaction);
        interaction.controller.abort();
      }
    };
  },
};
