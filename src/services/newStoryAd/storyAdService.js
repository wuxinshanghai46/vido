const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { buildContext, contextPrompt, cleanText, normalizeCharacters, assertContextConsistent } = require('./contextBuilder');
const { generateBlueprint } = require('./blueprintService');
const { generateStoryboardTable, rewriteStoryboard } = require('./storyboardTableService');
const { reviewStoryboard } = require('./qualityReviewService');
const { buildKeyframeContracts } = require('./keyframeContractService');
const { withContinuityContracts } = require('./continuityService');
const diagnostics = require('./diagnosticsService');
const mediaAdapter = require('./mediaAdapter');
const ttsAdapter = require('./ttsAdapter');
const videoAdapter = require('./videoAdapter');
const keyframeParallel = require('./keyframeParallelScheduler');
const composeService = require('./composeService');
const {
  bindShotsToScenes,
  selectSceneAsset,
  assertVerifiedSceneAssets,
  completeSpaceLock,
  layoutSceneReference,
} = require('./sceneBindingService');
const sceneSpace = require('./sceneSpaceContractService');
const revisionService = require('./revisionService');
const personIdentity = require('./personIdentityContractService');
const personAssetLifecycle = require('./personAssetLifecycleService');
const productIdentity = require('./productIdentityContractService');
const personKeyframeQa = require('./personConsistencyQaService');
const productKeyframeQa = require('./productConsistencyQaService');
const videoFrameQa = require('./videoFrameQaService');
const videoLineage = require('./videoLineageService');
const videoRepairPolicy = require('./videoRepairPolicy');
const videoPreflight = require('./videoPreflightService');
const sceneBlockService = require('./sceneBlockService');
const { buildSoundJourney } = require('./soundJourneyService');
const shotDesign = require('./shotDesignService');
const sceneAssistCompleteness = require('./sceneAssistCompletenessService');
const sceneAssetLifecycle = require('./sceneAssetService');
const videoCore = require('../videoGenerationCore');

/** 读取剧情广告 V3 灰度开关；关闭时仍允许查看历史项目，但禁止新的付费视频提交。 */
function storyAdV3RuntimePolicy(env = process.env) {
  const enabled = !['0', 'false', 'off', 'disabled'].includes(String(env.NEW_STORY_AD_V3_ENABLED ?? '1').trim().toLowerCase());
  const paidVideoEnabled = enabled
    && !['0', 'false', 'off', 'disabled'].includes(String(env.NEW_STORY_AD_V3_PAID_VIDEO_ENABLED ?? '1').trim().toLowerCase());
  return { version: videoCore.planner.PLAN_VERSION, enabled, paid_video_enabled: paidVideoEnabled };
}

function withAssetContracts(ctx = {}) {
  const next = { ...ctx };
  if (next.person_asset) {
    next.person_contract = next.person_contract || personIdentity.buildPersonContract(
      next.person_asset,
      next.person_spec || {},
      { revision: next.revisions?.person || 1 },
    );
    next.person_asset = { ...next.person_asset, person_contract: next.person_contract, person_revision: next.person_contract.person_revision };
  } else {
    next.person_contract = null;
  }
  next.product_contract = next.product_contract || productIdentity.buildProductContract(next, { revision: next.revisions?.product || 1 });
  return next;
}

function taskTitle(ctx) {
  return cleanText(ctx.product_subject || ctx.brief || '剧情广告任务', 60);
}

function keyframeImageUrl(frame = {}) {
  const value = frame && typeof frame === 'object' ? frame : {};
  return String(value.image_url || value.imageUrl || value.url || '').trim();
}

function localKeyframeAssetExists(url = '') {
  const clean = String(url || '').split('?')[0];
  // Historical frames may still use a provider URL. Keep them available for a
  // scoped retry; all newly generated frames are persisted locally below.
  if (!clean.startsWith('/api/new-story-ad/assets/')) return /^https?:\/\//i.test(clean);
  const filename = decodeURIComponent(clean.split('/').pop() || '');
  const filePath = mediaAdapter.assetPathFromName(filename);
  return !!(filePath && fs.existsSync(filePath));
}

function isCompleteKeyframe(frame = {}) {
  const url = keyframeImageUrl(frame);
  return !!(url && !frame.error && !frame.error_code && localKeyframeAssetExists(url));
}

function hasUsablePreviousKeyframe(frame = {}) {
  const url = keyframeImageUrl(frame);
  return !!(url && localKeyframeAssetExists(url) && frame.qa?.pass === true);
}

function keyframeCompletion(keyframes = [], shots = []) {
  const total = Math.max(
    Array.isArray(shots) ? shots.length : 0,
    Array.isArray(keyframes) ? keyframes.length : 0,
  );
  const indexes = Array.from({ length: total }).map((_, index) => index);
  const completed = indexes.filter(index => isCompleteKeyframe(keyframes[index])).length;
  const failed = indexes.filter(index => keyframes[index]?.error && !isCompleteKeyframe(keyframes[index])).length;
  const missing_indexes = indexes.filter(index => !isCompleteKeyframe(keyframes[index]));
  const retained_previous = indexes.filter(index => isCompleteKeyframe(keyframes[index]) && !!keyframes[index]?.regeneration_error).length;
  const fresh_pass = indexes.filter(index => isCompleteKeyframe(keyframes[index])
    && !keyframes[index]?.regeneration_error
    && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(keyframes[index]?.current_generation_status || ''))
    && keyframes[index]?.contract_outdated !== true
    && Number(keyframes[index]?.qa_policy_version || 0) >= 2
    && keyframes[index]?.qa?.pass === true).length;
  const outdated = indexes.filter(index => isCompleteKeyframe(keyframes[index])
    && !keyframes[index]?.regeneration_error
    && (Number(keyframes[index]?.qa_policy_version || 0) < 2
      || keyframes[index]?.contract_outdated === true
      || String(keyframes[index]?.current_generation_status || '') === 'outdated')).length;
  const needs_regeneration = indexes.filter(index => !isCompleteKeyframe(keyframes[index])
    || !!keyframes[index]?.regeneration_error
    || Number(keyframes[index]?.qa_policy_version || 0) < 2
    || keyframes[index]?.contract_outdated === true
    || ['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(keyframes[index]?.current_generation_status || ''))
    || keyframes[index]?.qa?.pass !== true).length;
  return { total, completed, fresh_pass, outdated, retained_previous, latest_failed: retained_previous + failed, needs_regeneration, missing: Math.max(0, total - completed), failed, missing_indexes };
}

function keyframeTargetIndexes(shots = [], existing = [], options = {}) {
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex))
    ? Number(options.only_index ?? options.onlyIndex)
    : null;
  const indexes = onlyIndex === null
    ? shots.map((_, index) => index)
    : [Math.max(0, Math.min(Math.max(0, shots.length - 1), onlyIndex))];
  const missingOnly = options.missing_only === true || options.missingOnly === true;
  return missingOnly ? indexes.filter(index => {
    const frame = existing[index] || {};
    return !isCompleteKeyframe(frame)
      || !!frame.regeneration_error
      || Number(frame.qa_policy_version || 0) < 2
      || frame.contract_outdated === true
      || ['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame.current_generation_status || ''))
      || frame.qa?.pass !== true;
  }) : indexes;
}

function persistKeyframeContracts(taskId, contracts = [], { clearDownstream = false } = {}) {
  const list = Array.isArray(contracts) ? contracts : [];
  storage.saveOutput(taskId, 'keyframe_contracts', list);
  const existingFrames = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  let invalidated = 0;
  const refreshedFrames = existingFrames.map((frame, index) => {
    if (!frame || typeof frame !== 'object' || !keyframeImageUrl(frame)) return frame;
    const currentFingerprint = list[index]?.contract_fingerprint || '';
    const frameFingerprint = frame.contract_fingerprint || frame.contract?.contract_fingerprint || '';
    if (currentFingerprint && frameFingerprint === currentFingerprint) return frame;
    invalidated += 1;
    return {
      ...frame,
      contract_outdated: true,
      contract_outdated_reason: '镜头信息或生成约束已修改，需重新生成并按当前合同验证',
      current_generation_status: 'outdated',
    };
  });
  if (invalidated) storage.saveOutput(taskId, 'keyframes', refreshedFrames);
  if (clearDownstream || invalidated) {
    storage.deleteOutput(taskId, 'video_clips');
    storage.deleteOutput(taskId, 'final_video');
  }
  return { contracts: list, invalidated };
}

function keyframeStageBudgetMs(taskId, options = {}) {
  const shots = storage.getOutput(taskId, 'storyboard_table');
  const existing = storage.getOutput(taskId, 'keyframes');
  const shotList = Array.isArray(shots) ? shots : [];
  const keyframes = Array.isArray(existing) ? existing : [];
  const targetCount = Math.max(1, keyframeTargetIndexes(shotList, keyframes, options).length || shotList.length || 1);
  // Budget follows batch size instead of a fixed industry/model assumption.
  // QA runs in parallel below, while this allowance protects slow providers
  // without making the browser stop at an arbitrary 15-minute boundary.
  return Math.min(60 * 60 * 1000, Math.max(10 * 60 * 1000, (4 + targetCount * 4) * 60 * 1000));
}

function isQaInfrastructureError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (['VISION_QA_UNAVAILABLE', 'VISION_QA_SCHEMA_INVALID', 'VISION_QA_IMAGE_UNREADABLE', 'VISION_CIRCUIT_OPEN', 'MODEL_ATTEMPTS_EXHAUSTED', 'TIMEOUT_OR_NETWORK'].includes(code)) return true;
  const message = String(error?.message || error || '');
  return /视觉模型全部失败|视觉模型未返回有效\s*JSON|视觉\s*QA.*(?:JSON|结构|评分)|vision.*invalid\s*json|invalid\s*json.*vision|timed?\s*out|timeout|ECONNRESET|socket hang up|rate limit|(?:HTTP\s*)?5\d\d/i.test(message);
}

