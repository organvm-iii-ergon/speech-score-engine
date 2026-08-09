// Regenerate neural voice clips for score(s) in the speech-score engine.
//
//   node tools/render-voices.mjs
//   node tools/render-voices.mjs --score lady-macbeth-macbeth
//
// Source: Microsoft Edge neural TTS (edge-tts) — local, free, no API key, no GPU. Reads every
// score data file in apps/web/public/prototypes/scores/, and for each AI lane renders one clip per
// (lane, line) in that lane's assigned neural `voice`. Human lanes (performer:'human') are skipped —
// a live actor speaks those. Writes one self-contained asset per score,
// apps/web/public/prototypes/voices/<score-id>.js, assigning
// window.SSE_VOICES[<score-id>] = { clips: { "LANE|text": <base64 mp3> } }. The engine loads these
// via <script> tags (so it works over file://) and plays them as panned Web Audio buffers. Untimed
// legacy clips retain subtle humanization; word-timed clips stay deterministic for visual sync.
//
// Requirements: python3 + node. edge-tts is installed on first run into tools/.venv (gitignored).
// Re-running is cheap — rendered clips are cached in tools/.cache.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tools/render-voices.mjs [--score <score-id>]');
  process.exit(0);
}
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--score')) {
  throw new Error('Usage: node tools/render-voices.mjs [--score <score-id>]');
}
const requestedScoreId = args[0] === '--score' ? args[1] : null;
const SCORES_DIR = path.join(ROOT, 'apps/web/public/prototypes/scores');
const VOICES_DIR = path.join(ROOT, 'apps/web/public/prototypes/voices');
const VENV = path.join(ROOT, 'tools/.venv');
const CACHE = path.join(ROOT, 'tools/.cache');
const PYTHON = path.join(VENV, 'bin/python');
const EDGE_RENDERER = path.join(ROOT, 'tools/render-edge-tts.py');
const PROBE_TIMEOUT_MS = 10_000;
const BOOTSTRAP_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 120_000;

