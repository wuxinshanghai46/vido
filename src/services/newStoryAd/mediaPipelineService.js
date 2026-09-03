const defaultStorage = require('./storageService');
const defaultTtsAdapter = require('./ttsAdapter');
const mediaConfiguration = require('./mediaConfigurationService');

/**
 * 判断当前配音是否已经与分镜和音色完全一致，避免重复生成可复用的 TTS。
 */
function voiceoverPlanIsReady(taskId = '', voiceId = '', voiceAssignments = {}, storage = defaultStorage, ttsAdapter = defaultTtsAdapter) {
  if (!voiceId && !Object.keys(voiceAssignments?.speakers || {}).length) return true;
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table'))
    ? storage.getOutput(taskId, 'storyboard_table')
    : [];
  const ttsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  if (typeof ttsAdapter.voiceoverReady === 'function') return ttsAdapter.voiceoverReady(ttsAudio, shots, voiceId, voiceAssignments);
  return ttsAdapter.voiceoverPlanMatches(ttsAudio, shots, voiceId, voiceAssignments);
}

/**
 * 执行一次完整媒体任务：生成包含剧情声音的分镜视频，再合成初版；声音修改由成片剪辑单独触发。
 */
async function runMediaPipeline({
  taskId = '',
  options = {},
  generationId = '',
  service,
  storage = defaultStorage,
  ttsAdapter = defaultTtsAdapter,
} = {}) {
  if (!service) throw new Error('媒体流水线缺少剧情广告服务。');
  const payload = { ...options, generation_id: generationId, ...require('./nativeAudioWorkflowService').context({}), apply_audio_edits: false };
  const videoResult = await service.generateVideoStage(taskId, { ...payload, missing_only: true, auto_tts: false });
  if (videoResult?.partial === true) {
    const indexes = Array.isArray(videoResult.remaining_unapproved_indexes) ? videoResult.remaining_unapproved_indexes : [];
    const error = new Error(`视频审核尚未完成${indexes.length ? `：第 ${indexes.map(index => index + 1).join('、')} 镜` : ''}，已停止最终封装`);
    error.code = 'VIDEO_STAGE_INCOMPLETE'; error.retryable = true; throw error;
  }
  return service.composeStage(taskId, payload);
}

module.exports = { voiceoverPlanIsReady, runMediaPipeline };
