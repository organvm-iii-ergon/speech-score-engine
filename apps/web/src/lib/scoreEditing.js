const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const eventStart = (event) => {
  if (finiteNumber(event?.start)) return event.start;
  return finiteNumber(event?.row) ? event.row : 0;
};

const eventBeats = (event) => (finiteNumber(event?.beats) && event.beats > 0 ? event.beats : 1);

// Scores reserve one tail beat after their latest clip so the final line has somewhere to clear.
export const totalFromEventExtents = (events) => {
  const maxEnd = (Array.isArray(events) ? events : []).reduce(
    (maximum, event) => Math.max(maximum, Math.max(0, eventStart(event)) + eventBeats(event)),
    0,
  );
  return Math.max(1, Math.ceil(maxEnd) + 1);
};

// Imported JSON is untrusted: retain an authored total only when it is finite and covers its clips.
export const deriveScoreTotal = (total, events) => {
  const minimum = totalFromEventExtents(events);
  return finiteNumber(total) && total >= minimum ? total : minimum;
};

// A continuous lane owns one rendered clip keyed by its source-passage text. Rebuild that text from
// every visible line whenever any line changes, deliberately invalidating an old voice/timing key.
export const renameContinuousPassageLine = (events, eventId, text) => {
  const renamed = events.map((event) => (event.id === eventId ? { ...event, text } : event));
  const edited = renamed.find((event) => event.id === eventId);
  if (!edited) return renamed;

  const trigger = renamed.find(
    (event) =>
      event.lane === edited.lane &&
      typeof event.speechText === 'string' &&
      event.speechText.trim().length > 0,
  );
  if (!trigger) return renamed;

  const passage = renamed
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.lane === edited.lane)
    .sort((a, b) => eventStart(a.event) - eventStart(b.event) || a.index - b.index)
    .map(({ event }) => String(event.text).trim())
    .filter(Boolean)
    .join(' ');

  return renamed.map((event) =>
    event.id === trigger.id ? { ...event, speechText: passage } : event,
  );
};
