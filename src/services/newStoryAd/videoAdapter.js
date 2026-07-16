const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');
const shotDesign = require('./shotDesignService');
const modelGateway = require('./modelGateway');
const storage = require('./storageService');
const { continuityPrompt } = require('./continuityService');
const cancellation = require('./cancellationContext');
const personIdentity = require('./personIdentityContractService');
const deyunaiService = require('../deyunaiService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const VIDEO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-videos');
const VIDEO_STAGE = 'new_story_ad.video';
const VIDEO_MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.NEW_STORY_AD_VIDEO_MAX_CANDIDATES) || 4));

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
  if (key === '21:9') return { width: 1680, height: 720 };
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
    const signal = cancellation.signal();
    const abort = () => child.kill('SIGKILL');
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
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
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('FFmpeg aborted'));
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

function clipPrompt(shot = {}, ctx = {}, contract = {}, previousShot = null, keyframe = {}) {
  const design = shotDesign.normalizeShotDesign(shot);
  const authoredEffectTarget = !!(design.motion_effect?.target_state || design.motion_effect?.reference_asset_id);
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  return [
    `Advertised subject: ${ctx.product_subject || ''}`,
    `Shot purpose: ${shot.purpose || shot.role || ''}`,
    `Visible frame: ${shot.visual || shot.visual_description || shot.content_prompt || ''}`,
    `Required movement: ${shot.action || shot.visual_action || ''}`,
    `Camera: ${shot.camera || shot.camera_movement || contract.camera_strategy || ''}`,
    continuityPrompt(shot, previousShot),
    shotDesign.surfacePrompt(design.surface_topology, design.shot_scope),
    shotDesign.motionEffectPrompt(design.motion_effect),
    humanApproved
      ? `Human-approved keyframe is authoritative for the starting composition and visible scene/material structure. Preserve its intentional seams, panel layout, crop and subject presence exactly; do not "correct" them because of older automated observations. Approval note: ${keyframe.qa?.override_reason || keyframe.manual_acceptance?.reason || 'user approved the current visual'}.`
      : '',
    'Animate the supplied keyframe only. Preserve the current subject identity, wardrobe, product, materials, scene geometry and lighting.',
    authoredEffectTarget
      ? 'Use physically plausible motion and camera movement. The explicitly authored effect target is allowed; do not add any other people, objects, text, logos, products or locations.'
      : 'Use physically plausible motion and camera movement. Do not add unrelated people, objects, text, logos, products or locations.',
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

function videoCandidates(options = {}, { includeCircuitOpen = false } = {}) {
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
    .filter(model => includeCircuitOpen || !modelGateway.healthState(model).circuit_open)
    .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999) || modelGateway.getHealthScore(b) - modelGateway.getHealthScore(a))
    .slice(0, VIDEO_MAX_CANDIDATES);
}

function modelRoute(model = {}) {
  return `${String(model.provider_id || '').trim().toLowerCase()}/${String(model.model_id || '').trim().toLowerCase()}`;
}

function clipRoute(clip = {}) {
  return String(clip.provider_used || clip.providerUsed || '').trim().toLowerCase();
}

