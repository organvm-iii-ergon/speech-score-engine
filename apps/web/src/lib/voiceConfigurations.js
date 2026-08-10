// Every tracker score gets the same treatment vocabulary. Scores with generated alternate packs
// resolve those IDs to their rendered files; scores with a single top-level pack keep that audio
// and apply the treatment in the shared Web Audio engine.
export const DEFAULT_VOICE_CONFIGURATION_IDS = [
  'natural',
  'subtle',
  'separated',
  'theatrical',
  'octave-split',
];

export const hasRenderedVoiceConfigurations = (score) =>
  score?.voiceConfigurations &&
  typeof score.voiceConfigurations === 'object' &&
  Object.keys(score.voiceConfigurations).length > 0;

export const voiceConfigurationIds = (score) =>
  hasRenderedVoiceConfigurations(score)
    ? Object.keys(score.voiceConfigurations)
    : [...DEFAULT_VOICE_CONFIGURATION_IDS];

export const resolveVoiceConfigurationId = (score, requested) => {
  const ids = voiceConfigurationIds(score);
  if (!ids.length) return null;
  if (requested && ids.includes(requested)) return requested;
  if (score.defaultVoiceConfiguration && ids.includes(score.defaultVoiceConfiguration)) {
    return score.defaultVoiceConfiguration;
  }
  return ids[0];
};

export function selectVoicePackConfiguration(score, voicePack, requested, options = {}) {
  const ids = voiceConfigurationIds(score);
  const renderedConfigurations = hasRenderedVoiceConfigurations(score);
  if (options.strict && requested && !ids.includes(requested)) {
    throw new Error(
      `Unknown voice configuration ${JSON.stringify(requested)} for score ${JSON.stringify(score.id)}.`,
    );
  }
  const id = resolveVoiceConfigurationId(score, requested);
  if (!renderedConfigurations) {
    if (!voicePack?.clips)
      throw new Error(`Voice pack ${JSON.stringify(score.id)} did not register clips.`);
    return { id, clips: voicePack.clips, timings: voicePack.timings || {} };
  }
  if (!id) {
    if (!voicePack?.clips)
      throw new Error(`Voice pack ${JSON.stringify(score.id)} did not register clips.`);
    return { id: null, clips: voicePack.clips, timings: voicePack.timings || {} };
  }
  const selected = voicePack?.configurations?.[id];
  if (!selected?.clips || !selected?.timings) {
    // A generated pack aliases its default at the top level. Accept those aliases so a score can
    // acquire configuration metadata before its pack is regenerated without breaking playback.
    if (id === score.defaultVoiceConfiguration && voicePack?.clips && voicePack?.timings) {
      return { id, clips: voicePack.clips, timings: voicePack.timings };
    }
    throw new Error(
      `Voice pack ${JSON.stringify(score.id)} has no generated configuration ${JSON.stringify(id)}.`,
    );
  }
  return { id, clips: selected.clips, timings: selected.timings };
}
