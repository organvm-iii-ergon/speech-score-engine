'use client';

import { loadScript } from '@/lib/loadScript';
import { SCORE_SCRIPTS } from '@/lib/scoreScripts';
import type { Score } from '@/types/sse';
import { type CSSProperties, useEffect, useState } from 'react';

// The library front door: load every registered score (each self-registers into window.SSE_SCORES)
// and show it as a card. All display facts are DERIVED from the score data — voice count, AI/human
// mix, line count, whether any row is a chorus (>1 voice striking together). No hand-kept metadata.

interface Card {
  score: Score;
  voices: number;
  ai: number;
  human: number;
  lines: number;
  chorus: boolean;
}

function describe(score: Score): Card {
  const voices = score.lanes.length;
  const human = score.lanes.filter((l) => l.performer === 'human').length;
  const byRow = new Map<number, number>();
  for (const e of score.events) byRow.set(e.row, (byRow.get(e.row) ?? 0) + 1);
  const chorus = [...byRow.values()].some((n) => n > 1);
  return { score, voices, ai: voices - human, human, lines: byRow.size, chorus };
}

const C = {
  bg: '#101012',
  panel: '#16161a',
  rule: 'rgba(233,230,220,0.12)',
  text: 'rgba(233,230,220,0.92)',
  muted: 'rgba(233,230,220,0.55)',
  accent: '#cdbf9a',
};

const pill = (color: string): CSSProperties => ({
  display: 'inline-block',
  fontSize: '0.68rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  padding: '2px 8px',
  borderRadius: '999px',
  border: `1px solid ${color}`,
  color,
});

export function LibraryClient() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      for (const src of SCORE_SCRIPTS) await loadScript(src);
      if (cancelled) return;
      const scores = Object.values(window.SSE_SCORES ?? {});
      setCards(scores.map(describe));
    };
    run().catch((err) => {
      if (!cancelled) setError(String(err));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        background: C.bg,
        color: C.text,
        fontFamily: 'Georgia, "Times New Roman", serif',
        padding: 'clamp(1.5rem, 4vw, 3.5rem)',
      }}
    >
      <header style={{ maxWidth: '64rem', margin: '0 auto 2.5rem' }}>
        <div
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: '0.72rem',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: C.muted,
          }}
        >
          Speech-Score Engine
        </div>
        <h1 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', margin: '0.3rem 0 0.6rem' }}>
          The library
        </h1>
        <p style={{ color: C.muted, maxWidth: '38rem', lineHeight: 1.5 }}>
          Every score the one engine can perform. Pick a piece to open it in the tracker — metronome
          or live-cue, solo a voice, loop a passage.{' '}
          <a href="/editor" style={{ color: C.accent, textDecoration: 'none' }}>
            Or arrange your own →
          </a>
        </p>
      </header>

      {error && (
        <p style={{ maxWidth: '64rem', margin: '0 auto', color: '#e0a0a0' }}>
          Could not load scores: {error}
        </p>
      )}
      {!cards && !error && (
        <p style={{ maxWidth: '64rem', margin: '0 auto', color: C.muted }}>Loading…</p>
      )}

      <div
        style={{
          maxWidth: '64rem',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 20rem), 1fr))',
          gap: '1.1rem',
        }}
      >
        {cards?.map((c) => {
          // Keep the original tracker query URL as a stable share alias while giving Lady Macbeth
          // a canonical, descriptive route of its own.
          const trackerHref = `/tracker?score=${encodeURIComponent(c.score.id)}`;
          const href =
            c.score.id === 'lady-macbeth-macbeth' ? '/scores/lady-macbeth-macbeth/' : trackerHref;
          return (
            <a
              key={c.score.id}
              href={href}
              data-tracker-alias={c.score.id === 'lady-macbeth-macbeth' ? trackerHref : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
                background: C.panel,
                border: `1px solid ${C.rule}`,
                borderRadius: '10px',
                padding: '1.15rem 1.25rem 1.3rem',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div style={{ fontSize: '1.25rem', color: C.accent, lineHeight: 1.2 }}>
                {c.score.title}
              </div>
              {c.score.byline && (
                <div style={{ fontSize: '0.85rem', color: C.muted, fontStyle: 'italic' }}>
                  {c.score.byline}
                </div>
              )}
              {c.score.caption && (
                <div style={{ fontSize: '0.82rem', color: C.muted, lineHeight: 1.5, flex: 1 }}>
                  {c.score.caption}
                </div>
              )}
              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.3rem' }}
              >
                <span style={pill(C.muted)}>
                  {c.voices} {c.voices === 1 ? 'voice' : 'voices'}
                </span>
                <span style={pill(C.muted)}>{c.lines} lines</span>
                {c.human > 0 && <span style={pill(C.accent)}>human + AI</span>}
                {c.chorus && <span style={pill(C.muted)}>chorus</span>}
              </div>
              <div
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: '0.8rem',
                  color: C.accent,
                  marginTop: '0.35rem',
                }}
              >
                ▶ Open in tracker →
              </div>
            </a>
          );
        })}
      </div>
    </main>
  );
}
