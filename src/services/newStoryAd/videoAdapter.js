const nativeAudio = require('./nativeAudioWorkflowService');
const fs = require('fs'), path = require('path');
const pipeline = require('../pipelineModelService');
const { loadSettings } = require('../settingsService');
const shotDesign = require('./shotDesignService');
const modelGateway = require('./modelGateway');
const storage = require('./storageService');
const { continuityPrompt } = require('./continuityService');
const cancellation = require('./cancellationContext');
const personIdentity = require('./personIdentityContractService');
const deyunaiService = require('../deyunaiService');
const deyunaiPersonAssets = require('./deyunaiPersonAssetService');
const videoScheduler = require('./videoParallelScheduler');
const videoLineage = require('./videoLineageService');
const sceneBlockService = require('./sceneBlockService'), videoSceneBlockGuard = require('./videoSceneBlockGuardService');
const semanticCut = require('./semanticCutService');
const videoCore = require('../videoGenerationCore'), paidExecutionPolicy = require('./paidVideoExecutionPolicyService');
const contractFreshness = require('./keyframeContractFreshnessService');
const boundaryRepair = require('./videoBoundaryRepairService'), boundaryGeneration = require('./videoBoundaryGenerationService'), videoAttemptState = require('./videoAttemptStateService');
const knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');
const productionPromptCompiler = require('./productionPromptCompilerService');
const lipSync = require('./lipSyncService');
const publicReferences = require('./publicReferenceService');
const {
  videoShotStatusKind,
  listVideoShotStatuses,
  updateVideoShotStatus,
  updateVideoProgress,
} = require('./videoProgressService');
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../../../outputs')), VIDEO_DIR = path.join(OUTPUT_DIR, 'new-story-ad-videos');
const VIDEO_STAGE = 'new_story_ad.video';
const VIDEO_MAX_CANDIDATES = Math.max(1, Math.min(5, Number(process.env.NEW_STORY_AD_VIDEO_MAX_CANDIDATES) || 4));
const {
  ensureDir, safeBase, publicVideoUrl, videoPathFromName, clamp, ratioSize, outputSize, execFfmpeg, probeDuration,
  encodingProfile, normalizeProviderClip, localImagePath, localAudioPath,
} = require('./videoAdapterMediaRuntime').createVideoAdapterMediaRuntime({ videoDir: VIDEO_DIR });

function resumableProviderTaskId(status = {}, expectedLineage = {}, model = {}) {
  const taskId = String(status.provider_task_id || status.resume_provider_task_id || '').trim();
  if (!taskId || status.error_code === 'PROVIDER_TASK_TERMINAL_FAILED') return '';
  if (!['provider_submitted', 'provider_running', 'downloading', 'queued'].includes(String(status.lifecycle || ''))) return '';
  const expectedFingerprint = String(expectedLineage?.fingerprint || '');
  if (!expectedFingerprint || String(status.lineage_fingerprint || '') !== expectedFingerprint) return '';
  if (String(status.provider_id || '').toLowerCase() !== String(model.provider_id || '').toLowerCase()) return '';
  if (String(status.model_id || '').toLowerCase() !== String(model.model_id || '').toLowerCase()) return '';
  return taskId;
}

function explicitShotSpeechMode(shot = {}, contract = {}) {
  const raw = String(
    shot.speech_mode || shot.speechMode || shot.on_screen_speech_mode || contract.speech_mode || contract.speechMode || '',
  ).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['dialogue', 'on_camera', 'on_camera_dialogue', 'visible_dialogue', 'speaking', 'lip_sync', 'on_camera_introduction', 'presenter', 'talking_head', 'self_introduction'].includes(raw)) return 'on_camera_dialogue';
  if (['silent', 'mute', 'no_speech'].includes(raw)) return 'silent';
  return 'offscreen_voiceover';
}

function requiresLipSyncForAudio(shot = {}, contract = {}, audio = {}) {
  if (explicitShotSpeechMode(shot, contract) !== 'on_camera_dialogue') return false;
  const units = Array.isArray(audio?.speech_units) ? audio.speech_units : [];
  // 旧音轨没有 unit 元数据时维持原合同；新音轨只允许真实人物对白进入口型阶段。
  return !units.length || units.some(unit => String(unit?.kind || '').toLowerCase() === 'dialogue');
}

