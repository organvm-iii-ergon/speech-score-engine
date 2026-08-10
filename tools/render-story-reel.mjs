// Render a two-lane score as a vertical, post-like performance reel.
//
//   node tools/render-story-reel.mjs \
//     --score lady-macbeth-macbeth \
//     --art out/lady-macbeth-macbeth-artwork-original.png \
//     --audio out/lady-macbeth-macbeth-performance.wav \
//     --out out/lady-macbeth-macbeth-reel.mp4 --force
//
// The generated voice pack is the visual timing authority. Continuous-passage scores advance each
// column from word boundaries; row-complete trackers advance both columns together after the
// longer measured line in the pair finishes.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { clipKey, deriveRowCompleteSchedule } from './row-complete-schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCORE_DIR = path.join(ROOT, 'apps/web/public/prototypes/scores');
const VOICE_DIR = path.join(ROOT, 'apps/web/public/prototypes/voices');
const VENV = path.join(ROOT, 'tools/.venv');
const VENV_BIN = process.platform === 'win32' ? 'Scripts' : 'bin';
const PYTHON = path.join(VENV, VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python');
const PIP = path.join(VENV, VENV_BIN, process.platform === 'win32' ? 'pip.exe' : 'pip');
const FRAME_RENDERER = path.join(ROOT, 'tools/render-story-frames.py');

const usage = `Usage:
  node tools/render-story-reel.mjs --score <id> --art <image> --audio <mix.wav> --out <reel.mp4> [--force]
`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (!['--score', '--art', '--audio', '--out'].includes(arg)) fail(`Unknown option: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${arg} requires a value`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  return options;
}

function loadRegistration(file, registration) {
  if (!fs.existsSync(file)) fail(`Missing ${path.relative(ROOT, file)}`);
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(sandbox);
  return sandbox[registration];
}

function projectPath(candidate) {
  return path.resolve(ROOT, candidate);
}

function comparablePath(file) {
  const resolved = path.resolve(file);
  let existing = resolved;
  const missingSegments = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return resolved;
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.join(fs.realpathSync(existing), ...missingSegments);
  } catch {
    return resolved;
  }
}

function ensureRendererRuntime() {
  if (!fs.existsSync(PYTHON)) {
    fail('Missing tools/.venv. Run node tools/render-voices.mjs once to bootstrap it.');
  }
  const probe = spawnSync(PYTHON, ['-c', 'import PIL'], { stdio: 'ignore' });
  if (probe.status === 0) return;
  const install = spawnSync(PIP, ['install', '--quiet', 'Pillow'], { stdio: 'inherit' });
  if (install.error) fail(`Could not install Pillow: ${install.error.message}`);
  if (install.status !== 0) fail(`Pillow installation exited with ${install.status}`);
}

function tokens(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).map((word) => word.normalize('NFKC'));
}

function lineCues(lines, words, lane) {
  let cursor = 0;
  const cues = lines.map((line) => {
    const expected = tokens(line);
    const actual = words.slice(cursor, cursor + expected.length);
    const actualTokens = actual.map((word) => tokens(word.text)[0]);
    if (expected.length === 0 || expected.join('|') !== actualTokens.join('|')) {
      fail(`Word timing mismatch for ${lane} line ${JSON.stringify(line)}`);
    }
    cursor += expected.length;
    return {
      line,
      start: actual[0].start,
      spokenEnd: actual.at(-1).end,
    };
  });
  if (cursor !== words.length) fail(`Unused word timings remain for ${lane}`);
  return cues.map((cue, index) => ({
    ...cue,
    end: index + 1 < cues.length ? cues[index + 1].start : cue.spokenEnd + 0.08,
  }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!options.score || !options.art || !options.audio || !options.out) fail(usage.trim());

  const scoreFile = path.join(SCORE_DIR, `${options.score}.js`);
  const voiceFile = path.join(VOICE_DIR, `${options.score}.js`);
  const scores = loadRegistration(scoreFile, 'SSE_SCORES');
  const voices = loadRegistration(voiceFile, 'SSE_VOICES');
  const score = scores?.[options.score];
  const voicePack = voices?.[options.score];
  if (!score?.visualPairs || score.lanes.length !== 2) fail('Story reels require a two-lane score with visualPairs.');
  if (!voicePack?.timings) fail('Voice pack has no word timings. Run node tools/render-voices.mjs first.');

  const art = projectPath(options.art);
  const audio = projectPath(options.audio);
  const out = projectPath(options.out);
  if ([scoreFile, voiceFile].some((input) => comparablePath(input) === comparablePath(out))) {
    fail('--out must be different from implicit score/voice source paths.');
  }
  for (const file of [art, audio]) if (!fs.existsSync(file)) fail(`Missing ${path.relative(ROOT, file)}`);
  if ([art, audio].some((input) => comparablePath(input) === comparablePath(out))) {
    fail('--out must be different from both input paths.');
  }
  if (fs.existsSync(out) && !options.force) fail(`Refusing to replace ${path.relative(ROOT, out)} without --force.`);
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const rowCompleteSchedule = deriveRowCompleteSchedule(score, voicePack);
  const duration = rowCompleteSchedule?.duration ?? score.total / score.tempo;
  const lanes = rowCompleteSchedule
    ? score.lanes.map((lane) => ({
        id: lane.id,
        name: lane.name,
        align: lane.align,
        cues: rowCompleteSchedule.rows.map((row) => {
          const clip = row.clips.find(({ event }) => event.lane === lane.id);
          if (!clip) fail(`Row ${row.row} is missing lane ${lane.id}`);
          return { line: clip.event.text, start: row.start, end: row.end };
        }),
      }))
    : score.lanes.map((lane, laneIndex) => {
        const sourceEvent = score.events.find(
          (event) => event.lane === lane.id && event.speechText && !event.silent,
        );
        const timing = sourceEvent ? voicePack.timings[clipKey(sourceEvent)] : null;
        if (!timing) fail(`Missing timing for lane ${lane.id}`);
        return {
          id: lane.id,
          name: lane.name,
          align: lane.align,
          cues: lineCues(
            score.visualPairs.map((pair) => pair[laneIndex]),
            timing.words,
            lane.id,
          ),
        };
      });
  const spec = {
    duration,
    fps: 30,
    lanes,
    credit: 'poem @two.be  ·  artwork @amaanjahangir  ·  audio remix',
  };

  const temp = fs.mkdtempSync(path.join(path.dirname(out), '.speech-score-story-'));
  const specFile = path.join(temp, 'spec.json');
  const temporaryOut = path.join(temp, 'reel.mp4');
  try {
    ensureRendererRuntime();
    fs.writeFileSync(specFile, JSON.stringify(spec));
    const result = spawnSync(
      PYTHON,
      [
        FRAME_RENDERER,
        '--spec',
        specFile,
        '--art',
        art,
        '--audio',
        audio,
        '--out',
        temporaryOut,
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    if (result.error) fail(`Could not run the frame renderer: ${result.error.message}`);
    if (result.status !== 0) fail(`Frame renderer exited with ${result.status}`);
    fs.renameSync(temporaryOut, out);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log(`WROTE ${path.relative(ROOT, out)} — ${duration.toFixed(2)} s, independently timed lanes`);
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
