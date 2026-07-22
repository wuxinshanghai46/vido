const ttsAdapter = require('./ttsAdapter');

function reuseExistingVoiceover({ storage, taskId = '', ttsAudio = {}, shots = [], voiceId = '', force = false } = {}) {
  if (force || !ttsAdapter.voiceoverReady(ttsAudio, shots, voiceId)) return null;
  storage.saveStage(taskId, 'tts', {
    status: 'done',
    output_summary: `${ttsAudio.tracks.length} existing audio tracks reused`,
    diagnostics: { skipped: true, reused: true, provider_used: ttsAudio.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
  return { tts_audio: ttsAudio, skipped: true, reused: true };
}

module.exports = { reuseExistingVoiceover };
