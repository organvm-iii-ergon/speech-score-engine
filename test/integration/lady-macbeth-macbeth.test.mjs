import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  deriveScoreTotal,
  renameContinuousPassageLine,
} from '../../apps/web/src/lib/scoreEditing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCORE_ID = 'lady-macbeth-macbeth';
const SCORE_RELATIVE = `apps/web/public/prototypes/scores/${SCORE_ID}.js`;
const VOICE_RELATIVE = `apps/web/public/prototypes/voices/${SCORE_ID}.js`;
const SCORE_FILE = path.join(ROOT, SCORE_RELATIVE);
const VOICE_FILE = path.join(ROOT, VOICE_RELATIVE);

const EXPECTED_PAIRS = [
  ['i love', 'you'],
  ['you', 'have transformed me'],
  ['with strange tenderness', 'and i am the monster'],
  ['that startles me', 'in the mirror.'],
  ['and', 'i have come full circle.'],
  ['i cannot allow', 'this. this is me,'],
  ['myself', 'as i was destined'],
  ['to be', 'from my birth.'],
  ['so soft', 'it hurts.'],
];

function evaluateRegistration(file, registration) {
  const sandbox = {};
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }).runInContext(sandbox);
  const value = sandbox[registration]?.[SCORE_ID];
  return value ? JSON.parse(JSON.stringify(value)) : undefined;
}

function tokens(value) {
  return (
    String(value)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || []
  ).map((word) => word.normalize('NFKC'));
}

