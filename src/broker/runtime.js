// Broker process assembly: protected-state recovery, exclusive loopback
// ownership, authenticated API, Telegram service and delivery worker
// (design sections 1, 4 and 7).
import { readFile, rm, stat } from 'node:fs/promises';
import { TELEGRAM_TOKEN_ENV } from '../config/config.js';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { Journal } from '../journal/journal.js';
import { createOriginClient } from '../opencode/client.js';
import { verifyOwnerOnly } from '../state/protection.js';
import { readLocalCredential } from '../state/credentials.js';
import { writeFileAtomically } from '../state/files.js';
import { createTelegramClient } from '../telegram/client.js';
import { createTelegramService } from '../telegram/poller.js';
import { createBroker } from './broker.js';
import { createBrokerServer } from './server.js';
import { createDeliveryWorker } from './delivery.js';
import { utcTimestamp } from '../util/values.js';

const EXPIRY_SWEEP_MS = 1_000;

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause?.code === 'EPERM';
  }
}

export async function startBrokerRuntime({
  paths,
  config,
  env,
  clock = () => Date.now(),
  logger = () => {},
}) {
  const secrets = [];
  try {
    const protectedTargets = [paths.stateDir, paths.credentialsDir, paths.configFile];
    if ((await stat(paths.journalFile).catch(() => null)) !== null)
      protectedTargets.push(paths.journalFile);
    await verifyOwnerOnly(protectedTargets);

    const control = await readLocalCredential(
      paths.controlCredentialFile,
      'the control credential',
    );
    const origins = new Map();
    const clients = new Map();
    for (const binding of config.origins) {
      const originCredential = await readLocalCredential(
        paths.originCredentialFile(binding.origin_id),
        `the credential for origin ${binding.origin_id}`,
      );
      origins.set(binding.origin_id, originCredential);
      const password = env[binding.password_env];
      if (typeof password !== 'string' || password === '') {
        throw blockedPrerequisite(
          `origin ${binding.origin_id} needs its password in the environment variable ${binding.password_env}`,
          'ORIGIN_PASSWORD_MISSING',
        );
      }
      secrets.push(password);
      clients.set(binding.origin_id, createOriginClient({ url: binding.url, password }));
    }

    const telegramToken = env[TELEGRAM_TOKEN_ENV];
    if (typeof telegramToken !== 'string' || telegramToken === '') {
      throw blockedPrerequisite(
        `the Telegram bot token must be provided in ${TELEGRAM_TOKEN_ENV}`,
        'TELEGRAM_TOKEN_MISSING',
      );
    }
    secrets.push(telegramToken);

    const broker = createBroker({ paths, config, clients, clock, logger });
    const server = createBrokerServer({
      broker,
      credentials: { control, origins },
      port: config.broker.port,
      logger,
    });

    try {
      await server.listen();
    } catch (cause) {
      if (cause?.code === 'EADDRINUSE' || cause?.code === 'EACCES') {
        throw blockedPrerequisite(
          `the broker port ${config.broker.port} is owned by another process; stop it first`,
          'BROKER_PORT_UNAVAILABLE',
        );
      }
      throw storageFailure('the broker could not bind its loopback port', 'STORAGE_FAILURE', cause);
    }

    let journal = null;
    let telegramService = null;
    let delivery = null;
    let sweep = null;
    try {
      journal = await Journal.open(paths.journalFile);
      broker.attachJournal(journal);
      await broker.recover();
      await verifyOwnerOnly([paths.stateDir, paths.credentialsDir, paths.journalFile]);

      await acquireOwnershipRecord(paths, config, logger);

      const telegram = createTelegramClient({ token: telegramToken });
      telegramService = createTelegramService({ broker, telegram, clock, logger });
      delivery = createDeliveryWorker({ broker, clock, logger });

      server.markReady();
      delivery.start();
      telegramService.start();
      sweep = setInterval(() => {
        broker.expireDueRequests().catch(() => {});
      }, EXPIRY_SWEEP_MS);
      sweep.unref?.();
    } catch (error) {
      // A partially assembled broker must release its port and files before the
      // command reports the failure; nothing may keep the event loop alive.
      if (sweep !== null) clearInterval(sweep);
      await telegramService?.stop().catch(() => {});
      await delivery?.stop().catch(() => {});
      await server.close().catch(() => {});
      await broker.close().catch(() => {});
      await journal?.close().catch(() => {});
      await rm(paths.brokerLockFile, { force: true }).catch(() => {});
      throw error;
    }

    let stopped = false;
    return {
      broker,
      port: config.broker.port,
      journalSequence: journal.sequence,
      ready: true,
      async stop() {
        if (stopped) return;
        stopped = true;
        if (sweep !== null) clearInterval(sweep);
        await telegramService.stop().catch(() => {});
        await delivery.stop().catch(() => {});
        await server.close().catch(() => {});
        await broker.close();
        await rm(paths.brokerLockFile, { force: true }).catch(() => {});
      },
    };
  } finally {
    // Credentials are held only in memory; nothing is written from this array.
    secrets.length = 0;
  }
}

// The ownership record is informational for "broker is stopped" checks. The
// real mutual exclusion is the exclusive loopback port above, so a record left
// by a terminated process is replaced only after that port was acquired.
async function acquireOwnershipRecord(paths, config, logger) {
  const existing = await readFile(paths.brokerLockFile, 'utf8').catch(() => null);
  if (existing !== null) {
    let record = null;
    try {
      record = JSON.parse(existing);
    } catch {
      logger('broker.lock was unreadable and will be replaced');
    }
    if (Number.isInteger(record?.pid) && record.pid !== process.pid && processIsAlive(record.pid)) {
      throw blockedPrerequisite(
        `a broker is already running for this state directory (pid ${record.pid})`,
        'BROKER_RUNNING',
      );
    }
  }
  await writeFileAtomically(
    paths.brokerLockFile,
    `${JSON.stringify({
      schema_version: 1,
      pid: process.pid,
      port: config.broker.port,
      started_at: utcTimestamp(),
    })}\n`,
  );
}
