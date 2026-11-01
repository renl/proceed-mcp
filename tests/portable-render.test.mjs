// Candidate presentation binding: pending Architect review, not product authority.
// Test-only oracle; production must never import this file.
import assert from 'node:assert/strict';
import test from 'node:test';

const load = () => import('../src/telegram/portable-render.js');
const resolutions = Object.freeze({
  pending: 'pending', approved: 'approved', rejected: 'rejected',
  responded: 'responded (instructions only)', expired: 'expired', cancelled: 'cancelled',
});
const deliveries = Object.freeze({
  not_applicable: 'not_applicable', pending: 'pending', returned: 'returned',
  confirmed: 'confirmed', unavailable: 'unavailable', blocked: 'blocked',
});
const base = (extra = {}) => ({
  request_id: `req_${'1'.repeat(32)}`, owner_id: 'owner_a', session_label: 'caller',
  action: 'deploy', context: 'reviewed change', expires_at: '2026-11-01T01:00:00.000Z',
  resolution: 'pending', delivery_state: 'not_applicable', ...extra,
});
// Explicit lines rather than a production renderer/helper as the expected value.
const requestText = (r) => [
  `Approval request ${r.request_id}`, '', `Owner: ${r.owner_id}`,
  `Caller-supplied context (display only, not verified identity): ${r.session_label}`,
  `Action: ${r.action}`, `Context: ${r.context === '' ? '(none)' : r.context}`,
  `Expires: ${r.expires_at}`, `Resolution: ${resolutions[r.resolution]}`,
  `Delivery: ${deliveries[r.delivery_state]}`,
].join('\n');
const replyText = (r) => [
  `Respond to request ${r.request_id}`, '',
  'Reply to this message with instructions for this request only.',
  'Your reply is instructions, not approval: any action that still needs approval',
  'requires a separate request.',
].join('\n');
const units = (s) => Buffer.byteLength(s, 'utf16le') / 2;
const variants = (r) => [base({ ...r, resolution: 'pending', delivery_state: 'not_applicable' }),
  ...Object.keys(resolutions).filter((x) => x !== 'pending').flatMap((resolution) =>
    Object.keys(deliveries).filter((x) => x !== 'not_applicable').map((delivery_state) =>
      ({ ...r, resolution, delivery_state })))];
const expected = (r) => {
  const request = Math.max(...variants(r).map((v) => units(requestText(v))));
  const reply_prompt = units(replyText(r));
  return { request, reply_prompt, worst: request >= reply_prompt
    ? { kind: 'request', length: request } : { kind: 'reply_prompt', length: reply_prompt } };
};

test('PORT-RENDER-ORACLE: independently enumerate fixed overhead and maxima', () => {
  const empty = base({ request_id: '', owner_id: '', session_label: '', action: '',
    context: 'x', expires_at: '' });
  const literals = ['Approval request ', '', 'Owner: ',
    'Caller-supplied context (display only, not verified identity): ', 'Action: ', 'Context: ',
    'Expires: ', 'Resolution: ', 'Delivery: '];
  const overhead = literals.reduce((n, s) => n + units(s), 8);
  assert.equal(overhead, 143);
  assert.equal(units(requestText(empty)), overhead + 1 + 7 + 14);
  assert.equal(Math.max(...Object.values(resolutions).map(units)), 29);
  assert.equal(Math.max(...Object.values(deliveries).map(units)), 14);
  assert.equal(Math.max(...Object.values(deliveries).slice(1).map(units)), 11);
  assert.equal(expected(empty).request, overhead + 1 + 29 + 11);
  assert.equal(replyText(empty).length, 191);
  assert.equal(expected(base()).reply_prompt, 227);
  assert.equal(expected(base()).request - units(requestText(base())), 19);
  for (const [length, context, scalars] of [
    [4096, '😀'.repeat(830) + 'x', 831], [4097, '😀'.repeat(831), 831],
  ]) {
    const r = base({ owner_id: 'o'.repeat(64), session_label: 's'.repeat(128),
      action: '😀'.repeat(1000), context });
    assert.equal([...context].length, scalars);
    assert.equal(expected(r).request, length);
    assert.equal(length - units(context), 2435);
    assert.ok([...requestText({ ...r, resolution: 'responded', delivery_state: 'unavailable' })].length < 4096);
  }
});

test('PORT-RENDER-EXPORTS: exact portable frozen label maps and limit', async () => {
  const p = await load();
  assert.equal(p.MAX_TELEGRAM_TEXT, 4096);
  for (const [actual, wanted] of [[p.PORTABLE_RESOLUTION_LABELS, resolutions],
    [p.PORTABLE_DELIVERY_LABELS, deliveries]]) {
    assert.deepEqual(actual, wanted);
    assert.ok(Object.isFrozen(actual));
    assert.throws(() => { actual.pending = 'changed'; }, TypeError);
  }
});

