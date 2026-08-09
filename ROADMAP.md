# Speech-Score Engine — Roadmap

**"Ableton for voice."** A tool for writers, actors, and directors to *compose, rehearse, and
perform speech as a temporal score.* Voices are lanes; lines are clips; the page is a timeline.
The long arc: read a play → arrange it → perform it — eventually with **live human actors
performing alongside AI actors, simultaneously.**

This is one instrument with many settings. *Philip Glass Buys a Loaf of Bread* is the first score,
not the shape of the product — not every play has four lanes at that tempo and rhythm. The engine
plays any score.

## Signal so far

The first prototype was screen-recorded to Chris (an actor). His arc, verbatim: first the jab —
"if actors ever needed confirmation of their worth, it's this application" — then, watching the
phasing converge, **"the discordant music reveals itself!"** and **"that's pretty good!"** The
mockery turned into recognition. Out of that thread came the flagship idea below.

## The layers

Each layer ships independently and is green before the next starts. We do **not** build a UI on a
model that can't hold it — data model first, then surface, then persistence, then cloud.

- **L0 — Performer** ✅ *shipped.* One hardcoded play (Philip Glass), 4 voice-lanes, real neural
  voices (Microsoft Edge TTS), polyphonic + zero-latency playback as Web Audio buffers, descending
  playhead, per-trigger humanization (detune / timing jitter / gain / LFO). Read-only.

- **L1 — Engine + score-as-data** ✅ *shipped.* Separate the **score (data)** from the **engine
  (player)**. Lanes, voices, panning, sections, tempo — all derive from a portable `SCORE` object.
  Any play, **any number of lanes.** Proven by shipping three scores on one engine: Philip Glass
  (4 lanes), a Shakespeare stichomythia (2 lanes, different rhythm), and a **duet** where one lane
  is human and one is AI (first taste of L5). Generator renders any score's clips from its lane
  casting. `?score=<id>` + an in-app score picker.

- **L2 — Product surface (Next route).** ✅ *shipped.* Port the engine into the real app
  (`apps/web/src/app/...`) with a shared `core/`, run the full gate matrix (`tsc --noEmit`,
  `next build`), PR → merge. The standalone prototype becomes a component/embed.

- **L3 — The arrangement editor ("Ableton for voice").** ✅ *shipped + clip-view.* The core creative
  surface. A timeline you can **touch**: drag a clip in time (retime), drag it across lanes (recast),
  add / duplicate / delete clips, add / rename / reorder lanes, edit tempo and the arc. Persist to the
  portable `SCORE` JSON (export / import). Perform from the edited arrangement. **Clip view "for
  words":** every line is a clip with a beat position **and a length** — drag the body to move, drag
  the right edge to resize (how many beats it spans). **Zoom** (px-per-beat) + **Snap** (1 · ½ · ⅓ · ¼
  · free) place sub-beat, so lanes run at **independent cadences (polyrhythm)**. All dragging is
  **Pointer-Capture** based, so mouse, touchpad and finger behave identically (desktop + mobile).

- **L4 — Casting & real actors.** ◐ *casting UI shipped; cloning hung on your reference reads
  (see NEEDS-YOU.md).* Per-lane voice assignment UI (cast any lane from the neural catalog) + the
  editor→neural loop (export a score, render it with `tools/render-voices.mjs`). **Zero-shot voice
  cloning:** record
  or upload a ~10s reference per lane and that lane becomes a *specific real person* (Chatterbox /
  ElevenLabs-grade). On-demand render pipeline (server function) replaces pre-baked blobs.

- **L5 — Live performance: human + AI, simultaneously.** ★ ✅ *shipped (core).* *Flagship,
  actor-validated.* A human actor performs a lane live while AI actors hold the others on the beat.
  Shipped in the shared engine (both surfaces): **Live cue** mode (Space / footswitch-key advances —
  the human sets the pace, the AI answers on its rows), **count-in** (3·2·1), **loop-a-passage**
  (select a section), **mute** a voice (click its header), latency-tight neural triggering, and human
  lanes left silent for the live actor. Rehearse against an AI scene partner or stage the two-hander
  between a person and their AI counterpart (Chris's pitch). **Follow-ups shipped:** per-lane
  **solo** (⌥/Alt-click a header — solo overrides mute), cue **back-step** (← / PageUp),
  **footswitch** support (Space / arrows / PageUp-Down, so any BT page-turner pedal drives it) +
  best-effort **Web MIDI** (note-on or sustain pedal advances a line, requested on cue entry).

- **L6 — Audio craft.** ◐ *v1 shipped.* Per-clip shaping in the editor's inspector — **trim**
  (head/tail), **gain**, **fade in/out** — over a **live waveform** (decoded peaks; trim window,
  fade ramps and gain drawn as you drag). Honored by the engine's `playSample` straight from the
  score event, and **audible**: the editor now performs with the real neural clips (falling back to
  Web Speech only for edited/unvoiced lines). Persists in the portable SCORE and round-trips through
  export/import. **L6.2 warp v1 shipped:** a per-clip **Warp** toggle stretches the audio to fill its
  beat-length on the grid (`playbackRate` — Ableton's Repitch warp: it repitches as it stretches, the
  same knob that locks a word to the beat also distorts its natural voice "into madness"); off = play
  the natural recorded length (place-and-play). *Next: pitch-preserving warp (phase-vocoder),
  drag-handle trim on the waveform, and the phoneme-recomposition tier (granular reassembly of
  recorded consonants/vowels).* "Actually edit the audio."

## Cross-cutting

Portable score-format spec (JSON) · **a library of scores** ✅ (`/library` — a browsable gallery;
every card derives its facts from the score data. Five scores now: Philip Glass · 4 lanes, Richard &
Anne · 2, Earnest · human+AI duet, **Macbeth's Three Witches · 3 lanes + chorus refrain**, and
**Lady Macbeth / Macbeth · 2 independently timed continuous passages**. Add a play in one place:
`src/lib/scoreScripts.ts`.) · **share as one file** (`node
tools/build-standalone.mjs` → `dist/speech-score.html`, everything inlined, opens offline by
double-click) · share / export (screen-record, audio bounce) · accessibility.

## Non-goals (until a layer needs them)

Auth, accounts, database, real-time collaboration/multiplayer, cloud storage. Kept out deliberately
so each layer stays a mergeable increment.
