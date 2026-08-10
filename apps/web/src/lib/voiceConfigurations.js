export const voiceConfigurationIds = (score) =>
  score?.voiceConfigurations && typeof score.voiceConfigurations === 'object'
    ? Object.keys(score.voiceConfigurations)
    : [];

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
  if (options.strict && requested && !ids.includes(requested)) {
    throw new Error(
      `Unknown voice configuration ${JSON.stringify(requested)} for score ${JSON.stringify(score.id)}.`,
    );
  }
  const id = resolveVoiceConfigurationId(score, requested);
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
