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
const videoScheduler = require('./videoParallelScheduler');
const videoLineage = require('./videoLineageService');
const sceneBlockService = require('./sceneBlockService');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs'));
const VIDEO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-videos');
const VIDEO_STAGE = 'new_story_ad.video';
const VIDEO_MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.NEW_STORY_AD_VIDEO_MAX_CANDIDATES) || 4));
const VIDEO_SHOT_STATUS_PREFIX = 'video_shot_status_';

function videoShotStatusKind(index = 0) {
  return `${VIDEO_SHOT_STATUS_PREFIX}${Math.max(0, Number(index) || 0) + 1}`;
}

function listVideoShotStatuses(taskId = '', total = 0) {
  const count = Math.max(0, Number(total) || 0);
  if (count) return Array.from({ length: count }, (_, index) => storage.getOutput(taskId, videoShotStatusKind(index)) || null);
  return storage.listOutputs(taskId)
    .filter(row => String(row.kind || '').startsWith(VIDEO_SHOT_STATUS_PREFIX))
    .sort((a, b) => Number(String(a.kind).slice(VIDEO_SHOT_STATUS_PREFIX.length)) - Number(String(b.kind).slice(VIDEO_SHOT_STATUS_PREFIX.length)))
    .map(row => row.payload || null);
}

function updateVideoProgress(taskId = '', total = 0, extra = {}) {
  const statuses = listVideoShotStatuses(taskId, total);
  const task = storage.getTask(taskId) || {};
  const previous = task.generation_progress?.stage === 'video' ? task.generation_progress : {};
  const generationId = String(extra.generation_id || task.active_generation_id || previous.generation_id || '');
  const generationChanged = generationId && generationId !== String(previous.generation_id || '');
  const now = new Date().toISOString();
  const terminal = new Set(['qa_passed', 'qa_failed', 'failed', 'cancelled']);
  const active = new Set(['queued', 'submitting', 'provider_submitted', 'provider_running', 'downloading', 'normalizing', 'generated', 'video_qa']);
  const progress = {
    ...previous,
    stage: 'video',
    status: 'running',
    generation_id: generationId,
    started_at: generationChanged
      ? (task.generation_started_at || task.generation_queued_at || now)
      : (previous.started_at || task.generation_started_at || task.generation_queued_at || now),
    updated_at: now,
    total: Math.max(Number(total) || 0, statuses.length),
    queued: statuses.filter(item => item?.lifecycle === 'queued').length,
    active: statuses.filter(item => active.has(item?.lifecycle)).length,
    generated: statuses.filter(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item?.lifecycle)).length,
    qa_passed: statuses.filter(item => item?.lifecycle === 'qa_passed').length,
    failed: statuses.filter(item => ['qa_failed', 'failed'].includes(item?.lifecycle)).length,
    completed: statuses.filter(item => terminal.has(item?.lifecycle)).length,
    active_indexes: statuses.filter(item => active.has(item?.lifecycle)).map(item => Number(item.index || 0)).filter(Boolean),
    last_heartbeat_at: statuses.map(item => item?.last_heartbeat_at || '').filter(Boolean).sort().slice(-1)[0] || '',
    ...extra,
  };
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

function updateVideoShotStatus(taskId = '', index = 0, patch = {}, total = 0) {
  const kind = videoShotStatusKind(index);
  const previous = storage.getOutput(taskId, kind) || {};
  const now = new Date().toISOString();
  const lifecycle = patch.lifecycle || previous.lifecycle || 'pending';
  const health = ['qa_passed'].includes(lifecycle) ? 'passed'
    : (['qa_failed', 'failed', 'cancelled'].includes(lifecycle) ? 'failed' : 'running');
  const next = {
    ...previous,
    ...patch,
    shot_index: index,
    index: index + 1,
    lifecycle,
    health,
    queued_at: patch.queued_at || previous.queued_at || (lifecycle === 'queued' ? now : ''),
    started_at: Object.prototype.hasOwnProperty.call(patch, 'started_at')
      ? patch.started_at
      : (previous.started_at || (['submitting', 'provider_submitted', 'provider_running'].includes(lifecycle) ? now : '')),
    finished_at: ['qa_passed', 'qa_failed', 'failed', 'cancelled'].includes(lifecycle) ? (patch.finished_at || now) : '',
    last_heartbeat_at: patch.last_heartbeat_at || now,
    updated_at: now,
  };
  storage.saveOutput(taskId, kind, next);
  updateVideoProgress(taskId, total || next.total_shots || 0);
  return next;
}

