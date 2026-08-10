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
  duplicateContinuousPassageEvent,
  moveContinuousPassageEvent,
  removeContinuousPassageEvent,
  renameContinuousPassageLine,
} from '../../apps/web/src/lib/scoreEditing.js';
import {
  resolveVoiceConfigurationId,
  selectVoicePackConfiguration,
} from '../../apps/web/src/lib/voiceConfigurations.js';
import {
  probeAudio,
  transposeAudioDurationPreserving,
  transposeFilter,
} from '../../tools/pitch-preserving-transpose.mjs';
import { deriveRowCompleteSchedule } from '../../tools/row-complete-schedule.mjs';

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
const EXPECTED_VOICE_CONFIGURATIONS = {
  natural: {
    LADY_MACBETH: { pitch: '+0Hz' },
    MACBETH: { pitch: '+0Hz' },
  },
  subtle: {
    LADY_MACBETH: { pitch: '+10Hz' },
    MACBETH: { pitch: '-10Hz' },
  },
  separated: {
    LADY_MACBETH: { pitch: '+20Hz' },
    MACBETH: { pitch: '-20Hz' },
  },
  theatrical: {
    LADY_MACBETH: { pitch: '+35Hz' },
    MACBETH: { pitch: '-35Hz' },
  },
  'octave-split': {
    LADY_MACBETH: { transposeSemitones: 6 },
    MACBETH: { transposeSemitones: -6 },
  },
};

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
    copyIntoSandbox(sandboxRoot, 'tools/row-complete-schedule.mjs');
    copyIntoSandbox(sandboxRoot, 'apps/web/src/lib/voiceConfigurations.js');
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

