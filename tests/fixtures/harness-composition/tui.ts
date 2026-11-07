// TEST ONLY. Public plugin lifecycle wrapper, unchanged real host context/options.
// The exact packaged ./tui entry owns commands, key loading and private helper.
import * as Plugin from '@opencode/plugin/tui/plugin';
import product from '@meshimize/proceed-mcp/tui';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export default Plugin.define({
  id: product.id,
  async setup(context) {
    let phase = 'product-setup';
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
      phase = 'public-command-eligibility';
      const deadline = Date.now() + 60000;
      let eligible = false;
      while (Date.now() < deadline) {
        // Read-only public host selectors, never dispatch/run or synthetic keys.
        const command = context.keymap
          .commands()
          .find((item) => item.id === 'proceed.harness.open');
        eligible =
          !!command &&
          command.title === 'Proceed harness: open the pending question for a session' &&
          (typeof command.enabled === 'function' ? command.enabled() : command.enabled !== false) &&
          context.keymap
            .active()
            .some((item) => item.key === 'ctrl+g' && item.title === command.title);
        if (eligible) break;
        await delay(20);
      }
      if (!eligible) throw new Error('Public command not eligible');
      await writeFile(
        '/run/proceed/evidence/composition-ready.json',
        JSON.stringify({
          session: session.id,
          version: context.app.version,
          bun: process.versions.bun,
          node: process.versions.node,
          commandEligible: eligible,
        }),
      );
      return async () => {
        await cleanup();
        await writeFile(
          '/run/proceed/evidence/composition-cleanup.json',
          JSON.stringify({
            productCleanup: 'PASS',
          }),
        );
      };
    } catch {
      await writeFile(
        '/run/proceed/evidence/composition-fixture-failure.json',
        JSON.stringify({ phase }),
      );
      throw new Error('COMPOSITION_FIXTURE_FAILURE');
    }
  },
});