function explicitShotSpeechMode(shot = {}, contract = {}) {
  const raw = String(
    shot.speech_mode || shot.speechMode || shot.on_screen_speech_mode || contract.speech_mode || contract.speechMode || '',
  ).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['on_camera', 'on_camera_dialogue', 'visible_dialogue', 'speaking', 'lip_sync'].includes(raw)) return 'on_camera_dialogue';
  if (['silent', 'mute', 'no_speech'].includes(raw)) return 'silent';
  return 'offscreen_voiceover';
}

function speechPrompt(shot = {}, contract = {}) {
  const mode = explicitShotSpeechMode(shot, contract);
  if (mode === 'on_camera_dialogue') {
    return 'Speech mode: explicitly authored on-camera dialogue. The visible speaker may speak naturally; do not make any other person speak.';
  }
  if (mode === 'silent') {
    return 'Speech mode: silent. Every visible person keeps a relaxed closed mouth and natural non-speaking expression. No talking or lip movement.';
  }
  return 'Speech mode: off-screen voiceover. Visible people do not speak or lip-sync to the narration; keep a relaxed closed mouth and natural non-speaking expression.';
}

function hardVideoDependency(shot = {}, contract = {}, index = 0) {
  if (index <= 0) return null;
  const lock = contract?.continuity_lock || shot.continuity || {};
  const transition = String(lock.transition_type || shot.transition_type || '').trim().toLowerCase();
  const required = lock.requires_previous_frame === true || shot.requires_previous_frame === true || shot.requiresPreviousFrame === true;
  return required || /match|cut.?on.?action|continuous|动作接续|状态接续|连续/i.test(transition) ? index - 1 : null;
}

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