function writeEditorJsonFixture(sandboxRoot) {
  const scoreId = 'editor-json';
  const scorePath = path.join(sandboxRoot, 'apps/web/public/prototypes/scores', `${scoreId}.json`);
  const voicePath = path.join(sandboxRoot, 'apps/web/public/prototypes/voices', `${scoreId}.js`);
  fs.mkdirSync(path.dirname(scorePath), { recursive: true });
  fs.mkdirSync(path.dirname(voicePath), { recursive: true });
  fs.writeFileSync(
    scorePath,
    JSON.stringify({
      id: scoreId,
      title: 'Editor JSON',
      tempo: 1,
      total: 1,
      lanes: [{ id: 'A', performer: 'ai', pan: 0 }],
      events: [{ row: 0, lane: 'A', text: 'editor source' }],
    }),
  );
  fs.writeFileSync(
    voicePath,
    `(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  root.SSE_VOICES = root.SSE_VOICES || {};
  root.SSE_VOICES[${JSON.stringify(scoreId)}] = {
    clips: { 'A|editor source': 'ZHVtbXk=' },
  };
})();
`,
  );
  return { scoreId, scorePath };
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

function mountTimedTracker({
  deferDecode = false,
  voiceConfig = score.defaultVoiceConfiguration,
  missingClipKey = null,
} = {}) {
  let now = 0;
  let nextAnimationFrame = 1;
  const animationFrames = new Map();
  const oscillatorStarts = [];
  const panners = [];
  const selectedVoiceConfigurations = [];
  const speechUtterances = [];
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
      panners.push(panner);
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
  createUi('.t-voice-config-row');
  const voiceConfigSelect = createUi('.t-voice-config', 'select');
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
  const mode = createUi('.t-mode');
  const clockButton = fakeElement('button');
  clockButton.dataset.mode = 'clock';
  const cueButton = fakeElement('button');
  cueButton.dataset.mode = 'cue';
  mode.children.push(clockButton, cueButton);
  createUi('.t-countin', 'button');
  createUi('.t-tempo').value = String(score.tempo);
  createUi('.t-count');
  createUi('.t-hint');

  const runtimeScore = JSON.parse(JSON.stringify(score));
  const selectedPack = selectVoicePackConfiguration(score, voicePack, voiceConfig);
  const runtimeTimings = JSON.parse(JSON.stringify(selectedPack.timings));
  const clips = Object.fromEntries(Object.keys(runtimeTimings).map((key) => [key, 'AA==']));
  if (missingClipKey) delete clips[missingClipKey];
  const speechSynthesis = {
    pending: false,
    getVoices: () => [{ name: 'Test English', lang: 'en-GB' }],
    addEventListener: () => {},
    removeEventListener: () => {},
    resume: () => {},
    cancel: () => {},
    speak: (utterance) => speechUtterances.push(utterance),
  };
  const window = {
    AudioContext: FakeAudioContext,
    speechSynthesis,
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
    SpeechSynthesisUtterance: class {
      constructor(text) {
        this.text = text;
      }
    },
  };
  vm.createContext(sandbox);
  new vm.Script(
    fs.readFileSync(path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'), 'utf8'),
  ).runInContext(sandbox);
  const mounted = window.SSEEngine.mount(root, {
    score: runtimeScore,
    clips,
    timings: runtimeTimings,
    voiceConfig,
    scores: [runtimeScore],
    onVoiceConfig: (id) => selectedVoiceConfigurations.push(id),
  });

  return {
    animationFrames,
    mounted,
    oscillatorStarts,
    panners,
    pendingDecodes,
    setNow: (value) => {
      now = value;
    },
    sound,
    starts,
    selectedVoiceConfigurations,
    speechUtterances,
    toneButton,
    ui,
    cueButton,
    voiceButton,
    voiceConfigSelect,
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

test('score preserves the nine simultaneous left/right pairs and row-complete lane geometry', () => {
  assert.ok(score, 'score must self-register');
  assert.deepEqual(score.visualPairs, EXPECTED_PAIRS);
  assert.equal(score.playback, 'row-complete');
  assert.deepEqual(
    score.lanes.map(({ id, align }) => ({ id, align })),
    [
      { id: 'LADY_MACBETH', align: 'right' },
      { id: 'MACBETH', align: 'left' },
    ],
  );
  assert.deepEqual(
    score.lanes.map(({ id, pan }) => ({ id, pan })),
    [
      { id: 'LADY_MACBETH', pan: -1 },
      { id: 'MACBETH', pan: 1 },
    ],
  );
  assert.equal(score.lanes[0].tone.f, 466.16);
  assert.equal(score.lanes[1].tone.f, 233.08);
  assert.equal(score.lanes[0].tone.f / score.lanes[1].tone.f, 2);
  assert.deepEqual(score.voiceConfigurations, EXPECTED_VOICE_CONFIGURATIONS);
  assert.equal(score.defaultVoiceConfiguration, 'separated');

  assert.equal(score.events.length, EXPECTED_PAIRS.length * score.lanes.length);
  for (let row = 0; row < EXPECTED_PAIRS.length; row += 1) {
    const pair = score.events.filter((event) => event.row === row);
    assert.equal(pair.length, 2, `row ${row} must contain both player lines`);
    assert.deepEqual(
      pair.map((event) => ({ lane: event.lane, text: event.text })),
      [
        { lane: 'LADY_MACBETH', text: EXPECTED_PAIRS[row][0] },
        { lane: 'MACBETH', text: EXPECTED_PAIRS[row][1] },
      ],
    );
    assert.ok(pair.every((event) => !event.silent && event.speechText === undefined));
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

test('all generated voice configurations cover every rendered line and identify their treatment', () => {
  assert.ok(voicePack, 'voice pack must self-register');
  assert.equal(voicePack.count, score.events.length);
  assert.equal(voicePack.totalCount, score.events.length * 5);
  assert.equal(Object.keys(voicePack.clips).length, score.events.length);
  assert.equal(Object.keys(voicePack.timings).length, score.events.length);
  assert.deepEqual(
    Object.keys(voicePack.configurations),
    Object.keys(EXPECTED_VOICE_CONFIGURATIONS),
  );
  assert.deepEqual(voicePack.clips, voicePack.configurations.separated.clips);
  assert.deepEqual(voicePack.timings, voicePack.configurations.separated.timings);

  for (const [configurationId, treatments] of Object.entries(EXPECTED_VOICE_CONFIGURATIONS)) {
    const configuration = voicePack.configurations[configurationId];
    assert.equal(configuration.count, score.events.length);
    assert.equal(Object.keys(configuration.clips).length, score.events.length);
    assert.equal(Object.keys(configuration.timings).length, score.events.length);
    score.lanes.forEach((lane, laneIndex) => {
      for (const [row, pair] of score.visualPairs.entries()) {
        const event = score.events.find(
          (candidate) => candidate.row === row && candidate.lane === lane.id,
        );
        const key = `${lane.id}|${event.text}`;
        const timing = configuration.timings[key];
        assert.ok(configuration.clips[key], `${configurationId} ${lane.id} row ${row} clip`);
        assert.ok(timing, `${configurationId} ${lane.id} row ${row} timing`);
        assert.equal(timing.voice, lane.voice);
        assert.equal(timing.rate, lane.rate);
        assert.equal(timing.pitch, treatments[lane.id].pitch || '+0Hz');
        assert.equal(timing.transposeSemitones, treatments[lane.id].transposeSemitones || 0);
        assert.deepEqual(
          timing.words.map((word) => tokens(word.text)[0]),
          tokens(pair[laneIndex]),
          `${configurationId} ${lane.id} row ${row} timing must cover ${JSON.stringify(pair[laneIndex])}`,
        );
      }
    });
  }
});

test('voice configuration selection resolves URL/default choices and rejects unknown CLI choices', () => {
  assert.equal(resolveVoiceConfigurationId(score, 'natural'), 'natural');
  assert.equal(resolveVoiceConfigurationId(score, 'unknown'), 'separated');
  assert.equal(selectVoicePackConfiguration(score, voicePack, 'subtle').id, 'subtle');
  assert.throws(
    () => selectVoicePackConfiguration(score, voicePack, 'unknown', { strict: true }),
    /Unknown voice configuration "unknown"/,
  );
});

test('every voice configuration produces a valid row-complete schedule', () => {
  for (const configurationId of Object.keys(EXPECTED_VOICE_CONFIGURATIONS)) {
    const selected = selectVoicePackConfiguration(score, voicePack, configurationId);
    const schedule = deriveRowCompleteSchedule(score, selected);
    assert.ok(schedule);
    assert.equal(schedule.rows.length, EXPECTED_PAIRS.length);
    assert.ok(schedule.duration > 0);
    schedule.rows.forEach((row, index) => {
      assert.equal(row.clips.length, score.lanes.length, `row ${row.row} must start both players`);
      assert.ok(row.clips.every((clip) => clip.start === row.start));
      assert.equal(row.duration, Math.max(...row.clips.map((clip) => clip.timing.duration)));
      if (index > 0) assert.equal(row.start, schedule.rows[index - 1].end);
    });
  }
  for (const lane of score.lanes) {
    assert.equal(lane.rate, '+0%', `${lane.id} must keep normal rendered word speed`);
  }
});

test('the default row-complete schedule uses the separated timing aliases', () => {
  const schedule = deriveRowCompleteSchedule(score, voicePack);
  const separated = deriveRowCompleteSchedule(score, voicePack.configurations.separated);
  assert.deepEqual(schedule, separated);
  assert.equal(schedule.rows.length, EXPECTED_PAIRS.length);
  for (const row of schedule.rows) {
    for (const clip of row.clips) {
      assert.equal(
        clip.timing.pitch,
        EXPECTED_VOICE_CONFIGURATIONS.separated[clip.event.lane].pitch,
      );
    }
  }
});

test('credits identify the poem, artwork/source, and remix without presenting play dialogue', () => {
  assert.equal(score.byline, 'poem @two.be · artwork @amaanjahangir');
  assert.match(score.caption, /synchronized two-player tracker/i);
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
  assert.match(tracker, /get\('voiceConfig'\)/);
  assert.match(tracker, /params\.set\('voiceConfig', nextId\)/);
  assert.match(standalone, /params\.get\('voiceConfig'\)/);
  assert.match(standalone, /voicePack: voices/);
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

test('continuous-passage structural edits preserve one valid source per remaining lane', () => {
  const events = [
    { id: 'trigger', lane: 'A', text: 'first', speechText: 'first second third', start: 0 },
    { id: 'middle', lane: 'A', text: 'second', silent: true, start: 1 },
    { id: 'last', lane: 'A', text: 'third', silent: true, start: 2 },
  ];

  const duplicate = duplicateContinuousPassageEvent(events[0], 'copy', 1);
  assert.equal(
    duplicate.speechText,
    undefined,
    'a duplicate must not create a second passage source',
  );
  assert.equal(duplicate.silent, undefined, 'a duplicate must remain an ordinary audible clip');

  const deleted = removeContinuousPassageEvent(events, 'trigger');
  assert.deepEqual(deleted, [
    {
      id: 'middle',
      lane: 'A',
      text: 'second',
      silent: false,
      speechText: 'second third',
      start: 1,
    },
    { id: 'last', lane: 'A', text: 'third', silent: true, start: 2 },
  ]);

  const recast = moveContinuousPassageEvent(events, 'trigger', 'B');
  assert.deepEqual(
    recast.find((event) => event.id === 'trigger'),
    {
      id: 'trigger',
      lane: 'B',
      text: 'first',
      start: 0,
    },
  );
  assert.deepEqual(
    recast.find((event) => event.id === 'middle'),
    {
      id: 'middle',
      lane: 'A',
      text: 'second',
      silent: false,
      speechText: 'second third',
      start: 1,
    },
  );
});

test('the editor preserves row-complete playback metadata through load and export', () => {
  const editor = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/components/EditorClient.tsx'),
    'utf8',
  );
  assert.match(editor, /setPlayback\(sc\.playback\)/);
  assert.match(editor, /\.\.\.\(playback \? \{ playback \} : \{\}\)/);
  assert.match(editor, /setVoiceConfigurations\(/);
  assert.match(editor, /Object\.entries\(sc\.voiceConfigurations \|\| \{\}\)/);
  assert.match(editor, /defaultVoiceConfiguration:/);
  assert.match(editor, /selectedVoiceConfiguration \|\| Object\.keys\(voiceConfigurations\)\[0\]/);
  assert.match(editor, /aria-label="Voice treatment"/);
  assert.match(editor, /moveContinuousPassageEvent\(prev, d\.id, lane\)/);
  assert.match(editor, /removeContinuousPassageEvent\(prev, selected\)/);
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

test('tracker keeps continuous-passage cues and derives row-complete tracker boundaries', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'),
    'utf8',
  );
  assert.match(engine, /const deriveRowCompletePlan = \(\) =>/);
  assert.match(engine, /SC\.playback !== 'row-complete' \|\| !TIMINGS/);
  assert.match(
    engine,
    /const duration = Math\.max\(\.\.\.clips\.map\(\(clip\) => clip\.timing\.duration\)\)/,
  );
  assert.match(engine, /const startRowCompletePassage = \(\) =>/);
  assert.match(engine, /scheduleSeconds: row\.start - rowCompleteOffset/);
  assert.match(engine, /if \(rowCompletePlan && timedStartTs !== null\)/);
  assert.match(engine, /const playTimedCueRow = \(row\) =>/);
  assert.match(engine, /if \(timedCues && cue\)[\s\S]*?playTimedCueRow\(row\);[\s\S]*?return;/);
  assert.match(engine, /timedCues \|\| rowCompletePlan \? r < e : r <= e/);
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
  assert.match(
    engine,
    /if \(ev\.warp && beatsPerSec > 0 && typeof ev\.transportRate !== 'number'\)/,
  );
  assert.match(engine, /if \(!visibleLaneEvents\.length\) continue/);
  assert.match(engine, /filter\(\(ev\) => ev === sourceEvent \|\| ev\.silent\)/);
  assert.match(engine, /for \(const ev of audible\)/);
  assert.match(engine, /const missing = \[\]/);
  assert.match(engine, /if \(cueAdvancePending\) return/);
  assert.match(engine, /cueAdvancePending = true;[\s\S]*?finally \{\s*cueAdvancePending = false/);

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

test('runtime row-complete transport schedules both lanes together and waits for the longer line', async () => {
  const tracker = mountTimedTracker();
  await emitTrackerClick(tracker.ui.get('.t-play'));
  const schedule = deriveRowCompleteSchedule(score, voicePack);
  assert.equal(
    tracker.starts.length,
    score.events.length,
    'every player line must receive its own clip',
  );
  schedule.rows.forEach((row, index) => {
    const pair = tracker.starts.slice(index * score.lanes.length, (index + 1) * score.lanes.length);
    assert.equal(pair.length, score.lanes.length);
    assert.equal(pair[0].when, pair[1].when, `row ${row.row} must start both players together`);
    assert.ok(
      Math.abs(pair[0].when - (0.015 + row.start)) < 1e-6,
      `row ${row.row} must begin only after the previous row's longer clip ends`,
    );
  });
  assert.equal(
    tracker.panners.filter((panner) => panner.pan.value === -1).length,
    EXPECTED_PAIRS.length,
  );
  assert.equal(
    tracker.panners.filter((panner) => panner.pan.value === 1).length,
    EXPECTED_PAIRS.length,
  );
  tracker.mounted.destroy();
});

test('tracker configuration switching stops playback, resets, and routes the new selection', async () => {
  const tracker = mountTimedTracker();
  await emitTrackerClick(tracker.ui.get('.t-play'));
  assert.ok(tracker.animationFrames.size > 0);
  tracker.voiceConfigSelect.value = 'natural';
  tracker.voiceConfigSelect.emit('change');
  assert.deepEqual(tracker.selectedVoiceConfigurations, ['natural']);
  assert.equal(tracker.animationFrames.size, 0, 'configuration changes must stop the active loop');
  tracker.mounted.destroy();
});

test('a missing configured neural clip falls back to a hard-panned tone, never browser speech', async () => {
  const missingKey = `LADY_MACBETH|${EXPECTED_PAIRS[0][0]}`;
  const tracker = mountTimedTracker({ missingClipKey: missingKey });
  await emitTrackerClick(tracker.ui.get('.t-play'));
  assert.equal(tracker.starts.length, score.events.length - 1);
  assert.equal(tracker.speechUtterances.length, 0);
  assert.equal(tracker.oscillatorStarts.length, 1);
  assert.equal(tracker.oscillatorStarts[0].frequency, 466.16);
  assert.ok(tracker.panners.some((panner) => panner.pan.value === -1));
  tracker.mounted.destroy();
});

test('runtime row-complete Tones sounds both players exactly once per tracker row', async () => {
  const tracker = mountTimedTracker();
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  await emitTrackerClick(tracker.ui.get('.t-play'));
  assert.equal(tracker.oscillatorStarts.length, 2, 'the opening lane pair must cue once');

  const loop = [...tracker.animationFrames.values()][0];
  assert.ok(loop, 'timed performance must have a pending animation frame');
  const schedule = deriveRowCompleteSchedule(score, voicePack);
  for (let timestamp = 0; timestamp < schedule.duration * 1000; timestamp += 25) {
    tracker.setNow(timestamp);
    loop(timestamp);
  }

  assert.equal(
    tracker.oscillatorStarts.length,
    score.events.length,
    'every synchronized tracker row must cue both players once',
  );
  for (const lane of score.lanes) {
    assert.equal(
      tracker.oscillatorStarts.filter(({ frequency }) => frequency === lane.tone.f).length,
      score.events.filter((event) => event.lane === lane.id).length,
      `${lane.id} must receive one tone for every visual line`,
    );
  }
  assert.equal(
    tracker.panners.filter((panner) => panner.pan.value === -1).length,
    EXPECTED_PAIRS.length,
  );
  assert.equal(
    tracker.panners.filter((panner) => panner.pan.value === 1).length,
    EXPECTED_PAIRS.length,
  );
  tracker.mounted.destroy();
});

test('runtime deferred voice decode cannot resume after the user leaves Voices', async () => {
  const tracker = mountTimedTracker({ deferDecode: true });
  await emitTrackerClick(tracker.sound, tracker.toneButton);
  await emitTrackerClick(tracker.ui.get('.t-play'));
  await emitTrackerClick(tracker.sound, tracker.voiceButton);
  assert.equal(
    tracker.pendingDecodes.length,
    score.events.length,
    'Voices must wait for every line clip',
  );
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

test('Live cue ignores repeated strikes while the first voice-pack decode is pending', async () => {
  const tracker = mountTimedTracker({ deferDecode: true });
  await emitTrackerClick(tracker.ui.get('.t-mode'), tracker.cueButton);
  tracker.ui.get('.t-play').emit('click');
  tracker.ui.get('.t-play').emit('click');
  await flushTrackerWork();
  assert.equal(tracker.pendingDecodes.length, score.events.length);
  for (const resolve of tracker.pendingDecodes) resolve();
  await flushTrackerWork();
  assert.equal(tracker.starts.length, score.lanes.length, 'only the first tracker row may advance');
  tracker.mounted.destroy();
});

test('render tools stage atomic outputs beside their destinations and provide font fallbacks', () => {
  const mixer = fs.readFileSync(path.join(ROOT, 'tools/mix-score-audio.mjs'), 'utf8');
  const reel = fs.readFileSync(path.join(ROOT, 'tools/render-story-reel.mjs'), 'utf8');
  const frames = fs.readFileSync(path.join(ROOT, 'tools/render-story-frames.py'), 'utf8');
  assert.match(mixer, /mkdtempSync\(path\.join\(path\.dirname\(out\),/);
  assert.match(reel, /mkdtempSync\(path\.join\(path\.dirname\(out\),/);
  assert.match(mixer, /deriveRowCompleteSchedule\(score, selectedVoice\)/);
  assert.match(reel, /deriveRowCompleteSchedule\(score, selectedVoice\)/);
  assert.match(frames, /ImageFont\.load_default/);
  assert.match(frames, /DejaVuSerif/);
});

test('render tools resolve their virtualenv interpreter on Windows and POSIX hosts', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'tools/render-voices.mjs'), 'utf8');
  const reel = fs.readFileSync(path.join(ROOT, 'tools/render-story-reel.mjs'), 'utf8');
  for (const source of [renderer, reel]) {
    assert.match(source, /VENV_BIN = process\.platform === 'win32' \? 'Scripts' : 'bin'/);
    assert.match(source, /process\.platform === 'win32' \? 'python\.exe' : 'python'/);
  }
  assert.match(
    renderer,
    /BOOTSTRAP_PYTHON = process\.platform === 'win32' \? 'python' : 'python3'/,
  );
  assert.match(reel, /process\.platform === 'win32' \? 'pip\.exe' : 'pip'/);
});

test('mixer accepts editor-exported JSON scores with the same collision safety as script scores', () => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile }) => {
    const { scoreId, scorePath } = writeEditorJsonFixture(sandboxRoot);
    const result = spawnSync(
      process.execPath,
      [toolFile, '--score', scoreId, '--out', scorePath, '--force'],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: '' },
      },
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /--out must be different from implicit score\/voice source paths\./);
    assert.doesNotMatch(output, /Missing score file|ffmpeg/i);
  });
});

test('mixer timeline clips word boundaries and omits events after a requested duration', () => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile }) => {
    const bin = path.join(sandboxRoot, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const ffmpeg = path.join(bin, 'ffmpeg');
    fs.writeFileSync(ffmpeg, '#!/bin/sh\nfor output do :; done\n: > "$output"\n');
    fs.chmodSync(ffmpeg, 0o755);
    const timelineOut = path.join(sandboxRoot, 'out', 'timeline.json');
    const result = spawnSync(
      process.execPath,
      [
        toolFile,
        '--score',
        SCORE_ID,
        '--voice-config',
        'subtle',
        '--out',
        'out/mix.wav',
        '--timeline-out',
        timelineOut,
        '--duration',
        '0.2',
      ],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin },
      },
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.equal(result.status, 0, output);
    const timeline = JSON.parse(fs.readFileSync(timelineOut, 'utf8'));
    assert.equal(timeline.voiceConfiguration, 'subtle');
    assert.ok(timeline.events.length > 0);
    for (const event of timeline.events) {
      for (const word of event.words) {
        assert.ok(word.start < 0.2, `${word.text} begins after the finished mix`);
        assert.ok(word.end <= 0.2, `${word.text} extends past the finished mix`);
      }
    }
  });
});

test('mixer filter graph hard-routes Lady Macbeth left and Macbeth right', () => {
  withCliSandbox('mix-score-audio.mjs', ({ sandboxRoot, toolFile }) => {
    const bin = path.join(sandboxRoot, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    const ffmpeg = path.join(bin, 'ffmpeg');
    fs.writeFileSync(
      ffmpeg,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARG_LOG"\nfor output do :; done\n: > "$output"\n',
    );
    fs.chmodSync(ffmpeg, 0o755);
    const argumentLog = path.join(sandboxRoot, 'ffmpeg-args.txt');
    const result = spawnSync(
      process.execPath,
      [toolFile, '--score', SCORE_ID, '--voice-config', 'separated', '--out', 'out/mix.wav'],
      {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: bin, ARG_LOG: argumentLog },
      },
    );
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.equal(result.status, 0, output);
    const filterGraph = fs.readFileSync(argumentLog, 'utf8');
    assert.match(filterGraph, /pan=stereo\|c0=1\*c0\|c1=0\*c0/);
    assert.match(filterGraph, /pan=stereo\|c0=0\*c0\|c1=1\*c0/);
  });
});

for (const tool of ['mix-score-audio.mjs', 'render-story-reel.mjs']) {
  test(`${tool} rejects an unknown voice configuration before output creation`, () => {
    withCliSandbox(tool, ({ sandboxRoot, toolFile, artFile, audioFile }) => {
      const outputDirectory = path.join(sandboxRoot, 'uncreated-output');
      const args =
        tool === 'mix-score-audio.mjs'
          ? [
              toolFile,
              '--score',
              SCORE_ID,
              '--voice-config',
              'unknown',
              '--out',
              path.join(outputDirectory, 'mix.wav'),
            ]
          : [
              toolFile,
              '--score',
              SCORE_ID,
              '--voice-config',
              'unknown',
              '--art',
              artFile,
              '--audio',
              audioFile,
              '--out',
              path.join(outputDirectory, 'reel.mp4'),
            ];
      const result = spawnSync(process.execPath, args, {
        cwd: sandboxRoot,
        encoding: 'utf8',
        env: { ...process.env, PATH: '' },
      });
      const output = `${result.stdout || ''}\n${result.stderr || ''}`;
      assert.notEqual(result.status, 0, output);
      assert.match(output, /Unknown voice configuration "unknown"/);
      assert.equal(fs.existsSync(outputDirectory), false);
      assert.doesNotMatch(output, /ffmpeg|ffprobe/i);
    });
  });
}

test('voice generation propagates pitch, keys caches by every treatment, and publishes atomically', () => {
  const renderer = fs.readFileSync(path.join(ROOT, 'tools/render-voices.mjs'), 'utf8');
  const edgeRenderer = fs.readFileSync(path.join(ROOT, 'tools/render-edge-tts.py'), 'utf8');
  assert.match(renderer, /const canImportEdgeTts = \(\) =>/);
  assert.match(renderer, /execFileSync\(PYTHON, \['-c', 'import edge_tts'\]/);
  assert.match(
    renderer,
    /if \(!canImportEdgeTts\(\)\)[\s\S]*?pip[\s\S]*?if \(!canImportEdgeTts\(\)\)[\s\S]*?throw new Error/,
  );
  assert.match(renderer, /timings\[key\] = rendered\.timing/);
  assert.match(renderer, /`--rate=\$\{rate\}`/);
  assert.match(renderer, /`--pitch=\$\{pitch\}`/);
  assert.match(
    renderer,
    /`\$\{voice\}\|\$\{rate\}\|\$\{pitch\}\|\$\{transposeSemitones\}\|\$\{text\}`/,
  );
  assert.match(edgeRenderer, /pitch=args\.pitch/);
  assert.match(edgeRenderer, /"transposeSemitones": 0/);
  assert.match(renderer, /if \(failures > 0 \|\| expectedPerConfiguration === 0 \|\| incomplete\)/);
  assert.match(renderer, /var configurations =/);
  assert.match(renderer, /clips: configurations\[/);
  assert.match(renderer, /fs\.writeFileSync\(pendingOut,[\s\S]*?fs\.renameSync\(pendingOut, out\)/);
});

test('a failed multi-configuration render leaves the existing tracked pack byte-identical', () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-render-atomic-test-'));
  try {
    const toolFile = copyIntoSandbox(sandboxRoot, 'tools/render-voices.mjs');
    copyIntoSandbox(sandboxRoot, 'tools/pitch-preserving-transpose.mjs');
    copyIntoSandbox(sandboxRoot, SCORE_RELATIVE);
    const voiceFile = path.join(sandboxRoot, VOICE_RELATIVE);
    fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
    const sentinel = Buffer.from('existing generated pack must survive');
    fs.writeFileSync(voiceFile, sentinel);
    const python = path.join(sandboxRoot, 'tools/.venv/bin/python');
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(
      python,
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === '-c') process.exit(0);
if (args.includes('--pitch=+35Hz')) process.exit(7);
const value = (name) => args[args.indexOf(name) + 1];
const media = value('--media-out');
const timing = value('--timing-out');
fs.mkdirSync(require('node:path').dirname(media), { recursive: true });
fs.writeFileSync(media, 'synthetic-invalid-mp3');
fs.writeFileSync(timing, JSON.stringify({ voice: value('--voice'), rate: args.find((arg) => arg.startsWith('--rate='))?.slice(7), pitch: args.find((arg) => arg.startsWith('--pitch='))?.slice(8), transposeSemitones: 0, text: value('--text'), duration: 0.2, words: [{ text: value('--text'), start: 0, end: 0.2 }] }));
`,
    );
    fs.chmodSync(python, 0o755);
    const result = spawnSync(process.execPath, [toolFile, '--score', SCORE_ID], {
      cwd: sandboxRoot,
      encoding: 'utf8',
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    assert.notEqual(result.status, 0, output);
    assert.match(output, /refusing to replace its generated pack/);
    assert.deepEqual(fs.readFileSync(voiceFile), sentinel);
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
});

test('octave DSP shifts a synthetic tone by six semitones while preserving duration', () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'transpose-dsp-test-'));
  try {
    const input = path.join(sandboxRoot, 'input.wav');
    const generated = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=1.5',
        '-ar',
        '48000',
        '-ac',
        '1',
        input,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(generated.status, 0, generated.stderr);
    const before = probeAudio(input);
    const measureFrequency = (file) => {
      const decoded = spawnSync(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          file,
          '-f',
          'f32le',
          '-acodec',
          'pcm_f32le',
          '-ar',
          '48000',
          '-ac',
          '1',
          'pipe:1',
        ],
        { encoding: null, maxBuffer: 16 * 1024 * 1024 },
      );
      assert.equal(decoded.status, 0, decoded.stderr?.toString());
      const samples = new Float32Array(
        decoded.stdout.buffer,
        decoded.stdout.byteOffset,
        Math.floor(decoded.stdout.byteLength / 4),
      );
      const start = Math.floor(0.1 * 48000);
      let crossings = 0;
      for (let index = start + 1; index < samples.length; index += 1) {
        if (samples[index - 1] <= 0 && samples[index] > 0) crossings += 1;
      }
      return crossings / ((samples.length - start) / 48000);
    };
    for (const semitones of [6, -6]) {
      const output = path.join(sandboxRoot, `${semitones}.wav`);
      const result = transposeAudioDurationPreserving(input, output, semitones);
      const after = probeAudio(output);
      const expectedRatio = 2 ** (semitones / 12);
      assert.ok(Math.abs(after.duration - before.duration) <= result.tolerance);
      assert.ok(Math.abs(measureFrequency(output) / 440 - expectedRatio) < 0.01);
      assert.equal(result.filter, transposeFilter(48000, semitones).filter);
    }
  } finally {
    fs.rmSync(sandboxRoot, { recursive: true, force: true });
  }
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