function copyIntoSandbox(sandboxRoot, relativePath) {
  const source = path.join(ROOT, relativePath);
  const destination = path.join(sandboxRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return destination;
}

function withCliSandbox(tool, callback) {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lady-macbeth-score-test-'));
  try {
    const toolFile = copyIntoSandbox(sandboxRoot, `tools/${tool}`);
    const scoreFile = copyIntoSandbox(sandboxRoot, SCORE_RELATIVE);
    const voiceFile = copyIntoSandbox(sandboxRoot, VOICE_RELATIVE);
    const inputs = path.join(sandboxRoot, 'test-inputs');
    fs.mkdirSync(inputs, { recursive: true });
    const artFile = path.join(inputs, 'art.png');
    const audioFile = path.join(inputs, 'audio.wav');
    fs.writeFileSync(artFile, 'dummy artwork; the guard must fire before decoding');
    fs.writeFileSync(audioFile, 'dummy audio; the guard must fire before decoding');
    callback({ sandboxRoot, toolFile, scoreFile, voiceFile, artFile, audioFile });
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

function writeLegacyNoTimingFixture(sandboxRoot) {
  const scoreId = 'legacy-no-timing';
  const scorePath = path.join(sandboxRoot, 'apps/web/public/prototypes/scores', `${scoreId}.js`);
  const voicePath = path.join(sandboxRoot, 'apps/web/public/prototypes/voices', `${scoreId}.js`);
  fs.mkdirSync(path.dirname(scorePath), { recursive: true });
  fs.mkdirSync(path.dirname(voicePath), { recursive: true });
  fs.writeFileSync(
    scorePath,
    `(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_SCORES = root.SSE_SCORES || {};
  root.SSE_SCORES[${JSON.stringify(scoreId)}] = {
    id: ${JSON.stringify(scoreId)},
    tempo: 1,
    total: 1,
    lanes: [{ id: 'LEGACY', performer: 'ai' }],
    events: [{ row: 0, lane: 'LEGACY', text: 'no timing' }],
  };
})();
`,
  );
  fs.writeFileSync(
    voicePath,
    `(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_VOICES = root.SSE_VOICES || {};
  root.SSE_VOICES[${JSON.stringify(scoreId)}] = {
    clips: { 'LEGACY|no timing': 'ZHVtbXk=' },
  };
})();
`,
  );
  return scoreId;
}

function fakeClassList() {
  const tokens = new Set();
  return {
    add: (...names) => {
      for (const name of names) tokens.add(name);
    },
    remove: (...names) => {
      for (const name of names) tokens.delete(name);
    },
    toggle: (name, force) => {
      if (force === undefined) {
        if (tokens.has(name)) {
          tokens.delete(name);
          return false;
        }
        tokens.add(name);
        return true;
      }
      if (force) tokens.add(name);
      else tokens.delete(name);
      return force;
    },
    contains: (name) => tokens.has(name),
  };
}

function fakeElement(tagName = 'div') {
  const listeners = new Map();
  return {
    tagName,
    children: [],
    classList: fakeClassList(),
    dataset: {},
    style: { setProperty: () => {} },
    offsetHeight: 26,
    offsetWidth: 1,
    clientHeight: 260,
    scrollHeight: 1000,
    textContent: '',
    className: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    emit(type, event = { target: this }) {
      return listeners.get(type)?.(event);
    },
    closest(selector) {
      return selector === 'button' && this.tagName === 'button' ? this : null;
    },
    connect() {
      return this;
    },
    disconnect() {},
  };
}

function mountTimedTracker({ deferDecode = false } = {}) {
  let now = 0;
  let nextAnimationFrame = 1;
  const animationFrames = new Map();
  const oscillatorStarts = [];
  const starts = [];
  const pendingDecodes = [];
  const decodedBuffer = {
    duration: 10,
    getChannelData: () => new Float32Array(1),
  };

  class FakeAudioContext {
    constructor() {
      this.destination = fakeElement('destination');
      this.state = 'running';
    }

    get currentTime() {
      return now / 1000;
    }

    createGain() {
      const gain = fakeElement('gain');
      gain.gain = {
        value: 1,
        cancelScheduledValues: () => {},
        setValueAtTime: (value) => {
          gain.gain.value = value;
        },
        linearRampToValueAtTime: (value) => {
          gain.gain.value = value;
        },
        exponentialRampToValueAtTime: (value) => {
          gain.gain.value = value;
        },
      };
      return gain;
    }

    createStereoPanner() {
      const panner = fakeElement('panner');
      panner.pan = { value: 0 };
      return panner;
    }

    createBufferSource() {
      const source = fakeElement('source');
      source.detune = { value: 0 };
      source.playbackRate = { value: 1 };
      source.start = (when, offset, duration) => {
        starts.push({ when, offset, duration, playbackRate: source.playbackRate.value });
      };
      source.stop = () => source.onended?.();
      return source;
    }

    createOscillator() {
      const oscillator = fakeElement('oscillator');
      oscillator.frequency = {
        value: 0,
        setValueAtTime: (value) => {
          oscillator.frequency.value = value;
        },
      };
      oscillator.start = (when) => {
        oscillatorStarts.push({ frequency: oscillator.frequency.value, when });
      };
      oscillator.stop = () => oscillator.onended?.();
      return oscillator;
    }

    decodeAudioData() {
      if (!deferDecode) return Promise.resolve(decodedBuffer);
      return new Promise((resolve) => pendingDecodes.push(() => resolve(decodedBuffer)));
    }

    resume() {
      return Promise.resolve();
    }

    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
  }

  const root = fakeElement('root');
  const ui = new Map();
  const createUi = (selector, tagName = 'div') => {
    const element = fakeElement(tagName);
    ui.set(selector, element);
    return element;
  };
  root.querySelector = (selector) => ui.get(selector) || null;
  createUi('.t-title');
  createUi('.t-byline');
  createUi('.t-caption');
  createUi('.t-track').scrollHeight = 1000;
  createUi('.t-viewport').clientHeight = 260;
  createUi('.t-heads');
  createUi('.t-scores');
  createUi('.t-sections');
  createUi('.t-play', 'button');
  createUi('.t-restart', 'button');
  const sound = createUi('.t-sound');
  const voiceButton = fakeElement('button');
  voiceButton.dataset.m = 'voice';
  const toneButton = fakeElement('button');
  toneButton.dataset.m = 'tone';
  const silentButton = fakeElement('button');
  silentButton.dataset.m = 'off';
  sound.children.push(voiceButton, toneButton, silentButton);
  createUi('.t-mode');
  createUi('.t-countin', 'button');
  createUi('.t-tempo').value = String(score.tempo);
  createUi('.t-count');
  createUi('.t-hint');

  const runtimeScore = JSON.parse(JSON.stringify(score));
  const runtimeTimings = JSON.parse(JSON.stringify(voicePack.timings));
  const clips = Object.fromEntries(Object.keys(runtimeTimings).map((key) => [key, 'AA==']));
  const window = {
    AudioContext: FakeAudioContext,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout,
  };
  const sandbox = {
    window,
    document: { createElement: fakeElement },
    navigator: {},
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      const id = nextAnimationFrame;
      nextAnimationFrame += 1;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => animationFrames.delete(id),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    clearTimeout,
  };
  vm.createContext(sandbox);
  new vm.Script(
    fs.readFileSync(path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'), 'utf8'),
  ).runInContext(sandbox);
  const mounted = window.SSEEngine.mount(root, {
    score: runtimeScore,
    clips,
    timings: runtimeTimings,
    scores: [runtimeScore],
  });

  return {
    animationFrames,
    mounted,
    oscillatorStarts,
    pendingDecodes,
    setNow: (value) => {
      now = value;
    },
    sound,
    starts,
    toneButton,
    ui,
    voiceButton,
  };
}

async function flushTrackerWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function emitTrackerClick(element, target = element) {
  element.emit('click', { target });
  await flushTrackerWork();
}

const score = evaluateRegistration(SCORE_FILE, 'SSE_SCORES');
const voicePack = evaluateRegistration(VOICE_FILE, 'SSE_VOICES');

test('score preserves the nine simultaneous left/right pairs and lane geometry', () => {
  assert.ok(score, 'score must self-register');
  assert.deepEqual(score.visualPairs, EXPECTED_PAIRS);
  assert.deepEqual(
    score.lanes.map(({ id, align }) => ({ id, align })),
    [
      { id: 'LADY_MACBETH', align: 'right' },
      { id: 'MACBETH', align: 'left' },
    ],
  );

  const triggers = score.events.filter((event) => !event.silent);
  assert.equal(triggers.length, 2);
  assert.deepEqual(
    triggers.map((event) => ({ lane: event.lane, start: event.start ?? event.row })),
    [
      { lane: 'LADY_MACBETH', start: 0 },
      { lane: 'MACBETH', start: 0 },
    ],
  );
  assert.ok(
    triggers.every((event) => event.speechText),
    'both row-zero events trigger full passages',
  );

  for (let row = 1; row < EXPECTED_PAIRS.length; row += 1) {
    const continuation = score.events.filter((event) => event.row === row);
    assert.equal(continuation.length, 2, `row ${row} must retain both visual lanes`);
    assert.ok(
      continuation.every((event) => event.silent),
      `row ${row} must not retrigger audio`,
    );
    assert.ok(
      continuation.every((event) => event.speechText === undefined),
      `row ${row} must not carry a second passage trigger`,
    );
  }
});

test('dramatic sections are a nonoverlapping half-open partition of all nine pairs', () => {
  assert.deepEqual(Object.keys(score.sections), ['tenderness', 'mirror', 'return']);
  let expectedStart = 0;
  const coveredRows = [];
  for (const span of Object.values(score.sections)) {
    assert.equal(span[0], expectedStart, 'each section must start where the prior section ends');
    assert.ok(span[1] > span[0], 'each section must contain at least one pair');
    for (let row = span[0]; row < span[1]; row += 1) coveredRows.push(row);
    expectedStart = span[1];
  }
  assert.equal(expectedStart, EXPECTED_PAIRS.length);
  assert.deepEqual(coveredRows, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(new Set(coveredRows).size, coveredRows.length);
});

test('generated timings cover every visual line sequentially in its own lane', () => {
  assert.ok(voicePack, 'voice pack must self-register');
  assert.equal(voicePack.count, 2);
  assert.equal(Object.keys(voicePack.clips).length, 2);
  assert.equal(Object.keys(voicePack.timings).length, 2);

  score.lanes.forEach((lane, laneIndex) => {
    const trigger = score.events.find((event) => event.lane === lane.id && !event.silent);
    assert.ok(trigger?.speechText, `${lane.id} must own one continuous passage`);
    const key = `${lane.id}|${trigger.speechText}`;
    const timing = voicePack.timings[key];
    assert.ok(voicePack.clips[key], `${lane.id} clip must match its passage key`);
    assert.ok(timing, `${lane.id} timing must match its passage key`);
    assert.equal(timing.voice, lane.voice);
    assert.equal(timing.rate, lane.rate);

    let cursor = 0;
    for (const pair of score.visualPairs) {
      const expected = tokens(pair[laneIndex]);
      const actual = timing.words
        .slice(cursor, cursor + expected.length)
        .map((word) => tokens(word.text)[0]);
      assert.deepEqual(
        actual,
        expected,
        `${lane.id} timing must cover ${JSON.stringify(pair[laneIndex])}`,
      );
      cursor += expected.length;
    }
    assert.equal(cursor, timing.words.length, `${lane.id} must have no unused timing words`);
  });
});

test('credits identify the poem, artwork/source, and remix without presenting play dialogue', () => {
  assert.equal(score.byline, 'poem @two.be · artwork @amaanjahangir');
  assert.match(score.caption, /visual-and-audio remix/i);
  const scoreSource = fs.readFileSync(SCORE_FILE, 'utf8');
  const homeSource = fs.readFileSync(path.join(ROOT, 'apps/web/src/app/page.tsx'), 'utf8');
  const reelSource = fs.readFileSync(path.join(ROOT, 'tools/render-story-reel.mjs'), 'utf8');
  assert.match(scoreSource, /contemporary character poem by @two\.be/i);
  assert.match(scoreSource, /Artwork and source post: @amaanjahangir/i);
  assert.match(scoreSource, /not dialogue from the play/i);
  assert.match(
    homeSource,
    /contemporary[\s\S]*character poem by @two\.be[\s\S]*artwork by @amaanjahangir/i,
  );
  assert.match(reelSource, /poem @two\.be\s+·\s+artwork @amaanjahangir\s+·\s+audio remix/i);
});

test('library, tracker, editor, and standalone source all register the score lane', () => {
  const scriptRegistry = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/lib/scoreScripts.ts'),
    'utf8',
  );
  const library = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/components/LibraryClient.tsx'),
    'utf8',
  );
  const tracker = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/components/TrackerClient.tsx'),
    'utf8',
  );
  const editor = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/components/EditorClient.tsx'),
    'utf8',
  );
  const standalone = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/philip-glass-tracker.html'),
    'utf8',
  );
  assert.match(scriptRegistry, /scores\/lady-macbeth-macbeth\.js/);
  assert.match(library, /SCORE_SCRIPTS/);
  assert.match(tracker, /SCORE_SCRIPTS/);
  assert.match(editor, /SCORE_SCRIPTS/);
  assert.match(standalone, /scores\/lady-macbeth-macbeth\.js/);
  assert.match(standalone, /voices\/lady-macbeth-macbeth\.js/);
});

