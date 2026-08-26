import type { Metadata } from 'next';

// Public front door — this is the link you hand a friend, so it explains itself and reminds people
// to turn sound on (the whole thing is audio). Metadata gives a real title + description so the URL
// unfurls nicely when pasted into a text / Discord / DM.
export const metadata: Metadata = {
  title: 'Speech-Score Engine — Ableton for voice',
  description:
    'Turn a play into a temporal score. Voices are lanes, lines are clips, and a descending playhead lights and speaks each line as it strikes. Best with sound on.',
  openGraph: {
    title: 'Speech-Score Engine — Ableton for voice',
    description:
      'Turn a play into a temporal score. Voices are lanes, lines are clips, a descending playhead speaks each line as it strikes.',
    type: 'website',
  },
};

const linkStyle = { color: '#b58900', fontWeight: 600, textDecoration: 'none' } as const;

export default function HomePage() {
  return (
    <main
      style={{
        padding: '3rem 2rem',
        fontFamily: 'system-ui, sans-serif',
        maxWidth: '46rem',
        margin: '0 auto',
        color: '#e8e8ea',
        background: '#101012',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Speech-Score Engine</h1>
      <p style={{ color: '#b58900', fontWeight: 600, marginTop: 0, marginBottom: '1.25rem' }}>
        “Ableton for voice.”
      </p>
      <p style={{ color: '#bdbdc2', lineHeight: 1.6, marginBottom: '0.75rem' }}>
        Turn a play into a temporal <em>score</em>. Voices are lanes, lines are clips, and a
        descending playhead lights up and <em>speaks</em> each line as it strikes — so overlapping
        speech phases into music. Compose it, rehearse it, perform it.
      </p>
      <p style={{ color: '#8a8a90', marginBottom: '2.25rem' }}>
        🔊 Turn your sound on — and it works on your phone too.
      </p>

      <p style={{ marginBottom: '1.25rem' }}>
        <a href="/library" style={linkStyle}>
          ▦ Browse the library →
        </a>{' '}
        <span style={{ color: '#8a8a90' }}>— pick a piece to open it.</span>
      </p>

      <p style={{ marginBottom: '1.25rem' }}>
        <a href="/tracker" style={linkStyle}>
          ▶ Open the tracker →
        </a>{' '}
        <span style={{ color: '#8a8a90' }}>
          — perform a score: hit play, or Space for live-cue. Solo a voice, loop a passage.
        </span>
      </p>

      <p style={{ marginBottom: '2.5rem' }}>
        <a href="/editor" style={linkStyle}>
          ✎ Open the editor →
        </a>{' '}
        <span style={{ color: '#8a8a90' }}>
          — arrange one yourself: drag clips across lanes and time.
        </span>
      </p>

      <section>
        <h2
          style={{
            fontSize: '0.85rem',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#8a8a90',
          }}
        >
          Five scores to play with
        </h2>
        <ul style={{ lineHeight: 1.9, color: '#bdbdc2', paddingLeft: '1.1rem' }}>
          <li>
            <strong style={{ color: '#e8e8ea' }}>Philip Glass Buys a Loaf of Bread</strong> — four
            voices in tight phase.
          </li>
          <li>
            <strong style={{ color: '#e8e8ea' }}>Richard &amp; Anne</strong> — a Shakespeare
            two-hander (stichomythia).
          </li>
          <li>
            <strong style={{ color: '#e8e8ea' }}>The Three Witches</strong> — Macbeth, three voices
            and a chorus refrain.
          </li>
          <li>
            <strong style={{ color: '#e8e8ea' }}>Earnest</strong> — a human + AI duet.
          </li>
          <li>
            <strong style={{ color: '#e8e8ea' }}>Lady Macbeth / Macbeth</strong> — a contemporary
            character poem by @two.be with artwork by @amaanjahangir, performed as a parallel
            two-voice score.
          </li>
        </ul>
      </section>
    </main>
  );
}
