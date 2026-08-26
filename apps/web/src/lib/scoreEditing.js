const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const eventStart = (event) => {
  if (finiteNumber(event?.start)) return event.start;
  return finiteNumber(event?.row) ? event.row : 0;
};

const eventBeats = (event) => (finiteNumber(event?.beats) && event.beats > 0 ? event.beats : 1);

const hasPassageText = (event) =>
  typeof event?.speechText === 'string' && event.speechText.trim().length > 0;

const passageText = (events, lane) =>
  events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.lane === lane)
    .sort((a, b) => eventStart(a.event) - eventStart(b.event) || a.index - b.index)
    .map(({ event }) => String(event.text).trim())
    .filter(Boolean)
    .join(' ');

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

// A continuous passage has one audible source and silent visual continuations. Structural editor
// changes can remove or move that source, so promote the first surviving continuation and rebuild
// its source text from the lane's current visual order.
export const reconcileContinuousPassageLane = (events, lane) => {
  const laneEvents = events.filter((event) => event.lane === lane);
  const isContinuous = laneEvents.some((event) => event.silent || hasPassageText(event));
  if (!isContinuous) return events;

  const ordered = laneEvents
    .map((event, index) => ({ event, index }))
    .sort((a, b) => eventStart(a.event) - eventStart(b.event) || a.index - b.index)
    .map(({ event }) => event);
  const source =
    ordered.find((event) => hasPassageText(event) && !event.silent) ??
    ordered.find((event) => event.silent);
  if (!source) return events;

  const text = passageText(events, lane);
  return events.map((event) =>
    event.id === source.id ? { ...event, silent: false, speechText: text } : event,
  );
};

export const moveContinuousPassageEvent = (events, eventId, lane) => {
  const source = events.find((event) => event.id === eventId);
  if (!source || source.lane === lane) return events;
  const wasPassageMember = source.silent || hasPassageText(source);
  const { silent: _silent, speechText: _speechText, ...plainSource } = source;
  const moved = wasPassageMember ? { ...plainSource, lane } : { ...source, lane };
  const next = events.map((event) => (event.id === eventId ? moved : event));
  return reconcileContinuousPassageLane(next, source.lane);
};

export const removeContinuousPassageEvent = (events, eventId) => {
  const source = events.find((event) => event.id === eventId);
  if (!source) return events;
  return reconcileContinuousPassageLane(
    events.filter((event) => event.id !== eventId),
    source.lane,
  );
};

export const duplicateContinuousPassageEvent = (event, id, start) => {
  const { silent: _silent, speechText: _speechText, ...plainEvent } = event;
  return event.silent || hasPassageText(event)
    ? { ...plainEvent, id, start }
    : { ...event, id, start };
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

  const passage = passageText(renamed, edited.lane);

  return renamed.map((event) =>
    event.id === trigger.id ? { ...event, speechText: passage } : event,
  );
};
