// Static coverage is supporting evidence, not proof of host loading or model adherence.
// Contract: add-proceed-agent-skill guidance delta and design decisions 1-5.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skillPath = resolve(root, 'skills/proceed/SKILL.md');
const readSkill = () => readFile(skillPath, 'utf8');
const readReadme = () => readFile(resolve(root, 'README.md'), 'utf8');

// Lexical coverage only. The scenario review in tasks.md establishes meaning.
const tools = 'prepare_approval request_approval get_approval cancel_approval acknowledge_approval';
const literalCoverage = {
  'five tools': tools,
  'request authority': 'request_handle request_id request_capability client_request_id',
  'outcome and receipt': 'delivery_state decision_id',
  'retained recovery': 'NOT_FOUND',
  'truthful limitations': 'Events doctor retry',
};
const coverage = [
  ...Object.entries(literalCoverage).map(([group, terms]) => [
    group,
    ...terms.split(' ').map((term) => new RegExp(term)),
  ]),
  [
    'exposed contract',
    /exposed|available tool/i,
    /definition|schema/i,
    /namespace|prefix|access mode/i,
  ],
  ['request authority', /\baction\b/, /\bcontext\b/],
  [
    'outcome and receipt',
    /\bresolution\b/,
    /acknowledg/i,
    /receipt/i,
    /deduplic|at.most.once|repeated action/i,
  ],
  [
    'decision distinctions',
    /\bapproved\b/,
    /\bresponded\b/,
    /reject/i,
    /expir/i,
    /cancel/i,
    /pending/i,
    /silence|no response/i,
    /error/i,
    /instruction/i,
    /permission/i,
  ],
  [
    'retained recovery',
    /timeout|lost wait/i,
    /same.{0,40}principal/is,
    /duplicate|replacement/i,
    /block/i,
    /resum|continuation/i,
  ],
  [
    'private authority',
    /private/i,
    /credential/i,
    /Telegram/i,
    /logs?/i,
    /evidence/i,
    /human.facing|public/i,
    /label/i,
    /authenticat/i,
  ],
  ['truthful limitations', /broker/i, /pair/i, /native/i, /automatic/i],
];
function missingCoverage(text) {
  return coverage.flatMap(([group, ...patterns]) =>
    patterns.filter((pattern) => !pattern.test(text)).map((pattern) => `${group}: ${pattern}`),
  );
}

