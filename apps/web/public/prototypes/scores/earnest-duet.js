// Score: Earnest — a duet (The Importance of Being Earnest, Wilde, public domain).
// FIRST TASTE of L5: a human actor performing with an AI actor, simultaneously. ALGERNON is voiced
// by the engine (performer:'ai'); JACK is a live lane (performer:'human') — the engine holds it
// silent and marks it, so a real actor speaks Jack's lines into the gaps while the AI keeps the beat.
(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};

  const LANES = [
    {
      id: 'JACK',
      name: 'Jack · you',
      performer: 'human',
      pan: -0.35,
      gain: 1.0,
      align: 'right',
      tone: { f: 392.0, type: 'sine' },
    },
    {
      id: 'ALGERNON',
      name: 'Algernon · AI',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      rate: '+0%',
      pan: 0.35,
      gain: 1.0,
      align: 'left',
      tone: { f: 440.0, type: 'triangle' },
      speech: { pitch: 0.95, rate: 1.02, prefer: ['daniel', 'oliver', 'arthur', 'male'] },
    },
  ];

  const LINES = [
    ['ALGERNON', 'How are you, my dear Ernest? What brings you up to town?'],
    ['JACK', 'Oh, pleasure, pleasure! What else should bring one anywhere?'],
    ['ALGERNON', 'Eating as usual, I see, Jack!'],
    ['JACK', 'When one is in town one amuses oneself.'],
    ['ALGERNON', 'How immensely you must amuse them!'],
    ['JACK', 'I hate people who are not serious about meals.'],
  ];

  const events = [];
  let row = 2;
  for (const [lane, text] of LINES) {
    events.push({ row, lane, text, section: 'scene', stage: false });
    row += 4;
  }
  const total = row + 2;

  root.SSE_SCORES['earnest-duet'] = {
    id: 'earnest-duet',
    short: 'Earnest · duet',
    title: 'Earnest — a duet',
    byline: 'you + an AI actor · after Wilde',
    caption: 'You play Jack; the AI plays Algernon. It keeps the beat — you speak into the gaps.',
    artwork: {
      id: 'earnest-de-brug-1895',
      title: 'The Bridge (De brug)',
      artist: 'Marius Bauer',
      date: '1895',
      sourceUrl:
        'https://www.rijksmuseum.nl/en/collection/object/De%2Bbrug--6c25e538988767a4aa01810951b2a0a6',
      image: '/prototypes/artwork/earnest-de-brug-1895.webp',
      credit: 'The Bridge (De brug) (1895) — Marius Bauer · Rijksmuseum · public domain',
      license: 'Public domain',
      alt: 'The Bridge, De brug, 1895, by Marius Bauer',
    },
    tempo: 2,
    defaultVoiceConfiguration: 'separated',
    lanes: LANES,
    sections: { scene: [0, total - 1] },
    total,
    events,
  };
})();
