'use client';

import { loadScript } from '@/lib/loadScript';
import { ENGINE_SCRIPT, SCORE_SCRIPTS } from '@/lib/scoreScripts';
import type { Score, TrackerHandle } from '@/types/sse';
import { useEffect, useRef } from 'react';

// The shared engine + all score data (for the picker), loaded once from /public. The active
// score's voice pack is loaded lazily afterwards. Same files the standalone HTML uses.
const CORE_SCRIPTS = [...SCORE_SCRIPTS, ENGINE_SCRIPT];

function pickId(scores: Record<string, Score>): string | undefined {
  const wanted = new URLSearchParams(window.location.search).get('score');
  if (wanted && scores[wanted]) return wanted;
  if (scores['philip-glass']) return 'philip-glass';
  return Object.keys(scores)[0];
}

export function TrackerClient() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let handle: TrackerHandle | null = null;
    let cancelled = false;

    const run = async () => {
      for (const src of CORE_SCRIPTS) await loadScript(src);
      const scores = window.SSE_SCORES;
      const engine = window.SSEEngine;
      const el = ref.current;
      if (cancelled || !scores || !engine || !el) return;
      const id = pickId(scores);
      if (!id) return;
      const score = scores[id];
      if (!score) return;
      await loadScript(`/prototypes/voices/${id}.js`);
      if (cancelled) return;
      const voicePack = window.SSE_VOICES?.[id];
      handle = engine.mount(el, {
        score,
        clips: voicePack?.clips ?? null,
        timings: voicePack?.timings ?? null,
        scores: Object.values(scores),
        onPick: (nextId: string) => {
          const params = new URLSearchParams(window.location.search);
          params.set('score', nextId);
          window.location.search = params.toString();
        },
      });
    };

    run().catch((err) => {
      console.error(err);
    });

    return () => {
      cancelled = true;
      if (handle) handle.destroy();
    };
  }, []);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
