// TEST ONLY. Source-backed inventory, not a requirement to disable built-ins.
import assert from 'node:assert/strict';

export const hostSource = '9bbb8ce18c80f099e0e448775f59d965ead40a21';
export const sourceURL = (path) =>
  `https://github.com/anomalyco/opencode/blob/${hostSource}/${path}`;
export const builtinOrigins = Object.freeze([
  'packages/tui/src/feature-plugins/home/footer.tsx',
  'packages/tui/src/feature-plugins/prompt/footer.tsx',
  'packages/tui/src/feature-plugins/prompt/btw.tsx',
  'packages/tui/src/feature-plugins/sidebar/context.tsx',
  'packages/tui/src/feature-plugins/sidebar/limit.tsx',
  'packages/tui/src/feature-plugins/sidebar/mcp.tsx',
  'packages/tui/src/feature-plugins/sidebar/todo.tsx',
  'packages/tui/src/feature-plugins/sidebar/footer.tsx',
  'packages/tui/src/feature-plugins/system/notifications.tsx',
  'packages/tui/src/feature-plugins/system/plugins.tsx',
  'packages/tui/src/feature-plugins/system/stats.tsx',
  '@opencode/merman/plugin',
  '@opencode/latex/plugin',
  'packages/tui/src/feature-plugins/system/diff-viewer.tsx',
]);

export function assertServiceInventory(items, { plugin }) {
  assert.ok(Array.isArray(items));
  for (const item of items) {
    if (item.source.type === 'builtin') continue;
    // The shared service inventory may describe the discovered staged TUI-only
    // entry even though it executes no server component. This is not an extra
    // user plugin. Retain and verify its actual origin/features, do not hide it.
    assert.equal(item.source.type, 'local', 'unexpected additional service plugin source');
    assert.equal(item.source.path, plugin, 'unexpected additional service plugin origin');
    assert.equal(item.features.tui, true);
    assert.notEqual(item.features.server, true);
    assert.notEqual(item.features.rpc, true);
    assert.equal(item.state.status, 'active');
  }
}

function field(line, name) {
  const match = line.match(new RegExp(`(?:^| )${name}=("(?:[^"\\\\]|\\\\.)*"|[^ ]+)`));
  assert.ok(match, `missing loader field ${name}`);
  return match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
}

// Caller must supply the complete bounded CLI plugin diagnostic selection from
// startup, not a tail. The pinned context.tsx emits each external read/load/prepare
// at DEBUG. Built-ins enter desired directly, before external target resolution.
export function assertPluginInventory(lines, { plugin, entry, complete }) {
  assert.equal(complete, true, 'truncated/missing logs cannot prove exclusive inventory');
  assert.ok(Array.isArray(lines) && lines.length <= 4096);
  const cli = lines.filter(
    (line) => /component=plugin(?: |$)/.test(line) && /role=cli(?: |$)/.test(line),
  );
  assert.ok(cli.length > 0, 'no CLI plugin diagnostics');
  assert.equal(
    cli.some((line) => /plugin operation (failed|stalled)/.test(line)),
    false,
  );
  const operations = cli
    .filter((line) => line.includes('plugin operation started'))
    .filter((line) => /stage=(?:"(?:prepare|read|load)"|prepare|read|load)(?: |$)/.test(line));
  assert.ok(operations.length > 0, 'no runtime external-entry origins observed');
  const origins = operations.map((line) => {
    const stage = field(line, 'stage');
    const target = field(line, 'target');
    assert.equal(stage, 'read', 'only the staged local external plugin may be loaded');
    assert.equal(target, plugin, 'unexpected additional external target');
    const entrypoint = field(line, 'entrypoint');
    assert.equal(entrypoint, entry, 'unexpected external entry origin');
    return { stage, target, entrypoint };
  });
  const counts = cli
    .filter((line) => line.includes('plugin reconciliation completed'))
    .map((line) => Number(field(line, 'plugins')));
  assert.ok(counts.length > 0, 'no completed reconciliation');
  for (const count of counts)
    assert.equal(count, builtinOrigins.length + 1, 'unexpected desired plugin inventory');
  return {
    source: hostSource,
    loader: sourceURL('packages/tui/src/plugin/context.tsx'),
    builtinsSource: sourceURL('packages/tui/src/plugin/builtins.ts'),
    builtinOrigins,
    externalOrigins: origins,
    reconciliationCounts: counts,
    scope: 'Pinned built-ins plus exactly the staged external entry. Not a built-in safety audit.',
  };
}
