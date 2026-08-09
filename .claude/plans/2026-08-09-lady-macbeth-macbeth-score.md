---
plan_date: "2026-08-09"
status: archived
---

# Lady Macbeth / Macbeth speech score

## Goal

Ship the contemporary character poem as a two-lane score, a fast vertical performance reel, and a
desktop walkthrough without publishing or sending either video. Credit the poem to `@two.be` and
the artwork/source post to `@amaanjahangir`; never present the text as Shakespeare dialogue.

## Acceptance lineage

The later visual and timing corrections supersede the initial 45-second reel shape:

- Both columns are continuous passages that start together and advance independently from measured
  word boundaries. There are no row-sized pauses between fragments.
- The finished reel follows the short performance itself (about 6.67 seconds), rather than padding
  the corrected fast delivery to 45 seconds.
- The poem occupies the upper portion of the vertical frame. The artwork occupies the dominant lower
  portion. The left column is right-aligned and the right column is left-aligned so they meet at the
  center.
- The supplied artwork may appear in this private Instagram Story deliverable with type-only credits.
  The screenshot, artwork source, captures, and rendered videos remain outside source control.
- Outbound delivery stops at prepared files and prepared copy. No upload, Story post, tag, message,
  deployment, or public send is authorized by this plan.

## Product implementation

- Register `lady-macbeth-macbeth` in the library, tracker, editor, standalone shell, and generated
  Edge-TTS voice pack.
- Preserve the nine visual line pairs while each lane triggers one complete, independently timed
  passage with a UK neural voice and left/right panning.
- Keep three selectable dramatic sections functional by playing lane-specific trimmed excerpts of
  the continuous passages.
- Provide deterministic local tools for paired audio/timing generation, stereo mixing, and atomic
  story-reel rendering.

## Private deliverables

- `lady-macbeth-macbeth-reel.mp4` — 1080×1920 fast vertical performance.
- `lady-macbeth-macbeth-demo.mp4` — 1920×1080, 90-second library/tracker/editor walkthrough.
- Supporting artwork, raw captures, review frames, mix, and timing timeline remain private and
  ignored under `out/`.

## Prepared Instagram Story copy

> @two.be’s Lady Macbeth / Macbeth, visually remixed through @amaanjahangir’s artwork and scored as
> two simultaneous voices. poem @two.be · artwork @amaanjahangir · audio remix

Prepared only; not sent or published.

## Verification

- `pnpm test`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `node tools/build-standalone.mjs`
- Decode representative reel and demo frames; verify independent highlights, stereo audio, credits,
  media dimensions/durations, and private-artifact ignore state.
- Run the full predicate batch twice on an unchanged tree and require the second run to produce no
  tracked changes.