test('editing a continuous-passage continuation rebuilds its source passage in visual order', () => {
  const events = [
    { id: 'trigger', lane: 'A', text: 'first', speechText: 'first second third', start: 0 },
    { id: 'middle', lane: 'A', text: 'second', silent: true, start: 1 },
    { id: 'other', lane: 'B', text: 'other', start: 1 },
    { id: 'last', lane: 'A', text: 'third', silent: true, start: 2 },
  ];
  const renamed = renameContinuousPassageLine(events, 'middle', 'changed second');
  assert.equal(renamed.find((event) => event.id === 'middle')?.text, 'changed second');
  assert.equal(
    renamed.find((event) => event.id === 'trigger')?.speechText,
    'first changed second third',
  );
  assert.equal(events[0].speechText, 'first second third', 'helper must not mutate imported state');
});

test('missing score totals derive a finite extent that covers their clips', () => {
  assert.equal(
    deriveScoreTotal(undefined, [
      { row: 0, beats: 1 },
      { start: 3.25, beats: 1.5 },
    ]),
    6,
  );
  assert.equal(deriveScoreTotal(Number.NaN, []), 1);
});

test('tracker gives timed continuous passages an audible Live cue with half-open section bounds', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'),
    'utf8',
  );
  assert.match(engine, /const playTimedCueRow = \(row\) =>/);
  assert.match(engine, /if \(timedCues && cue\)[\s\S]*?playTimedCueRow\(row\);[\s\S]*?return;/);
  assert.match(engine, /timedCues \? r < e : r <= e/);
  assert.match(engine, /TIMINGS\[`\$\{lane\}\|\$\{sourceEvent\.speechText\}`\]/);
  assert.doesNotMatch(engine, /Object\.entries\(TIMINGS\)\.find/);
  assert.match(
    engine,
    /const planTimedPassage = \(sectionStart, sectionEnd, transportRate = 1\) =>/,
  );
  assert.match(engine, /const sectionTrimStart = Math\.max\(0, firstCue\.start - 0\.06\)/);
  assert.match(
    engine,
    /\.\.\.sourceEvent,[\s\S]*?silent: false,[\s\S]*?sectionTrimStart,[\s\S]*?timingEnd,[\s\S]*?transportRate/,
  );
  assert.match(
    engine,
    /timedStartTs = performance\.now\(\) \+ 15;[\s\S]*?voice\(plan\.passageEvents\)/,
  );
});