function resolvePinnedVideoModel(options = {}, existingClips = []) {
  const configured = videoCandidates(options, { includeCircuitOpen: true });
  const existingRoutes = [...new Set((Array.isArray(existingClips) ? existingClips : [])
    .filter(clip => clip?.video_url || clip?.videoUrl || clip?.file_path)
    .map(clipRoute)
    .filter(route => route && !route.startsWith('local-ffmpeg/')))];
  if (existingRoutes.length > 1) {
    const error = new Error(`当前任务已混用多个视频模型（${existingRoutes.join('、')}），为避免人物和画风继续漂移，请先清空旧视频后统一重做`);
    error.code = 'MIXED_VIDEO_PROVIDER_REQUIRES_RESET';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  if (!configured.length) {
    const error = new Error('new_story_ad.video 模型调用管理中没有可用且已配置的视频模型');
    error.code = 'VIDEO_MODEL_CONFIG_REQUIRED';
    error.retryable = false;
    throw error;
  }
  if (existingRoutes.length === 1) {
    const pinned = configured.find(candidate => modelRoute(candidate) === existingRoutes[0]);
    if (!pinned || modelGateway.healthState(pinned).circuit_open) {
      const error = new Error(`任务原视频模型 ${existingRoutes[0]} 当前不可用；为避免静默换模导致画风和人物变化，已停止生成`);
      error.code = 'PINNED_VIDEO_MODEL_UNAVAILABLE';
      error.retryable = true;
      throw error;
    }
    return pinned;
  }
  const allowFallback = options.allow_video_model_fallback === true || options.allowVideoModelFallback === true;
  if (allowFallback) {
    const available = configured.find(candidate => !modelGateway.healthState(candidate).circuit_open);
    if (available) return available;
  }
  const primary = configured[0];
  if (modelGateway.healthState(primary).circuit_open) {
    const error = new Error(`模型调用管理首选视频模型 ${modelRoute(primary)} 当前处于熔断状态；为避免未确认的模型降级，任务已停止`);
    error.code = 'PRIMARY_VIDEO_MODEL_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }
  return primary;
}

function deyunaiAssetGroupType(ctx = {}) {
  return ctx.person_asset?.real_person_reference === true || ctx.person_context?.real_person_locked === true
    ? 'LivenessFace'
    : 'AIGC';
}

function personReferenceUrl(ctx = {}) {
  const contract = ctx.person_contract || ctx.person_asset?.person_contract || {};
  const refs = contract.reference_views || {};
  return refs.front || Object.values(refs).find(Boolean) || ctx.person_asset?.image_url || ctx.person_asset?.url || '';
}

async function prepareDeyunaiPersonAsset({ taskId = '', ctx = {}, options = {} } = {}) {
  if (!personIdentity.personRequired(ctx)) return null;
  personIdentity.assertVerifiedPerson(ctx);
  const sourceUrl = absoluteAssetUrl(personReferenceUrl(ctx), options);
  if (!sourceUrl) {
    const error = new Error('人物合同没有可上传到漫路素材库的正面参考图');
    error.code = 'DEYUNAI_PERSON_REFERENCE_REQUIRED';
    error.status = 422;
    throw error;
  }
  const saved = storage.getOutput(taskId, 'deyunai_person_asset');
  const personKey = String(ctx.person_contract?.person_id || ctx.person_asset?.actor_id || ctx.person_asset?.id || taskId || 'person')
    .replace(/[^a-z0-9_.-]+/ig, '_')
    .slice(0, 42);
  const personRevision = ctx.person_contract?.person_revision || 1;
  const selectedAssetId = String(ctx.person_asset?.deyunai_asset_id || '').trim();
  const selectedStatus = String(ctx.person_asset?.deyunai_asset_status || '').trim();
  const existing = selectedAssetId && /^active$/i.test(selectedStatus)
    ? {
      asset_id: selectedAssetId,
      status: 'Active',
      source_url: sourceUrl,
      group_id: ctx.person_asset?.deyunai_asset_group_id || '',
      group_type: ctx.person_asset?.deyunai_asset_group_type || deyunaiAssetGroupType(ctx),
    }
    : saved;
  const asset = await deyunaiService.ensurePersonImageAsset({
    sourceUrl,
    name: `vido_${personKey}_v${personRevision}`,
    groupName: `vido_person_${personKey}_v${personRevision}`,
    groupType: deyunaiAssetGroupType(ctx),
    groupId: ctx.person_asset?.deyunai_asset_group_id || '',
    projectName: options.deyunai_project_name || options.deyunaiProjectName || 'default',
    existing,
    signal: cancellation.signal(),
  });
  storage.saveOutput(taskId, 'deyunai_person_asset', asset);
  return asset;
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
  const pinnedModel = options._pinnedVideoModel;
  if (!pinnedModel) {
    const error = new Error('new_story_ad.video 当前没有未熔断的真实视频模型，已立即停止本阶段');
    error.code = 'VIDEO_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const candidates = [pinnedModel];
  const imageUrl = absoluteAssetUrl(keyframe.image_url || keyframe.imageUrl || keyframe.url || '', options);
  if (!imageUrl) throw new Error(`第 ${index + 1} 镜缺少关键帧，不能提交图生视频`);
  const prompt = clipPrompt(shot, ctx, contract, previousShot, keyframe);
  const personReferenceAsset = options._deyunaiPersonAsset?.asset_url
    && personIdentity.shotPersonRequired(ctx, shot, contract)
    ? options._deyunaiPersonAsset.asset_url
    : '';
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
        // Seedance forbids mixing first_frame with reference media. Person
        // shots use the verified private-library asset only; non-person shots
        // retain the exact approved keyframe as first_frame.
        image_url: personReferenceAsset ? undefined : imageUrl,
        reference_image_urls: personReferenceAsset ? [personReferenceAsset] : [],
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        videoResolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        userId: ctx.user_id || '',
        agentId: VIDEO_STAGE,
        signal: cancellation.signal(),
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
        mode: personReferenceAsset ? 'provider_person_reference_video' : 'provider_image_to_video',
        seedance_input_mode: personReferenceAsset ? 'verified_person_reference' : 'approved_keyframe_first_frame',
        audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
        audio_muxed: !!audioPath,
        normalized: true,
        attempts,
      });
    } catch (error) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
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
      motion_prompt: clipPrompt(shot, ctx, contract, previousShot, keyframe),
      mode: imagePath ? 'still_keyframe_video' : 'placeholder_video',
      warning: String(error.message || error).slice(0, 500),
    });
  }
}

