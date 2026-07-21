const defaultStorage = require('./storageService');
const defaultTtsAdapter = require('./ttsAdapter');
const mediaConfiguration = require('./mediaConfigurationService');

/**
 * 判断当前配音是否已经与分镜和音色完全一致，避免重复生成可复用的 TTS。
 */
function voiceoverPlanIsReady(taskId = '', voiceId = '', storage = defaultStorage, ttsAdapter = defaultTtsAdapter) {
  if (!voiceId) return true;
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table'))
    ? storage.getOutput(taskId, 'storyboard_table')
    : [];
  const ttsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  return ttsAdapter.voiceoverPlanMatches(ttsAudio, shots, voiceId);
}

/**
 * 执行一次完整媒体任务：先准备可选配音，再生成纯视觉连续段，最后本地混音合成。
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
  const context = mediaConfiguration.persistMediaConfiguration(taskId, options, storage);
  const payload = {
    ...options,
    generation_id: generationId,
    voice_id: context.voice_id || '',
    voice_name: context.voice_name || '',
    include_voiceover: context.include_voiceover === true,
    bgm_asset: context.bgm_asset || null,
  };
  if (payload.include_voiceover && !voiceoverPlanIsReady(taskId, payload.voice_id, storage, ttsAdapter)) {
    await service.generateTtsStage(taskId, payload);
  }
  await service.generateVideoStage(taskId, {
    ...payload,
    missing_only: true,
    visual_only: true,
    include_voiceover: false,
    auto_tts: false,
  });
  return service.composeStage(taskId, payload);
}

module.exports = { voiceoverPlanIsReady, runMediaPipeline };
