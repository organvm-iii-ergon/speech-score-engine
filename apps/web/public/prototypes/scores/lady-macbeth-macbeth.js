// Score: Lady Macbeth / Macbeth — a contemporary character poem by @two.be.
// Artwork and source post: @amaanjahangir. This is not dialogue from the play.
// The source typesets nine left/right pairs. This is a row-complete tracker: the two clips in each
// printed pair begin together at natural speed, and the next pair waits for the slower clip to end.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};

  const LANES = [
    {
      id: 'LADY_MACBETH',
      name: 'Lady Macbeth',
      performer: 'ai',
      voice: 'en-GB-SoniaNeural',
      rate: '+0%',
      pan: -0.72,
      gain: 0.98,
      align: 'right',
      tone: { f: 466.16, type: 'triangle' },
      speech: { pitch: 1.08, rate: 1.0, prefer: ['sonia', 'female'] },
    },
    {
      id: 'MACBETH',
      name: 'Macbeth',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      rate: '+0%',
      pan: 0.72,
      gain: 1.0,
      align: 'left',
      tone: { f: 311.13, type: 'sine' },
      speech: { pitch: 0.82, rate: 1.0, prefer: ['ryan', 'male'] },
    },
  ];

  // Preserve the post's original two-column line breaks for the score's visual treatment.
  const PAIRS = [
    ['i love', 'you'],
    ['you', 'have transformed me'],
    ['with strange tenderness', 'and i am the monster'],
    ['that startles me', 'in the mirror.'],
    ['and', 'i have come full circle.'],
    ['i cannot allow', 'this. this is me,'],
    ['myself', 'as i was destined'],
    ['to be', 'from my birth.'],
    ['so soft', 'it hurts.'],
  ];
  root.SSE_SCORES['lady-macbeth-macbeth'] = {
    id: 'lady-macbeth-macbeth',
    short: 'Lady Macbeth / Macbeth',
    title: 'Lady Macbeth / Macbeth',
    byline: 'poem @two.be · artwork @amaanjahangir',
    caption:
      'A synchronized two-player tracker: each row advances only when both UK neural voices finish.',
    playback: 'row-complete',
    tempo: 1,
    lanes: LANES,
    sections: {
      tenderness: [0, 3],
      mirror: [3, 6],
      return: [6, 9],
    },
    // The rendered clips, rather than a fixed tempo grid, determine each row's completion time.
    total: PAIRS.length,
    visualPairs: PAIRS,
    events: PAIRS.flatMap(([ladyMacbeth, macbeth], index) => {
      const section = index < 3 ? 'tenderness' : index < 6 ? 'mirror' : 'return';
      return [
        {
          row: index,
          lane: 'LADY_MACBETH',
          text: ladyMacbeth,
          section,
          stage: false,
        },
        {
          row: index,
          lane: 'MACBETH',
          text: macbeth,
          section,
          stage: false,
        },
      ];
    }),
  };
})();
