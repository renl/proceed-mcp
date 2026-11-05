// Ephemeral adapter registration registry (design sections 2, 3 and 7).
//
// A registration is a random identifier plus a protected 256-bit secret returned
// exactly once by the create route; both live only in memory, so restarting the
// broker discards every registration while durable principal identity and request
// capability verifiers survive elsewhere. The secret is the authority.
//
// The lease runs from the last fully validated registration-bound activity;
// expiry is checked before any lookup or admission without a sweep timer, and a
// released or expired registration is forgotten rather than retained.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { conflict, invalidArgument, storageFailure } from '../errors.js';
// The encodings are shared with the adapter binding, so one definition governs
// what the broker issues and what an adapter accepts; the exports here keep the
// checkpoint's public surface unchanged.
import { REGISTRATION_ID_PATTERN, REGISTRATION_SECRET_PATTERN } from '../util/values.js';

export { REGISTRATION_ID_PATTERN, REGISTRATION_SECRET_PATTERN };

export const REGISTRATION_LEASE_MS = 45000;

// Only the documented encoding reaches the constant-time comparison.
function sameSecret(presented, stored) {
  if (typeof presented !== 'string' || !REGISTRATION_SECRET_PATTERN.test(presented)) return false;
  if (typeof stored !== 'string' || !REGISTRATION_SECRET_PATTERN.test(stored)) return false;
  return timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(stored, 'hex'));
}

class RegistrationRegistry {
  #clock;
  #leaseMs;
  #logger;
  #byId = new Map();
  #byOwner = new Map();
  #closed = false;

  constructor({ clock, leaseMs, logger }) {
    this.#clock = clock;
    this.#leaseMs = leaseMs;
    this.#logger = logger;
  }

  // One live registration per owner: a duplicate is refused without disturbing
  // the existing incarnation, while an expired one is replaced here because
  // admission is where the lease boundary takes effect for a returning adapter.
  async register({ ownerId } = {}) {
    if (this.#closed) {
      throw storageFailure('the registration registry is closed', 'REGISTRATION_CLOSED');
    }
    if (typeof ownerId !== 'string' || ownerId.length === 0) {
      throw invalidArgument('registration needs an authenticated owner');
    }
    const now = this.#clock();
    const existing = this.#byOwner.get(ownerId);
    if (existing !== undefined) {
      const expired = now >= existing.lastActivity + this.#leaseMs;
      if (!expired) throw conflict('one live adapter registration per owner', 'OWNER_IN_USE');
      this.#forget(existing);
    }
    let registrationId;
    do {
      registrationId = `reg_${randomBytes(16).toString('hex')}`;
    } while (this.#byId.has(registrationId));
    const record = {
      registrationId,
      ownerId,
      lastActivity: now,
      secret: randomBytes(32).toString('hex'),
    };
    this.#byId.set(record.registrationId, record);
    this.#byOwner.set(ownerId, record);
    // Only the owner is logged: the secret never leaves the create response.
    this.#logger('portable.registration.created', { owner_id: ownerId });
    return { registration_id: record.registrationId, registration_secret: record.secret };
  }

  // A pure check, for routes that must not renew the lease.
  authenticate(input = {}) {
    return this.#match(input) !== null;
  }

  // Only a fully validated heartbeat renews. A rejected attempt, an owner-only
  // management call and a malformed body leave the deadline exactly where it was.
  heartbeat(input = {}) {
    if (this.#closed) return false;
    const record = this.#match(input);
    if (record === null) return false;
    record.lastActivity = this.#clock();
    return true;
  }

  // Release addresses the captured incarnation only, so a registration that was
  // already released, expired or replaced cannot remove its successor.
  release(input = {}) {
    if (this.#closed) return false;
    const record = this.#match(input);
    if (record === null) return false;
    this.#forget(record);
    return true;
  }

  // Terminal and idempotent: clearing the entries is the fence, so a late
  // completion cannot re-admit, renew or release anything afterwards.
  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#byId.clear();
    this.#byOwner.clear();
  }

  #match({ ownerId, registrationId, secret } = {}) {
    if (this.#closed) return null;
    const record = this.#live(registrationId);
    if (record === null || record.ownerId !== ownerId) return null;
    return sameSecret(secret, record.secret) ? record : null;
  }

  // The lease is checked before any caller can authenticate, renew or release,
  // so every denied outcome shares one path and one denial.
  #live(registrationId) {
    if (typeof registrationId !== 'string' || !REGISTRATION_ID_PATTERN.test(registrationId)) {
      return null;
    }
    const record = this.#byId.get(registrationId);
    if (record === undefined) return null;
    if (this.#clock() >= record.lastActivity + this.#leaseMs) {
      this.#forget(record);
      return null;
    }
    return record;
  }

  // Identity is compared before deletion, so a stale record can never drop the
  // live replacement from either index.
  #forget(record) {
    if (this.#byId.get(record.registrationId) === record) {
      this.#byId.delete(record.registrationId);
    }
    if (this.#byOwner.get(record.ownerId) === record) {
      this.#byOwner.delete(record.ownerId);
    }
  }
}

export function createRegistrationRegistry({
  clock = Date.now,
  leaseMs = REGISTRATION_LEASE_MS,
  logger = () => {},
} = {}) {
  if (typeof clock !== 'function') throw invalidArgument('clock must be a function');
  if (!Number.isInteger(leaseMs) || leaseMs <= 0) {
    throw invalidArgument('registration lease must be a positive integer');
  }
  if (typeof logger !== 'function') throw invalidArgument('logger must be a function');
  return new RegistrationRegistry({ clock, leaseMs, logger });
}
