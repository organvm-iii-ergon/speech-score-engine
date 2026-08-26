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

import { transposeAudioDurationPreserving } from './pitch-preserving-transpose.mjs';

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
const VENV_BIN = process.platform === 'win32' ? 'Scripts' : 'bin';
const PYTHON = path.join(VENV, VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python');
const BOOTSTRAP_PYTHON = process.platform === 'win32' ? 'python' : 'python3';
const CACHE = path.join(ROOT, 'tools/.cache');
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
  execFileSync(BOOTSTRAP_PYTHON, ['-m', 'venv', VENV], {
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

const cachePaths = (voice, rate, text, pitch, transposeSemitones) => {
  const h = crypto
    .createHash('sha1')
    .update(`${voice}|${rate}|${pitch}|${transposeSemitones}|${text}`)
    .digest('hex')
    .slice(0, 12);
  return {
    mp3: path.join(CACHE, `${h}.mp3`),
    timing: path.join(CACHE, `${h}.timing.json`),
  };
};

const renderEdge = (voice, rate, text, pitch) => {
  const files = cachePaths(voice, rate, text, pitch, 0);
  if (!fs.existsSync(files.mp3) || !fs.existsSync(files.timing)) {
    execFileSync(
      PYTHON,
      [
        EDGE_RENDERER,
        '--voice',
        voice,
        `--rate=${rate}`,
        `--pitch=${pitch}`,
        '--text',
        text,
        '--media-out',
        files.mp3,
        '--timing-out',
        files.timing,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  }
  return {
    clip: fs.readFileSync(files.mp3).toString('base64'),
    media: files.mp3,
    timing: JSON.parse(fs.readFileSync(files.timing, 'utf8')),
  };
};

const render = (voice, rate, text, treatment) => {
  const pitch = treatment.pitch || '+0Hz';
  const transposeSemitones = treatment.transposeSemitones || 0;
  if (transposeSemitones === 0) return renderEdge(voice, rate, text, pitch);

  const natural = renderEdge(voice, rate, text, pitch);
  const files = cachePaths(voice, rate, text, pitch, transposeSemitones);
  if (!fs.existsSync(files.mp3) || !fs.existsSync(files.timing)) {
    transposeAudioDurationPreserving(natural.media, files.mp3, transposeSemitones);
    const timingTemporary = `${files.timing}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(
        timingTemporary,
        JSON.stringify({
          ...natural.timing,
          pitch,
          transposeSemitones,
        }),
      );
      fs.renameSync(timingTemporary, files.timing);
    } finally {
      fs.rmSync(timingTemporary, { force: true });
    }
  }
  return {
    clip: fs.readFileSync(files.mp3).toString('base64'),
    media: files.mp3,
    timing: JSON.parse(fs.readFileSync(files.timing, 'utf8')),
  };
};

const voiceConfigurationPlan = (score, aiLanes) => {
  const configured = score.voiceConfigurations;
  if (!configured || typeof configured !== 'object' || Object.keys(configured).length === 0) {
    return { defaultId: null, configurations: [{ id: null, treatments: {} }] };
  }
  const ids = Object.keys(configured);
  const defaultId = score.defaultVoiceConfiguration;
  if (!defaultId || !ids.includes(defaultId)) {
    throw new Error(`${score.id}: defaultVoiceConfiguration must name a voice configuration`);
  }
  const configurations = ids.map((id) => {
    const treatments = configured[id];
    if (!treatments || typeof treatments !== 'object') {
      throw new Error(`${score.id}: voice configuration ${id} must map lane IDs to treatments`);
    }
    for (const lane of aiLanes) {
      const treatment = treatments[lane.id];
      if (!treatment || typeof treatment !== 'object') {
        throw new Error(`${score.id}: voice configuration ${id} is missing lane ${lane.id}`);
      }
      const hasPitch = typeof treatment.pitch === 'string';
      const hasTranspose = Number.isFinite(treatment.transposeSemitones);
      if (hasPitch === hasTranspose) {
        throw new Error(
          `${score.id}: ${id}.${lane.id} must define either pitch or transposeSemitones`,
        );
      }
      if (hasPitch && !/^[+-]\d+(?:\.\d+)?Hz$/.test(treatment.pitch)) {
        throw new Error(`${score.id}: ${id}.${lane.id} has an invalid Edge-TTS pitch`);
      }
      if (hasTranspose && treatment.transposeSemitones === 0) {
        throw new Error(`${score.id}: ${id}.${lane.id} transposeSemitones cannot be zero`);
      }
    }
    return { id, treatments };
  });
  return { defaultId, configurations };
};

const targetScores = requestedScoreId ? [scores[requestedScoreId]] : Object.values(scores);
for (const score of targetScores) {
  const laneById = new Map(score.lanes.map((l) => [l.id, l]));
  const aiLanes = score.lanes.filter((lane) => lane.performer !== 'human');
  const plan = voiceConfigurationPlan(score, aiLanes);
  const generatedConfigurations = {};
  let done = 0;
  let failures = 0;
  const aiEvents = score.events.filter(
    (e) => !e.silent && (laneById.get(e.lane) || {}).performer !== 'human',
  );
  const uniqueAiEvents = aiEvents.filter((event, index, events) => {
    const key = `${event.lane}|${event.speechText || event.text}`;
    return events.findIndex((candidate) => `${candidate.lane}|${candidate.speechText || candidate.text}` === key) === index;
  });
  for (const configuration of plan.configurations) {
    const clips = {};
    const timings = {};
    for (const ev of uniqueAiEvents) {
      const speechText = ev.speechText || ev.text;
      const key = `${ev.lane}|${speechText}`;
      const lane = laneById.get(ev.lane);
      if (!lane || !lane.voice) {
        failures += 1;
        console.log(`FAIL ${score.id} ${configuration.id || 'default'} ${key}: AI lane has no neural voice`);
        continue;
      }
      try {
        const treatment = configuration.treatments[ev.lane] || { pitch: '+0Hz' };
        const rendered = render(lane.voice, lane.rate || '+0%', speechText, treatment);
        const expectedPitch = treatment.pitch || '+0Hz';
        const expectedTranspose = treatment.transposeSemitones || 0;
        if (
          !Number.isFinite(rendered.timing?.duration) ||
          rendered.timing.duration <= 0 ||
          !Array.isArray(rendered.timing.words) ||
          rendered.timing.words.length === 0 ||
          rendered.timing.pitch !== expectedPitch ||
          rendered.timing.transposeSemitones !== expectedTranspose
        ) {
          throw new Error('rendered timing metadata does not match its voice treatment');
        }
        clips[key] = rendered.clip;
        // Timings come from the same stream as every rendered clip. Continuous passages use them
        // for word-level cues; row-complete trackers use their measured duration as the next-row gate.
        timings[key] = rendered.timing;
        done += 1;
      } catch (e) {
        failures += 1;
        console.log(
          `FAIL ${score.id} ${configuration.id || 'default'} ${key}: ${String(e.message).slice(0, 90)}`,
        );
      }
    }
    generatedConfigurations[configuration.id || 'default'] = {
      count: Object.keys(clips).length,
      clips,
      timings,
    };
  }
  const expectedPerConfiguration = uniqueAiEvents.length;
  const totalCount = Object.values(generatedConfigurations).reduce(
    (sum, configuration) => sum + configuration.count,
    0,
  );
  const incomplete = Object.entries(generatedConfigurations).find(
    ([, configuration]) =>
      configuration.count !== expectedPerConfiguration ||
      Object.keys(configuration.timings).length !== expectedPerConfiguration,
  );
  if (failures > 0 || expectedPerConfiguration === 0 || incomplete) {
    const message = `${score.id}: refusing to replace its generated pack after ${failures} failure(s) and ${totalCount} successful clip(s)`;
    if (requestedScoreId) throw new Error(message);
    console.log(`SKIP ${message}`);
    process.exitCode = 1;
    continue;
  }
  const defaultKey = plan.defaultId || 'default';
  const defaultConfiguration = generatedConfigurations[defaultKey];
  const payload = {
    source: 'edge-tts (Microsoft neural)',
    format: 'audio/mpeg',
    count: defaultConfiguration.count,
    totalCount,
  };
  const header = `// GENERATED — do not edit. Neural voice clips for score "${score.id}".
// Source: Microsoft Edge neural TTS (edge-tts). Keys are "LANE|text"; the engine pans and schedules
// each trigger, keeping word-timed clips deterministic. Regenerate: node tools/render-voices.mjs
`;
  const body = `(function () {
  var root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_VOICES = root.SSE_VOICES || {};
  var configurations = ${JSON.stringify(generatedConfigurations)};
  root.SSE_VOICES[${JSON.stringify(score.id)}] = Object.assign(${JSON.stringify(payload)}, {
    configurations: configurations,
    clips: configurations[${JSON.stringify(defaultKey)}].clips,
    timings: configurations[${JSON.stringify(defaultKey)}].timings
  });
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
    `WROTE ${path.relative(ROOT, out)} — ${payload.totalCount} clips across ${plan.configurations.length} configuration(s), ${(fs.statSync(out).size / 1024).toFixed(0)} KB (${done} rendered)`,
  );
}
