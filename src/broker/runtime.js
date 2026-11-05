// Broker process assembly: exclusive state-directory ownership, protected-state
// recovery, authenticated loopback API, Telegram service and delivery worker
// (design sections 1, 4 and 7).
import { stat } from 'node:fs/promises';
import { TELEGRAM_TOKEN_ENV } from '../config/config.js';
import { blockedPrerequisite, storageFailure } from '../errors.js';
import { Journal } from '../journal/journal.js';
import { createOriginClient } from '../opencode/client.js';
import { verifyOwnerOnly } from '../state/protection.js';
import { readLocalCredential } from '../state/credentials.js';
import { acquireStateOwnership } from '../state/ownership.js';
import { createTelegramClient } from '../telegram/client.js';
import { createTelegramService } from '../telegram/poller.js';
import { createBroker } from './broker.js';
import { createBrokerServer } from './server.js';
import { createDeliveryWorker } from './delivery.js';

const EXPIRY_SWEEP_MS = 1_000;

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

    // State ownership is exclusive and independent of the configured port, and
    // it is acquired before the journal is opened for recovery or replay. A
    // refusal here leaves the existing record and journal bytes untouched.
    const ownership = await acquireStateOwnership({
      lockFile: paths.brokerLockFile,
      port: config.broker.port,
    });

    let broker = null;
    let server = null;
    let journal = null;
    let telegramService = null;
    let delivery = null;
    let sweep = null;
    try {
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

      broker = createBroker({ paths, config, clients, clock, logger });
      server = createBrokerServer({
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
        throw storageFailure(
          'the broker could not bind its loopback port',
          'STORAGE_FAILURE',
          cause,
        );
      }

      journal = await Journal.open(paths.journalFile);
      broker.attachJournal(journal);
      await broker.recover();
      await verifyOwnerOnly([paths.stateDir, paths.credentialsDir, paths.journalFile]);

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
      // A partially assembled broker must release its port, its journal
      // activity and its own ownership record before the command reports the
      // failure; nothing may keep the event loop alive.
      if (sweep !== null) clearInterval(sweep);
      await telegramService?.stop().catch(() => {});
      await delivery?.stop().catch(() => {});
      await server?.close().catch(() => {});
      await broker?.close().catch(() => {});
      await journal?.close().catch(() => {});
      await ownership.release().catch(() => {});
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
        // Closing the broker stops journal activity; only then may this
        // invocation release the record bearing its own identity.
        await broker.close();
        await ownership.release().catch((error) => {
          logger(
            `the ownership record was not released: ${error?.message ?? 'unknown error'}; remove it only after verifying this broker has stopped`,
          );
        });
      },
    };
  } finally {
    // Credentials are held only in memory; nothing is written from this array.
    secrets.length = 0;
  }
}
