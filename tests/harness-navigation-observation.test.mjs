// TEST ONLY. Scripted frames prove observer refusal, not actual host rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIdentityMessage,
  highlightedOrdinal,
  assertCurrentIdentityFrame,
  confirmRenderedNavigation,
} from './support/harness-navigation-observation.mjs';
import { compositionCurrentFrame } from './support/harness-composition-readiness.mjs';

// Synthetic RGB operands, NOT evidence of the pinned host's actual theme.
const profile = {
  renderer: 'normal',
  selected: { fg: '10,20,30', bg: '40,50,60', bold: true },
  normal: { fg: '70,80,90', bg: '1,2,3', bold: false },
};
const sgr = (s) =>
  `\x1b[0;38;2;${s.fg.replaceAll(',', ';')};48;2;${s.bg.replaceAll(',', ';')}${s.bold ? ';1' : ''}m`;
const ansiPicker = (selected = 2) =>
  '\x1b[?2026h\x1b[2J\x1b[H' +
  'Select the Proceed session\r\n' +
  [1, 2]
    .map(
      (n) =>
        sgr(profile[n === selected ? 'selected' : 'normal']) + `    Session ${n} equal preview`,
    )
    .join('\r\n') +
  '\x1b[0m\x1b[?2026l';
const styledPicker = (n = 2) => compositionCurrentFrame(ansiPicker(n), { styled: true });

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
const picker = styledPicker().text;

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

test('identical plain frames retain different normal selection styles', () => {
  assert.equal(styledPicker(1).text, styledPicker(2).text);
  assert.equal(highlightedOrdinal(styledPicker(1), profile), 'Session 1');
  assert.equal(highlightedOrdinal(styledPicker(2), profile), 'Session 2');
  assert.throws(() => highlightedOrdinal(styledPicker(), null));
  assert.throws(() => highlightedOrdinal(picker, profile));
});

test('focus, bold alone, ambiguous/unknown styles and incomplete mutations refuse', () => {
  for (const edit of [
    (s) => {
      s.styles[1] = s.styles[2];
    },
    (s) => {
      s.styles[2] = s.styles[1];
    },
    (s) => {
      s.styles[2][5] = { ...profile.selected, bg: '9,9,9' };
    },
    (s) => {
      s.styles[2] = s.styles[2].map(() => ({ ...profile.normal, bold: true }));
    },
    (s) => {
      s.text += '\nOpen Proceed question?';
    },
  ]) {
    const s = structuredClone(styledPicker());
    edit(s);
    assert.throws(() => highlightedOrdinal(s, profile));
  }
  for (const suffix of [
    '\x1b[?2026h',
    '\x1b[',
    '\x1b[?2026h\x1b[2J\x1b[?2026l',
    '\x1b[?2026h\x1b[2;5H\x1b[0mSession 1\x1b[?2026l',
    '\x1b[?2026h\x1b[3m\x1b[?2026l',
    '\x1b[?2026h\x1b[1A\x1b[?2026l',
    '\x1b[?2026h\x1b[?3h\x1b[?2026l',
    '\x1b[?2026h\x1b[38;5;1m\x1b[?2026l',
    '\x1b]4;1;rgb:ff/00/00\x07',
    '\x1b[?2026h\x1b[38;2;;1;2m\x1b[?2026l',
    '\x1b[?2026h\x1b[1;301HX\x1b[?2026l',
    '\x1b[?2026h\x1b[1;1H\u0301\x1b[?2026l',
  ])
    assert.throws(() =>
      highlightedOrdinal(compositionCurrentFrame(ansiPicker() + suffix, { styled: true }), profile),
    );
  const focus = compositionCurrentFrame(
    ansiPicker() +
      '\x1b[?2026h\x1b[1;1H' +
      sgr(profile.selected) +
      'Select the Proceed session\x1b[?2026l',
    { styled: true },
  );
  assert.equal(highlightedOrdinal(focus, profile), 'Session 2');
  const repainted = compositionCurrentFrame(
    ansiPicker() + '\x1b[?2026h\x1b[3;1H\x1b[0m\x1b[2K' + '    Session 2 equal preview\x1b[?2026l',
    { styled: true },
  );
  assert.throws(() => highlightedOrdinal(repainted, profile));
});

async function control(mutate = () => {}) {
  const writes = [];
  const selected = { frame: picker, styledFrame: styledPicker(), token: 10, geometry };
  const confirmed = { frame: frame(), token: 20, geometry };
  let stage = 'picker';
  const driver = {
    selectionProfile: profile,
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

test('screen reset invalidates completed picker until a supported fresh frame, with zero Enter', async () => {
  for (const reset of ['\x1b[?1049h', '\x1b[2J', '\x1b[3J']) {
    for (const styled of [false, true])
      assert.equal(compositionCurrentFrame(ansiPicker() + reset, { styled }), '');
    const result = await control((s, stage) => {
      if (stage !== 'picker') return;
      const ansi = ansiPicker() + reset;
      s.frame = compositionCurrentFrame(ansi);
      s.styledFrame = compositionCurrentFrame(ansi, { styled: true });
    });
    assert.ok(result.error, 'reset must refuse stale picker');
    assert.deepEqual(result.writes, []);
    const fresh = compositionCurrentFrame(ansiPicker() + reset + ansiPicker(1), {
      styled: true,
    });
    assert.equal(highlightedOrdinal(fresh, profile), 'Session 1');
  }
});

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
      (s) => {
        s.geometry.resizeSequence++;
      },
      ...(stage === 'picker'
        ? [
            (s) => {
              s.styledFrame = styledPicker(1);
            },
          ]
        : []),
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
