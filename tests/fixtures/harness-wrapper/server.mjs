// Disposable trusted server plugin. Never packaged/imported by production.
import * as Plugin from '@opencode/plugin/promise/plugin';
import { open, writeFile } from 'node:fs/promises';
import { privateCaptureWriter } from '/payload/tests/support/harness-transparent-capture.mjs';
import {
  invokeRegisteredProceed,
  wrapperCommand,
} from '/payload/tests/support/harness-wrapper-invocation.mjs';

export default Plugin.define({
  id: 'proceed-wrapper-qualification',
  async setup(context) {
    if (context.app.version !== '2.2.5') throw new Error('Unqualified host');
    // A separate private capture, never the publishable evidence/diagnostic log.
    // It contains synthetic request capabilities, but no operator-key access.
    const file = await open('/run/proceed/qualification-private/wrapper.jsonl', 'wx', 0o600);
    const controller = new AbortController();
    const active = new Set();
    const writer = privateCaptureWriter();
    let writes = Promise.resolve();
    const record = (event) => {
      const pending = writes.then(async () => {
        const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
        await file.writeFile(bytes);
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
            const task = invokeRegisteredProceed(context, invocation, controller.signal, record);
            active.add(task);
            try {
              await task;
            } finally {
              active.delete(task);
            }
          },
        }),
      );
    } catch (error) {
      controller.abort();
      await file.close();
      await writeFile(
        '/run/proceed/qualification-private/wrapper-seal.json',
        JSON.stringify(writer.seal()),
        { flag: 'wx', mode: 0o600 },
      );
      throw error;
    }
    const timer = setTimeout(
      () => controller.abort(new Error('Qualification invocation deadline')),
      150000,
    );
    return async () => {
      controller.abort();
      clearTimeout(timer);
      await registration.dispose();
      await Promise.allSettled([...active]);
      await writes;
      await file.close();
      await writeFile(
        '/run/proceed/qualification-private/wrapper-seal.json',
        JSON.stringify(writer.seal()),
        { flag: 'wx', mode: 0o600 },
      );
    };
  },
});
