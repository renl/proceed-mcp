// TUI-only harness interaction (design sections 1-3). This module is imported by
// the packaged `tui` entry and receives the host context; it imports no host UI
// peer itself, so portable entry points stay free of the plugin SDK.
//
// The operator credential is loaded once and kept only in this setup generation's
// closure. Every broker exchange uses the product operator transport: the exact
// protected TLS-PSK admission, a 10000 ms budget and the 64 KiB response ceiling.
// A command can open the local interaction, but only the operator's completed
// dialog choice can submit a decision; command arguments and RPC inputs are
// ignored. Dismissal, an expired deadline, disposal and Cleanup send nothing.
import { createOperatorLocalClient } from '../http/local-client.js';
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

export const HARNESS_TUI_ID = 'proceed.harness';
// Trusted harness interaction is claimed only for the pinned, reviewed host.
export const SUPPORTED_TUI_HOST_VERSION = '2.2.5';
export const ENROLL_COMMAND = 'proceed.harness.enroll';
export const ENROLL_BIND = 'ctrl+e';
export const OPEN_QUESTION_COMMAND = 'proceed.harness.open';
export const OPEN_QUESTION_BIND = 'ctrl+g';

const OPTION_KEYS = Object.freeze(['state_dir', 'harness_id', 'owner_id', 'operator_key_file']);
const DECISION_ROUTE = '/v1/harness/decisions';
const ENROLLMENT_ROUTE = '/v1/harness/enrollments';
const PENDING_ROUTE = '/v1/harness/pending';
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

// One operator-route exchange. A non-2xx reply is the broker's versioned envelope
// and its code travels unchanged.
async function exchange(generation, path, body) {
  const response = await generation.client.request(
    'POST',
    path,
    body,
    {},
    {
      signal: generation.controller.signal,
    },
  );
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
  let enrollment;
  try {
    const body = await exchange(generation, ENROLLMENT_ROUTE, {
      harness_id: generation.harnessId,
      owner_id: generation.ownerId,
    });
    enrollment = enrollmentFrom(body, generation);
  } catch (error) {
    if (!generation.active) return;
    showError(context, error);
    return;
  }
  if (!generation.active) return;
  if (enrollment === null) {
    disabled(context, 'Proceed harness: the broker returned an unusable enrollment response.');
    return;
  }
  await context.ui.dialog.alert({
    title: 'Proceed harness operator enrollment',
    message: enrollmentMessage(enrollment, generation),
  });
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

function questionTitle(presentation) {
  return [
    'Proceed approval request',
    `Request: ${inert(presentation.request_id)}`,
    `Session: ${inert(presentation.session_label)}`,
    `Action: ${inert(presentation.action)}`,
    `Context: ${inert(presentation.context)}`,
    `Expires: ${inert(presentation.expires_at)}`,
    '',
    'Choose Reject, Respond or Approve. Dismissing this dialog sends no decision.',
  ].join('\n');
}

// Only a documented session the host can still resolve may receive a question.
// The foreground session, tab order and recent activity are never substitutes.
async function chooseSession(generation, context) {
  let listed = [];
  try {
    listed = context.data.session.list();
  } catch {
    listed = [];
  }
  const candidates = (Array.isArray(listed) ? listed : []).filter(
    (entry) => isPlainObject(entry) && typeof entry.id === 'string' && entry.id !== '',
  );
  if (candidates.length === 0) {
    context.ui.toast.show({
      message: 'Proceed: no documented session is available to attach a question to.',
      variant: 'warning',
      duration: 20000,
    });
    return null;
  }
  const choice = await context.ui.dialog.select({
    title: 'Select the Proceed session whose pending question to open',
    options: candidates.map((entry) => ({
      title: `${inert(entry.title ?? entry.id)} (${inert(entry.id)})`,
      value: entry.id,
    })),
  });
  if (choice === undefined || !generation.active) return null;
  if (context.data.session.get(choice) === undefined) {
    try {
      await context.data.session.sync(choice);
    } catch {
      // An unresolvable session stays unresolvable; no decision UI is shown.
    }
  }
  if (context.data.session.get(choice) === undefined) {
    context.ui.toast.show({
      message: 'Proceed: that session cannot be resolved; no question was opened.',
      variant: 'warning',
      duration: 20000,
    });
    return null;
  }
  return choice;
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
async function reportTransportUncertainty(generation, context, presentation) {
  if (!generation.active) return;
  try {
    const body = await exchange(
      generation,
      `/v1/harness/presentations/${presentation.presentation_id}`,
      {
        harness_id: generation.harnessId,
        owner_id: generation.ownerId,
        session_id: presentation.session_id,
        request_id: presentation.request_id,
      },
    );
    if (!generation.active) return;
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
    if (!generation.active) return;
    context.ui.toast.show({
      message: 'Proceed: the outcome could not be confirmed. Refresh before retrying.',
      variant: 'warning',
      duration: 30000,
    });
  }
}

async function submitDecision(generation, context, presentation, choice, text) {
  if (!generation.active) return;
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
    body = await exchange(generation, DECISION_ROUTE, {
      harness_id: generation.harnessId,
      owner_id: generation.ownerId,
      session_id: presentation.session_id,
      request_id: presentation.request_id,
      presentation_id: presentation.presentation_id,
      choice,
      response_text: choice === 'respond' ? text : null,
    });
  } catch (error) {
    if (!generation.active) return;
    if (error instanceof HarnessRequestError) {
      showError(context, error);
      return;
    }
    await reportTransportUncertainty(generation, context, presentation);
    return;
  }
  if (!generation.active) return;
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
  const sessionId = await chooseSession(generation, context);
  if (sessionId === null || !generation.active) return;
  let pending;
  try {
    const body = await exchange(generation, PENDING_ROUTE, {
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
    if (!generation.active) return;
    showError(context, error);
    return;
  }
  if (!generation.active) return;
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
  const choice = await context.ui.dialog.select({
    title: questionTitle(presentation),
    current: 'reject',
    options: [
      { title: 'Reject', value: 'reject' },
      { title: 'Respond', value: 'respond' },
      { title: 'Approve', value: 'approve' },
    ],
  });
  if (choice === undefined || !generation.active) return;
  if (choice !== 'approve' && choice !== 'reject' && choice !== 'respond') return;
  let text = null;
  if (choice === 'respond') {
    const answer = await context.ui.dialog.prompt({
      title: `Proceed response for ${inert(presentation.request_id)}`,
      description: 'Text is recorded as instructions for this request and is never an approval.',
      placeholder: 'Instructions for the requested action',
    });
    if (answer === undefined || !generation.active) return;
    text = answer;
  }
  await submitDecision(generation, context, presentation, choice, text);
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

    // The credential and the mutable generation live only in this closure. The
    // client reads the protected lock per exchange; nothing here reads owner,
    // control or Telegram credentials.
    const generation = {
      active: true,
      controller: new AbortController(),
      harnessId: options.harnessId,
      ownerId: options.ownerId,
      keyId: loaded.keyId,
      client: createOperatorLocalClient({
        port: config.broker.port,
        lockFile: statePaths(options.stateDir).brokerLockFile,
        token: loaded.credential,
      }),
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
      // abort the transports it owns.
      generation.active = false;
      generation.controller.abort();
    };
  },
};
