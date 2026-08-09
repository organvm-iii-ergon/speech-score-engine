'use client';

import { ClipWaveform } from '@/components/ClipWaveform';
import { loadScript, loadStylesheet } from '@/lib/loadScript';
import { ENGINE_SCRIPT, ENGINE_STYLES, SCORE_SCRIPTS } from '@/lib/scoreScripts';
import { VOICE_CATALOG } from '@/lib/voiceCatalog';
import type { ClipTiming, Lane, Score } from '@/types/sse';
import { useCallback, useEffect, useRef, useState } from 'react';

// The arrangement editor — "Ableton for voice", clip-view "for words". A horizontal timeline: lanes
// stacked vertically, time flowing left→right in beats. Every line is a clip with a beat position AND
// a length (drag the body to retime / recast across lanes; drag the right edge to change how many
// beats it spans). Zoom (px-per-beat) and Snap (1, ½, ⅓, ¼) let you place sub-beat, so different
// lanes can run at independent cadences (polyrhythm). Pointer-capture drag means mouse, touchpad and
// finger all behave identically. Per-clip Warp stretches the audio to fill its beats (vs. natural
// length). Export/import the portable SCORE JSON; Perform through the shared engine.

const LANE_H = 92;
const GUTTER = 168;
const MIN_CLIP_PX = 46; // clips never render narrower than this — a reliable tap/click target
const RESIZE_ZONE = 16; // px at the clip's right edge that grabs the length handle
const ZOOM_MIN = 8;
const ZOOM_MAX = 90;

// snap grid choices in beats — 1 beat, half, triplet, quarter (plus "free" for un-snapped nudging)
const SNAPS: { label: string; beats: number }[] = [
  { label: '1', beats: 1 },
  { label: '½', beats: 0.5 },
  { label: '⅓', beats: 1 / 3 },
  { label: '¼', beats: 0.25 },
  { label: 'free', beats: 0 },
];

const C = {
  stage: '#101012',
  page: '#34393b',
  ink: '#e9e6dc',
  accent: '#cdbf9a',
  rule: 'rgba(233, 230, 220, 0.14)',
  subRule: 'rgba(233, 230, 220, 0.06)',
  faint: 'rgba(233, 230, 220, 0.5)',
  band: 'rgba(255, 255, 255, 0.02)',
  bandAlt: 'rgba(255, 255, 255, 0.04)',
};

