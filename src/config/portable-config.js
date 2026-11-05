// Portable configuration schema 2 (design section 2): immutable transport
// principals replace origin/API bindings. This module is additive; the existing
// schema-1 consumers keep importing ../config/config.js until the separately
// authorized consumer switch, so schema 1 stays valid for them here.
import { invalidArgument, storageFailure } from '../errors.js';

export const CONFIG_SCHEMA_VERSION = 2;
export const TELEGRAM_TOKEN_ENV = 'PROCEED_TELEGRAM_BOT_TOKEN';
export const DEFAULT_BROKER_PORT = 43189;
export const OWNER_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const OWNER_LABEL_MAX_SCALARS = 128;

export function validateOwnerId(value) {
  if (typeof value !== 'string' || !OWNER_ID_PATTERN.test(value)) {
    throw invalidArgument('owner_id must match [a-z0-9_-]{1,64}');
  }
  return value;
}

// Labels are display context only, so the exact code points are preserved: no
// trimming, case folding or normalization. They must still be well-formed
// UTF-16, because a lone surrogate cannot be written to a JSON document and
// read back unchanged.
export function validateOwnerLabel(value) {
  if (typeof value !== 'string') {
    throw invalidArgument('owner label must be a string');
  }
  let scalars = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw invalidArgument('owner label must not contain unpaired surrogates');
    }
    scalars += 1;
  }
  if (scalars < 1 || scalars > OWNER_LABEL_MAX_SCALARS) {
    throw invalidArgument(
      `owner label must contain 1-${OWNER_LABEL_MAX_SCALARS} Unicode scalar values`,
    );
  }
  return value;
}

export function createOwner({ ownerId, label } = {}) {
  return { owner_id: validateOwnerId(ownerId), label: validateOwnerLabel(label) };
}

export function createEmptyConfig() {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    telegram: { token_env: TELEGRAM_TOKEN_ENV },
    broker: { port: DEFAULT_BROKER_PORT },
    owners: [],
  };
}

// Appends without touching the records already held by the caller: an owner
// record is immutable, so a repeated ID is refused rather than replaced.
export function withOwner(config, owner) {
  const entry = createOwner({ ownerId: owner?.owner_id, label: owner?.label });
  const duplicate = config.owners.some((existing) => existing?.owner_id === entry.owner_id);
  if (duplicate) {
    throw invalidArgument(
      `owner ${entry.owner_id} already exists; owner records are immutable, so choose a new owner_id`,
    );
  }
  return { ...config, owners: [...config.owners, entry] };
}

// Unreadable JSON or an unexpected schema version is integrity loss, because the
// document cannot be interpreted at all. A readable schema-2 document with a bad
// field is invalid configuration a human may repair.
export function parseConfigDocument(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw storageFailure(
      'config.json is not valid JSON; the state directory may be damaged',
      'CONFIG_CORRUPT',
      cause,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw invalidArgument('config.json must contain a JSON object');
  }
  if (parsed.schema_version !== CONFIG_SCHEMA_VERSION) {
    throw storageFailure(
      `config.json declares schema_version ${JSON.stringify(parsed.schema_version)}; this build supports ${CONFIG_SCHEMA_VERSION}`,
      'UNSUPPORTED_CONFIG_VERSION',
    );
  }

  const tokenEnv = parsed.telegram?.token_env;
  if (tokenEnv !== TELEGRAM_TOKEN_ENV) {
    throw invalidArgument(`config.json telegram.token_env must be ${TELEGRAM_TOKEN_ENV}`);
  }

  const port = parsed.broker?.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidArgument('config.json broker.port must be an integer in 1-65535');
  }

  if (!Array.isArray(parsed.owners)) {
    throw invalidArgument('config.json owners must be an array');
  }

  const seen = new Set();
  const owners = parsed.owners.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalidArgument(`config.json owners[${index}] must be an object`);
    }
    const owner = createOwner({ ownerId: entry.owner_id, label: entry.label });
    if (seen.has(owner.owner_id)) {
      throw invalidArgument(`config.json owners[${index}] repeats owner_id ${owner.owner_id}`);
    }
    seen.add(owner.owner_id);
    return owner;
  });

  // Canonical rebuild: unknown, obsolete or origin-shaped fields are dropped
  // instead of being carried forward into the next write.
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    telegram: { token_env: TELEGRAM_TOKEN_ENV },
    broker: { port },
    owners,
  };
}

export function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}
