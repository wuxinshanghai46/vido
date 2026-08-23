const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const CACHE_FILE = path.join(OUTPUT_DIR, 'hifly_avatar_cache.json');
const STAGE = 'new_story_ad.lip_sync';

function cache() { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; } }
function saveCache(value) { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(value, null, 2)); }
function keyFor(url) { return crypto.createHash('sha1').update(`${url}|aigc_off_v2`).digest('hex').slice(0, 16); }

async function ensureHiflyAvatar(imageUrl, hifly, onProgress, modelId) {
  const key = keyFor(imageUrl); const rows = cache();
  if (rows[key]?.avatar) return rows[key].avatar;
  onProgress?.({ stage: 'lip_sync_avatar', model_id: modelId, message: '正在建立口型驱动人物' });
  const taskId = await hifly.createAvatarByImage({ image_url: imageUrl, title: `vido-story-${key}`, model: 2, aigc_flag: 2 });
  const result = await hifly.waitAvatarTask(taskId, { intervalMs: 5000, timeoutMs: 10 * 60 * 1000, onProgress });
  rows[key] = { avatar: result.avatar, image_url: imageUrl, created_at: new Date().toISOString(), task_id: taskId };
  saveCache(rows); return result.avatar;
}

function supportsNativeAudio(model = {}) {
  return String(model.model_id || '').startsWith('doubao-seedance-2-0');
}

function candidates({ soundRequired = false } = {}) {
  return pipeline.pickAllEnabledWithDefault(STAGE)
    .filter(item => item.enabled !== false)
    .filter(item => !soundRequired || supportsNativeAudio(item));
}

function preferredCandidate(options = {}) {
  const chain = candidates(options);
  return chain.find(providerReady) || chain[0] || null;
}

function providerReady(model = {}) {
  const actual = String(model.model_id || '').startsWith('topview-avatar') ? 'topview'
    : String(model.model_id || '').startsWith('jimeng_') ? 'jimeng'
      : String(model.model_id || '').startsWith('hifly') ? 'hifly' : model.provider_id;
  const provider = (loadSettings().providers || []).find(item => item.id === actual || item.preset === actual);
  return !!(provider && provider.enabled !== false && provider.api_key);
}

async function runCandidate(model, input) {
  const modelId = String(model.model_id || '');
  if (modelId.startsWith('doubao-seedance-2-0')) {
    const outputDir = path.dirname(input.outputPath); const filename = path.basename(input.outputPath, path.extname(input.outputPath));
    const result = await require('../videoService').generateVideoClip({ video_provider: model.provider_id, video_model: modelId, prompt: input.prompt, image_url: input.imageUrl, audio_url: input.audioUrl, generateAudio: true, duration: input.duration || 5, outputDir, filename, aspectRatio: input.aspectRatio || '9:16', agentId: STAGE, userId: input.userId });
    return { ...result, provider_id: model.provider_id, model_id: modelId, videoUrl: result.videoUrl || result.video_url || '', filePath: result.filePath || '' };
  }
  if (modelId.startsWith('topview-avatar')) {
    const result = await require('../topviewService').generatePhotoAvatar({
      imageUrl: input.imageUrl, audioUrl: input.audioUrl, prompt: input.prompt,
      model: modelId, taskTitle: `vido-story-${String(input.taskId).replace(/[^A-Za-z0-9]/g, '').slice(0, 20)}`,
      timeoutMs: 45 * 60 * 1000, onProgress: input.onProgress,
    });
    return { ...result, provider_id: 'topview', model_id: modelId };
  }
  if (modelId === 'jimeng_realman_avatar_picture_omni_v15') {
    const result = await require('../jimengAvatarService').generateDigitalHumanVideo({
      imageUrl: input.imageUrl, audioUrl: input.audioUrl, prompt: input.prompt,
      timeoutMs: 15 * 60 * 1000, intervalMs: 5000, userId: input.userId,
      agentId: STAGE, onProgress: input.onProgress,
    });
    return { ...result, provider_id: 'jimeng', model_id: modelId };
  }
  if (modelId === 'hifly' || modelId === 'hifly-free') {
    const hifly = require('../hiflyService');
    const avatar = await ensureHiflyAvatar(input.imageUrl, hifly, input.onProgress, modelId);
    const taskId = await hifly.createVideoByAudio({ audio_url: input.audioUrl, avatar, title: `vido${String(input.taskId).replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`, aigc_flag: 2, pipeline: '1.5' });
    const result = await hifly.waitVideoTask(taskId, { intervalMs: 5000, timeoutMs: 15 * 60 * 1000, onProgress: input.onProgress });
    return { videoUrl: result.video_url, taskId, duration: result.duration, provider_id: 'hifly', model_id: modelId };
  }
  const error = new Error(`${model.provider_id}/${modelId} 不支持图片+音频逐字口型驱动`);
  error.code = 'LIP_SYNC_MODEL_CAPABILITY_MISMATCH'; throw error;
}

async function download(url, outputPath) {
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 180000 });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(response.data));
  return outputPath;
}

async function generate(input = {}) {
  if (!input.imageUrl || !input.audioUrl) {
    const error = new Error('出镜对白镜头缺少关键帧或真实配音，不能执行逐字口型同步');
    error.code = 'LIP_SYNC_INPUT_INCOMPLETE'; error.retryable = false; throw error;
  }
  const chain = candidates({ soundRequired: input.soundRequired === true });
  if (!chain.length) {
    const error = new Error(`${STAGE} 未在模型调用管理中配置可用口型模型`);
    error.code = input.soundRequired === true ? 'LIP_SYNC_NATIVE_AUDIO_MODEL_NOT_CONFIGURED' : 'LIP_SYNC_MODEL_NOT_CONFIGURED';
    error.retryable = false; throw error;
  }
  const attempts = [];
  for (const model of chain) {
    if (!providerReady(model)) { attempts.push({ ...model, code: 'PROVIDER_NOT_READY' }); continue; }
    try {
      const result = await runCandidate(model, input);
      const remoteUrl = result.videoUrl || result.video_url || result.url;
      if (result.filePath && fs.existsSync(result.filePath)) {
        if (path.resolve(result.filePath) !== path.resolve(input.outputPath)) fs.copyFileSync(result.filePath, input.outputPath);
      } else {
        if (!remoteUrl) throw new Error('口型模型完成但没有返回视频地址');
        await download(remoteUrl, input.outputPath);
      }
      return { ...result, filePath: input.outputPath, attempts, lip_sync_applied: true, audio_source: input.audioUrl };
    } catch (error) {
      attempts.push({ provider_id: model.provider_id, model_id: model.model_id, code: error.code || 'LIP_SYNC_FAILED', error: String(error.message || error).slice(0, 300) });
      // 口型模型路由与费用确认、产物血缘绑定；供应商提交后禁止静默切换模型。
      error.attempts = attempts;
      throw error;
    }
  }
  const error = new Error('逐字口型同步模型均不可用，已停止该镜头生成');
  error.code = 'LIP_SYNC_MODEL_UNAVAILABLE'; error.attempts = attempts; error.retryable = true; throw error;
}

module.exports = { STAGE, candidates, preferredCandidate, supportsNativeAudio, generate, providerReady };
