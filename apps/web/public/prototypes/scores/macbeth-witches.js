// Score: Macbeth — the Three Witches (Shakespeare, Act IV Sc 1 + I.1, public domain).
// Shows range the duets can't: THREE AI lanes and a CHORUS — the "Double, double…" refrain is placed
// on shared rows so all three voices strike at once (panned L/C/R), producing the overlapping phasing
// that first won the actor over. Each witch is a distinct neural voice; the ingredient lines pass
// between them, the refrain binds them.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};

  const LANES = [
    {
      id: 'FIRST_WITCH',
      name: 'First Witch',
      performer: 'ai',
      voice: 'en-GB-SoniaNeural',
      rate: '-8%',
      pan: -0.55,
      gain: 1.0,
      align: 'right',
      tone: { f: 330.0, type: 'sawtooth' },
      speech: { pitch: 0.9, rate: 0.92, prefer: ['sonia', 'kate', 'female'] },
    },
    {
      id: 'SECOND_WITCH',
      name: 'Second Witch',
      performer: 'ai',
      voice: 'en-US-JennyNeural',
      rate: '-6%',
      pan: 0.0,
      gain: 1.0,
      align: 'center',
      tone: { f: 392.0, type: 'sawtooth' },
      speech: { pitch: 1.0, rate: 0.95, prefer: ['jenny', 'samantha', 'female'] },
    },
    {
      id: 'THIRD_WITCH',
      name: 'Third Witch',
      performer: 'ai',
      voice: 'en-US-AriaNeural',
      rate: '-10%',
      pan: 0.55,
      gain: 1.0,
      align: 'left',
      tone: { f: 294.0, type: 'sawtooth' },
      speech: { pitch: 1.12, rate: 0.9, prefer: ['aria', 'victoria', 'female'] },
    },
  ];

  const WITCHES = ['FIRST_WITCH', 'SECOND_WITCH', 'THIRD_WITCH'];
  // 'ALL' expands to every witch on the SAME row — a chorus strike (the phasing refrain).
  const SCRIPT = [
    ['FIRST_WITCH', "Thrice the brinded cat hath mew'd.", 'summons'],
    ['SECOND_WITCH', 'Thrice and once the hedge-pig whined.', 'summons'],
    ['THIRD_WITCH', "Harpier cries: 'tis time, 'tis time.", 'summons'],
    ['FIRST_WITCH', 'Round about the cauldron go;', 'charm'],
    ['FIRST_WITCH', "In the poison'd entrails throw.", 'charm'],
    ['ALL', 'Double, double toil and trouble;', 'charm'],
    ['ALL', 'Fire burn and cauldron bubble.', 'charm'],
    ['SECOND_WITCH', 'Fillet of a fenny snake,', 'charm'],
    ['SECOND_WITCH', 'In the cauldron boil and bake;', 'charm'],
    ['SECOND_WITCH', 'Eye of newt and toe of frog,', 'charm'],
    ['THIRD_WITCH', 'Wool of bat and tongue of dog,', 'charm'],
    ['THIRD_WITCH', "Adder's fork and blind-worm's sting,", 'charm'],
    ['THIRD_WITCH', "Lizard's leg and howlet's wing,", 'charm'],
    ['ALL', 'Double, double toil and trouble;', 'charm'],
    ['ALL', 'Fire burn and cauldron bubble.', 'charm'],
    ['ALL', "Cool it with a baboon's blood,", 'charm'],
    ['FIRST_WITCH', 'Then the charm is firm and good.', 'charm'],
  ];

  const events = [];
  const bounds = { summons: [Number.POSITIVE_INFINITY, 0], charm: [Number.POSITIVE_INFINITY, 0] };
  let row = 2;
  for (const [who, text, section] of SCRIPT) {
    const lanes = who === 'ALL' ? WITCHES : [who];
    for (const lane of lanes) events.push({ row, lane, text, section, stage: false });
    bounds[section][0] = Math.min(bounds[section][0], row);
    bounds[section][1] = Math.max(bounds[section][1], row);
    row += 3;
  }
  const total = row + 2;

  root.SSE_SCORES['macbeth-witches'] = {
    id: 'macbeth-witches',
    short: 'Macbeth · witches',
    title: 'Macbeth — the Three Witches',
    byline: 'three AI voices · Shakespeare',
    caption:
      'The weird sisters at the cauldron. Ingredient lines pass between them; the refrain strikes all three at once — panned left, centre, right — so the chant overlaps into one voice.',
    artwork: {
      id: 'macbeth-witches-savery-1615',
      title: 'Cows in a Stable; Witches in the Four Corners',
      artist: 'Roelant Savery',
      date: '1615',
      sourceUrl:
        'https://www.rijksmuseum.nl/en/collection/object/Cows-in-a-Stable-Witches-in-the-Four-Corners--b4b1ccb1b6449bf9910734bf1f581c21',
      image: '/prototypes/artwork/macbeth-witches-savery-1615.webp',
      credit:
        'Cows in a Stable; Witches in the Four Corners (1615) — Roelant Savery · Rijksmuseum · public domain',
      license: 'Public domain',
      alt: 'Cows in a Stable; Witches in the Four Corners, 1615, by Roelant Savery',
    },
    tempo: 2.5,
    lanes: LANES,
    sections: {
      summons: [bounds.summons[0], bounds.summons[1] + 2],
      charm: [bounds.charm[0], total - 1],
    },
    total,
    events,
  };
})();
