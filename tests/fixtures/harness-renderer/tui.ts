// TEST ONLY. Fixture choices confer no authority and create no product work.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { appendFileSync, writeFileSync } from 'node:fs';

export default Plugin.define({
  id: 'synthetic.renderer.calibration',
  async setup(context) {
    const directory = context.options.evidence_directory;
    if (directory !== '/run/proceed/evidence') throw new Error('Owned evidence required');
    const record = (value: object) =>
      appendFileSync(`${directory}/fixture.jsonl`, JSON.stringify(value) + '\n');
    const inventory = await context.client.plugin.list({
      location: context.location ?? context.data.location.default(),
    });
    writeFileSync(`${directory}/inventory.json`, JSON.stringify(inventory.data));
    record({
      phase: 'setup',
      version: context.app.version,
      pid: process.pid,
      bun: process.versions.bun,
      themeMode: context.themeMode,
      theme: context.theme,
    });
    let busy = false;
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'synthetic.renderer.open',
          title: 'Open synthetic renderer calibration',
          bind: 'ctrl+g',
          run: async () => {
            if (busy) return;
            busy = true;
            try {
              record({ phase: 'opening' });
              const choice = await context.ui.dialog.select({
                title: 'SYNTHETIC RENDERER ONLY - grants nothing',
                current: 'alpha',
                options: [
                  { title: '1 SYNTHETIC ALPHA', value: 'alpha' },
                  { title: '2 SYNTHETIC BETA', value: 'beta' },
                ],
                actions: [
                  {
                    bind: 'ctrl+y',
                    title: 'Observe fixture cursor',
                    onTrigger: (value) => record({ phase: 'cursor', value }),
                  },
                ],
              });
              record({ phase: choice === undefined ? 'dismissed' : 'fixture-choice', choice });
            } finally {
              busy = false;
            }
          },
        },
      ],
      bindings: ['synthetic.renderer.open'],
    }));
    context.ui.toast.show({ message: 'SYNTHETIC renderer ready', duration: 60000 });
    return () => record({ phase: 'cleanup' });
  },
});
