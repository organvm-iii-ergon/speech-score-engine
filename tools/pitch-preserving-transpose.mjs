import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const safeNumber = (value) => Number(value.toFixed(9));

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) fail(`Could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} exited with ${result.status}: ${(result.stderr || result.stdout || '').trim()}`);
  }
  return result.stdout;
}

export function transposeFilter(sampleRate, semitones) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) fail('Audio sample rate must be positive.');
  if (!Number.isFinite(semitones) || semitones === 0) fail('Transpose semitones must be non-zero.');
  const ratio = 2 ** (semitones / 12);
  const tempo = 1 / ratio;
  if (tempo < 0.5 || tempo > 100) fail('Transpose amount is outside FFmpeg atempo limits.');
  return {
    ratio,
    filter: `asetrate=${safeNumber(sampleRate * ratio)},aresample=${sampleRate},atempo=${safeNumber(tempo)}`,
  };
}

export function probeAudio(file) {
  const output = run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a:0',
    '-show_entries',
    'stream=sample_rate:format=duration',
    '-of',
    'json',
    file,
  ]);
  const parsed = JSON.parse(output);
  const sampleRate = Number(parsed.streams?.[0]?.sample_rate);
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(sampleRate) || !Number.isFinite(duration) || duration <= 0) {
    fail(`Could not probe audio timing for ${file}.`);
  }
  return { sampleRate, duration };
}

export function transposeAudioDurationPreserving(input, output, semitones) {
  const before = probeAudio(input);
  const { filter, ratio } = transposeFilter(before.sampleRate, semitones);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const extension = path.extname(output) || '.wav';
  const temporary = path.join(
    path.dirname(output),
    `${path.basename(output, extension)}.${process.pid}.${crypto.randomUUID()}.tmp${extension}`,
  );
  try {
    run('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      input,
      '-vn',
      '-af',
      filter,
      temporary,
    ]);
    const after = probeAudio(temporary);
    const drift = Math.abs(after.duration - before.duration);
    const tolerance = Math.max(0.05, before.duration * 0.01);
    if (drift > tolerance) {
      fail(
        `Duration-preserving transpose drifted ${drift.toFixed(4)} s (limit ${tolerance.toFixed(4)} s).`,
      );
    }
    fs.renameSync(temporary, output);
    return { ...before, outputDuration: after.duration, drift, tolerance, filter, ratio };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