test('timed transport preserves section, tempo, monitor, and cancellation semantics', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'),
    'utf8',
  );
  assert.match(
    engine,
    /cue\.ev\.el\.classList\.toggle\('spoken', inSection && seconds >= cue\.end\)/,
  );
  assert.match(
    engine,
    /const timedRange = \(\) => \(sel === 'full' \? \[0, TOTAL\] : SECTIONS\[sel\]\)/,
  );
  assert.match(engine, /const tempoScale = tempoBps \/ scoreTempoBps/);
  assert.match(engine, /const gridDuration = \(sectionEnd - sectionStart\) \/ SUBDIV \/ tempoBps/);
  assert.match(engine, /const excerptDuration = plan\.passageDuration \/ tempoScale/);
  assert.match(engine, /timedPassageDuration = Math\.max\(gridDuration, excerptDuration\)/);
  assert.match(engine, /const activeSources = new Map\(\)/);
  assert.match(engine, /activeSources\.set\(src, \{ lane: channel, gate: laneGate \}\)/);
  assert.match(engine, /refreshLaneStates\(\);\s*refreshActiveSourceAudibility\(\)/);
  assert.match(engine, /if \(cue\) cued = false/);
  assert.match(engine, /const cancelPendingPlay = \(\) =>/);
  assert.match(engine, /destroyed = true;\s*cancelPendingPlay\(\)/);
  assert.match(engine, /\(ev\.trimStart \|\| 0\) \+ \(ev\.sectionTrimStart \|\| 0\)/);
  assert.match(engine, /const sourceEnd = untrimmedEnd - Math\.max\(0, ev\.trimEnd \|\| 0\)/);

  const silentBranch = engine.match(/if \(m === 'off'\) \{([\s\S]*?)\n\s*return;\n\s*\}/)?.[1];
  assert.ok(silentBranch, 'Silent-mode branch must exist');
  assert.match(silentBranch, /refreshMasterAudibility\(\)/);
  assert.doesNotMatch(silentBranch, /pause\(\)|stopSamples\(\)|ctx\.suspend/);
});