async function reviewWithInfrastructureRetry(reviewer, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return await reviewer(attempt);
    } catch (error) {
      lastError = error;
      if (!isQaInfrastructureError(error) || attempt >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

function structuredQaFeedback(sceneQa = {}, personQa = {}, productQa = {}) {
  const groups = [
    ['场景空间', [...(sceneQa.mismatch_reasons || []), ...(sceneQa.forbidden_new_elements || [])]],
    ['人物身份', [...(personQa.conflicts || []), personQa.retry_instruction || '']],
    ['产品主体', [...(productQa.conflicts || []), productQa.retry_instruction || '']],
  ];
  return groups
    .map(([label, values]) => {
      const details = values.map(value => cleanText(value, 160)).filter(Boolean).slice(0, 3);
      return details.length ? `${label}：${details.join('；')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function isBeforeOrAtKeyframes(stage = '') {
  return !['tts', 'tts_ready', 'video', 'video_ready', 'compose', 'final_video_ready'].includes(String(stage || ''));
}

function persistProgressSnapshot(taskId, snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const allowedOutputs = {
    context: 'context',
    scene_config: 'scene_config',
    sceneConfig: 'scene_config',
    blueprint: 'blueprint',
    storyboard_table: 'storyboard_table',
    storyboardTable: 'storyboard_table',
    shots: 'storyboard_table',
    keyframe_contracts: 'keyframe_contracts',
    keyframeContracts: 'keyframe_contracts',
    contracts: 'keyframe_contracts',
    keyframes: 'keyframes',
    scene_assets: 'scene_assets',
    sceneAssets: 'scene_assets',
    quality_review: 'quality_review',
    review: 'quality_review',
    tts_audio: 'tts_audio',
    ttsAudio: 'tts_audio',
    video_clips: 'video_clips',
    videoClips: 'video_clips',
    final_video: 'final_video',
    finalVideo: 'final_video',
  };
  Object.entries(allowedOutputs).forEach(([inputKey, outputKind]) => {
    if (!Object.prototype.hasOwnProperty.call(snapshot, inputKey)) return;
    const value = snapshot[inputKey];
    if (value === undefined || value === null) return;
    if (Array.isArray(value) && !value.length) return;
    if (value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return;
    storage.saveOutput(taskId, outputKind, value);
  });
}

function assertTaskOwner(taskId, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const err = new Error('任务不存在');
    err.status = 404;
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }
  const userId = String(user.id || user.userId || '').trim();
  const role = String(user.role || '').toLowerCase();
  const ownerId = String(task.user_id || task.request?.user_id || task.request?.userId || '').trim();
  if (role !== 'admin' && (!ownerId || ownerId !== userId)) {
    const err = new Error('无权访问该剧情广告任务');
    err.status = 403;
    err.code = 'TASK_FORBIDDEN';
    throw err;
  }
  return task;
}

function canonicalBlueprintValue(value) {
  if (Array.isArray(value)) return value.map(canonicalBlueprintValue);
  if (!value || typeof value !== 'object') return value;
  const ignored = new Set(['edited_at', 'edited_by_user', 'model_meta', 'revision', 'fingerprint']);
  return Object.keys(value).sort().reduce((out, key) => {
    if (!ignored.has(key)) out[key] = canonicalBlueprintValue(value[key]);
    return out;
  }, {});
}

function blueprintFingerprint(blueprint = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalBlueprintValue(blueprint || {})))
    .digest('hex');
}

function versionedBlueprint(blueprint = {}, previous = {}) {
  const fingerprint = blueprintFingerprint(blueprint);
  const previousFingerprint = previous.fingerprint || (Object.keys(previous || {}).length ? blueprintFingerprint(previous) : '');
  const changed = !previousFingerprint || fingerprint !== previousFingerprint;
  return {
    ...blueprint,
    revision: changed ? Math.max(1, Number(previous.revision || 0) + 1) : Math.max(1, Number(previous.revision || 1)),
    fingerprint,
  };
}

function storyboardStatus(bundle = {}, outputs = {}) {
  const rows = Array.isArray(bundle.outputs) ? bundle.outputs : [];
  const rowByKind = kind => rows.find(row => row?.kind === kind) || null;
  const blueprintRow = rowByKind('blueprint');
  const storyboardRow = rowByKind('storyboard_table');
  const checkpoint = outputs.storyboard_checkpoint || null;
  const meta = outputs.storyboard_meta || null;
  const blueprint = outputs.blueprint || {};
  const shots = Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table : [];
  const currentFingerprint = blueprint.fingerprint || (Object.keys(blueprint).length ? blueprintFingerprint(blueprint) : '');
  const metaMatches = !!(meta?.blueprint_fingerprint && currentFingerprint && meta.blueprint_fingerprint === currentFingerprint);
  const timestampFresh = !!(blueprintRow && storyboardRow
    && Date.parse(storyboardRow.updated_at || 0) >= Date.parse(blueprintRow.updated_at || 0));
  const ready = shots.length > 0 && (meta
    ? meta.status === 'ready' && metaMatches
    : timestampFresh);
  return {
    ready,
    stale: shots.length > 0 && !ready,
    reason: ready ? '' : (shots.length ? 'BLUEPRINT_NEWER_THAN_STORYBOARD' : 'STORYBOARD_MISSING'),
    blueprint_revision: Number(blueprint.revision || 0),
    storyboard_blueprint_revision: Number(meta?.blueprint_revision || 0),
    checkpoint_available: !!(checkpoint && checkpoint.blueprint_fingerprint === currentFingerprint && Array.isArray(checkpoint.shots) && checkpoint.shots.length),
    checkpoint_completed: Array.isArray(checkpoint?.shots) ? checkpoint.shots.length : 0,
    checkpoint_total: Number(checkpoint?.expected_total || 0),
  };
}

function publicTaskBundle(taskId, { diagnostics = false, includeVideoMonitor = false } = {}) {
  const rawBundle = storage.getTaskBundle(taskId, { diagnostics });
  const videoShotStatuses = (rawBundle.outputs || [])
    .filter(row => String(row.kind || '').startsWith('video_shot_status_'))
    .sort((a, b) => Number(String(a.kind).slice('video_shot_status_'.length)) - Number(String(b.kind).slice('video_shot_status_'.length)))
    .map(row => row.payload || {})
    .filter(Boolean)
    .map((status, index) => ({
      index: Number(status.index || status.shot_index || index + 1),
      title: cleanText(status.title || '', 120),
      lifecycle: cleanText(status.lifecycle || 'pending', 40),
      scene_block_id: cleanText(status.scene_block_id || '', 100),
      scene_block_members: Array.isArray(status.scene_block_members) ? status.scene_block_members.map(Number).filter(Number.isInteger) : [],
      qa_status: cleanText(status.qa_status || '', 40),
      qa_problems: Array.isArray(status.qa_problems) ? status.qa_problems.map(value => cleanText(value, 220)).filter(Boolean).slice(0, 6) : [],
      qa_failure_labels_zh: Array.isArray(status.qa_failure_labels_zh) ? status.qa_failure_labels_zh.map(value => cleanText(value, 80)).filter(Boolean).slice(0, 6) : [],
      cross_shot_qa_problems: Array.isArray(status.cross_shot_qa_problems) ? status.cross_shot_qa_problems.map(value => cleanText(value, 220)).filter(Boolean).slice(0, 6) : [],
      cross_shot_failure_labels_zh: Array.isArray(status.cross_shot_failure_labels_zh) ? status.cross_shot_failure_labels_zh.map(value => cleanText(value, 80)).filter(Boolean).slice(0, 6) : [],
      provider_submission_state: cleanText(status.provider_submission_state || '', 40),
      error: cleanText(status.error || '', 300),
      error_code: cleanText(status.error_code || '', 80),
      retryable: status.retryable === true,
      updated_at: status.updated_at || '',
    }));
  const visibleOutputs = (includeVideoMonitor
    ? (rawBundle.outputs || [])
    : (rawBundle.outputs || []).filter(row => !String(row.kind || '').startsWith('video_shot_status_'))).filter(row => !String(row.kind || '').startsWith('scene_asset_checkpoint:'))
    .map(row => String(row.kind || '') === 'scene_assets'
      ? { ...row, payload: sceneAssetLifecycle.normalizeSceneAssets(row.payload || []) }
      : row);
  const bundle = { ...rawBundle, outputs: visibleOutputs };
  const outputs = Object.fromEntries(visibleOutputs.map(x => [x.kind, x.payload]));
  const currentStoryboardStatus = storyboardStatus(bundle, outputs);
  const storyboard = Array.isArray(outputs.storyboard_table) ? outputs.storyboard_table : [];
  const contracts = Array.isArray(outputs.keyframe_contracts) ? outputs.keyframe_contracts : [];
  const keyframes = Array.isArray(outputs.keyframes) ? outputs.keyframes : [];
  const keyframeStatus = keyframeCompletion(keyframes, storyboard);
  let task = bundle.task;
  if (task && !task.active_generation_id && keyframeStatus.failed > 0 && /keyframes_(ready|partial)|^keyframes$/.test(String(task.stage || ''))) {
    task = {
      ...task,
      status: 'failed',
      stage: 'keyframes_failed',
      error: `本次真实画面生成失败 ${keyframeStatus.failed} 张，已保留上一次图片供查看，请处理模型配置后重试`,
      error_code: 'KEYFRAME_GENERATION_FAILED',
      retryable: true,
    };
  }
  if (task && !task.active_generation_id && !String(task.stage || '').endsWith('_failed') && !String(task.stage || '').endsWith('_cancelled')) {
    if (keyframeStatus.total && keyframeStatus.completed) {
      const complete = keyframeStatus.fresh_pass >= keyframeStatus.total;
      if (isBeforeOrAtKeyframes(task.stage)) {
        task = {
          ...task,
          status: complete ? (task.saved_progress === true ? 'working' : 'done') : 'working',
          stage: complete ? 'keyframes_ready' : 'keyframes_partial',
          error: '',
        };
      }
    } else if (currentStoryboardStatus.ready && storyboard.length && ['storyboard', 'storyboard_done', 'storyboard_running'].includes(String(task.stage || ''))) {
      task = {
        ...task,
        status: task.saved_progress === true ? 'working' : 'done',
        stage: contracts.length ? 'keyframe_contract_ready' : 'storyboard_done',
        error: '',
      };
    }
  }
  const context = outputs.context || bundle.task?.request || {};
  return {
    ...bundle,
    task,
    context,
    outputs,
    video_shot_statuses: videoShotStatuses,
    storyboard_status: currentStoryboardStatus,
    keyframe_status: keyframeStatus,
  };
}

/** 构建任务摘要；列表模式禁止读取完整分镜、关键帧和视频输出。 */
function taskSummary(task = {}, { detailed = true } = {}) {
  const outputMap = detailed && task.id
    ? Object.fromEntries(storage.listOutputs(task.id).map(row => [row.kind, row.payload]))
    : {};
  const storyboard = outputMap.storyboard_table || [];
  const keyframes = outputMap.keyframes || [];
  const finalVideo = outputMap.final_video || null;
  const context = outputMap.context || task.request || {};
  const sceneAssets = outputMap.scene_assets || [];
  const firstFrame = keyframes.find(frame => frame?.image_url || frame?.imageUrl || frame?.url) || {};
  const firstScene = sceneAssets[0] || {};
  const finalVideoUrl = finalVideo?.video_url || finalVideo?.videoUrl || task.final_video_url || '';
  let videoShotStatuses = Object.entries(outputMap)
    .filter(([kind]) => String(kind).startsWith('video_shot_status_'))
    .sort(([a], [b]) => Number(a.slice('video_shot_status_'.length)) - Number(b.slice('video_shot_status_'.length)))
    .map(([, payload]) => payload)
    .filter(Boolean);
  if (!videoShotStatuses.length && Array.isArray(outputMap.video_clips)) {
    videoShotStatuses = outputMap.video_clips.map((clip, index) => {
      if (!clip) return null;
      const hasOutput = !!(clip.video_url || clip.videoUrl || clip.file_path);
      const failed = !!clip.error_code || clip.qa?.pass === false || clip.cross_shot_qa?.pass === false;
      return {
        index: index + 1,
        lifecycle: failed ? 'qa_failed' : (clip.qa?.pass === true ? 'qa_passed' : (hasOutput ? 'generated' : 'pending')),
      };
    }).filter(Boolean);
  }
  const storedGenerationProgress = task.generation_progress && typeof task.generation_progress === 'object'
    ? task.generation_progress
    : null;
  const storedVideoProgress = storedGenerationProgress?.stage === 'video' ? storedGenerationProgress : null;
  const videoProgress = storedVideoProgress || (videoShotStatuses.length ? {
    stage: 'video',
    total: Array.isArray(storyboard) ? storyboard.length : videoShotStatuses.length,
    generated: videoShotStatuses.filter(item => ['generated', 'video_qa', 'qa_passed', 'qa_failed'].includes(item.lifecycle)).length,
    qa_passed: videoShotStatuses.filter(item => item.lifecycle === 'qa_passed').length,
    failed: videoShotStatuses.filter(item => ['qa_failed', 'failed'].includes(item.lifecycle)).length,
  } : null);
  const storedStatus = String(task.status || '').toLowerCase();
  const hasFinalOutput = !!finalVideoUrl || /final_video_ready|compose_done/.test(String(task.stage || ''));
  const taskStatus = hasFinalOutput
    ? 'done'
    : (['done', 'completed', 'succeeded', 'ready'].includes(storedStatus) ? 'working' : task.status);
  return {
    id: task.id,
    type: task.type,
    status: taskStatus,
    stage: task.stage,
    title: task.title,
    brief: cleanText(task.brief || '', 220),
    user_id: task.user_id,
    saved_progress: task.saved_progress === true,
    active_stage: task.active_stage || '',
    active_generation_id: task.active_generation_id || '',
    error: cleanText(task.error || '', 300),
    error_code: task.error_code || '',
    retryable: task.retryable === true,
    actor_name: cleanText(context.person_asset?.name || context.person_spec?.displayName || context.person_spec?.roleName || '', 100),
    generation_queued_at: task.generation_queued_at || '',
    generation_started_at: task.generation_started_at || '',
    generation_finished_at: task.generation_finished_at || '',
    generation_progress: storedGenerationProgress || videoProgress,
    shot_count: Number(task.shot_count || 0) || (Array.isArray(storyboard) ? storyboard.length : 0),
    keyframe_count: Number(task.keyframe_count || 0) || (Array.isArray(keyframes) ? keyframes.filter(frame => frame?.image_url || frame?.imageUrl || frame?.url).length : 0),
    thumbnail_url: firstFrame.image_url || firstFrame.imageUrl || firstFrame.url || firstScene.image_url || firstScene.url || task.thumbnail_url || '',
    final_video_url: finalVideoUrl,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}

function listTaskSummaries({ limit = 50, page = 1, status = '', userId = '' } = {}) {
  let tasks = storage.listTaskRows({ status, userId });
  const total = tasks.length;
  const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
  const currentPage = Math.max(1, Number(page) || 1);
  tasks = tasks.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  return {
    total,
    page: currentPage,
    page_size: pageSize,
    tasks: tasks.map(task => taskSummary(task, { detailed: false })),
  };
}

function createTask(body = {}, user = {}) {
  const ctx = withAssetContracts(buildContext(body, user));
  const id = cleanText(body.task_id || body.taskId || '', 80) || uuidv4();
  const task = storage.createTask({
    id,
    title: taskTitle(ctx),
    brief: ctx.brief,
    user_id: ctx.user_id,
    request: ctx,
  });
  storage.saveOutput(id, 'context', ctx);
  storage.saveStage(id, 'created', { status: 'done', output_summary: '任务已创建' });
  return { task, context: ctx };
}

function updateTaskRequest(taskId, body = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const previousCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const ownerId = String(task.user_id || previousCtx.user_id || previousCtx.userId || user.id || user.userId || '').trim();
  const builtCtx = buildContext(
    { ...(task.request || {}), ...(body || {}), task_id: taskId },
    { ...user, id: ownerId, userId: ownerId },
  );
  const savingProgress = body.save_progress === true || body.saveProgress === true;
  const hasActiveGeneration = !!String(task.active_generation_id || '').trim();
  // A progress save can race with a background stage (for example when the
  // user closes an editor while keyframes are running). Never invalidate the
  // stage's inputs/outputs in that case; upstream edits must be applied after
  // the active generation is cancelled or finished.
  const scope = savingProgress && hasActiveGeneration
    ? 'none'
    : revisionService.changeScope(previousCtx, builtCtx, body.change_scope || body.changeScope || '');
  const keepVerifiedPerson = personAssetLifecycle.contractMatchesInput(
    previousCtx.person_contract || previousCtx.person_asset?.person_contract,
    builtCtx.person_asset,
    builtCtx.person_spec || {},
  );
  let ctx = revisionService.applyRevisions(previousCtx, builtCtx, scope);
  if (scope === 'person' || scope === 'source') {
    ctx.person_contract = keepVerifiedPerson
      ? personAssetLifecycle.carryContract(previousCtx.person_contract || previousCtx.person_asset?.person_contract, ctx.revisions?.person)
      : null;
  }
  if (scope === 'product' || scope === 'source') ctx.product_contract = null;
  ctx = withAssetContracts(ctx);
  let invalidated = [];
  const patch = {
    title: taskTitle(ctx),
    brief: ctx.brief,
    request: ctx,
  };
  if (savingProgress) {
    const progressStage = cleanText(body.progress_stage || body.progressStage || task.stage || 'draft', 80) || 'draft';
    if (!hasActiveGeneration) {
      const finalDone = ['final_video_ready', 'done'].includes(progressStage);
      patch.status = finalDone ? (task.status || 'done') : 'working';
      patch.stage = progressStage;
    }
    patch.saved_progress = true;
    patch.saved_progress_at = new Date().toISOString();
    persistProgressSnapshot(taskId, body.progress_snapshot || body.progressSnapshot || {});
  }
  invalidated = revisionService.invalidateOutputs(storage, taskId, scope);
  const previousVoiceSettings = JSON.stringify({
    voice_id: previousCtx.voice_id || '',
    include_voiceover: previousCtx.include_voiceover !== false && !!previousCtx.voice_id,
    voice_volume: Number(previousCtx.voice_volume ?? 1),
  });
  const nextVoiceSettings = JSON.stringify({
    voice_id: ctx.voice_id || '',
    include_voiceover: ctx.include_voiceover !== false && !!ctx.voice_id,
    voice_volume: Number(ctx.voice_volume ?? 1),
  });
  const previousComposeSettings = JSON.stringify({
    bgm_asset: previousCtx.bgm_asset || null,
    bgm_volume: Number(previousCtx.bgm_volume ?? 0.16),
    subtitle: previousCtx.subtitle !== false,
    subtitle_style: previousCtx.subtitle_style || 'popup',
    subtitle_config: previousCtx.subtitle_config || {},
  });
  const nextComposeSettings = JSON.stringify({
    bgm_asset: ctx.bgm_asset || null,
    bgm_volume: Number(ctx.bgm_volume ?? 0.16),
    subtitle: ctx.subtitle !== false,
    subtitle_style: ctx.subtitle_style || 'popup',
    subtitle_config: ctx.subtitle_config || {},
  });
  const mediaInvalidated = previousVoiceSettings !== nextVoiceSettings
    ? ['tts_audio', 'video_clips', 'final_video']
    : (previousComposeSettings !== nextComposeSettings ? ['final_video'] : []);
  mediaInvalidated.forEach(kind => storage.deleteOutput(taskId, kind));
  invalidated = [...new Set([...invalidated, ...mediaInvalidated])];
  const updated = storage.updateTask(taskId, patch);
  storage.saveOutput(taskId, 'context', ctx);
  storage.saveStage(taskId, 'saved', { status: 'done', output_summary: '任务进度已保存' });
  return { task: updated, context: ctx, change_scope: scope, invalidated_outputs: invalidated };
}

async function verifyPersonContract(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  if (!ctx.person_asset) {
    const error = new Error('当前任务没有可验证的人物资产');
    error.code = 'PERSON_ASSET_REQUIRED';
    error.status = 422;
    throw error;
  }
  const contract = await personIdentity.verifyPersonAsset({
    taskId,
    asset: ctx.person_asset,
    spec: ctx.person_spec || {},
    revision: ctx.revisions?.person || ctx.person_asset.person_revision || 1,
    force: true,
  });
  const next = {
    ...ctx,
    person_contract: contract,
    person_asset: {
      ...ctx.person_asset,
      person_revision: contract.person_revision,
      person_contract: contract,
      production_usable_actor: contract.status === 'verified',
    },
  };
  storage.saveOutput(taskId, 'context', next);
  storage.saveOutput(taskId, 'person_contract', contract);
  storage.updateTask(taskId, { request: next });
  return { person_contract: contract, person_asset: next.person_asset };
}

async function verifyProductContract(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const contract = await productIdentity.verifyProductContract({ taskId, ctx });
  const next = { ...ctx, product_contract: contract };
  storage.saveOutput(taskId, 'context', next);
  storage.saveOutput(taskId, 'product_contract', contract);
  storage.updateTask(taskId, { request: next });
  return { product_contract: contract };
}

function normalizeBlueprintDraft(blueprint = {}, seed = '') {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const cleanSpeech = value => cleanText(value, 700).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
  const fallbackSpoken = (beat = {}, index = 0) => {
    const proof = cleanText(beat.visual_proof || beat.evidence || beat.purpose || beat.objective || '', 42);
    const visual = cleanText(beat.visual || beat.story_visual || beat.promo_visual || beat.plot || beat.action || '', 42);
    if (proof) return `这一镜看清${proof}。`;
    if (visual) return `先看${visual}。`;
    return `继续看第 ${index + 1} 镜的关键变化。`;
  };
  return {
    ...blueprint,
    story_title: cleanText(blueprint.story_title || blueprint.title || '剧情广告剧本', 120),
    logline: cleanText(blueprint.logline || blueprint.summary || '', 500),
    characters: normalizeCharacters(Array.isArray(blueprint.characters) ? blueprint.characters : [], seed),
    beats: beats.map((beat, index) => {
      const duration = Math.max(1, Math.min(30, Number(beat.duration || beat.duration_sec || beat.seconds || 0) || 3));
      const visual = cleanText(beat.visual || beat.story_visual || beat.promo_visual || beat.plot || '', 1200);
      const action = cleanText(beat.action || beat.character_action || beat.behavior || '', 800);
      const spoken = cleanSpeech(beat.spoken_line || beat.voiceover || beat.copy || beat.dialogue || fallbackSpoken(beat, index));
      const proof = cleanText(beat.visual_proof || beat.evidence || beat.purpose || beat.objective || '', 800);
      const title = cleanText(beat.title || beat.role || `镜头 ${index + 1}`, 120);
      return {
        ...beat,
        beat_index: index + 1,
        index: index + 1,
        duration,
        duration_sec: duration,
        title,
        role: cleanText(beat.role || title || 'story', 80),
        plot: visual || action || cleanText(beat.plot || '', 1200),
        visual,
        story_visual: visual,
        action,
        spoken_line: spoken,
        voiceover: spoken,
        visual_proof: proof,
        purpose: cleanText(beat.purpose || beat.objective || proof || '', 160),
        confirmed: beat.confirmed !== false,
      };
    }).filter(beat => beat.plot || beat.visual || beat.action || beat.spoken_line || beat.visual_proof),
    edited_at: new Date().toISOString(),
    edited_by_user: true,
  };
}

function updateBlueprint(taskId, blueprint = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const normalized = versionedBlueprint(
    normalizeBlueprintDraft({ ...previous, ...(blueprint || {}) }, `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`),
    previous,
  );
  const changed = !!previous.fingerprint && previous.fingerprint !== normalized.fingerprint;
  storage.saveOutput(taskId, 'blueprint', normalized);
  if (changed) {
    ['keyframe_contracts', 'keyframes', 'tts_audio', 'video_clips', 'final_video'].forEach(kind => storage.deleteOutput(taskId, kind));
    const storyboardMeta = storage.getOutput(taskId, 'storyboard_meta');
    if (storyboardMeta) {
      storage.saveOutput(taskId, 'storyboard_meta', {
        ...storyboardMeta,
        status: 'stale',
        stale_reason: 'BLUEPRINT_EDITED',
        current_blueprint_revision: Number(normalized.revision || 0),
        current_blueprint_fingerprint: normalized.fingerprint || '',
      });
    }
  }
  storage.saveStage(taskId, 'blueprint', {
    status: 'done',
    output_summary: `${normalized.beats.length} script shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done', error: '', error_code: '', retryable: false });
  return normalized;
}

function normalizeStoryboardShot(shot = {}, index = 0, previousShot = {}) {
  const duration = Math.max(1, Math.min(15, Number(shot.duration || shot.duration_sec || 0) || 3));
  const visual = cleanText(shot.visual || shot.visual_description || shot.content_prompt || '', 1400);
  const action = cleanText(shot.action || shot.visual_action || '', 900);
  const voiceover = cleanText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 700).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
  const title = cleanText(shot.title || `Shot ${index + 1}`, 140);
  const purpose = cleanText(shot.purpose || shot.objective || shot.role || '', 160);
  const previousVisual = cleanText(previousShot.visual || previousShot.visual_description || previousShot.content_prompt || '', 1400);
  const incomingEditedFields = shot._nsa_user_edited_fields && typeof shot._nsa_user_edited_fields === 'object'
    ? shot._nsa_user_edited_fields
    : {};
  const visualChanged = !!visual && !!previousVisual && visual !== previousVisual;
  const userVisualOverride = shot.user_visual_override === true || incomingEditedFields.visual === true || visualChanged;
  const editedFields = userVisualOverride ? { ...incomingEditedFields, visual: true } : incomingEditedFields;
  const design = shotDesign.normalizeShotDesign(shot);
  return {
    ...shot,
    _prompt_preview: undefined,
    index: index + 1,
    shot_index: index + 1,
    duration,
    duration_sec: duration,
    title,
    visual,
    visual_description: visual,
    content_prompt: visual,
    action,
    visual_action: action,
    voiceover,
    narration: voiceover,
    purpose,
    keyframe_notes: userVisualOverride ? [purpose, visual].filter(Boolean).join('\n') : cleanText(shot.keyframe_notes || '', 900),
    material_usage: userVisualOverride ? [purpose, visual].filter(Boolean).join('\n') : cleanText(shot.material_usage || '', 900),
    user_visual_override: userVisualOverride || undefined,
    _nsa_user_edited_fields: Object.keys(editedFields).length ? editedFields : undefined,
    scene_id: cleanText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || previousShot.scene_id || '', 120) || undefined,
    scene_asset_id: cleanText(shot.scene_asset_id || shot.sceneAssetId || shot.scene_id || shot.sceneId || previousShot.scene_asset_id || '', 120) || undefined,
    scene_name: cleanText(shot.scene_name || shot.sceneName || previousShot.scene_name || '', 120) || undefined,
    scene_view: cleanText(shot.scene_view || shot.sceneView || previousShot.scene_view || '', 40) || undefined,
    scene_zone: cleanText(shot.scene_zone || shot.sceneZone || shot.zone || previousShot.scene_zone || '', 160) || undefined,
    scene_zone_id: cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : '') || previousShot.scene_zone_id || '', 100) || undefined,
    scene_zone_label_zh: cleanText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || previousShot.scene_zone_label_zh || previousShot.scene_zone || '', 160) || undefined,
    zone_ids: Array.isArray(shot.zone_ids) ? shot.zone_ids : (Array.isArray(previousShot.zone_ids) ? previousShot.zone_ids : undefined),
    anchor_ids: Array.isArray(shot.anchor_ids) ? shot.anchor_ids : (Array.isArray(previousShot.anchor_ids) ? previousShot.anchor_ids : undefined),
    transition_from: cleanText(shot.transition_from || shot.transitionFrom || previousShot.transition_from || '', 120) || undefined,
    transition_reason: cleanText(shot.transition_reason || shot.transitionReason || previousShot.transition_reason || '', 240) || undefined,
    requires_previous_frame: shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
      || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true',
    shot_scope: design.shot_scope,
    surface_topology: design.surface_topology,
    motion_effect: design.motion_effect,
    edited_at: new Date().toISOString(),
  };
}

function updateStoryboardTable(taskId, shots = [], user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const current = storage.getOutput(taskId, 'storyboard_table') || [];
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const source = Array.isArray(shots) && shots.length ? shots : current;
  const normalizedRaw = source
    .map((shot, index) => normalizeStoryboardShot(shot, index, current[index] || {}))
    .filter(shot => shot.visual || shot.action || shot.voiceover || shot.title);
  const normalized = withContinuityContracts(bindShotsToScenes(normalizedRaw, Array.isArray(sceneAssets) ? sceneAssets : []));
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  storage.saveOutput(taskId, 'storyboard_table', normalized);
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'ready',
    source: 'user_edit',
    blueprint_revision: Number(blueprint.revision || 0),
    blueprint_fingerprint: blueprint.fingerprint || blueprintFingerprint(blueprint),
    completed_at: new Date().toISOString(),
  });
  storage.deleteOutput(taskId, 'storyboard_checkpoint');
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(normalized));
  const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const contracts = buildKeyframeContracts(contractCtx, normalized);
  persistKeyframeContracts(taskId, contracts, { clearDownstream: true });
  storage.saveStage(taskId, 'storyboard', {
    status: 'done',
    output_summary: `${normalized.length} storyboard shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} keyframe contracts rebuilt` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready', error: '', error_code: '', retryable: false });
  return { shots: normalized, keyframe_contracts: contracts };
}

async function generateSceneConfig(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  storage.updateTask(taskId, { status: 'running', stage: 'scene_config' });
  storage.saveStage(taskId, 'scene_config', { status: 'running', input_summary: ctx.brief });
  const systemPrompt = [
    '你是剧情广告场景配置 agent。只输出 JSON 对象。',
    '你的职责是把用户需求整理成业务边界、主体、人物模式、素材使用、禁止项和建议镜头策略。',
    '不能自行继承旧任务、不能写固定行业模板。',
    '人物模式必须按用户需求判断：允许 single、dual、multi、no_human、animal、auto。无人广告不得强行加入真人；动物/宠物主体不得改成人类角色。',
  ].join('\n');
  const userPrompt = `${contextPrompt(ctx)}

输出 JSON：
{
  "business_boundary": "本任务只允许使用的业务/行业/主体边界",
  "advertised_subject": "广告主体",
  "cast_mode": "single/dual/multi/no_human/animal/auto",
  "asset_strategy": [{"asset_id":"素材ID","usage":"如何使用"}],
  "story_strategy": ["剧情策略"],
  "forbidden": ["禁止项"],
  "suggested_shot_count": 5
}`;
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.scene_config',
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
  });
  const sceneConfig = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  sceneConfig.model_meta = {
    used_model: result.used_model,
    fallback_used: result.fallback_used,
    failed_models: result.failed_models,
  };
  storage.saveOutput(taskId, 'scene_config', sceneConfig);
  storage.saveStage(taskId, 'scene_config', { status: 'done', output_summary: '场景配置已生成', diagnostics: sceneConfig.model_meta });
  storage.updateTask(taskId, { status: 'running', stage: 'scene_config_done' });
  return sceneConfig;
}

async function generateBlueprintStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint' });
  storage.saveStage(taskId, 'blueprint', { status: 'running', input_summary: ctx.brief });
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const blueprint = versionedBlueprint(await generateBlueprint(ctx, { taskId }), previous);
  storage.saveOutput(taskId, 'blueprint', blueprint);
  storage.saveStage(taskId, 'blueprint', { status: 'done', output_summary: `${blueprint.beats?.length || 0} 个剧情 beat`, diagnostics: blueprint.model_meta || {} });
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done' });
  return blueprint;
}

async function generateStoryboardStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  let blueprint = storage.getOutput(taskId, 'blueprint');
  if (!blueprint) blueprint = await generateBlueprintStage(taskId);
  if (!blueprint.fingerprint) {
    blueprint = versionedBlueprint(blueprint, {});
    storage.saveOutput(taskId, 'blueprint', blueprint);
  }
  const sourceFingerprint = blueprint.fingerprint;
  const sourceRevision = Number(blueprint.revision || 1);
  const savedCheckpoint = storage.getOutput(taskId, 'storyboard_checkpoint') || null;
  const resumeShots = savedCheckpoint?.blueprint_fingerprint === sourceFingerprint && Array.isArray(savedCheckpoint.shots)
    ? savedCheckpoint.shots
    : [];
  const characterSeed = `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`;
  const stageCtx = {
    ...ctx,
    scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
    expected_storyboard_count: Array.isArray(blueprint.beats) && blueprint.beats.length
      ? blueprint.beats.length
      : Number(ctx.shot_count || 0),
    characters: normalizeCharacters(Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters, characterSeed),
  };
  storage.updateTask(taskId, { status: 'running', stage: 'storyboard' });
  storage.saveStage(taskId, 'storyboard', { status: 'running', input_summary: `${blueprint.beats?.length || 0} beats` });
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'running',
    source: 'generated',
    blueprint_revision: sourceRevision,
    blueprint_fingerprint: sourceFingerprint,
    started_at: new Date().toISOString(),
  });
  const saveCheckpoint = async ({ phase = 'running', shots = [], completed_indexes = [], expected_total = 0 } = {}) => {
    storage.saveOutput(taskId, 'storyboard_checkpoint', {
      schema_version: 1,
      status: 'running',
      phase,
      blueprint_revision: sourceRevision,
      blueprint_fingerprint: sourceFingerprint,
      expected_total: Number(expected_total || blueprint.beats?.length || 0),
      completed_count: completed_indexes.length || shots.length,
      completed_indexes,
      shots,
      updated_at: new Date().toISOString(),
    });
    storage.updateTask(taskId, {
      generation_progress: {
        stage: 'storyboard',
        status: 'running',
        phase,
        processed: completed_indexes.length || shots.length,
        target_total: Number(expected_total || blueprint.beats?.length || 0),
        updated_at: new Date().toISOString(),
      },
    });
  };
  const assertBlueprintUnchanged = () => {
    const current = storage.getOutput(taskId, 'blueprint') || {};
    const currentFingerprint = current.fingerprint || blueprintFingerprint(current);
    if (currentFingerprint === sourceFingerprint) return;
    const error = new Error('剧本在分镜生成期间发生了修改，本次结果未覆盖新剧本，请重新生成分镜');
    error.code = 'BLUEPRINT_CHANGED_DURING_STORYBOARD';
    error.retryable = true;
    throw error;
  };
  const generated = await generateStoryboardTable(stageCtx, blueprint, {
    taskId,
    resumeShots,
    onCheckpoint: saveCheckpoint,
  });
  let shots = generated.shots;
  await saveCheckpoint({ phase: 'reviewing', shots, completed_indexes: shots.map(shot => Number(shot.index || 0)), expected_total: shots.length });
  assertBlueprintUnchanged();
  let review = await reviewStoryboard(stageCtx, shots, { taskId });
  storage.saveReview(taskId, 'storyboard.initial', review);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const issues = [
      ...(review.blocking_issues || []),
      ...(review.rewrite_issues || []),
    ];
    if (!shots.length || !issues.length) break;
    shots = await rewriteStoryboard(stageCtx, blueprint, shots, issues, { taskId });
    await saveCheckpoint({ phase: `rewrite_${attempt}_reviewing`, shots, completed_indexes: shots.map(shot => Number(shot.index || 0)), expected_total: shots.length });
    assertBlueprintUnchanged();
    const nextReview = await reviewStoryboard(stageCtx, shots, { taskId });
    storage.saveReview(taskId, `storyboard.rewrite.${attempt}`, nextReview);
    review = nextReview;
    if (!review.blocking_issues.length && !review.rewrite_issues.length) break;
  }
  if (review.blocking_issues.length) {
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveOutput(taskId, 'storyboard_meta', {
      status: 'failed',
      source: 'generated',
      blueprint_revision: sourceRevision,
      blueprint_fingerprint: sourceFingerprint,
      completed_at: new Date().toISOString(),
    });
    storage.deleteOutput(taskId, 'storyboard_checkpoint');
    storage.saveStage(taskId, 'storyboard', { status: 'failed', error: review.blocking_issues.join('；'), diagnostics: review });
    storage.updateTask(taskId, { status: 'failed', stage: 'storyboard_failed', error: review.blocking_issues.join('；') });
    const err = new Error(`剧情广告分镜硬阻断：${review.blocking_issues.join('；')}`);
    err.review = review;
    err.partial = shots;
    throw err;
  }
  assertBlueprintUnchanged();
  const contracts = buildKeyframeContracts(stageCtx, shots);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'ready',
    source: 'generated',
    blueprint_revision: sourceRevision,
    blueprint_fingerprint: sourceFingerprint,
    completed_at: new Date().toISOString(),
  });
  storage.deleteOutput(taskId, 'storyboard_checkpoint');
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(shots));
  storage.saveOutput(taskId, 'quality_review', review);
  persistKeyframeContracts(taskId, contracts);
  storage.saveStage(taskId, 'storyboard', { status: 'done', output_summary: `${shots.length} 个镜头`, diagnostics: review });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, {
    status: 'done',
    stage: 'keyframe_contract_ready',
    diagnostics: diagnostics.summarizeTask({ task, review }),
  });
  return { shots, review, keyframe_contracts: contracts, model_meta: generated.model_meta };
}

