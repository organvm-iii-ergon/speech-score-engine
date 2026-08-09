// Speech-Score tracker — the shared engine core for BOTH surfaces.
//
// It is a CLASSIC script (no ES imports, no fetch) so it runs over file:// (the standalone HTML)
// AND over http (the Next route injects this same file). It exposes:
//
//   window.SSEEngine.mount(rootEl, { score, clips, scores, onPick }) -> { destroy }
//
// The engine builds the entire widget inside rootEl (title, lanes, playhead, transport) from the
// SCORE data — any number of lanes, any casting. Audio, best-first: pre-rendered neural clips
// (polyphonic + zero-latency, humanized + panned) -> Web Speech -> Web Audio tones. Human lanes
// (performer:'human') are left silent for a live actor. Styles live in tracker.css (scope .sse).
(() => {
  const TEMPLATE = [
    '<div class="title">',
    '  <div class="mark">Speech-Score Engine</div>',
    '  <h1 class="t-title"></h1>',
    '  <div class="by t-byline"></div>',
    '</div>',
    '<div class="heads t-heads"></div>',
    '<div class="viewport t-viewport"><div class="track t-track"></div></div>',
    '<div class="caption t-caption"></div>',
    '<div class="transport">',
    '  <div class="trow"><div class="seg t-scores"></div></div>',
    '  <div class="tempo"><label>Tempo</label>',
    '    <input class="t-tempo" type="range" min="1" max="9" step="0.5" /></div>',
    '  <div class="trow">',
    '    <button class="btn primary t-play">▷ Perform</button>',
    '    <button class="btn t-restart">↺ Restart</button>',
    '    <div class="seg t-sound">',
    '      <button data-m="voice" class="on">Voices</button>',
    '      <button data-m="tone">Tones</button>',
    '      <button data-m="off">Silent</button>',
    '    </div>',
    '  </div>',
    '  <div class="trow">',
    '    <div class="seg t-mode">',
    '      <button data-mode="clock" class="on">Metronome</button>',
    '      <button data-mode="cue">Live cue</button>',
    '    </div>',
    '    <button class="btn t-countin">Count-in</button>',
    '  </div>',
    '  <div class="trow"><div class="seg t-sections"></div></div>',
    '  <div class="trow"><span class="hint t-hint"></span></div>',
    '</div>',
    '<div class="count t-count"></div>',
  ].join('\n');

  function mount(root, opts) {
    const SC = opts.score;
    const CLIPS = opts.clips || null;
    const TIMINGS = opts.timings || null;
    const ALL = opts.scores || [SC];
    const onPick =
      opts.onPick ||
      ((id) => {
        const p = new URLSearchParams(location.search);
        p.set('score', id);
        location.search = p.toString();
      });

    root.classList.add('sse');
    root.innerHTML = TEMPLATE;
    const q = (sel) => root.querySelector(sel);

    // ---- derive everything from the score ----
    const LANES = SC.lanes;
    const CH = LANES.map((l) => l.id);
    const HEAD = {};
    const laneById = new Map(LANES.map((l) => [l.id, l]));
    const isHuman = (lane) => laneById.get(lane)?.performer === 'human';
    const TONES = {};
    const CHVOX = {};
    const VOX = {};
    for (const l of LANES) {
      HEAD[l.id] = l.name || l.id;
      TONES[l.id] = { f: l.tone?.f || 440, t: l.tone?.type || 'sine' };
      CHVOX[l.id] = {
        pan: typeof l.pan === 'number' ? l.pan : 0,
        rate: 1.0,
        gain: typeof l.gain === 'number' ? l.gain : 1.0,
      };
      VOX[l.id] = l.speech || { pitch: 1.0, rate: 1.0, prefer: [] };
    }
    const EV = SC.events;
    const rand = (a, b) => a + Math.random() * (b - a);

    // ---- timing model: fractional beat positions + clip lengths ("Ableton clip view for words") ----
    // Each event carries a beat position (`start`, default = its integer `row`) and a length in beats
    // (`beats`, default 1). The transport still steps a uniform integer grid, so we derive the finest
    // subdivision (ticks per beat) that lands every start on a whole tick. SUBDIV=1 when all starts are
    // whole numbers — legacy integer scores stay byte-identical. Sub-beat starts (2.5, triplets, …)
    // raise SUBDIV so lanes can run at independent cadences (polyrhythm / multiple rhythms).
    const evStartBeats = (ev) => (typeof ev.start === 'number' ? ev.start : ev.row);
    const evBeats = (ev) => (typeof ev.beats === 'number' && ev.beats > 0 ? ev.beats : 1);
    const deriveSubdiv = (vals) => {
      for (const s of [1, 2, 3, 4, 6, 8, 12, 16]) {
        if (vals.every((x) => Math.abs(x * s - Math.round(x * s)) < 1e-6)) return s;
      }
      return 16;
    };
    const SUBDIV = deriveSubdiv(EV.map(evStartBeats));
    for (const ev of EV) ev.tick = Math.round(evStartBeats(ev) * SUBDIV);
    const SECTIONS = {};
    for (const [k, span] of Object.entries(SC.sections || {})) {
      SECTIONS[k] = [Math.round(span[0] * SUBDIV), Math.round(span[1] * SUBDIV)];
    }
    const maxTick = EV.length
      ? Math.max(...EV.map((ev) => ev.tick + Math.max(1, Math.round(evBeats(ev) * SUBDIV))))
      : 0;
    const TOTAL = Math.max(Math.round((SC.total || 0) * SUBDIV), maxTick + SUBDIV);

    root.style.setProperty('--lanes', `repeat(${CH.length}, minmax(0, 1fr))`);
    q('.t-title').textContent = SC.title;
    q('.t-byline').textContent = SC.byline || '';
    q('.t-caption').textContent = SC.caption || '';

    const eventsByRow = new Map(); // keyed by grid tick (integer), not raw beat
    for (const ev of EV) {
      if (!eventsByRow.has(ev.tick)) eventsByRow.set(ev.tick, []);
      eventsByRow.get(ev.tick).push(ev);
    }

    // ---- audio ----
    let silent = false;
    let soundMode = 'voice';
    let tempoBps = SC.tempo || 3; // musical tempo — beats per second (what the Tempo slider sets)
    let rps = tempoBps * SUBDIV; // transport grid steps (ticks) per second = tempo × subdivision
    const muted = new Set(); // lanes silenced via a header click (still illuminate)
    const soloed = new Set(); // lanes soloed via ⌥/Alt-click — when any is set, only these sound

    // -- source A: Web Speech API (fallback when no neural clips are present) --
    const synth = window.speechSynthesis || null;
    const VOICE_ASSIGN = {};
    const loadVoices = () => {
      if (!synth) return;
      const all = synth.getVoices() || [];
      if (!all.length) return;
      const en = all.filter((v) => /en(-|_|$)/i.test(v.lang));
      const pool = en.length ? en : all;
      const used = new Set();
      for (const ch of CH) {
        if (isHuman(ch)) continue;
        let pick = null;
        for (const h of VOX[ch].prefer || []) {
          pick = pool.find((v) => !used.has(v.name) && v.name.toLowerCase().includes(h));
          if (pick) break;
        }
        if (!pick) pick = pool.find((v) => !used.has(v.name)) || pool[0];
        if (pick) {
          VOICE_ASSIGN[ch] = pick;
          used.add(pick.name);
        }
      }
    };
    if (synth) {
      loadVoices();
      synth.addEventListener('voiceschanged', loadVoices);
    }
    const speak = (events) => {
      if (!synth) return false;
      const seen = new Map();
      for (const ev of events) {
        const text = ev.speechText || ev.text;
        if (!seen.has(text)) seen.set(text, ev.lane);
      }
      synth.resume();
      if (synth.pending) synth.cancel();
      for (const [text, ch] of seen) {
        const u = new SpeechSynthesisUtterance(text);
        const v = VOICE_ASSIGN[ch];
        if (v) u.voice = v;
        const spec = VOX[ch];
        u.pitch = spec.pitch;
        u.rate = Math.min(2.2, spec.rate * Math.max(1, tempoBps / 3));
        u.volume = 1;
        synth.speak(u);
      }
      return true;
    };

    // -- source B: Web Audio tone stack (final fallback) --
    let ctx = null;
    let master = null;
    const ensureCtx = () => {
      if (ctx) return true;
      try {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!C) return false;
        ctx = new C();
        master = ctx.createGain();
        master.gain.value = 0.9;
        master.connect(ctx.destination);
        return true;
      } catch (err) {
        ctx = null;
        return false;
      }
    };
    const tone = (channel, when) => {
      if (!ctx || !master) return;
      const spec = TONES[channel];
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = spec.t;
      osc.frequency.setValueAtTime(spec.f, when);
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.2, when + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
      osc.connect(env);
      env.connect(master);
      osc.start(when);
      osc.stop(when + 0.4);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
      };
    };

    // -- source 0: pre-rendered neural clips as Web Audio buffers --
    const SAMP = { buf: new Map(), ready: false, loading: false };
    const activeSources = new Set();
    const stopSamples = () => {
      for (const source of activeSources) {
        try {
          source.stop();
        } catch (err) {
          /* source already ended */
        }
      }
      activeSources.clear();
    };
    const b64ToBuf = (b64) => {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    };
    // Seconds of leading near-silence to skip so a trigger speaks immediately (no pre-roll lag).
    const leadOffset = (buffer) => {
      const d = buffer.getChannelData(0);
      const thresh = 0.012;
      let i = 0;
      for (; i < d.length; i += 1) if (Math.abs(d[i]) > thresh) break;
      const off = i / buffer.sampleRate - 0.02;
      return off > 0 ? off : 0;
    };
    const loadSamples = async () => {
      if (SAMP.ready || SAMP.loading) return SAMP.ready;
      if (!CLIPS || !ensureCtx() || !ctx) return false;
      SAMP.loading = true;
      await Promise.all(
        Object.entries(CLIPS).map(async ([key, b64]) => {
          try {
            const buffer = await ctx.decodeAudioData(b64ToBuf(b64));
            // A timed clip keeps its source pre-roll because its generated word boundaries are
            // measured from that exact stream. Untimed legacy clips retain the immediate-start trim.
            SAMP.buf.set(key, { buffer, offset: TIMINGS?.[key] ? 0 : leadOffset(buffer) });
          } catch (err) {
            /* skip an undecodable clip */
          }
        }),
      );
      SAMP.ready = SAMP.buf.size > 0;
      SAMP.loading = false;
      return SAMP.ready;
    };
    // Play one line on one lane: that character's own neural clip, humanized + panned. Per-clip
    // AUDIO CRAFT (L6) is honored straight from the event: trimStart/trimEnd (seconds off head/tail),
    // gain (level multiplier), fadeIn/fadeOut (seconds). Absent params → the original behaviour.
    const playSample = (ev, when) => {
      const channel = ev.lane;
      const speechText = ev.speechText || ev.text;
      const timingKey = `${channel}|${speechText}`;
      const deterministic = Boolean(TIMINGS?.[timingKey]);
      const clip = SAMP.buf.get(`${channel}|${speechText}`) || SAMP.buf.get(speechText);
      if (!clip || !ctx || !master) return false;
      const spec = CHVOX[channel] || { pan: 0, rate: 1, gain: 1 };
      const src = ctx.createBufferSource();
      src.buffer = clip.buffer;
      if (src.detune) src.detune.value = deterministic ? 0 : rand(-8, 8);
      // trim window within the buffer, and the audible portion (in BUFFER seconds) that remains
      const dur = clip.buffer.duration;
      const start = Math.max(0, (clip.offset || 0) + (ev.trimStart || 0));
      const sourceEnd =
        typeof ev.timingEnd === 'number' ? Math.min(dur, ev.timingEnd) : dur - (ev.trimEnd || 0);
      const srcDur = Math.max(0.02, sourceEnd - start);
      // WARP: stretch the clip to fill its beat-length on the grid. `warp` off → play the recorded
      // length at natural pitch (place-and-play). `warp` on → the same knob that locks a word to the
      // beat also, pushed far, distorts its natural voice "into madness": playbackRate repitches as
      // it stretches (Ableton's Repitch warp). Pitch-preserving warp is a later tier.
      const beatsPerSec = SUBDIV ? rps / SUBDIV : rps;
      let rate = spec.rate * (deterministic ? 1 : rand(0.997, 1.003));
      let outDur = srcDur / rate; // wall-clock output seconds (place-and-play)
      if (ev.warp && beatsPerSec > 0) {
        const target = Math.max(0.05, evBeats(ev) / beatsPerSec);
        rate = Math.min(8, Math.max(0.1, srcDur / target));
        outDur = target;
      }
      src.playbackRate.value = rate;
      const playDur = srcDur; // buffer seconds to consume (start() duration is in source time)
      const level = spec.gain * (typeof ev.gain === 'number' ? ev.gain : 1) * rand(0.88, 1.0);
      const fin = Math.min(ev.fadeIn || 0, outDur / 2);
      const fout = Math.min(ev.fadeOut || 0, outDur / 2);
      const g = ctx.createGain();
      const t = Math.max(when, ctx.currentTime);
      // gain envelope: (fade in) → hold at level → (fade out). Scheduled in ctx time against the
      // wall-clock output duration, so fades stay correct whether or not the clip is warped.
      if (fin > 0) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(level, t + fin);
      } else {
        g.gain.setValueAtTime(level, t);
      }
      if (fout > 0) {
        g.gain.setValueAtTime(level, t + Math.max(fin, outDur - fout));
        g.gain.linearRampToValueAtTime(0.0001, t + outDur);
      }
      // subtle pitch LFO — the "low-frequency oscillation"; kept small so speech stays natural
      let lfo = null;
      let lfoGain = null;
      if (src.detune && !deterministic) {
        lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = rand(4.5, 6.5);
        lfoGain = ctx.createGain();
        lfoGain.gain.value = rand(1.5, 4);
        lfo.connect(lfoGain).connect(src.detune);
      }
      const cleanup = (nodes) => () => {
        for (const n of nodes) n.disconnect();
        if (lfo) lfo.stop();
      };
      src.connect(g);
      let tail = [src, g];
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = spec.pan;
        g.connect(p);
        p.connect(master);
        tail = [src, g, p];
      } else {
        g.connect(master);
      }
      if (lfoGain) tail = tail.concat([lfoGain]);
      const cleanupSource = cleanup(tail);
      src.onended = () => {
        activeSources.delete(src);
        cleanupSource();
      };
      activeSources.add(src);
      src.start(t, start, playDur);
      if (lfo) lfo.start(t);
      return true;
    };

    const voice = (events) => {
      if (silent || !events || !events.length) return;
      // Audibility, one decision: never a human lane; when any lane is soloed only soloed lanes
      // sound (solo overrides mute, the DAW convention); otherwise everything unmuted sounds.
      const audible = events.filter((ev) => {
        if (ev.silent) return false;
        if (isHuman(ev.lane)) return false;
        return soloed.size ? soloed.has(ev.lane) : !muted.has(ev.lane);
      });
      if (!audible.length) return;
      if (soundMode === 'voice') {
        if (CLIPS) {
          if (SAMP.ready) {
            const base = ctx.currentTime + 0.015;
            let any = false;
            for (const ev of audible) {
              const key = `${ev.lane}|${ev.speechText || ev.text}`;
              const stagger = TIMINGS?.[key] ? 0 : rand(0, 0.028);
              if (playSample(ev, base + stagger)) any = true;
            }
            if (any) return;
            // a clip pack is loaded but none matched (e.g. text edited in the editor) -> speak it
            if (synth && speak(audible)) return;
          } else {
            loadSamples();
            return;
          }
        } else if (synth && speak(audible)) {
          return;
        }
      }
      if (!ensureCtx() || !ctx) return;
      const now = ctx.currentTime;
      for (const ev of audible) tone(ev.lane, now);
    };

    // ---- build view ----
    const track = q('.t-track');
    const viewport = q('.t-viewport');
    const heads = q('.t-heads');
    const cellRef = new Map();

    const gh = document.createElement('div');
    gh.className = 'h gut';
    heads.appendChild(gh);
    for (const c of CH) {
      const el = document.createElement('div');
      const align = laneById.get(c)?.align;
      el.className = `h${isHuman(c) ? ' live' : ''}${align ? ` align-${align}` : ''}`;
      el.textContent = HEAD[c];
      el.dataset.lane = c;
      el.title = 'click = mute · ⌥/Alt-click = solo';
      heads.appendChild(el);
    }

    const rowEls = [];
    for (let r = 0; r < TOTAL; r += 1) {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.position = 'relative';
      const num = document.createElement('div');
      num.className = 'rownum';
      // label whole beats, every 4th one (identical to the legacy `r % 4` cadence when SUBDIV=1)
      num.textContent =
        r % SUBDIV === 0 && (r / SUBDIV) % 4 === 0 ? String(r / SUBDIV).padStart(2, '0') : '';
      row.appendChild(num);
      for (const c of CH) {
        const cell = document.createElement('div');
        const align = laneById.get(c)?.align;
        cell.className = `cell${align ? ` align-${align}` : ''}`;
        cellRef.set(`${r}:${c}`, cell);
        row.appendChild(cell);
      }
      track.appendChild(row);
      rowEls.push(row);
    }
    for (const ev of EV) {
      const cell = cellRef.get(`${ev.tick}:${ev.lane}`);
      if (!cell) continue;
      const span = document.createElement('span');
      span.className = `word${ev.stage ? ' stage' : ''}${isHuman(ev.lane) ? ' live' : ''}`;
      span.textContent = ev.text;
      cell.appendChild(span);
      ev.el = span;
    }

    // Continuous-passage scores can show many visual lines while triggering one full voice clip.
    // Map those lines to the word boundaries captured with that exact clip, lane by lane. A normal
    // line-per-clip score does not opt into this path and keeps the metronome-row illumination.
    const textTokens = (value) =>
      (
        String(value)
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) || []
      ).map((word) => word.normalize('NFKC'));
    const deriveTimedCues = () => {
      if (!TIMINGS || !EV.some((ev) => ev.speechText)) return null;
      const allCues = [];
      for (const lane of CH) {
        const entry = Object.entries(TIMINGS).find(([key]) => key.startsWith(`${lane}|`));
        if (!entry || !Array.isArray(entry[1]?.words)) return null;
        const words = entry[1].words;
        const laneEvents = EV.filter((ev) => ev.lane === lane && ev.el).sort(
          (a, b) => a.tick - b.tick,
        );
        let cursor = 0;
        const laneCues = [];
        for (const ev of laneEvents) {
          const expected = textTokens(ev.text);
          const actual = words.slice(cursor, cursor + expected.length);
          if (
            !expected.length ||
            expected.join('|') !== actual.map((word) => textTokens(word.text)[0]).join('|')
          ) {
            return null;
          }
          cursor += expected.length;
          laneCues.push({ ev, start: actual[0].start, spokenEnd: actual.at(-1).end });
        }
        if (cursor !== words.length) return null;
        laneCues.forEach((cue, index) => {
          allCues.push({
            ...cue,
            end: laneCues[index + 1]?.start ?? cue.spokenEnd + 0.08,
          });
        });
      }
      return allCues;
    };
    const timedCues = deriveTimedCues();

    // ---- score picker + section chips ----
    const scoresSeg = q('.t-scores');
    for (const s of ALL) {
      const b = document.createElement('button');
      b.dataset.score = s.id;
      b.textContent = s.short || s.title;
      if (s.id === SC.id) b.classList.add('on');
      scoresSeg.appendChild(b);
    }
    const onScorePick = (e) => {
      const b = e.target.closest('button');
      if (!b || b.dataset.score === SC.id) return;
      onPick(b.dataset.score);
    };
    scoresSeg.addEventListener('click', onScorePick);

    const sections = q('.t-sections');
    for (const key of Object.keys(SECTIONS)) {
      const b = document.createElement('button');
      b.dataset.s = key;
      b.textContent = key.charAt(0).toUpperCase() + key.slice(1);
      sections.appendChild(b);
    }
    const wholeBtn = document.createElement('button');
    wholeBtn.dataset.s = 'full';
    wholeBtn.textContent = 'Whole';
    wholeBtn.classList.add('on');
    sections.appendChild(wholeBtn);

    // ---- state + transport ----
    let playing = false;
    let starting = false;
    let currentRow = 0;
    let hasStruckCurrent = false;
    let sel = 'full';
    let rafId = null;
    let lastTs = 0;
    let acc = 0;
    let rowH = 26;
    let visibleRows = 24;
    let hereEl = null;
    let nowWords = [];
    let timedStartTs = null;
    let timedLaneOffsets = new Map();
    let timedPassageDuration = 0;
    // L5 — live human+AI performance
    let cue = false; // cue mode: a human drives the pace (Space advances), AI answers on its rows
    let cued = false; // has the first line been struck since (re)entering cue mode
    let countin = false; // 3·2·1 pre-roll before a metronome performance
    let counting = false;
    let countTimer = null;
    let midi = null; // Web MIDI access (lazy — requested on first cue entry; best-effort)
    let midiInputs = [];

    const measure = () => {
      rowH = rowEls[0] ? rowEls[0].offsetHeight : 26;
      visibleRows = Math.max(8, Math.floor(viewport.clientHeight / rowH));
    };
    const range = () => (sel === 'full' ? [0, TOTAL - 1] : SECTIONS[sel]);
    const clearPerformed = () => {
      for (const ev of EV) {
        if (ev.el) ev.el.classList.remove('spoken', 'now');
      }
      nowWords = [];
      timedStartTs = null;
      timedLaneOffsets = new Map();
      timedPassageDuration = 0;
    };
    const renderRow = (row) => {
      if (hereEl) hereEl.classList.remove('here');
      const el = rowEls[row];
      el.classList.add('here');
      hereEl = el;
      const lead = Math.floor(visibleRows * 0.4);
      const maxOff = Math.max(0, track.scrollHeight - viewport.clientHeight);
      const off = Math.min(Math.max(0, (row - lead) * rowH), maxOff);
      track.style.transform = `translateY(${-off}px)`;
    };
    const illuminate = (row) => {
      if (timedCues) return;
      for (const w of nowWords) w.classList.remove('now');
      nowWords = [];
      const evs = eventsByRow.get(row);
      if (!evs) return;
      for (const ev of evs) {
        if (!ev.el) continue;
        ev.el.classList.add('spoken');
        void ev.el.offsetWidth;
        ev.el.classList.add('now');
        nowWords.push(ev.el);
      }
    };
    const illuminateTimed = (timestamp) => {
      if (!timedCues || timedStartTs === null) return;
      const elapsed = Math.max(0, (timestamp - timedStartTs) / 1000);
      const [sectionStart, sectionEnd] = range();
      nowWords = [];
      for (const cue of timedCues) {
        const seconds = elapsed + (timedLaneOffsets.get(cue.ev.lane) || 0);
        const inSection = cue.ev.tick >= sectionStart && cue.ev.tick < sectionEnd;
        const isNow = inSection && seconds >= cue.start && seconds < cue.end;
        cue.ev.el.classList.toggle('now', isNow);
        cue.ev.el.classList.toggle('spoken', seconds >= cue.end);
        if (isNow) nowWords.push(cue.ev.el);
      }
      if (nowWords.length) {
        const activeRows = timedCues
          .filter((cue) => nowWords.includes(cue.ev.el))
          .map((cue) => cue.ev.tick);
        const activeRow = Math.max(...activeRows);
        if (activeRow !== currentRow) {
          currentRow = activeRow;
          renderRow(activeRow);
        }
      }
    };
    const planTimedPassage = (sectionStart, sectionEnd) => {
      if (!timedCues) return null;
      const passageEvents = [];
      const offsets = new Map();
      let passageDuration = 0;
      for (const lane of CH) {
        const laneCues = timedCues
          .filter((cue) => cue.ev.lane === lane)
          .sort((a, b) => a.ev.tick - b.ev.tick);
        const firstCue = laneCues.find(
          (cue) => cue.ev.tick >= sectionStart && cue.ev.tick < sectionEnd,
        );
        if (!firstCue) continue;
        const nextSectionCue = laneCues.find((cue) => cue.ev.tick >= sectionEnd);
        const sourceEvent = EV.find((ev) => ev.lane === lane && ev.speechText && !ev.silent);
        if (!sourceEvent) continue;
        const trimStart = Math.max(0, firstCue.start - 0.06);
        const timingEnd = nextSectionCue?.start ?? laneCues.at(-1).spokenEnd + 0.12;
        passageEvents.push({
          ...sourceEvent,
          silent: false,
          trimStart,
          timingEnd,
        });
        offsets.set(lane, trimStart);
        passageDuration = Math.max(passageDuration, timingEnd - trimStart);
      }
      if (!passageEvents.length || passageDuration <= 0) return null;
      return { passageEvents, offsets, passageDuration };
    };
    const playTimedCueRow = (row) => {
      if (!timedCues) return false;
      const plan = planTimedPassage(row, row + 1);
      if (!plan) return false;
      const [sectionStart, sectionEnd] = range();
      nowWords = [];
      for (const cue of timedCues) {
        const inSection = cue.ev.tick >= sectionStart && cue.ev.tick < sectionEnd;
        const isNow = inSection && cue.ev.tick === row;
        cue.ev.el.classList.toggle('now', isNow);
        cue.ev.el.classList.toggle('spoken', inSection && cue.ev.tick <= row);
        if (isNow) nowWords.push(cue.ev.el);
      }
      stopSamples();
      voice(plan.passageEvents);
      return true;
    };
    const advance = (row) => {
      currentRow = row;
      hasStruckCurrent = true;
      renderRow(row);
      if (timedCues && cue) {
        playTimedCueRow(row);
        return;
      }
      illuminate(row);
      const evs = eventsByRow.get(row);
      if (evs && !timedCues) voice(evs);
    };
    const startTimedPassage = () => {
      const [sectionStart, sectionEnd] = range();
      const plan = planTimedPassage(sectionStart, sectionEnd);
      if (!plan) return false;
      timedLaneOffsets = plan.offsets;
      timedPassageDuration = plan.passageDuration;
      timedStartTs = performance.now() + 15;
      hasStruckCurrent = true;
      voice(plan.passageEvents);
      return true;
    };

    const loop = (ts) => {
      if (timedCues && timedStartTs !== null) {
        illuminateTimed(ts);
        if ((ts - timedStartTs) / 1000 >= timedPassageDuration + 0.18) {
          stopSamples();
          clearPerformed();
          const [s] = range();
          currentRow = s;
          renderRow(s);
          startTimedPassage();
        }
        rafId = requestAnimationFrame(loop);
        return;
      }
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      acc += dt * rps;
      const [s, e] = range();
      let guard = 0;
      while (acc >= 1 && guard < 8) {
        acc -= 1;
        if (currentRow >= e) {
          clearPerformed();
          advance(s);
        } else {
          advance(currentRow + 1);
        }
        guard += 1;
      }
      rafId = requestAnimationFrame(loop);
    };
    // Prime the active sound source on a user gesture (autoplay/TTS both require it).
    const primeAudio = async () => {
      if (silent) return;
      ensureCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (soundMode === 'voice') {
        if (CLIPS) await loadSamples();
        else if (synth) {
          loadVoices();
          synth.resume();
        }
      }
    };
    const beginPlaying = () => {
      if (!hasStruckCurrent) {
        if (timedCues) startTimedPassage();
        else advance(currentRow);
      }
      playing = true;
      playBtn.classList.add('on');
      playBtn.textContent = '❚❚ Pause';
      lastTs = performance.now();
      acc = 0;
      rafId = requestAnimationFrame(loop);
    };
    const clearCount = () => {
      if (countTimer !== null) {
        clearTimeout(countTimer);
        countTimer = null;
      }
      counting = false;
      const cnt = q('.t-count');
      if (cnt) {
        cnt.classList.remove('show');
        cnt.textContent = '';
      }
    };
    const runCountIn = (from, done) => {
      const cnt = q('.t-count');
      let n = from;
      const beat = () => {
        if (n <= 0) {
          clearCount();
          done();
          return;
        }
        if (cnt) {
          cnt.textContent = String(n);
          cnt.classList.add('show');
        }
        n -= 1;
        countTimer = window.setTimeout(beat, Math.max(320, 1000 / Math.max(1, tempoBps)));
      };
      beat();
    };
    const play = async () => {
      if (playing || counting || starting) return;
      starting = true;
      const [s, e] = range();
      if (currentRow < s || currentRow >= e) {
        clearPerformed();
        currentRow = s;
        hasStruckCurrent = false;
      }
      try {
        await primeAudio();
        if (countin && !silent) {
          counting = true;
          runCountIn(3, beginPlaying);
        } else {
          beginPlaying();
        }
      } finally {
        starting = false;
      }
    };
    const pause = () => {
      playing = false;
      clearCount();
      playBtn.classList.remove('on');
      playBtn.textContent = cue ? 'Cue ▸ (Space)' : '▷ Perform';
      if (synth) synth.cancel();
      stopSamples();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (timedCues) {
        const [s] = range();
        clearPerformed();
        currentRow = s;
        hasStruckCurrent = false;
        renderRow(s);
      }
    };
    // Cue mode: the human sets the pace. Each cue strikes the next line; AI voices answer on their
    // own rows; a human lane stays silent for the live actor. Wraps at the passage end (drill loop).
    const enterCue = () => {
      pause();
      cued = false;
      enableMidi();
      const [s] = range();
      clearPerformed();
      currentRow = s;
      renderRow(s);
    };
    // Rows that actually hold a line, within the selected passage, in order.
    const cueRows = () => {
      const [s, e] = range();
      return [...eventsByRow.keys()]
        .filter((r) => r >= s && (timedCues ? r < e : r <= e))
        .sort((a, b) => a - b);
    };
    // Each cue strikes the NEXT LINE (not the next empty grid-beat) — the human drives line by line.
    const cueAdvance = async () => {
      await primeAudio();
      const rows = cueRows();
      if (!rows.length) return;
      if (!cued) {
        cued = true;
        clearPerformed();
        advance(rows[0]);
        return;
      }
      const next = rows.find((r) => r > currentRow);
      if (next === undefined) {
        clearPerformed();
        advance(rows[0]); // wrap — loop the passage for drilling
      } else {
        advance(next);
      }
    };
    // Step BACK to the previous line — rehearsal correction / footswitch back-pedal.
    const cuePrev = () => {
      const rows = cueRows();
      if (!rows.length) return;
      const prev = [...rows].reverse().find((r) => r < currentRow);
      if (prev === undefined) return;
      cued = true;
      advance(prev);
    };
    // Optional real MIDI footswitch / pad. A note-on (with velocity) or a sustain-pedal press
    // (CC64) strikes the next line. Requested lazily on cue entry so normal browsing never prompts;
    // unavailable over file:// or without permission — Space and the pedal-keys still drive cue.
    const onMidi = (msg) => {
      if (!cue) return;
      const [status, d1, d2] = msg.data;
      const type = status & 0xf0;
      if ((type === 0x90 && d2 > 0) || (type === 0xb0 && d1 === 64 && d2 >= 64)) cueAdvance();
    };
    const enableMidi = () => {
      if (midi || !navigator.requestMIDIAccess) return;
      navigator.requestMIDIAccess().then(
        (access) => {
          midi = access;
          midiInputs = [...access.inputs.values()];
          for (const inp of midiInputs) inp.addEventListener('midimessage', onMidi);
        },
        () => {
          /* no MIDI — Space / pedal-keys still drive cue */
        },
      );
    };

    const playBtn = q('.t-play');
    const restartBtn = q('.t-restart');
    const soundSeg = q('.t-sound');
    const modeSeg = q('.t-mode');
    const countinBtn = q('.t-countin');
    const tempo = q('.t-tempo');

    const updateHint = () => {
      const hint = q('.t-hint');
      if (!hint) return;
      hint.textContent = cue
        ? 'Live cue — Space / → / pedal strikes the next line, ← steps back. You set the pace; the AI answers.'
        : 'Loop a section · click a header to mute · ⌥/Alt-click to solo a voice.';
    };

    tempo.value = String(tempoBps);
    const onPlay = () => {
      if (cue) {
        cueAdvance();
        return;
      }
      if (playing) pause();
      else play();
    };
    const onRestart = () => {
      if (cue) {
        enterCue();
        return;
      }
      const [s] = range();
      acc = 0;
      stopSamples();
      clearPerformed();
      currentRow = s;
      hasStruckCurrent = false;
      renderRow(s);
      if (playing) {
        if (timedCues) startTimedPassage();
        else advance(s);
      } else illuminate(s);
    };
    const onMode = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      cue = b.dataset.mode === 'cue';
      for (const btn of modeSeg.children) btn.classList.toggle('on', btn === b);
      updateHint();
      if (cue) {
        enterCue();
        playBtn.textContent = 'Cue ▸ (Space)';
      } else {
        pause();
        playBtn.textContent = '▷ Perform';
      }
    };
    const onCountin = () => {
      countin = !countin;
      countinBtn.classList.toggle('on', countin);
    };
    // Reflect mute/solo state on every header (and mark the strip as soloing so CSS can dim the rest).
    const refreshLaneStates = () => {
      heads.classList.toggle('has-solo', soloed.size > 0);
      for (const h of heads.children) {
        const id = h.dataset.lane;
        if (!id) continue;
        h.classList.toggle('muted', muted.has(id));
        h.classList.toggle('solo', soloed.has(id));
      }
    };
    const onHeadClick = (e) => {
      const h = e.target.closest('.h');
      if (!h || !h.dataset.lane) return;
      const id = h.dataset.lane;
      if (e.altKey || e.shiftKey) {
        // solo — isolate this voice; solo overrides mute for both audio and display
        if (soloed.has(id)) soloed.delete(id);
        else soloed.add(id);
      } else if (muted.has(id)) {
        muted.delete(id);
      } else {
        muted.add(id);
      }
      refreshLaneStates();
    };
    // Footswitch-friendly: BT page-turner pedals emit Space / arrows / PageUp-Down. Forward keys
    // strike the next line; back keys step to the previous one. Only active in cue mode.
    const CUE_FWD = new Set(['Space', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter']);
    const CUE_BACK = new Set(['ArrowLeft', 'ArrowUp', 'PageUp']);
    const onKey = (e) => {
      if (!cue) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (CUE_FWD.has(e.code)) {
        e.preventDefault();
        cueAdvance();
      } else if (CUE_BACK.has(e.code)) {
        e.preventDefault();
        cuePrev();
      }
    };
    const onSound = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const m = b.dataset.m;
      for (const btn of soundSeg.children) btn.classList.toggle('on', btn === b);
      if (m === 'off') {
        silent = true;
        if (synth) synth.cancel();
        if (playing) pause();
        else stopSamples();
        if (ctx && ctx.state === 'running') ctx.suspend();
        return;
      }
      silent = false;
      soundMode = m;
      if (m !== 'voice') stopSamples();
      ensureCtx();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      if (m === 'voice') {
        if (CLIPS) loadSamples();
        else if (synth) {
          loadVoices();
          synth.resume();
        }
      }
    };
    const onTempo = () => {
      tempoBps = Number.parseFloat(tempo.value);
      rps = tempoBps * SUBDIV;
    };
    const onSections = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      sel = b.dataset.s;
      for (const btn of sections.children) btn.classList.toggle('on', btn === b);
      const [s] = range();
      acc = 0;
      stopSamples();
      clearPerformed();
      currentRow = s;
      hasStruckCurrent = false;
      renderRow(s);
      if (playing) {
        if (timedCues) startTimedPassage();
        else advance(s);
      } else illuminate(s);
    };
    const onResize = () => {
      measure();
      renderRow(currentRow);
    };

    playBtn.addEventListener('click', onPlay);
    restartBtn.addEventListener('click', onRestart);
    soundSeg.addEventListener('click', onSound);
    modeSeg.addEventListener('click', onMode);
    countinBtn.addEventListener('click', onCountin);
    heads.addEventListener('click', onHeadClick);
    tempo.addEventListener('input', onTempo);
    sections.addEventListener('click', onSections);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKey);

    updateHint();
    measure();
    currentRow = 0;
    renderRow(0);
    illuminate(0);
    hasStruckCurrent = false;

    return {
      destroy: () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        clearCount();
        window.removeEventListener('resize', onResize);
        window.removeEventListener('keydown', onKey);
        for (const inp of midiInputs) inp.removeEventListener('midimessage', onMidi);
        if (synth) {
          synth.cancel();
          synth.removeEventListener('voiceschanged', loadVoices);
        }
        stopSamples();
        if (ctx && ctx.state !== 'closed') ctx.close();
        root.innerHTML = '';
        root.classList.remove('sse');
      },
    };
  }

  window.SSEEngine = { mount };
})();