// Supported frontmatter: scalar name/flags, literal or folded description,
// and an indented metadata mapping. This is not a general YAML/host parser.
function guidanceMetadata(text) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  assert.ok(frontmatter, 'SKILL.md needs YAML frontmatter');
  assert.match(frontmatter, /^name:\s*['"]?proceed['"]?\s*$/m);
  const descriptionValue = frontmatter.match(/^description:[ \t]*([^\r\n]*)/m)?.[1];
  const description = /^[|>][+-]?(?:\s+#.*)?$/.test(descriptionValue ?? '')
    ? frontmatter.match(/^description:[^\r\n]*\r?\n((?:(?:[ \t]+[^\r\n]*|)\r?\n?)*)/m)?.[1]
    : descriptionValue;
  assert.ok(description, 'description must advertise the use case');
  for (const term of [/Telegram/i, /approval/i, /instruction/i]) assert.match(description, term);
  const metadata = frontmatter.match(/^metadata:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/m)?.[1];
  const autoinvoke = metadata?.match(
    /^[ \t]+['"]?opencode\/autoinvoke['"]?:[ \t]*(true|false)[ \t]*(?:#.*)?$/m,
  )?.[1];
  const disabled = /^disable-model-invocation:[ \t]*true[ \t]*(?:#.*)?$/m.test(frontmatter);
  // Official V2 skills guide: metadata.opencode/autoinvoke wins when both are set.
  return autoinvoke === undefined ? !disabled : autoinvoke === 'true';
}
const explicitlyLoads = /(?:explicit\w*\b.{0,40}\bload\w*|\bload\w*\b.{0,40}\bexplicit\w*)/is;

test('installable guidance: exact artifact ID, description and effective advertising', async () => {
  assert.equal(guidanceMetadata(await readSkill()), true, 'skill must be advertised');
});

test('metadata controls: multiline descriptions and documented advertising precedence', () => {
  for (const description of [
    'Telegram approval and instructions',
    '>\n  Telegram approval\n  and instructions',
    '|-\n  Telegram approval\n  and instructions',
  ]) {
    for (const [flags, advertised] of [
      ['', true],
      ['disable-model-invocation: true', false],
      ['metadata:\n  opencode/autoinvoke: false', false],
      ['disable-model-invocation: false\nmetadata:\n  opencode/autoinvoke: false', false],
      ['disable-model-invocation: true\nmetadata:\n  opencode/autoinvoke: true', true],
    ]) {
      const fixture = `---\nname: proceed\ndescription: ${description}\n${flags}\n---\n`;
      assert.equal(guidanceMetadata(fixture), advertised, flags);
    }
  }
  for (const wording of ['explicitly load the skill', 'load explicitly with @proceed'])
    assert.match(wording, explicitlyLoads);
  assert.doesNotMatch('The skill may be advertised automatically.', explicitlyLoads);
});

test('self-contained skill: no relative companion Markdown dependencies', async () => {
  const text = await readSkill();
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
    assert.ok(/^(?:https?:|#)/.test(target), `unpublished companion dependency: ${target}`);
  }
});

test('workflow coverage: public tools, outcomes, private authority and recovery', async () => {
  assert.deepEqual(missingCoverage(await readSkill()), []);
});

test('coverage checker negative controls reject missing contract terms', () => {
  // Test-only text, not production guidance and not a simulated approval result.
  for (const name of tools.split(' ')) {
    assert.ok(missingCoverage(tools.replace(name, '')).some((item) => item.includes(name)));
  }
});

test('unsafe instruction controls: no invented installer or affirmative authority bypass', async () => {
  const forbidden = [
    /\bopencode\s+skill\s+add\b/i,
    /^(?![^\n]*\b(?:not|never|don't|do not)\b)[^\n]*\b(?:paste|print|echo)\s+(?:the |your )?(?:request_capability|bot token)\b/gim,
    /^(?![^\n]*\b(?:not|never|don't|do not)\b)[^\n]*\bresponded\b[^\n]*\b(?:grants|provides)\s+approval\b/gim,
  ];
  for (const text of [await readSkill(), await readReadme()]) {
    for (const pattern of forbidden) assert.doesNotMatch(text, pattern);
  }
  // Prove the affirmative hazards above are detected, without rejecting negated warnings.
  for (const [index, text] of [
    'opencode skill add proceed',
    'Print the request_capability in the receipt.',
    'The responded outcome grants approval.',
  ].entries())
    assert.match(text, forbidden[index]);
});

test('README: source revision, project-local install, explicit load and limits', async () => {
  const text = await readReadme();
  for (const pattern of [
    /skills\/proceed\/SKILL\.md/,
    /\.opencode\/skills\/proceed\/SKILL\.md/,
    /https:\/\/github\.com\/renl\/proceed-mcp/,
    /revision|commit/i,
    /@proceed/,
    /id:\s*['"]?proceed/,
    /advertis/i,
    explicitlyLoads,
    /existing.{0,80}(?:destination|file)|(?:inspect|check).{0,80}(?:destination|overwrite)/is,
    /conflict|duplicate/i,
    /permission/i,
    /npm/i,
  ])
    assert.ok(pattern.test(text), `README coverage missing: ${pattern}`);
});

test('README: linked supported setup and harmless active-wait first use', async () => {
  const text = await readReadme();
  const anchors = new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) =>
      heading
        .toLowerCase()
        .replace(/[^\w\- ]/g, '')
        .replace(/ /g, '-'),
    ),
  );
  const links = [...text.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map(([, target]) => target);
  for (const target of links.filter((target) => target.startsWith('#'))) {
    assert.ok(anchors.has(target.slice(1)), `broken README anchor: ${target}`);
  }
  for (const anchor of [
    '#install',
    '#set-up-the-broker-and-telegram',
    '#2-add-one-owner',
    '#5-pair-the-private-chat',
    '#6-connect-an-mcp-client',
  ]) {
    assert.ok(links.includes(anchor), `link existing setup rather than duplicate it: ${anchor}`);
  }
  for (const pattern of [
    /harmless/i,
    /Approve/,
    /active|still waiting/i,
    /request_id/,
    /approved/,
    /decision_id/,
    /acknowledg/i,
    /receipt/i,
    /no.{0,100}(?:shell command|file modification)/is,
  ]) {
    assert.ok(pattern.test(text), `README first-use coverage missing: ${pattern}`);
  }
});

test('local install-copy: clean project destination preserves exact supplied bytes', async () => {
  // This exercises only documented filesystem placement, never real host discovery.
  const source = await readFile(skillPath);
  const scratch = resolve(root, '.scratch/proceed-guidance');
  await mkdir(scratch, { recursive: true });
  const fixture = await mkdtemp(resolve(scratch, 'install-'));
  try {
    const destination = resolve(fixture, '.opencode/skills/proceed/SKILL.md');
    await assert.rejects(readFile(destination), { code: 'ENOENT' });
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(skillPath, destination);
    assert.deepEqual(await readFile(destination), source);
  } finally {
    await rm(fixture, { recursive: true });
  }
});
