// TEST ONLY. Embedded-runtime capability controls, not the product operator UI.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { readFile, writeFile } from 'node:fs/promises';
import { exerciseRuntimeTransport } from '/payload/tests/support/harness-runtime-transport.mjs';

export default Plugin.define({
  id: 'proceed-transport-qualification',
  async setup(context) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    // Test-only options. Never add these options/endpoints to the product plugin.
    const { cases_file, evidence_directory } = context.options;
    if (context.app.version !== '2.2.5') throw new Error('Unqualified host runtime');
    if (cases_file !== '/run/proceed/qualification-private/cases.json')
      throw new Error('Unexpected transport plan path');
    if (evidence_directory !== '/run/proceed/evidence') throw new Error('Unexpected evidence root');
    try {
      const plan = JSON.parse(await readFile(cases_file, 'utf8'));
      const observations = await exerciseRuntimeTransport(plan, controller.signal);
      await writeFile(
        `${evidence_directory}/runtime-transport.json`,
        JSON.stringify({ scope: 'actual embedded secure-client capability only', observations }),
      );
      context.ui.toast.show({ message: 'Proceed transport controls complete', duration: 60000 });
    } finally {
      clearTimeout(timer);
    }
    return () => controller.abort();
  },
});
