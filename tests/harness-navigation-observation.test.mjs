// TEST ONLY. Scripted frames prove observer refusal, not actual host rendering.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  assertIdentityMessage,
  highlightedOrdinal,
  assertCurrentIdentityFrame,
  confirmRenderedNavigation,
} from './support/harness-navigation-observation.mjs';
import {
  compositionCurrentFrame,
  compositionSourceFrame,
} from './support/harness-composition-readiness.mjs';

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

// Indexed operands from the admitted fixture, not a product theme/profile.
const fixtureStyles = {
  selected: { fg: 'index:232', bg: 'index:216', bold: true },
  inactive: {
    current: { fg: 'index:216', bg: 'index:233', bold: false },
    ordinary: { fg: 'index:255', bg: 'index:233', bold: false },
  },
};
const indexSgr = (s) => `\x1b[0;38;5;${s.fg.slice(6)};48;5;${s.bg.slice(6)}${s.bold ? ';1' : ''}m`;
function fixtureCase({
  selected = 0,
  current = 0,
  labels = ['Session 1', 'Session 2'],
  styles = fixtureStyles,
} = {}) {
  const raw =
    '\x1b[?1049h\x1b[?2026h\x1b[HSelect the Proceed session' +
    labels
      .map(
        (label, n) =>
          `\x1b[${n + 3};3H` +
          (n === current ? '\u25cf ' : '  ') +
          indexSgr(
            n === selected
              ? styles.selected
              : styles.inactive[n === current ? 'current' : 'ordinary'],
          ) +
          label,
      )
      .join('') +
    '\x1b[?2026l';
  return boundFixture(raw, labels, styles);
}
function boundFixture(raw, labels, styles = fixtureStyles) {
  const binding = {
    host: 'synthetic-host-not-qualified',
    theme: 'synthetic-indexed-not-qualified',
    geometry: { rows: 40, columns: 120 },
    generation: 1,
    transcriptHash: createHash('sha256').update(raw).digest('hex'),
    bytes: Buffer.byteLength(raw),
    frames: 1,
  };
  return {
    raw,
    labels,
    binding,
    profile: {
      renderer: 'normal',
      scope: 'fixture-only',
      ...structuredClone(styles),
      binding: structuredClone(binding),
    },
  };
}
const fixtureSelection = (c) =>
  highlightedOrdinal(c.raw, c.profile, {
    offlineFixture: { labels: c.labels, binding: c.binding },
  });

test('indexed fixture selection follows style, not marker or label, with asymmetric inactive roles', () => {
  for (const labels of [
    ['Session 1', 'Session 2'],
    ['OTHER', 'UNRELATED'],
  ])
    for (const selected of [0, 1])
      for (const current of [0, 1])
        assert.equal(
          fixtureSelection(fixtureCase({ selected, current, labels })),
          labels[selected],
        );
  // The observer compares supplied finite identities, not pinned palette operands.
  const styles = structuredClone(fixtureStyles);
  styles.selected = { fg: 'index:0', bg: 'index:7', bold: false };
  assert.equal(fixtureSelection(fixtureCase({ selected: 1, styles })), 'Session 2');
});

