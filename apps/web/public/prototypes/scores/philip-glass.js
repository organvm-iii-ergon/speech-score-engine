// Score: Philip Glass Buys a Loaf of Bread (a speech-score, after David Ives).
// Portable SCORE data — the engine (philip-glass-tracker.html) renders any score registered here.
// Each lane carries its own casting: neural `voice` (for the render generator), stereo `pan`,
// `tone` (fallback pitch), and `speech` (Web Speech fallback). performer:'ai' => voiced by the
// engine; performer:'human' => a live lane the engine leaves silent for an actor to speak.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};

  const LANES = [
    {
      id: 'FIRST_WOMAN',
      name: 'First Woman',
      performer: 'ai',
      voice: 'en-US-AriaNeural',
      rate: '+0%',
      pan: -0.5,
      gain: 0.98,
      align: 'right',
      tone: { f: 587.33, type: 'triangle' },
      speech: {
        pitch: 1.5,
        rate: 1.0,
        prefer: ['samantha', 'victoria', 'karen', 'moira', 'female'],
      },
    },
    {
      id: 'SECOND_WOMAN',
      name: 'Second Woman',
      performer: 'ai',
      voice: 'en-GB-SoniaNeural',
      rate: '+4%',
      pan: -0.17,
      gain: 0.98,
      align: 'right',
      tone: { f: 493.88, type: 'triangle' },
      speech: { pitch: 1.2, rate: 1.06, prefer: ['victoria', 'allison', 'ava', 'karen', 'female'] },
    },
    {
      id: 'GLASS',
      name: 'Glass',
      performer: 'ai',
      voice: 'en-US-AndrewNeural',
      rate: '-8%',
      pan: 0.17,
      gain: 1.0,
      align: 'left',
      tone: { f: 392.0, type: 'sine' },
      speech: { pitch: 0.7, rate: 0.9, prefer: ['daniel', 'alex', 'oliver', 'rishi', 'male'] },
    },
    {
      id: 'BAKER',
      name: 'Baker',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      rate: '-2%',
      pan: 0.5,
      gain: 0.95,
      align: 'left',
      tone: { f: 261.63, type: 'sine' },
      speech: { pitch: 0.88, rate: 1.0, prefer: ['fred', 'tom', 'reed', 'alex', 'male'] },
    },
  ];
  const CH = LANES.map((l) => l.id);

  const events = [];
  const put = (row, lane, text, section, stage) =>
    events.push({ row, lane, text, section, stage: !!stage });

  // I. READABLE — the recognizable exchange (short fragments, turn-taking)
  put(2, 'FIRST_WOMAN', 'Isn’t that Philip Glass?', 'readable');
  put(6, 'SECOND_WOMAN', 'I think it is.', 'readable');
  put(10, 'BAKER', 'Can I help you, sir?', 'readable');
  put(14, 'GLASS', 'a loaf of bread', 'readable');
  put(18, 'BAKER', 'Just a moment.', 'readable');
  put(22, 'FIRST_WOMAN', 'It’s time now.', 'readable');

  // II. PHASE — staggered ostinati enter one voice at a time, then lock
  for (let r = 26; r <= 44; r += 2) put(r, 'FIRST_WOMAN', 'isn’t that', 'phase');
  for (let r = 32; r <= 50; r += 2) put(r, 'SECOND_WOMAN', 'think it is', 'phase');
  for (let r = 38; r <= 56; r += 2) put(r, 'BAKER', 'help you sir', 'phase');
  for (let r = 44; r <= 62; r += 2) put(r, 'GLASS', 'yes I need', 'phase');
  for (let r = 58; r <= 63; r += 1) {
    put(r, 'FIRST_WOMAN', 'isn’t that', 'phase');
    put(r, 'SECOND_WOMAN', 'think it is', 'phase');
    put(r, 'GLASS', 'yes I need', 'phase');
    put(r, 'BAKER', 'help you sir', 'phase');
  }

  // III. FRAGMENT — phrases atomize into single words, scattered / phasing
  const FRAG = {
    FIRST_WOMAN: ['Philip', 'a'],
    SECOND_WOMAN: ['think', 'is'],
    GLASS: ['loaf', 'bread', 'yes'],
    BAKER: ['help', 'can', 'bread'],
  };
  const idx = { FIRST_WOMAN: 0, SECOND_WOMAN: 0, GLASS: 0, BAKER: 0 };
  const nextFrag = (ch) => FRAG[ch][idx[ch]++ % FRAG[ch].length];
  for (let r = 66; r <= 99; r += 1) {
    if (r % 2 === 0) put(r, 'FIRST_WOMAN', nextFrag('FIRST_WOMAN'), 'fragment');
    if (r % 2 === 1) put(r, 'SECOND_WOMAN', nextFrag('SECOND_WOMAN'), 'fragment');
    if (r % 3 === 0) put(r, 'GLASS', nextFrag('GLASS'), 'fragment');
    if (r % 3 === 2) put(r, 'BAKER', nextFrag('BAKER'), 'fragment');
  }

  // IV. UNISON — the four voices converge on the same word, same instant
  const UNI = [
    'Philip',
    'can',
    'think',
    'bread',
    'Bread',
    'help',
    'Philip',
    'think',
    'Philip',
    'need',
    'bread',
    'loaf',
  ];
  let ur = 103;
  for (const w of UNI) {
    for (const ch of CH) put(ur, ch, w, 'unison');
    ur += 2;
  }
  ur += 1;
  for (const ch of CH) put(ur, ch, 'loaf of bread', 'unison');
  ur += 3;
  for (const ch of CH) put(ur, ch, 'loaf of bread.', 'unison');
  const total = ur + 3;

  root.SSE_SCORES['philip-glass'] = {
    id: 'philip-glass',
    short: 'Philip Glass',
    title: 'Philip Glass Buys a Loaf of Bread',
    byline: 'a speech-score, after David Ives',
    caption: 'Dialogue as temporal score — text, recurrence, overlap, vocal distribution.',
    artwork: {
      id: 'philip-glass-abstract-composition-1994',
      title: 'Abstract Composition',
      artist: 'Harrie A. Gerritz',
      date: '1994',
      sourceUrl:
        'https://www.rijksmuseum.nl/en/collection/object/Abstracte-compositie--e8cc3cbefbadec41e73676f9def00cc3',
      image: '/prototypes/artwork/philip-glass-abstract-composition-1994.webp',
      credit: 'Abstract Composition (1994) — Harrie A. Gerritz · Rijksmuseum · CC0',
      license: 'CC0 1.0',
      alt: 'Abstract Composition, 1994, by Harrie A. Gerritz',
    },
    tempo: 3,
    lanes: LANES,
    sections: {
      readable: [0, 24],
      phase: [25, 64],
      fragment: [65, 101],
      unison: [102, total - 1],
    },
    total,
    events,
  };
})();
