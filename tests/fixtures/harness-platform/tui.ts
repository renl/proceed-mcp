// TEST ONLY. Actual OpenCode 2.2.5 TUI plugin, never a product dependency.
// Host loading and rendered keyboard execution remain UNRUN until preflight gates close.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { appendFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export default Plugin.define({
  id: 'proceed.qualification',
  setup(context) {
    if (context.app.version !== '2.2.5') throw new Error('Pinned host version required');
    const directory = context.options.evidence_directory;
    if (typeof directory !== 'string' || !isAbsolute(directory))
      throw new Error('Run-owned evidence directory required');
    // The runner creates this directory. Do not create or default to an external path.
    const evidence = join(realpathSync(directory), 'fixture.jsonl');
    let active = true;
    let busy = false;
    let invocation = 0;
    const record = (event: {
      phase: string;
      id?: number;
      version?: string;
      choice?: string;
      text?: string;
    }) => appendFileSync(evidence, `${JSON.stringify(event)}\n`);
    record({ phase: 'setup', version: context.app.version });
    context.ui.toast.show({ message: 'Proceed platform ready', duration: 60000 });
    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'proceed.qualification.open',
          title: 'Open qualification dialog',
          bind: 'ctrl+g',
          run: async () => {
            if (!active || busy) return;
            busy = true;
            const id = ++invocation;
            try {
              // This event is NOT rendered readiness. The PTY must also see the title.
              record({ phase: 'select-requested', id });
              const choice = await context.ui.dialog.select({
                title: `Proceed qualification ${id}`,
                current: 'reject',
                options: [
                  { title: 'Reject', value: 'reject' },
                  { title: 'Respond', value: 'respond' },
                  { title: 'Approve', value: 'approve' },
                ],
              });
              if (!active) return;
              if (choice === undefined) {
                record({ phase: 'dismissed', id });
                return;
              }
              if (choice === 'respond') {
                record({ phase: 'prompt-requested', id });
                const text = await context.ui.dialog.prompt({
                  title: `Proceed response ${id}`,
                  description: 'Qualification text only. This does not resolve product work.',
                });
                if (!active) return;
                record(
                  text === undefined
                    ? { phase: 'dismissed', id }
                    : { phase: 'result', id, choice, text },
                );
                return;
              }
              record({ phase: 'result', id, choice });
            } finally {
              busy = false;
            }
          },
        },
      ],
      bindings: ['proceed.qualification.open'],
    }));
    // Real Cleanup, not a stored/captured callback invoked by a mock host.
    return () => {
      active = false;
      record({ phase: 'cleanup' });
    };
  },
});
