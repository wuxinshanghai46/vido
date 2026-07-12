const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');
const modelGateway = require('./modelGateway');
const storage = require('./storageService');
const { continuityPrompt } = require('./continuityService');
const cancellation = require('./cancellationContext');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const VIDEO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-videos');
const VIDEO_STAGE = 'new_story_ad.video';
const VIDEO_MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.NEW_STORY_AD_VIDEO_MAX_CANDIDATES) || 3));

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeBase(value = 'new_story_ad_video') {
  return String(value || 'new_story_ad_video').replace(/[^a-z0-9_-]/ig, '_').slice(0, 96) || 'new_story_ad_video';
}

function publicVideoUrl(filename = '') {
  return `/api/new-story-ad/videos/${encodeURIComponent(path.basename(filename))}`;
}

function videoPathFromName(filename = '') {
  const safe = path.basename(String(filename || '').split('?')[0]);
  if (!safe) return '';
  return path.join(VIDEO_DIR, safe);
}

function clamp(num, min, max, fallback) {
  const n = Number(num);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function ratioSize(ratio = '9:16') {
  const key = String(ratio || '9:16').trim();
  if (key === '16:9') return { width: 1280, height: 720 };
  if (key === '1:1') return { width: 1024, height: 1024 };
  if (key === '4:3') return { width: 1024, height: 768 };
  if (key === '3:4') return { width: 768, height: 1024 };
  return { width: 720, height: 1280 };
}

function outputSize(ratio = '9:16', resolution = '720p') {
  const base = ratioSize(ratio);
  const scale = { '480p': 480 / 720, '720p': 1, '1080p': 1080 / 720, '4k': 2160 / 720 }[String(resolution || '720p').toLowerCase()] || 1;
  const even = value => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(base.width), height: even(base.height) };
}

function execFfmpeg(args, timeoutMs = 120000) {
  if (!ffmpegPath) return Promise.reject(new Error('ffmpeg-static is unavailable'));
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('new_story_ad video render timed out'));
    }, timeoutMs);
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-6).join(' | ') || `ffmpeg exited ${code}`));
    });
  });
}

