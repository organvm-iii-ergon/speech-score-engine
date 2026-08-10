// Score: Richard & Anne — the stichomythia from Richard III, I.ii (Shakespeare, public domain).
// Two lanes, rapid line-for-line volley. Demonstrates that the engine is not bound to four lanes
// or to the Glass phasing rhythm: any cast, any tempo, any shape of exchange.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};

  const LANES = [
    {
      id: 'ANNE',
      name: 'Lady Anne',
      performer: 'ai',
      voice: 'en-GB-SoniaNeural',
      rate: '+2%',
      pan: -0.4,
      gain: 0.98,
      align: 'right',
      tone: { f: 523.25, type: 'triangle' },
      speech: { pitch: 1.35, rate: 1.0, prefer: ['kate', 'serena', 'stephanie', 'female'] },
    },
    {
      id: 'RICHARD',
      name: 'Gloucester',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      rate: '-4%',
      pan: 0.4,
      gain: 1.0,
      align: 'left',
      tone: { f: 349.23, type: 'sine' },
      speech: { pitch: 0.72, rate: 0.95, prefer: ['daniel', 'oliver', 'arthur', 'male'] },
    },
  ];

  // A tight courtship duel: one line every three rows, alternating.
  const LINES = [
    ['ANNE', 'I would I knew thy heart.'],
    ['RICHARD', '’Tis figured in my tongue.'],
    ['ANNE', 'I fear me both are false.'],
    ['RICHARD', 'Then never man was true.'],
    ['ANNE', 'Well, well, put up your sword.'],
    ['RICHARD', 'Say, then, my peace is made.'],
    ['ANNE', 'That shalt thou know hereafter.'],
    ['RICHARD', 'But shall I live in hope?'],
    ['ANNE', 'All men, I hope, live so.'],
    ['RICHARD', 'Vouchsafe to wear this ring.'],
    ['ANNE', 'To take is not to give.'],
  ];

  const events = [];
  let row = 2;
  for (const [lane, text] of LINES) {
    events.push({ row, lane, text, section: 'duel', stage: false });
    row += 3;
  }
  const total = row + 2;

  root.SSE_SCORES['richard-and-anne'] = {
    id: 'richard-and-anne',
    short: 'Richard & Anne',
    title: 'Richard & Anne',
    byline: 'a stichomythia, from Richard III · I.ii',
    caption: 'Two voices, line for line — the courtship as a duel of the tongue.',
    artwork: {
      id: 'richard-anne-portrait-woman-1590',
      title: 'Portrait of a Woman',
      artist: 'Anonymous, Northern Netherlands',
      date: 'c. 1590',
      sourceUrl:
        'https://www.rijksmuseum.nl/en/collection/object/Portrait-of-a-Woman--2bebeb8ca600820990b487f512d06810',
      image: '/prototypes/artwork/richard-anne-portrait-woman-1590.webp',
      credit:
        'Portrait of a Woman (c. 1590) — anonymous, Northern Netherlands · Rijksmuseum · public domain',
      license: 'Public domain',
      alt: 'Portrait of a Woman, circa 1590, anonymous Northern Netherlands artist',
    },
    tempo: 2.5,
    lanes: LANES,
    sections: { duel: [0, total - 1] },
    total,
    events,
  };
})();
