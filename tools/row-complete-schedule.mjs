// Derive a tracker schedule where every lane in a row begins together and the next row waits for
// the longest rendered clip. This makes voice timing, offline mixes, and story reels share one
// measured timing authority rather than an arbitrary metronome grid.

export const isRowCompleteScore = (score) => score?.playback === 'row-complete';

export const clipKey = (event) => `${event.lane}|${event.speechText || event.text}`;

export function deriveRowCompleteSchedule(score, voicePack) {
  if (!isRowCompleteScore(score)) return null;
  const laneById = new Map(score.lanes.map((lane) => [lane.id, lane]));
  const rows = new Map();
  for (const event of score.events) {
    const lane = laneById.get(event.lane);
    if (event.silent || !lane || lane.performer === 'human') continue;
    if (!rows.has(event.row)) rows.set(event.row, []);
    rows.get(event.row).push({ event, lane });
  }

  const expectedLanes = score.lanes.filter((lane) => lane.performer !== 'human').map((lane) => lane.id);
  let cursor = 0;
  const scheduledRows = [];
  for (const [row, entries] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    if (entries.length !== expectedLanes.length) {
      throw new Error(`Row ${row} must contain one rendered event for each active lane.`);
    }
    const ids = new Set(entries.map(({ event }) => event.lane));
    if (expectedLanes.some((lane) => !ids.has(lane))) {
      throw new Error(`Row ${row} is missing an active lane.`);
    }
    const clips = entries.map(({ event, lane }) => {
      const timing = voicePack?.timings?.[clipKey(event)];
      if (!Number.isFinite(timing?.duration) || timing.duration <= 0) {
        throw new Error(`Row ${row} is missing a measured duration for ${clipKey(event)}.`);
      }
      return { event, lane, timing, start: cursor };
    });
    const duration = Math.max(...clips.map(({ timing }) => timing.duration));
    scheduledRows.push({ row, start: cursor, end: cursor + duration, duration, clips });
    cursor += duration;
  }
  if (!scheduledRows.length) throw new Error('A row-complete score requires rendered lane events.');
  return { duration: cursor, rows: scheduledRows };
}
