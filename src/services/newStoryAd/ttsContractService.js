'use strict';

const { cleanText } = require('./contextBuilder');

function resolveVoiceId(options = {}, context = {}, existing = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'voice_id') || Object.prototype.hasOwnProperty.call(options, 'voiceId')) {
    return cleanText(options.voice_id ?? options.voiceId ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(context, 'voice_id') || Object.prototype.hasOwnProperty.call(context, 'voiceId')) {
    return cleanText(context.voice_id ?? context.voiceId ?? '', 120);
  }
  return cleanText(existing.voice_id || existing.voiceId || '', 120);
}

function silentOutput(reason = 'voiceover_disabled') {
  return { tracks: [], voice_id: '', skipped: true, reason, provider_used: '', warnings: [] };
}

module.exports = { resolveVoiceId, silentOutput };
