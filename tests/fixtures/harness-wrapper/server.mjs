// Disposable trusted server plugin. Never packaged/imported by production.
import * as Plugin from '@opencode/plugin/promise/plugin';
import { open, writeFile } from 'node:fs/promises';
import { privateCaptureWriter } from '/payload/tests/support/harness-transparent-capture.mjs';
import {
  invokeRegisteredProceed,
  wrapperCommand,
  captureProducerLifetime,
} from '/payload/tests/support/harness-wrapper-invocation.mjs';

export default Plugin.define({
  id: 'proceed-wrapper-qualification',
  async setup(context) {
    if (context.app.version !== '2.2.5') throw new Error('Unqualified host');
    // A separate private capture, never the publishable evidence/diagnostic log.
    // It contains synthetic request capabilities, but no operator-key access.
    const file = await open('/run/proceed/qualification-private/wrapper.jsonl', 'wx', 0o600);
    let producers;
    const writer = privateCaptureWriter();
    let writes = Promise.resolve();
    const record = (event) => {
      producers.writable();
      const pending = writes.then(async () => {
        producers.writable();
        const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
        await file.writeFile(bytes);
        producers.writable();
        writer.written(bytes);
      });
      writes = pending.catch(() => writer.failed());
      return pending;
    };
    let registration;
    try {
      registration = await context.command.transform((editor) =>
        editor.add({
          name: wrapperCommand,
          description: 'Test-only registered Proceed invocation. No decision argument.',
          async execute(invocation) {
            if (!producers) throw Error('capture producer not ready');
            await producers.run((signal) =>
              invokeRegisteredProceed(context, invocation, signal, record),
            );
          },
        }),
      );
      producers = captureProducerLifetime(Date.now() + 150000);
    } catch (error) {
      await file.close();
      // No ready command producer exists. Do not synthesize a success receipt.
      throw error;
    }
    return async () => {
      await producers.close(async () => {
        await registration.dispose();
        await writes;
        await file.close();
        producers.writable();
        await writeFile(
          '/run/proceed/qualification-private/wrapper-seal.json',
          JSON.stringify(writer.seal()),
          { flag: 'wx', mode: 0o600 },
        );
      });
    };
  },
});
