// TEST ONLY. Public plugin lifecycle wrapper, unchanged real host context/options.
// The exact packaged ./tui entry owns commands, key loading and private helper.
import * as Plugin from '@opencode/plugin/tui/plugin';
import product from '@meshimize/proceed-mcp/tui';
import { writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { observeCompositionSelectors } from '/payload/tests/support/harness-composition-readiness.mjs';

export default Plugin.define({
  id: product.id,
  async setup(context) {
    let phase = 'product-setup';
    const root = '/run/proceed/evidence/';
    const { run } = JSON.parse(readFileSync(root + 'composition-binding.json', 'utf8'));
    const generation = randomUUID();
    let resizeSequence = 0;
    let live = true,
      timer;
    const publish = () =>
      writeFileSync(
        root + 'composition-live.json',
        JSON.stringify({
          run,
          generation,
          live,
          geometry: {
            width: context.renderer?.width,
            height: context.renderer?.height,
            resizeSequence,
          },
        }),
      );
    const resized = () => {
      resizeSequence++;
      publish();
    };
    context.renderer?.on('resize', resized);
    publish();
    try {
      const cleanup = await product.setup(context);
      if (typeof cleanup !== 'function') throw new Error('Product setup refused');
      phase = 'public-session-create';
      const created = await context.client.session.create({
        title: 'Composition empty exchange',
      });
      const session = created.data ?? created;
      if (typeof session.id !== 'string') throw new Error('Public session creation refused');
      phase = 'host-session-sync';
      await context.data.session.sync(session.id);
      if (!context.data.session.get(session.id)) throw new Error('Host session unresolved');
      // Fixed-purpose evidence observation only. No command dispatch, callback,
      // decision, or product hook. Requests are written after a completed frame.
      phase = 'public-command-eligibility';
      let last;
      const deadline = Date.now() + 60000;
      timer = setInterval(() => {
        if (!live || Date.now() >= deadline) {
          clearInterval(timer);
          return;
        }
        try {
          const request = JSON.parse(
            readFileSync(root + 'composition-selector-request.json', 'utf8'),
          );
          if (request.run !== run || request.generation !== generation || request.request === last)
            return;
          last = request.request;
          const observation = observeCompositionSelectors(context, session.id);
          if (!live) return;
          writeFileSync(
            root + 'composition-selector-response.json',
            JSON.stringify({ run, generation, request: request.request, live, ...observation }),
          );
        } catch {
          /* Incomplete/missing evidence refuses readiness. */
        }
      }, 20);
      await writeFile(
        '/run/proceed/evidence/composition-ready.json',
        JSON.stringify({
          session: session.id,
          version: context.app.version,
          bun: process.versions.bun,
          node: process.versions.node,
          run,
          generation,
        }),
      );
      return async () => {
        // Fence at Cleanup ENTRY before any asynchronous product cleanup.
        live = false;
        context.renderer?.off('resize', resized);
        clearInterval(timer);
        publish();
        await cleanup();
        await writeFile(
          '/run/proceed/evidence/composition-cleanup.json',
          JSON.stringify({
            productCleanup: 'PASS',
          }),
        );
      };
    } catch {
      live = false;
      context.renderer?.off('resize', resized);
      clearInterval(timer);
      publish();
      await writeFile(
        '/run/proceed/evidence/composition-fixture-failure.json',
        JSON.stringify({ phase }),
      );
      throw new Error('COMPOSITION_FIXTURE_FAILURE');
    }
  },
});
