// TEST ONLY. Scripted frames prove observer refusal, not actual host rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIdentityMessage,
  highlightedOrdinal,
  assertCurrentIdentityFrame,
  confirmRenderedNavigation,
} from './support/harness-navigation-observation.mjs';

const session = {
  ordinal: 'Session 2',
  title: 'EqualLongTitle'.repeat(5),
  id: 'ses_' + 'a'.repeat(60),
};
const wrap = (s) => s.match(/.{1,40}/g).join('\n');
const message = (s = session) =>
  [
    s.ordinal,
    'Navigation only - no decision',
    'Title:',
    wrap(s.title),
    '',
    'Exact session ID:',
    wrap(s.id),
  ].join('\n');
const geometry = { width: 100, height: 50, resizeSequence: 0 };
const frame = (s = session) =>
  ['Open Proceed question?', message(s), '', 'Open question   Cancel'].join('\n');
const picker =
  'Select the Proceed session\n    Session 1 equal preview\n\u2503    Session 2 equal preview';

test('lossless labelled blocks reconstruct full title and exact ID, not prefix/includes', () => {
  assert.ok(assertIdentityMessage(message(), session) > 0);
  assert.doesNotThrow(() => assertCurrentIdentityFrame(frame(), session, geometry));
  for (const altered of [
    message().replace('Title:', 'Preview:'),
    message().replace('Exact session ID:', 'Hidden value:'),
    message().replace('ses_', 'ses_x'),
    message().replace('EqualLong', 'EqualShort'),
    message() + 'x',
    message().replace('Navigation only - no decision', 'Approve'),
    message().replace('Title:', '\x1b[31mTitle:'),
  ])
    assert.throws(() => assertIdentityMessage(altered, session));
  for (const altered of [
    frame().replace('Cancel', ''),
    frame({ ...session, id: session.id + 'x' }),
    picker + '\n' + frame(),
    'Old confirmation\n' + message(),
  ])
    assert.throws(() => assertCurrentIdentityFrame(altered, session, geometry));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 79, height: 50 }));
  assert.throws(() => assertCurrentIdentityFrame(frame(), session, { width: 80, height: 24 }));
});

test('live selection bar, not current dot or text elsewhere, identifies the unique ordinal', () => {
  assert.equal(highlightedOrdinal(picker), 'Session 2');
  for (const altered of [
    '',
    picker.replace('\u2503', '\u25cf'),
    picker.replace('\u2503', ' '),
    picker + '\n\u2503    Session 1',
    picker + '\nOpen Proceed question?',
  ])
    assert.throws(() => highlightedOrdinal(altered));
});

async function control(mutate = () => {}) {
  const writes = [];
  const selected = { frame: picker, token: 10 };
  const confirmed = { frame: frame(), token: 20, geometry };
  let stage = 'picker';
  const driver = {
    stdin: { write: (key) => writes.push(key) },
    waitHighlightedSession: async () => selected,
    waitIdentityConfirmation: async () => {
      stage = 'confirmation';
      return confirmed;
    },
    currentNavigationFrame: async () => {
      const observation = structuredClone(stage === 'picker' ? selected : confirmed);
      mutate(observation, stage);
      return observation;
    },
  };
  let error;
  try {
    await confirmRenderedNavigation(driver, session);
  } catch (caught) {
    error = caught;
  }
  return { writes, error };
}

test('current interaction positive requires two separate navigation Enters', async () => {
  const result = await control();
  assert.equal(result.error, undefined);
  assert.deepEqual(result.writes, ['\r', '\r']);
});

test('stale, ambiguous or replaced picker refuses first Enter, stale/resize/foreign confirmation refuses second', async () => {
  for (const stage of ['picker', 'confirmation'])
    for (const mutate of [
      (s) => {
        s.token++;
      },
      (s) => {
        s.frame = '';
      },
      (s) => {
        s.frame += '\n\u2503    Session 1';
      },
      ...(stage === 'confirmation'
        ? [
            (s) => {
              s.geometry.resizeSequence++;
            },
            (s) => {
              s.frame = frame({ ...session, id: 'foreign' });
            },
          ]
        : []),
    ]) {
      const result = await control((s, current) => {
        if (current === stage) mutate(s);
      });
      assert.ok(result.error, 'invalid current observation accepted');
      assert.deepEqual(result.writes, stage === 'picker' ? [] : ['\r']);
    }
});