test('Tones to Voices resumes the active timed passage at its live source offset', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'),
    'utf8',
  );
  assert.match(engine, /const timedPassageOffset = \(\) =>/);
  assert.match(engine, /\(\(performance\.now\(\) - timedStartTs\) \/ 1000\) \* timedTempoScale/);
  assert.match(engine, /const resumeTimedVoices = async \(\) =>/);
  assert.match(
    engine,
    /const run = timedRunGeneration;[\s\S]*?const ready = await loadSamples\(\)/,
  );
  assert.match(engine, /resume !== timedVoiceResumeGeneration \|\| !timedRunIsActive\(run\)/);
  assert.match(engine, /sectionTrimStart: ev\.sectionTrimStart \+ offset/);
  assert.match(engine, /if \(SAMP\.loading\) return SAMP\.loading/);
  assert.match(
    engine,
    /previousSoundMode === 'tone' \|\| activeSources\.size === 0[\s\S]*?void resumeTimedVoices\(\)/,
  );
});

test('runtime timed transport resumes Voices in phase and lets the mirror excerpt finish', async () => {
  const tracker = mountTimedTracker();
  const mirrorButton = tracker.ui
    .get('.t-sections')
    .children.find((button) => button.dataset.s === 'mirror');
  assert.ok(mirrorButton, 'the Mirror section button must be mounted');
  await emitTrackerClick(tracker.ui.get('.t-sections'), mirrorButton);
  await emitTrackerClick(tracker.ui.get('.t-play'));
  assert.equal(tracker.starts.length, 2, 'both timed lanes must start together');
  const initialOffsets = tracker.starts.map((start) => start.offset);

  tracker.setNow(1015);
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  assert.equal(tracker.starts.length, 2, 'Tones must stop rather than restart voice sources');
  await emitTrackerClick(tracker.sound, tracker.voiceButton);
  assert.equal(tracker.starts.length, 4, 'Voices must recreate both timed sources');
  tracker.starts.slice(2).forEach((start, index) => {
    assert.ok(
      Math.abs(start.offset - (initialOffsets[index] + 1)) < 1e-6,
      `lane ${index} must resume one second into its live source, got ${start.offset}`,
    );
  });

  tracker.setNow(2200);
  const loop = [...tracker.animationFrames.values()][0];
  assert.ok(loop, 'timed performance must have a pending animation frame');
  loop(2200);
  assert.equal(
    tracker.starts.length,
    4,
    'the two-second mirror grid must not cut its longer planned excerpt off mid-line',
  );
  tracker.mounted.destroy();
});