async function normalizeProviderClip({ inputPath, outputPath, audioPath = '', durationSec = 4, startSec = 0, aspectRatio = '9:16', resolution = '720p' } = {}) {
  ensureDir(path.dirname(outputPath));
  const { width, height } = outputSize(aspectRatio, resolution);
  const duration = clamp(durationSec, 1, 15, 4);
  const args = ['-y'];
  if (Number(startSec) > 0) args.push('-ss', String(Math.max(0, Number(startSec) || 0)));
  args.push('-i', inputPath);
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

function clipPrompt(shot = {}, ctx = {}, contract = {}, previousShot = null, keyframe = {}, repairInstruction = '') {
  const design = shotDesign.normalizeShotDesign(shot);
  const authoredEffectTarget = !!(design.motion_effect?.target_state || design.motion_effect?.reference_asset_id);
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  const currentKeyframeAccepted = !!(keyframe.image_url || keyframe.imageUrl || keyframe.url)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || keyframe.contract_fingerprint === contract.contract_fingerprint);
  return [
    `Advertised subject: ${ctx.product_subject || ''}`,
    `Shot purpose: ${shot.purpose || shot.role || ''}`,
    `Visible frame: ${shot.visual || shot.visual_description || shot.content_prompt || ''}`,
    `Required movement: ${shot.action || shot.visual_action || ''}`,
    `Camera: ${shot.camera || shot.camera_movement || contract.camera_strategy || ''}`,
    continuityPrompt(shot, previousShot),
    speechPrompt(shot, contract),
    shotDesign.surfacePrompt(design.surface_topology, design.shot_scope),
    shotDesign.motionEffectPrompt(design.motion_effect),
    currentKeyframeAccepted
      ? `The current approved keyframe is authoritative for starting composition, scene geometry, material topology, seams, crop and subject placement. Preserve what is visibly present in that keyframe and do not rebuild the wall, ceiling, floor, furniture or panel structure from older scene observations.${humanApproved ? ` Human approval note: ${keyframe.qa?.override_reason || keyframe.manual_acceptance?.reason || 'user approved the current visual'}.` : ''}`
      : '',
    'Animate the supplied keyframe only. Preserve the current subject identity, wardrobe, product, materials, scene geometry and lighting.',
    authoredEffectTarget
      ? 'Use physically plausible motion and camera movement. The explicitly authored effect target is allowed; do not add any other people, objects, text, logos, products or locations.'
      : 'Use physically plausible motion and camera movement. Do not add unrelated people, objects, text, logos, products or locations.',
    repairInstruction ? `QA repair instruction for this attempt:\n${repairInstruction}` : '',
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

async function prepareDeyunaiSceneReferenceAssets({ taskId = '', block = {}, options = {} } = {}) {
  const sources = (Array.isArray(block.spatial_reference_urls) ? block.spatial_reference_urls : [])
    .map(url => absoluteAssetUrl(url, options))
    .filter(Boolean)
    .slice(0, 1);
  if (!sources.length) return [];
  const saved = storage.getOutput(taskId, 'deyunai_scene_reference_assets') || {};
  const next = { ...saved };
  const assets = [];
  for (let index = 0; index < sources.length; index += 1) {
    const sourceUrl = sources[index];
    const key = `${block.scene_identity || block.id || 'scene'}:${index}`;
    const safeKey = safeBase(key).slice(0, 42);
    const asset = await deyunaiService.ensurePersonImageAsset({
      sourceUrl,
      assetKind: 'scene',
      name: `vido_scene_${safeKey}`,
      groupName: `vido_scene_${safeKey}`,
      groupType: 'AIGC',
      projectName: options.deyunai_project_name || options.deyunaiProjectName || 'default',
      existing: next[key] || null,
      signal: cancellation.signal(),
    });
    next[key] = asset;
    assets.push(asset);
  }
  storage.saveOutput(taskId, 'deyunai_scene_reference_assets', next);
  return assets;
}

async function prepareDeyunaiKeyframeReferenceAsset({ taskId = '', index = 0, keyframe = {}, options = {} } = {}) {
  const sourceUrl = absoluteAssetUrl(keyframe.image_url || keyframe.imageUrl || keyframe.url || '', options);
  if (!sourceUrl) return null;
  const saved = storage.getOutput(taskId, 'deyunai_keyframe_reference_assets') || {};
  const identity = safeBase(`${index + 1}_${keyframe.current_generation_id || keyframe.generation_id || keyframe.contract_fingerprint || path.basename(sourceUrl)}`).slice(0, 52);
  const asset = await deyunaiService.ensurePersonImageAsset({
    sourceUrl,
    assetKind: 'scene',
    name: `vido_keyframe_${identity}`,
    groupName: `vido_keyframe_${identity}`,
    groupType: 'AIGC',
    projectName: options.deyunai_project_name || options.deyunaiProjectName || 'default',
    existing: saved[identity] || null,
    signal: cancellation.signal(),
  });
  storage.saveOutput(taskId, 'deyunai_keyframe_reference_assets', { ...saved, [identity]: asset });
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

function updateGenerationUnitStatus(taskId = '', index = 0, patch = {}, total = 0, options = {}) {
  const members = Array.isArray(options._sceneBlock?.member_indexes) && options._sceneBlock.member_indexes.length
    ? options._sceneBlock.member_indexes
    : [index];
  return members.map(member => updateVideoShotStatus(taskId, member, {
    ...patch,
    title: options._sceneBlockShotTitles?.[member] || patch.title,
    scene_block_id: options._sceneBlock?.id || patch.scene_block_id || '',
    scene_block_members: options._sceneBlock?.member_indexes?.map(value => value + 1) || patch.scene_block_members || [],
  }, total));
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
  const prompt = String(options._promptOverride || '').trim()
    || clipPrompt(shot, ctx, contract, previousShot, keyframe, options._repairInstructions?.[index] || '');
  const personReferenceAsset = options._deyunaiPersonAsset?.asset_url
    && personIdentity.shotPersonRequired(ctx, shot, contract)
    ? options._deyunaiPersonAsset.asset_url
    : '';
  const sceneReferenceAssets = personReferenceAsset
    ? [...new Set((Array.isArray(options._sceneReferenceAssetUrls) ? options._sceneReferenceAssetUrls : []).filter(Boolean))].slice(0, 2)
    : [];
  const audioPath = localAudioPath(audio?.audio_url || audio?.audioUrl || audio?.url || '');
  const audioDuration = await probeDuration(audioPath);
  if (audioDuration > duration + 0.35) {
    const error = new Error(`第 ${index + 1} 镜配音 ${audioDuration.toFixed(2)} 秒超过镜头 ${duration.toFixed(2)} 秒，请缩短台词或增加镜头时长`);
    error.code = 'AUDIO_DURATION_EXCEEDS_SHOT';
    error.retryable = false;
    throw error;
  }
  const attempts = [];
  const totalShots = Number(options._totalShots || 0);
  for (const model of candidates) {
    cancellation.throwIfCancelled(taskId);
    const filename = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
    const startedAt = Date.now();
    try {
      updateGenerationUnitStatus(taskId, index, {
        lifecycle: 'submitting',
        total_shots: totalShots,
        title: shot.title || `镜头 ${index + 1}`,
        provider_id: model.provider_id,
        model_id: model.model_id,
        input_mode: personReferenceAsset ? (sceneReferenceAssets.length ? 'verified_person_and_scene_reference' : 'verified_person_reference') : 'approved_keyframe_first_frame',
        scene_block_id: options._sceneBlock?.id || '',
        scene_block_members: options._sceneBlock?.member_indexes?.map(member => member + 1) || [],
        speech_mode: explicitShotSpeechMode(shot, contract),
        error: '',
        error_code: '',
      }, totalShots, options);
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
        reference_image_urls: personReferenceAsset ? [personReferenceAsset, ...sceneReferenceAssets] : [],
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        videoResolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
        userId: ctx.user_id || '',
        agentId: VIDEO_STAGE,
        signal: cancellation.signal(),
        onSubmitted: event => updateGenerationUnitStatus(taskId, index, {
          lifecycle: 'provider_submitted',
          provider_task_id: event.taskId || '',
          provider_status: event.status || 'submitted',
          provider_submitted_at: event.submittedAt || new Date().toISOString(),
          last_polled_at: '',
        }, totalShots, options),
        onProgress: event => updateGenerationUnitStatus(taskId, index, {
          lifecycle: event.status === 'downloading' ? 'downloading' : 'provider_running',
          provider_task_id: event.taskId || storage.getOutput(taskId, videoShotStatusKind(index))?.provider_task_id || '',
          provider_status: event.status || 'polling',
          provider_elapsed_ms: Number(event.elapsedMs || 0),
          last_polled_at: event.polledAt || new Date().toISOString(),
          provider_has_output_url: event.hasOutputUrl === true,
        }, totalShots, options),
      });
      cancellation.throwIfCancelled(taskId);
      if (!generated?.filePath || !fs.existsSync(generated.filePath)) throw new Error('视频供应商未生成可用文件');
      updateGenerationUnitStatus(taskId, index, {
        lifecycle: 'normalizing',
        provider_task_id: generated.providerTaskId || storage.getOutput(taskId, videoShotStatusKind(index))?.provider_task_id || '',
        provider_status: 'succeeded',
        source_file_path: generated.filePath,
        source_file_exists: true,
      }, totalShots, options);
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
      updateGenerationUnitStatus(taskId, index, {
        lifecycle: 'generated',
        provider_task_id: generated.providerTaskId || storage.getOutput(taskId, videoShotStatusKind(index))?.provider_task_id || '',
        provider_status: 'succeeded',
        provider_elapsed_ms: Date.now() - startedAt,
        file_path: normalizedPath,
        file_exists: fs.existsSync(normalizedPath),
        video_url: publicVideoUrl(path.basename(normalizedPath)),
      }, totalShots, options);
      return outputPayload(normalizedPath, {
        shot_index: index,
        index: index + 1,
        title: shot.title || `Shot ${index + 1}`,
        duration_sec: duration,
        provider_used: `${model.provider_id}/${model.model_id}`,
        provider_task_id: generated.providerTaskId || '',
        image_source: imageUrl,
        motion_prompt: prompt,
        mode: options._sceneBlock?.continuous ? 'provider_continuous_scene_block' : (personReferenceAsset ? 'provider_person_reference_video' : 'provider_image_to_video'),
        seedance_input_mode: personReferenceAsset ? (sceneReferenceAssets.length ? 'verified_person_and_scene_reference' : 'verified_person_reference') : 'approved_keyframe_first_frame',
        scene_block_id: options._sceneBlock?.id || '',
        scene_block_fingerprint: options._sceneBlock?.fingerprint || '',
        scene_block_members: options._sceneBlock?.member_indexes?.map(member => member + 1) || [],
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
  updateGenerationUnitStatus(taskId, index, {
    lifecycle: 'failed',
    total_shots: totalShots,
    error: String(error.message || error).slice(0, 1000),
    error_code: error.code || 'VIDEO_MODEL_UNAVAILABLE',
    retryable: error.retryable === true,
  }, totalShots, options);
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
    updateVideoShotStatus(taskId, index, {
      lifecycle: 'generated',
      provider_id: 'local-ffmpeg',
      model_id: 'explicit-fallback',
      provider_status: 'succeeded',
      file_path: out,
      file_exists: fs.existsSync(out),
      video_url: publicVideoUrl(path.basename(out)),
      warning: String(error.message || error).slice(0, 500),
      error: '',
      error_code: '',
    }, Number(options._totalShots || 0));
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
  const runOptions = { ...options, _pinnedVideoModel: pinnedModel, _deyunaiPersonAsset: deyunaiPersonAsset, _totalShots: list.length };
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex)) ? Math.max(0, Math.min(list.length - 1, Number(options.only_index ?? options.onlyIndex))) : null;
  const requestedIndexes = Array.isArray(options.only_indexes || options.onlyIndexes)
    ? (options.only_indexes || options.onlyIndexes).map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < list.length)
    : null;
  const indexes = requestedIndexes?.length ? [...new Set(requestedIndexes)] : (onlyIndex === null ? list.map((_, index) => index) : [onlyIndex]);
  const targetIndexes = options.missing_only === true || options.missingOnly === true
    ? indexes.filter(index => !(clips[index]?.video_url || clips[index]?.videoUrl || clips[index]?.file_path) || !!clips[index]?.error_code)
    : indexes;
  targetIndexes.forEach(index => updateVideoShotStatus(taskId, index, {
    lifecycle: 'queued',
    queued_at: new Date().toISOString(),
    started_at: '',
    attempt_number: Number(storage.getOutput(taskId, videoShotStatusKind(index))?.attempt_number || 0) + 1,
    total_shots: list.length,
    title: list[index]?.title || `镜头 ${index + 1}`,
    provider_id: pinnedModel.provider_id,
    model_id: pinnedModel.model_id,
    speech_mode: explicitShotSpeechMode(list[index] || {}, contracts[index] || {}),
    dependency_index: hardVideoDependency(list[index] || {}, contracts[index] || {}, index),
    previous_provider_task_id: storage.getOutput(taskId, videoShotStatusKind(index))?.provider_task_id || '',
    provider_task_id: '',
    provider_status: '',
    provider_submitted_at: '',
    last_polled_at: '',
    file_path: '',
    file_exists: false,
    video_url: '',
    qa_status: '',
    qa_problems: [],
    error: '',
    error_code: '',
    repair_attempt: Number(options._repairAttempt || 0),
    pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
    lineage_fingerprint: options._expectedLineages?.[index]?.fingerprint || '',
  }, list.length));

  let schedule = {
    results: [], waves: [], configured_concurrency: 1, effective_concurrency: 1,
    max_concurrency: 1, throttle_retries: {},
  };
  if (targetIndexes.length) {
    try {
      schedule = await videoScheduler.runSchedule({
      indexes: targetIndexes,
      options,
      signal: cancellation.signal(),
      dependencyOf: index => hardVideoDependency(list[index] || {}, contracts[index] || {}, index),
      onWaveStart: wave => {
        updateVideoProgress(taskId, list.length, {
          configured_concurrency: wave.configured_concurrency,
          effective_concurrency: wave.concurrency,
          max_concurrency: wave.max_concurrency,
          current_wave: wave.wave_number,
          wave_indexes: wave.indexes.map(index => index + 1),
          scheduler: 'adaptive_controlled_parallel',
        });
      },
      onWaveComplete: wave => {
        storage.saveStage(taskId, 'video', {
          status: 'running',
          input_summary: `${list.length} shot videos`,
          output_summary: `${clips.filter(Boolean).length}/${list.length} video clips`,
          diagnostics: {
            provider_used: modelRoute(pinnedModel),
            configured_concurrency: wave.configured_concurrency,
            effective_concurrency: wave.next_concurrency,
            max_concurrency: wave.max_concurrency,
            last_wave: wave,
          },
        });
      },
      worker: async (i, wave) => {
        cancellation.throwIfCancelled(taskId);
        updateVideoShotStatus(taskId, i, {
          lifecycle: 'queued',
          scheduler_wave: wave.wave_number,
          scheduler_concurrency: wave.concurrency,
          global_queue_ms: wave.global_queue_ms || 0,
        }, list.length);
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
        clips[i] = options._expectedLineages?.[i]
          ? videoLineage.attachLineage(clip, options._expectedLineages[i], { repair_attempt: Number(options._repairAttempt || 0) })
          : clip;
        if (typeof onClip === 'function') await onClip(clip, clips.slice());
        return clip;
      },
      });
    } catch (error) {
      const cancelled = error?.code === 'USER_CANCELLED' || error?.cancelled === true || cancellation.signal()?.aborted;
      targetIndexes.forEach(index => {
        const current = storage.getOutput(taskId, videoShotStatusKind(index)) || {};
        if (['qa_passed', 'qa_failed', 'failed', 'cancelled'].includes(current.lifecycle)) return;
        if (!cancelled && videoLineage.clipHasUsableFile(clips[index])) {
          updateVideoShotStatus(taskId, index, {
            lifecycle: 'generated',
            batch_status: 'partial_success_pending_qa',
            error: '',
            error_code: '',
            retryable: false,
          }, list.length);
          return;
        }
        updateVideoShotStatus(taskId, index, {
          lifecycle: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? '任务已取消' : '同批次镜头失败，当前镜头未继续提交',
          error_code: cancelled ? 'USER_CANCELLED' : 'VIDEO_BATCH_ABORTED',
          retryable: !cancelled && error?.retryable === true,
        }, list.length);
      });
      storage.saveOutput(taskId, 'video_clips', clips);
      error.partial_video_clips = clips.slice();
      error.completed_indexes = targetIndexes.filter(index => videoLineage.clipHasUsableFile(clips[index]));
      error.failed_indexes = targetIndexes.filter(index => !videoLineage.clipHasUsableFile(clips[index]));
      error.target_indexes = targetIndexes.slice();
      throw error;
    }
    updateVideoProgress(taskId, list.length, {
      configured_concurrency: schedule.configured_concurrency,
      effective_concurrency: schedule.effective_concurrency,
      max_concurrency: schedule.max_concurrency,
      scheduler: 'adaptive_controlled_parallel',
      schedule_waves: schedule.waves.map(wave => ({
        wave_number: wave.wave_number,
        indexes: wave.indexes.map(index => index + 1),
        concurrency: wave.concurrency,
        duration_ms: wave.duration_ms || 0,
        throttled: wave.throttled === true,
      })),
    });
  }
  return {
    clips,
    provider_used: modelRoute(pinnedModel),
    pinned_model: pinnedModel,
    deyunai_person_asset: deyunaiPersonAsset,
    target_indexes: targetIndexes,
    schedule,
  };
}

async function splitSceneBlockClip({ taskId = '', block = {}, sourceClip = {}, shots = [], tracks = [], ctx = {}, options = {} } = {}) {
  const output = [];
  for (const beat of block.beats || []) {
    cancellation.throwIfCancelled(taskId);
    const index = Number(beat.shot_index || 1) - 1;
    const audio = tracks[index] || {};
    const audioPath = localAudioPath(audio.audio_url || audio.audioUrl || audio.url || '');
    const audioDuration = await probeDuration(audioPath);
    if (audioDuration > Number(beat.duration_sec || 0) + 0.35) {
      const error = new Error(`第 ${index + 1} 镜配音 ${audioDuration.toFixed(2)} 秒超过连续场景段分配时长 ${Number(beat.duration_sec || 0).toFixed(2)} 秒`);
      error.code = 'AUDIO_DURATION_EXCEEDS_SHOT';
      error.retryable = false;
      throw error;
    }
    const filename = safeBase(`nsa_${taskId || 'task'}_block_${block.first_index + 1}_${block.last_index + 1}_shot_${index + 1}_${Date.now()}`);
    const filePath = path.join(VIDEO_DIR, `${filename}.mp4`);
    await normalizeProviderClip({
      inputPath: sourceClip.file_path,
      outputPath: filePath,
      audioPath,
      startSec: beat.start_sec,
      durationSec: beat.duration_sec,
      aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
      resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
    });
    output.push(outputPayload(filePath, {
      ...sourceClip,
      filename: path.basename(filePath),
      file_path: filePath,
      video_url: publicVideoUrl(path.basename(filePath)),
      videoUrl: publicVideoUrl(path.basename(filePath)),
      shot_index: index,
      index: index + 1,
      title: shots[index]?.title || `Shot ${index + 1}`,
      duration_sec: beat.duration_sec,
      scene_block_id: block.id,
      scene_block_fingerprint: block.fingerprint,
      scene_block_members: block.member_indexes.map(member => member + 1),
      scene_block_source_file: sourceClip.file_path,
      scene_block_source_video_url: sourceClip.video_url || '',
      scene_block_start_sec: beat.start_sec,
      scene_block_end_sec: beat.end_sec,
      mode: 'continuous_scene_block_segment',
      audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
      audio_muxed: !!audioPath,
    }));
  }
  return output;
}

async function generateSceneBlockVideos({ taskId = '', shots = [], keyframes = [], ttsAudio = {}, contracts = [], sceneBlocks = [], ctx = {}, options = {}, existingClips = [], onClip = null } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const blocks = Array.isArray(sceneBlocks) && sceneBlocks.length ? sceneBlocks : sceneBlockService.buildSceneBlocks(list, contracts, options);
  const clips = Array.isArray(existingClips) ? existingClips.slice() : [];
  const pinnedModel = options._pinnedVideoModel || resolvePinnedVideoModel(options, clips);
  const isDeyunaiSeedance = String(pinnedModel.provider_id || '').toLowerCase() === 'deyunai'
    && /^doubao-seedance-2-0/i.test(String(pinnedModel.model_id || ''));
  if (personIdentity.personRequired(ctx) && !isDeyunaiSeedance) {
    const error = new Error(`人物广告必须使用支持人物素材库锁定的漫路 Seedance 2.0；当前候选 ${modelRoute(pinnedModel)} 不满足要求，已禁止降级`);
    error.code = 'PERSON_ASSET_VIDEO_MODEL_REQUIRED';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const requested = Array.isArray(options.only_indexes || options.onlyIndexes)
    ? (options.only_indexes || options.onlyIndexes).map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < list.length)
    : list.map((_, index) => index);
  const targetIndexes = sceneBlockService.expandIndexesToBlocks(requested, blocks);
  const units = blocks.filter(block => block.member_indexes.some(index => targetIndexes.includes(index)));
  const hasPersonUnit = units.some(block => personIdentity.shotPersonRequired(ctx, sceneBlockService.generationShot(block, list), contracts[block.first_index] || {}));
  const deyunaiPersonAsset = isDeyunaiSeedance && hasPersonUnit
    ? await prepareDeyunaiPersonAsset({ taskId, ctx, options })
    : null;
  const shotTitles = Object.fromEntries(list.map((shot, index) => [index, shot.title || `镜头 ${index + 1}`]));
  const unitGenerator = typeof options._generateShotVideo === 'function' ? options._generateShotVideo : generateShotVideo;
  targetIndexes.forEach((index) => {
    const block = sceneBlockService.blockForIndex(blocks, index);
    updateVideoShotStatus(taskId, index, {
      lifecycle: 'queued', queued_at: new Date().toISOString(), started_at: '',
      attempt_number: Number(storage.getOutput(taskId, videoShotStatusKind(index))?.attempt_number || 0) + 1,
      total_shots: list.length, title: shotTitles[index], provider_id: pinnedModel.provider_id, model_id: pinnedModel.model_id,
      speech_mode: explicitShotSpeechMode(list[index] || {}, contracts[index] || {}),
      scene_block_id: block?.id || '', scene_block_members: block?.member_indexes?.map(member => member + 1) || [index + 1],
      scene_block_duration_sec: block?.duration_sec || sceneBlockService.durationOf(list[index] || {}),
      provider_task_id: '', provider_status: '', file_path: '', file_exists: false, video_url: '', qa_status: '', qa_problems: [], error: '', error_code: '',
      repair_attempt: Number(options._repairAttempt || 0), pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
      lineage_fingerprint: options._expectedLineages?.[index]?.fingerprint || '',
    }, list.length);
  });
  let schedule = { results: [], waves: [], configured_concurrency: 1, effective_concurrency: 1, max_concurrency: 1, throttle_retries: {} };
  if (units.length) {
    try {
      schedule = await videoScheduler.runSchedule({
      indexes: units.map((_, index) => index), options, signal: cancellation.signal(), dependencyOf: () => null,
      onWaveStart: wave => updateVideoProgress(taskId, list.length, {
        configured_concurrency: wave.configured_concurrency, effective_concurrency: wave.concurrency,
        max_concurrency: wave.max_concurrency, current_wave: wave.wave_number,
        wave_indexes: wave.indexes.flatMap(unitIndex => units[unitIndex].member_indexes.map(index => index + 1)),
        scheduler: 'adaptive_scene_block_parallel',
        scene_block_count: units.length,
        continuous_scene_block_count: units.filter(block => block.continuous).length,
      }),
      worker: async (unitIndex, wave) => {
        const block = units[unitIndex];
        const first = block.first_index;
        const syntheticShot = sceneBlockService.generationShot(block, list);
        const personRequired = personIdentity.shotPersonRequired(ctx, syntheticShot, contracts[first] || {});
        const sceneAssets = personRequired && block.continuous
          ? await prepareDeyunaiSceneReferenceAssets({ taskId, block, options })
          : [];
        const keyframeAsset = personRequired
          ? await prepareDeyunaiKeyframeReferenceAsset({ taskId, index: first, keyframe: keyframes[first] || {}, options })
          : null;
        block.member_indexes.forEach(index => updateVideoShotStatus(taskId, index, {
          lifecycle: 'queued', scheduler_wave: wave.wave_number, scheduler_concurrency: wave.concurrency,
          global_queue_ms: wave.global_queue_ms || 0,
        }, list.length));
        const runOptions = {
          ...options, _pinnedVideoModel: pinnedModel, _deyunaiPersonAsset: deyunaiPersonAsset, _totalShots: list.length,
          _sceneBlock: block, _sceneBlockShotTitles: shotTitles,
          _sceneReferenceAssetUrls: [keyframeAsset?.asset_url, ...sceneAssets.map(asset => asset.asset_url)].filter(Boolean),
          _promptOverride: block.continuous ? sceneBlockService.generationPrompt(block, list, contracts, options._repairInstructions || {}) : '',
        };
        const sourceClip = await unitGenerator({
          taskId, shot: block.continuous ? syntheticShot : list[first], previousShot: first > 0 ? list[first - 1] : null,
          keyframe: keyframes[first] || {}, audio: block.continuous ? {} : (tracks[first] || {}),
          contract: contracts[first] || {}, ctx, index: first, options: runOptions,
        });
        const generatedClips = block.continuous
          ? await splitSceneBlockClip({ taskId, block, sourceClip, shots: list, tracks, ctx, options: runOptions })
          : [{ ...sourceClip, scene_block_id: block.id, scene_block_fingerprint: block.fingerprint, scene_block_members: [first + 1] }];
        for (const generated of generatedClips) {
          const index = generated.shot_index;
          clips[index] = options._expectedLineages?.[index]
            ? videoLineage.attachLineage(generated, options._expectedLineages[index], { repair_attempt: Number(options._repairAttempt || 0) })
            : generated;
          updateVideoShotStatus(taskId, index, {
            lifecycle: 'generated', file_path: clips[index].file_path, file_exists: true,
            video_url: clips[index].video_url, scene_block_id: block.id,
            scene_block_fingerprint: block.fingerprint, scene_block_members: block.member_indexes.map(member => member + 1),
          }, list.length);
          if (typeof onClip === 'function') await onClip(clips[index], clips.slice());
        }
        return generatedClips;
      },
      });
    } catch (error) {
      const cancelled = error?.code === 'USER_CANCELLED' || error?.cancelled === true || cancellation.signal()?.aborted;
      targetIndexes.forEach((index) => {
        const current = storage.getOutput(taskId, videoShotStatusKind(index)) || {};
        if (['qa_passed', 'qa_failed', 'failed', 'cancelled'].includes(current.lifecycle)) return;
        if (!cancelled && videoLineage.clipHasUsableFile(clips[index])) {
          updateVideoShotStatus(taskId, index, {
            lifecycle: 'generated',
            batch_status: 'partial_success_pending_qa',
            error: '',
            error_code: '',
            retryable: false,
          }, list.length);
          return;
        }
        updateVideoShotStatus(taskId, index, {
          lifecycle: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? '任务已取消' : (current.error || '连续场景段生成未完成'),
          error_code: cancelled ? 'USER_CANCELLED' : (current.error_code || 'SCENE_BLOCK_GENERATION_FAILED'),
          retryable: error?.retryable === true,
        }, list.length);
      });
      storage.saveOutput(taskId, 'video_clips', clips);
      error.partial_video_clips = clips.slice();
      error.completed_indexes = targetIndexes.filter(index => videoLineage.clipHasUsableFile(clips[index]));
      error.failed_indexes = targetIndexes.filter(index => !videoLineage.clipHasUsableFile(clips[index]));
      error.target_indexes = targetIndexes.slice();
      throw error;
    }
  }
  updateVideoProgress(taskId, list.length, {
    configured_concurrency: schedule.configured_concurrency, effective_concurrency: schedule.effective_concurrency,
    max_concurrency: schedule.max_concurrency, scheduler: 'adaptive_scene_block_parallel',
    scene_block_count: units.length, continuous_scene_block_count: units.filter(block => block.continuous).length,
  });
  return { clips, provider_used: modelRoute(pinnedModel), pinned_model: pinnedModel, deyunai_person_asset: deyunaiPersonAsset, target_indexes: targetIndexes, scene_blocks: units, schedule };
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
  prepareDeyunaiSceneReferenceAssets,
  videoPathFromName,
  publicVideoUrl,
  generateShotVideo,
  generateShotVideos,
  generateSceneBlockVideos,
  videoShotStatusKind,
  listVideoShotStatuses,
  updateVideoShotStatus,
  updateVideoProgress,
  explicitShotSpeechMode,
  hardVideoDependency,
  renderLocalClip,
  normalizeProviderClip,
  splitSceneBlockClip,
  clipPrompt,
  probeDuration,
};
