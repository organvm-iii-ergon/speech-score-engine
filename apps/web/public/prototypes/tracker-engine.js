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
    '<div class="viewport t-viewport">',
    '  <div class="artwork-panel t-artwork" hidden></div>',
    '  <div class="track t-track"></div>',
    '</div>',
    '<div class="caption t-caption"></div>',
    '<div class="transport">',
    '  <div class="trow"><div class="seg t-scores"></div></div>',
    '  <div class="trow t-voice-config-row"><label class="voice-config">Voice treatment',
    '    <select class="t-voice-config"></select></label></div>',
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

  const DEFAULT_VOICE_CONFIGURATION_IDS = [
    'natural',
    'subtle',
    'separated',
    'theatrical',
    'octave-split',
  ];

  function mount(root, opts) {
    const SC = opts.score;
    const VOICE_CONFIG_IDS = Object.keys(SC.voiceConfigurations || {});
    if (!VOICE_CONFIG_IDS.length) VOICE_CONFIG_IDS.push(...DEFAULT_VOICE_CONFIGURATION_IDS);
    const requestedVoiceConfig = VOICE_CONFIG_IDS.includes(opts.voiceConfig)
      ? opts.voiceConfig
      : null;
    const VOICE_CONFIG =
      requestedVoiceConfig ||
      (VOICE_CONFIG_IDS.includes(SC.defaultVoiceConfiguration)
        ? SC.defaultVoiceConfiguration
        : VOICE_CONFIG_IDS.includes('separated')
          ? 'separated'
          : VOICE_CONFIG_IDS[0]) ||
      null;
    const configuredPack = VOICE_CONFIG
      ? opts.voicePack?.configurations?.[VOICE_CONFIG]
      : opts.voicePack;
    const activePack = configuredPack || (opts.voicePack?.clips ? opts.voicePack : null);
    const hasGeneratedVoiceConfiguration = Boolean(configuredPack?.clips);
    const CLIPS = activePack?.clips || opts.clips || null;
    const TIMINGS = activePack?.timings || opts.timings || null;
    const configurationAware = VOICE_CONFIG_IDS.length > 0;
    const ALL = opts.scores || [SC];
    const onPick =
      opts.onPick ||
      ((id) => {
        const p = new URLSearchParams(location.search);
        p.set('score', id);
        p.delete('voiceConfig');
        location.search = p.toString();
      });
    const onVoiceConfig =
      opts.onVoiceConfig ||
      ((id) => {
        const p = new URLSearchParams(location.search);
        p.set('voiceConfig', id);
        location.search = p.toString();
      });

    root.classList.add('sse');
    root.dataset.score = SC.id;
    const artworkMeta = SC.artwork;
    const hasArtwork = Boolean(artworkMeta?.image);
    if (hasArtwork) root.dataset.artwork = artworkMeta.id || 'present';
    else delete root.dataset.artwork;
    root.innerHTML = TEMPLATE;
    const q = (sel) => root.querySelector(sel);

    const artwork = q('.t-artwork');
    if (artwork) {
      artwork.hidden = !hasArtwork;
      artwork.innerHTML = hasArtwork
        ? [
            '<img class="artwork-bleed" data-sse-artwork',
            `  src="${artworkMeta.image}"`,
            '  alt="" aria-hidden="true" />',
            '<img class="artwork-original" data-sse-artwork',
            `  src="${artworkMeta.image}"`,
            `  alt="${artworkMeta.alt || `${artworkMeta.title} by ${artworkMeta.artist}`}" />`,
            `<a class="artwork-credit" href="${artworkMeta.sourceUrl}"`,
            `  target="_blank" rel="noreferrer">${artworkMeta.credit}</a>`,
          ].join('\n')
        : '';
    }

    // ---- derive everything from the score ----
    const LANES = SC.lanes;
    const CH = LANES.map((l) => l.id);
    const HEAD = {};
    const laneById = new Map(LANES.map((l) => [l.id, l]));
    const laneAlignment = (lane, index) => {
      if (lane?.align) return lane.align;
      if (CH.length === 1) return 'center';
      const midpoint = (CH.length - 1) / 2;
      return index < midpoint ? 'right' : index > midpoint ? 'left' : 'center';
    };
    const alignById = new Map(LANES.map((lane, index) => [lane.id, laneAlignment(lane, index)]));
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
    const runtimeTreatmentCents = (channel) => {
      if (hasGeneratedVoiceConfiguration) return 0;
      const amountByConfiguration = {
        natural: 0,
        subtle: 14,
        separated: 28,
        theatrical: 48,
        'octave-split': 600,
      };
      const amount = amountByConfiguration[VOICE_CONFIG] || 0;
      const pan = CHVOX[channel]?.pan || 0;
      return pan < 0 ? amount : pan > 0 ? -amount : 0;
    };
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

    // A row-complete tracker is a two-player grid rather than a metronome: every lane in a row
    // starts together, then the next row waits for the longest measured clip. The same Edge-TTS
    // word-boundary record feeds the offline mix and reel, so this browser plan stays in phase.
    const deriveRowCompletePlan = () => {
      if (SC.playback !== 'row-complete' || !TIMINGS) return null;
      const activeLanes = CH.filter((lane) => !isHuman(lane));
      const rows = new Map();
      for (const ev of EV) {
        if (ev.silent || isHuman(ev.lane)) continue;
        if (!rows.has(ev.tick)) rows.set(ev.tick, []);
        rows.get(ev.tick).push(ev);
      }
      let cursor = 0;
      const scheduledRows = [];
      for (const [tick, events] of [...rows.entries()].sort(([left], [right]) => left - right)) {
        if (events.length !== activeLanes.length) return null;
        const ids = new Set(events.map((ev) => ev.lane));
        if (activeLanes.some((lane) => !ids.has(lane))) return null;
        const clips = events.map((ev) => {
          const timing = TIMINGS[`${ev.lane}|${ev.speechText || ev.text}`];
          if (!Number.isFinite(timing?.duration) || timing.duration <= 0) return null;
          return { ev, timing };
        });
        if (clips.some((clip) => clip === null)) return null;
        const duration = Math.max(...clips.map((clip) => clip.timing.duration));
        scheduledRows.push({ tick, start: cursor, end: cursor + duration, events });
        cursor += duration;
      }
      return scheduledRows.length ? { duration: cursor, rows: scheduledRows } : null;
    };
    const rowCompletePlan = deriveRowCompletePlan();

    // ---- audio ----
    let silent = false;
    let soundMode = 'voice';
    const scoreTempoBps = SC.tempo || 3;
    let tempoBps = scoreTempoBps; // musical tempo — beats per second (what the Tempo slider sets)
    let rps = tempoBps * SUBDIV; // transport grid steps (ticks) per second = tempo × subdivision
    const muted = new Set(); // lanes silenced via a header click (still illuminate)
    const soloed = new Set(); // lanes soloed via ⌥/Alt-click — when any is set, only these sound
    const laneIsAudible = (lane) =>
      !silent && !isHuman(lane) && (soloed.size ? soloed.has(lane) : !muted.has(lane));

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
        u.pitch = Math.max(0.1, Math.min(2, spec.pitch * 2 ** (runtimeTreatmentCents(ch) / 1200)));
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
    const resumeAudio = async () => {
      if (!ctx || ctx.state === 'closed') return false;
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        try {
          await ctx.resume();
        } catch (err) {
          return false;
        }
      }
      return ctx.state === 'running';
    };
    const refreshMasterAudibility = () => {
      if (!ctx || !master) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(silent ? 0 : 0.9, ctx.currentTime);
    };
    const tone = (channel, when) => {
      if (!ctx || !master) return;
      const spec = TONES[channel];
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = spec.t;
      osc.frequency.setValueAtTime(spec.f * 2 ** (runtimeTreatmentCents(channel) / 1200), when);
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.2, when + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
      osc.connect(env);
      let panner = null;
      if (ctx.createStereoPanner) {
        panner = ctx.createStereoPanner();
        panner.pan.value = CHVOX[channel]?.pan || 0;
        env.connect(panner);
        panner.connect(master);
      } else {
        env.connect(master);
      }
      osc.start(when);
      osc.stop(when + 0.4);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
        if (panner) panner.disconnect();
      };
    };

    const fallbackVoice = (events) => {
      if (!events.length) return false;
      if (!configurationAware) return Boolean(synth && speak(events));
      if (!ensureCtx() || !ctx) return false;
      for (const ev of events) tone(ev.lane, ctx.currentTime);
      return true;
    };

    // -- source 0: pre-rendered neural clips as Web Audio buffers --
    // `loading` retains the decode promise so a later transport action can await the same work
    // instead of racing ahead without clips.
    const SAMP = { buf: new Map(), ready: false, loading: null };
    // Keep the lane gate with every long-running buffer source. Header changes can then mute or
    // solo an already-playing continuous passage without waiting for it to loop or retrigger.
    const activeSources = new Map();
    const stopSamples = () => {
      for (const source of activeSources.keys()) {
        try {
          source.stop();
        } catch (err) {
          /* source already ended */
        }
      }
      activeSources.clear();
    };
    const refreshActiveSourceAudibility = () => {
      if (!ctx) return;
      for (const { lane, gate } of activeSources.values()) {
        gate.gain.cancelScheduledValues(ctx.currentTime);
        gate.gain.setValueAtTime(laneIsAudible(lane) ? 1 : 0, ctx.currentTime);
      }
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
    const loadSamples = () => {
      if (SAMP.ready) return Promise.resolve(true);
      if (SAMP.loading) return SAMP.loading;
      if (!CLIPS || !ensureCtx() || !ctx) return Promise.resolve(false);
      SAMP.loading = Promise.all(
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
      )
        .then(() => {
          SAMP.ready = SAMP.buf.size > 0;
          return SAMP.ready;
        })
        .finally(() => {
          SAMP.loading = null;
        });
      return SAMP.loading;
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
      if (src.detune) {
        const treatment = runtimeTreatmentCents(channel);
        src.detune.value = deterministic ? treatment : treatment + rand(-8, 8);
      }
      // trim window within the buffer, and the audible portion (in BUFFER seconds) that remains
      const dur = clip.buffer.duration;
      const start = Math.max(
        0,
        (clip.offset || 0) + (ev.trimStart || 0) + (ev.sectionTrimStart || 0),
      );
      const untrimmedEnd = typeof ev.timingEnd === 'number' ? Math.min(dur, ev.timingEnd) : dur;
      const sourceEnd = untrimmedEnd - Math.max(0, ev.trimEnd || 0);
      const srcDur = Math.max(0.02, sourceEnd - start);
      // WARP: stretch the clip to fill its beat-length on the grid. `warp` off → play the recorded
      // length at natural pitch (place-and-play). `warp` on → the same knob that locks a word to the
      // beat also, pushed far, distorts its natural voice "into madness": playbackRate repitches as
      // it stretches (Ableton's Repitch warp). Pitch-preserving warp is a later tier.
      const beatsPerSec = SUBDIV ? rps / SUBDIV : rps;
      const transportRate =
        typeof ev.transportRate === 'number' && ev.transportRate > 0 ? ev.transportRate : 1;
      let rate = spec.rate * transportRate * (deterministic ? 1 : rand(0.997, 1.003));
      let outDur = srcDur / rate; // wall-clock output seconds (place-and-play)
      // A continuous passage owns a clip-derived visual clock. Its transportRate keeps the
      // sound in phase with that clock, so repitch Warp is unavailable for that source rather
      // than replacing the timed rate with its unrelated one-beat grid calculation.
      if (ev.warp && beatsPerSec > 0 && typeof ev.transportRate !== 'number') {
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
      if (src.detune && !deterministic && !runtimeTreatmentCents(channel)) {
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
      const laneGate = ctx.createGain();
      laneGate.gain.value = laneIsAudible(channel) ? 1 : 0;
      src.connect(g);
      g.connect(laneGate);
      let tail = [src, g, laneGate];
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = spec.pan;
        laneGate.connect(p);
        p.connect(master);
        tail = [src, g, laneGate, p];
      } else {
        laneGate.connect(master);
      }
      if (lfoGain) tail = tail.concat([lfoGain]);
      const cleanupSource = cleanup(tail);
      src.onended = () => {
        activeSources.delete(src);
        cleanupSource();
      };
      activeSources.set(src, { lane: channel, gate: laneGate });
      src.start(t, start, playDur);
      if (lfo) lfo.start(t);
      return true;
    };

    const voice = (events) => {
      if (!events || !events.length) return;
      // Audibility, one decision: never a human lane; when any lane is soloed only soloed lanes
      // sound (solo overrides mute, the DAW convention); otherwise everything unmuted sounds.
      const eligible = events.filter((ev) => !ev.silent && !isHuman(ev.lane));
      const audible = eligible.filter((ev) => laneIsAudible(ev.lane));
      if (!eligible.length) return;
      if (soundMode === 'voice') {
        if (CLIPS) {
          if (SAMP.ready) {
            const base = ctx.currentTime + 0.015;
            let any = false;
            const missing = [];
            // Start only audible pre-rendered lanes. A muted matching clip must not prevent an
            // edited audible line from using the Web Speech fallback.
            for (const ev of audible) {
              const key = `${ev.lane}|${ev.speechText || ev.text}`;
              const stagger = TIMINGS?.[key] ? 0 : rand(0, 0.028);
              const scheduled = Math.max(
                0,
                typeof ev.scheduleSeconds === 'number' ? ev.scheduleSeconds : 0,
              );
              if (playSample(ev, base + scheduled + stagger)) any = true;
              else missing.push(ev);
            }
            // A pack can match only some audible lines after an edit. Fall back only for the
            // unmatched audible subset; never let a silent lane consume that decision.
            if (missing.length && fallbackVoice(missing)) return;
            if (any) {
              // Web Speech is optional. Keep the final Web Audio fallback audible for only the
              // unmatched lines rather than adding duplicate tones beneath matched clips.
              if (missing.length && ensureCtx() && ctx) {
                for (const ev of missing) tone(ev.lane, ctx.currentTime);
              }
              return;
            }
            // a clip pack is loaded but no audible clip matched (e.g. text edited in the editor)
            if (audible.length && fallbackVoice(audible)) return;
          } else {
            loadSamples();
            return;
          }
        } else if (audible.length && fallbackVoice(audible)) {
          return;
        }
      }
      if (!audible.length) return;
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
      const align = alignById.get(c);
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
        const align = alignById.get(c);
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
      ev.cell = cell;
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
        const visibleLaneEvents = EV.filter((ev) => ev.lane === lane && ev.el);
        // Adding an unused editor lane or an ordinary clip must not discard timing for a populated
        // continuous passage. A lane that retains silent continuations without a source is corrupt.
        if (!visibleLaneEvents.length) continue;
        const sourceEvent = EV.find((ev) => ev.lane === lane && ev.speechText && !ev.silent);
        if (!sourceEvent) {
          if (visibleLaneEvents.some((ev) => ev.silent)) return null;
          continue;
        }
        const laneEvents = visibleLaneEvents
          .filter((ev) => ev === sourceEvent || ev.silent)
          .sort((a, b) => a.tick - b.tick);
        const timing = sourceEvent ? TIMINGS[`${lane}|${sourceEvent.speechText}`] : null;
        if (!Array.isArray(timing?.words)) return null;
        const words = timing.words;
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

    const voiceConfigRow = q('.t-voice-config-row');
    const voiceConfigSelect = q('.t-voice-config');
    if (!voiceConfigRow || !voiceConfigSelect) {
      /* a minimal host may omit the optional selector */
    } else if (!VOICE_CONFIG_IDS.length) {
      voiceConfigRow.style.display = 'none';
    } else {
      for (const id of VOICE_CONFIG_IDS) {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = id
          .split('-')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        voiceConfigSelect.appendChild(option);
      }
      voiceConfigSelect.value = VOICE_CONFIG;
    }

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
    let destroyed = false;
    let playGeneration = 0;
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
    let timedTempoScale = 1;
    let rowCompleteOffset = 0;
    // A timed Tones performance sounds each visible lane line once. Store event identities rather
    // than rows: simultaneous lanes and silent continuation rows each carry their own cue.
    let timedToneCues = new Set();
    // A new timed run invalidates any delayed Voice-mode resume from the preceding run.
    let timedRunGeneration = 0;
    let timedVoiceResumeGeneration = 0;
    // L5 — live human+AI performance
    let cue = false; // cue mode: a human drives the pace (Space advances), AI answers on its rows
    let cued = false; // has the first line been struck since (re)entering cue mode
    let cueAdvancePending = false; // one input may wait for decoding; later strikes must not skip
    let countin = false; // 3·2·1 pre-roll before a metronome performance
    let counting = false;
    let countTimer = null;
    let midi = null; // Web MIDI access (lazy — requested on first cue entry; best-effort)
    let midiInputs = [];
    const cancelPendingPlay = () => {
      playGeneration += 1;
      starting = false;
    };
    const playRequestIsCurrent = (generation) =>
      !destroyed && !cue && generation === playGeneration;

    const measure = () => {
      rowH = rowEls[0] ? rowEls[0].offsetHeight : 26;
      visibleRows = Math.max(8, Math.floor(viewport.clientHeight / rowH));
    };
    const range = () => (sel === 'full' ? [0, TOTAL - 1] : SECTIONS[sel]);
    // Timed sections are authored as half-open spans. Keep the legacy inclusive range untouched,
    // but use the score's full tick count as the exclusive end for continuous-passage transport.
    const timedRange = () => (sel === 'full' ? [0, TOTAL] : SECTIONS[sel]);
    const clearPerformed = () => {
      timedRunGeneration += 1;
      timedVoiceResumeGeneration += 1;
      for (const ev of EV) {
        if (ev.el) ev.el.classList.remove('spoken', 'now');
        if (ev.cell) ev.cell.classList.remove('line-active');
      }
      nowWords = [];
      timedStartTs = null;
      timedLaneOffsets = new Map();
      timedPassageDuration = 0;
      timedTempoScale = 1;
      rowCompleteOffset = 0;
      timedToneCues = new Set();
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
      for (const ev of EV) ev.cell?.classList.remove('line-active');
      nowWords = [];
      const evs = eventsByRow.get(row);
      if (!evs) return;
      for (const ev of evs) {
        if (!ev.el) continue;
        ev.el.classList.add('spoken');
        void ev.el.offsetWidth;
        ev.el.classList.add('now');
        ev.cell?.classList.add('line-active');
        nowWords.push(ev.el);
      }
    };
    const illuminateRowComplete = (timestamp) => {
      if (!rowCompletePlan || timedStartTs === null) return;
      const elapsed = Math.max(0, (timestamp - timedStartTs) / 1000) * timedTempoScale;
      const [sectionStart, sectionEnd] = timedRange();
      nowWords = [];
      for (const row of rowCompletePlan.rows) {
        const inSection = row.tick >= sectionStart && row.tick < sectionEnd;
        const start = row.start - rowCompleteOffset;
        const end = row.end - rowCompleteOffset;
        const isNow = inSection && elapsed >= start && elapsed < end;
        for (const ev of row.events) {
          ev.el?.classList.toggle('now', isNow);
          ev.el?.classList.toggle('spoken', inSection && elapsed >= end);
          ev.cell?.classList.toggle('line-active', isNow);
          if (isNow && ev.el) nowWords.push(ev.el);
          if (isNow && soundMode === 'tone' && !timedToneCues.has(ev)) {
            timedToneCues.add(ev);
            if (laneIsAudible(ev.lane) && ensureCtx() && ctx) tone(ev.lane, ctx.currentTime);
          }
        }
        if (isNow && currentRow !== row.tick) {
          currentRow = row.tick;
          renderRow(row.tick);
        }
      }
    };
    const illuminateTimed = (timestamp) => {
      if (!timedCues || timedStartTs === null) return;
      const elapsed = Math.max(0, (timestamp - timedStartTs) / 1000) * timedTempoScale;
      const [sectionStart, sectionEnd] = timedRange();
      nowWords = [];
      for (const cue of timedCues) {
        const seconds = elapsed + (timedLaneOffsets.get(cue.ev.lane) || 0);
        const inSection = cue.ev.tick >= sectionStart && cue.ev.tick < sectionEnd;
        const isNow = inSection && seconds >= cue.start && seconds < cue.end;
        cue.ev.el.classList.toggle('now', isNow);
        cue.ev.el.classList.toggle('spoken', inSection && seconds >= cue.end);
        cue.ev.cell?.classList.toggle('line-active', isNow);
        if (isNow) nowWords.push(cue.ev.el);
      }
      playTimedTones(
        timedCues.filter((cue) => {
          const seconds = elapsed + (timedLaneOffsets.get(cue.ev.lane) || 0);
          return (
            cue.ev.tick >= sectionStart &&
            cue.ev.tick < sectionEnd &&
            seconds >= cue.start &&
            seconds < cue.end
          );
        }),
      );
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
    const playTimedTones = (cues) => {
      if (soundMode !== 'tone') return;
      if (!ensureCtx() || !ctx) return;
      for (const cue of cues) {
        if (timedToneCues.has(cue.ev)) continue;
        timedToneCues.add(cue.ev);
        if (laneIsAudible(cue.ev.lane)) tone(cue.ev.lane, ctx.currentTime);
      }
    };
    const planTimedPassage = (sectionStart, sectionEnd, transportRate = 1) => {
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
        // Section trims are additional to the event's authored edit window; selecting a passage
        // must not silently discard trimStart/trimEnd already present on the source event.
        const sectionTrimStart = Math.max(0, firstCue.start - 0.06);
        const trimStart = Math.max(0, (sourceEvent.trimStart || 0) + sectionTrimStart);
        const untrimmedTimingEnd = nextSectionCue?.start ?? laneCues.at(-1).spokenEnd + 0.12;
        const timingEnd = Math.max(trimStart + 0.02, untrimmedTimingEnd);
        const composedEnd = timingEnd - Math.max(0, sourceEvent.trimEnd || 0);
        passageEvents.push({
          ...sourceEvent,
          silent: false,
          sectionTrimStart,
          timingEnd,
          transportRate,
        });
        offsets.set(lane, trimStart);
        passageDuration = Math.max(passageDuration, composedEnd - trimStart);
      }
      if (!passageEvents.length || passageDuration <= 0) return null;
      return { passageEvents, offsets, passageDuration };
    };
    const playTimedCueRow = (row) => {
      if (!timedCues) return false;
      const plan = planTimedPassage(row, row + 1);
      if (!plan) return false;
      const [sectionStart, sectionEnd] = timedRange();
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
    const startRowCompletePassage = () => {
      if (!rowCompletePlan) return false;
      const [sectionStart, sectionEnd] = timedRange();
      const rows = rowCompletePlan.rows.filter(
        (row) => row.tick >= sectionStart && row.tick < sectionEnd,
      );
      if (!rows.length) return false;
      timedRunGeneration += 1;
      rowCompleteOffset = rows[0].start;
      timedTempoScale = tempoBps / scoreTempoBps;
      timedPassageDuration = (rows.at(-1).end - rowCompleteOffset) / timedTempoScale;
      timedStartTs = performance.now() + 15;
      hasStruckCurrent = true;
      if (soundMode === 'tone') {
        illuminateRowComplete(timedStartTs);
      } else {
        voice(
          rows.flatMap((row) =>
            row.events.map((event) => ({
              ...event,
              scheduleSeconds: (row.start - rowCompleteOffset) / timedTempoScale,
              transportRate: timedTempoScale,
            })),
          ),
        );
      }
      return true;
    };
    const startTimedPassage = () => {
      const [sectionStart, sectionEnd] = timedRange();
      const tempoScale = tempoBps / scoreTempoBps;
      const plan = planTimedPassage(sectionStart, sectionEnd, tempoScale);
      if (!plan) return false;
      timedRunGeneration += 1;
      timedLaneOffsets = plan.offsets;
      timedTempoScale = tempoScale;
      // Keep authored score-tail beats, but never reset a section drill while a planned excerpt
      // still has words left to say. Both durations are in wall-clock seconds at this tempo.
      const gridDuration = (sectionEnd - sectionStart) / SUBDIV / tempoBps;
      const excerptDuration = plan.passageDuration / tempoScale;
      timedPassageDuration = Math.max(gridDuration, excerptDuration);
      timedStartTs = performance.now() + 15;
      hasStruckCurrent = true;
      if (soundMode === 'tone') {
        // The passage source triggers are also the first visible cues. Mark them before sounding so
        // the first animation frame does not duplicate either opening lane tone.
        const initialCues = CH.map(
          (lane) =>
            timedCues
              .filter(
                (cue) =>
                  cue.ev.lane === lane && cue.ev.tick >= sectionStart && cue.ev.tick < sectionEnd,
              )
              .sort((a, b) => a.ev.tick - b.ev.tick)[0],
        ).filter(Boolean);
        playTimedTones(initialCues);
      } else {
        voice(plan.passageEvents);
      }
      return true;
    };
    const timedPassageOffset = () =>
      timedStartTs === null
        ? 0
        : Math.max(0, ((performance.now() - timedStartTs) / 1000) * timedTempoScale);
    const timedRunIsActive = (run) =>
      !destroyed &&
      playing &&
      timedStartTs !== null &&
      run === timedRunGeneration &&
      soundMode === 'voice' &&
      !silent;
    const resumeTimedVoices = async () => {
      if (!timedCues || !CLIPS || timedStartTs === null) return false;
      const run = timedRunGeneration;
      const resume = ++timedVoiceResumeGeneration;
      if (!(await resumeAudio())) return false;
      const ready = await loadSamples();
      // Decoding can outlive a pause, section change, or another monitor choice. Only the same
      // running passage may recreate sources, and it must still be explicitly in Voices mode.
      if (!ready || resume !== timedVoiceResumeGeneration || !timedRunIsActive(run)) return false;
      const [sectionStart, sectionEnd] = timedRange();
      const plan = planTimedPassage(sectionStart, sectionEnd, timedTempoScale);
      if (!plan) return false;
      const offset = timedPassageOffset();
      const resumedEvents = plan.passageEvents
        .map((ev) => ({ ...ev, sectionTrimStart: ev.sectionTrimStart + offset }))
        .filter((ev) => {
          const sourceStart = (ev.trimStart || 0) + ev.sectionTrimStart;
          const sourceEnd = ev.timingEnd - Math.max(0, ev.trimEnd || 0);
          return sourceStart < sourceEnd;
        });
      if (!resumedEvents.length) return false;
      voice(resumedEvents);
      return true;
    };
    const resumeRowCompleteVoices = async () => {
      if (!rowCompletePlan || !CLIPS || timedStartTs === null) return false;
      const run = timedRunGeneration;
      const resume = ++timedVoiceResumeGeneration;
      if (!(await resumeAudio())) return false;
      const ready = await loadSamples();
      if (!ready || resume !== timedVoiceResumeGeneration || !timedRunIsActive(run)) return false;
      const [sectionStart, sectionEnd] = timedRange();
      const elapsed = Math.max(0, (performance.now() - timedStartTs) / 1000) * timedTempoScale;
      const remaining = rowCompletePlan.rows
        .filter((row) => row.tick >= sectionStart && row.tick < sectionEnd)
        .flatMap((row) => {
          const start = row.start - rowCompleteOffset;
          const end = row.end - rowCompleteOffset;
          if (elapsed >= end) return [];
          const sectionTrimStart = Math.max(0, elapsed - start);
          return row.events.map((event) => ({
            ...event,
            sectionTrimStart,
            scheduleSeconds: Math.max(0, (start - elapsed) / timedTempoScale),
            transportRate: timedTempoScale,
          }));
        });
      if (!remaining.length) return false;
      voice(remaining);
      return true;
    };

    const loop = (ts) => {
      if (rowCompletePlan && timedStartTs !== null) {
        illuminateRowComplete(ts);
        if ((ts - timedStartTs) / 1000 >= timedPassageDuration) {
          stopSamples();
          clearPerformed();
          const [s] = timedRange();
          currentRow = s;
          renderRow(s);
          startRowCompletePassage();
        }
        rafId = requestAnimationFrame(loop);
        return;
      }
      if (timedCues && timedStartTs !== null) {
        illuminateTimed(ts);
        if ((ts - timedStartTs) / 1000 >= timedPassageDuration) {
          stopSamples();
          clearPerformed();
          const [s] = timedRange();
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
      if (ensureCtx()) await resumeAudio();
      if (soundMode === 'voice') {
        if (CLIPS) await loadSamples();
        else if (synth) {
          loadVoices();
          synth.resume();
        }
      }
    };
    const beginPlaying = (generation) => {
      if (!playRequestIsCurrent(generation)) return;
      if (!hasStruckCurrent) {
        if (rowCompletePlan) startRowCompletePassage();
        else if (timedCues) startTimedPassage();
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
      const generation = ++playGeneration;
      starting = true;
      const [s, e] = timedCues || rowCompletePlan ? timedRange() : range();
      if (currentRow < s || currentRow >= e) {
        clearPerformed();
        currentRow = s;
        hasStruckCurrent = false;
      }
      try {
        await primeAudio();
        if (!playRequestIsCurrent(generation)) return;
        if (countin && !silent) {
          counting = true;
          runCountIn(3, () => beginPlaying(generation));
        } else {
          beginPlaying(generation);
        }
      } finally {
        if (generation === playGeneration) starting = false;
      }
    };
    const pause = () => {
      cancelPendingPlay();
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
      if (timedCues || rowCompletePlan) {
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
      const [s, e] = timedCues || rowCompletePlan ? timedRange() : range();
      return [...eventsByRow.keys()]
        .filter((r) => r >= s && (timedCues || rowCompletePlan ? r < e : r <= e))
        .sort((a, b) => a - b);
    };
    // Each cue strikes the NEXT LINE (not the next empty grid-beat) — the human drives line by line.
    const cueAdvance = async () => {
      if (cueAdvancePending) return;
      cueAdvancePending = true;
      const generation = playGeneration;
      try {
        await primeAudio();
        if (destroyed || !cue || generation !== playGeneration) return;
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
      } finally {
        cueAdvancePending = false;
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
        : rowCompletePlan
          ? 'Tracker mode — both lines begin together; the next row waits for the longer read.'
          : 'Loop a section · click a header to mute · ⌥/Alt-click to solo a voice.';
    };

    tempo.value = String(tempoBps);
    const onPlay = () => {
      if (cue) {
        cueAdvance();
        return;
      }
      if (playing || starting || counting) pause();
      else play();
    };
    const onRestart = () => {
      cancelPendingPlay();
      clearCount();
      if (cue) {
        enterCue();
        return;
      }
      const [s] = rowCompletePlan ? timedRange() : range();
      acc = 0;
      stopSamples();
      clearPerformed();
      currentRow = s;
      hasStruckCurrent = false;
      renderRow(s);
      if (playing) {
        if (rowCompletePlan) startRowCompletePassage();
        else if (timedCues) startTimedPassage();
        else advance(s);
      } else illuminate(s);
    };
    const onVoiceConfigChange = () => {
      const next = voiceConfigSelect?.value;
      if (!next || next === VOICE_CONFIG) return;
      pause();
      sel = 'full';
      for (const button of sections.children) {
        button.classList.toggle('on', button.dataset.s === 'full');
      }
      clearPerformed();
      currentRow = 0;
      hasStruckCurrent = false;
      renderRow(0);
      onVoiceConfig(next);
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
      refreshActiveSourceAudibility();
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
        // Silent is an audio monitor choice, not a transport command. Keep both the visual clock
        // and active buffer-source phase running so restoring sound does not rewind the score.
        refreshMasterAudibility();
        refreshActiveSourceAudibility();
        return;
      }
      const previousSoundMode = soundMode;
      silent = false;
      soundMode = m;
      if (m !== 'voice') {
        timedVoiceResumeGeneration += 1;
        stopSamples();
      }
      ensureCtx();
      refreshMasterAudibility();
      refreshActiveSourceAudibility();
      if (ctx && (ctx.state === 'suspended' || ctx.state === 'interrupted')) void resumeAudio();
      if (m === 'voice') {
        if (CLIPS) {
          // Tones intentionally stops the continuous clips while the timed visual clock keeps
          // advancing. Restore their current source offset rather than restarting the section.
          if (
            rowCompletePlan &&
            playing &&
            (previousSoundMode === 'tone' || activeSources.size === 0)
          ) {
            void resumeRowCompleteVoices();
          } else if (
            timedCues &&
            playing &&
            (previousSoundMode === 'tone' || activeSources.size === 0)
          ) {
            void resumeTimedVoices();
          } else {
            void loadSamples();
          }
        } else if (synth) {
          loadVoices();
          synth.resume();
        }
      }
    };
    const onTempo = () => {
      tempoBps = Number.parseFloat(tempo.value);
      rps = tempoBps * SUBDIV;
      if ((rowCompletePlan || timedCues) && playing) {
        stopSamples();
        clearPerformed();
        const [s] = timedRange();
        currentRow = s;
        renderRow(s);
        if (rowCompletePlan) startRowCompletePassage();
        else startTimedPassage();
      }
    };
    const onSections = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      sel = b.dataset.s;
      if (cue) cued = false;
      for (const btn of sections.children) btn.classList.toggle('on', btn === b);
      const [s] = rowCompletePlan ? timedRange() : range();
      acc = 0;
      stopSamples();
      clearPerformed();
      currentRow = s;
      hasStruckCurrent = false;
      renderRow(s);
      if (playing) {
        if (rowCompletePlan) startRowCompletePassage();
        else if (timedCues) startTimedPassage();
        else advance(s);
      } else illuminate(s);
    };
    const onResize = () => {
      measure();
      renderRow(currentRow);
    };

    playBtn.addEventListener('click', onPlay);
    restartBtn.addEventListener('click', onRestart);
    voiceConfigSelect?.addEventListener('change', onVoiceConfigChange);
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
        destroyed = true;
        cancelPendingPlay();
        playing = false;
        if (rafId !== null) cancelAnimationFrame(rafId);
        clearCount();
        voiceConfigSelect?.removeEventListener('change', onVoiceConfigChange);
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
        delete root.dataset.score;
        root.classList.remove('sse');
      },
    };
  }

  window.SSEEngine = { mount };
})();