async function generateShotVideos({ taskId = '', shots = [], keyframes = [], ttsAudio = {}, contracts = [], ctx = {}, options = {}, existingClips = [], onClip = null } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const clips = Array.isArray(existingClips) ? existingClips.slice() : [];
  const pinnedModel = resolvePinnedVideoModel(options, clips);
  const isDeyunaiSeedance = String(pinnedModel.provider_id || '').toLowerCase() === 'deyunai'
    && /^doubao-seedance-2-0/i.test(String(pinnedModel.model_id || ''));
  if (personIdentity.personRequired(ctx) && !isDeyunaiSeedance) {
    const error = new Error(`人物广告必须使用支持人物素材库锁定的漫路 Seedance 2.0；当前候选 ${modelRoute(pinnedModel)} 不满足要求，已禁止降级`);
    error.code = 'PERSON_ASSET_VIDEO_MODEL_REQUIRED';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const hasPersonShot = list.some((shot, index) => personIdentity.shotPersonRequired(ctx, shot, contracts[index] || {}));
  const deyunaiPersonAsset = isDeyunaiSeedance && hasPersonShot
    ? await prepareDeyunaiPersonAsset({ taskId, ctx, options })
    : null;
  const runOptions = { ...options, _pinnedVideoModel: pinnedModel, _deyunaiPersonAsset: deyunaiPersonAsset };
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex)) ? Math.max(0, Math.min(list.length - 1, Number(options.only_index ?? options.onlyIndex))) : null;
  const indexes = onlyIndex === null ? list.map((_, index) => index) : [onlyIndex];
  const targetIndexes = options.missing_only === true || options.missingOnly === true
    ? indexes.filter(index => !(clips[index]?.video_url || clips[index]?.videoUrl || clips[index]?.file_path) || !!clips[index]?.error_code)
    : indexes;
  for (const i of targetIndexes) {
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
      options: runOptions,
    });
    cancellation.throwIfCancelled(taskId);
    clips[i] = clip;
    if (typeof onClip === 'function') await onClip(clip, clips.slice());
  }
  return {
    clips,
    provider_used: modelRoute(pinnedModel),
    pinned_model: pinnedModel,
    deyunai_person_asset: deyunaiPersonAsset,
    target_indexes: targetIndexes,
  };
}

module.exports = {
  VIDEO_DIR,
  VIDEO_STAGE,
  absoluteAssetUrl,
  videoCandidates,
  resolvePinnedVideoModel,
  deyunaiAssetGroupType,
  personReferenceUrl,
  prepareDeyunaiPersonAsset,
  videoPathFromName,
  publicVideoUrl,
  generateShotVideo,
  generateShotVideos,
  renderLocalClip,
  normalizeProviderClip,
  clipPrompt,
  probeDuration,
};
