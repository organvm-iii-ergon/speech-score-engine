---
plan_date: "2026-08-10"
status: archived
---

# Configurable stereo and vocal-register separation

## Goal

Hard-pan Lady Macbeth left and Macbeth right while retaining five independently auditionable voice
treatments across the score, generated voice pack, tracker, editor, offline mixer, and private reel
workflow.

## Decisions

- `separated` is the score default; `natural`, `subtle`, `theatrical`, and `octave-split` remain
  first-class configurations.
- Edge-TTS renders the four Hz-offset treatments directly. FFmpeg derives `octave-split` from the
  natural clips with duration-preserving semitone transposition.
- A selected configuration owns both clips and timings. Top-level voice-pack clips and timings stay
  aliases of the default configuration for compatibility.
- All five configurations must finish before the tracked Lady Macbeth voice pack is atomically
  replaced.
- Private comparison media stays ignored and unpublished; PR #19 remains unmerged.

## Verification

- Exercise score metadata, editor/standalone/URL selection, row-complete scheduling, CLI selection,
  atomic generation, cache identity, panner routing, and octave DSP in integration tests.
- Run tests, lint, typecheck, build, standalone generation, and diff checks twice.
- Render and inspect all five ignored mixes, timelines, and 1080x1920 private H.264/AAC reels using
  the existing artwork in place.
- Commit the implementation onto the canonical PR branch, push it, and verify exact-head CI without
  merging or publishing private media.
