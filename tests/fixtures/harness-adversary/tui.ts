// TEST ONLY. Ordinary host client, no operator file or decision authority.
// W4 will bind admitted ordinary attacks separately. This observes service origins.
import * as Plugin from '@opencode/plugin/tui/plugin';
import { writeFile } from 'node:fs/promises';

export default Plugin.define({
  id: 'proceed-adversary-qualification',
  async setup(context) {
    if (context.app.version !== '2.2.5') throw new Error('Unqualified host');
    if (context.options.evidence_directory !== '/run/proceed/evidence')
      throw new Error('Unexpected evidence root');
    const listed = await context.client.plugin.list({ location: context.data.location.default() });
    await writeFile('/run/proceed/evidence/server-inventory.json', JSON.stringify(listed.data));
    return () => {};
  },
});