async function buildKeyframeContractStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) throw new Error('请先生成分镜表');
  shots = bindShotsToScenes(shots, ctx.scene_assets);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  const contracts = buildKeyframeContracts(ctx, shots);
  persistKeyframeContracts(taskId, contracts);
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready' });
  return contracts;
}

function acceptedKeyframeContextAt(keyframes = [], index = -1) {
  if (!Array.isArray(keyframes) || !Number.isInteger(index) || index < 0) return null;
  const frame = keyframes[index] || {};
  if (!hasUsablePreviousKeyframe(frame)) return null;
  return {
    index: index + 1,
    title: frame.title || `Shot ${index + 1}`,
    image_url: keyframeImageUrl(frame),
    prompt: cleanText(frame.prompt || '', 700),
  };
}

function continuityCharacterKeys(ctx = {}, shot = {}, contract = {}) {
  const values = [
    ...(Array.isArray(shot.characters) ? shot.characters : []),
    ...(Array.isArray(contract?.cast_lock?.shot_characters) ? contract.cast_lock.shot_characters : []),
  ];
  const keys = values.map(value => cleanText(value?.id || value?.name || value?.role || value, 120).toLowerCase()).filter(Boolean);
  if (!keys.length && personIdentity.shotPersonRequired(ctx, shot, contract)) keys.push('__locked_person__');
  return [...new Set(keys)].sort();
}

function continuitySceneKey(shot = {}, contract = {}) {
  return cleanText(
    contract?.scene_lock?.scene_id
      || contract?.scene_lock?.scene_zone_id
      || shot.scene_id
      || shot.sceneId
      || shot.scene_asset_id
      || shot.sceneAssetId
      || '',
    160,
  ).toLowerCase();
}

function hasHardPreviousContinuity(shot = {}, contract = {}) {
  const lock = contract?.continuity_lock || shot.continuity || {};
  const transitionType = cleanText(lock.transition_type || shot.transition_type || '', 80).toLowerCase();
  // continuity_from/entry_frame_state are auto-populated on most storyboards,
  // so treating those fields alone as hard dependencies would serialize every
  // shot. Only transitions that visually bridge adjacent frames force an
  // immediate parent; shared scene/cast dependencies are handled separately.
  const explicitlyRequired = lock.requires_previous_frame === true || shot.requires_previous_frame === true
    || shot.requiresPreviousFrame === true;
  return explicitlyRequired || /match|cut.?on.?action|continuous|动作接续|状态接续|连续/i.test(transitionType);
}

function buildKeyframeDependencyPlan(shots = [], contracts = [], ctx = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const verifiedSceneKeys = new Set((Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [])
    .filter(completeSpaceLock)
    .map((asset, index) => cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 160).toLowerCase())
    .filter(Boolean));
  const personContract = ctx.person_contract || ctx.person_asset?.person_contract || {};
  const verifiedPersonAnchor = personContract.status === 'verified' && personContract.cross_view_qa?.pass === true;
  const castMode = cleanText(ctx.cast_mode || ctx.person_asset?.cast_mode || 'single', 40).toLowerCase();
  const verifiedCharacterKeys = new Set();
  const addCharacterKey = value => {
    const key = cleanText(value?.id || value?.actor_id || value?.name || value?.displayName || value?.role || value, 120).toLowerCase();
    if (key) verifiedCharacterKeys.add(key);
  };
  if (verifiedPersonAnchor && castMode === 'single') {
    verifiedCharacterKeys.add('__locked_person__');
    [ctx.person_asset, ctx.person_spec, ...(Array.isArray(ctx.characters) ? ctx.characters : []), ...(Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length === 1 ? ctx.cast_profiles : [])]
      .filter(Boolean).forEach(addCharacterKey);
    if (ctx.person_spec?.displayName) addCharacterKey(ctx.person_spec.displayName);
    if (ctx.person_spec?.roleName) addCharacterKey(ctx.person_spec.roleName);
  }
  const multiActorSources = [
    ...(Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : []),
    ...(Array.isArray(ctx.person_asset?.cast_assets) ? ctx.person_asset.cast_assets : []),
  ];
  multiActorSources.forEach(actor => {
    const contract = actor?.person_contract || actor?.contract || {};
    const hasReference = !!(actor?.image_url || actor?.url || actor?.reference_image_url || (Array.isArray(actor?.view_images) && actor.view_images.length));
    if (hasReference && contract.status === 'verified' && contract.cross_view_qa?.pass === true) addCharacterKey(actor);
  });
  const descriptors = list.map((shot, index) => ({
    index,
    scene: continuitySceneKey(shot || {}, contracts[index] || {}),
    characters: continuityCharacterKeys(ctx, shot || {}, contracts[index] || {}),
    hardPrevious: index > 0 && hasHardPreviousContinuity(shot || {}, contracts[index] || {}),
    anchorKeys: {
      scene: continuitySceneKey(shot || {}, contracts[index] || {}),
      characters: continuityCharacterKeys(ctx, shot || {}, contracts[index] || {}),
    },
  }));
  const dependencies = {};
  const reasons = {};
  for (let index = 0; index < descriptors.length; index += 1) {
    const current = descriptors[index];
    if (index === 0) {
      dependencies[index] = null;
      reasons[index] = 'root';
      continue;
    }
    if (current.hardPrevious) {
      dependencies[index] = index - 1;
      reasons[index] = 'temporal_continuity';
      continue;
    }
    let dependency = null;
    let reason = 'independent_with_shared_anchors';
    const metadataUnknown = !current.scene && !current.characters.length;
    const sceneAnchored = !current.scene || verifiedSceneKeys.has(current.scene);
    const personAnchored = !current.characters.length || current.characters.every(key => (
      verifiedCharacterKeys.has(key) || (castMode === 'single' && verifiedPersonAnchor)
    ));
    if (metadataUnknown) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (!descriptors[previous].scene && !descriptors[previous].characters.length) {
          dependency = previous;
          reason = 'continuity_metadata_unavailable';
          break;
        }
      }
    }
    if (dependency === null && (!sceneAnchored || !personAnchored)) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const candidate = descriptors[previous];
        const sameUnanchoredScene = !sceneAnchored && !!(current.scene && candidate.scene && current.scene === candidate.scene);
        const sharedUnanchoredCharacter = !personAnchored && current.characters.some(key => candidate.characters.includes(key));
        if (sameUnanchoredScene || sharedUnanchoredCharacter) {
          dependency = previous;
          reason = sameUnanchoredScene ? 'scene_anchor_unavailable' : 'person_anchor_unavailable';
          break;
        }
      }
    }
    dependencies[index] = dependency;
    reasons[index] = dependency === null ? 'independent_with_shared_anchors' : reason;
  }
  return { dependencies, reasons, descriptors, verified_anchors: { scenes: [...verifiedSceneKeys], person: verifiedPersonAnchor, characters: [...verifiedCharacterKeys] } };
}

