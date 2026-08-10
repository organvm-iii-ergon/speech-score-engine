---
plan_date: "2026-08-10"
status: active
---

# Shared score performance modes

## Goal

Generalize shared-axis lane alignment for any lane count and add an orthogonal performance selector
that preserves the existing Tracker / Ableton clock while enabling independent Free Time per lane.

## Decisions

- `performance=tracker` remains the default and preserves existing URLs and playback behavior.
- `performance=free-time` starts every eligible lane together, then schedules each lane from its own
  measured clips and authored rests without cross-lane row gates.
- Voice treatment remains independent of performance mode; all five treatments stay available.
- Tempo is a global multiplier in both modes. Existing transport, cue, section, sound, mute, solo,
  restart, and count-in controls remain available.
- Odd lane counts center the middle lane; other lanes face the shared center axis, unless a lane has
  an explicit alignment override. Headers and dialogue share the same contract.
- Generated voice packs carry timing metadata for every score and rendered treatment. Standalone
  output continues to inline score, voice, timing, artwork, and runtime assets.

## Verification

- Cover one through five lanes, explicit alignment, URL parsing/fallback/share preservation, both
  schedulers, all voice treatments, transport controls, and live/standalone asset inclusion.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, standalone generation, and
  `git diff --check`.
- Serve `apps/web/out` and browser-check every score in Tracker and Free Time, including timing,
  controls, alignment, running state, and console errors.
- Commit and push the audited scope, deploy the exact static output, and verify dedicated score
  routes plus tracker aliases in production.