test('runtime timed Tones sounds every visual lane line exactly once', async () => {
  const tracker = mountTimedTracker();
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  await emitTrackerClick(tracker.ui.get('.t-play'));
  assert.equal(tracker.oscillatorStarts.length, 2, 'the opening lane pair must cue once');

  const loop = [...tracker.animationFrames.values()][0];
  assert.ok(loop, 'timed performance must have a pending animation frame');
  for (let timestamp = 0; timestamp < 6600; timestamp += 50) {
    tracker.setNow(timestamp);
    loop(timestamp);
  }

  assert.equal(
    tracker.oscillatorStarts.length,
    score.events.length,
    'the opening pair plus every silent visual continuation must cue once',
  );
  for (const lane of score.lanes) {
    assert.equal(
      tracker.oscillatorStarts.filter(({ frequency }) => frequency === lane.tone.f).length,
      score.events.filter((event) => event.lane === lane.id).length,
      `${lane.id} must receive one tone for every visual line`,
    );
  }
  tracker.mounted.destroy();
});

test('runtime deferred voice decode cannot resume after the user leaves Voices', async () => {
  const tracker = mountTimedTracker({ deferDecode: true });
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  await emitTrackerClick(tracker.ui.get('.t-play'));
  await emitTrackerClick(tracker.sound, tracker.voiceButton);
  assert.equal(tracker.pendingDecodes.length, 2, 'Voices must wait for both clip decodes');
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  for (const resolve of tracker.pendingDecodes) resolve();
  await flushTrackerWork();
  assert.equal(
    tracker.starts.length,
    0,
    'a finished decode must not restore Voices after the user selected Tones',
  );
  tracker.mounted.destroy();
});

