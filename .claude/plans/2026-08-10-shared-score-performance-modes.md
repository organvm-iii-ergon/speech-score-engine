---
plan_date: "2026-08-10"
status: completed
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

## Result

- Shipped in `7768bf1afb7750f80ea6f81bc06fe26fb96eb2e2` with all required repository checks green.
- Browser-verified all five scores in both performance modes, plus the Next and standalone tracker
  aliases, with no runtime console errors.
- Deployed the 56-file `apps/web/out` export to Cloudflare Pages production as deployment
  `1f267074-ffd8-490d-9e7d-03708efad394`; the verified directory digest is
  `a13ee17394176c12a62cf040711a49aab1aac51363a10f43d4617b9a0f6b85ef`.
