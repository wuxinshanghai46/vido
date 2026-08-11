const defaultStorage = require('./storageService');

function clean(value = '', limit = 160) {
  return String(value ?? '').trim().slice(0, limit);
}

function hasOwn(object = {}, key = '') {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVoiceAssignments(value = {}, fallbackVoiceId = '') {
  const source = value && typeof value === 'object' ? value : {};
  const rawSpeakers = source.speakers && typeof source.speakers === 'object' ? source.speakers : {};
  const speakers = {};
  Object.entries(rawSpeakers).slice(0, 30).forEach(([speaker, voiceId]) => {
    const safeSpeaker = clean(speaker, 100);
    const safeVoice = clean(voiceId, 120);
    if (safeSpeaker && safeVoice) speakers[safeSpeaker] = safeVoice;
  });
  return {
    narrator: clean(source.narrator || source.narrator_voice_id || fallbackVoiceId, 120),
    speakers,
  };
}

/**
 * 在任何配音或视频调用前保存用户确认的媒体选项，保证失败后刷新页面仍能恢复。
 */
function persistMediaConfiguration(taskId = '', options = {}, storage = defaultStorage) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const current = storage.getOutput(taskId, 'context') || task.request || {};
  const voiceSpecified = hasOwn(options, 'voice_id') || hasOwn(options, 'voiceId');
  const voiceNameSpecified = hasOwn(options, 'voice_name') || hasOwn(options, 'voiceName');
  const bgmSpecified = hasOwn(options, 'bgm_asset') || hasOwn(options, 'bgmAsset');
  const assignmentsSpecified = hasOwn(options, 'voice_assignments') || hasOwn(options, 'voiceAssignments');
  const subtitleSpecified = hasOwn(options, 'subtitle');
  const voiceId = voiceSpecified
    ? clean(options.voice_id ?? options.voiceId ?? '', 120)
    : clean(current.voice_id || current.voiceId || '', 120);
  const includeVoiceover = voiceId
    ? (hasOwn(options, 'include_voiceover') ? options.include_voiceover !== false : current.include_voiceover !== false)
    : assignmentsSpecified || Object.keys(current.voice_assignments?.speakers || {}).length > 0;
  const subtitleEnabled = subtitleSpecified ? options.subtitle !== false : current.subtitle !== false;
  const rawSubtitle = options.subtitle_config || options.subtitleConfig || current.subtitle_config || current.subtitleConfig || {};
  const next = {
    ...current,
    voice_id: voiceId,
    voice_name: voiceNameSpecified
      ? clean(options.voice_name ?? options.voiceName ?? '', 120)
      : clean(current.voice_name || current.voiceName || '', 120),
    voice_assignments: normalizeVoiceAssignments(
      assignmentsSpecified ? (options.voice_assignments ?? options.voiceAssignments) : current.voice_assignments,
      voiceId,
    ),
    include_voiceover: includeVoiceover,
    voice_volume: finiteNumber(options.voice_volume ?? options.voiceVolume ?? current.voice_volume ?? current.voiceVolume, 1),
    bgm_volume: finiteNumber(options.bgm_volume ?? options.bgmVolume ?? current.bgm_volume ?? current.bgmVolume, 0.16),
    bgm_profile: clean(options.bgm_profile || options.bgmProfile || current.bgm_profile || current.bgmProfile || 'auto', 60),
    bgm_asset: bgmSpecified ? (options.bgm_asset ?? options.bgmAsset ?? null) : (current.bgm_asset || current.bgmAsset || null),
    subtitle: subtitleEnabled,
    subtitle_style: clean(options.subtitle_style || options.subtitleStyle || current.subtitle_style || current.subtitleStyle || 'popup', 60),
    subtitle_config: {
      ...(rawSubtitle && typeof rawSubtitle === 'object' ? rawSubtitle : {}),
      show: subtitleEnabled,
    },
  };
  storage.saveOutput(taskId, 'context', next);
  return next;
}

module.exports = { persistMediaConfiguration };