test('render tools stage atomic outputs beside their destinations and provide font fallbacks', () => {
  const mixer = fs.readFileSync(path.join(ROOT, 'tools/mix-score-audio.mjs'), 'utf8');
  const reel = fs.readFileSync(path.join(ROOT, 'tools/render-story-reel.mjs'), 'utf8');
  const frames = fs.readFileSync(path.join(ROOT, 'tools/render-story-frames.py'), 'utf8');
  assert.match(mixer, /mkdtempSync\(path\.join\(path\.dirname\(out\),/);
  assert.match(reel, /mkdtempSync\(path\.join\(path\.dirname\(out\),/);
  assert.match(reel, /voicePack\.timings\[`\$\{lane\.id\}\|\$\{sourceEvent\.speechText\}`\]/);
  assert.match(frames, /ImageFont\.load_default/);
  assert.match(frames, /DejaVuSerif/);
});

test('voice generation preserves legacy playback and cannot publish failed renders', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'tools/render-voices.mjs'), 'utf8');
  assert.match(renderer, /const canImportEdgeTts = \(\) =>/);
  assert.match(renderer, /execFileSync\(PYTHON, \['-c', 'import edge_tts'\]/);
  assert.match(
    renderer,
    /if \(!canImportEdgeTts\(\)\)[\s\S]*?pip[\s\S]*?if \(!canImportEdgeTts\(\)\)[\s\S]*?throw new Error/,
  );
  assert.match(
    renderer,
    /typeof ev\.speechText === 'string'[\s\S]*?timings\[key\] = rendered\.timing/,
  );
  assert.match(renderer, /if \(failures > 0 \|\| clipCount === 0\)/);
  assert.match(renderer, /fs\.writeFileSync\(pendingOut,[\s\S]*?fs\.renameSync\(pendingOut, out\)/);
});

for (const tool of ['mix-score-audio.mjs', 'render-story-reel.mjs']) {
  for (const sourceKind of ['score', 'voice']) {
    test(`${tool} refuses to overwrite its implicit ${sourceKind} source`, () => {
      withCliSandbox(
        tool,
        ({ sandboxRoot, toolFile, scoreFile, voiceFile, artFile, audioFile }) => {
          const target = sourceKind === 'score' ? scoreFile : voiceFile;
          const targetArgument = sourceKind === 'score' ? SCORE_RELATIVE : VOICE_RELATIVE;
          const before = fs.readFileSync(target);
          const args =
            tool === 'mix-score-audio.mjs'
              ? [toolFile, '--score', SCORE_ID, '--out', targetArgument, '--force']
              : [
                  toolFile,
                  '--score',
                  SCORE_ID,
                  '--art',
                  artFile,
                  '--audio',
                  audioFile,
                  '--out',
                  targetArgument,
                  '--force',
                ];
          const result = spawnSync(process.execPath, args, {
            cwd: sandboxRoot,
            encoding: 'utf8',
            env: { ...process.env, PATH: '' },
          });
          const output = `${result.stdout || ''}\n${result.stderr || ''}`;
          assert.notEqual(result.status, 0, output);
          assert.match(output, /must be different from implicit score\/voice source paths\./);
          assert.deepEqual(
            fs.readFileSync(target),
            before,
            'implicit source bytes must remain unchanged',
          );
          assert.doesNotMatch(
            output,
            /ffmpeg|Missing tools\/\.venv/i,
            'guard must fire before rendering',
          );
        },
      );
    });
  }
}

test('mixer rejects every input/output and output/output collision before rendering', () => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile, artFile }) => {
    const cases = [
      {
        name: 'audio and timeline outputs',
        args: ['--out', 'out/shared.wav', '--timeline-out', 'out/shared.wav'],
      },
      {
        name: 'audio and video outputs',
        args: ['--out', 'out/shared.mp4', '--video', artFile, '--video-out', 'out/shared.mp4'],
      },
      {
        name: 'timeline and video outputs',
        args: [
          '--out',
          'out/mix.wav',
          '--timeline-out',
          'out/shared.json',
          '--video',
          artFile,
          '--video-out',
          'out/shared.json',
        ],
      },
      {
        name: 'video input and audio output',
        args: ['--out', artFile, '--video', artFile, '--video-out', 'out/video.mp4'],
      },
      {
        name: 'video input and timeline output',
        args: [
          '--out',
          'out/mix.wav',
          '--timeline-out',
          artFile,
          '--video',
          artFile,
          '--video-out',
          'out/video.mp4',
        ],
      },
      {
        name: 'video input and video output',
        args: ['--out', 'out/mix.wav', '--video', artFile, '--video-out', artFile],
      },
    ];

    const inputBefore = fs.readFileSync(artFile);
    for (const collision of cases) {
      const result = spawnSync(
        process.execPath,
        [toolFile, '--score', SCORE_ID, ...collision.args, '--force'],
        {
          cwd: sandboxRoot,
          encoding: 'utf8',
          env: { ...process.env, PATH: '' },
        },
      );
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      assert.notEqual(result.status, 0, `${collision.name}\n${output}`);
      assert.match(output, /must be different paths\./, collision.name);
      assert.doesNotMatch(
        output,
        /ffmpeg|ffprobe/i,
        `${collision.name} must fail before rendering`,
      );
    }
    assert.deepEqual(
      fs.readFileSync(artFile),
      inputBefore,
      'video input bytes must remain unchanged',
    );
  });
});

