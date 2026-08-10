// Build a deterministic stereo score mix from a generated voice pack, optionally muxed into video.
//
//   node tools/mix-score-audio.mjs --score lady-macbeth-macbeth --out out/performance.wav
//   node tools/mix-score-audio.mjs --score lady-macbeth-macbeth --out out/performance.wav \
//     --video out/silent-reel.mp4 --video-out out/lady-macbeth-macbeth-reel.mp4
//
// It uses only local generated clips and FFmpeg. The source score remains the timing authority:
// start/row ÷ tempo becomes each clip's placement, and lane pan/gain become a stable stereo mix.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { deriveRowCompleteSchedule } from './row-complete-schedule.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCORES_DIR = path.join(ROOT, 'apps/web/public/prototypes/scores');
const VOICES_DIR = path.join(ROOT, 'apps/web/public/prototypes/voices');

const usage = `Usage:
  node tools/mix-score-audio.mjs --score <id> --out <mix.wav> [options]

Options:
  --duration <seconds>  Pad or trim the finished mix to this duration (default: score duration).
  --timeline-out <path> Write the exact lane/word cue timeline used by the mix as JSON.
  --video <path>        A silent or scratch-audio video to mux with the generated mix.
  --video-out <path>    MP4 destination when --video is supplied (required with --video).
  --force               Replace an existing output file.
  --help                Show this help.

Before mixing, generate the voice pack with:
  node tools/render-voices.mjs
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
    if (!['--score', '--out', '--duration', '--timeline-out', '--video', '--video-out'].includes(arg)) {
      fail(`Unknown option: ${arg}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`${arg} requires a value`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return options;
}

