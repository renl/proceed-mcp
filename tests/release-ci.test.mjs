// TEST ONLY. Conservative text guards, not a YAML parser or GitHub execution proof.
// Contract: npm-distribution non-publishing PR validation, design section 8.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function unprivileged(text) {
  // Reject even comments mentioning these constructs. False positives require review,
  // not weakening this guard to claim a complete workflow security analysis.
  assert.doesNotMatch(text, /pull_request_target|workflow_run|workflow_call/);
  assert.doesNotMatch(text, /secrets\s*[.\[]|secrets\s*:|inherit\b/i);
  assert.doesNotMatch(text, /id-token\s*:|write-all|:\s*write\b/i);
  assert.doesNotMatch(text, /npm\s+(?:publish|dist-tag)|NPM_TOKEN|NODE_AUTH_TOKEN/i);
  assert.doesNotMatch(text, /release\.yml|environment\s*:|self-hosted/i);
}

test('PR text guard calibration accepts unprivileged excerpt and rejects hazards', () => {
  const safe = 'on: [pull_request]\npermissions:\n  contents: read\njobs: {}\n';
  assert.doesNotThrow(() => unprivileged(safe));
  const hazards = [
    'on: pull_request_target', 'on: workflow_run', 'on: workflow_call',
    '${{ secrets.NPM_TOKEN }}', "${{ secrets['TOKEN'] }}", 'secrets: inherit',
    'id-token: write', 'permissions: write-all', 'packages: write',
    'run: npm publish checked.tgz', 'run: npm dist-tag add x latest',
    'NODE_AUTH_TOKEN: value', 'uses: ./.github/workflows/release.yml',
    'environment: npm-preview', 'runs-on: self-hosted',
  ];
  for (const hazard of hazards) {
    assert.throws(() => unprivileged(`${safe}${hazard}\n`), undefined, hazard);
  }
});

test('PR workflow exists and passes conservative credential/publication text guard', async () => {
  const text = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  unprivileged(text);
  assert.match(text, /\bpull_request\b/, 'unprivileged PR trigger required');
  assert.match(text, /contents\s*:\s*read\b/, 'explicit read-only source permission required');
  assert.match(text, /windows-/, 'initial installed Windows qualification required');
  assert.match(text, /scripts\/build\.mjs/, 'maintained build required');
  assert.match(text, /tests\/release-pack\.mjs/, 'maintained installed package runner required');
});