const canImportEdgeTts = () => {
  if (!fs.existsSync(PYTHON)) return false;
  try {
    execFileSync(PYTHON, ['-c', 'import edge_tts'], {
      stdio: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
};

if (!fs.existsSync(PYTHON)) {
  console.log('bootstrapping tools/.venv with edge-tts ...');
  execFileSync('python3', ['-m', 'venv', VENV], {
    stdio: 'inherit',
    timeout: BOOTSTRAP_TIMEOUT_MS,
  });
}
if (!canImportEdgeTts()) {
  console.log('installing edge-tts into tools/.venv ...');
  execFileSync(PYTHON, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'edge-tts'], {
    stdio: 'inherit',
    timeout: INSTALL_TIMEOUT_MS,
  });
}
if (!canImportEdgeTts()) {
  throw new Error('tools/.venv cannot import edge_tts after one bounded install attempt');
}

// Dependency admission completes before any output-pack directory or file is created.
fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(VOICES_DIR, { recursive: true });

// Load every score by evaluating its data file in a sandbox that stands in for the browser window.
const sandbox = {};
vm.createContext(sandbox);
for (const file of fs.readdirSync(SCORES_DIR).filter((f) => f.endsWith('.js')).sort()) {
  const src = fs.readFileSync(path.join(SCORES_DIR, file), 'utf8');
  new vm.Script(src, { filename: file }).runInContext(sandbox);
}
const scores = { ...(sandbox.SSE_SCORES || {}) };
// Also render plain SCORE JSON dropped here (e.g. exported from the /editor). This closes the
// editor -> neural loop: export a score, drop the .json in scores/, run this to voice it.
for (const file of fs.readdirSync(SCORES_DIR).filter((f) => f.endsWith('.json')).sort()) {
  try {
    const sc = JSON.parse(fs.readFileSync(path.join(SCORES_DIR, file), 'utf8'));
    if (sc && sc.id && Array.isArray(sc.lanes) && Array.isArray(sc.events)) scores[sc.id] = sc;
  } catch (e) {
    console.log(`SKIP ${file}: ${String(e.message).slice(0, 80)}`);
  }
}
console.log(`scores: ${Object.keys(scores).join(', ')}`);
if (requestedScoreId && !scores[requestedScoreId]) {
  throw new Error(`Unknown score: ${requestedScoreId}`);
}

const render = (voice, rate, text) => {
  const h = crypto
    .createHash('sha1')
    .update(`${voice}|${rate}|${text}`)
    .digest('hex')
    .slice(0, 12);
  const mp3 = path.join(CACHE, `${h}.mp3`);
  const timing = path.join(CACHE, `${h}.timing.json`);
  if (!fs.existsSync(mp3) || !fs.existsSync(timing)) {
    execFileSync(
      PYTHON,
      [
        EDGE_RENDERER,
        '--voice',
        voice,
        `--rate=${rate}`,
        '--text',
        text,
        '--media-out',
        mp3,
        '--timing-out',
        timing,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  }
  return {
    clip: fs.readFileSync(mp3).toString('base64'),
    timing: JSON.parse(fs.readFileSync(timing, 'utf8')),
  };
};

const targetScores = requestedScoreId ? [scores[requestedScoreId]] : Object.values(scores);
for (const score of targetScores) {
  const laneById = new Map(score.lanes.map((l) => [l.id, l]));
  const clips = {};
  const timings = {};
  const seen = new Set();
  let done = 0;
  let failures = 0;
  const aiEvents = score.events.filter(
    (e) => !e.silent && (laneById.get(e.lane) || {}).performer !== 'human',
  );
  for (const ev of aiEvents) {
    const speechText = ev.speechText || ev.text;
    const key = `${ev.lane}|${speechText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lane = laneById.get(ev.lane);
    if (!lane || !lane.voice) {
      failures += 1;
      console.log(`FAIL ${score.id} ${key}: AI lane has no neural voice`);
      continue;
    }
    try {
      const rendered = render(lane.voice, lane.rate || '+0%', speechText);
      clips[key] = rendered.clip;
      // Timings come from the same stream as every rendered clip. Continuous passages use them
      // for word-level cues; row-complete trackers use their measured duration as the next-row gate.
      timings[key] = rendered.timing;
      done += 1;
    } catch (e) {
      failures += 1;
      console.log(`FAIL ${score.id} ${key}: ${String(e.message).slice(0, 90)}`);
    }
  }
  const clipCount = Object.keys(clips).length;
  if (failures > 0 || clipCount === 0) {
    const message = `${score.id}: refusing to replace its generated pack after ${failures} failure(s) and ${clipCount} successful clip(s)`;
    if (requestedScoreId) throw new Error(message);
    console.log(`SKIP ${message}`);
    process.exitCode = 1;
    continue;
  }
  const payload = {
    source: 'edge-tts (Microsoft neural)',
    format: 'audio/mpeg',
    count: clipCount,
    clips,
    timings,
  };
  const header = `// GENERATED — do not edit. Neural voice clips for score "${score.id}".
// Source: Microsoft Edge neural TTS (edge-tts). Keys are "LANE|text"; the engine pans and schedules
// each trigger, keeping word-timed clips deterministic. Regenerate: node tools/render-voices.mjs
`;
  const body = `(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_VOICES = root.SSE_VOICES || {};
  root.SSE_VOICES[${JSON.stringify(score.id)}] = ${JSON.stringify(payload)};
})();
`;
  const out = path.join(VOICES_DIR, `${score.id}.js`);
  const pendingOut = `${out}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(pendingOut, header + body);
    fs.renameSync(pendingOut, out);
  } finally {
    fs.rmSync(pendingOut, { force: true });
  }
  console.log(
    `WROTE ${path.relative(ROOT, out)} — ${payload.count} clips, ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${done} rendered)`,
  );
}