test('PORT-RENDER-LAYOUT: all 26 permitted presentations preserve full fields', async () => {
  const p = await load();
  const r = base({ owner_id: 'o'.repeat(64), session_label: '😀'.repeat(128),
    action: 'a'.repeat(1000), context: 'c'.repeat(1000),
    request_capability: 'SECRET_CAPABILITY', capability_hash: 'SECRET_HASH',
    pairing_snapshot: { user_id: 'PRIVATE_USER', chat_id: 'PRIVATE_CHAT', paired_at: 'PRIVATE_TIME' },
    origin_id: 'LEGACY_ORIGIN', session_id: 'LEGACY_SESSION', callback_token: 'PRIVATE_TOKEN' });
  assert.equal(variants(r).length, 26);
  for (const v of variants(r)) {
    const actual = p.renderPortableRequestMessage(v);
    assert.equal(actual, requestText(v));
    assert.doesNotMatch(actual, /SECRET_|PRIVATE_|LEGACY_|origin_id|session_id/);
  }
  assert.equal(p.renderPortableReplyPrompt(r), replyText(r));
});

test('PORT-RENDER-MEASURE: terminal maximum, not pending-only or current-only', async () => {
  const p = await load();
  const r = base();
  assert.equal(expected(r).request - units(requestText(r)), 19);
  for (const v of variants(r)) assert.deepEqual(p.measurePortablePresentation(v), expected(r));
  assert.equal(p.renderPortableRequestMessage(r), requestText(r));
});

for (const limit of [4096, 4097]) {
  test(`PORT-RENDER-BOUND-${limit}: full UTF-16 length versus scalar-only admission`, async () => {
    const p = await load();
    const r = base({ owner_id: 'o'.repeat(64), session_label: 's'.repeat(128),
      action: '😀'.repeat(1000), context: 'x' });
    const overhead = expected(r).request - 1;
    const remaining = limit - overhead;
    r.context = '😀'.repeat(Math.floor(remaining / 2)) + (remaining % 2 ? 'x' : '');
    assert.ok([...r.context].length <= 1000 && remaining > 0);
    assert.equal(expected(r).request, limit);
    assert.deepEqual(p.measurePortablePresentation(r), expected(r));
    const longest = { ...r, resolution: 'responded', delivery_state: 'unavailable' };
    assert.equal(units(p.renderPortableRequestMessage(longest)), limit);
    assert.ok([...requestText(longest)].length < 4096);
    // Render/measure only: even 4097 renders intact; broker rejection is later.
    assert.equal(p.renderPortableRequestMessage(longest), requestText(longest));
  });
}

test('PORT-RENDER-TEXT: no JSON/markup escaping, normalization or trimming', async () => {
  const p = await load();
  const r = base({ action: '  "\\\n<&>*_[😀]  ', context: 'e\u0301\né\t\\"' });
  assert.notEqual(JSON.stringify(r.action).length - 2, r.action.length);
  assert.notEqual(r.context.normalize('NFC'), r.context);
  assert.equal(p.renderPortableRequestMessage(r), requestText(r));
  assert.deepEqual(p.measurePortablePresentation(r), expected(r));
  const astral = base({ action: '😀' });
  const ascii = base({ action: 'x' });
  assert.equal(p.measurePortablePresentation(astral).request,
    p.measurePortablePresentation(ascii).request + 1);
});

test('PORT-RENDER-EMPTY: placeholder contributes six units rather than zero', async () => {
  const p = await load();
  const r = base({ context: '' });
  assert.equal(p.renderPortableRequestMessage(r), requestText(r));
  assert.deepEqual(p.measurePortablePresentation(r), expected(r));
  assert.equal(p.measurePortablePresentation(r).request,
    p.measurePortablePresentation(base({ context: 'x' })).request + 5);
});

test('PORT-RENDER-TIME: preserve long accepted UTC spelling without canonicalization', async () => {
  const p = await load();
  const short = base({ expires_at: '2026-11-01T01:00:00Z' });
  const long = base({ expires_at: `2026-11-01T01:00:00.${'0'.repeat(100)}+00:00` });
  assert.equal(p.renderPortableRequestMessage(long), requestText(long));
  assert.deepEqual(p.measurePortablePresentation(long), expected(long));
  assert.equal(p.measurePortablePresentation(long).request -
    p.measurePortablePresentation(short).request, 106);
});

test('PORT-RENDER-REPLY: exact full-ID prompt, independent of private/request text', async () => {
  const p = await load();
  const r = base({ action: 'PRIVATE_ACTION', context: 'PRIVATE_CONTEXT', response_text: 'approved' });
  const prompt = p.renderPortableReplyPrompt(r);
  assert.equal(prompt, replyText(r));
  assert.match(prompt, /instructions, not approval/);
  assert.doesNotMatch(prompt, /PRIVATE_|approved/);
  assert.equal(p.measurePortablePresentation(r).reply_prompt, units(prompt));
});

test('PORT-RENDER-PURITY: frozen input and nested private data remain unchanged', async () => {
  const p = await load();
  const r = Object.freeze(base({ pairing_snapshot: Object.freeze({ chat_id: 'private' }) }));
  const before = JSON.stringify(r);
  p.renderPortableRequestMessage(r); p.renderPortableReplyPrompt(r);
  p.measurePortablePresentation(r);
  assert.equal(JSON.stringify(r), before);
});