interface EditEvent {
  id: string;
  lane: string;
  text: string;
  speechText?: string | undefined;
  silent?: boolean;
  start: number; // beat position (fractional allowed)
  beats: number; // clip length in beats
  warp?: boolean; // stretch audio to fill `beats` (vs. natural recorded length)
  stage?: boolean;
  // L6 audio craft (optional; seconds except gain = level multiplier)
  gain?: number;
  fadeIn?: number;
  fadeOut?: number;
  trimStart?: number;
  trimEnd?: number;
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  pointerId: number;
  startX: number;
  startY: number;
  start0: number;
  beats0: number;
  laneIdx: number;
  moved: boolean;
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';

// Snap a beat value to the active grid (snap.beats === 0 → free / un-snapped).
const snapTo = (b: number, snap: number): number => (snap > 0 ? Math.round(b / snap) * snap : b);
// Trim float dust from snapped/thirds values so exports stay clean and comparisons are stable.
const tidy = (n: number): number => Math.round(n * 1e6) / 1e6;

function blankLanes(): Lane[] {
  return [
    {
      id: 'A',
      name: 'Voice A',
      performer: 'ai',
      voice: 'en-US-AriaNeural',
      pan: -0.3,
      gain: 1,
      tone: { f: 440, type: 'sine' },
    },
    {
      id: 'B',
      name: 'Voice B',
      performer: 'ai',
      voice: 'en-GB-RyanNeural',
      pan: 0.3,
      gain: 1,
      tone: { f: 330, type: 'sine' },
    },
  ];
}

export function EditorClient() {
  const [lanes, setLanes] = useState<Lane[]>(blankLanes);
  const [events, setEvents] = useState<EditEvent[]>([]);
  const [tempo, setTempo] = useState(3);
  const [total, setTotal] = useState(12);
  const [title, setTitle] = useState('Untitled');
  const [scoreId, setScoreId] = useState('untitled');
  const [selected, setSelected] = useState<string | null>(null);
  const [registry, setRegistry] = useState<Record<string, Score>>({});
  const [performing, setPerforming] = useState(false);
  const [clips, setClips] = useState<Record<string, string> | null>(null); // neural pack for L6 craft
  const [timings, setTimings] = useState<Record<string, ClipTiming> | null>(null);
  const [clipDur, setClipDur] = useState(0);
  const [pxPerBeat, setPxPerBeat] = useState(28); // timeline zoom
  const [snapIdx, setSnapIdx] = useState(0); // index into SNAPS

  const snap = SNAPS[snapIdx]?.beats ?? 1;
  const lanesRef = useRef<Lane[]>(lanes);
  lanesRef.current = lanes;
  // Live drag needs current zoom/snap without re-binding capture handlers mid-drag.
  const pxRef = useRef(pxPerBeat);
  pxRef.current = pxPerBeat;
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const dragRef = useRef<DragState | null>(null);
  const seq = useRef(0);
  const uid = () => `e${seq.current++}`;

  const loadScore = useCallback((sc: Score) => {
    setLanes(sc.lanes.map((l) => ({ ...l })));
    setEvents(
      sc.events.map((e, i) => ({
        id: `e${i}`,
        lane: e.lane,
        text: e.text,
        ...(e.speechText ? { speechText: e.speechText } : {}),
        ...(e.silent ? { silent: true } : {}),
        // migrate legacy integer scores: start defaults to row, length to 1 beat
        start: typeof e.start === 'number' ? e.start : e.row,
        beats: typeof e.beats === 'number' && e.beats > 0 ? e.beats : 1,
        ...(e.warp ? { warp: true } : {}),
        ...(e.stage ? { stage: true } : {}),
        ...(typeof e.gain === 'number' ? { gain: e.gain } : {}),
        ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}),
        ...(e.fadeOut ? { fadeOut: e.fadeOut } : {}),
        ...(e.trimStart ? { trimStart: e.trimStart } : {}),
        ...(e.trimEnd ? { trimEnd: e.trimEnd } : {}),
      })),
    );
    seq.current = sc.events.length;
    setTempo(sc.tempo ?? 3);
    setTotal(sc.total);
    setTitle(sc.title);
    setScoreId(sc.id);
    setSelected(null);
  }, []);

  // Load the neural voice pack for a known library score so audio craft is visible and audible.
  // Unknown/edited/imported ids have no pack → clips null (craft controls simply show no waveform).
  useEffect(() => {
    let cancelled = false;
    if (!registry[scoreId]) {
      setClips(null);
      setTimings(null);
      return;
    }
    (async () => {
      await loadScript(`/prototypes/voices/${scoreId}.js`);
      if (cancelled) return;
      const voicePack = window.SSE_VOICES?.[scoreId];
      setClips(voicePack?.clips ?? null);
      setTimings(voicePack?.timings ?? null);
    })().catch(() => {
      if (!cancelled) {
        setClips(null);
        setTimings(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [scoreId, registry]);

  // Load the score registry (for the "start from" picker), and any ?score= starting point.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const src of SCORE_SCRIPTS) await loadScript(src);
      if (cancelled) return;
      const scores = window.SSE_SCORES ?? {};
      setRegistry(scores);
      const wanted = new URLSearchParams(window.location.search).get('score');
      if (wanted && scores[wanted]) loadScore(scores[wanted]);
    })().catch((err) => console.error(err));
    return () => {
      cancelled = true;
    };
  }, [loadScore]);

  // ---- drag/resize a clip via Pointer Capture (mouse · touchpad · finger, identically) ----
  // One handler on the clip: the right RESIZE_ZONE px grab the length handle, the rest moves the clip.
  // setPointerCapture routes every subsequent move/up to this element, so a drag survives leaving the
  // clip's bounds or the window — the key to reliable touch dragging.
  const onClipPointerDown = (e: React.PointerEvent<HTMLButtonElement>, ev: EditEvent) => {
    e.preventDefault();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported — window fallback below still works for mouse */
    }
    const rect = el.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const mode: DragState['mode'] = localX > rect.width - RESIZE_ZONE ? 'resize' : 'move';
    dragRef.current = {
      id: ev.id,
      mode,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      start0: ev.start,
      beats0: ev.beats,
      laneIdx: lanesRef.current.findIndex((l) => l.id === ev.lane),
      moved: false,
    };
  };

  const onClipPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    const ppb = pxRef.current;
    const sn = snapRef.current;
    if (d.mode === 'resize') {
      const minLen = sn > 0 ? sn : 0.25;
      const nb = tidy(Math.max(minLen, snapTo(d.beats0 + dx / ppb, sn)));
      setEvents((prev) => prev.map((x) => (x.id === d.id ? { ...x, beats: nb } : x)));
      return;
    }
    const ns = tidy(Math.max(0, snapTo(d.start0 + dx / ppb, sn)));
    const ls = lanesRef.current;
    const idx = Math.min(ls.length - 1, Math.max(0, d.laneIdx + Math.round(dy / LANE_H)));
    const lane = ls[idx]?.id;
    setEvents((prev) =>
      prev.map((x) => (x.id === d.id ? { ...x, start: ns, ...(lane ? { lane } : {}) } : x)),
    );
  };

  const onClipPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    if (!d) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* nothing captured */
    }
    dragRef.current = null;
    if (!d.moved) setSelected(d.id); // a tap/click (no drag) selects the clip
  };

  // ---- mutations ----
  const nextFreeStart = () => Math.ceil(events.reduce((m, e) => Math.max(m, e.start + e.beats), 0));
  const addClip = () => {
    const laneId =
      (selected ? events.find((e) => e.id === selected)?.lane : undefined) ?? lanes[0]?.id;
    if (!laneId) return;
    const ev: EditEvent = {
      id: uid(),
      start: nextFreeStart(),
      beats: 1,
      lane: laneId,
      text: 'new line',
    };
    setEvents((prev) => [...prev, ev]);
    setSelected(ev.id);
  };
  const duplicateClip = () => {
    const src = events.find((e) => e.id === selected);
    if (!src) return;
    const ev: EditEvent = { ...src, id: uid(), start: tidy(src.start + src.beats) };
    setEvents((prev) => [...prev, ev]);
    setSelected(ev.id);
  };
  const deleteClip = () => {
    if (!selected) return;
    setEvents((prev) => prev.filter((e) => e.id !== selected));
    setSelected(null);
  };
  const patchClip = (patch: Partial<EditEvent>) => {
    if (!selected) return;
    setEvents((prev) => prev.map((e) => (e.id === selected ? { ...e, ...patch } : e)));
  };
  const renameClip = (text: string) => {
    if (!selected) return;
    setEvents((prev) =>
      prev.map((event) => {
        if (event.id !== selected) return event;
        const renamed = { ...event, text, speechText: undefined };
        // A continuous-passage trigger's speechText names the generated full-passage clip.
        // Once its visible text is edited that clip is stale, so fall back to the edited text.
        return renamed;
      }),
    );
  };

  const addLane = () => {
    setLanes((prev) => {
      const n = prev.length + 1;
      const lane: Lane = {
        id: `L${seq.current++}`,
        name: `Voice ${n}`,
        performer: 'ai',
        voice: 'en-US-GuyNeural',
        pan: 0,
        gain: 1,
        tone: { f: 440, type: 'sine' },
      };
      return [...prev, lane];
    });
  };
  const renameLane = (id: string, name: string) => {
    setLanes((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
  };
  const setLaneVoice = (id: string, voice: string) => {
    setLanes((prev) => prev.map((l) => (l.id === id ? { ...l, voice } : l)));
  };
  const toggleLanePerformer = (id: string) => {
    setLanes((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, performer: l.performer === 'human' ? 'ai' : 'human' } : l,
      ),
    );
  };
  const deleteLane = (id: string) => {
    setLanes((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev));
    setEvents((prev) => prev.filter((e) => e.lane !== id));
  };

  // ---- portable SCORE (export / perform) ----
  // Emits the timing model plus a rounded `row` so any un-upgraded consumer still positions roughly;
  // `start` is written only when it differs from that row (i.e. the clip is off the integer grid).
  const toScore = useCallback((): Score => {
    const maxEnd = events.reduce((m, e) => Math.max(m, e.start + e.beats), 0);
    const id = slug(scoreId || title);
    return {
      id,
      short: title,
      title,
      tempo,
      lanes,
      sections: {},
      total: Math.max(total, Math.ceil(maxEnd) + 1),
      events: events
        .slice()
        .sort((a, b) => a.start - b.start)
        .map((e) => {
          const row = Math.round(e.start);
          return {
            row,
            lane: e.lane,
            text: e.text,
            ...(e.speechText ? { speechText: e.speechText } : {}),
            ...(e.silent ? { silent: true } : {}),
            ...(Math.abs(e.start - row) > 1e-6 ? { start: tidy(e.start) } : {}),
            ...(Math.abs(e.beats - 1) > 1e-6 ? { beats: tidy(e.beats) } : {}),
            ...(e.warp ? { warp: true } : {}),
            ...(e.stage ? { stage: true } : {}),
            ...(typeof e.gain === 'number' && e.gain !== 1 ? { gain: e.gain } : {}),
            ...(e.fadeIn ? { fadeIn: e.fadeIn } : {}),
            ...(e.fadeOut ? { fadeOut: e.fadeOut } : {}),
            ...(e.trimStart ? { trimStart: e.trimStart } : {}),
            ...(e.trimEnd ? { trimEnd: e.trimEnd } : {}),
          };
        }),
    };
  }, [events, lanes, tempo, title, scoreId, total]);

  const exportJson = () => {
    const score = toScore();
    const blob = new Blob([JSON.stringify(score, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${score.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Score;
      if (Array.isArray(parsed.lanes) && Array.isArray(parsed.events)) loadScore(parsed);
    } catch (err) {
      console.error(err);
    }
  };

  // ---- perform the current arrangement through the shared engine ----
  const performRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!performing) return;
    let handle: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      // The engine's DOM is styled entirely by tracker.css (scoped .sse); load it alongside the
      // engine or the overlay renders as raw, unstyled HTML.
      await Promise.all([loadStylesheet(ENGINE_STYLES), loadScript(ENGINE_SCRIPT)]);
      const el = performRef.current;
      const engine = window.SSEEngine;
      if (cancelled || !el || !engine) return;
      const score = toScore();
      // Perform with the real neural clips when we have them, so audio craft is audible; else the
      // engine falls back to Web Speech (edited/new lines with no rendered clip do too).
      handle = engine.mount(el, { score, clips, timings, scores: [score] });
    })().catch((err) => console.error(err));
    return () => {
      cancelled = true;
      if (handle) handle.destroy();
    };
  }, [performing, toScore, clips, timings]);

  const selectedEv = events.find((e) => e.id === selected) ?? null;
  const selLane = selectedEv ? (lanes.find((l) => l.id === selectedEv.lane) ?? null) : null;
  const selIsAi = !!selLane && selLane.performer !== 'human';
  const selB64 = selectedEv
    ? (clips?.[`${selectedEv.lane}|${selectedEv.speechText || selectedEv.text}`] ?? null)
    : null;
  const durMax = clipDur > 0 ? clipDur : 4;
  const fadeMax = Math.min(1.5, durMax / 2);
  const maxEnd = events.reduce((m, e) => Math.max(m, e.start + e.beats), 0);
  const timelineW = Math.max(0, maxEnd + 8) * pxPerBeat;
  const timelineH = lanes.length * LANE_H;
  const stepAttr = snap > 0 ? snap : 0.05;

  const btn: React.CSSProperties = {
    fontSize: 12,
    padding: '5px 10px',
    borderRadius: 3,
    border: `1px solid ${C.rule}`,
    background: 'transparent',
    color: C.ink,
    cursor: 'pointer',
  };
  const field: React.CSSProperties = {
    fontSize: 12,
    padding: '4px 6px',
    background: C.stage,
    color: C.ink,
    border: `1px solid ${C.rule}`,
    borderRadius: 3,
  };
  const segBtn = (on: boolean): React.CSSProperties => ({
    ...btn,
    fontSize: 11,
    padding: '3px 8px',
    color: on ? C.accent : C.faint,
    borderColor: on ? C.accent : C.rule,
  });
  type CraftKey = 'gain' | 'fadeIn' | 'fadeOut' | 'trimStart' | 'trimEnd';
  const craftCtl = (
    label: string,
    key: CraftKey,
    min: number,
    max: number,
    step: number,
    def: number,
  ) => {
    const val = (selectedEv?.[key] as number | undefined) ?? def;
    return (
      <label
        style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.faint }}
      >
        <span style={{ width: 58 }}>{label}</span>
        <input
          aria-label={label}
          type="range"
          min={min}
          max={max}
          step={step}
          value={val}
          onChange={(e) =>
            patchClip({ [key]: Number.parseFloat(e.target.value) } as Partial<EditEvent>)
          }
        />
        <span style={{ width: 42, textAlign: 'right', color: C.ink }}>
          {key === 'gain' ? `${val.toFixed(2)}×` : `${val.toFixed(2)}s`}
        </span>
      </label>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: C.stage,
        color: C.ink,
        fontFamily: 'ui-serif, Georgia, serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          padding: '8px 12px',
          borderBottom: `1px solid ${C.rule}`,
        }}
      >
        <strong style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 11 }}>
          Arrange
        </strong>
        <input
          aria-label="Score title"
          style={{ ...field, width: 160 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label style={{ fontSize: 11, color: C.faint }}>
          Tempo{' '}
          <input
            aria-label="Tempo"
            type="range"
            min={1}
            max={9}
            step={0.5}
            value={tempo}
            onChange={(e) => setTempo(Number.parseFloat(e.target.value))}
          />
        </label>
        <label style={{ fontSize: 11, color: C.faint }}>
          Zoom{' '}
          <input
            aria-label="Zoom (pixels per beat)"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={1}
            value={pxPerBeat}
            onChange={(e) => setPxPerBeat(Number.parseFloat(e.target.value))}
          />
        </label>
        <span style={{ fontSize: 11, color: C.faint }}>Snap</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {SNAPS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              aria-label={`Snap ${s.label}`}
              aria-pressed={i === snapIdx}
              style={segBtn(i === snapIdx)}
              onClick={() => setSnapIdx(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} onClick={addClip}>
          + Clip
        </button>
        <button type="button" style={btn} onClick={addLane}>
          + Lane
        </button>
        <select
          aria-label="Start from a score"
          style={field}
          value=""
          onChange={(e) => {
            const sc = registry[e.target.value];
            if (sc) loadScore(sc);
          }}
        >
          <option value="">Start from…</option>
          {Object.values(registry).map((s) => (
            <option key={s.id} value={s.id}>
              {s.short ?? s.title}
            </option>
          ))}
        </select>
        <label style={{ ...btn }}>
          Import
          <input
            aria-label="Import score JSON"
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importJson(f);
            }}
          />
        </label>
        <button type="button" style={btn} onClick={exportJson}>
          Export JSON
        </button>
        <button
          type="button"
          style={{ ...btn, borderColor: C.accent, color: C.accent }}
          onClick={() => setPerforming(true)}
        >
          ▶ Perform
        </button>
      </div>

      {/* arrange area: lane labels + clip timeline */}
      <div style={{ flex: 1, display: 'flex', overflow: 'auto' }}>
        {/* lane label column */}
        <div
          style={{
            width: GUTTER,
            flexShrink: 0,
            position: 'sticky',
            left: 0,
            zIndex: 2,
            background: C.stage,
          }}
        >
          {lanes.map((l) => (
            <div
              key={l.id}
              style={{
                height: LANE_H,
                borderBottom: `1px solid ${C.rule}`,
                padding: '6px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                justifyContent: 'center',
              }}
            >
              <input
                aria-label={`Lane name for ${l.id}`}
                style={{ ...field, color: l.performer === 'human' ? C.accent : C.ink }}
                value={l.name ?? l.id}
                onChange={(e) => renameLane(l.id, e.target.value)}
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  style={{
                    ...btn,
                    fontSize: 10,
                    padding: '2px 6px',
                    color: l.performer === 'human' ? C.accent : C.faint,
                  }}
                  onClick={() => toggleLanePerformer(l.id)}
                >
                  {l.performer === 'human' ? '● live' : 'AI'}
                </button>
                <button
                  type="button"
                  style={{ ...btn, fontSize: 10, padding: '2px 6px', color: C.faint }}
                  onClick={() => deleteLane(l.id)}
                >
                  ✕
                </button>
              </div>
              {l.performer !== 'human' && (
                <select
                  aria-label={`Voice for ${l.name ?? l.id}`}
                  style={{ ...field, fontSize: 10, padding: '2px 4px' }}
                  value={l.voice ?? ''}
                  onChange={(e) => setLaneVoice(l.id, e.target.value)}
                >
                  {!l.voice && <option value="">voice…</option>}
                  {l.voice && !VOICE_CATALOG.some((v) => v.id === l.voice) && (
                    <option value={l.voice}>{l.voice}</option>
                  )}
                  {VOICE_CATALOG.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>

        {/* timeline — beat grid (major every beat, faint sub-grid at the snap) */}
        <div
          style={{
            position: 'relative',
            width: timelineW,
            height: timelineH,
            minWidth: '100%',
            touchAction: 'pan-x pan-y',
            backgroundImage: [
              `repeating-linear-gradient(90deg, ${C.rule} 0, ${C.rule} 1px, transparent 1px, transparent ${pxPerBeat}px)`,
              snap > 0 && snap < 1
                ? `repeating-linear-gradient(90deg, ${C.subRule} 0, ${C.subRule} 1px, transparent 1px, transparent ${pxPerBeat * snap}px)`
                : '',
            ]
              .filter(Boolean)
              .join(', '),
          }}
        >
          {/* lane bands */}
          {lanes.map((l, i) => (
            <div
              key={l.id}
              style={{
                position: 'absolute',
                top: i * LANE_H,
                left: 0,
                right: 0,
                height: LANE_H,
                background: i % 2 === 0 ? C.band : C.bandAlt,
                borderBottom: `1px solid ${C.rule}`,
              }}
            />
          ))}
          {/* clips */}
          {events.map((ev) => {
            const laneIdx = lanes.findIndex((l) => l.id === ev.lane);
            if (laneIdx < 0) return null;
            const human = lanes[laneIdx]?.performer === 'human';
            const isSel = ev.id === selected;
            const w = Math.max(MIN_CLIP_PX, ev.beats * pxPerBeat);
            return (
              <button
                type="button"
                key={ev.id}
                title={ev.text}
                onPointerDown={(e) => onClipPointerDown(e, ev)}
                onPointerMove={onClipPointerMove}
                onPointerUp={onClipPointerUp}
                onPointerCancel={onClipPointerUp}
                style={{
                  position: 'absolute',
                  left: ev.start * pxPerBeat,
                  top: laneIdx * LANE_H + 8,
                  width: w,
                  height: LANE_H - 16,
                  padding: '2px 8px',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  cursor: 'grab',
                  color: human ? C.accent : C.ink,
                  background: isSel ? 'rgba(205, 191, 154, 0.18)' : 'rgba(0, 0, 0, 0.25)',
                  border: `1px ${ev.warp ? 'dashed' : 'solid'} ${isSel ? C.accent : C.rule}`,
                  borderRadius: 4,
                  touchAction: 'none',
                }}
              >
                {ev.warp ? '⟿ ' : ''}
                {ev.text}
                {/* length handle: the right edge (RESIZE_ZONE px) resizes instead of moves */}
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: RESIZE_ZONE,
                    cursor: 'ew-resize',
                    borderRight: `2px solid ${isSel ? C.accent : 'transparent'}`,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* selected-clip inspector */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '8px 12px',
          borderTop: `1px solid ${C.rule}`,
        }}
      >
        <div
          style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 46 }}
        >
          {selectedEv ? (
            <>
              <input
                aria-label="Clip text"
                style={{ ...field, flex: 1, minWidth: 180 }}
                value={selectedEv.text}
                onChange={(e) => renameClip(e.target.value)}
              />
              <select
                aria-label="Clip lane"
                style={field}
                value={selectedEv.lane}
                onChange={(e) => patchClip({ lane: e.target.value })}
              >
                {lanes.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name ?? l.id}
                  </option>
                ))}
              </select>
              <label style={{ fontSize: 11, color: C.faint }}>
                Start{' '}
                <input
                  aria-label="Clip start (beats)"
                  type="number"
                  min={0}
                  step={stepAttr}
                  style={{ ...field, width: 72 }}
                  value={selectedEv.start}
                  onChange={(e) =>
                    patchClip({ start: tidy(Math.max(0, Number.parseFloat(e.target.value) || 0)) })
                  }
                />
              </label>
              <label style={{ fontSize: 11, color: C.faint }}>
                Length{' '}
                <input
                  aria-label="Clip length (beats)"
                  type="number"
                  min={stepAttr}
                  step={stepAttr}
                  style={{ ...field, width: 72 }}
                  value={selectedEv.beats}
                  onChange={(e) =>
                    patchClip({
                      beats: tidy(
                        Math.max(stepAttr, Number.parseFloat(e.target.value) || stepAttr),
                      ),
                    })
                  }
                />
              </label>
              {selIsAi && (
                <label
                  style={{
                    fontSize: 11,
                    color: selectedEv.warp ? C.accent : C.faint,
                    display: 'flex',
                    gap: 4,
                    alignItems: 'center',
                  }}
                  title="Stretch the audio to fill the clip's beats (repitches — natural → madness). Off = play natural length."
                >
                  <input
                    aria-label="Warp to grid"
                    type="checkbox"
                    checked={!!selectedEv.warp}
                    onChange={(e) => patchClip({ warp: e.target.checked })}
                  />
                  Warp
                </label>
              )}
              <button type="button" style={btn} onClick={duplicateClip}>
                Duplicate
              </button>
              <button type="button" style={{ ...btn, color: '#e0a0a0' }} onClick={deleteClip}>
                Delete
              </button>
            </>
          ) : (
            <span style={{ fontSize: 12, color: C.faint }}>
              Drag a clip to retime (⇄) or recast across lanes (↕); drag its right edge to change
              length. Tap/click a clip to edit it. Snap sets sub-beat placement.
            </span>
          )}
        </div>

        {/* L6 audio craft — shape the selected AI clip: trim, gain, fades (live waveform) */}
        {selectedEv && selIsAi && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 480px', minWidth: 240 }}>
              <ClipWaveform
                base64={selB64}
                gain={selectedEv.gain ?? 1}
                fadeIn={selectedEv.fadeIn ?? 0}
                fadeOut={selectedEv.fadeOut ?? 0}
                trimStart={selectedEv.trimStart ?? 0}
                trimEnd={selectedEv.trimEnd ?? 0}
                onDuration={setClipDur}
              />
              {!selB64 && (
                <span style={{ fontSize: 11, color: C.faint }}>
                  No rendered clip for this line (edited or unvoiced) — shaping still exports;
                  render to hear it.
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {craftCtl('Gain', 'gain', 0, 2, 0.05, 1)}
              {craftCtl('Fade in', 'fadeIn', 0, fadeMax, 0.02, 0)}
              {craftCtl('Fade out', 'fadeOut', 0, fadeMax, 0.02, 0)}
              {craftCtl('Trim head', 'trimStart', 0, durMax, 0.02, 0)}
              {craftCtl('Trim tail', 'trimEnd', 0, durMax, 0.02, 0)}
              <button
                type="button"
                style={{ ...btn, fontSize: 11, alignSelf: 'flex-start' }}
                onClick={() =>
                  patchClip({ gain: 1, fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0 })
                }
              >
                Reset audio
              </button>
            </div>
          </div>
        )}
      </div>

      {/* perform overlay */}
      {performing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10, background: C.stage }}>
          <button
            type="button"
            style={{ ...btn, position: 'absolute', top: 10, right: 10, zIndex: 11 }}
            onClick={() => setPerforming(false)}
          >
            ✕ Close
          </button>
          <div ref={performRef} style={{ width: '100%', height: '100%' }} />
        </div>
      )}
    </div>
  );
}
