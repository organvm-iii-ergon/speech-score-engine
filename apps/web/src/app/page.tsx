import type { Metadata } from 'next';

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

const scores = [
  {
    id: 'philip-glass',
    title: 'Philip Glass Buys a Loaf of Bread',
    detail: 'four voices · tight phase · after David Ives',
  },
  {
    id: 'richard-and-anne',
    title: 'Richard & Anne',
    detail: 'two voices · a Shakespearean volley',
  },
  {
    id: 'earnest-duet',
    title: 'Earnest — a duet',
    detail: 'you + an AI actor · after Wilde',
  },
  {
    id: 'macbeth-witches',
    title: 'Macbeth — the Three Witches',
    detail: 'three voices · a panned chorus refrain',
  },
  {
    id: 'lady-macbeth-macbeth',
    title: 'Lady Macbeth / Macbeth',
    detail: 'contemporary character poem by @two.be · artwork by @amaanjahangir',
  },
] as const;

const navLink = {
  color: 'rgba(245,242,232,0.68)',
  textDecoration: 'none',
  fontSize: '0.76rem',
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
};

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background:
          'radial-gradient(circle at 78% 12%, rgba(205,191,154,0.12), transparent 28rem), #101012',
        color: '#f1eee5',
        fontFamily: 'Georgia, "Times New Roman", serif',
      }}
    >
      <div
        style={{
          width: 'calc(100% - 3rem)',
          maxWidth: '78rem',
          margin: '0 auto',
          padding: '1.5rem 0 3rem',
        }}
      >
        <header
          style={{
            borderBottom: '1px solid rgba(233,230,220,0.14)',
            paddingBottom: 'clamp(2.5rem, 7vw, 6.5rem)',
          }}
        >
          <nav
            aria-label="Primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              marginBottom: 'clamp(4rem, 11vw, 9rem)',
            }}
          >
            <span
              style={{
                color: 'rgba(245,242,232,0.45)',
                fontSize: '0.72rem',
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
              }}
            >
              Speech-Score Engine
            </span>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
              <a href="/library" style={navLink}>
                Library
              </a>
              <a href="/tracker" style={navLink}>
                Tracker
              </a>
              <a href="/editor" style={navLink}>
                Editor
              </a>
            </div>
          </nav>

          <div style={{ maxWidth: '58rem' }}>
            <div
              style={{
                color: '#cdbf9a',
                fontSize: '0.78rem',
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
                marginBottom: '1.1rem',
              }}
            >
              Ableton for voice
            </div>
            <h1
              style={{
                fontSize: 'clamp(3.4rem, 10vw, 8.8rem)',
                fontWeight: 400,
                letterSpacing: '-0.055em',
                lineHeight: 0.88,
                margin: 0,
                maxWidth: '11ch',
              }}
            >
              Speech as score.
            </h1>
            <p
              style={{
                color: 'rgba(245,242,232,0.68)',
                fontSize: 'clamp(1.05rem, 2vw, 1.45rem)',
                lineHeight: 1.45,
                maxWidth: '39rem',
                margin: '2rem 0 0',
              }}
            >
              Voices are lanes. Lines are clips. A descending playhead lights and speaks each line
              as it strikes — so overlapping speech phases into music.
            </p>
          </div>
        </header>

        <section aria-labelledby="start-heading" style={{ padding: '2.5rem 0 4rem' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 15rem), 1fr))',
              gap: '0.8rem',
            }}
          >
            {[
              ['Browse the library', '/library', 'Pick a finished score.'],
              ['Open the tracker', '/tracker', 'Perform with voices, tones, or live cue.'],
              ['Open the editor', '/editor', 'Arrange a score yourself.'],
            ].map(([label, href, description]) => (
              <a
                key={href}
                href={href}
                style={{
                  display: 'block',
                  color: '#f1eee5',
                  background: 'rgba(245,242,232,0.055)',
                  border: '1px solid rgba(233,230,220,0.14)',
                  borderRadius: '0.35rem',
                  padding: '1rem 1.1rem 1.15rem',
                  textDecoration: 'none',
                }}
              >
                <span style={{ color: '#cdbf9a', fontSize: '1.05rem' }}>{label} →</span>
                <span
                  style={{
                    display: 'block',
                    color: 'rgba(245,242,232,0.52)',
                    fontSize: '0.86rem',
                    lineHeight: 1.45,
                    marginTop: '0.45rem',
                  }}
                >
                  {description}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section aria-labelledby="scores-heading">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: '1rem',
              marginBottom: '1.25rem',
            }}
          >
            <h2
              id="scores-heading"
              style={{
                fontSize: '0.8rem',
                fontWeight: 400,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: 'rgba(245,242,232,0.52)',
                margin: 0,
              }}
            >
              Five scores to play with
            </h2>
            <span style={{ color: 'rgba(245,242,232,0.36)', fontSize: '0.8rem' }}>sound on</span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
              gap: '0.8rem',
            }}
          >
            {scores.map((score, index) => (
              <a
                key={score.id}
                href={`/scores/${score.id}/`}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  alignItems: 'flex-start',
                  color: 'inherit',
                  borderTop: '1px solid rgba(233,230,220,0.14)',
                  padding: '1.1rem 0 1.25rem',
                  textDecoration: 'none',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    color: '#cdbf9a',
                    fontFamily: 'system-ui, sans-serif',
                    fontSize: '0.75rem',
                    letterSpacing: '0.08em',
                    paddingTop: '0.25rem',
                  }}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <span style={{ display: 'block', fontSize: '1.2rem', lineHeight: 1.2 }}>
                    {score.title}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      color: 'rgba(245,242,232,0.48)',
                      fontSize: '0.85rem',
                      lineHeight: 1.45,
                      marginTop: '0.35rem',
                    }}
                  >
                    {score.detail}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </section>

        <footer
          style={{
            borderTop: '1px solid rgba(233,230,220,0.14)',
            color: 'rgba(245,242,232,0.38)',
            fontSize: '0.82rem',
            lineHeight: 1.5,
            marginTop: '3rem',
            paddingTop: '1.25rem',
          }}
        >
          Turn sound on. Choose a score. Hit Perform — or use Space for live cue.
        </footer>
      </div>
    </main>
  );
}
