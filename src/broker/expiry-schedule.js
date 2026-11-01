// Periodic deadline processing (design sections 4 and 7). One sweep per tick, claimed
// before it runs and skipped while an attempt is still queued behind a held writer, so
// a slow disk never builds a backlog. The unref'd timer cannot keep a finished process
// alive. A scheduled failure disables ticks permanently and logs one fixed redacted
// diagnostic; there is no retry, repair, fence clearing or interval option.
export const SWEEP_INTERVAL_MS = 1000;
const SWEEP_FAILED_MESSAGE =
  'expiry scheduling stopped after a storage failure; stop and restart serve';

// Attempted once and never awaited: a throw must not suppress the other attempt, and a
// returned Promise/thenable is observed so its rejection stays contained.
function notify(call) {
  try {
    Promise.resolve(call()).catch(() => {});
  } catch {
    return;
  }
}

export function startExpirySchedule({ broker, logger = () => {}, onFailure = () => {} } = {}) {
  if (typeof broker?.scheduledSweep !== 'function') {
    throw new TypeError('a schedule needs a broker with scheduledSweep()');
  }
  let timer = null;
  let failed = false;
  let busy = false;
  let current = null;
  let stopPromise = null;

  const fail = () => {
    if (failed) return;
    failed = true;
    clearInterval(timer);
    notify(() => onFailure());
    notify(() => logger(SWEEP_FAILED_MESSAGE));
  };

  const attempt = () => {
    if (failed || busy || stopPromise !== null) return;
    busy = true;
    current = (async () => {
      try {
        await broker.scheduledSweep();
      } catch {
        fail();
      } finally {
        busy = false;
        current = null;
      }
    })();
  };

  timer = setInterval(attempt, SWEEP_INTERVAL_MS);
  timer.unref?.();

  return {
    get failed() {
      return failed;
    },
    // One shared promise, including after settlement.
    stop() {
      if (stopPromise !== null) return stopPromise;
      clearInterval(timer);
      stopPromise = Promise.resolve(current);
      return stopPromise;
    },
  };
}