function probeDuration(filePath = '') {
  if (!filePath || !fs.existsSync(filePath) || !ffprobePath) return Promise.resolve(0);
  return new Promise((resolve) => {
    const child = spawn(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath], { windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.on('error', () => resolve(0));
    child.on('close', () => resolve(Math.max(0, Number(out.trim()) || 0)));
  });
}

async function normalizeProviderClip({ inputPath, outputPath, audioPath = '', durationSec = 4, aspectRatio = '9:16', resolution = '720p' } = {}) {
  ensureDir(path.dirname(outputPath));
  const { width, height } = outputSize(aspectRatio, resolution);
  const duration = clamp(durationSec, 1, 15, 4);
  const args = ['-y', '-i', inputPath];
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100');
  args.push(
    '-t', String(duration),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=30,setsar=1,format=yuv420p`,
    '-af', `apad,atrim=0:${duration},aresample=44100`,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2',
    '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args, 240000);
  return outputPath;
}

function normalizeLocalUrl(url = '') {
  const raw = String(url || '').trim();
  const match = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(\/.+)$/i);
  return match ? match[1] : raw;
}

function localImagePath(url = '') {
  const clean = normalizeLocalUrl(url).split('?')[0];
  const prefix = '/api/new-story-ad/assets/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = mediaAdapter.assetPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  if (!filePath || !fs.existsSync(filePath)) return '';
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(filePath).toLowerCase()) ? filePath : '';
}

function localAudioPath(url = '') {
  const clean = normalizeLocalUrl(url).split('?')[0];
  const prefix = '/api/new-story-ad/audio/';
  if (!clean.startsWith(prefix)) return '';
  const filePath = ttsAdapter.audioPathFromName(decodeURIComponent(clean.slice(prefix.length)));
  return filePath && fs.existsSync(filePath) ? filePath : '';
}

function clipPrompt(shot = {}, ctx = {}, contract = {}, previousShot = null) {
  return [
    `Advertised subject: ${ctx.product_subject || ''}`,
    `Shot purpose: ${shot.purpose || shot.role || ''}`,
    `Visible frame: ${shot.visual || shot.visual_description || shot.content_prompt || ''}`,
    `Required movement: ${shot.action || shot.visual_action || ''}`,
    `Camera: ${shot.camera || shot.camera_movement || contract.camera_strategy || ''}`,
    continuityPrompt(shot, previousShot),
    'Animate the supplied keyframe only. Preserve the current subject identity, wardrobe, product, materials, scene geometry and lighting.',
    'Use physically plausible motion and camera movement. Do not add unrelated people, objects, text, logos, products or locations.',
  ].filter(Boolean).join('\n');
}

function outputPayload(filePath, extra = {}) {
  const filename = path.basename(filePath);
  return {
    filename,
    file_path: filePath,
    video_url: publicVideoUrl(filename),
    videoUrl: publicVideoUrl(filename),
    ...extra,
  };
}

function providerMatches(provider = {}, providerId = '') {
  const target = String(providerId || '').trim().toLowerCase();
  return [provider.id, provider.preset, provider.name]
    .filter(Boolean)
    .some(value => String(value).trim().toLowerCase() === target);
}

function videoCandidates(options = {}) {
  const settings = loadSettings();
  const providers = Array.isArray(settings.providers) ? settings.providers : [];
  const preferredProvider = String(options.video_provider || options.videoProvider || '').trim().toLowerCase();
  const preferredModel = String(options.video_model || options.videoModel || '').trim().toLowerCase();
  return pipeline.pickAllEnabled(VIDEO_STAGE)
    .filter(model => !preferredProvider || String(model.provider_id || '').toLowerCase() === preferredProvider)
    .filter(model => !preferredModel || String(model.model_id || '').toLowerCase() === preferredModel)
    .filter((model) => {
      const provider = providers.find(item => item.enabled !== false && item.api_key && providerMatches(item, model.provider_id));
      if (!provider) return false;
      return (provider.models || []).some(item => String(item.id || '') === String(model.model_id || '') && item.enabled !== false && String(item.use || item.type || '').toLowerCase() === 'video');
    })
    .filter(model => !modelGateway.healthState(model).circuit_open)
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999) || modelGateway.getHealthScore(b) - modelGateway.getHealthScore(a))
    .slice(0, VIDEO_MAX_CANDIDATES);
}

function publicBaseUrl(options = {}) {
  return String(
    options.public_base_url
      || options.publicBaseUrl
      || process.env.NEW_STORY_AD_PUBLIC_BASE_URL
      || process.env.PUBLIC_BASE_URL
      || 'https://www.vidoai.cn',
  ).replace(/\/+$/, '');
}

function absoluteAssetUrl(url = '', options = {}) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${publicBaseUrl(options)}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

async function renderLocalClip({ outputPath, imagePath = '', audioPath = '', durationSec = 4, aspectRatio = '9:16' } = {}) {
  ensureDir(path.dirname(outputPath));
  const { width, height } = ratioSize(aspectRatio);
  const duration = clamp(durationSec, 1, 15, 4);
  const args = ['-y'];
  if (imagePath) args.push('-loop', '1', '-framerate', '30', '-i', imagePath);
  else args.push('-f', 'lavfi', '-i', `color=c=0x111827:s=${width}x${height}:r=30`);
  if (audioPath) args.push('-i', audioPath);
  else args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=mono:sample_rate=44100');
  args.push(
    '-t', String(duration),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=yuv420p`,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-r', '30', '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args);
  return outputPath;
}

async function generateProviderClip({ taskId, shot, previousShot, keyframe, audio, contract, ctx, index, duration, options }) {
  const candidates = videoCandidates(options);
  if (!candidates.length) {
    const error = new Error('new_story_ad.video 当前没有未熔断的真实视频模型，已立即停止本阶段');
    error.code = 'VIDEO_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const imageUrl = absoluteAssetUrl(keyframe.image_url || keyframe.imageUrl || keyframe.url || '', options);
  if (!imageUrl) throw new Error(`第 ${index + 1} 镜缺少关键帧，不能提交图生视频`);
  const prompt = clipPrompt(shot, ctx, contract, previousShot);
  const audioPath = localAudioPath(audio?.audio_url || audio?.audioUrl || audio?.url || '');
  const audioDuration = await probeDuration(audioPath);
  if (audioDuration > duration + 0.35) {
    const error = new Error(`第 ${index + 1} 镜配音 ${audioDuration.toFixed(2)} 秒超过镜头 ${duration.toFixed(2)} 秒，请缩短台词或增加镜头时长`);
    error.code = 'AUDIO_DURATION_EXCEEDS_SHOT';
    error.retryable = false;
    throw error;
  }
  const attempts = [];
  for (const model of candidates) {
    cancellation.throwIfCancelled(taskId);
    const filename = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
    const startedAt = Date.now();
    try {
      const videoService = require('../videoService');
      const generated = await videoService.generateVideoClip({
        video_provider: model.provider_id,
        video_model: model.model_id,
        prompt,
        duration,
        outputDir: VIDEO_DIR,
        filename,
        image_url: imageUrl,
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        videoResolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        userId: ctx.user_id || '',
        agentId: VIDEO_STAGE,
      });
      cancellation.throwIfCancelled(taskId);
      if (!generated?.filePath || !fs.existsSync(generated.filePath)) throw new Error('视频供应商未生成可用文件');
      const normalizedPath = path.join(VIDEO_DIR, `${filename}_normalized.mp4`);
      await normalizeProviderClip({
        inputPath: generated.filePath,
        outputPath: normalizedPath,
        audioPath,
        durationSec: duration,
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
      });
      modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
      storage.saveModelCall({ task_id: taskId, stage: VIDEO_STAGE, provider_id: model.provider_id, model_id: model.model_id, status: 'success', latency_ms: Date.now() - startedAt, fallback_rank: attempts.length + 1 });
      return outputPayload(normalizedPath, {
        shot_index: index,
        index: index + 1,
        title: shot.title || `Shot ${index + 1}`,
        duration_sec: duration,
        provider_used: `${model.provider_id}/${model.model_id}`,
        image_source: imageUrl,
        motion_prompt: prompt,
        mode: 'provider_image_to_video',
        audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
        audio_muxed: !!audioPath,
        normalized: true,
        attempts,
      });
    } catch (error) {
      const classified = modelGateway.classifyError(error);
      modelGateway.recordHealth(model, { ok: false, error });
      storage.saveModelCall({ task_id: taskId, stage: VIDEO_STAGE, provider_id: model.provider_id, model_id: model.model_id, status: 'failed', error_code: error.code || classified.code, error_message: String(error.message || error).slice(0, 500), fallback_rank: attempts.length + 1 });
      attempts.push({
        provider_id: model.provider_id,
        model_id: model.model_id,
        code: error.code || classified.code,
        retryable: error.retryable === true || classified.retryable,
        error: String(error.message || error).slice(0, 500),
      });
    }
  }
  const error = new Error(`第 ${index + 1} 镜视频模型全部失败：${attempts.map(item => `${item.provider_id}/${item.model_id}: ${item.error}`).join('；')}`);
  error.code = attempts.some(item => item.retryable) ? 'VIDEO_ATTEMPTS_EXHAUSTED' : (attempts[0]?.code || 'VIDEO_MODEL_UNAVAILABLE');
  error.retryable = attempts.some(item => item.retryable);
  error.attempts = attempts;
  throw error;
}

async function generateShotVideo({ taskId = '', shot = {}, previousShot = null, keyframe = {}, audio = {}, contract = {}, ctx = {}, index = 0, options = {} } = {}) {
  const requestedDuration = Number(options.duration_sec || options.durationSec || shot.duration_sec || shot.duration || audio.duration_sec || 4);
  if (!Number.isFinite(requestedDuration) || requestedDuration < 1 || requestedDuration > 15) {
    const error = new Error(`第 ${index + 1} 镜时长必须在 1-15 秒之间，当前为 ${requestedDuration || 0} 秒`);
    error.code = 'SHOT_DURATION_UNSUPPORTED';
    error.retryable = false;
    throw error;
  }
  const duration = requestedDuration;
  try {
    return await generateProviderClip({ taskId, shot, previousShot, keyframe, audio, contract, ctx, index, duration, options });
  } catch (error) {
    if (error?.code === 'USER_CANCELLED' || error?.cancelled === true) throw error;
    const allowLocalFallback = options.allow_local_fallback === true
      || options.allowLocalFallback === true
      || process.env.NEW_STORY_AD_ALLOW_LOCAL_VIDEO_FALLBACK === '1';
    if (!allowLocalFallback) throw error;
    const base = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
    const out = path.join(VIDEO_DIR, `${base}.mp4`);
    const imagePath = localImagePath(keyframe.image_url || keyframe.imageUrl || keyframe.url || '');
    const audioPath = localAudioPath(audio.audio_url || audio.audioUrl || audio.url || '');
    await renderLocalClip({ outputPath: out, imagePath, audioPath, durationSec: duration, aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16' });
    return outputPayload(out, {
      shot_index: index,
      index: index + 1,
      title: shot.title || `Shot ${index + 1}`,
      duration_sec: duration,
      provider_used: 'local-ffmpeg/explicit-fallback',
      image_source: imagePath ? (keyframe.image_url || keyframe.imageUrl || '') : '',
      audio_source: audioPath ? (audio.audio_url || audio.audioUrl || '') : '',
      motion_prompt: clipPrompt(shot, ctx, contract, previousShot),
      mode: imagePath ? 'still_keyframe_video' : 'placeholder_video',
      warning: String(error.message || error).slice(0, 500),
    });
  }
}

async function generateShotVideos({ taskId = '', shots = [], keyframes = [], ttsAudio = {}, contracts = [], ctx = {}, options = {}, onClip = null } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const clips = [];
  for (let i = 0; i < list.length; i += 1) {
    cancellation.throwIfCancelled(taskId);
    const clip = await generateShotVideo({
      taskId,
      shot: list[i],
      previousShot: i > 0 ? list[i - 1] : null,
      keyframe: keyframes[i] || {},
      audio: tracks[i] || {},
      contract: contracts[i] || {},
      ctx,
      index: i,
      options,
    });
    cancellation.throwIfCancelled(taskId);
    clips.push(clip);
    if (typeof onClip === 'function') await onClip(clip, clips.slice());
  }
  return { clips, provider_used: clips.find(item => item.provider_used)?.provider_used || '' };
}

module.exports = {
  VIDEO_DIR,
  VIDEO_STAGE,
  absoluteAssetUrl,
  videoCandidates,
  videoPathFromName,
  publicVideoUrl,
  generateShotVideo,
  generateShotVideos,
  renderLocalClip,
  normalizeProviderClip,
  probeDuration,
};
