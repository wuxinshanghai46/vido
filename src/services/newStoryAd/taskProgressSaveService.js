function hasTerminalFailure(task = {}) {
  return String(task.status || '').toLowerCase() === 'failed'
    || !!String(task.error || task.error_code || '').trim()
    || /_failed$/.test(String(task.stage || '').toLowerCase());
}

function taskPatch(task = {}, { progressStage = 'draft', hasActiveGeneration = false, changeScope = 'none' } = {}) {
  if (hasActiveGeneration) return {};
  const failed = hasTerminalFailure(task);
  if (failed && changeScope === 'none') return {};
  const finalDone = ['final_video_ready', 'done'].includes(progressStage);
  return {
    status: finalDone ? (failed ? 'done' : (task.status || 'done')) : 'working',
    stage: progressStage,
    ...(failed ? {
      error: '', error_code: '', support_id: '', retryable: false,
      generation_progress: null, generation_finished_at: '',
    } : {}),
  };
}

function mediaInvalidatedOutputs(previous = {}, next = {}, { savingProgress = false, mediaChangeScope = '' } = {}) {
  const requested = String(mediaChangeScope || '').trim().toLowerCase();
  const voiceChanged = JSON.stringify({
    voice_id: previous.voice_id || '',
    include_voiceover: previous.include_voiceover !== false && !!previous.voice_id,
    voice_volume: Number(previous.voice_volume ?? 1),
  }) !== JSON.stringify({
    voice_id: next.voice_id || '',
    include_voiceover: next.include_voiceover !== false && !!next.voice_id,
    voice_volume: Number(next.voice_volume ?? 1),
  });
  const composeChanged = JSON.stringify({
    bgm_asset: previous.bgm_asset || null,
    bgm_volume: Number(previous.bgm_volume ?? 0.16),
    bgm_profile: previous.bgm_profile || 'auto',
    subtitle: previous.subtitle !== false,
    subtitle_style: previous.subtitle_style || 'popup',
    subtitle_config: previous.subtitle_config || {},
  }) !== JSON.stringify({
    bgm_asset: next.bgm_asset || null,
    bgm_volume: Number(next.bgm_volume ?? 0.16),
    bgm_profile: next.bgm_profile || 'auto',
    subtitle: next.subtitle !== false,
    subtitle_style: next.subtitle_style || 'popup',
    subtitle_config: next.subtitle_config || {},
  });
  if (savingProgress && !['voice', 'compose'].includes(requested)) return [];
  if (voiceChanged && (!savingProgress || requested === 'voice')) return ['tts_audio', 'video_clips', 'final_video'];
  if (composeChanged && (!savingProgress || ['voice', 'compose'].includes(requested))) return ['final_video'];
  return [];
}

function preserveUnconfirmedMediaSettings(previous = {}, next = {}, { savingProgress = false, mediaChangeScope = '' } = {}) {
  if (!savingProgress) return next;
  const requested = String(mediaChangeScope || '').trim().toLowerCase();
  const voiceKeys = ['voice_id', 'voice_name', 'include_voiceover', 'voice_volume'];
  const composeKeys = ['bgm_asset', 'bgm_volume', 'bgm_profile', 'subtitle', 'subtitle_style', 'subtitle_config'];
  const preservedKeys = requested === 'voice' ? [] : (requested === 'compose' ? voiceKeys : [...voiceKeys, ...composeKeys]);
  return preservedKeys.reduce((result, key) => (
    Object.prototype.hasOwnProperty.call(previous, key) ? { ...result, [key]: previous[key] } : result
  ), next);
}

module.exports = { hasTerminalFailure, taskPatch, mediaInvalidatedOutputs, preserveUnconfirmedMediaSettings };
