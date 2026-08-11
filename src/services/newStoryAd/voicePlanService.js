function clean(value = '', limit = 160) {
  return String(value || '').trim().slice(0, limit);
}

function resolveVoiceAssignments(options = {}, ctx = {}, existingTtsAudio = {}, voiceId = '') {
  const value = options.voice_assignments || options.voiceAssignments || ctx.voice_assignments || existingTtsAudio.voice_assignments || {};
  const speakers = {};
  Object.entries(value?.speakers || {}).slice(0, 30).forEach(([speaker, assignedVoice]) => {
    const name = clean(speaker, 100);
    const id = clean(assignedVoice, 120);
    if (name && id) speakers[name] = id;
  });
  return { narrator: clean(value?.narrator || value?.narrator_voice_id || voiceId, 120), speakers };
}

function voiceoverEnabled(options = {}, ctx = {}, voiceId = '', voiceAssignments = {}) {
  const requested = Object.prototype.hasOwnProperty.call(options, 'include_voiceover')
    ? options.include_voiceover
    : options.includeVoiceover;
  const hasAssignedVoice = !!voiceId || Object.keys(voiceAssignments?.speakers || {}).length > 0;
  if (requested !== undefined) return requested !== false && hasAssignedVoice;
  const stored = Object.prototype.hasOwnProperty.call(ctx, 'include_voiceover')
    ? ctx.include_voiceover
    : ctx.includeVoiceover;
  if (stored !== undefined) return stored !== false && hasAssignedVoice;
  return hasAssignedVoice;
}

module.exports = { resolveVoiceAssignments, voiceoverEnabled };
