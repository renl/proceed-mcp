// The four closed helper operations and their exact broker bindings (design
// section 2). The helper derives only these fixed routes and the operator
// credential headers; no URL, method, header, proxy, owner/control token or
// readiness/start/stop operation is accepted, and no key file is ever read.
import { isAbsolute } from 'node:path';
import { REQUEST_ID_PATTERN, scalarLength } from '../util/values.js';
import {
  OPERATOR_KEY_PATTERN,
  PRESENTATION_ID_PATTERN,
  harnessIdProblem,
  ownerIdProblem,
  sessionProblem,
} from './identifiers.js';
import { PROTOCOL_SCHEMA_VERSION, exactFieldsProblem, protocolInvalid } from './helper-protocol.js';

export const HELPER_OPERATIONS = Object.freeze([
  'enrollments',
  'pending',
  'presentation',
  'decisions',
]);
export const DECISION_CHOICES = Object.freeze(['approve', 'reject', 'respond']);
// The same ceiling the human Respond prompt and the broker accept.
export const MAX_RESPONSE_SCALARS = 4096;
const MAX_LOCK_PATH_CHARS = 4096;

const FRAME_FIELDS = Object.freeze([
  'schema_version',
  'type',
  'exchange_id',
  'port',
  'lock_file',
  'operator_credential',
  'operation',
  'presentation_id',
  'body',
]);

const BODY_FIELDS = Object.freeze({
  enrollments: ['harness_id', 'owner_id'],
  pending: ['harness_id', 'owner_id', 'session_id'],
  presentation: ['harness_id', 'owner_id', 'session_id', 'request_id'],
  decisions: [
    'harness_id',
    'owner_id',
    'session_id',
    'request_id',
    'presentation_id',
    'choice',
    'response_text',
  ],
});

const ROUTES = Object.freeze({
  enrollments: '/v1/harness/enrollments',
  pending: '/v1/harness/pending',
  decisions: '/v1/harness/decisions',
});

// The route is constructed only from a known operation and a validated retained
// presentation identifier, so no query, fragment or arbitrary path component can
// be supplied through the pipe.
export function routeFor(operation, presentationId) {
  if (operation === 'presentation') {
    if (typeof presentationId !== 'string' || !PRESENTATION_ID_PATTERN.test(presentationId)) {
      throw protocolInvalid();
    }
    return `/v1/harness/presentations/${presentationId}`;
  }
  if (!Object.hasOwn(ROUTES, operation)) throw protocolInvalid();
  return ROUTES[operation];
}

function bodyProblem(operation, presentationId, body) {
  if (!Object.hasOwn(BODY_FIELDS, operation)) return 'operation';
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'body';
  const fields = exactFieldsProblem(body, BODY_FIELDS[operation]);
  if (fields !== null) return fields;
  const scope = harnessIdProblem(body.harness_id) ?? ownerIdProblem(body.owner_id);
  if (scope !== null) return scope;
  if (operation !== 'enrollments') {
    const session = sessionProblem(body.session_id);
    if (session !== null) return session;
  }
  if (operation === 'presentation' || operation === 'decisions') {
    if (typeof body.request_id !== 'string' || !REQUEST_ID_PATTERN.test(body.request_id)) {
      return 'request_id must be a well-formed request identifier';
    }
  }
  if (operation === 'presentation') {
    if (typeof presentationId !== 'string' || !PRESENTATION_ID_PATTERN.test(presentationId)) {
      return 'presentation_id must be hpr_ plus 32 lowercase hexadecimal characters';
    }
    return null;
  }
  if (operation === 'decisions') {
    if (
      typeof body.presentation_id !== 'string' ||
      !PRESENTATION_ID_PATTERN.test(body.presentation_id)
    )
      return 'presentation_id must be hpr_ plus 32 lowercase hexadecimal characters';
    if (body.presentation_id !== presentationId) return 'presentation_id must match the frame';
    if (!DECISION_CHOICES.includes(body.choice)) return 'choice must be approve, reject or respond';
    if (body.choice !== 'respond') {
      return body.response_text === null
        ? null
        : 'response_text must be null for approve or reject';
    }
    if (typeof body.response_text !== 'string' || !body.response_text.isWellFormed()) {
      return 'response_text must be well-formed text';
    }
    const length = scalarLength(body.response_text);
    if (length < 1 || length > MAX_RESPONSE_SCALARS) {
      return `response_text must be 1-${MAX_RESPONSE_SCALARS} Unicode scalar values`;
    }
    return null;
  }
  return presentationId === null ? null : 'presentation_id must be null for this operation';
}

// The complete parent-to-child exchange frame: exact fields, a bounded port, an
// absolute protected lock path, the exact operator credential format and a body
// that is exactly that route's input table.
export function exchangeProblem(value, expectedExchangeId) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return 'frame';
  const fields = exactFieldsProblem(value, FRAME_FIELDS);
  if (fields !== null) return fields;
  if (value.schema_version !== PROTOCOL_SCHEMA_VERSION) return 'the frame version is unsupported';
  if (value.type !== 'exchange') return 'the second frame must be exchange';
  if (typeof value.exchange_id !== 'string' || value.exchange_id !== expectedExchangeId) {
    return 'the exchange names a different correlation id';
  }
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    return 'port must be 1-65535';
  }
  const lockFile = value.lock_file;
  if (
    typeof lockFile !== 'string' ||
    lockFile === '' ||
    lockFile.length > MAX_LOCK_PATH_CHARS ||
    !isAbsolute(lockFile) ||
    /[\u0000\r\n]/.test(lockFile)
  ) {
    return 'lock_file must be an absolute protected path';
  }
  if (
    typeof value.operator_credential !== 'string' ||
    !OPERATOR_KEY_PATTERN.test(value.operator_credential)
  ) {
    return 'operator_credential must match the operator credential format';
  }
  return bodyProblem(value.operation, value.presentation_id, value.body);
}
