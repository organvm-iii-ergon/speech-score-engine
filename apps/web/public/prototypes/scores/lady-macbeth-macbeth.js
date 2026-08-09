// Score: Lady Macbeth / Macbeth — a contemporary character poem by @two.be.
// Artwork and source post: @amaanjahangir. This is not dialogue from the play.
// The source typesets nine left/right pairs; the performance treats each column as one continuous
// character passage, so the two voices begin together rather than stopping between individual lines.
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
      speech: { pitch: 1.08, rate: 0.92, prefer: ['sonia', 'female'] },
    },
    {
      id: 'MACBETH',
      name: 'Macbeth',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      rate: '+40%',
      pan: 0.72,
      gain: 1.0,
      align: 'left',
      tone: { f: 311.13, type: 'sine' },
      speech: { pitch: 0.82, rate: 0.9, prefer: ['ryan', 'male'] },
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
  const passages = {
    LADY_MACBETH: `${PAIRS.map(([line]) => line).join(' ')}.`,
    MACBETH:
      'you have transformed me, and i am the monster in the mirror, i have come full circle, this, this is me, as i was destined from my birth, it hurts.',
  };

  root.SSE_SCORES['lady-macbeth-macbeth'] = {
    id: 'lady-macbeth-macbeth',
    short: 'Lady Macbeth / Macbeth',
    title: 'Lady Macbeth / Macbeth',
    byline: 'poem @two.be · artwork @amaanjahangir',
    caption: 'A visual-and-audio remix: two concurrent character passages for UK neural voices.',
    tempo: 1.5,
    lanes: LANES,
    sections: {
      tenderness: [0, 3],
      mirror: [3, 6],
      return: [6, 9],
    },
    // Nine spoken pairs plus one tail beat, so the faster counterpoint clears before looping.
    total: 10,
    visualPairs: PAIRS,
    events: PAIRS.flatMap(([ladyMacbeth, macbeth], index) => {
      const section = index < 3 ? 'tenderness' : index < 6 ? 'mirror' : 'return';
      const silent = index !== 0;
      return [
        {
          row: index,
          lane: 'LADY_MACBETH',
          text: ladyMacbeth,
          speechText: silent ? undefined : passages.LADY_MACBETH,
          silent,
          section,
          stage: false,
        },
        {
          row: index,
          lane: 'MACBETH',
          text: macbeth,
          speechText: silent ? undefined : passages.MACBETH,
          silent,
          section,
          stage: false,
        },
      ];
    }),
  };
})();
