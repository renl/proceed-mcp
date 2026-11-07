// Harness channel identifiers and input domains (design sections 1-3).
//
// The operator credential is a bearer secret; its `key_id` is only the public
// SHA-256 fingerprint and verifier, so nothing here ever loads or compares the
// credential itself. Enrollment and presentation identifiers are correlation
// only: possessing one grants no decision authority.
import { randomBytes } from 'node:crypto';
import { OWNER_ID_PATTERN } from '../config/portable-config.js';
import { invalidArgument } from '../errors.js';

export const ENROLLMENT_ID_PATTERN = /^hen_[a-f0-9]{32}$/;
export const PRESENTATION_ID_PATTERN = /^hpr_[a-f0-9]{32}$/;
// `hop_` plus 64 lowercase hexadecimal characters, exactly as provisioned.
export const OPERATOR_KEY_PATTERN = /^hop_[a-f0-9]{64}$/;
export const OPERATOR_KEY_ID_PATTERN = /^[a-f0-9]{64}$/;
export const ENROLLMENT_TOKEN_PATTERN = /^[a-f0-9]{32}$/;
export const HARNESS_ID_PATTERN = OWNER_ID_PATTERN;
export const MAX_SESSION_BYTES = 512;
export const ENROLLMENT_TTL_SECONDS = 300n;

export function randomEnrollmentId() {
  return `hen_${randomBytes(16).toString('hex')}`;
}

export function randomPresentationId() {
  return `hpr_${randomBytes(16).toString('hex')}`;
}

// One token per Confirm/Deny control. It correlates a callback with its own
// enrollment and pairing snapshot; the private-chat sender check is what
// authorizes it.
export function randomEnrollmentToken() {
  return randomBytes(16).toString('hex');
}

export function harnessIdProblem(value) {
  if (typeof value !== 'string' || !HARNESS_ID_PATTERN.test(value)) {
    return 'harness_id must match [a-z0-9_-]{1,64}';
  }
  return null;
}

export function ownerIdProblem(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    return 'owner_id must match [a-z0-9_-]{1,64}';
  }
  return null;
}

// A host session route is opaque text: nonempty, well-formed Unicode, at most
// 512 UTF-8 bytes, compared exactly and never normalized. It is routing context,
// never authentication.
export function sessionProblem(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return 'session_id must be nonempty text';
  }
  if (!value.isWellFormed()) return 'session_id must be well-formed text';
  if (Buffer.byteLength(value, 'utf8') > MAX_SESSION_BYTES) {
    return `session_id must be at most ${MAX_SESSION_BYTES} UTF-8 bytes`;
  }
  return null;
}

export function requireHarnessScope({ harnessId, ownerId } = {}) {
  const problem = harnessIdProblem(harnessId) ?? ownerIdProblem(ownerId);
  if (problem !== null) throw invalidArgument(problem);
}

export function requireSession(value) {
  const problem = sessionProblem(value);
  if (problem !== null) throw invalidArgument(problem);
  return value;
}
