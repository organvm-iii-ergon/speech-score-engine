---
plan_date: "2026-08-09"
status: active
---

# PR #19 P2 review fixes

## Goal

Address only the three named P2 review findings for the Lady Macbeth / Macbeth score: imported
score totals, continuous-passage text edits, and timed Tones cues.

## Acceptance criteria

- Imported scores without a finite total derive a total that covers their event extents.
- Editing any visible line in a continuous-passage lane rebuilds that lane trigger's `speechText`
  in visual-line order, invalidating stale rendered voice/timing keys.
- Timed Tones emits one audible cue for every visually active lane line, including silent
  continuations, without duplicate initial cues and with state reset on restart.
- Direct helper and mounted tracker-runtime tests cover the regressions.
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass on the pushed PR head.

## Scope boundary

The four later PR #19 review findings (Live-cue decode serialization, lane reassignment metadata,
Windows virtualenv lookup, and Warp timing) remain separate review threads and are not changed by
this plan.