function sceneAssetForShot(ctx = {}, shot = {}, index = 0) {
  const assets = Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [];
  return selectSceneAsset(assets, shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', index);
}

function sceneAssetPrompt(asset = {}, options = {}) {
  if (!asset || typeof asset !== 'object') return '';
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  const assetSurfaceTopology = asset.surface_topology || asset.surfaceTopology;
  const rawSurfaceContract = options.includeSurfaceContract !== false && assetSurfaceTopology
    ? shotDesign.surfacePrompt(assetSurfaceTopology, 'auto')
    : '';
  const surfaceContract = rawSurfaceContract
    ? rawSurfaceContract.split('\n').map(line => `Master environment only — ${line}`).join('\n')
    : '';
  const fullSpaceLock = completeSpaceLock(asset);
  const spatialQa = asset.scene_contract?.spatial_coverage_qa || asset.spatial_coverage_qa || {};
  const layoutReference = layoutSceneReference(asset);
  return [
    `Locked scene asset: ${cleanText(asset.name || asset.scene_id || asset.id || 'task scene', 120)}`,
    asset.lock_strength ? `Scene lock strength: ${cleanText(asset.lock_strength, 60)}` : '',
    asset.material_summary ? `Scene material lock: ${cleanText(asset.material_summary, 600)}` : '',
    asset.layout_summary ? `Scene layout lock: ${cleanText(asset.layout_summary, 600)}` : '',
    asset.style_summary ? `Scene style lock: ${cleanText(asset.style_summary, 360)}` : '',
    views.length ? `Scene reference images attached by role: ${cleanText(views.map(view => view.key || view.label || 'view').join(', '), 160)}` : '',
    `Spatial lock state: ${fullSpaceLock ? 'complete and verified' : 'incomplete; do not invent unseen space'}`,
    layoutReference?.url ? 'An auxiliary whole-space layout reference is attached when reference capacity permits. Use it for topology and zone relationships, never as the commercial camera composition.' : '',
    fullSpaceLock ? `Spatial coverage scores: layout ${Number(spatialQa.layout_topology_score || 0).toFixed(2)}, camera diversity ${Number(spatialQa.camera_diversity_score || 0).toFixed(2)}, reverse coverage ${Number(spatialQa.reverse_coverage_score || 0).toFixed(2)}, interaction zone ${Number(spatialQa.interaction_zone_score || 0).toFixed(2)}.` : '',
    asset.negative ? `Scene asset negative reference: ${cleanText(asset.negative, 360)}. In final keyframes, keep these as space-quality constraints only; do not apply "empty scene/no people" when the storyboard requires the locked actor.` : '',
    surfaceContract ? `Scene asset surface construction contract:\n${surfaceContract}` : '',
    'Keep the same scene identity, layout logic, material family, lighting direction and commercial realism across shots. Do not switch to another unrelated space.',
  ].filter(Boolean).join('\n');
}

function buildKeyframePrompt(ctx = {}, shot = {}, contract = {}, index = 0, options = {}) {
  const visualContract = contract.visual_contract || {};
  const sceneLock = contract.scene_lock || null;
  const continuityLock = contract.continuity_lock || shot.continuity || {};
  const transitionType = cleanText(continuityLock.transition_type || 'hard_cut', 40).toLowerCase();
  const inheritsPreviousState = continuityLock.requires_previous_frame === true || ['cut_on_action', 'match_cut'].includes(transitionType);
  const continuityText = [
    inheritsPreviousState && continuityLock.continuity_from ? `Continuity from: ${cleanText(continuityLock.continuity_from, 100)}` : '',
    inheritsPreviousState && continuityLock.entry_frame_state ? `Entry frame state: ${cleanText(continuityLock.entry_frame_state, 260)}` : '',
    continuityLock.exit_frame_state ? `Exit frame state: ${cleanText(continuityLock.exit_frame_state, 260)}` : '',
    inheritsPreviousState && (continuityLock.action_start || continuityLock.action_end) ? `Action start/end: ${cleanText(continuityLock.action_start, 180)} -> ${cleanText(continuityLock.action_end, 180)}` : '',
    continuityLock.screen_direction ? `Screen direction: ${cleanText(continuityLock.screen_direction, 80)}` : '',
    continuityLock.eyeline ? `Eyeline: ${cleanText(continuityLock.eyeline, 100)}` : '',
    continuityLock.camera_axis ? `Camera axis: ${cleanText(continuityLock.camera_axis, 100)}` : '',
    continuityLock.camera_movement ? `Camera movement: ${cleanText(continuityLock.camera_movement, 140)}` : '',
    continuityLock.object_states ? `Object state lock: ${cleanText(continuityLock.object_states, 260)}` : '',
    (continuityLock.transition_type || continuityLock.transition_reason)
      ? `Transition: ${cleanText(continuityLock.transition_type || 'hard_cut', 40)}; ${cleanText(continuityLock.transition_reason, 180)}`
      : '',
    continuityLock.requires_previous_frame === true ? 'Requires previous frame: yes' : '',
  ].filter(Boolean).join('\n');
  const personAsset = ctx.person_asset || {};
  const personSpec = ctx.person_spec || {};
  const actorViews = Array.isArray(personAsset.view_images) ? personAsset.view_images : [];
  const visualText = cleanText(shot.visual || shot.content_prompt || '', 900);
  const userVisualOverride = shot.user_visual_override === true || shot._nsa_user_edited_fields?.visual === true;
  const actionText = cleanText(shot.action || shot.visual_action || '', 500);
  const design = shotDesign.normalizeShotDesign(shot);
  const surfaceDesignText = shotDesign.surfacePrompt(design.surface_topology, design.shot_scope);
  const keyframeEffectText = shotDesign.keyframeEffectPrompt(design.motion_effect);
  const interactionRequested = /指向|伸手|食指|点击|点按|触摸|滑动|操作|按下|拿起|握住|放置|递给|注视|凝视|point|tap|touch|swipe|operate|press|pick up|hold|place|hand over|look at|gaze/i
    .test([visualText, actionText].filter(Boolean).join(' '));
  const interactionGroundingText = interactionRequested
    ? 'Visible interaction grounding is mandatory: every pointing, touching, operating, holding or gaze action must connect to a clearly visible, physically reachable target from this shot, such as the specified product, prop, control, screen, table or interface. Align fingertip, hand and eyeline with the same target. Never point, tap or gesture into empty air. If the requested target cannot be shown coherently, use a natural grounded pose with hands resting on or holding a visible task object.'
    : '';
  const previousFrame = options.previousFrame || null;
  const sceneAsset = options.sceneAsset || sceneAssetForShot(ctx, shot, index);
  const includeSceneSurfaceContract = !design.surface_topology || design.shot_scope === 'product_comparison';
  const sceneReferenceText = sceneAssetPrompt(sceneAsset, { includeSurfaceContract: includeSceneSurfaceContract });
  const sceneBindingText = sceneLock ? [
    `Shot scene binding: ${cleanText(sceneLock.scene_id || '', 120)} / ${cleanText(sceneLock.scene_name || '', 120)}`,
    sceneLock.scene_view ? `Required scene view: ${cleanText(sceneLock.scene_view, 40)}` : '',
    Array.isArray(sceneLock.anchor_ids) && sceneLock.anchor_ids.length ? `Required visible scene anchors: ${cleanText(sceneLock.anchor_ids.join(', '), 500)}` : '',
    sceneLock.scene_zone_id ? `Required scene zone ID (stable binding, do not reinterpret): ${cleanText(sceneLock.scene_zone_id, 100)}` : '',
    Array.isArray(sceneLock.zone_ids) && sceneLock.zone_ids.length ? `Required scene zone IDs: ${cleanText(sceneLock.zone_ids.join(', '), 400)}` : '',
    (sceneLock.scene_zone_label_zh || sceneLock.scene_zone) ? `Required scene zone description: ${cleanText(sceneLock.scene_zone_label_zh || sceneLock.scene_zone, 160)}` : '',
    sceneLock.transition_from ? `Transition from: ${cleanText(sceneLock.transition_from, 120)}` : '',
    sceneLock.transition_reason ? `Transition reason: ${cleanText(sceneLock.transition_reason, 240)}` : '',
    'The keyframe must be generated inside this bound task scene. Do not move the shot into another location or another industry setting.',
  ].filter(Boolean).join('\n') : '';
  const personPresence = personIdentity.shotPersonPresence(shot, contract);
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
  const shotNeedsProduct = productIdentity.shotProductRequired(ctx, shot, contract);
  const personContract = ctx.person_contract || personAsset.person_contract || {};
  const productContract = ctx.product_contract || {};
  const actorReferenceText = [
    (personSpec.wardrobeText || personContract.wardrobe?.description) ? `Actor wardrobe lock: ${cleanText(personSpec.wardrobeText || personContract.wardrobe?.description, 520)}` : '',
    (personSpec.appearanceText || personContract.identity?.face_description) ? `Actor identity and appearance lock: ${cleanText(personSpec.appearanceText || personContract.identity?.face_description, 420)}` : '',
    (personSpec.hairMakeupText || personContract.appearance?.hair_style) ? `Actor hair and makeup lock: ${cleanText(personSpec.hairMakeupText || personContract.appearance?.hair_style, 320)}` : '',
    personAsset.name ? `Actor name: ${cleanText(personSpec.displayName || personAsset.name, 120)}` : '',
    !personSpec.wardrobeText && personAsset.description ? `Actor appearance and wardrobe lock: ${cleanText(personAsset.description, 520)}` : '',
    actorViews.length ? `Actor reference images attached by role: ${cleanText(actorViews.map(v => v.key || v.label || 'view').join(', '), 160)}` : '',
  ].filter(Boolean).join('\n');
  const productReferenceText = shotNeedsProduct ? [
    productContract.identity?.description ? `Product identity lock: ${cleanText(productContract.identity.description, 360)}${Array.isArray(productContract.reference_images) && productContract.reference_images.length ? `; ${productContract.reference_images.length} reference images attached` : ''}` : '',
    productContract.identity?.shape ? `Product shape lock: ${cleanText(productContract.identity.shape, 180)}` : '',
    productContract.identity?.material ? `Product material lock: ${cleanText(productContract.identity.material, 180)}` : '',
    Array.isArray(productContract.identity?.dominant_colors) && productContract.identity.dominant_colors.length
      ? `Product color lock: ${cleanText(productContract.identity.dominant_colors.join(', '), 140)}` : '',
    !productContract.identity?.description && Array.isArray(productContract.reference_images) && productContract.reference_images.length
      ? `Product reference images attached: ${productContract.reference_images.length}` : '',
  ].filter(Boolean).join('\n') : '';
  const parts = [
    'Photorealistic live-action commercial storyboard keyframe.',
    `Campaign brief: ${cleanText(ctx.brief, 900)}`,
    `Advertised subject: ${cleanText(ctx.product_subject, 160)}`,
    `Shot ${index + 1}: ${cleanText(shot.title || '', 120)}`,
    userVisualOverride ? `User-edited visual override, highest priority: ${visualText}` : '',
    userVisualOverride ? 'User override mode: rebuild the keyframe from the edited visual and current style controls. Keep the current shot action when it is physically compatible with the edited visual; minimally adapt only to make the action plausible and visibly grounded.' : '',
    `Visual: ${visualText}`,
    userVisualOverride
      ? `Current shot action: ${actionText || 'use a natural, physically grounded pose that supports the edited visual'}`
      : `Action: ${actionText}`,
    interactionGroundingText,
    surfaceDesignText,
    keyframeEffectText,
    `Dialogue or copy: ${cleanText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 300)}`,
    !userVisualOverride && visualContract.composition ? `Composition: ${cleanText(visualContract.composition, 300)}` : '',
    !userVisualOverride && visualContract.subject ? `Subject lock: ${cleanText(visualContract.subject, 300)}` : '',
    !userVisualOverride && visualContract.evidence ? `Commercial evidence: ${cleanText(visualContract.evidence, 300)}` : '',
    visualContract.style ? `Style: ${cleanText(visualContract.style, 260)}` : '',
    visualContract.scene_direction && visualContract.scene_direction !== 'auto' ? `Scene direction: ${cleanText(visualContract.scene_direction, 80)}` : '',
    visualContract.custom_scene_requirement ? `Custom scene requirement: ${cleanText(visualContract.custom_scene_requirement, 240)}` : '',
    !userVisualOverride && shotNeedsProduct ? `Product visibility: required, presence ${cleanText(visualContract.product_presence || 'medium', 40)}, lock ${cleanText(visualContract.product_lock_strength || 'standard', 40)}.` : '',
    !userVisualOverride && shotNeedsProduct && Array.isArray(visualContract.product_methods) && visualContract.product_methods.length ? `Product presentation methods: ${cleanText(visualContract.product_methods.join(', '), 240)}` : '',
    productReferenceText,
    visualContract.style_direction ? `Visual style direction: ${cleanText(visualContract.style_direction, 360)}` : '',
    visualContract.negative_requirements ? `Negative visual requirements: ${cleanText(visualContract.negative_requirements, 360)}` : '',
    Array.isArray(shot.characters) && shot.characters.length ? `Characters: ${cleanText(JSON.stringify(shot.characters), 500)}` : '',
    continuityText ? `Strict shot continuity lock:\n${continuityText}` : '',
    sceneBindingText ? `Storyboard scene binding lock:\n${sceneBindingText}` : '',
    sceneReferenceText ? `Strict scene consistency lock:\n${sceneReferenceText}` : '',
    shotNeedsPerson && ctx.person_asset ? `Locked real actor/person asset: ${cleanText(personAsset.id || personAsset.actor_asset_id || personAsset.name || 'verified actor', 160)}; person revision ${Number(ctx.person_contract?.person_revision || personAsset.person_revision || 1) || 1}.` : '',
    shotNeedsPerson ? `Person QA required for this shot (${personPresence.mode}). Any visible face, body, hand, sleeve, reflection or silhouette must be verified against the locked actor reference.` : '',
    personForbidden ? 'Explicit no-human lock: no human face, body, hand, finger, arm, worn sleeve, reflection or silhouette may appear anywhere in this keyframe.' : '',
    shotNeedsPerson && actorReferenceText ? 'If the shot includes any body part, hand, sleeve, reflection or partial figure, it must belong to the same locked actor identity and the same wardrobe family from the actor reference. Do not invent a different sleeve, hand, age, body shape, hair, skin tone, outfit color or fashion style.' : '',
    shotNeedsPerson && actorReferenceText ? `Strict actor consistency lock:\n${actorReferenceText}` : '',
    shotNeedsPerson && actorReferenceText ? 'A hand-only or partial-person frame is allowed only when this storyboard explicitly requires that visible body part and it remains bound to the locked actor. A no-person shot forbids hands and sleeves too.' : '',
    shotNeedsPerson && Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length ? `Locked cast profiles: ${cleanText(JSON.stringify(ctx.cast_profiles), 1200)}` : '',
    shotNeedsPerson && ctx.person_context?.real_person_locked ? 'Use the uploaded/authorized real-person reference as the identity and appearance lock. Preserve face identity, age impression, body proportions, wardrobe family and natural real-camera skin texture.' : '',
    Array.isArray(ctx.forbidden) && ctx.forbidden.length ? `Forbidden: ${cleanText(ctx.forbidden.join('; '), 400)}` : '',
    userVisualOverride ? 'The edited visual is the only source of truth for object layout, surface type, carrier, material form and composition.' : '',
    previousFrame ? `Continuity reference from previous accepted keyframe: shot ${previousFrame.index}, title ${cleanText(previousFrame.title, 120)}, image ${previousFrame.image_url}. Match its lighting mood, material realism, framing discipline and commercial tone only where compatible with the edited visual.` : '',
    !userVisualOverride && previousFrame?.prompt ? `Previous keyframe prompt summary for continuity only: ${cleanText(previousFrame.prompt, 500)}` : '',
    userVisualOverride ? `Final priority: generate only this edited visual: ${visualText}. Any composition, object layout, carrier and material form must come from this edited visual, not from cached or generated fields.` : '',
    // 通用语义忠实约束：防止模型把抽象业务词擅自转成无关行业画面。
    'Semantic fidelity rule: visualize the current task brief, advertised subject, locked scene asset and current shot action literally. Do not replace an abstract business concept with unrelated industry symbols, charts, trading screens, stock-market dashboards, generic finance UI, random data walls or abstract technology panels unless the user brief or the edited shot explicitly asks for that visual category.',
    'If the task mentions software, data, platform, token, efficiency, service or any other abstract concept, ground it in the user-described product/service usage, real objects, people, workflow, interface, environment or scene asset from this task. Never infer a different industry, business case, venue, carrier form or visual metaphor on your own.',
    'Use a real camera look, natural light, realistic skin and materials, no cartoon, no anime, no 3D render, no poster text, no watermark.',
  ];
  return compactKeyframePrompt(parts);
}

// Image providers commonly cap prompts around 2,500 characters. Keep every
// task-specific constraint category, but give the visual/action and identity
// locks more room than explanatory prose. This is semantic compaction, not an
// industry template and not a blind tail cut.
function compactKeyframePrompt(parts = [], maxChars = 2400) {
  const lines = (Array.isArray(parts) ? parts : [parts])
    .filter(Boolean)
    .flatMap(value => String(value).split(/\r?\n/))
    .map(value => cleanText(value, 1200))
    .filter(value => value && !/^(?:Strict actor consistency lock|Storyboard scene binding lock|Strict scene consistency lock|Strict shot continuity lock):$/i.test(value));
  const categories = [
    { name: 'context', cap: 140, items: 2, match: /^Campaign brief:|^Photorealistic live-action/i },
    { name: 'subject', cap: 130, items: 2, match: /^Advertised subject|^Shot \d+:/i },
    { name: 'visual', cap: 300, items: 2, match: /User-edited visual override|^Visual:|Final priority:/i },
    { name: 'action', cap: 180, items: 2, match: /^Action:|^Current shot action:|Visible interaction grounding/i },
    { name: 'design', cap: 700, items: 9, whole_lines: true, match: /^Shot scope:|^This is an isolated product\/sample comparison insert|^Master environment only|Surface topology lock:|Seam policy:|Finish distribution:|Task-specific surface note:|Motion effect plan:|START KEYFRAME|Effect source state|Later animation target|Preserve the locked scene geometry|Target reference asset|Task-specific effect note:/i },
    { name: 'actor', cap: 320, items: 5, match: /Person QA required|no-human lock|If the shot includes any body part|actor consistency lock|Actor wardrobe lock|Actor identity|Actor hair|Actor appearance|Actor name|Actor reference|Locked real actor|Locked cast profiles|Do not crop/i },
    { name: 'scene', cap: 300, items: 5, match: /scene consistency lock|scene binding lock|Locked scene asset|Scene lock strength|Scene material lock|Scene layout lock|Scene style lock|Scene reference images|Required scene view|Required visible scene anchors|Required scene zone|Shot scene binding|keyframe must be generated inside/i },
    { name: 'repair', cap: 220, items: 4, match: /Previous visual QA rejected|structured consistency conflicts|^(?:场景空间|人物身份|产品主体)：/i },
    { name: 'continuity', cap: 220, items: 6, match: /shot continuity lock|^Continuity from:|^Entry frame state:|^Exit frame state:|^Action start\/end:|^Screen direction:|^Eyeline:|^Camera axis:|^Camera movement:|^Object state lock:|^Transition:|^Requires previous frame:|Continuity reference from previous accepted keyframe|Previous keyframe prompt summary/i },
    { name: 'product', cap: 200, items: 5, match: /Product visibility|Product presentation|Commercial evidence|Product identity lock|Product shape lock|Product material lock|Product color lock|Product reference images/i },
    { name: 'style', cap: 140, items: 2, match: /^Style:|Visual style direction|Scene direction|Custom scene requirement/i },
    { name: 'safety', cap: 220, items: 3, match: /Forbidden:|Negative visual|Semantic fidelity rule|Never infer a different industry|Use a real camera look/i },
    { name: 'other', cap: 40, items: 1, match: /.*/ },
  ];
  const buckets = new Map(categories.map(category => [category.name, []]));
  const classificationOrder = ['repair', 'safety', 'context', 'subject', 'visual', 'action', 'design', 'actor', 'scene', 'continuity', 'product', 'style', 'other']
    .map(name => categories.find(category => category.name === name))
    .filter(Boolean);
  lines.forEach(line => {
    const category = classificationOrder.find(item => item.match.test(line)) || categories[categories.length - 1];
    buckets.get(category.name).push(line);
  });
  const excerpts = categories.map(category => {
    let values = buckets.get(category.name) || [];
    if (category.name === 'actor') {
      const rank = value => /actor consistency lock|Actor wardrobe lock/i.test(value) ? 0
        : (/Person QA required/i.test(value) ? 1 : (/If the shot includes any body part/i.test(value) ? 2 : 3));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'context') {
      values = values.slice().sort((a, b) => (/^Campaign brief:/i.test(a) ? 0 : 1) - (/^Campaign brief:/i.test(b) ? 0 : 1));
    } else if (category.name === 'product') {
      const rank = value => /Product identity lock/i.test(value) ? 0
        : (/Product material lock/i.test(value) ? 1
          : (/Product shape lock|Product color lock/i.test(value) ? 2
            : (/Product visibility/i.test(value) ? 3 : (/Product presentation/i.test(value) ? 4 : 5))));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'continuity') {
      const rank = value => /^Object state lock:/i.test(value) ? 0
        : (/^Entry frame state:/i.test(value) ? 1 : (/^Exit frame state:/i.test(value) ? 2 : (/^Transition:/i.test(value) ? 3 : 4)));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'scene') {
      const rank = value => /scene consistency lock|scene binding lock|Required visible scene anchors|Scene material lock/i.test(value) ? 0
        : (/Shot scene binding|Locked scene asset|Required scene view/i.test(value) ? 1 : 2);
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'style') {
      values = values.slice().sort((a, b) => (/Visual style direction/i.test(a) ? 0 : 1) - (/Visual style direction/i.test(b) ? 0 : 1));
    } else if (category.name === 'safety') {
      const rank = value => /Semantic fidelity rule/i.test(value) ? 0 : (/^Forbidden:|Negative visual|no-human lock/i.test(value) ? 1 : (/Use a real camera look/i.test(value) ? 2 : 3));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    } else if (category.name === 'design') {
      const rank = value => /isolated product\/sample comparison insert/i.test(value) ? 0
        : (/^Surface topology lock:/i.test(value) ? 1
          : (/^Seam policy:/i.test(value) ? 2
            : (/^Finish distribution:/i.test(value) ? 3
              : (/^Task-specific surface note:/i.test(value) ? 4
                : (/^Master environment only/i.test(value) ? 5 : 6)))));
      values = values.slice().sort((a, b) => rank(a) - rank(b));
    }
    const selected = [...new Set(values)].slice(0, category.items || 1);
    if (category.whole_lines) {
      const complete = [];
      let used = 0;
      for (const value of selected) {
        const normalized = cleanText(value, 1200);
        const nextSize = normalized.length + (complete.length ? 3 : 0);
        if (!normalized || used + nextSize > category.cap) continue;
        complete.push(normalized);
        used += nextSize;
      }
      return complete.join(' | ');
    }
    const perItem = Math.max(40, Math.floor((category.cap - Math.max(0, selected.length - 1) * 3) / Math.max(1, selected.length)));
    return selected.map(value => cleanText(value, perItem)).filter(Boolean).join(' | ');
  }).filter(Boolean);
  const limit = Math.max(400, Number(maxChars) || 2400);
  const output = [];
  let used = 0;
  for (const excerpt of excerpts) {
    const nextSize = excerpt.length + (output.length ? 1 : 0);
    if (used + nextSize > limit) continue;
    output.push(excerpt);
    used += nextSize;
  }
  return output.join('\n');
}

function previewShotPrompts(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const stored = storage.getOutput(taskId, 'storyboard_table') || [];
  if (!Array.isArray(stored) || !stored.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  const rawIndex = Number(options.shot_index ?? options.shotIndex ?? 0);
  const index = Math.max(0, Math.min(stored.length - 1, Number.isFinite(rawIndex) ? rawIndex : 0));
  const draft = options.shot && typeof options.shot === 'object' ? options.shot : {};
  const merged = normalizeStoryboardShot({ ...stored[index], ...draft }, index, stored[index - 1] || {});
  const shots = stored.map((shot, shotIndex) => shotIndex === index ? merged : shot);
  const boundShots = bindShotsToScenes(shots, ctx.scene_assets);
  const contracts = buildKeyframeContracts(ctx, boundShots);
  const shot = boundShots[index];
  const contract = contracts[index] || {};
  const previousShot = index > 0 ? boundShots[index - 1] : null;
  return {
    shot_index: index + 1,
    shot_design: shotDesign.normalizeShotDesign(shot),
    keyframe_prompt: buildKeyframePrompt(ctx, shot, contract, index, {
      sceneAsset: sceneAssetForShot(ctx, shot, index),
      previousFrame: acceptedKeyframeContextAt(storage.getOutput(taskId, 'keyframes') || [], index - 1),
    }),
    motion_prompt: videoAdapter.clipPrompt(shot, ctx, contract, previousShot),
    media_generated: false,
  };
}

function keyframeUrlFromResult(result = {}) {
  if (result.image_url || result.imageUrl || result.url) return result.image_url || result.imageUrl || result.url;
  const filename = result.filename || (result.filePath ? require('path').basename(result.filePath) : '');
  return filename ? mediaAdapter.publicAssetUrl(filename) : '';
}

async function generateKeyframesStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  assertVerifiedSceneAssets(ctx.scene_assets);
  personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  const boundShots = bindShotsToScenes(shots, ctx.scene_assets);
  if (JSON.stringify(boundShots) !== JSON.stringify(shots)) {
    shots = boundShots;
    storage.saveOutput(taskId, 'storyboard_table', shots);
  }
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  const needsSceneContract = ctx.scene_assets.length && (!Array.isArray(contracts) || contracts.some(contract => !contract?.scene_lock));
  if (!Array.isArray(contracts) || contracts.length !== shots.length || needsSceneContract) {
    contracts = buildKeyframeContracts(ctx, shots);
    persistKeyframeContracts(taskId, contracts);
  }
  const existing = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const targetIndexes = keyframeTargetIndexes(shots, existing, options);
  const keyframes = existing.slice();
  const dependencyPlan = buildKeyframeDependencyPlan(shots, contracts, ctx);
  const targetIndexSet = new Set(targetIndexes);
  const completedBatchIndexes = new Set();
  const attempts = [];
  const retainedRegenerationFailures = [];
  const beforeStatus = keyframeCompletion(keyframes, shots);
  if (!targetIndexes.length) {
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: beforeStatus.fresh_pass >= beforeStatus.total ? 'done' : 'partial',
      output_summary: `${beforeStatus.fresh_pass}/${beforeStatus.total} current keyframes verified`,
      diagnostics: { attempts, keyframe_status: beforeStatus, skipped: true },
    });
    if (beforeStatus.fresh_pass >= beforeStatus.total) {
      storage.updateTask(taskId, { status: 'done', stage: 'keyframes_ready', error: '' });
    } else {
      storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '' });
    }
    return { keyframes, keyframe_contracts: contracts, attempts, keyframe_status: beforeStatus, skipped: true };
  }
  targetIndexes.forEach(index => {
    if (!keyframes[index]) return;
    keyframes[index] = {
      ...keyframes[index],
      current_generation_status: 'pending',
      current_generation_id: cleanText(options.generation_id || options.generationId || '', 80),
      latest_attempt: {
        generation_id: cleanText(options.generation_id || options.generationId || '', 80),
        status: 'pending',
        started_at: new Date().toISOString(),
      },
    };
  });
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.updateTask(taskId, { status: 'running', stage: 'keyframes' });
  storage.saveStage(taskId, 'keyframes', { status: 'running', input_summary: `${targetIndexes.length} image keyframes` });
  const progressStartedAt = new Date().toISOString();
  const configuredConcurrency = keyframeParallel.resolveConcurrency(options, targetIndexes.length);
  const pendingProgressIndexes = new Set(targetIndexes);
  const activeProgressIndexes = new Set();
  const generationProgress = {
    stage: 'keyframes', status: 'running', target_total: targetIndexes.length,
    generation_id: cleanText(options.generation_id || options.generationId || '', 80),
    processed: 0, succeeded: 0, failed: 0,
    current_index: (targetIndexes[0] ?? 0) + 1,
    target_indexes: targetIndexes.map(index => index + 1),
    configured_concurrency: configuredConcurrency,
    effective_concurrency: configuredConcurrency,
    peak_concurrency: 0,
    dependency_reasons: Object.fromEntries(targetIndexes.map(index => [String(index + 1), dependencyPlan.reasons[index] || 'unknown'])),
    active_indexes: [],
    queued_indexes: targetIndexes.map(index => index + 1),
    started_at: progressStartedAt, updated_at: progressStartedAt,
  };
  function refreshParallelProgress(fallbackIndex = targetIndexes[0] ?? 0) {
    generationProgress.active_indexes = [...activeProgressIndexes].sort((a, b) => a - b).map(index => index + 1);
    generationProgress.queued_indexes = [...pendingProgressIndexes].sort((a, b) => a - b).map(index => index + 1);
    const next = [...activeProgressIndexes, ...pendingProgressIndexes].sort((a, b) => a - b)[0];
    generationProgress.current_index = (next === undefined ? fallbackIndex : next) + 1;
    generationProgress.updated_at = new Date().toISOString();
  }
  storage.updateTask(taskId, { generation_progress: generationProgress });
  async function generateKeyframeAtIndex(i, scheduleMeta = {}) {
    const workerStartedMs = Date.now();
    pendingProgressIndexes.delete(i);
    activeProgressIndexes.add(i);
    generationProgress.peak_concurrency = Math.max(generationProgress.peak_concurrency || 0, activeProgressIndexes.size);
    generationProgress.effective_concurrency = Math.max(1, Number(scheduleMeta.concurrency) || 1);
    generationProgress.wave_number = Math.max(1, Number(scheduleMeta.wave_number) || 1);
    generationProgress.wave_kind = scheduleMeta.kind || 'sequential';
    keyframes[i] = {
      ...(keyframes[i] || {}),
      current_generation_status: 'generating',
      current_generation_id: generationProgress.generation_id,
      latest_attempt: {
        ...((keyframes[i] || {}).latest_attempt || {}),
        generation_id: generationProgress.generation_id,
        status: 'generating',
        started_at: (keyframes[i] || {}).latest_attempt?.started_at || new Date().toISOString(),
      },
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    refreshParallelProgress(i);
    storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
    const shot = shots[i] || {};
    const previousAcceptedFrame = hasUsablePreviousKeyframe(existing[i]) ? { ...existing[i] } : null;
    let currentAttemptFailed = false;
    let currentError = null;
    let retryRequired = false;
    const referenceKeyframes = Array.isArray(scheduleMeta.snapshot) ? scheduleMeta.snapshot : keyframes;
    const dependencyIndex = Number.isInteger(scheduleMeta.dependency_index) ? scheduleMeta.dependency_index : -1;
    const previousFrame = acceptedKeyframeContextAt(referenceKeyframes, dependencyIndex);
    const sceneAsset = sceneAssetForShot(ctx, shot, i);
    const basePrompt = buildKeyframePrompt(ctx, shot, contracts[i] || {}, i, { previousFrame, sceneAsset });
    const filename = `scene_new_story_ad_${taskId}_${String(i + 1).padStart(2, '0')}_${Date.now()}`;
    const shotCandidates = [];
    try {
      const sceneReference = selectedSceneReference(sceneAsset, contracts[i] || {});
      const referenceImages = keyframeReferenceImages(ctx, sceneReference, previousFrame, shot, contracts[i] || {}, sceneAsset);
      const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contracts[i] || {});
      const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
      const productRequired = productIdentity.shotProductRequired(ctx, shot, contracts[i] || {});
      const requireVisualQa = !!sceneReference || shotNeedsPerson || personForbidden || productRequired;
      const maxQaRetries = requireVisualQa
          ? Math.max(0, Math.min(1, Number(options.max_scene_retries ?? options.maxSceneRetries ?? 1) || 0))
        : 0;
      let accepted = null;
      let qa = null;
      let feedback = '';
      for (let qaAttempt = 0; qaAttempt <= maxQaRetries; qaAttempt += 1) {
        const correction = feedback
          ? `Previous visual QA rejected the frame. Correct only the structured consistency conflicts below. Keep the current shot contract, scene contract, person contract and product contract unchanged. Do not introduce any new person, object, place, industry detail or visual symbol that is absent from those contracts.\n${cleanText(feedback, 520)}`
          : '';
        const prompt = correction
          ? compactKeyframePrompt([...basePrompt.split('\n'), correction])
          : basePrompt;
        const imageStartedMs = Date.now();
        const result = await mediaAdapter.generateImage({
          taskId,
          prompt,
          filename: filename + '_a' + (qaAttempt + 1),
          stage: 'new_story_ad.keyframe',
          aspectRatio: ctx.output_ratio || '9:16',
          resolution: options.resolution || '2K',
          imageModel: options.image_model || options.imageModel || 'auto',
          referenceImages,
          requireReferences: referenceImages.length > 0,
          inputFidelity: 'high',
          timeoutMs: Math.max(30000, Math.min(10 * 60 * 1000, Number(options.image_timeout_ms ?? options.imageTimeoutMs) || (5 * 60 * 1000))),
        });
        const imageLatencyMs = Date.now() - imageStartedMs;
        const imageUrl = keyframeUrlFromResult(result);
        if (!imageUrl) throw new Error('图片供应商没有返回可用图片地址。');
        // Use the provider URL for immediate remote QA when available, while
        // keeping the persisted VIDO URL as the production/display asset.
        const qaImageUrl = result.source_url || mediaAdapter.absolutePublicImageUrl(imageUrl);
        const qaStartedMs = Date.now();
        let sceneQa;
        let personQa;
        let productQa;
        try {
          const reviewed = await runKeyframeQaReviews({
            taskId,
            ctx,
            shot,
            contract: contracts[i] || {},
            sceneAsset,
            generatedUrl: qaImageUrl,
          });
          sceneQa = reviewed.sceneQa;
          personQa = reviewed.personQa;
          productQa = reviewed.productQa;
        } catch (error) {
          error.keyframe_candidate_generated = true;
          shotCandidates.push({
            id: `shot_${i + 1}_candidate_${qaAttempt + 1}_${Date.now()}`,
            image_url: imageUrl,
            provider_used: result.provider_used || '',
            qa: { pass: false, status: 'unavailable', error: String(error.message || error) },
            status: 'qa_unavailable',
            qa_policy_version: 2,
            contract_fingerprint: contracts[i]?.contract_fingerprint || '',
            generation_id: generationProgress.generation_id,
            image_latency_ms: imageLatencyMs,
            qa_latency_ms: Date.now() - qaStartedMs,
            total_latency_ms: Date.now() - imageStartedMs,
            created_at: new Date().toISOString(),
          });
          attempts.push({
            index: i,
            qa_attempt: qaAttempt + 1,
            ok: false,
            provider_id: result.provider_used || '',
            image_url: imageUrl,
            image_latency_ms: imageLatencyMs,
            qa_latency_ms: Date.now() - qaStartedMs,
            total_latency_ms: Date.now() - imageStartedMs,
            error: String(error.message || error),
            error_code: error.code || 'VISION_QA_UNAVAILABLE',
            candidate_reused_for_qa_retry: true,
          });
          throw error;
        }
        const qaLatencyMs = Date.now() - qaStartedMs;
        qa = combineKeyframeQa({
          ctx,
          shot,
          contract: contracts[i] || {},
          sceneReference,
          sceneQa,
          personQa,
          productQa,
        });
        shotCandidates.push({
          id: `shot_${i + 1}_candidate_${qaAttempt + 1}_${Date.now()}`,
          image_url: imageUrl,
          provider_used: result.provider_used || '',
          qa,
          status: qa.pass ? 'accepted' : 'rejected',
          qa_policy_version: 2,
          contract_fingerprint: contracts[i]?.contract_fingerprint || '',
          generation_id: generationProgress.generation_id,
          image_latency_ms: imageLatencyMs,
          qa_latency_ms: qaLatencyMs,
          total_latency_ms: Date.now() - imageStartedMs,
          created_at: new Date().toISOString(),
        });
        attempts.push({
          index: i,
          qa_attempt: qaAttempt + 1,
          ok: qa.pass === true,
          provider_id: result.provider_used || '',
          image_url: imageUrl,
          image_latency_ms: imageLatencyMs,
          qa_latency_ms: qaLatencyMs,
          total_latency_ms: Date.now() - imageStartedMs,
          qa,
        });
        if (qa.pass) {
          accepted = { result, imageUrl, prompt };
          break;
        }
        feedback = structuredQaFeedback(sceneQa, personQa, productQa);
      }
      if (!accepted) {
        const error = new Error('第 ' + (i + 1) + ' 镜视觉一致性 QA 未通过：' + (feedback || '画面与当前镜头合同不一致'));
        error.code = 'SCENE_CONSISTENCY_QA_FAILED';
        error.retryable = true;
        throw error;
      }
      const { result, imageUrl, prompt } = accepted;
      keyframes[i] = {
        ...(keyframes[i] || {}),
        shot_index: i,
        index: i + 1,
        title: shot.title || `Shot ${i + 1}`,
        image_url: imageUrl,
        imageUrl,
        provider_used: result.provider_used || '',
        reference_mode: sceneReference ? 'strict_scene_reference' : 'new_story_ad_generated_keyframe',
        scene_reference_url: sceneReference || '',
        reference_count: referenceImages.length,
        reference_preserving: result.reference_preserving === true,
        prompt,
        qa,
        candidates: shotCandidates,
        selected_candidate_id: shotCandidates.find(candidate => candidate.image_url === imageUrl)?.id || '',
        contract: contracts[i] || null,
        error: '',
        error_code: '',
        regeneration_error: '',
        regeneration_error_code: '',
        regeneration_failed_at: '',
        current_generation_status: 'accepted',
        current_generation_id: generationProgress.generation_id,
        qa_policy_version: 2,
        contract_fingerprint: contracts[i]?.contract_fingerprint || '',
        contract_outdated: false,
        contract_outdated_reason: '',
        accepted_revision: {
          generation_id: generationProgress.generation_id,
          accepted_at: new Date().toISOString(),
          qa_policy_version: 2,
        },
        latest_attempt: {
          generation_id: generationProgress.generation_id,
          status: 'accepted',
          candidates: shotCandidates,
          finished_at: new Date().toISOString(),
        },
      };
    } catch (err) {
      if (err?.code === 'STAGE_DEADLINE_EXCEEDED' || err?.code === 'USER_CANCELLED') {
        activeProgressIndexes.delete(i);
        refreshParallelProgress(i);
        storage.saveOutput(taskId, 'keyframes', keyframes);
        generationProgress.status = err.code === 'USER_CANCELLED' ? 'cancelled' : 'partial';
        storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
        throw err;
      }
      currentAttemptFailed = true;
      currentError = err;
      retryRequired = keyframeParallel.isThrottleError(err) && err.keyframe_candidate_generated !== true && scheduleMeta.throttle_retry !== true;
      attempts.push({ index: i, ok: false, code: err.code || 'KEYFRAME_FAILED', error: String(err.message || err) });
      if (previousAcceptedFrame) {
        if (!retryRequired) {
          retainedRegenerationFailures.push({
            index: i,
            error: String(err.message || err),
            code: isQaInfrastructureError(err) ? 'VISION_QA_UNAVAILABLE' : (err.code || 'KEYFRAME_FAILED'),
          });
        }
        keyframes[i] = {
          ...previousAcceptedFrame,
          shot_index: i,
          index: i + 1,
          title: shot.title || `Shot ${i + 1}`,
          error: '',
          error_code: '',
          regeneration_error: String(err.message || err),
          regeneration_error_code: isQaInfrastructureError(err) ? 'VISION_QA_UNAVAILABLE' : (err.code || 'KEYFRAME_FAILED'),
          regeneration_failed_at: new Date().toISOString(),
          current_generation_status: retryRequired ? 'retrying_serial' : (isQaInfrastructureError(err) ? 'qa_unavailable' : 'rejected'),
          current_generation_id: generationProgress.generation_id,
          contract: contracts[i] || previousAcceptedFrame.contract || null,
          candidates: [...(Array.isArray(previousAcceptedFrame.candidates) ? previousAcceptedFrame.candidates : []), ...shotCandidates]
            .filter((candidate, candidateIndex, all) => all.findIndex(item => String(item?.id || item?.image_url || '') === String(candidate?.id || candidate?.image_url || '')) === candidateIndex)
            .slice(-8),
          latest_attempt: {
            generation_id: generationProgress.generation_id,
            status: retryRequired ? 'retrying_serial' : (isQaInfrastructureError(err) ? 'qa_unavailable' : 'rejected'),
            error: String(err.message || err),
            error_code: err.code || 'KEYFRAME_FAILED',
            candidates: shotCandidates,
            finished_at: new Date().toISOString(),
          },
        };
      } else {
        keyframes[i] = {
          ...(keyframes[i] || {}),
          shot_index: i,
          index: i + 1,
          title: shot.title || `Shot ${i + 1}`,
          error: String(err.message || err),
          error_code: err.code || 'KEYFRAME_FAILED',
          contract: contracts[i] || null,
          candidates: shotCandidates,
          current_generation_status: retryRequired ? 'retrying_serial' : (isQaInfrastructureError(err) ? 'qa_unavailable' : 'failed'),
          current_generation_id: generationProgress.generation_id,
        };
      }
    }
    storage.saveOutput(taskId, 'keyframes', keyframes);
    activeProgressIndexes.delete(i);
    if (retryRequired) {
      pendingProgressIndexes.add(i);
      generationProgress.effective_concurrency = 1;
      refreshParallelProgress(i);
      storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
      return {
        index: i,
        failed: true,
        throttled: true,
        retry_required: true,
        usable: hasUsablePreviousKeyframe(keyframes[i]),
      };
    }
    generationProgress.processed += 1;
    if (currentAttemptFailed) generationProgress.failed += 1;
    else generationProgress.succeeded += 1;
    const usable = hasUsablePreviousKeyframe(keyframes[i]);
    if (usable) completedBatchIndexes.add(i);
    refreshParallelProgress(i);
    storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
    return {
      index: i,
      failed: currentAttemptFailed,
      throttled: currentAttemptFailed && keyframeParallel.isThrottleError(currentError),
      usable,
      duration_ms: Date.now() - workerStartedMs,
    };
  }
  const schedule = await keyframeParallel.runSchedule({
    indexes: targetIndexes,
    concurrency: configuredConcurrency,
    dependencyOf: index => dependencyPlan.dependencies[index],
    externalDependencyUsable: index => hasUsablePreviousKeyframe(keyframes[index]),
    snapshot: () => keyframes.map((frame, index) => {
      if (targetIndexSet.has(index) && !completedBatchIndexes.has(index)) return null;
      return frame && typeof frame === 'object' ? { ...frame } : frame;
    }),
    worker: generateKeyframeAtIndex,
  });
  const blockedResults = schedule.results.filter(result => result?.blocked === true);
  for (const result of blockedResults) {
    const index = Number(result.index);
    if (!Number.isInteger(index) || index < 0 || index >= shots.length) continue;
    pendingProgressIndexes.delete(index);
    const dependencyNumber = Number.isInteger(result.dependency) ? result.dependency + 1 : 0;
    const message = dependencyNumber
      ? `依赖的第 ${dependencyNumber} 镜没有可用关键帧，已停止第 ${index + 1} 镜生成以避免连续性错误。`
      : `第 ${index + 1} 镜的连续性依赖无效，已停止生成。`;
    const previousAcceptedFrame = hasUsablePreviousKeyframe(existing[index]) ? { ...existing[index] } : null;
    attempts.push({ index, ok: false, code: 'KEYFRAME_DEPENDENCY_BLOCKED', error: message });
    if (previousAcceptedFrame) {
      retainedRegenerationFailures.push({ index, error: message, code: 'KEYFRAME_DEPENDENCY_BLOCKED' });
      keyframes[index] = {
        ...previousAcceptedFrame,
        shot_index: index,
        index: index + 1,
        title: shots[index]?.title || `Shot ${index + 1}`,
        error: '',
        error_code: '',
        regeneration_error: message,
        regeneration_error_code: 'KEYFRAME_DEPENDENCY_BLOCKED',
        regeneration_failed_at: new Date().toISOString(),
        current_generation_status: 'blocked',
        current_generation_id: generationProgress.generation_id,
        contract: contracts[index] || previousAcceptedFrame.contract || null,
        latest_attempt: {
          generation_id: generationProgress.generation_id,
          status: 'blocked',
          error: message,
          error_code: 'KEYFRAME_DEPENDENCY_BLOCKED',
          candidates: [],
          finished_at: new Date().toISOString(),
        },
      };
    } else {
      keyframes[index] = {
        ...(keyframes[index] || {}),
        shot_index: index,
        index: index + 1,
        title: shots[index]?.title || `Shot ${index + 1}`,
        error: message,
        error_code: 'KEYFRAME_DEPENDENCY_BLOCKED',
        contract: contracts[index] || null,
        current_generation_status: 'blocked',
        current_generation_id: generationProgress.generation_id,
      };
    }
  }
  if (blockedResults.length) {
    generationProgress.processed += blockedResults.length;
    generationProgress.failed += blockedResults.length;
    generationProgress.blocked = blockedResults.length;
    storage.saveOutput(taskId, 'keyframes', keyframes);
  }
  generationProgress.configured_concurrency = schedule.configured_concurrency;
  generationProgress.effective_concurrency = schedule.effective_concurrency;
  generationProgress.wave_count = schedule.waves.length;
  generationProgress.waves = schedule.waves.map(wave => ({
    kind: wave.kind,
    indexes: wave.indexes.map(index => index + 1),
    concurrency: wave.concurrency,
    wave_size: Number(wave.wave_size || wave.indexes.length || 0),
    actual_concurrency: Number(wave.actual_concurrency || wave.indexes.length || 0),
    duration_ms: Number(wave.duration_ms || 0),
    started_at: wave.started_at || '',
    finished_at: wave.finished_at || '',
  }));
  generationProgress.wall_time_ms = Date.now() - new Date(progressStartedAt).getTime();
  const targetDependencyReasons = targetIndexes.map(index => dependencyPlan.reasons[index] || 'unknown');
  generationProgress.parallelism_lost_reason = schedule.effective_concurrency < schedule.configured_concurrency
    ? 'provider_throttle'
    : ((generationProgress.peak_concurrency || 0) < Math.min(schedule.configured_concurrency, targetIndexes.length)
      ? (targetDependencyReasons.includes('temporal_continuity')
        ? 'temporal_chain'
        : (targetDependencyReasons.includes('continuity_metadata_unavailable')
          ? 'continuity_metadata_unavailable'
          : (targetDependencyReasons.some(reason => /anchor_unavailable/.test(reason)) ? 'anchor_unavailable' : 'dependency_limited')))
      : '');
  attempts.sort((a, b) => Number(a.index || 0) - Number(b.index || 0) || Number(a.qa_attempt || 0) - Number(b.qa_attempt || 0));
  retainedRegenerationFailures.sort((a, b) => a.index - b.index);
  refreshParallelProgress(targetIndexes[targetIndexes.length - 1] ?? 0);
  storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
  if (retainedRegenerationFailures.length) {
    const finalStatus = keyframeCompletion(keyframes, shots);
    const shotNumbers = retainedRegenerationFailures.map(item => item.index + 1);
    const qaUnavailableFailures = retainedRegenerationFailures.filter(item => item.code === 'VISION_QA_UNAVAILABLE');
    const rejectedFailures = retainedRegenerationFailures.filter(item => item.code !== 'VISION_QA_UNAVAILABLE');
    const message = qaUnavailableFailures.length && !rejectedFailures.length
      ? `第 ${shotNumbers.join('、')} 镜的新图已经生成，但视觉审核服务超时或返回格式异常。图片已保留，可直接重新验证，无需再次生成。`
      : `第 ${shotNumbers.join('、')} 镜的新版本未通过生成或 QA，已保留上一版可用画面。请根据具体原因调整后重试。`;
    generationProgress.status = 'failed';
    generationProgress.finished_at = new Date().toISOString();
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `${finalStatus.completed}/${finalStatus.total} image keyframes; ${retainedRegenerationFailures.length} rejected regeneration`,
      diagnostics: { attempts, keyframe_status: finalStatus, retained_regeneration_failures: retainedRegenerationFailures },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', generation_progress: { ...generationProgress } });
    const err = new Error(message);
    err.code = qaUnavailableFailures.length && !rejectedFailures.length ? 'VISION_QA_UNAVAILABLE' : 'KEYFRAME_REGENERATION_REJECTED';
    err.retryable = true;
    err.keyframes = keyframes;
    err.attempts = attempts;
    throw err;
  }
  const failed = targetIndexes
    .filter(index => !isCompleteKeyframe(keyframes[index]) || keyframes[index]?.qa?.pass !== true)
    .map(index => ({ index, error: keyframes[index]?.error || 'keyframe or scene QA failed' }));
  if (failed.length) {
    const message = `Keyframe image generation failed for shot ${failed.map(a => a.index + 1).join(', ')}`;
    generationProgress.status = 'failed';
    generationProgress.finished_at = new Date().toISOString();
    storage.saveStage(taskId, 'keyframes', { status: 'failed', error: message, diagnostics: { attempts } });
    storage.updateTask(taskId, { status: 'failed', stage: 'keyframes_failed', error: message, error_code: 'KEYFRAME_GENERATION_FAILED', retryable: true, generation_progress: { ...generationProgress } });
    const err = new Error(message);
    err.keyframes = keyframes;
    err.attempts = attempts;
    throw err;
  }
  const finalStatus = keyframeCompletion(keyframes, shots);
  generationProgress.status = 'done';
  generationProgress.finished_at = new Date().toISOString();
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.saveStage(taskId, 'keyframes', {
    status: finalStatus.fresh_pass >= finalStatus.total ? 'done' : 'partial',
    output_summary: `${finalStatus.fresh_pass}/${finalStatus.total} current keyframes verified`,
    diagnostics: { attempts, keyframe_status: finalStatus },
  });
  storage.updateTask(taskId, finalStatus.fresh_pass >= finalStatus.total
    ? { status: 'done', stage: 'keyframes_ready', error: '', error_code: '', generation_progress: { ...generationProgress } }
    : { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', generation_progress: { ...generationProgress } });
  return { keyframes, keyframe_contracts: contracts, attempts, keyframe_status: finalStatus };
}

function selectedSceneReference(sceneAsset = {}, contract = {}) {
  const viewKey = cleanText(contract?.scene_lock?.scene_view || contract?.scene_view || 'master', 40) || 'master';
  const views = Array.isArray(sceneAsset?.view_images) ? sceneAsset.view_images : [];
  const view = views.find(item => cleanText(item?.key || item?.view || '', 40) === viewKey)
    || views.find(item => cleanText(item?.key || item?.view || '', 40) === 'master')
    || views[0];
  return mediaAdapter.absolutePublicImageUrl(view?.url || view?.image_url || sceneAsset?.image_url || '');
}

async function runKeyframeQaReviews({ taskId, ctx = {}, shot = {}, contract = {}, sceneAsset = {}, generatedUrl = '' } = {}) {
  const sceneReference = selectedSceneReference(sceneAsset, contract);
  const layoutReference = completeSpaceLock(sceneAsset) ? layoutSceneReference(sceneAsset) : null;
  const reviewUrl = /^https?:\/\//i.test(String(generatedUrl || ''))
    ? String(generatedUrl)
    : mediaAdapter.absolutePublicImageUrl(generatedUrl);
  if (!reviewUrl) {
    const error = new Error('候选关键帧缺少可审核的图片地址');
    error.code = 'KEYFRAME_CANDIDATE_IMAGE_MISSING';
    error.status = 422;
    throw error;
  }
  const [sceneQa, personQa, productQa] = await Promise.all([
    sceneReference
      ? reviewWithInfrastructureRetry(attempt => sceneSpace.reviewKeyframe({
        taskId,
        sceneReferenceUrl: sceneReference,
        layoutReferenceUrl: layoutReference?.url || '',
        generatedUrl: reviewUrl,
        contract: contract?.scene_lock || sceneAsset?.scene_contract || {},
        shot,
        timeoutMs: attempt ? 45000 : 60000,
        maxCandidates: attempt ? 2 : 3,
        stageBudgetMs: attempt ? 90000 : 120000,
      }), 2)
      : Promise.resolve({
        pass: true,
        status: 'not_applicable',
        reason: '当前任务没有已锁定场景资产，不执行场景空间一致性比较。',
        checked_at: new Date().toISOString(),
      }),
    reviewWithInfrastructureRetry(attempt => personKeyframeQa.reviewPersonKeyframe({
      taskId,
      ctx,
      shot,
      contract,
      generatedUrl: reviewUrl,
      timeoutMs: attempt ? 45000 : 60000,
      maxCandidates: attempt ? 2 : 3,
      stageBudgetMs: attempt ? 90000 : 120000,
    }), 2),
    reviewWithInfrastructureRetry(attempt => productKeyframeQa.reviewProductKeyframe({
      taskId,
      ctx,
      shot,
      contract,
      generatedUrl: reviewUrl,
      timeoutMs: attempt ? 45000 : 60000,
      maxCandidates: attempt ? 2 : 3,
      stageBudgetMs: attempt ? 90000 : 120000,
    }), 2),
  ]);
  return { sceneReference, sceneQa, personQa, productQa };
}

function combineKeyframeQa({ ctx = {}, shot = {}, contract = {}, sceneReference = '', sceneQa = {}, personQa = {}, productQa = {} } = {}) {
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
  const productRequired = productIdentity.shotProductRequired(ctx, shot, contract);
  const conflicts = [
    ...(sceneQa.mismatch_reasons || []),
    ...(sceneQa.forbidden_new_elements || []),
    ...(personQa.conflicts || []),
    ...(productQa.conflicts || []),
    personQa.retry_instruction || '',
    productQa.retry_instruction || '',
  ].filter(Boolean);
  const scenePass = !sceneReference || (sceneQa.pass === true && sceneQa.status === 'passed');
  const personPass = !(shotNeedsPerson || personForbidden) || (personQa.pass === true && personQa.status === 'verified');
  const productPass = !productRequired || (productQa.pass === true && productQa.status === 'verified');
  return {
    pass: scenePass && personPass && productPass,
    status: scenePass && personPass && productPass ? 'verified' : 'rejected',
    scene: sceneQa,
    person: personQa,
    product: productQa,
    mismatch_reasons: conflicts,
    checked_at: new Date().toISOString(),
  };
}

function keyframeReferenceImages(ctx = {}, sceneReference = '', previousFrame = null, shot = {}, contract = {}, sceneAsset = {}) {
  const person = ctx.person_asset || {};
  const personViews = Array.isArray(person.view_images) ? person.view_images : [];
  const includePerson = personIdentity.shotPersonRequired(ctx, shot, contract) && !personIdentity.shotForbidsPerson(ctx, shot);
  const includeProduct = productIdentity.shotProductRequired(ctx, shot, contract);
  const personPrimary = includePerson ? (person.image_url || person.url || personViews[0]?.url || personViews[0]?.image_url || '') : '';
  const assets = Array.isArray(ctx.assets) ? ctx.assets : [];
  const product = assets.find(asset => /product|subject|商品|产品|主体/i.test(String(asset.type || '') + ' ' + String(asset.name || '')));
  const productReference = includeProduct ? (product?.url || product?.image_url || ctx.product_contract?.reference_images?.[0] || '') : '';
  const continuityReference = previousFrame?.image_url || '';
  const personFallback = includePerson && !continuityReference
    ? (personViews[1]?.url || personViews[1]?.image_url || personViews[0]?.url || personViews[0]?.image_url || '')
    : '';
  const continuityOrFallback = continuityReference || personFallback;
  const layoutReference = completeSpaceLock(sceneAsset) ? layoutSceneReference(sceneAsset)?.url : '';
  // Providers accept at most four references. Commercial scene, actor, product
  // and accepted-frame continuity have priority. The layout blueprint fills a
  // remaining slot, so it improves spatial grounding without weakening identity
  // or temporal continuity in reference-heavy shots.
  const refs = [sceneReference, personPrimary, productReference, continuityOrFallback];
  if (layoutReference && refs.filter(Boolean).length < 4) refs.push(layoutReference);
  const seen = new Set();
  return refs.map(mediaAdapter.absolutePublicImageUrl).filter(url => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 4);
}

async function ensureStoryboardForMedia(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  return shots;
}

async function ensureContractsForMedia(taskId, ctx, shots) {
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  if (!Array.isArray(contracts) || contracts.length !== shots.length) {
    const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
    const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
    contracts = buildKeyframeContracts(contractCtx, shots);
    persistKeyframeContracts(taskId, contracts);
  }
  return contracts;
}

function assertVideoInputsReady({ ctx = {}, shots = [], keyframes = [], contracts = [] } = {}) {
  assertVerifiedSceneAssets(ctx.scene_assets || []);
  const personContract = personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
  const failures = [];
  const personRequired = personIdentity.personRequired(ctx);
  for (let index = 0; index < shots.length; index += 1) {
    const frame = keyframes[index] || {};
    const qa = frame.qa || {};
    if (!isCompleteKeyframe(frame)) {
      failures.push(`第 ${index + 1} 镜缺少可用关键帧`);
      continue;
    }
    if (frame.regeneration_error) {
      failures.push(`第 ${index + 1} 镜本轮新版本未通过，当前仅保留上一版画面`);
      continue;
    }
    if (['pending', 'generating', 'retrying_serial'].includes(String(frame.current_generation_status || ''))) {
      failures.push(`第 ${index + 1} 镜仍在生成或尚未完成本轮验收`);
      continue;
    }
    if (Number(frame.qa_policy_version || 0) < 2) {
      failures.push(`第 ${index + 1} 镜仍是旧版视觉 QA 结果，请按新规则重新生成并验证`);
      continue;
    }
    const currentFingerprint = contracts[index]?.contract_fingerprint || '';
    const frameFingerprint = frame.contract_fingerprint || frame.contract?.contract_fingerprint || '';
    if (!currentFingerprint || frameFingerprint !== currentFingerprint || frame.contract_outdated === true) {
      failures.push(`第 ${index + 1} 镜的画面与当前镜头合同不一致，请重新生成`);
      continue;
    }
    if (qa.pass !== true || qa.status === 'rejected') {
      failures.push(`第 ${index + 1} 镜尚未通过关键帧总 QA`);
      continue;
    }
    const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shots[index] || {}, contracts[index] || {});
    const personForbidden = personIdentity.shotForbidsPerson(ctx, shots[index] || {});
    if ((shotNeedsPerson || personForbidden) && (qa.person?.pass !== true || qa.person?.status !== 'verified')) {
      failures.push(`第 ${index + 1} 镜缺少已通过的人物一致性 QA`);
    }
    const shotNeedsProduct = productIdentity.shotProductRequired(ctx, shots[index] || {}, contracts[index] || {});
    if (shotNeedsProduct && (qa.product?.pass !== true || qa.product?.status !== 'verified')) {
      failures.push(`第 ${index + 1} 镜缺少已通过的产品一致性 QA`);
    }
    const frameRevision = Number(frame.contract?.cast_lock?.person_contract?.person_revision || 0);
    const currentRevision = Number(personContract?.person_revision || 0);
    if (personRequired && currentRevision > 0 && frameRevision !== currentRevision) {
      failures.push(`第 ${index + 1} 镜人物版本已过期（关键帧 v${frameRevision || 0}，当前 v${currentRevision}）`);
    }
    const contractRevision = Number(contracts[index]?.cast_lock?.person_contract?.person_revision || 0);
    if (personRequired && currentRevision > 0 && contractRevision !== currentRevision) {
      failures.push(`第 ${index + 1} 镜人物合同版本未同步`);
    }
  }
  if (failures.length) {
    const error = new Error(`视频生成前校验未通过：${failures.join('；')}。系统不会自动补图或继续合成，请先在分镜页明确处理。`);
    error.code = 'VIDEO_INPUT_QA_REQUIRED';
    error.status = 422;
    error.retryable = false;
    error.details = failures;
    throw error;
  }
  return true;
}

