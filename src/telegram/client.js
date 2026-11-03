// Telegram Bot API 10.3 client for the one dedicated bot of this broker
// (design section 5). Only the fixed platform endpoint is contacted, and the
// token lives in the request path, so no request URL ever reaches a diagnostic.
import https from 'node:https';

export const TELEGRAM_ORIGIN = 'https://api.telegram.org';
export const TELEGRAM_POLL_TIMEOUT_MS = 40_000;
export const TELEGRAM_REQUEST_TIMEOUT_MS = 20_000;
export const TELEGRAM_POLL_SECONDS = 30;

export class TelegramError extends Error {
  constructor(code, message, { retryable = false, retryAfter = null, status = null } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

// UI sends and edits answer 403/404 for a target this bot cannot address, which is
// a definite rejection of that operation rather than proof that the configured
// credential was rejected. Polling and callback acknowledgement keep the
// credential classification, and a 401 is always a credential answer.
const UI_METHODS = new Set(['sendMessage', 'editMessageText', 'editMessageReplyMarkup']);

export function createTelegramClient({ token, timeoutMs = TELEGRAM_REQUEST_TIMEOUT_MS }) {
  if (typeof token !== 'string' || token === '') {
    throw new TelegramError('TOKEN_MISSING', 'no Telegram bot token is configured');
  }

  const call = (method, payload, deadline = timeoutMs, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new TelegramError('CANCELLED', 'the Telegram call was stopped'));
        return;
      }
      const bytes = Buffer.from(JSON.stringify(payload ?? {}), 'utf8');
      const url = `${TELEGRAM_ORIGIN}/bot${token}/${method}`;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      };

      const request = https.request(
        url,
        {
          method: 'POST',
          agent: false,
          headers: {
            'content-type': 'application/json',
            'content-length': String(bytes.length),
            accept: 'application/json',
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', () => finish(unavailable()));
          response.on('end', () => {
            let body;
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
              finish(unavailable('the Telegram platform returned an unreadable response'));
              return;
            }
            if (body?.ok === true) {
              finish(null, body.result);
              return;
            }
            finish(envelopeError(response.statusCode, body, UI_METHODS.has(method)));
          });
        },
      );

      request.setTimeout(deadline, () => {
        request.destroy();
        finish(
          new TelegramError('TELEGRAM_TIMEOUT', 'the Telegram request exceeded its deadline', {
            retryable: true,
          }),
        );
      });
      request.on('error', () => finish(unavailable()));
      signal?.addEventListener('abort', () => {
        request.destroy();
        finish(new TelegramError('CANCELLED', 'the Telegram call was stopped'));
      });
      request.end(bytes);
    });

  return {
    async me() {
      return call('getMe');
    },

    // Long poll. `offset` is the next update to confirm; the caller advances it
    // only after the update's durable consequences are committed.
    async updates(offset, { signal } = {}) {
      return call(
        'getUpdates',
        {
          ...(offset === null ? {} : { offset }),
          limit: 100,
          timeout: TELEGRAM_POLL_SECONDS,
          allowed_updates: ['message', 'callback_query'],
        },
        TELEGRAM_POLL_TIMEOUT_MS,
        signal,
      );
    },

    // UI calls carry the caller's abort signal so a stop reaches transport that
    // is already in flight, not only the long poll.
    async sendMessage(payload, { signal } = {}) {
      return call('sendMessage', payload, timeoutMs, signal);
    },

    async answerCallbackQuery(payload, { signal } = {}) {
      return call('answerCallbackQuery', payload, timeoutMs, signal);
    },

    // Both terminal edit methods carry the worker's abort signal like a send, so a
    // stop reaches a retirement or status request that is already in flight.
    async editMessageText(payload, { signal } = {}) {
      return call('editMessageText', payload, timeoutMs, signal);
    },

    async editMessageReplyMarkup(payload, { signal } = {}) {
      return call('editMessageReplyMarkup', payload, timeoutMs, signal);
    },
  };
}

function unavailable(message = 'the Telegram platform could not be reached') {
  return new TelegramError('TELEGRAM_UNAVAILABLE', message, { retryable: true });
}

function envelopeError(status, body, ui = false) {
  const description =
    typeof body?.description === 'string' ? body.description.slice(0, 200) : 'unsupported';
  const retryAfter = Number.isInteger(body?.parameters?.retry_after)
    ? body.parameters.retry_after
    : null;
  if (retryAfter !== null || body?.error_code === 429) {
    return new TelegramError(
      'TELEGRAM_RATE_LIMITED',
      'the Telegram platform asked this bot to slow down',
      {
        retryable: true,
        retryAfter,
        status,
      },
    );
  }
  if (status === 401 || ((status === 403 || status === 404) && !ui)) {
    return new TelegramError('TOKEN_REJECTED', 'the configured Telegram bot token was rejected', {
      status,
    });
  }
  if (status === 409) {
    // A webhook or a second poller owns this bot's updates.
    return new TelegramError('POLLER_CONFLICT', 'another consumer owns this bot updates', {
      status,
    });
  }
  if (status >= 500) {
    return new TelegramError('TELEGRAM_UNAVAILABLE', 'the Telegram platform is unavailable', {
      retryable: true,
      status,
    });
  }
  return new TelegramError(
    'TELEGRAM_REJECTED',
    `the Telegram platform rejected the call: ${description}`,
    {
      status,
    },
  );
}
