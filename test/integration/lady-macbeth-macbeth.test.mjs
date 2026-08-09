import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

test('tracker gives timed continuous passages an audible Live cue with half-open section bounds', () => {
  const engine = fs.readFileSync(
    path.join(ROOT, 'apps/web/public/prototypes/tracker-engine.js'),
    'utf8',
  );
  assert.match(engine, /const playTimedCueRow = \(row\) =>/);
  assert.match(engine, /if \(timedCues && cue\)[\s\S]*?playTimedCueRow\(row\);[\s\S]*?return;/);
  assert.match(engine, /timedCues \? r < e : r <= e/);
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