function resolveTtsVoiceId(options = {}, ctx = {}, existingTtsAudio = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'voice_id') || Object.prototype.hasOwnProperty.call(options, 'voiceId')) {
    return cleanText(options.voice_id ?? options.voiceId ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(ctx, 'voice_id') || Object.prototype.hasOwnProperty.call(ctx, 'voiceId')) {
    return cleanText(ctx.voice_id ?? ctx.voiceId ?? '', 120);
  }
  return cleanText(
    existingTtsAudio?.voice_id
      || existingTtsAudio?.voiceId
      || '',
    120,
  );
}

function voiceoverEnabled(options = {}, ctx = {}, voiceId = '') {
  const requested = Object.prototype.hasOwnProperty.call(options, 'include_voiceover')
    ? options.include_voiceover
    : options.includeVoiceover;
  if (requested !== undefined) return requested !== false && !!voiceId;
  const stored = Object.prototype.hasOwnProperty.call(ctx, 'include_voiceover')
    ? ctx.include_voiceover
    : ctx.includeVoiceover;
  if (stored !== undefined) return stored !== false && !!voiceId;
  return !!voiceId;
}

function silentTtsOutput(reason = 'voiceover_disabled') {
  return {
    tracks: [],
    voice_id: '',
    skipped: true,
    reason,
    provider_used: '',
    warnings: [],
  };
}

