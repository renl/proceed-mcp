// Versioned local configuration schema 1 (design section 2). The password is
// never stored here: only the environment variable name that holds it.
import { invalidArgument, storageFailure } from '../errors.js';
import { normalizeOriginUrl } from './origin-url.js';

export const CONFIG_SCHEMA_VERSION = 1;
export const TELEGRAM_TOKEN_ENV = 'PROCEED_TELEGRAM_BOT_TOKEN';
export const DEFAULT_BROKER_PORT = 43189;
export const ORIGIN_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;
export const PASSWORD_ENV_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function createEmptyConfig() {
  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    telegram: { token_env: TELEGRAM_TOKEN_ENV },
    broker: { port: DEFAULT_BROKER_PORT },
    origins: [],
  };
}

export function validateOriginId(originId) {
  if (typeof originId !== 'string' || !ORIGIN_ID_PATTERN.test(originId)) {
    throw invalidArgument('origin_id must match [a-z0-9_-]{1,64}');
  }
  return originId;
}

export function validatePasswordEnvName(name) {
  if (typeof name !== 'string' || !PASSWORD_ENV_PATTERN.test(name)) {
    throw invalidArgument('--password-env must be a valid environment variable name');
  }
  if (name === TELEGRAM_TOKEN_ENV) {
    throw invalidArgument(
      `--password-env must not reuse ${TELEGRAM_TOKEN_ENV}; origin credentials are separate from the Telegram token`,
    );
  }
  return name;
}

export function createOriginBinding({ originId, url, passwordEnv }) {
  return {
    origin_id: validateOriginId(originId),
    url: normalizeOriginUrl(url).url,
    password_env: validatePasswordEnvName(passwordEnv),
  };
}

// An existing binding is never replaced: a different URL requires a new origin ID.
export function withOrigin(config, origin) {
  const duplicate = config.origins.some((entry) => entry.origin_id === origin.origin_id);
  if (duplicate) {
    throw invalidArgument(
      `origin ${origin.origin_id} already exists; bindings are immutable, so choose a new origin_id`,
    );
  }
  return { ...config, origins: [...config.origins, origin] };
}

// Structural violations of a file a human may have edited are invalid
// configuration; unreadable JSON or an unknown schema version is integrity loss.
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

  if (!Array.isArray(parsed.origins)) {
    throw invalidArgument('config.json origins must be an array');
  }

  const seen = new Set();
  const origins = parsed.origins.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw invalidArgument(`config.json origins[${index}] must be an object`);
    }
    const originId = validateOriginId(entry.origin_id);
    if (seen.has(originId)) {
      throw invalidArgument(`config.json origins[${index}] repeats origin_id ${originId}`);
    }
    seen.add(originId);
    // Re-normalize so an edited URL cannot widen the approved topology.
    const { url } = normalizeOriginUrl(entry.url);
    if (entry.url !== url) {
      throw invalidArgument(
        `config.json origins[${index}] url must stay the canonical form ${url}`,
      );
    }
    return {
      origin_id: originId,
      url,
      password_env: validatePasswordEnvName(entry.password_env),
    };
  });

  return {
    schema_version: CONFIG_SCHEMA_VERSION,
    telegram: { token_env: TELEGRAM_TOKEN_ENV },
    broker: { port },
    origins,
  };
}

export function serializeConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`;
}