test('indexed fixture profiles refuse role/style ambiguity, missing/duplicate labels and mixed/default/RGB identities', () => {
  for (const mutate of [
    (c) => {
      c.labels.push(c.labels[0]);
    },
    (c) => {
      c.labels[1] = 'absent';
    },
    (c) => {
      c.profile.inactive.current = c.profile.inactive.ordinary;
    },
    (c) => {
      c.profile.inactive.ordinary = c.profile.selected;
    },
    (c) => {
      delete c.profile.inactive.current;
    },
    (c) => {
      c.profile.selected.bg = c.profile.inactive.current.bg;
    },
    (c) => {
      c.profile.selected.fg = 'index:256';
    },
    (c) => {
      c.profile.selected.fg = 'index:0232';
    },
    (c) => {
      c.profile.selected.fg = '232,232,232';
    },
    (c) => {
      c.profile.selected.fg = null;
    },
    (c) => {
      c.profile.selected.bg = null;
    },
    (c) => {
      c.profile.selected.italic = true;
    },
    (c) => {
      c.profile.inactive.unknown = c.profile.inactive.current;
    },
  ]) {
    const c = fixtureCase({ selected: 1 });
    mutate(c);
    assert.throws(() => fixtureSelection(c));
  }
  const c = fixtureCase();
  for (const raw of [
    c.raw.replace('\u25cf ', '  '),
    c.raw.replace('Session 2', 'Session 1'),
    c.raw.replace('Session 1', 'Session 1\u25cf'),
    c.raw.replace('Session 2', '\u25cf Session 2'),
    c.raw.replace('Session 1', 'Sess\x1b[0mion 1'),
    c.raw.replace(indexSgr(fixtureStyles.inactive.ordinary), indexSgr(fixtureStyles.selected)),
    c.raw.replace(indexSgr(fixtureStyles.selected), indexSgr(fixtureStyles.inactive.current)),
    c.raw.replace('Session 1', '\x1b[3mSession 1'),
    c.raw.replace('Session 1', '\x1b[38;2;232;232;232mSession 1'),
    c.raw.replace('Select the Proceed session', 'Open Proceed question?'),
  ])
    assert.throws(() => fixtureSelection(boundFixture(raw, c.labels)));
});

test('fixture prefix/host/theme/geometry/generation bindings and incomplete/reset updates refuse', () => {
  for (const key of [
    'host',
    'theme',
    'geometry',
    'generation',
    'transcriptHash',
    'bytes',
    'frames',
  ]) {
    const c = fixtureCase();
    c.binding[key] = key === 'geometry' ? { rows: 41, columns: 120 } : 'changed';
    assert.throws(() => fixtureSelection(c));
  }
  for (const mutate of [
    (c) => {
      c.raw += '\x1b[?2026h';
    },
    (c) => {
      c.raw += '\x1b[';
    },
    (c) => {
      c.raw += '\x1b[?1049h';
    },
    (c) => {
      c.raw += '\x1b[2J';
    },
    (c) => {
      c.binding.generation = c.profile.binding.generation = 2;
    },
    (c) => {
      c.binding.frames = c.profile.binding.frames = 2;
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 41, columns: 120 };
    },
    (c) => {
      c.binding.geometry = c.profile.binding.geometry = { rows: 24, columns: 80 };
      c.raw = c.raw.replace('[3;3H', '[30;3H');
    },
  ]) {
    const c = fixtureCase();
    mutate(c);
    // Rebinding bytes cannot make an incomplete/reset/stale generation valid.
    c.binding.bytes = c.profile.binding.bytes = Buffer.byteLength(c.raw);
    c.binding.transcriptHash = c.profile.binding.transcriptHash = createHash('sha256')
      .update(c.raw)
      .digest('hex');
    assert.throws(() => fixtureSelection(c));
  }
});

test('historical/forged indexed fixture profiles cannot authorize a live navigation Enter', async () => {
  const c = fixtureCase();
  const styledFrame = compositionSourceFrame(c.raw);
  const picked = { frame: styledFrame.text, styledFrame, token: 10, geometry };
  for (const selectionProfile of [
    c.profile,
    { ...c.profile, scope: 'live' },
    { renderer: 'normal', selected: c.profile.selected, normal: c.profile.inactive.ordinary },
    { ...profile, binding: c.binding },
    null,
  ]) {
    const writes = [];
    await assert.rejects(
      confirmRenderedNavigation(
        {
          selectionProfile,
          offlineFixture: { labels: c.labels, binding: c.binding },
          stdin: { write: (s) => writes.push(s) },
          waitHighlightedSession: async () => picked,
          currentNavigationFrame: async () => structuredClone(picked),
          waitIdentityConfirmation: async () => {
            throw Error('must not enter');
          },
        },
        session,
      ),
    );
    assert.deepEqual(writes, []);
  }
});

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