async function generateTtsStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  // “合成广告”会先执行 TTS。必须在产生配音费用之前执行与视频阶段
  // 相同的审核门禁，避免未通过的关键帧仍然消耗一次配音调用。
  assertVideoInputsReady({ ctx, shots, keyframes, contracts });
  const existingTtsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  const voiceId = resolveTtsVoiceId(options, ctx, existingTtsAudio);
  const includeVoiceover = voiceoverEnabled(options, ctx, voiceId);
  storage.updateTask(taskId, { status: 'running', stage: 'tts' });
  storage.saveStage(taskId, 'tts', { status: 'running', input_summary: `${shots.length} shot voice tracks` });
  if (!includeVoiceover) {
    const tts_audio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', tts_audio);
    storage.saveStage(taskId, 'tts', {
      status: 'done',
      output_summary: 'voiceover skipped by user',
      diagnostics: { skipped: true, reason: tts_audio.reason },
    });
    storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
    return { tts_audio, skipped: true };
  }
  const tts_audio = await ttsAdapter.generateVoiceover({
    taskId,
    shots,
    voiceId,
    speed: options.speed || ctx.tts_speed || 1,
    allowSilentFallback: options.allow_silent_fallback === true || options.allowSilentFallback === true,
  });
  storage.saveOutput(taskId, 'tts_audio', tts_audio);
  storage.saveStage(taskId, 'tts', {
    status: 'done',
    output_summary: `${tts_audio.tracks.length} audio tracks`,
    diagnostics: {
      provider_used: tts_audio.provider_used || '',
      warnings: tts_audio.warnings || [],
    },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
  return { tts_audio };
}

/** 编译通用执行方案、人民币成本上限和零自动重试的视频预检。 */
function buildVideoPreflightPlan(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new videoCore.chineseError.VideoGenerationError('TASK_NOT_FOUND', '', { status: 404 });
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const clips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [];
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const statuses = videoAdapter.listVideoShotStatuses(taskId, shots.length);
  let pinnedModel = null;
  try {
    pinnedModel = videoAdapter.resolvePinnedVideoModel(options, clips);
  } catch {
    pinnedModel = videoAdapter.videoCandidates(options, { includeCircuitOpen: true })[0] || null;
  }
  const providerRoute = pinnedModel
    ? `${String(pinnedModel.provider_id || '').toLowerCase()}/${String(pinnedModel.model_id || '').toLowerCase()}`
    : '';
  const executionPlan = videoCore.planner.compileExecutionPlan({
    shots,
    contracts,
    businessProfile: ctx.business_profile || ctx.businessProfile || ctx.ad_type || 'story_ad',
    options,
  });
  const plan = videoPreflight.buildVideoPreflight({
    taskId,
    shots,
    keyframes,
    contracts,
    clips,
    statuses,
    ctx,
    mode: options.video_generation_mode || options.videoGenerationMode || options.mode || 'economy',
    providerRoute,
    executionPlan,
    executionOptions: options,
    onlyIndexes: Array.isArray(options.only_indexes || options.onlyIndexes)
      ? (options.only_indexes || options.onlyIndexes)
      : ((options.only_index ?? options.onlyIndex) !== undefined ? [Number(options.only_index ?? options.onlyIndex)] : null),
  });
  const authorizedExecutionPlan = {
    ...executionPlan,
    generation_units: (plan.units || []).filter(unit => unit.paid).map(unit => ({
      id: unit.id,
      paid: true,
      mode: unit.continuous ? 'one_take' : 'single_shot',
      edit_shot_indexes: unit.member_indexes || [],
      duration_sec: unit.duration_sec,
      complexity_level: Math.max(0, ...(unit.member_indexes || []).map(index => videoCore.planner.complexityOf(executionPlan.edit_shots[index] || {}))),
      requires_manual_review: (unit.member_indexes || []).some(index => videoCore.planner.complexityOf(executionPlan.edit_shots[index] || {}) >= 3),
      automatic_retry_limit: 0,
    })),
  };
  const costPlan = videoCore.costGuard.buildCostPlan({
    executionPlan: authorizedExecutionPlan,
    providerId: pinnedModel?.provider_id || '',
    modelId: pinnedModel?.model_id || '',
    options,
  });
  plan.authorized_execution_plan = authorizedExecutionPlan;
  plan.cost_plan = costPlan;
  plan.warnings = [];
  if (executionPlan.summary.high_risk_unit_count > 0) {
    plan.warnings.push({
      code: 'VIDEO_COMPLEXITY_REVIEW_REQUIRED',
      message: `检测到 ${executionPlan.summary.high_risk_unit_count} 个高复杂度生成单元，付费提交前必须确认动画预演和镜头拆分。`,
    });
  }
  if (plan.paid_unit_count > 0 && !costPlan.price_known) {
    plan.blockers.push({
      code: 'VIDEO_COST_PRICE_UNKNOWN',
      message: '当前视频模型没有可信的人民币计费单价，已停止付费生成。请先由管理员补充价格配置。',
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  const runtimePolicy = storyAdV3RuntimePolicy();
  plan.runtime_policy = runtimePolicy;
  if (plan.paid_unit_count > 0 && !runtimePolicy.paid_video_enabled) {
    plan.blockers.push({
      code: 'VIDEO_V3_PAID_DISABLED',
      message: '剧情广告 V3 当前处于只读或零费用灰度状态，新的付费视频提交已暂停。',
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  plan.fingerprint = revisionService.signature({
    video_preflight_fingerprint: plan.fingerprint,
    execution_plan_fingerprint: executionPlan.fingerprint,
    cost_plan_fingerprint: costPlan.fingerprint,
    runtime_policy: runtimePolicy,
  });
  storage.saveOutput(taskId, 'video_execution_plan', executionPlan);
  storage.saveOutput(taskId, 'video_preflight', videoPreflight.publicVideoPreflight(plan));
  return plan;
}

/** 校验不可变视频方案、复杂度确认和人民币费用授权。 */
function assertVideoPreflightConfirmation(taskId, options = {}) {
  const plan = buildVideoPreflightPlan(taskId, options);
  const supplied = String(options.video_preflight_fingerprint || options.videoPreflightFingerprint || '').trim();
  if (!supplied || supplied !== plan.fingerprint) {
    const error = new Error('视频生成方案尚未确认或任务内容已变化。请先查看新的生成前优化方案；本次没有提交视频模型。');
    error.code = 'VIDEO_PREFLIGHT_CONFIRMATION_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  const zeroCostOnly = options.zero_cost_only === true || options.zeroCostOnly === true;
  if (plan.blockers.length && !zeroCostOnly) {
    const error = new Error(plan.blockers.map(item => item.message).join('；'));
    error.code = plan.blockers[0]?.code || 'VIDEO_PREFLIGHT_BLOCKED';
    error.status = 409;
    error.retryable = true;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  if (zeroCostOnly && !plan.zero_cost_action_count) {
    const error = new Error('当前没有可执行的“无需调用视频生成模型”处理，本次没有提交视频模型。');
    error.code = 'VIDEO_PREFLIGHT_NO_ZERO_COST_ACTION';
    error.status = 409;
    error.retryable = false;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  if (!zeroCostOnly && Number(plan.paid_unit_count || 0) > 0) {
    videoCore.costGuard.assertComplexityReview(plan.authorized_execution_plan || plan.execution_plan, options);
    const authorization = videoCore.costGuard.assertCostAuthorization(plan.cost_plan, options);
    storage.saveOutput(taskId, 'video_cost_authorization', {
      ...authorization,
      execution_plan_fingerprint: plan.execution_plan.fingerprint,
      video_preflight_fingerprint: plan.fingerprint,
      authorized_at: new Date().toISOString(),
      status: 'authorized',
    });
  }
  return plan;
}

async function generateVideoStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new videoCore.chineseError.VideoGenerationError('TASK_NOT_FOUND', '', { status: 404 });
  let ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  assertVideoInputsReady({ ctx, shots, keyframes, contracts });
  // 视频供应商调用必须经过不可绕过的方案与人民币费用确认。
  const preflightPlan = assertVideoPreflightConfirmation(taskId, options);
  const generationMode = preflightPlan.mode;
  const zeroCostOnly = options.zero_cost_only === true || options.zeroCostOnly === true;
  const generationShots = generationMode === 'quality' ? preflightPlan.reconciled_shots : shots;
  const localMotionIndexSet = new Set(preflightPlan.local_motion_indexes || []);
  const preflightShotActions = new Map((preflightPlan.shots || []).map(item => [item.index, item]));
  let ttsAudio = storage.getOutput(taskId, 'tts_audio');
  const visualOnly = options.visual_only === true || options.visualOnly === true;
  const selectedVoiceId = resolveTtsVoiceId(options, ctx, ttsAudio);
  const voiceId = visualOnly ? '' : selectedVoiceId;
  const includeVoiceover = !visualOnly && voiceoverEnabled(options, ctx, voiceId);
  const persistedCtx = {
    ...ctx,
    ...(visualOnly ? {} : { voice_id: voiceId, include_voiceover: includeVoiceover }),
    output_ratio: options.aspect_ratio || options.aspectRatio || ctx.output_ratio || '9:16',
    video_resolution: options.video_resolution || options.videoResolution || ctx.video_resolution || '720p',
  };
  ctx = {
    ...persistedCtx,
    include_voiceover: visualOnly ? false : includeVoiceover,
  };
  storage.saveOutput(taskId, 'context', persistedCtx);
  const autoTtsEnabled = includeVoiceover && options.auto_tts !== false && options.autoTts !== false;
  const ttsNeedsRefresh = includeVoiceover && !ttsAdapter.voiceoverPlanMatches(ttsAudio, shots, voiceId);
  if (visualOnly) {
    ttsAudio = silentTtsOutput('visual_only_storyboard_video');
  } else if (!includeVoiceover) {
    ttsAudio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', ttsAudio);
  } else if (ttsNeedsRefresh && autoTtsEnabled) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
  }
  storage.updateTask(taskId, { status: 'running', stage: 'video', error: '', error_code: '', retryable: false });
  storage.saveStage(taskId, 'video', { status: 'running', input_summary: `${shots.length} shot videos` });
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const storyboardMeta = storage.getOutput(taskId, 'storyboard_meta') || {};
  const previousClips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [];
  const forceRegenerateAll = !zeroCostOnly && (generationMode === 'quality'
    || options.force_regenerate_all === true || options.forceRegenerateAll === true);
  const pinnedModel = videoAdapter.resolvePinnedVideoModel(options, previousClips);
  const pinnedRoute = `${String(pinnedModel.provider_id || '').toLowerCase()}/${String(pinnedModel.model_id || '').toLowerCase()}`;
  const preserveExistingTopology = generationMode !== 'quality' && !forceRegenerateAll && previousClips.some(clip => videoLineage.qaApproved(clip || {}));
  const sceneBlocks = sceneBlockService.buildSceneBlocks(generationShots, contracts, {
    ...options,
    preserve_existing_topology: preserveExistingTopology,
    continuous_quality_mode: generationMode === 'quality',
  });
  storage.saveOutput(taskId, 'scene_worlds', preflightPlan.execution_plan?.scene_worlds || []);
  storage.saveOutput(taskId, 'continuity_runs', preflightPlan.execution_plan?.continuity_runs || []);
  storage.saveOutput(taskId, 'generation_units', preflightPlan.execution_plan?.generation_units || []);
  storage.saveOutput(taskId, 'video_scene_blocks', sceneBlocks);
  const audioTracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const expectedLineages = generationShots.map((shot, index) => videoLineage.buildShotLineage({
    shot, index, contract: contracts[index] || {}, keyframe: keyframes[index] || {}, ctx,
    blueprint, storyboardMeta, modelRoute: pinnedRoute,
    speechMode: videoAdapter.explicitShotSpeechMode(shot, contracts[index] || {}),
    motionPrompt: videoAdapter.clipPrompt(shot, ctx, contracts[index] || {}, index > 0 ? generationShots[index - 1] : null, keyframes[index] || {}, preflightPlan.repair_instructions?.[index] || ''),
    audio: audioTracks[index] || {},
    sceneBlock: sceneBlockService.blockForIndex(sceneBlocks, index),
  }));
  let clips = previousClips.slice();
  async function reviewVideoIndexes(reviewedIndexes = [], repairAttempt = 0) {
    const failures = [];
    for (const index of reviewedIndexes) {
      const clip = clips[index];
      if (!videoLineage.clipHasMediaFile(clip)) continue;
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: 'video_qa', qa_status: 'reviewing', repair_attempt: repairAttempt,
        file_path: clip.file_path || '', file_exists: !!(clip.file_path && fs.existsSync(clip.file_path)),
        video_url: clip.video_url || clip.videoUrl || '',
      }, shots.length);
      const plannedAction = preflightShotActions.get(index)?.action || '';
      const savedContractQa = plannedAction === 'review_only'
        ? videoFrameQa.reconcileExistingApprovedPartialPersonQa({ qa: clip.qa || {}, keyframe: keyframes[index] || {}, contract: contracts[index] || {} })
        : null;
      const localMotionQa = plannedAction === 'local_motion'
        ? videoFrameQa.deterministicLocalMotionQa({ clip, keyframe: keyframes[index] || {}, contract: contracts[index] || {} })
        : null;
      const qa = savedContractQa || localMotionQa || await videoFrameQa.reviewVideoClip({ taskId, clip, shot: preflightPlan.reconciled_shots[index] || shots[index] || {}, keyframe: keyframes[index] || {}, contract: contracts[index] || {}, ctx, index });
      clips[index] = { ...clip, qa, error: qa.pass ? '' : '视频抽帧 QA 未通过', error_code: qa.pass ? '' : 'VIDEO_FRAME_QA_FAILED' };
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: qa.pass ? 'qa_passed' : 'qa_failed', qa_status: qa.pass ? 'passed' : 'failed',
        qa_problems: qa.problems || [], qa_failure_dimensions: qa.failure_dimensions || [], qa_failure_labels_zh: qa.failure_labels_zh || [],
        error: qa.pass ? '' : '视频抽帧 QA 未通过', error_code: qa.pass ? '' : 'VIDEO_FRAME_QA_FAILED', retryable: !qa.pass,
      }, shots.length);
      if (!qa.pass) failures.push({ index, kind: 'frame_qa', dimensions: qa.failure_dimensions || [], labels_zh: qa.failure_labels_zh || [], problems: qa.problems || [], retry_instruction: qa.retry_instruction || '', repairable: true });
    }
    const crossIndexes = zeroCostOnly
      ? []
      : [...new Set(reviewedIndexes.flatMap(index => [index, index + 1]).filter(index => index > 0 && index < clips.length))];
    for (const index of crossIndexes) {
      const previous = clips[index - 1];
      const current = clips[index];
      if (!previous?.qa?.pass || !current?.qa?.pass) continue;
      const crossQa = await videoFrameQa.reviewCrossShot({ taskId, previous: previous.qa, current: current.qa, previousShot: generationShots[index - 1] || {}, currentShot: generationShots[index] || {}, ctx });
      clips[index] = { ...current, cross_shot_qa: crossQa, error: crossQa.pass ? '' : '相邻镜头视觉连续性 QA 未通过', error_code: crossQa.pass ? '' : 'CROSS_SHOT_CONTINUITY_FAILED' };
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: crossQa.pass ? 'qa_passed' : 'qa_failed', cross_shot_qa_status: crossQa.pass ? 'passed' : 'failed',
        cross_shot_qa_problems: crossQa.problems || [], cross_shot_failure_dimensions: crossQa.failure_dimensions || [], cross_shot_failure_labels_zh: crossQa.failure_labels_zh || [],
        error: crossQa.pass ? '' : '相邻镜头视觉连续性 QA 未通过', error_code: crossQa.pass ? '' : 'CROSS_SHOT_CONTINUITY_FAILED', retryable: !crossQa.pass,
      }, shots.length);
      if (!crossQa.pass) failures.push({ index, kind: 'cross_shot_qa', dimensions: crossQa.failure_dimensions || [], labels_zh: crossQa.failure_labels_zh || [], problems: crossQa.problems || [], retry_instruction: crossQa.retry_instruction || '', repairable: true });
    }
    storage.saveOutput(taskId, 'video_clips', clips);
    return failures;
  }
  const initialIndexes = [];
  const pendingReviewIndexes = [];
  const requestedOnlyIndex = options.only_index ?? options.onlyIndex;
  const requestedIndexes = Array.isArray(options.only_indexes || options.onlyIndexes)
    ? (options.only_indexes || options.onlyIndexes)
    : (requestedOnlyIndex !== null && requestedOnlyIndex !== undefined && Number.isInteger(Number(requestedOnlyIndex)) ? [Number(requestedOnlyIndex)] : []);
  const requestedIndexSet = requestedIndexes.length
    ? new Set(requestedIndexes.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < shots.length))
    : null;
  if (requestedIndexSet && !requestedIndexSet.size) {
    const error = new Error('指定的镜头序号无效，已停止生成以避免误生成全部镜头');
    error.code = 'VIDEO_SHOT_INDEX_INVALID';
    error.status = 422;
    throw error;
  }
  const forcedIndexSet = new Set((Array.isArray(options.force_regenerate_indexes || options.forceRegenerateIndexes)
    ? (options.force_regenerate_indexes || options.forceRegenerateIndexes)
    : []).map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < shots.length));
  shots.forEach((_, index) => {
    if (requestedIndexSet && !requestedIndexSet.has(index)) return;
    const planned = preflightShotActions.get(index) || {};
    if (zeroCostOnly && !['local_motion', 'review_only'].includes(planned.action)) return;
    if (planned.action === 'review_only') {
      if (videoLineage.clipHasMediaFile(clips[index])) pendingReviewIndexes.push(index);
      return;
    }
    if (planned.action === 'local_motion') {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    if (planned.action === 'provider_generate' && videoLineage.clipHasMediaFile(clips[index]) && (planned.changes || []).length) {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    if (forceRegenerateAll || forcedIndexSet.has(index)) {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    const existingClip = clips[index] || {};
    const existingLineage = existingClip.lineage_fingerprint || existingClip.lineage?.fingerprint || '';
    const reviewExistingOnly = (options.missing_only === true || options.missingOnly === true)
      && videoLineage.clipHasMediaFile(existingClip)
      && existingLineage === expectedLineages[index].fingerprint
      && !videoLineage.qaApproved(existingClip);
    if (reviewExistingOnly) {
      pendingReviewIndexes.push(index);
      return;
    }
    const decision = videoLineage.reuseDecision(clips[index], expectedLineages[index]);
    if (decision.reusable) {
      if (decision.adopted) clips[index] = videoLineage.attachLineage(clips[index], expectedLineages[index], { lineage_adopted_at: new Date().toISOString() });
      return;
    }
    const reviewable = videoLineage.reviewableDecision(clips[index], expectedLineages[index]);
    if (reviewable.reviewable) {
      pendingReviewIndexes.push(index);
      return;
    }
    initialIndexes.push(index);
    clips[index] = null;
  });
  if (pendingReviewIndexes.length) {
    const pendingFailures = await reviewVideoIndexes(pendingReviewIndexes, 0);
    const rejectedIndexes = new Set(pendingFailures.map(item => item.index));
    pendingReviewIndexes.forEach((index) => {
      if (!rejectedIndexes.has(index) && videoLineage.qaApproved(clips[index])) {
        clips[index] = videoLineage.attachLineage(clips[index], expectedLineages[index], { lineage_adopted_at: new Date().toISOString(), recovered_before_regeneration: true });
        return;
      }
      if ((options.missing_only === true || options.missingOnly === true) && videoLineage.clipHasMediaFile(clips[index])) {
        return;
      }
      initialIndexes.push(index);
      clips[index] = null;
    });
  }
  const expandedInitialIndexes = sceneBlockService.expandIndexesToBlocks(initialIndexes, sceneBlocks);
  expandedInitialIndexes.forEach(index => { clips[index] = null; });
  if (expandedInitialIndexes.length) storage.deleteOutput(taskId, 'final_video');
  // 付费视频禁止自动重试；失败后只能由用户查看新方案并再次明确确认。
  const maxRepairs = 0;
  const initialBlockIds = new Set(expandedInitialIndexes.map(index => sceneBlockService.blockForIndex(sceneBlocks, index)?.id).filter(Boolean));
  const initialVideoSeconds = sceneBlocks.filter(block => initialBlockIds.has(block.id)).reduce((sum, block) => sum + Number(block.duration_sec || 0), 0);
  const policy = {
    version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
    scene_block_policy_version: sceneBlockService.SCENE_BLOCK_POLICY_VERSION,
    model_route: pinnedRoute,
    max_auto_repairs: maxRepairs,
    scene_block_count: sceneBlocks.length,
    continuous_scene_block_count: sceneBlocks.filter(block => block.continuous).length,
    planned_initial_video_seconds: initialVideoSeconds,
    planned_max_auto_repair_seconds: initialVideoSeconds * maxRepairs,
    planned_max_video_seconds: initialVideoSeconds * (maxRepairs + 1),
    adopted_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, 'video_pipeline_policy', policy);
  storage.saveOutput(taskId, 'video_clips', clips);
  let targetIndexes = expandedInitialIndexes;
  let repairAttempt = 0;
  let repairInstructions = {};
  let lastGenerated = { provider_used: pinnedRoute, schedule: null };
  let qaFailures = [];
  while (targetIndexes.length) {
    storage.updateTask(taskId, {
      status: 'running', stage: repairAttempt ? 'video_repair' : 'video', error: '', error_code: '', retryable: false,
      generation_progress: { ...(storage.getTask(taskId)?.generation_progress || {}), repair_attempt: repairAttempt, max_repair_attempts: maxRepairs, repair_indexes: targetIndexes.map(index => index + 1) },
    });
    targetIndexes = sceneBlockService.expandIndexesToBlocks(targetIndexes, sceneBlocks);
    let generationError = null;
    try {
      lastGenerated = await videoAdapter.generateSceneBlockVideos({
        taskId, shots: generationShots, keyframes, ttsAudio, contracts, ctx,
        sceneBlocks,
        options: {
          ...options,
          only_indexes: targetIndexes,
          _pinnedVideoModel: pinnedModel,
          _expectedLineages: expectedLineages,
          _repairInstructions: { ...(preflightPlan.repair_instructions || {}), ...repairInstructions },
          _localMotionIndexes: [...localMotionIndexSet],
          _keyframeReferenceOnlyIndexes: preflightPlan.keyframe_reference_only_indexes || [],
          _repairAttempt: repairAttempt,
        },
        existingClips: clips,
        onClip: async (clip, nextClips) => {
          storage.saveOutput(taskId, 'video_clips', nextClips);
          storage.saveStage(taskId, 'video', {
            status: 'running', input_summary: `${shots.length} shot videos`,
            output_summary: `${nextClips.filter(Boolean).length}/${shots.length} video clips`,
            diagnostics: { last_provider_used: clip.provider_used || '', repair_attempt: repairAttempt },
          });
        },
      });
      clips = lastGenerated.clips.slice();
    } catch (error) {
      generationError = error;
      const partialClips = Array.isArray(error.partial_video_clips)
        ? error.partial_video_clips
        : storage.getOutput(taskId, 'video_clips');
      if (Array.isArray(partialClips)) clips = partialClips.slice();
      lastGenerated = {
        provider_used: pinnedRoute,
        schedule: null,
        target_indexes: Array.isArray(error.target_indexes) ? error.target_indexes : targetIndexes,
      };
    }
    const candidateReviewedIndexes = generationError && Array.isArray(generationError.completed_indexes)
      ? generationError.completed_indexes
      : (Array.isArray(lastGenerated.target_indexes) ? lastGenerated.target_indexes : targetIndexes);
    const reviewedIndexes = candidateReviewedIndexes.filter(index => videoLineage.clipHasUsableFile(clips[index]));
    qaFailures = await reviewVideoIndexes(reviewedIndexes, repairAttempt);
    if (generationError) {
      generationError.partial_video_clips = clips.slice();
      generationError.completed_indexes = reviewedIndexes;
      storage.saveOutput(taskId, 'video_clips', clips);
      throw generationError;
    }
    if (!qaFailures.length) break;
    const plan = videoRepairPolicy.buildRepairPlan(qaFailures, { attempt: repairAttempt, maxAttempts: maxRepairs });
    const history = Array.isArray(storage.getOutput(taskId, 'video_repair_history')) ? storage.getOutput(taskId, 'video_repair_history') : [];
    history.push({
      attempt: repairAttempt, next_attempt: plan.next_attempt, max_attempts: maxRepairs,
      status: plan.can_retry ? 'retrying' : 'exhausted', indexes: plan.failures.map(item => item.index + 1),
      failures: plan.failures, policy_version: policy.version, recorded_at: new Date().toISOString(),
    });
    storage.saveOutput(taskId, 'video_repair_history', history.slice(-100));
    if (!plan.can_retry) break;
    repairAttempt = plan.next_attempt;
    targetIndexes = plan.indexes;
    repairInstructions = plan.instructions;
    storage.saveStage(taskId, 'video', {
      status: 'running', input_summary: `${shots.length} shot videos`,
      output_summary: `正在自动修复第 ${targetIndexes.map(index => index + 1).join('、')} 镜（${repairAttempt}/${maxRepairs}）`,
      diagnostics: { qa_failures: plan.failures, repair_attempt: repairAttempt, max_repair_attempts: maxRepairs },
    });
  }
  storage.saveOutput(taskId, 'video_clips', clips);
  if (qaFailures.length) {
    const mergedFailures = videoRepairPolicy.mergeFailures(qaFailures);
    storage.saveStage(taskId, 'video', { status: 'failed', output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips`, error: '视频审片未通过', diagnostics: { qa_failures: mergedFailures, repair_attempts_used: repairAttempt, max_repair_attempts: maxRepairs } });
    storage.updateTask(taskId, { status: 'failed', stage: 'video_failed', error: `部分镜头在 ${repairAttempt} 次自动修复后仍未通过视觉审核`, error_code: 'VIDEO_QA_FAILED', retryable: true });
    const error = new Error('视频审片未通过：' + mergedFailures.map(item => `第 ${item.index + 1} 镜（${item.labels_zh.join('、') || '质量审核'}）`).join('；'));
    error.code = 'VIDEO_QA_FAILED'; error.retryable = true; error.video_clips = clips; error.qa_failures = mergedFailures;
    throw error;
  }
  const remainingUnapproved = shots.map((_, index) => index).filter(index => !videoLineage.qaApproved(clips[index] || {}));
  if (remainingUnapproved.length) {
    storage.saveStage(taskId, 'video', {
      status: 'partial',
      output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips；仍有 ${remainingUnapproved.length} 镜待处理`,
      diagnostics: { remaining_unapproved_indexes: remainingUnapproved.map(index => index + 1), policy_version: policy.version },
    });
    storage.updateTask(taskId, {
      status: 'failed', stage: 'video_failed',
      error: `仍有镜头需要生成、审核或人工处理：${remainingUnapproved.map(index => `第 ${index + 1} 镜`).join('、')}`,
      error_code: 'VIDEO_SHOTS_REMAINING', retryable: true,
    });
    return { video_clips: clips, partial: true, remaining_unapproved_indexes: remainingUnapproved };
  }
  storage.saveStage(taskId, 'video', {
    status: 'done',
    output_summary: `${clips.filter(Boolean).length} video clips`,
    diagnostics: { provider_used: lastGenerated.provider_used || pinnedRoute, schedule: lastGenerated.schedule || null, policy_version: policy.version, repair_attempts_used: repairAttempt },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'video_ready' });
  return { video_clips: clips };
}

function acceptVideoClipOverride(taskId, shotIndex, input = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const clips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips').slice() : [];
  const index = Number(shotIndex);
  const clip = clips[index];
  const hasFile = !!(clip && ((clip.file_path && fs.existsSync(clip.file_path)) || clip.video_url || clip.videoUrl));
  if (!Number.isInteger(index) || index < 0 || !shots[index] || !hasFile) {
    const error = new Error('要人工确认的镜头视频不存在或文件不可用');
    error.code = 'VIDEO_CLIP_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (!clip.lineage_fingerprint) {
    const error = new Error('该视频没有当前分镜版本来源记录，不能人工确认，请重新生成本镜视频');
    error.code = 'VIDEO_LINEAGE_REQUIRED';
    error.status = 422;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const reason = cleanText(input.reason || '用户已查看本镜视频并确认接受当前效果', 500);
  const acceptedBy = {
    id: cleanText(user.id || user.userId || '', 100),
    name: cleanText(user.name || user.username || user.nickname || '', 100),
    source: cleanText(input.source || 'story_ad_ui', 80),
  };
  const originalQa = clip.qa && typeof clip.qa === 'object' ? { ...clip.qa } : {};
  const manualAcceptance = {
    approved: true,
    accepted_at: acceptedAt,
    accepted_by: acceptedBy,
    reason,
    original_qa: originalQa,
    original_cross_shot_qa: clip.cross_shot_qa || null,
  };
  clips[index] = {
    ...clip,
    qa: {
      ...originalQa,
      pass: true,
      status: 'manual_accepted',
      manual_override: true,
      model_pass: originalQa.pass === true,
      decision_source: 'human_override',
      override_reason: reason,
      overridden_at: acceptedAt,
      overridden_by: acceptedBy,
    },
    cross_shot_qa: clip.cross_shot_qa?.pass === false
      ? { ...clip.cross_shot_qa, pass: true, status: 'manual_accepted', manual_override: true }
      : clip.cross_shot_qa,
    manual_acceptance: manualAcceptance,
    error: '',
    error_code: '',
  };
  storage.saveOutput(taskId, 'video_clips', clips);
  storage.deleteOutput(taskId, 'final_video');
  videoAdapter.updateVideoShotStatus(taskId, index, {
    lifecycle: 'qa_passed', qa_status: 'manual_accepted', manual_acceptance: manualAcceptance,
    error: '', error_code: '', retryable: false,
  }, shots.length);
  const remaining = shots.map((_, shot) => shot).filter(shot => !videoLineage.qaApproved(clips[shot] || {}));
  storage.saveStage(taskId, 'video', {
    status: remaining.length ? 'partial' : 'done',
    output_summary: remaining.length ? `人工接受第 ${index + 1} 镜；仍有 ${remaining.length} 镜待处理` : `${clips.length} video clips`,
    diagnostics: { manually_accepted_shot_index: index + 1, remaining_unapproved_indexes: remaining.map(shot => shot + 1) },
  });
  storage.updateTask(taskId, {
    status: remaining.length ? 'failed' : 'done',
    stage: remaining.length ? 'video_failed' : 'video_ready',
    error: remaining.length ? `仍有镜头待处理：${remaining.map(shot => `第 ${shot + 1} 镜`).join('、')}` : '',
    error_code: remaining.length ? 'VIDEO_SHOTS_REMAINING' : '',
    retryable: remaining.length > 0,
  });
  return { video_clip: clips[index], video_clips: clips, remaining_unapproved_indexes: remaining };
}

function finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate, options = {}) {
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const currentFingerprint = contracts[index]?.contract_fingerprint || '';
  if (!currentFingerprint) {
    const error = new Error('当前镜头生成约束不存在，请先重新生成分镜合同');
    error.code = 'KEYFRAME_CONTRACT_REQUIRED';
    error.status = 422;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const generationId = cleanText(candidate.generation_id || frame.current_generation_id || '', 80);
  const manualAcceptance = options.manual_acceptance || null;
  const acceptedQa = options.qa || candidate.qa;
  const acceptedStatus = manualAcceptance ? 'manual_accepted' : 'accepted';
  const acceptedCandidate = {
    ...candidate,
    qa: acceptedQa,
    qa_policy_version: 2,
    contract_fingerprint: currentFingerprint,
    status: acceptedStatus,
    ...(manualAcceptance ? { manual_acceptance: manualAcceptance } : {}),
  };
  const candidates = (Array.isArray(frame.candidates) ? frame.candidates : []).map(item => (
    String(item.id) === String(candidate.id) ? acceptedCandidate : item
  ));
  keyframes[index] = {
    ...frame,
    candidates,
    image_url: candidate.image_url,
    imageUrl: candidate.image_url,
    qa: acceptedQa,
    qa_policy_version: 2,
    contract_fingerprint: currentFingerprint,
    contract_outdated: false,
    contract_outdated_reason: '',
    provider_used: candidate.provider_used || frame.provider_used,
    selected_candidate_id: candidate.id,
    error: '',
    error_code: '',
    regeneration_error: '',
    regeneration_error_code: '',
    regeneration_failed_at: '',
    current_generation_status: acceptedStatus,
    current_generation_id: generationId,
    manual_acceptance: manualAcceptance,
    accepted_revision: {
      generation_id: generationId,
      accepted_at: acceptedAt,
      qa_policy_version: 2,
      selected_candidate_id: candidate.id,
      decision_source: manualAcceptance ? 'human_override' : 'model_qa',
    },
    latest_attempt: { generation_id: generationId, status: acceptedStatus, selected_candidate_id: candidate.id, finished_at: acceptedAt },
  };
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.deleteOutput(taskId, 'video_clips');
  storage.deleteOutput(taskId, 'final_video');
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const completion = keyframeCompletion(keyframes, shots);
  const allCurrent = completion.total > 0 && completion.fresh_pass === completion.total;
  storage.saveStage(taskId, 'keyframes', {
    status: allCurrent ? 'done' : 'partial',
    output_summary: `${completion.fresh_pass}/${completion.total} current keyframes verified`,
    diagnostics: {
      keyframe_status: completion,
      manually_selected_candidate: candidate.id,
      ...(manualAcceptance ? { human_override: { shot_index: index, ...manualAcceptance } } : {}),
    },
  });
  storage.updateTask(taskId, {
    status: allCurrent ? 'done' : 'failed',
    stage: allCurrent ? 'keyframes_ready' : 'keyframes_partial',
    error: allCurrent ? '' : '仍有镜头未通过当前版本视觉 QA',
    error_code: allCurrent ? '' : 'KEYFRAME_REGENERATION_REJECTED',
  });
  return { keyframe: keyframes[index], keyframes, completion };
}

function selectKeyframeCandidate(taskId, shotIndex, candidateId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  if (!frame) {
    const error = new Error('要选择候选图的镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = (Array.isArray(frame.candidates) ? frame.candidates : []).find(item => String(item.id) === String(candidateId));
  if (!candidate) {
    const error = new Error('候选关键帧不存在');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (candidate.qa?.pass !== true || candidate.status === 'rejected') {
    const error = new Error('该候选未通过场景、人物或产品一致性 QA，不能设为正式关键帧');
    error.code = 'KEYFRAME_CANDIDATE_NOT_ACCEPTABLE';
    error.status = 422;
    throw error;
  }
  if (Number(candidate.qa_policy_version || 0) < 2) {
    const error = new Error('该候选使用旧版视觉 QA，不能直接设为正式关键帧，请重新生成后再选择');
    error.code = 'KEYFRAME_CANDIDATE_QA_OUTDATED';
    error.status = 422;
    throw error;
  }
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const currentFingerprint = contracts[index]?.contract_fingerprint || '';
  if (!currentFingerprint || candidate.contract_fingerprint !== currentFingerprint) {
    const error = new Error('该候选与当前镜头信息或生成约束不一致，请重新生成本镜头');
    error.code = 'KEYFRAME_CANDIDATE_CONTRACT_OUTDATED';
    error.status = 422;
    throw error;
  }
  return finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate);
}

function acceptKeyframeCandidateOverride(taskId, shotIndex, candidateId, input = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  if (!frame) {
    const error = new Error('要人工确认的镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = (Array.isArray(frame.candidates) ? frame.candidates : []).find(item => String(item.id) === String(candidateId));
  if (!candidate || !keyframeImageUrl(candidate) || !localKeyframeAssetExists(keyframeImageUrl(candidate))) {
    const error = new Error('候选关键帧不存在或图片文件不可用');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const currentFingerprint = cleanText(contracts[index]?.contract_fingerprint || '', 160);
  if (!currentFingerprint) {
    const error = new Error('当前镜头生成约束不存在，不能人工确认');
    error.code = 'KEYFRAME_CONTRACT_REQUIRED';
    error.status = 422;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const reason = cleanText(input.reason || '用户确认当前画面符合创作意图', 500);
  const acceptedBy = {
    id: cleanText(user.id || user.userId || '', 100),
    name: cleanText(user.name || user.username || user.nickname || '', 100),
    source: cleanText(input.source || 'story_ad_ui', 80),
  };
  const originalQa = candidate.qa && typeof candidate.qa === 'object' ? { ...candidate.qa } : {};
  const manualAcceptance = {
    accepted_at: acceptedAt,
    accepted_by: acceptedBy,
    reason,
    original_status: cleanText(candidate.status || '', 80),
    original_qa: originalQa,
    previous_contract_fingerprint: cleanText(candidate.contract_fingerprint || '', 160),
    current_contract_fingerprint: currentFingerprint,
  };
  const qa = {
    ...originalQa,
    pass: true,
    status: 'manual_accepted',
    manual_override: true,
    model_pass: originalQa.pass === true,
    decision_source: 'human_override',
    override_reason: reason,
    overridden_at: acceptedAt,
    overridden_by: acceptedBy,
  };
  return finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate, {
    qa,
    manual_acceptance: manualAcceptance,
  });
}

async function retryKeyframeCandidateQa(taskId, shotIndex, candidateId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  const shot = shots[index];
  const contract = contracts[index] || {};
  if (!frame || !shot) {
    const error = new Error('要重新验证的候选镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidates = Array.isArray(frame.candidates) ? frame.candidates.slice() : [];
  const candidateIndex = candidates.findIndex(item => String(item.id) === String(candidateId));
  if (candidateIndex < 0) {
    const error = new Error('要重新验证的候选关键帧不存在');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = candidates[candidateIndex];
  const currentFingerprint = contract.contract_fingerprint || '';
  if (!currentFingerprint || candidate.contract_fingerprint !== currentFingerprint) {
    const error = new Error('该候选与当前镜头设置不一致，不能重新验证');
    error.code = 'KEYFRAME_CANDIDATE_CONTRACT_OUTDATED';
    error.status = 422;
    throw error;
  }
  const reviewStartedAt = Date.parse(candidate.qa_review_started_at || 0) || 0;
  if (candidate.status === 'qa_reviewing' && Date.now() - reviewStartedAt < 10 * 60 * 1000) {
    const error = new Error('该候选正在重新验证，请勿重复提交');
    error.code = 'KEYFRAME_CANDIDATE_QA_IN_PROGRESS';
    error.status = 409;
    throw error;
  }

  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const sceneAsset = sceneAssetForShot(ctx, shot, index);
  const qaHistory = Array.isArray(candidate.qa_history) ? candidate.qa_history.slice(-4) : [];
  if (candidate.qa && !['reviewing', 'unavailable'].includes(String(candidate.qa.status || ''))) {
    qaHistory.push(candidate.qa);
  }
  const reusableQa = [...qaHistory].reverse().find(item => {
    const scene = item?.scene || {};
    return ['scene_consistency_score', 'anchor_consistency_score', 'camera_match_score', 'material_match_score']
      .every(field => Number.isFinite(Number(scene[field])));
  });
  if (reusableQa) {
    const reclassifiedSceneQa = sceneSpace.normalizeKeyframeQa(reusableQa.scene || {});
    const reclassifiedQa = combineKeyframeQa({
      ctx,
      shot,
      contract,
      sceneReference: selectedSceneReference(sceneAsset, contract),
      sceneQa: reclassifiedSceneQa,
      personQa: reusableQa.person || {},
      productQa: reusableQa.product || {},
    });
    if (reclassifiedQa.pass) {
      candidates[candidateIndex] = {
        ...candidate,
        qa: { ...reclassifiedQa, reused_structured_review: true, reclassified_at: new Date().toISOString() },
        qa_history: qaHistory.slice(-5),
        status: 'accepted',
        qa_policy_version: 2,
        qa_reviewed_at: new Date().toISOString(),
      };
      keyframes[index] = {
        ...frame,
        candidates,
        current_generation_status: 'accepted',
        regeneration_error: '',
        regeneration_error_code: '',
      };
      storage.saveOutput(taskId, 'keyframes', keyframes);
      const selected = selectKeyframeCandidate(taskId, index, candidate.id);
      return {
        ...selected,
        status: 'accepted',
        qa: candidates[candidateIndex].qa,
        media_generated: false,
        vision_review_reused: true,
      };
    }
  }
  const startedAt = new Date().toISOString();
  candidates[candidateIndex] = {
    ...candidate,
    qa_history: qaHistory.slice(-5),
    status: 'qa_reviewing',
    qa_review_started_at: startedAt,
    qa: { ...(candidate.qa || {}), pass: false, status: 'reviewing', error: '' },
  };
  keyframes[index] = {
    ...frame,
    candidates,
    current_generation_status: 'qa_reviewing',
    regeneration_error: '',
    regeneration_error_code: '',
  };
  storage.saveOutput(taskId, 'keyframes', keyframes);

  try {
    const reviewed = await runKeyframeQaReviews({
      taskId,
      ctx,
      shot,
      contract,
      sceneAsset,
      generatedUrl: candidate.image_url || candidate.imageUrl || '',
    });
    const qa = combineKeyframeQa({
      ctx,
      shot,
      contract,
      sceneReference: reviewed.sceneReference,
      sceneQa: reviewed.sceneQa,
      personQa: reviewed.personQa,
      productQa: reviewed.productQa,
    });
    const status = qa.pass ? 'accepted' : 'rejected';
    candidates[candidateIndex] = {
      ...candidate,
      qa,
      qa_history: qaHistory.slice(-5),
      status,
      qa_policy_version: 2,
      qa_review_started_at: startedAt,
      qa_reviewed_at: new Date().toISOString(),
    };
    keyframes[index] = {
      ...frame,
      candidates,
      current_generation_status: qa.pass ? 'accepted' : 'rejected',
      regeneration_error: qa.pass ? '' : `视觉 QA 未通过：${qa.mismatch_reasons.join('；') || '画面与当前合同不一致'}`,
      regeneration_error_code: qa.pass ? '' : 'KEYFRAME_CANDIDATE_QA_REJECTED',
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    if (qa.pass) {
      const selected = selectKeyframeCandidate(taskId, index, candidate.id);
      return { ...selected, status: 'accepted', qa, media_generated: false };
    }
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `shot ${index + 1} existing candidate QA rejected`,
      diagnostics: { candidate_id: candidate.id, qa_retry_only: true, media_generated: false, qa },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', retryable: true });
    return { status: 'rejected', qa, keyframe: keyframes[index], keyframes, media_generated: false };
  } catch (error) {
    const unavailable = isQaInfrastructureError(error);
    const qa = { pass: false, status: unavailable ? 'unavailable' : 'failed', error: String(error.message || error), checked_at: new Date().toISOString() };
    candidates[candidateIndex] = {
      ...candidate,
      qa,
      qa_history: qaHistory.slice(-5),
      status: unavailable ? 'qa_unavailable' : 'rejected',
      qa_policy_version: 2,
      qa_review_started_at: startedAt,
      qa_reviewed_at: new Date().toISOString(),
    };
    keyframes[index] = {
      ...frame,
      candidates,
      current_generation_status: unavailable ? 'qa_unavailable' : 'rejected',
      regeneration_error: String(error.message || error),
      regeneration_error_code: unavailable ? 'VISION_QA_UNAVAILABLE' : (error.code || 'KEYFRAME_CANDIDATE_QA_FAILED'),
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `shot ${index + 1} existing candidate QA unavailable`,
      diagnostics: { candidate_id: candidate.id, qa_retry_only: true, media_generated: false, error: qa.error, error_code: error.code || '' },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', retryable: true });
    return { status: unavailable ? 'qa_unavailable' : 'rejected', qa, keyframe: keyframes[index], keyframes, media_generated: false, retryable: unavailable };
  }
}

function subtitleTextFromShot(shot = {}) {
  return cleanText(
    shot.voiceover || shot.narration || shot.dialogue || shot.ad_copy || shot.copy || shot.subtitle || '',
    260
  ).replace(/^(字幕|旁白|台词)\s*[：:]\s*/i, '');
}

function subtitleSegmentsFromShots(shots = [], subtitleConfig = {}) {
  const config = typeof subtitleConfig === 'string' ? { style: subtitleConfig } : (subtitleConfig || {});
  const subtitleStyle = cleanText(config.style || config.subtitleStyle || 'popup', 60);
  const fontName = cleanText(config.fontName || '', 80);
  const fontSize = Math.max(24, Math.min(120, Number(config.fontSize) || 72));
  const color = /^#[0-9a-f]{6}$/i.test(String(config.color || '')) ? String(config.color) : '';
  const outlineColor = /^#[0-9a-f]{6}$/i.test(String(config.outlineColor || '')) ? String(config.outlineColor) : '';
  let cursor = 0;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const duration = Math.max(1, Math.min(30, Number(shot.duration_sec || shot.duration || shot.seconds || 3) || 3));
    const text = subtitleTextFromShot(shot);
    const segment = text ? {
      text,
      startTime: cursor,
      endTime: cursor + duration,
      preset: 'subtitle',
      style: 'subtitle',
      subtitleStyle,
      smartEmphasis: config.smartEmphasis !== false,
      ...(fontName ? { fontName } : {}),
      fontSize,
      ...(color ? { fontcolor: color } : {}),
      ...(outlineColor ? { bordercolor: outlineColor } : {}),
      shot_index: index + 1,
    } : null;
    cursor += duration;
    return segment;
  }).filter(Boolean);
}

async function composeStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  let ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  // Composition must never generate visual clips. Step 4 owns storyboard video
  // generation and review; step 5 only mixes optional audio/effects and joins
  // the already-approved clips.
  const clips = Array.isArray(storage.getOutput(taskId, 'video_clips'))
    ? storage.getOutput(taskId, 'video_clips')
    : [];
  const unapproved = shots.map((_, index) => index).filter(index => (
    !videoLineage.clipHasUsableFile(clips[index]) || !videoLineage.qaApproved(clips[index]) || !clips[index]?.lineage_fingerprint
  ));
  if (unapproved.length) {
    const error = new Error(`当前版本仍有未审片或来源不匹配的镜头：${unapproved.map(index => `第 ${index + 1} 镜`).join('、')}`);
    error.code = 'COMPOSE_CLIP_LINEAGE_INVALID';
    error.retryable = true;
    throw error;
  }
  let ttsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  const composeVoiceId = resolveTtsVoiceId(options, ctx, ttsAudio);
  const includeVoiceover = voiceoverEnabled(options, ctx, composeVoiceId);
  if (includeVoiceover && !ttsAdapter.voiceoverPlanMatches(ttsAudio, shots, composeVoiceId)) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
    ctx = storage.getOutput(taskId, 'context') || ctx;
  } else if (!includeVoiceover) {
    ttsAudio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', ttsAudio);
  }
  storage.updateTask(taskId, {
    status: 'running',
    stage: 'compose',
    generation_progress: {
      ...(storage.getTask(taskId)?.generation_progress || {}),
      stage: 'compose', status: 'running', updated_at: new Date().toISOString(),
    },
  });
  storage.saveStage(taskId, 'compose', { status: 'running', input_summary: `${clips.length} clips` });
  const subtitleEnabled = Object.prototype.hasOwnProperty.call(options, 'subtitle')
    ? options.subtitle !== false
    : ctx.subtitle !== false;
  const subtitleStyle = cleanText(options.subtitle_style || options.subtitleStyle || ctx.subtitle_style || ctx.subtitleStyle || 'popup', 60);
  const rawSubtitleConfig = options.subtitle_config || options.subtitleConfig || ctx.subtitle_config || ctx.subtitleConfig || {};
  const subtitleConfig = {
    ...(rawSubtitleConfig && typeof rawSubtitleConfig === 'object' ? rawSubtitleConfig : {}),
    show: subtitleEnabled,
    style: subtitleStyle,
  };
  const hasBgmAssetOption = Object.prototype.hasOwnProperty.call(options, 'bgm_asset')
    || Object.prototype.hasOwnProperty.call(options, 'bgmAsset');
  const bgmAsset = hasBgmAssetOption
    ? (options.bgm_asset ?? options.bgmAsset ?? null)
    : (ctx.bgm_asset || ctx.bgmAsset || null);
  const composeVoiceName = Object.prototype.hasOwnProperty.call(options, 'voice_name')
    || Object.prototype.hasOwnProperty.call(options, 'voiceName')
    ? cleanText(options.voice_name ?? options.voiceName ?? '', 120)
    : cleanText(ctx.voice_name || ctx.voiceName || '', 120);
  storage.saveOutput(taskId, 'context', {
    ...ctx,
    voice_id: composeVoiceId,
    voice_name: composeVoiceName,
    include_voiceover: includeVoiceover,
    voice_volume: options.voice_volume ?? options.voiceVolume ?? ctx.voice_volume ?? ctx.voiceVolume ?? 1,
    bgm_volume: options.bgm_volume ?? options.bgmVolume ?? ctx.bgm_volume ?? ctx.bgmVolume ?? 0.16,
    bgm_profile: cleanText(options.bgm_profile || options.bgmProfile || ctx.bgm_profile || ctx.bgmProfile || 'auto', 60),
    bgm_asset: bgmAsset,
    subtitle: subtitleEnabled,
    subtitle_style: subtitleStyle,
    subtitle_config: subtitleConfig,
  });
  const final_video = await composeService.concatVideos({
    taskId,
    clips,
    ttsAudio,
    bgmAsset,
    bgmVolume: options.bgm_volume ?? options.bgmVolume ?? ctx.bgm_volume ?? ctx.bgmVolume ?? 0.16,
    voiceVolume: options.voice_volume ?? options.voiceVolume ?? ctx.voice_volume ?? ctx.voiceVolume ?? 1,
    subtitles: subtitleSegmentsFromShots(shots, subtitleConfig),
    subtitleEnabled,
    subtitleStyle,
    transitions: shots,
  });
  const finalVideoWithLineage = {
    ...final_video,
    pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
    clip_lineage_fingerprints: clips.map(clip => clip.lineage_fingerprint),
    scene_blocks: [...new Map(clips.filter(clip => clip.scene_block_id).map(clip => [clip.scene_block_id, {
      id: clip.scene_block_id,
      fingerprint: clip.scene_block_fingerprint || '',
      members: clip.scene_block_members || [],
    }])).values()],
  };
  storage.saveOutput(taskId, 'final_video', finalVideoWithLineage);
  storage.saveStage(taskId, 'compose', {
    status: 'done',
    output_summary: `final video from ${final_video.clip_count || clips.length} clips`,
    diagnostics: { provider_used: final_video.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'final_video_ready' });
  return { final_video: finalVideoWithLineage, video_clips: clips };
}

async function runFull(body = {}, user = {}) {
  const { task, context } = createTask(body, user);
  try {
    const scene_config = await generateSceneConfig(task.id);
    const blueprint = await generateBlueprintStage(task.id);
    const storyboard = await generateStoryboardStage(task.id);
    return {
      success: true,
      task_id: task.id,
      task: storage.getTask(task.id),
      context,
      scene_config,
      blueprint,
      ...storyboard,
      bundle: publicTaskBundle(task.id),
    };
  } catch (err) {
    const message = String(err.message || err);
    storage.updateTask(task.id, { status: 'failed', error: message, stage: 'failed' });
    return {
      success: false,
      task_id: task.id,
      error: message,
      review: err.review || null,
      partial: err.partial || null,
      bundle: publicTaskBundle(task.id),
    };
  }
}

function modelHealth() {
  return storage.readHealth();
}

const PERSON_AGE_LABELS = {
  young_adult_17_25: '17-25岁年轻成人年龄感',
  young_adult: '25-32岁青年年龄感',
  adult_30_40: '30-40岁成熟青年年龄感',
  middle_40_55: '40-55岁中年年龄感',
  senior_55_plus: '55岁以上年长者年龄感',
};

function alignPersonAgeDescription(text = '', age = '') {
  const label = PERSON_AGE_LABELS[String(age || '')];
  if (!label) return cleanText(text, 360);
  const cleaned = String(text || '')
    .replace(/\d{2}\s*(?:-|—|–|至|到|~)\s*\d{2}\s*岁?/g, '')
    .replace(/(?:年龄(?:约为|为|约)?|约|大约|看起来)?\s*\d{2}\s*(?:岁|周岁)(?:左右|上下)?/g, '')
    .replace(/^[\s，、；:：的]+|[\s，、；]+$/g, '')
    .replace(/[，、；]{2,}/g, '，');
  return cleanText(`${label}，${cleaned || '外貌、体态、肤质和表情应符合该年龄阶段的真实商业人物特征'}`, 360);
}

/**
 * 为人物辅助补齐生成与当前任务相关的安全默认值，避免模型部分返回造成一致性字段为空。
 */
function assistedPersonSpecFallback(spec = {}, current = {}, context = {}) {
  const merged = { ...(current && typeof current === 'object' ? current : {}), ...(spec && typeof spec === 'object' ? spec : {}) };
  const role = cleanText(merged.roleName || merged.role_name || '广告主角', 80);
  const subject = cleanText(context.product_subject || context.brief || '当前广告主体', 80);
  const ageLabel = PERSON_AGE_LABELS[String(merged.age || '')] || '符合目标用户与剧情关系的真实成年人物年龄感';
  return {
    appearanceText: `${ageLabel}，${role}的脸型、体态、肤质和表情自然可信，保持真实商业摄影质感，避免网红脸、过度磨皮和夸张表演。`,
    wardrobeText: `${role}穿着符合${subject}定位和使用场景的真实服装；明确上衣、下装或裙装、鞋、配饰、颜色与材质，整体克制协调，并在全部镜头中保持一致。`,
    hairMakeupText: `${role}采用整洁自然且符合身份的发型与妆造，发色、发长、分缝、妆容、眼镜或胡须等识别特征在全部镜头中保持一致，避免厚重滤镜和塑料皮肤。`,
    negativeText: `不要改变${role}的年龄、性别、脸型、发型、服装颜色和配饰；不要出现多余人物、网红脸、塑料皮肤、夸张表情、肢体畸形、文字水印或与${subject}无关的造型。`,
  };
}

/**
 * 合并模型人物建议、用户硬约束和逐字段兜底，保证下游人物合同所需字段完整。
 */
function enforceAssistedPersonSpec(spec = {}, current = {}, context = {}) {
  const output = { ...(spec && typeof spec === 'object' ? spec : {}) };
  const source = current && typeof current === 'object' ? current : {};
  const preserve = (key, defaults = []) => {
    const value = cleanText(source[key] || source[key.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`)] || '', 80);
    if (value && !defaults.includes(value)) output[key] = value;
  };
  preserve('castMode', ['auto']);
  preserve('gender', ['auto']);
  preserve('age', ['match_brief']);
  preserve('origin', ['match_brief']);
  preserve('roleName');
  preserve('displayName');
  const fallback = assistedPersonSpecFallback(output, source, context);
  output.appearanceText = alignPersonAgeDescription(
    output.appearanceText || output.appearance || output.description
      || source.appearanceText || source.appearance || source.description
      || fallback.appearanceText,
    output.age,
  );
  output.wardrobeText = cleanText(
    output.wardrobeText || output.wardrobe || output.outfit
      || source.wardrobeText || source.wardrobe || source.outfit
      || fallback.wardrobeText,
    420,
  );
  output.hairMakeupText = cleanText(
    output.hairMakeupText || output.hair_makeup || output.hair
      || source.hairMakeupText || source.hair_makeup || source.hair
      || fallback.hairMakeupText,
    280,
  );
  output.negativeText = cleanText(
    output.negativeText || output.negative
      || source.negativeText || source.negative
      || fallback.negativeText,
    420,
  );
  return output;
}

const ASSISTED_SHOT_ENUMS = {
  shot_size: ['', 'extreme_wide', 'wide', 'full', 'medium', 'medium_close', 'close_up', 'extreme_close_up', 'macro'],
  camera_angle: ['', 'eye_level', 'high_angle', 'low_angle', 'overhead', 'dutch', 'over_shoulder', 'pov'],
  depth_of_field: ['', 'deep', 'medium', 'shallow', 'ultra_shallow'],
  transition_type: ['none', 'hard_cut', 'cut_on_action', 'match_cut', 'dissolve', 'fade'],
  scene_view: ['', 'master', 'reverse', 'interaction', 'detail'],
};

function normalizeAssistedShotSettings(input = {}, current = {}) {
  const source = input?.shot_settings || input?.shotSettings || input || {};
  const existing = current && typeof current === 'object' ? current : {};
  const textValue = (key, aliases = [], max = 500) => {
    const keys = [key, ...aliases];
    const explicit = keys.find(name => Object.prototype.hasOwnProperty.call(source, name));
    const raw = explicit ? source[explicit] : keys.map(name => existing[name]).find(value => value !== undefined && value !== null);
    return cleanText(typeof raw === 'object' ? shotDesign.structuredText(raw, max) : raw || '', max);
  };
  const enumValue = (key, fallback = '') => {
    const allowed = ASSISTED_SHOT_ENUMS[key] || [];
    const requested = cleanText(source[key] ?? existing[key] ?? fallback, 60);
    return allowed.includes(requested) ? requested : (allowed.includes(existing[key]) ? existing[key] : fallback);
  };
  const design = shotDesign.normalizeShotDesign({
    shot_scope: source.shot_scope ?? source.shotScope ?? existing.shot_scope ?? existing.shotScope,
    surface_topology: source.surface_topology ?? source.surfaceTopology ?? existing.surface_topology ?? existing.surfaceTopology,
    motion_effect: source.motion_effect ?? source.motionEffect ?? existing.motion_effect ?? existing.motionEffect,
  });
  const surface = design.surface_topology || { mode: 'auto', seam_policy: 'auto', finish_distribution: 'auto', notes: '' };
  const motion = design.motion_effect || { type: 'none', source_state: '', target_state: '', timeline: '', intensity: 'medium', preserve_scene_geometry: true, reference_asset_id: '', notes: '' };
  const requestedLens = Number(source.lens_mm ?? source.lensMm ?? existing.lens_mm ?? existing.lensMm ?? 0);
  return {
    visual: textValue('visual', ['visual_description', 'content_prompt'], 1800),
    action: textValue('action', ['visual_action'], 900),
    voiceover: textValue('voiceover', ['narration', 'subtitle'], 600),
    purpose: textValue('purpose', ['objective', 'role'], 500),
    shot_scope: design.shot_scope || 'auto',
    surface_topology: surface,
    motion_effect: motion,
    scene_view: enumValue('scene_view', cleanText(existing.scene_view || '', 40)),
    scene_zone: textValue('scene_zone', ['scene_zone_label_zh'], 180),
    shot_size: enumValue('shot_size', ''),
    camera_angle: enumValue('camera_angle', ''),
    lens_mm: requestedLens > 0 ? Math.max(1, Math.min(300, Math.round(requestedLens))) : '',
    depth_of_field: enumValue('depth_of_field', ''),
    composition: textValue('composition', [], 320),
    subject_position: textValue('subject_position', [], 180),
    camera_movement: textValue('camera_movement', [], 220),
    entry_frame_state: textValue('entry_frame_state', [], 500),
    exit_frame_state: textValue('exit_frame_state', [], 500),
    screen_direction: textValue('screen_direction', [], 160),
    eyeline: textValue('eyeline', [], 160),
    camera_axis: textValue('camera_axis', [], 160),
    object_states: textValue('object_states', [], 360),
    transition_type: enumValue('transition_type', 'none'),
    transition_reason: textValue('transition_reason', [], 280),
    ambient_sound: textValue('ambient_sound', [], 240),
    sfx: textValue('sfx', [], 240),
    music_cue: textValue('music_cue', [], 240),
    voiceover_timing: textValue('voiceover_timing', [], 280),
    audio_bridge: textValue('audio_bridge', [], 240),
  };
}

async function assistBrief(body = {}, user = {}) {
  const ctx = buildContext(body, user);
  const mode = cleanText(body.mode || body.assist_mode || 'write', 20);
  const isStyleControl = mode === 'style_control' || mode === 'style';
  const isNegativeControl = mode === 'negative_control' || mode === 'negative';
  const isPersonSpec = mode === 'person_spec' || mode === 'person';
  const isSceneSpec = mode === 'scene_spec' || mode === 'scene';
  const isShotSettings = mode === 'shot_settings' || mode === 'shot';
  const systemPrompt = [
    '你是剧情广告模块的广告需求整理助手。只输出 JSON 对象，不要 markdown。',
    '你的任务是把用户的一句话或零散信息整理成可直接生成商用剧情广告的需求表单。',
    '必须保持用户原始业务主体，不得编造未授权行业、人物、宠物、机器人或旧任务内容。',
    '当 mode 是 style_control 时，只补写画面风格方向，不要写剧本、分镜、卖点或执行步骤。',
    '当 mode 是 negative_control 时，只整理画面禁止项，每条都必须是明确不能出现的内容。',
    '当 mode 是 person_spec 时，只补齐人物设定字段，必须包含外貌、穿着、发型妆造和人物禁止项。',
    '当 mode 是 scene_spec 时，只补齐场景空间设定字段，必须围绕当前广告需求，不得写死行业、城市、人物或旧任务场景。',
    'scene_spec 必须原样保留用户提供的品牌名、专有材质名和工艺名，并把它们解释成当前任务明确支持的可观察颜色、纹理方向、反射、粗糙度、肌理和尺度；不得替换成通用近似材质。',
    '当连续完整表面同时出现多个材质/工艺词时，默认合成为一种主导饰面语言；只有用户明确指定区域映射时才允许分区，禁止自动做成样板墙、条带或拼贴。',
    '当 mode 是 shot_settings 时，只优化当前任务的一个镜头设置；结合前后镜保证连续性，不得套用固定行业、场景、角色、墙面、商品或品牌模板。',
    'shot_settings 必须尊重用户补充和已有台词/卖点，不得编造功效、价格、资质或未经授权的画面元素；不确定的高级项使用 auto/none。',
    '如果是“write”，请补成完整广告需求；如果是“clean”，请只整理和补齐缺失字段，不改变用户核心意思。',
  ].join('\n');
  const outputSchema = isStyleControl
    ? `{
  "text": "只包含画面风格、光线、真实程度、镜头情绪和不能偏离的质感方向，80-180 字"
}`
    : isNegativeControl
      ? `{
  "text": "用分号分隔的禁止项，例如：不要出现无关人物；避免卡通质感；禁止商品变形"
}`
      : isPersonSpec
        ? `{
  "person_spec": {
    "castMode": "auto/single/dual/group",
    "gender": "auto/male/female/mixed/all_male/all_female",
    "age": "match_brief/young_adult_17_25/young_adult/adult_30_40/middle_40_55/senior_55_plus",
    "origin": "match_brief/east_asian_cn/southeast_asian/white_european/black_african/middle_eastern/south_asian/latino/mixed_global",
    "roleName": "人物身份或职业",
    "displayName": "正式人物姓名，可留空",
    "appearanceText": "脸型、体型、年龄感、商业真实感、气质、表情可信度，80-160 字",
    "wardrobeText": "上衣、下装、鞋、配饰、颜色、材质、与产品/场景的关系，80-160 字",
    "hairMakeupText": "发型、妆容、眼镜、胡须或其它妆造细节，50-120 字",
    "negativeText": "不要出现的人物错误、服装错误、肤质错误、表情错误，分号分隔"
  }
}`
      : isSceneSpec
        ? `{
  "scene_spec": {
    "layoutText": "空间布局、主体位置、前景/背景关系、可持续复用的场景身份，80-180 字",
    "materialLightText": "材质、色彩、光线方向、真实拍摄质感和商业高级感，80-180 字",
    "interactionText": "人物或商品可在空间中出现的位置、动作区域、镜头可运动范围，60-140 字",
    "negativeText": "场景四视图不能出现的空间错误、材质错误、风格错误、文字水印或无关元素，分号分隔",
    "surfaceTopology": {
      "mode": "auto/continuous/segmented/modular，仅在需求明确时选择",
      "seam_policy": "auto/hidden/visible/task_defined",
      "finish_distribution": "auto/uniform/gradient/regional/sample_comparison",
      "notes": "只写当前任务明确要求的表面结构，不得套用行业或场景模板"
    },
    "materialContract": {
      "dominant_finish": "原样保留专有名称，并说明其在本任务中的主导饰面表达",
      "observable_cues": ["仅填写需求可支持的颜色、纹理、反射、粗糙度、肌理、尺度等可见证据"]
    }
  }
}`
        : isShotSettings
          ? `{
  "shot_settings": {
    "visual": "当前镜头完整画面说明",
    "action": "镜头内主体动作与变化",
    "voiceover": "保留或按明确要求微调的台词/旁白",
    "purpose": "本镜叙事或广告目的",
    "shot_scope": "auto/environment/product_comparison/character/brand_endcard",
    "surface_topology": {"mode":"auto/continuous/segmented/modular","seam_policy":"auto/hidden/visible/task_defined","finish_distribution":"auto/uniform/gradient/regional/sample_comparison","notes":"任务专属补充"},
    "motion_effect": {"type":"none/particle_assembly/fade/dissolve/material_flow/custom","source_state":"起始状态","target_state":"目标状态","timeline":"按本镜时长编写的时间轴","intensity":"low/medium/high","preserve_scene_geometry":true,"reference_asset_id":"已有素材 ID 或空","notes":"任务专属效果补充"},
    "scene_view": "master/reverse/interaction/detail",
    "scene_zone": "使用当前任务已有空间区域，不编造新场景",
    "shot_size": "extreme_wide/wide/full/medium/medium_close/close_up/extreme_close_up/macro",
    "camera_angle": "eye_level/high_angle/low_angle/overhead/dutch/over_shoulder/pov",
    "lens_mm": 50,
    "depth_of_field": "deep/medium/shallow/ultra_shallow",
    "composition": "构图",
    "subject_position": "主体位置",
    "camera_movement": "镜头运动",
    "entry_frame_state": "承接上一镜的入镜状态",
    "exit_frame_state": "交给下一镜的出镜状态",
    "screen_direction": "运动方向",
    "eyeline": "人物视线或空",
    "camera_axis": "摄影轴线",
    "object_states": "商品/道具状态",
    "transition_type": "none/hard_cut/cut_on_action/match_cut/dissolve/fade",
    "transition_reason": "转场原因",
    "ambient_sound": "环境声",
    "sfx": "动作或物体音效",
    "music_cue": "音乐节点",
    "voiceover_timing": "旁白与动作时机",
    "audio_bridge": "跨镜声音桥"
  }
}`
          : `{
  "brief": "可直接放入广告需求文本框的完整需求",
  "product_subject": "广告主体",
  "cast_mode": "auto/single/dual/multi/no_human",
  "shot_count": 0,
  "forbidden": ["禁止项"],
  "characters": [{"name":"角色名","role":"剧情职责","description":"简短说明"}]
}`;
  const shotAssistContext = isShotSettings ? {
    user_instruction: cleanText(body.user_instruction || body.instruction || '', 800),
    previous_shot: body.shot_assist_context?.previous_shot || body.previous_shot || null,
    current_shot: body.shot_assist_context?.current_shot || body.current_shot || body.shot || null,
    next_shot: body.shot_assist_context?.next_shot || body.next_shot || null,
    scene_assets: body.shot_assist_context?.scene_assets || body.scene_assets || [],
  } : null;
  const userPrompt = `${contextPrompt(ctx)}

模式：${isStyleControl ? 'style_control 风格方向帮写' : isNegativeControl ? 'negative_control 禁止项帮写' : isPersonSpec ? 'person_spec 人物设定补齐' : isSceneSpec ? 'scene_spec 场景空间设定补齐' : isShotSettings ? 'shot_settings 当前镜头设置补齐' : mode === 'clean' ? 'clean 整理内容' : 'write 帮我写'}

${isPersonSpec ? '人物设定中用户已经明确选择的数量、性别、年龄、地域、身份和姓名是硬约束，必须原样保留；外貌、穿着、发型妆造和禁止项必须根据这些选择重新生成，不能保留与当前年龄冲突的旧描述。' : ''}
${isShotSettings ? `当前镜头上下文：${JSON.stringify(shotAssistContext).slice(0, 18000)}\n只返回当前镜头设置，不要重写其它镜头。已有场景 ID 和人物/商品身份必须保持不变。` : ''}

输出 JSON：
${outputSchema}`;
  const result = await modelGateway.generateText({
    taskId: cleanText(body.task_id || body.taskId || '', 80),
    stage: 'new_story_ad.assist',
    systemPrompt,
    userPrompt,
    maxTokens: 3000,
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId: cleanText(body.task_id || body.taskId || '', 80),
    stage: 'new_story_ad.json_repair',
  });
  if (isStyleControl || isNegativeControl) {
    const text = cleanText(parsed.text || parsed.brief || parsed.content || '', 800);
    return {
      brief: text,
      text,
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isPersonSpec) {
    const raw = parsed.person_spec || parsed.personSpec || parsed;
    const spec = enforceAssistedPersonSpec(raw && typeof raw === 'object' ? raw : {}, ctx.person_spec, ctx);
    return {
      person_spec: {
        castMode: cleanText(spec.castMode || spec.cast_mode || 'auto', 40),
        gender: cleanText(spec.gender || 'auto', 40),
        age: cleanText(spec.age || 'match_brief', 40),
        origin: cleanText(spec.origin || 'match_brief', 60),
        roleName: cleanText(spec.roleName || spec.role_name || '', 100),
        displayName: cleanText(spec.displayName || spec.display_name || '', 60),
        appearanceText: cleanText(spec.appearanceText || spec.appearance || spec.description || '', 360),
        wardrobeText: cleanText(spec.wardrobeText || spec.wardrobe || spec.outfit || '', 420),
        hairMakeupText: cleanText(spec.hairMakeupText || spec.hair_makeup || spec.hair || '', 280),
        negativeText: cleanText(spec.negativeText || spec.negative || '', 420),
      },
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isSceneSpec) {
    const raw = parsed.scene_spec || parsed.sceneSpec || parsed;
    const spec = sceneAssistCompleteness.enforceAssistedSceneSpec(
      raw && typeof raw === 'object' ? raw : {},
      ctx.scene_spec || ctx.sceneSpec || {},
      ctx,
    );
    return {
      scene_spec: spec,
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isShotSettings) {
    const currentShot = shotAssistContext?.current_shot && typeof shotAssistContext.current_shot === 'object'
      ? shotAssistContext.current_shot
      : {};
    return {
      shot_settings: normalizeAssistedShotSettings(parsed, currentShot),
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  return {
    brief: cleanText(parsed.brief || parsed.content || ctx.brief, 3000),
    product_subject: cleanText(parsed.product_subject || parsed.productSubject || ctx.product_subject, 200),
    cast_mode: cleanText(parsed.cast_mode || parsed.castMode || ctx.cast_mode || 'auto', 40),
    shot_count: Math.max(0, Math.min(18, Number(parsed.shot_count || parsed.shotCount || ctx.shot_count || 0) || 0)),
    forbidden: Array.isArray(parsed.forbidden) ? parsed.forbidden.map(x => cleanText(x, 100)).filter(Boolean) : ctx.forbidden,
    characters: Array.isArray(parsed.characters)
      ? normalizeCharacters(parsed.characters, `${ctx.request_id || body.task_id || body.taskId || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`)
      : ctx.characters,
    model_meta: {
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
    },
  };
}

module.exports = {
  storyAdV3RuntimePolicy,
  assertTaskOwner,
  createTask,
  updateTaskRequest,
  commitGeneratedPersonAsset: personAssetLifecycle.commitGeneratedPersonAsset,
  updateBlueprint,
  updateStoryboardTable,
  generateSceneConfig,
  generateBlueprintStage,
  generateStoryboardStage,
  buildKeyframeContractStage,
  generateKeyframesStage,
  resolveTtsVoiceId,
  generateTtsStage,
  buildVideoPreflightPlan,
  assertVideoPreflightConfirmation,
  publicVideoPreflight: videoPreflight.publicVideoPreflight,
  generateVideoStage,
  acceptVideoClipOverride,
  assertVideoInputsReady,
  verifyPersonContract,
  verifyProductContract,
  selectKeyframeCandidate,
  acceptKeyframeCandidateOverride,
  retryKeyframeCandidateQa,
  composeStage,
  runFull,
  publicTaskBundle,
  taskSummary,
  listTaskSummaries,
  modelHealth,
  assistBrief,
  alignPersonAgeDescription,
  enforceAssistedPersonSpec,
  enforceAssistedSceneSpec: sceneAssistCompleteness.enforceAssistedSceneSpec,
  normalizeAssistedShotSettings,
  keyframeCompletion,
  keyframeTargetIndexes,
  keyframeStageBudgetMs,
  isQaInfrastructureError,
  structuredQaFeedback,
  buildKeyframeDependencyPlan,
  buildKeyframePrompt,
  keyframeReferenceImages,
  acceptedKeyframeContextAt,
  compactKeyframePrompt,
  previewShotPrompts,
  isCompleteKeyframe,
  subtitleSegmentsFromShots,
};

