// Static packaging prerequisite only. Expected RED until SE provides the real
// documented TUI entry. Never import a fixture to turn this check green.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';

test('QUAL-PRODUCT-ENTRY: production package supplies the documented tui entry', async () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  // The pinned Host.resolve uses named ./tui exports when exports exist, else
  // conventional root tui files. This is source readiness, not SDK resolution.
  const declared = manifest.exports?.['./tui'];
  const entries =
    manifest.exports === undefined
      ? ['tui.js', 'tui.ts']
      : typeof declared === 'string'
        ? [declared]
        : [declared?.import, declared?.default].filter((entry) => typeof entry === 'string');
  let found = false;
  for (const entry of entries) {
    const target = new URL(entry, root);
    assert.ok(target.href.startsWith(root.href), 'TUI entry must be in the package');
    assert.equal(
      /\/(tests|\.scratch)\//.test(target.pathname),
      false,
      'no test-only product entry',
    );
    if (
      await stat(target).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      found = true;
  }
  assert.equal(found, true, 'genuine production TUI entry is not implemented');
});