function lipSyncAudioSource(audio = {}) {
  const units = Array.isArray(audio?.speech_units) ? audio.speech_units : [];
  const hasDialogue = units.some(unit => String(unit?.kind || '').toLowerCase() === 'dialogue');
  const hasNarration = units.some(unit => String(unit?.kind || '').toLowerCase() === 'narration');
  const dedicated = audio.lip_sync_audio_url || audio.lipSyncAudioUrl || '';
  if (hasDialogue && hasNarration) return dedicated;
  return dedicated || audio.audio_url || audio.audioUrl || audio.url || '';
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

function clipPrompt(shot = {}, ctx = {}, contract = {}, previousShot = null, keyframe = {}, repairInstruction = '') {
  const design = shotDesign.normalizeShotDesign(shot);
  const authoredEffectTarget = !!(design.motion_effect?.target_state || design.motion_effect?.reference_asset_id);
  const humanApproved = keyframe.qa?.manual_override === true || keyframe.current_generation_status === 'manual_accepted';
  const currentKeyframeAccepted = !!(keyframe.image_url || keyframe.imageUrl || keyframe.url)
    && keyframe.qa?.pass === true
    && (!contract.contract_fingerprint || contractFreshness.artifactMatchesContract(keyframe, contract));
  return [
    `镜头运动与声音执行设计（剧情字段真实生成输入）：\n${productionPromptCompiler.compileVideoDirection(shot, { productionGraphShot: contract.production_graph_lock || null })}`,
    `Advertised subject: ${ctx.product_subject || ''}`,
    `Shot purpose: ${shot.purpose || shot.role || ''}`,
    `Visible frame: ${shot.visual || shot.visual_description || shot.content_prompt || ''}`,
    `Required movement: ${shot.action || shot.visual_action || ''}`,
    `Camera: ${shot.camera || shot.camera_movement || contract.camera_strategy || ''}`,
    continuityPrompt(shot, previousShot),
    design.action_contract ? `Action beat contract:\n${shotDesign.actionContractSummary(design.action_contract)}\nExecute the authored beats in causal order and visibly preserve contact, reaction and recovery states that are present.` : '',
    // V2.0 与关键帧共用状态合同，只执行 intended_changes 并保持 invariants。
    (contract.temporal_evidence_lock || shot.temporal_evidence) ? `剧情广告 V2.0 时序证据合同：\n${JSON.stringify(contract.temporal_evidence_lock || shot.temporal_evidence)}\n只执行 intended_changes；保持 invariants；在片段结束前呈现 evidence_requirements。` : '',
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
    knowledgePolicyRuntime.promptBlock(contract.knowledge_policy_video_generation || {}),
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

function isDeyunaiSeedanceModel(model = {}) {
  return String(model.provider_id || '').toLowerCase() === 'deyunai'
    && /^doubao-seedance-2-0/i.test(String(model.model_id || ''));
}

function isSmscrwSeedanceModel(model = {}) {
  return String(model.provider_id || '').toLowerCase() === 'smscrw'
    && /^doubao-seedance-2(?:[-.]0)/i.test(String(model.model_id || ''));
}

function shotNeedsNativeAudio(shot = {}) { return nativeAudio.wantsSound(shot); }

function expectedModelForShot(_shot = {}, _contract = {}, fallbackModel = {}) { return fallbackModel; }

function clipRoute(clip = {}) {
  return String(clip.provider_used || clip.providerUsed || '').trim().toLowerCase();
}

function assertLockedVideoRoute(options = {}, model = {}) {
  const lockedRoute = String(options.video_execution_route || options.videoExecutionRoute || '').trim().toLowerCase();
  if (!lockedRoute || modelRoute(model) === lockedRoute) return model;
  const error = new Error('用户选择的视频模型与实际执行路由不一致，已在供应商提交前停止。');
  error.code = 'VIDEO_MODEL_SELECTION_DRIFT'; error.status = 409; error.retryable = false;
  error.providerSubmitted = false; error.billingState = 'not_submitted';
  throw error;
}

function resolvePinnedVideoModel(options = {}, existingClips = []) {
  const configured = videoCandidates(options, { includeCircuitOpen: true });
  const explicitSelection = Boolean(String(options.video_provider || options.videoProvider || '').trim()
    && String(options.video_model || options.videoModel || '').trim());
  const existingRoutes = [...new Set((Array.isArray(existingClips) ? existingClips : [])
    .filter(clip => clip?.video_url || clip?.videoUrl || clip?.file_path)
    .map(clipRoute)
    .filter(route => route && !route.startsWith('local-ffmpeg/')))];
  if (!configured.length) {
    const error = new Error('new_story_ad.video 模型调用管理中没有可用且已配置的视频模型');
    error.code = 'VIDEO_MODEL_CONFIG_REQUIRED';
    error.retryable = false;
    throw error;
  }
  if (!explicitSelection && existingRoutes.length === 1) {
    const pinned = configured.find(candidate => modelRoute(candidate) === existingRoutes[0]);
    if (!pinned || modelGateway.healthState(pinned).circuit_open) {
      const error = new Error(`任务原视频模型 ${existingRoutes[0]} 当前不可用；为避免静默换模导致画风和人物变化，已停止生成`);
      error.code = 'PINNED_VIDEO_MODEL_UNAVAILABLE';
      error.retryable = true;
      throw error;
    }
    return pinned;
  }
  const allowFallback = !paidExecutionPolicy.isPaidExecution(options)
    && (options.allow_video_model_fallback === true || options.allowVideoModelFallback === true);
  if (allowFallback) {
    const available = configured.find(candidate => !modelGateway.healthState(candidate).circuit_open);
    if (available) return available;
  }
  const primary = assertLockedVideoRoute(options, configured[0]);
  if (modelGateway.healthState(primary).circuit_open) {
    const error = new Error(`模型调用管理首选视频模型 ${modelRoute(primary)} 当前处于熔断状态；为避免未确认的模型降级，任务已停止`);
    error.code = 'PRIMARY_VIDEO_MODEL_UNAVAILABLE';
    error.retryable = true;
    throw error;
  }
  return primary;
}

function deyunaiAssetGroupType(ctx = {}) {
  return deyunaiPersonAssets.groupType(ctx);
}
function personReferenceUrl(ctx = {}) {
  return deyunaiPersonAssets.referenceUrl(ctx);
}
async function prepareDeyunaiPersonAsset({ taskId = '', ctx = {}, options = {} } = {}) {
  return deyunaiPersonAssets.prepare({ taskId, ctx, options, toAbsolute: absoluteAssetUrl });
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

function useSeedanceReferenceAssets(options = {}, { personRequired = false } = {}) {
  const mode = String(options.seedance_input_mode || options.seedanceInputMode || '').trim().toLowerCase();
  if (['reference_assets', 'reference_asset', 'asset_reference'].includes(mode)) return true;
  if (['first_frame', 'approved_keyframe', 'image_to_video'].includes(mode)) return false;
  // Seedance may reject a direct first-frame image that contains a person as
  // privacy-sensitive input. Use its managed asset/reference path only for
  // person shots; object/environment shots keep the approved keyframe as the
  // exact first frame so scene geometry remains locked.
  return personRequired === true;
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

function successfulProviderAccounting(providerTaskId = '', durationSec = 0) {
  const taskId = String(providerTaskId || '').trim();
  const requestedSeconds = taskId ? Math.max(0, Number(durationSec) || 0) : 0;
  return {
    provider_task_id: taskId,
    provider_submission_state: taskId ? 'completed' : 'not_submitted',
    billing_state: taskId ? 'confirmed' : 'not_submitted',
    requested_video_seconds: requestedSeconds,
  };
}
function publicBaseUrl(options = {}) {
  return String(
    options.public_base_url
      || options.publicBaseUrl
      || publicReferences.publicBaseUrl(),
  ).replace(/\/+$/, '');
}

function absoluteAssetUrl(url = '', options = {}) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${publicBaseUrl(options)}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function localMotionFilter({ width, height, duration, cameraMotion = '' } = {}) {
  const frames = Math.max(30, Math.round(Number(duration || 4) * 30));
  const motion = String(cameraMotion || '').toLowerCase();
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  if (/truck|pan|横移|摇移/.test(motion)) {
    const reverse = /left|向左|左移/.test(motion);
    const x = reverse
      ? `'(iw-iw/zoom)*(1-on/${frames})'`
      : `'(iw-iw/zoom)*on/${frames}'`;
    return `${base},zoompan=z='1.045':x=${x}:y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30,setsar=1,format=yuv420p`;
  }
  if (/pull|zoom.?out|拉远|后退/.test(motion)) {
    return `${base},zoompan=z='max(1.0,1.04-0.04*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30,setsar=1,format=yuv420p`;
  }
  return `${base},zoompan=z='min(1.04,1+0.04*on/${frames})':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30,setsar=1,format=yuv420p`;
}

async function renderLocalClip({ outputPath, imagePath = '', audioPath = '', durationSec = 4, aspectRatio = '9:16', cameraMotion = '' } = {}) {
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
    '-vf', localMotionFilter({ width, height, duration, cameraMotion }),
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-r', '30', '-movflags', '+faststart', outputPath,
  );
  await execFfmpeg(args);
  return outputPath;
}

async function generateLocalMotionClip({ taskId = '', shot = {}, keyframe = {}, audio = {}, ctx = {}, index = 0, duration = 5, options = {} } = {}) {
  const imagePath = localImagePath(keyframe.image_url || keyframe.imageUrl || keyframe.url || '');
  if (!imagePath) {
    const error = new Error(`第 ${index + 1} 镜缺少可用于本地确定性运镜的已确认关键帧`);
    error.code = 'LOCAL_MOTION_KEYFRAME_REQUIRED';
    error.retryable = false;
    throw error;
  }
  const audioPath = localAudioPath(audio.audio_url || audio.audioUrl || audio.url || '');
  const filename = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_local_motion_${Date.now()}`);
  const outputPath = path.join(VIDEO_DIR, `${filename}.mp4`);
  await renderLocalClip({
    outputPath,
    imagePath,
    audioPath,
    durationSec: duration,
    aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
    cameraMotion: shot.camera_movement || shot.camera || shot.action || '',
  });
  return outputPayload(outputPath, {
    shot_index: index,
    index: index + 1,
    title: shot.title || `Shot ${index + 1}`,
    duration_sec: duration,
    provider_used: 'local-ffmpeg/cost-aware-camera-motion',
    provider_task_id: '',
    image_source: keyframe.image_url || keyframe.imageUrl || '',
    motion_prompt: clipPrompt(shot, ctx, options._contract || {}, null, keyframe),
    mode: 'deterministic_local_camera_motion',
    seedance_input_mode: 'not_applicable_local_motion',
    audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
    audio_muxed: !!audioPath,
    normalized: true,
    zero_cost_visual_generation: true,
  });
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

/** 提交一个已经通过费用授权的供应商生成单元，不执行隐式模型回退。 */
async function generateProviderClip({ taskId, shot, previousShot, keyframe, audio, contract, ctx, index, duration, options }) {
  const pinnedModel = options._pinnedVideoModel;
  if (!pinnedModel) {
    const error = new Error('当前没有可用且状态正常的真实视频模型，已立即停止本阶段。');
    error.code = 'VIDEO_CIRCUIT_OPEN';
    error.retryable = true;
    throw error;
  }
  const candidates = [pinnedModel];
  const nativeAudioRequested = options._nativeAudioRequired === true || shotNeedsNativeAudio(shot);
  const imageUrl = options._boundaryFirstFrameUrl || absoluteAssetUrl(keyframe.image_url || keyframe.imageUrl || keyframe.url || '', options);
  if (!imageUrl) throw new Error(`第 ${index + 1} 镜缺少关键帧，不能提交图生视频`);
  const prompt = String(options._promptOverride || '').trim()
    || clipPrompt(shot, ctx, contract, previousShot, keyframe, options._repairInstructions?.[index] || '');
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const directBoundary = options._boundaryRepairInputMode === boundaryRepair.DIRECT_TAIL_FIRST_FRAME, forceReferenceAssetMode = options._boundaryRepairInputMode === boundaryRepair.MANAGED_DUAL_REFERENCE;
  const personReferenceAssets = !directBoundary && (useSeedanceReferenceAssets(options, { personRequired: shotNeedsPerson }) || forceReferenceAssetMode)
    && (shotNeedsPerson || forceReferenceAssetMode)
    ? [...new Set([
        ...(Array.isArray(options._deyunaiPersonAsset?.asset_urls) ? options._deyunaiPersonAsset.asset_urls : []),
        options._deyunaiPersonAsset?.asset_url,
      ].filter(Boolean))].slice(0, 3)
    : [];
  const personReferenceAsset = personReferenceAssets[0] || '';
  const sceneReferenceAssets = personReferenceAsset
    ? [...new Set((Array.isArray(options._sceneReferenceAssetUrls) ? options._sceneReferenceAssetUrls : []).filter(Boolean))].slice(0, Math.max(0, 3 - personReferenceAssets.length))
    : [];
  const audioPath = ''; // Native generation never overlays a prior TTS track.
  boundaryGeneration.assertProviderInput({ contract: options._boundaryRepairContract, providerRoute: modelRoute(pinnedModel), inputMode: options._boundaryRepairInputMode, firstFrameUrl: options._boundaryFirstFrameUrl, currentKeyframeAssetUrl: personReferenceAsset, previousTailAssetUrl: options._boundaryReferenceAssetUrl, referenceAssetUrls: sceneReferenceAssets });
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
    const previousStatus = storage.getOutput(taskId, videoShotStatusKind(index)) || {};
    const resumeProviderTaskId = options.force_regenerate_all === true
      ? ''
      : resumableProviderTaskId(previousStatus, options._expectedLineages?.[index] || {}, model);
    const filename = safeBase(`nsa_${taskId || 'task'}_${String(index + 1).padStart(2, '0')}_${Date.now()}`);
    const startedAt = Date.now();
    try {
      const inputMode = String(options._inputModeOverride || '').trim()
        || (personReferenceAsset ? (sceneReferenceAssets.length ? 'verified_person_and_scene_reference' : 'verified_person_reference') : 'approved_keyframe_first_frame');
      updateGenerationUnitStatus(taskId, index, {
        lifecycle: resumeProviderTaskId ? 'provider_running' : 'submitting',
        total_shots: totalShots,
        title: shot.title || `镜头 ${index + 1}`,
        provider_id: model.provider_id,
        model_id: model.model_id,
        input_mode: inputMode,
        boundary_repair_fingerprint: options._boundaryRepairContract?.fingerprint || '',
        boundary_reference_attached: !!(options._boundaryFirstFrameUrl || options._boundaryReferenceAssetUrl),
        scene_block_id: options._sceneBlock?.id || '',
        scene_block_members: options._sceneBlock?.member_indexes?.map(member => member + 1) || [],
        speech_mode: explicitShotSpeechMode(shot, contract),
        provider_task_id: resumeProviderTaskId,
        provider_status: resumeProviderTaskId ? 'resuming' : '',
        resume_provider_task_id: resumeProviderTaskId,
        resumed_after_interruption: !!resumeProviderTaskId,
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
        provider_task_id: resumeProviderTaskId,
        // The accepted storyboard frame already contains the approved person,
        // scene and composition. Keep it as first_frame by default so video
        // generation cannot silently replace the wall/space geometry. Asset
        // reference mode remains opt-in for exceptional tasks only.
        image_url: personReferenceAsset ? undefined : imageUrl,
        reference_image_urls: personReferenceAsset ? [...personReferenceAssets, ...sceneReferenceAssets] : [],
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        videoResolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '480p',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '480p',
        userId: ctx.user_id || '',
        agentId: VIDEO_STAGE,
        idempotencyKey: [
          taskId,
          options._generationId || options.generation_id || 'generation',
          index,
          options._expectedLineages?.[index]?.fingerprint || 'lineage',
          model.provider_id,
          model.model_id,
        ].join(':').slice(0, 128),
        generateAudio: nativeAudioRequested,
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
        requireSourceAudio: nativeAudioRequested,
        audioPath,
        durationSec: duration,
        aspectRatio: ctx.output_ratio || options.aspectRatio || '9:16',
        resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '480p',
        qualityTier: options.video_quality || options.videoQuality || ctx.video_quality || 'final',
      });
      modelGateway.recordHealth(model, { ok: true, latencyMs: Date.now() - startedAt });
      const successfulProviderTaskId = generated.providerTaskId || storage.getOutput(taskId, videoShotStatusKind(index))?.provider_task_id || '';
      const successfulAccounting = successfulProviderAccounting(successfulProviderTaskId, duration);
      storage.saveModelCall({
        task_id: taskId, stage: VIDEO_STAGE, provider_id: model.provider_id, model_id: model.model_id,
        adapter: generated.resumed ? 'provider_task_resume' : '', status: 'success', latency_ms: Date.now() - startedAt,
        fallback_rank: attempts.length + 1, ...successfulAccounting,
        generation_id: options._generationId || options.generation_id || '', shot_index: index,
      });
      updateGenerationUnitStatus(taskId, index, {
        lifecycle: 'generated',
        ...successfulAccounting,
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
        ...successfulAccounting,
        image_source: imageUrl,
        motion_prompt: prompt,
        mode: options._sceneBlock?.continuous ? 'provider_continuous_scene_block' : (personReferenceAsset ? 'provider_person_reference_video' : 'provider_image_to_video'),
        seedance_input_mode: inputMode,
        boundary_repair_fingerprint: options._boundaryRepairContract?.fingerprint || '',
        boundary_reference_attached: !!(options._boundaryFirstFrameUrl || options._boundaryReferenceAssetUrl),
        scene_block_id: options._sceneBlock?.id || '',
        scene_block_fingerprint: options._sceneBlock?.fingerprint || '',
        scene_block_members: options._sceneBlock?.member_indexes?.map(member => member + 1) || [],
        audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
        audio_muxed: !!audioPath,
        native_audio_generated: nativeAudioRequested,
        audio_mode: nativeAudio.MODE,
        normalized: true,
        resumed_after_interruption: generated.resumed === true,
        attempts,
      });
    } catch (error) {
      if (cancellation.signal()?.aborted) cancellation.throwIfCancelled(taskId);
      const classified = modelGateway.classifyError(error);
      const persistedStatus = storage.getOutput(taskId, videoShotStatusKind(index)) || {};
      const providerTaskId = String(error.providerTaskId || persistedStatus.provider_task_id || '').trim();
      const providerSubmissionState = providerTaskId ? 'submitted' : 'not_submitted';
      const billingState = String(error.billingState || (providerTaskId ? 'unknown' : 'not_submitted'));
      modelGateway.recordHealth(model, { ok: false, error });
      storage.saveModelCall({ task_id: taskId, stage: VIDEO_STAGE, provider_id: model.provider_id, model_id: model.model_id, status: 'failed', error_code: error.code || classified.code, error_message: String(error.message || error).slice(0, 500), fallback_rank: attempts.length + 1, provider_task_id: providerTaskId, provider_submission_state: providerSubmissionState, billing_state: billingState, generation_id: options._generationId || options.generation_id || '', shot_index: index });
      attempts.push({ provider_id: model.provider_id, model_id: model.model_id, code: error.code || classified.code, retryable: error.retryable === true || classified.retryable, provider_task_id: providerTaskId, provider_submission_state: providerSubmissionState, billing_state: billingState, error: videoCore.chineseError.classifyChineseMessage(error) });
    }
  }
  const attemptSummary = attempts.map(item => `${item.provider_id}/${item.model_id}：${item.error || item.code || '未知错误'}（${item.provider_submission_state === 'not_submitted' ? '未提交供应商任务' : '已提交供应商任务'}，${item.billing_state === 'not_submitted' ? '未计费' : '计费状态待核对'}）`).join('；');
  const error = new Error(`第 ${index + 1} 镜视频生成失败，系统已停止自动重试。${attemptSummary ? ` 供应商诊断：${attemptSummary}` : ''}`);
  error.code = attempts.some(item => item.retryable) ? 'VIDEO_ATTEMPTS_EXHAUSTED' : (attempts[0]?.code || 'VIDEO_MODEL_UNAVAILABLE');
  error.retryable = attempts.some(item => item.retryable);
  error.attempts = attempts;
  error.providerTaskId = attempts.find(item => item.provider_task_id)?.provider_task_id || '';
  error.billingState = attempts.find(item => item.provider_task_id)?.billing_state || 'not_submitted';
  error.requestedVideoSeconds = error.providerTaskId ? duration : 0;
  updateGenerationUnitStatus(taskId, index, {
    lifecycle: 'failed',
    total_shots: totalShots,
    error: String(error.message || error).slice(0, 1000),
    error_code: error.code || 'VIDEO_MODEL_UNAVAILABLE',
    retryable: error.retryable === true,
  }, totalShots, options);
  throw error;
}

/** 生成单个最终剪辑镜头；仅在明确开启时允许零费用本地兜底。 */
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
    const allowLocalFallback = paidExecutionPolicy.localFallbackAllowed(options);
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
      warning: videoCore.chineseError.classifyChineseMessage(error),
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
      warning: videoCore.chineseError.classifyChineseMessage(error),
    });
  }
}

async function generateShotVideos({ taskId = '', shots = [], keyframes = [], ttsAudio = {}, contracts = [], ctx = {}, options = {}, existingClips = [], onClip = null } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const clips = Array.isArray(existingClips) ? existingClips.slice() : [];
  const pinnedModel = resolvePinnedVideoModel(options, clips);
  const isDeyunaiSeedance = isDeyunaiSeedanceModel(pinnedModel);
  const isSmscrwSeedance = isSmscrwSeedanceModel(pinnedModel);
  if (personIdentity.personRequired(ctx) && !isDeyunaiSeedance && !isSmscrwSeedance) {
    const error = new Error(`人物广告必须使用支持人物参考锁定的 Seedance 2.0；当前候选 ${modelRoute(pinnedModel)} 不满足要求，已禁止降级`);
    error.code = 'PERSON_ASSET_VIDEO_MODEL_REQUIRED';
    error.status = 422;
    error.retryable = true;
    throw error;
  }
  const hasPersonShot = list.some((shot, index) => personIdentity.shotPersonRequired(ctx, shot, contracts[index] || {}));
  const deyunaiPersonAsset = isDeyunaiSeedance && hasPersonShot && useSeedanceReferenceAssets(options, { personRequired: hasPersonShot })
    ? await prepareDeyunaiPersonAsset({ taskId, ctx, options })
    : null;
  const runOptions = {
    ...options,
    seedance_input_mode: isSmscrwSeedance ? 'first_frame' : options.seedance_input_mode,
    _pinnedVideoModel: pinnedModel,
    _deyunaiPersonAsset: deyunaiPersonAsset,
    _totalShots: list.length,
  };
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
    qa_problems: [], previous_clip_restored: false, recovered_existing_paid_clip: false, stopped_after_unit_failure: false, artifact_compatibility: null, compatibility_status: '', compatibility_reason_codes: [], regenerate_required: false,
    error: '',
    error_code: '',
    repair_attempt: Number(options._repairAttempt || 0),
    pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
    lineage_fingerprint: options._expectedLineages?.[index]?.fingerprint || '', lineage: options._expectedLineages?.[index] || null,
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
  const editPlan = await semanticCut.buildLockedEditPlan({
    filePath: sourceClip.file_path, beats: block.beats || [],
    searchWindowSec: Number(options.motion_safe_cut_window_sec || 0.8), fps: Number(options.local_motion_analysis_fps || 6),
    allowSemanticShift: block.continuous === true && !!block.temporal_plan_policy_version, // 仅证据完整的 V2.0 连续母片允许微调切点。
  });
  const audioDurations = [];
  for (const beat of editPlan.beats) {
    const index = Number(beat.shot_index || 1) - 1;
    const audio = tracks[index] || {};
    const audioPath = localAudioPath(audio.audio_url || audio.audioUrl || audio.url || '');
    audioDurations.push({ index, audioPath, duration: await probeDuration(audioPath) });
  }
  const output = [];
  for (let position = 0; position < editPlan.beats.length; position += 1) {
    const beat = editPlan.beats[position];
    cancellation.throwIfCancelled(taskId);
    const index = Number(beat.shot_index || 1) - 1;
    const audio = tracks[index] || {};
    const audioPath = audioDurations[position]?.audioPath || '';
    const audioDuration = audioDurations[position]?.duration || 0;
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
      resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '480p',
      qualityTier: options.video_quality || options.videoQuality || ctx.video_quality || 'final',
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
      planned_scene_block_start_sec: Number(beat.planned_start_sec ?? beat.start_sec),
      planned_scene_block_end_sec: Number(beat.planned_end_sec ?? beat.end_sec),
      scene_block_edit_evidence: editPlan.evidence,
      mode: 'continuous_scene_block_segment',
      audio_source: audioPath ? (audio.audio_url || audio.audioUrl || audio.url || '') : '',
      audio_muxed: !!audioPath,
    }));
  }
  return output;
}

/** 按独立生成单元执行镜头；失败仅影响当前单元并记录可核对的计费状态。 */
async function generateSceneBlockVideos({ taskId = '', shots = [], keyframes = [], ttsAudio = {}, contracts = [], sceneBlocks = [], ctx = {}, options = {}, existingClips = [], onClip = null } = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const tracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const blocks = Array.isArray(sceneBlocks) && sceneBlocks.length ? sceneBlocks : sceneBlockService.buildSceneBlocks(list, contracts, options);
  const clips = Array.isArray(existingClips) ? existingClips.slice() : [];
  const pinnedModel = options._pinnedVideoModel || resolvePinnedVideoModel(options, clips);
  const isDeyunaiSeedance = isDeyunaiSeedanceModel(pinnedModel);
  const isSmscrwSeedance = isSmscrwSeedanceModel(pinnedModel);
  if (personIdentity.personRequired(ctx) && !isDeyunaiSeedance && !isSmscrwSeedance) {
    const error = new Error(`人物广告必须使用支持人物参考锁定的 Seedance 2.0；当前候选 ${modelRoute(pinnedModel)} 不满足要求，已禁止降级`);
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
  videoSceneBlockGuard.assertTemporalKeyframeAnchors(units);
  const localMotionIndexes = new Set((Array.isArray(options._localMotionIndexes) ? options._localMotionIndexes : []).map(Number));
  const keyframeReferenceOnlyIndexes = new Set((Array.isArray(options._keyframeReferenceOnlyIndexes) ? options._keyframeReferenceOnlyIndexes : []).map(Number));
  const keyframeFirstFrameOnlyIndexes = new Set((Array.isArray(options._keyframeFirstFrameOnlyIndexes) ? options._keyframeFirstFrameOnlyIndexes : []).map(Number));
  const directBoundaryIndexes = new Set(Object.entries(options._boundaryRepairContracts || {}).filter(([, contract]) => (contract?.input_strategy || boundaryRepair.inputStrategy(options)) === boundaryRepair.DIRECT_TAIL_FIRST_FRAME).map(([index]) => Number(index)));
  const hasPersonUnit = units.some(block => personIdentity.shotPersonRequired(ctx, sceneBlockService.generationShot(block, list), contracts[block.first_index] || {}));
  const allPersonUnitsUseKeyframeOnly = units
    .filter(block => personIdentity.shotPersonRequired(ctx, sceneBlockService.generationShot(block, list), contracts[block.first_index] || {}))
    .every(block => keyframeReferenceOnlyIndexes.has(block.first_index) || keyframeFirstFrameOnlyIndexes.has(block.first_index) || directBoundaryIndexes.has(block.first_index));
  const preparePersonAsset = typeof options._preparePersonAsset === 'function' ? options._preparePersonAsset : prepareDeyunaiPersonAsset;
  const deyunaiPersonAsset = isDeyunaiSeedance && hasPersonUnit && !allPersonUnitsUseKeyframeOnly && useSeedanceReferenceAssets(options, { personRequired: hasPersonUnit })
    ? await preparePersonAsset({ taskId, ctx, options })
    : null;
  const shotTitles = Object.fromEntries(list.map((shot, index) => [index, shot.title || `镜头 ${index + 1}`]));
  const unitGenerator = typeof options._generateShotVideo === 'function' ? options._generateShotVideo : generateShotVideo;
  targetIndexes.forEach((index) => {
    const block = sceneBlockService.blockForIndex(blocks, index);
    const previousStatus = storage.getOutput(taskId, videoShotStatusKind(index)) || {};
    const resumeProviderTaskId = options.force_regenerate_all === true
      ? ''
      : resumableProviderTaskId(previousStatus, options._expectedLineages?.[index] || {}, pinnedModel);
    updateVideoShotStatus(taskId, index, {
      lifecycle: 'queued', queued_at: new Date().toISOString(), started_at: '',
      attempt_number: Number(previousStatus.attempt_number || 0) + (resumeProviderTaskId ? 0 : 1),
      total_shots: list.length, title: shotTitles[index], provider_id: pinnedModel.provider_id, model_id: pinnedModel.model_id,
      speech_mode: explicitShotSpeechMode(list[index] || {}, contracts[index] || {}),
      scene_block_id: block?.id || '', scene_block_members: block?.member_indexes?.map(member => member + 1) || [index + 1],
      scene_block_duration_sec: block?.duration_sec || sceneBlockService.durationOf(list[index] || {}),
      provider_task_id: resumeProviderTaskId, provider_status: resumeProviderTaskId ? 'resume_pending' : '',
      resume_provider_task_id: resumeProviderTaskId, resumed_after_interruption: !!resumeProviderTaskId,
      ...videoAttemptState.queuedProviderState(previousStatus, resumeProviderTaskId),
      file_path: '', file_exists: false, video_url: '', qa_status: '', qa_problems: [], error: '', error_code: '', previous_clip_restored: false, recovered_existing_paid_clip: false, stopped_after_unit_failure: false, artifact_compatibility: null, compatibility_status: '', compatibility_reason_codes: [], regenerate_required: false,
      repair_attempt: Number(options._repairAttempt || 0), pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
      lineage_fingerprint: options._expectedLineages?.[index]?.fingerprint || '', lineage: options._expectedLineages?.[index] || null,
    }, list.length);
  });
  let schedule = { results: [], waves: [], configured_concurrency: 1, effective_concurrency: 1, max_concurrency: 1, throttle_retries: {} };
  const unitFailures = [];
  const failFast = paidExecutionPolicy.isPaidExecution(options)
    || (options.continue_after_unit_failure !== true && options.continueAfterUnitFailure !== true);
  if (units.length) {
    try {
      schedule = await videoScheduler.runSchedule({
        indexes: units.map((_, index) => index),
        options: failFast ? { ...options, parallel_videos: false, allow_throttle_retry: false } : options,
        signal: cancellation.signal(), dependencyOf: () => null,
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
        try {
          cancellation.throwIfCancelled(taskId);
          const syntheticShot = sceneBlockService.generationShot(block, list);
          const localMotion = block.member_indexes.length === 1 && localMotionIndexes.has(first);
          const personRequired = personIdentity.shotPersonRequired(ctx, syntheticShot, contracts[first] || {});
          const keyframeFirstFrameOnly = keyframeFirstFrameOnlyIndexes.has(first);
          const boundaryContract = options._boundaryRepairContracts?.[first] || null;
          const boundaryInputs = await boundaryGeneration.prepareInputs({ taskId, index: first, keyframe: keyframes[first] || {}, contract: boundaryContract, pinnedModelRoute: modelRoute(pinnedModel), options, prepareKeyframeReferenceAsset: prepareDeyunaiKeyframeReferenceAsset });
          const managedBoundary = boundaryInputs?.inputMode === boundaryRepair.MANAGED_DUAL_REFERENCE;
          const referenceAssetMode = isDeyunaiSeedance && !keyframeFirstFrameOnly
            && (boundaryContract ? managedBoundary : useSeedanceReferenceAssets(options, { personRequired }));
          const prepareKeyframeReferenceAsset = typeof options._prepareKeyframeReferenceAsset === 'function' ? options._prepareKeyframeReferenceAsset : prepareDeyunaiKeyframeReferenceAsset;
          const sceneAssets = referenceAssetMode && personRequired && block.continuous && !boundaryContract
            ? await prepareDeyunaiSceneReferenceAssets({ taskId, block, options })
            : [];
          const keyframeAsset = boundaryInputs?.keyframeAsset || (referenceAssetMode ? await prepareKeyframeReferenceAsset({ taskId, index: first, keyframe: keyframes[first] || {}, options }) : null);
          const boundaryAsset = boundaryInputs?.boundaryAsset || null;
          const keyframeReferenceOnly = (managedBoundary || (personRequired && keyframeReferenceOnlyIndexes.has(first))) && !!keyframeAsset?.asset_url;
          block.member_indexes.forEach(index => updateVideoShotStatus(taskId, index, {
            lifecycle: 'queued', scheduler_wave: wave.wave_number, scheduler_concurrency: wave.concurrency,
            global_queue_ms: wave.global_queue_ms || 0,
          }, list.length));
          const runOptions = {
            ...options,
            seedance_input_mode: isSmscrwSeedance ? 'first_frame' : options.seedance_input_mode,
            _pinnedVideoModel: pinnedModel,
            _deyunaiPersonAsset: keyframeFirstFrameOnly ? null : (keyframeReferenceOnly ? keyframeAsset : deyunaiPersonAsset),
            _totalShots: list.length,
            _sceneBlock: block, _sceneBlockShotTitles: shotTitles,
            _nativeAudioRequired: block.member_indexes.some(member => shotNeedsNativeAudio(list[member] || {})),
            _sceneReferenceAssetUrls: managedBoundary
              ? [boundaryAsset.asset_url]
              : (keyframeReferenceOnly ? [] : [keyframeAsset?.asset_url, ...sceneAssets.map(asset => asset.asset_url)].filter(Boolean)),
            _promptOverride: block.continuous ? sceneBlockService.generationPrompt(block, list, contracts, options._repairInstructions || {}) + '\n' + (block.member_indexes || []).map(i => `镜头${i + 1}：${nativeAudio.prompt(list[i])}`).join('\n') : '',
            _inputModeOverride: boundaryContract
              ? (managedBoundary ? 'approved_keyframe_and_previous_tail_private_references' : 'previous_unit_tail_first_frame')
              : (keyframeFirstFrameOnly ? 'approved_keyframe_first_frame_only' : (keyframeReferenceOnly ? 'approved_keyframe_private_reference_only' : '')),
            _boundaryRepairContract: boundaryContract, _boundaryRepairInputMode: boundaryInputs?.inputMode || '', _boundaryFirstFrameUrl: boundaryInputs?.firstFrameUrl || '',
            _boundaryReferenceAssetUrl: boundaryAsset?.asset_url || '',
          };
          const sourceClip = localMotion
            ? await generateLocalMotionClip({
              taskId, shot: list[first] || {}, keyframe: keyframes[first] || {}, audio: tracks[first] || {},
              ctx, index: first, duration: sceneBlockService.durationOf(list[first] || {}),
              options: { ...runOptions, _contract: contracts[first] || {} },
            })
            : await unitGenerator({
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
        } catch (error) {
          if (error?.code === 'USER_CANCELLED' || error?.cancelled === true || cancellation.signal()?.aborted) throw error;
      const currentStatus = storage.getOutput(taskId, videoShotStatusKind(block.first_index)) || {};
      const submitted = !!currentStatus.provider_task_id;
      const billingState = String(error.billingState || currentStatus.billing_state || (submitted ? 'unknown' : 'not_submitted'));
      const submissionState = String(currentStatus.provider_submission_state || (submitted ? 'submitted' : 'not_submitted'));
      const failure = {
            scene_block_id: block.id,
            indexes: block.member_indexes.slice(),
            error: videoCore.chineseError.classifyChineseMessage(error, '当前镜头生成失败，系统已停止自动重试。'),
            error_code: error.code || 'SCENE_BLOCK_GENERATION_FAILED',
            retryable: error.retryable === true,
            billing_state: billingState,
          };
          unitFailures.push(failure);
          block.member_indexes.forEach(index => updateVideoShotStatus(taskId, index, {
            lifecycle: 'failed',
            error: failure.error,
            error_code: failure.error_code,
            retryable: failure.retryable,
            provider_submission_state: submissionState,
            billing_state: failure.billing_state,
          }, list.length));
          if (failFast) {
            error.unit_failure = failure;
            throw error;
          }
          return { failed: true, ...failure };
        }
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
          provider_submission_state: current.provider_submission_state || (current.provider_task_id ? 'submitted' : 'not_submitted'),
          billing_state: current.billing_state || (current.provider_task_id ? 'unknown' : 'not_submitted'),
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
  return {
    clips,
    provider_used: modelRoute(pinnedModel),
    pinned_model: pinnedModel,
    deyunai_person_asset: deyunaiPersonAsset,
    target_indexes: targetIndexes,
    failed_indexes: [...new Set(unitFailures.flatMap(item => item.indexes))].sort((a, b) => a - b),
    failures: unitFailures,
    scene_blocks: units,
    schedule,
  };
}

module.exports = {
  VIDEO_DIR,
  VIDEO_STAGE,
  absoluteAssetUrl,
  isDeyunaiSeedanceModel,
  isSmscrwSeedanceModel,
  videoCandidates,
  resolvePinnedVideoModel,
  deyunaiAssetGroupType,
  personReferenceUrl,
  prepareDeyunaiPersonAsset,
  prepareDeyunaiSceneReferenceAssets,
  assertLockedVideoRoute,
  useSeedanceReferenceAssets,
  videoPathFromName,
  publicVideoUrl,
  successfulProviderAccounting,
  generateShotVideo,
  generateShotVideos,
  generateSceneBlockVideos,
  videoShotStatusKind,
  listVideoShotStatuses,
  updateVideoShotStatus,
  updateVideoProgress,
  resumableProviderTaskId,
  explicitShotSpeechMode,
  requiresLipSyncForAudio,
  lipSyncAudioSource,
  expectedModelForShot,
  shotNeedsNativeAudio,
  hardVideoDependency,
  renderLocalClip,
  outputSize,
  generateLocalMotionClip,
  normalizeProviderClip,
  encodingProfile,
  splitSceneBlockClip,
  clipPrompt,
  probeDuration,
};
