# Needs you — hung items

Per the L2→L5 march: anything that needs Anthony is collected here so the build never stops for it.
We tend to all of these together at the end.

## L4 — cast real, specific voices (cloning)
- **Record ~10s reference reads** — one clean ~10-second clip per voice you want cloned (you, Chris,
  anyone). Quiet room, natural delivery, one speaker. Send them (wav/m4a). I'll wire zero-shot
  cloning so a lane becomes that *actual person* and re-render the scores in those voices.
  - Until then, lanes cast from the neural catalog (Microsoft edge-tts) — no key, no input needed.
  - No API keys to hand over: edge-tts is free; cloning runs via the already-authenticated Hugging
    Face session (or a local model). Credentials are never a chat ask.

## Sharing beyond your machine
- **Zero-infra, works today — SHIPPED.** Run `node tools/build-standalone.mjs`; it writes
  `dist/speech-score.html` — a single ~9 MB file (engine + styles + all scores + neural audio
  inlined). Send Chris that one file; he double-clicks it, offline, no folder, no install. The
  live-cue human+AI duet works from it. *(The bare `philip-glass-tracker.html` alone is NOT enough —
  it loads 8 sibling files by relative path; use the bundle.)*
- **Shareable URL — SHIPPED.** The static export is live on Cloudflare Pages at
  <https://speech-score-engine.pages.dev>. Production deployment
  `1f267074-ffd8-490d-9e7d-03708efad394` serves commit `7768bf1`; dedicated score routes and both
  tracker entry surfaces were browser-verified after deployment.