test('mixer resolves symlink aliases through missing output directories', (context) => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile }) => {
    const realRoot = path.join(sandboxRoot, 'real-output');
    const aliasRoot = path.join(sandboxRoot, 'alias-output');
    fs.mkdirSync(realRoot);
    try {
      fs.symlinkSync(realRoot, aliasRoot, 'dir');
    } catch (error) {
      if (error && ['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        context.skip(`directory symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const realOutput = path.join(realRoot, 'fresh', 'result.wav');
    const aliasOutput = path.join(aliasRoot, 'fresh', 'result.wav');
    const result = spawnSync(
      process.execPath,
      [
        toolFile,
        '--score',
        SCORE_ID,
        '--out',
        realOutput,
        '--timeline-out',
        aliasOutput,
        '--force',
      ],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: '' },
      },
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /--out and --timeline-out must be different paths\./);
    assert.equal(fs.existsSync(path.join(realRoot, 'fresh')), false, 'guard must run before mkdir');
    assert.doesNotMatch(output, /ffmpeg|ffprobe/i, 'guard must run before rendering');
  });
});

test('mixer rejects a legacy score timeline before FFmpeg or output creation', () => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile }) => {
    const scoreId = writeLegacyNoTimingFixture(sandboxRoot);
    const outputDirectory = path.join(sandboxRoot, 'uncreated-output');
    const mixOut = path.join(outputDirectory, 'mix.wav');
    const timelineOut = path.join(outputDirectory, 'timeline.json');
    const result = spawnSync(
      process.execPath,
      [toolFile, '--score', scoreId, '--out', mixOut, '--timeline-out', timelineOut, '--force'],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: '' },
      },
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.notEqual(result.status, 0, output);
    assert.match(
      output,
      /Cannot write --timeline-out: mixed voice event "LEGACY\|no timing" lacks a non-empty Edge-TTS word-timing record\./,
    );
    assert.equal(fs.existsSync(outputDirectory), false, 'guard must run before output creation');
    assert.doesNotMatch(output, /ffmpeg|ffprobe/i, 'guard must run before rendering');
  });
});

test('story renderer refuses artwork/audio output collisions before rendering', () => {
  withCliSandbox('render-story-reel.mjs', ({ sandboxRoot, toolFile, artFile, audioFile }) => {
    for (const target of [artFile, audioFile]) {
      const before = fs.readFileSync(target);
      const result = spawnSync(
        process.execPath,
        [
          toolFile,
          '--score',
          SCORE_ID,
          '--art',
          artFile,
          '--audio',
          audioFile,
          '--out',
          target,
          '--force',
        ],
        {
          cwd: sandboxRoot,
          encoding: 'utf8',
          env: { ...process.env, PATH: '' },
        },
      );
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      assert.notEqual(result.status, 0, output);
      assert.match(output, /--out must be different from both input paths\./);
      assert.deepEqual(fs.readFileSync(target), before, 'input bytes must remain unchanged');
      assert.doesNotMatch(
        output,
        /ffmpeg|Missing tools\/\.venv/i,
        'guard must fire before rendering',
      );
    }
  });
});