function resolveProjectPath(candidate) {
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

function loadRegistration(file, name) {
  if (!fs.existsSync(file)) fail(`Missing ${name}: ${path.relative(ROOT, file)}`);
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(sandbox);
  return sandbox;
}

function loadScore(scoreId) {
  const scriptFile = path.join(SCORES_DIR, `${scoreId}.js`);
  const jsonFile = path.join(SCORES_DIR, `${scoreId}.json`);
  if (fs.existsSync(scriptFile)) {
    const score = loadRegistration(scriptFile, 'score file').SSE_SCORES?.[scoreId];
    if (!score) fail(`Score ${JSON.stringify(scoreId)} did not register itself.`);
    return { file: scriptFile, score };
  }
  if (fs.existsSync(jsonFile)) {
    try {
      const score = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
      if (score?.id === scoreId && Array.isArray(score.lanes) && Array.isArray(score.events)) {
        return { file: jsonFile, score };
      }
    } catch (error) {
      fail(`Could not parse editor-exported score ${path.relative(ROOT, jsonFile)}: ${error.message}`);
    }
    fail(`Editor-exported score ${path.relative(ROOT, jsonFile)} is not a valid SCORE.`);
  }
  fail(`Missing score file: ${path.relative(ROOT, scriptFile)} or ${path.relative(ROOT, jsonFile)}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status}`);
}

function assertWritableOutput(file, force) {
  if (fs.existsSync(file) && !force) {
    fail(`Refusing to replace existing output: ${file}\nRe-run with --force to replace it.`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function atomicWriteFile(file, contents) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, contents);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function scoreSeconds(score) {
  if (typeof score.tempo !== 'number' || score.tempo <= 0) fail('Score must define a positive tempo.');
  if (typeof score.total !== 'number' || score.total <= 0) fail('Score must define a positive total.');
  return score.total / score.tempo;
}

function eventStart(event) {
  return typeof event.start === 'number' ? event.start : event.row;
}

function panGains(pan) {
  const amount = Math.max(-1, Math.min(1, typeof pan === 'number' ? pan : 0));
  return { left: (1 - amount) / 2, right: (1 + amount) / 2 };
}

function safeNumber(value) {
  return Number(value.toFixed(6));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage);
    return;
  }
  if (!options.score || !options.out) fail('--score and --out are required.\n\n' + usage);
  if (Boolean(options.video) !== Boolean(options.videoOut)) {
    fail('--video and --video-out must be used together.');
  }

  const { file: scoreFile, score } = loadScore(options.score);
  const voiceFile = path.join(VOICES_DIR, `${options.score}.js`);
  const voiceSandbox = loadRegistration(voiceFile, 'voice pack');
  const voicePack = voiceSandbox.SSE_VOICES?.[options.score];
  if (!voicePack?.clips) fail(`Voice pack ${JSON.stringify(options.score)} did not register clips.`);

  const rowCompleteSchedule = deriveRowCompleteSchedule(score, voicePack);
  const duration =
    options.duration === undefined
      ? (rowCompleteSchedule?.duration ?? scoreSeconds(score))
      : Number(options.duration);
  if (!Number.isFinite(duration) || duration <= 0) fail('--duration must be a positive number of seconds.');
  const out = resolveProjectPath(options.out);
  const timelineOut = options.timelineOut ? resolveProjectPath(options.timelineOut) : null;
  const video = options.video ? resolveProjectPath(options.video) : null;
  const videoOut = options.videoOut ? resolveProjectPath(options.videoOut) : null;
  if (video && !fs.existsSync(video)) fail(`Video input does not exist: ${video}`);
  const outputs = [
    ['--out', out],
    ...(timelineOut ? [['--timeline-out', timelineOut]] : []),
    ...(videoOut ? [['--video-out', videoOut]] : []),
  ];
  for (let first = 0; first < outputs.length; first += 1) {
    for (let second = first + 1; second < outputs.length; second += 1) {
      if (comparablePath(outputs[first][1]) === comparablePath(outputs[second][1])) {
        fail(`${outputs[first][0]} and ${outputs[second][0]} must be different paths.`);
      }
    }
  }
  for (const [label, output] of outputs) {
    if ([scoreFile, voiceFile].some((input) => comparablePath(input) === comparablePath(output))) {
      fail(`${label} must be different from implicit score/voice source paths.`);
    }
  }
  if (video) {
    for (const [label, output] of outputs) {
      if (comparablePath(video) === comparablePath(output)) {
        fail(`--video input and ${label} must be different paths.`);
      }
    }
  }

  const lanes = new Map(score.lanes.map((lane) => [lane.id, lane]));
  const events = rowCompleteSchedule
    ? rowCompleteSchedule.rows.flatMap(({ clips }) =>
        clips.map(({ event, lane, start }) => ({ event, lane, startSeconds: start })),
      )
    : score.events
        .map((event) => ({ event, lane: lanes.get(event.lane), startSeconds: eventStart(event) / score.tempo }))
        .filter(({ event, lane }) => !event.silent && lane?.performer !== 'human');
  events.sort((left, right) => left.startSeconds - right.startSeconds);
  if (!events.length) fail('Score has no AI voice events to mix.');
  if (timelineOut) {
    const missingTiming = events.find(({ event }) => {
      const speechText = event.speechText || event.text;
      const words = voicePack.timings?.[`${event.lane}|${speechText}`]?.words;
      return !Array.isArray(words) || words.length === 0;
    });
    if (missingTiming) {
      const speechText = missingTiming.event.speechText || missingTiming.event.text;
      fail(
        `Cannot write --timeline-out: mixed voice event ${JSON.stringify(
          `${missingTiming.event.lane}|${speechText}`,
        )} lacks a non-empty Edge-TTS word-timing record.`,
      );
    }
  }
  // Validate exact-timeline eligibility before creating output directories or invoking FFmpeg.
  for (const [, output] of outputs) assertWritableOutput(output, options.force);

  const temp = fs.mkdtempSync(path.join(path.dirname(out), '.speech-score-mix-'));
  const muxTemp = videoOut
    ? fs.mkdtempSync(path.join(path.dirname(videoOut), '.speech-score-mux-'))
    : temp;
  const temporaryWav = path.join(temp, 'mix.wav');
  const temporaryMp4 = path.join(muxTemp, 'muxed.mp4');
  try {
    const filters = [];
    const inputs = [];
    const timeline = {
      score: score.id,
      duration,
      source: 'Edge-TTS word boundaries from the same stream as each mixed clip',
      events: [],
    };
    for (const [index, { event, lane, startSeconds }] of events.entries()) {
      const speechText = event.speechText || event.text;
      const key = `${event.lane}|${speechText}`;
      const clip = voicePack.clips[key];
      if (!clip) {
        fail(`Voice pack is missing ${JSON.stringify(key)}. Run node tools/render-voices.mjs first.`);
      }
      const clipFile = path.join(temp, `clip-${String(index).padStart(2, '0')}.mp3`);
      fs.writeFileSync(clipFile, Buffer.from(clip, 'base64'));
      inputs.push('-i', clipFile);

      const clipTiming = voicePack.timings?.[key];
      const words = (clipTiming?.words || [])
        .map((word) => ({
          text: word.text,
          start: safeNumber(startSeconds + word.start),
          end: safeNumber(Math.min(duration, startSeconds + word.end)),
        }))
        .filter((word) => word.start < duration && word.end > word.start);
      // `--duration` defines the final media boundary. Do not describe words or events that were
      // trimmed from that media as though they were part of the exact output timeline.
      if (words.length) {
        timeline.events.push({
          lane: event.lane,
          text: speechText,
          start: startSeconds,
          pan: lane.pan ?? 0,
          words,
        });
      }
      const delay = Math.max(0, Math.round(startSeconds * 1000));
      const pan = panGains(lane.pan);
      const gain = typeof lane.gain === 'number' ? lane.gain : 1;
      const eventGain = typeof event.gain === 'number' ? event.gain : 1;
      filters.push(
        `[${index}:a]aformat=channel_layouts=mono,aresample=48000,volume=${safeNumber(gain * eventGain)},pan=stereo|c0=${safeNumber(pan.left)}*c0|c1=${safeNumber(pan.right)}*c0,adelay=${delay}:all=1[a${index}]`,
      );
    }
    filters.push(
      `${events.map((_, index) => `[a${index}]`).join('')}amix=inputs=${events.length}:normalize=0:duration=longest:dropout_transition=0,alimiter=limit=0.95:latency=1,apad=whole_dur=${safeNumber(duration)},atrim=duration=${safeNumber(duration)},aresample=48000[mix]`,
    );

    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[mix]',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      temporaryWav,
    ]);
    fs.renameSync(temporaryWav, out);
    console.log(`WROTE ${path.relative(ROOT, out)} — ${events.length} clips, ${duration.toFixed(2)} s stereo WAV`);
    if (timelineOut) {
      atomicWriteFile(timelineOut, JSON.stringify(timeline, null, 2) + '\n');
      console.log(`WROTE ${path.relative(ROOT, timelineOut)} — ${timeline.events.length} timed voice events`);
    }

    if (video && videoOut) {
      run('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'warning',
        '-y',
        '-i',
        video,
        '-i',
        out,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-t',
        String(duration),
        '-c:v',
        'libx264',
        '-crf',
        '18',
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-shortest',
        temporaryMp4,
      ]);
      fs.renameSync(temporaryMp4, videoOut);
      console.log(`WROTE ${path.relative(ROOT, videoOut)} — H.264/AAC muxed from the stereo score mix`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
    if (muxTemp !== temp) fs.rmSync(muxTemp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
