const fs = require('fs');
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
const composeService = require('./composeService');
const { bindShotsToScenes, selectSceneAsset, assertVerifiedSceneAssets } = require('./sceneBindingService');
const sceneSpace = require('./sceneSpaceContractService');
const revisionService = require('./revisionService');
const personIdentity = require('./personIdentityContractService');
const productIdentity = require('./productIdentityContractService');
const personKeyframeQa = require('./personConsistencyQaService');
const productKeyframeQa = require('./productConsistencyQaService');
const videoFrameQa = require('./videoFrameQaService');
const { buildSoundJourney } = require('./soundJourneyService');

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
  return String(frame.image_url || frame.imageUrl || frame.url || '').trim();
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
  return { total, completed, missing: Math.max(0, total - completed), failed, missing_indexes };
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
  if (task.user_id && String(task.user_id) !== userId && role !== 'admin') {
    const err = new Error('无权访问该剧情广告任务');
    err.status = 403;
    err.code = 'TASK_FORBIDDEN';
    throw err;
  }
  return task;
}

function publicTaskBundle(taskId, { diagnostics = false } = {}) {
  const bundle = storage.getTaskBundle(taskId, { diagnostics });
  const outputs = Object.fromEntries((bundle.outputs || []).map(x => [x.kind, x.payload]));
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
      const complete = keyframeStatus.completed >= keyframeStatus.total;
      if (isBeforeOrAtKeyframes(task.stage)) {
        task = {
          ...task,
          status: complete ? (task.saved_progress === true ? 'working' : 'done') : 'working',
          stage: complete ? 'keyframes_ready' : 'keyframes_partial',
          error: '',
        };
      }
    } else if (storyboard.length && ['storyboard', 'storyboard_done', 'storyboard_running'].includes(String(task.stage || ''))) {
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
    keyframe_status: keyframeStatus,
  };
}

function taskSummary(task = {}) {
  const storyboard = storage.getOutput(task.id, 'storyboard_table') || [];
  const keyframes = storage.getOutput(task.id, 'keyframes') || [];
  const finalVideo = storage.getOutput(task.id, 'final_video') || null;
  const sceneAssets = storage.getOutput(task.id, 'scene_assets') || [];
  const firstFrame = keyframes.find(frame => frame?.image_url || frame?.imageUrl || frame?.url) || {};
  const firstScene = sceneAssets[0] || {};
  return {
    id: task.id,
    type: task.type,
    status: task.status,
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
    shot_count: Number(task.shot_count || 0) || (Array.isArray(storyboard) ? storyboard.length : 0),
    keyframe_count: Number(task.keyframe_count || 0) || (Array.isArray(keyframes) ? keyframes.filter(frame => frame?.image_url || frame?.imageUrl || frame?.url).length : 0),
    thumbnail_url: firstFrame.image_url || firstFrame.imageUrl || firstFrame.url || firstScene.image_url || firstScene.url || '',
    final_video_url: finalVideo?.video_url || finalVideo?.videoUrl || '',
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
    tasks: tasks.map(taskSummary),
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
  const builtCtx = buildContext({ ...(task.request || {}), ...(body || {}), task_id: taskId }, user);
  const scope = revisionService.changeScope(previousCtx, builtCtx, body.change_scope || body.changeScope || '');
  let ctx = revisionService.applyRevisions(previousCtx, builtCtx, scope);
  if (scope === 'person' || scope === 'source') ctx.person_contract = null;
  if (scope === 'product' || scope === 'source') ctx.product_contract = null;
  ctx = withAssetContracts(ctx);
  let invalidated = [];
  const patch = {
    title: taskTitle(ctx),
    brief: ctx.brief,
    request: ctx,
  };
  if (body.save_progress === true || body.saveProgress === true) {
    const progressStage = cleanText(body.progress_stage || body.progressStage || task.stage || 'draft', 80) || 'draft';
    const finalDone = ['final_video_ready', 'done'].includes(progressStage);
    patch.status = finalDone ? (task.status || 'done') : 'working';
    patch.stage = progressStage;
    patch.saved_progress = true;
    patch.saved_progress_at = new Date().toISOString();
    persistProgressSnapshot(taskId, body.progress_snapshot || body.progressSnapshot || {});
  }
  invalidated = revisionService.invalidateOutputs(storage, taskId, scope);
  const updated = storage.updateTask(taskId, patch);
  storage.saveOutput(taskId, 'context', ctx);
  storage.saveStage(taskId, 'saved', { status: 'done', output_summary: '任务进度已保存' });
  return { task: updated, context: ctx, change_scope: scope, invalidated_outputs: invalidated };
}

async function verifyPersonContract(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
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
  if (!task) throw new Error('Task not found');
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
        purpose: cleanText(beat.purpose || beat.objective || proof || beat.role || '', 160),
        confirmed: beat.confirmed !== false,
      };
    }).filter(beat => beat.plot || beat.visual || beat.action || beat.spoken_line || beat.visual_proof),
    edited_at: new Date().toISOString(),
    edited_by_user: true,
  };
}

function updateBlueprint(taskId, blueprint = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const normalized = normalizeBlueprintDraft({ ...previous, ...(blueprint || {}) }, `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`);
  storage.saveOutput(taskId, 'blueprint', normalized);
  storage.saveStage(taskId, 'blueprint', {
    status: 'done',
    output_summary: `${normalized.beats.length} script shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done' });
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
  return {
    ...shot,
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
    edited_at: new Date().toISOString(),
  };
}

function updateStoryboardTable(taskId, shots = [], user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const current = storage.getOutput(taskId, 'storyboard_table') || [];
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const source = Array.isArray(shots) && shots.length ? shots : current;
  const normalizedRaw = source
    .map((shot, index) => normalizeStoryboardShot(shot, index, current[index] || {}))
    .filter(shot => shot.visual || shot.action || shot.voiceover || shot.title);
  const normalized = withContinuityContracts(bindShotsToScenes(normalizedRaw, Array.isArray(sceneAssets) ? sceneAssets : []));
  storage.saveOutput(taskId, 'storyboard_table', normalized);
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(normalized));
  const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const contracts = buildKeyframeContracts(contractCtx, normalized);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveStage(taskId, 'storyboard', {
    status: 'done',
    output_summary: `${normalized.length} storyboard shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} keyframe contracts rebuilt` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready' });
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
  const blueprint = await generateBlueprint(ctx, { taskId });
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
  const generated = await generateStoryboardTable(stageCtx, blueprint, { taskId });
  let shots = generated.shots;
  let review = await reviewStoryboard(stageCtx, shots, { taskId });
  storage.saveReview(taskId, 'storyboard.initial', review);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const issues = [
      ...(review.blocking_issues || []),
      ...(review.rewrite_issues || []),
    ];
    if (!shots.length || !issues.length) break;
    shots = await rewriteStoryboard(stageCtx, blueprint, shots, issues, { taskId });
    const nextReview = await reviewStoryboard(stageCtx, shots, { taskId });
    storage.saveReview(taskId, `storyboard.rewrite.${attempt}`, nextReview);
    review = nextReview;
    if (!review.blocking_issues.length && !review.rewrite_issues.length) break;
  }
  if (review.blocking_issues.length) {
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveStage(taskId, 'storyboard', { status: 'failed', error: review.blocking_issues.join('；'), diagnostics: review });
    storage.updateTask(taskId, { status: 'failed', stage: 'storyboard_failed', error: review.blocking_issues.join('；') });
    const err = new Error(`剧情广告分镜硬阻断：${review.blocking_issues.join('；')}`);
    err.review = review;
    err.partial = shots;
    throw err;
  }
  const contracts = buildKeyframeContracts(stageCtx, shots);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(shots));
  storage.saveOutput(taskId, 'quality_review', review);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
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
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready' });
  return contracts;
}

function previousKeyframeContext(keyframes = [], index = 0) {
  if (!Array.isArray(keyframes) || index <= 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const frame = keyframes[i] || {};
    const imageUrl = frame.image_url || frame.imageUrl || frame.url || '';
    if (!imageUrl) continue;
    return {
      index: i + 1,
      title: frame.title || `Shot ${i + 1}`,
      image_url: imageUrl,
      prompt: cleanText(frame.prompt || '', 700),
    };
  }
  return null;
}

function sceneAssetForShot(ctx = {}, shot = {}, index = 0) {
  const assets = Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [];
  return selectSceneAsset(assets, shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', index);
}

function sceneAssetPrompt(asset = {}) {
  if (!asset || typeof asset !== 'object') return '';
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  return [
    `Locked scene asset: ${cleanText(asset.name || asset.scene_id || asset.id || 'task scene', 120)}`,
    asset.lock_strength ? `Scene lock strength: ${cleanText(asset.lock_strength, 60)}` : '',
    asset.layout_summary ? `Scene layout lock: ${cleanText(asset.layout_summary, 600)}` : '',
    asset.material_summary ? `Scene material lock: ${cleanText(asset.material_summary, 600)}` : '',
    asset.style_summary ? `Scene style lock: ${cleanText(asset.style_summary, 360)}` : '',
    views.length ? `Scene reference views: ${cleanText(views.map(view => `${view.key || view.label || 'view'}=${view.url || view.image_url || ''}`).join('; '), 1600)}` : '',
    asset.negative ? `Scene asset negative reference: ${cleanText(asset.negative, 360)}. In final keyframes, keep these as space-quality constraints only; do not apply "empty scene/no people" when the storyboard requires the locked actor.` : '',
    'Keep the same scene identity, layout logic, material family, lighting direction and commercial realism across shots. Do not switch to another unrelated space.',
  ].filter(Boolean).join('\n');
}

function buildKeyframePrompt(ctx = {}, shot = {}, contract = {}, index = 0, options = {}) {
  const visualContract = contract.visual_contract || {};
  const sceneLock = contract.scene_lock || null;
  const personAsset = ctx.person_asset || {};
  const actorViews = Array.isArray(personAsset.view_images) ? personAsset.view_images : [];
  const visualText = cleanText(shot.visual || shot.content_prompt || '', 900);
  const userVisualOverride = shot.user_visual_override === true || shot._nsa_user_edited_fields?.visual === true;
  const actionText = cleanText(shot.action || shot.visual_action || '', 500);
  const interactionRequested = /指向|伸手|食指|点击|点按|触摸|滑动|操作|按下|拿起|握住|放置|递给|注视|凝视|point|tap|touch|swipe|operate|press|pick up|hold|place|hand over|look at|gaze/i
    .test([visualText, actionText].filter(Boolean).join(' '));
  const interactionGroundingText = interactionRequested
    ? 'Visible interaction grounding is mandatory: every pointing, touching, operating, holding or gaze action must connect to a clearly visible, physically reachable target from this shot, such as the specified product, prop, control, screen, table or interface. Align fingertip, hand and eyeline with the same target. Never point, tap or gesture into empty air. If the requested target cannot be shown coherently, use a natural grounded pose with hands resting on or holding a visible task object.'
    : '';
  const previousFrame = options.previousFrame || null;
  const sceneAsset = options.sceneAsset || sceneAssetForShot(ctx, shot, index);
  const sceneReferenceText = sceneAssetPrompt(sceneAsset);
  const sceneBindingText = sceneLock ? [
    `Shot scene binding: ${cleanText(sceneLock.scene_id || '', 120)} / ${cleanText(sceneLock.scene_name || '', 120)}`,
    sceneLock.scene_view ? `Required scene view: ${cleanText(sceneLock.scene_view, 40)}` : '',
    sceneLock.scene_zone_id ? `Required scene zone ID (stable binding, do not reinterpret): ${cleanText(sceneLock.scene_zone_id, 100)}` : '',
    Array.isArray(sceneLock.zone_ids) && sceneLock.zone_ids.length ? `Required scene zone IDs: ${cleanText(sceneLock.zone_ids.join(', '), 400)}` : '',
    Array.isArray(sceneLock.anchor_ids) && sceneLock.anchor_ids.length ? `Required visible scene anchors: ${cleanText(sceneLock.anchor_ids.join(', '), 500)}` : '',
    (sceneLock.scene_zone_label_zh || sceneLock.scene_zone) ? `Required scene zone description: ${cleanText(sceneLock.scene_zone_label_zh || sceneLock.scene_zone, 160)}` : '',
    sceneLock.transition_from ? `Transition from: ${cleanText(sceneLock.transition_from, 120)}` : '',
    sceneLock.transition_reason ? `Transition reason: ${cleanText(sceneLock.transition_reason, 240)}` : '',
    'The keyframe must be generated inside this bound task scene. Do not move the shot into another location or another industry setting.',
  ].filter(Boolean).join('\n') : '';
  const actorReferenceText = [
    personAsset.name ? `Actor name: ${cleanText(personAsset.name, 120)}` : '',
    personAsset.description ? `Actor appearance and wardrobe lock: ${cleanText(personAsset.description, 900)}` : '',
    actorViews.length ? `Actor reference views: ${cleanText(actorViews.map(v => `${v.key || v.label || 'view'}=${v.url || v.image_url || ''}`).join('; '), 1200)}` : '',
  ].filter(Boolean).join('\n');
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
    `Dialogue or copy: ${cleanText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 300)}`,
    !userVisualOverride && visualContract.composition ? `Composition: ${cleanText(visualContract.composition, 300)}` : '',
    !userVisualOverride && visualContract.subject ? `Subject lock: ${cleanText(visualContract.subject, 300)}` : '',
    !userVisualOverride && visualContract.evidence ? `Commercial evidence: ${cleanText(visualContract.evidence, 300)}` : '',
    visualContract.style ? `Style: ${cleanText(visualContract.style, 260)}` : '',
    visualContract.scene_direction && visualContract.scene_direction !== 'auto' ? `Scene direction: ${cleanText(visualContract.scene_direction, 80)}` : '',
    visualContract.custom_scene_requirement ? `Custom scene requirement: ${cleanText(visualContract.custom_scene_requirement, 240)}` : '',
    !userVisualOverride && visualContract.product_required ? `Product visibility: required, presence ${cleanText(visualContract.product_presence || 'medium', 40)}, lock ${cleanText(visualContract.product_lock_strength || 'standard', 40)}.` : '',
    !userVisualOverride && Array.isArray(visualContract.product_methods) && visualContract.product_methods.length ? `Product presentation methods: ${cleanText(visualContract.product_methods.join(', '), 240)}` : '',
    visualContract.style_direction ? `Visual style direction: ${cleanText(visualContract.style_direction, 360)}` : '',
    visualContract.negative_requirements ? `Negative visual requirements: ${cleanText(visualContract.negative_requirements, 360)}` : '',
    Array.isArray(shot.characters) && shot.characters.length ? `Characters: ${cleanText(JSON.stringify(shot.characters), 500)}` : '',
    sceneBindingText ? `Storyboard scene binding lock:\n${sceneBindingText}` : '',
    sceneReferenceText ? `Strict scene consistency lock:\n${sceneReferenceText}` : '',
    ctx.person_asset ? `Locked real actor/person asset: ${cleanText(JSON.stringify(ctx.person_asset), 1200)}` : '',
    actorReferenceText ? `Strict actor consistency lock:\n${actorReferenceText}` : '',
    actorReferenceText ? 'If the shot includes any body part, hand, sleeve, reflection or partial figure, it must belong to the same locked actor identity and the same wardrobe family from the actor reference. Do not invent a different sleeve, hand, age, body shape, hair, skin tone, outfit color or fashion style.' : '',
    actorReferenceText ? 'Do not crop into an anonymous hand-only product demo unless the storyboard explicitly says no person. Keep the person presence consistent with the current script and previous shots.' : '',
    Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length ? `Locked cast profiles: ${cleanText(JSON.stringify(ctx.cast_profiles), 1200)}` : '',
    ctx.person_context?.real_person_locked ? 'Use the uploaded/authorized real-person reference as the identity and appearance lock. Preserve face identity, age impression, body proportions, wardrobe family and natural real-camera skin texture.' : '',
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
    .map(value => cleanText(value, 1200))
    .filter(Boolean);
  const isPriority = line => /User-edited visual override|^Visual:|^Action:|^Current shot action:|Visible interaction grounding|Required visible scene anchors|Advertised subject|scene consistency lock|scene binding lock|actor consistency lock|Locked real actor|Locked cast profiles|Product visibility|Forbidden:|Negative visual|Semantic fidelity rule|Do not crop|Use a real camera look|Final priority:/i.test(line);
  const orderedLines = [...lines.filter(isPriority), ...lines.filter(line => !isPriority(line))];
  const capFor = line => {
    if (/User-edited visual override|^Visual:|^Action:|^Current shot action:|Final priority:/i.test(line)) return 420;
    if (/Visible interaction grounding|Required visible scene anchors/i.test(line)) return 360;
    if (/scene consistency lock|scene binding lock|actor consistency lock|Locked real actor|Locked cast profiles/i.test(line)) return 320;
    if (/Advertised subject|Commercial evidence|Product visibility|Forbidden:|Negative visual/i.test(line)) return 220;
    if (/Semantic fidelity rule|Do not crop|Use a real camera look/i.test(line)) return 200;
    return 150;
  };
  const compacted = orderedLines.map(line => cleanText(line, capFor(line)));
  let output = '';
  for (const line of compacted) {
    const remaining = maxChars - output.length - (output ? 1 : 0);
    if (remaining <= 24) break;
    const next = cleanText(line, remaining);
    if (!next) continue;
    output += `${output ? '\n' : ''}${next}`;
  }
  return output;
}

function keyframeUrlFromResult(result = {}) {
  if (result.image_url || result.imageUrl || result.url) return result.image_url || result.imageUrl || result.url;
  const filename = result.filename || (result.filePath ? require('path').basename(result.filePath) : '');
  return filename ? mediaAdapter.publicAssetUrl(filename) : '';
}

async function generateKeyframesStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
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
  if (!Array.isArray(shots) || !shots.length) throw new Error('Storyboard table is empty');
  const boundShots = bindShotsToScenes(shots, ctx.scene_assets);
  if (JSON.stringify(boundShots) !== JSON.stringify(shots)) {
    shots = boundShots;
    storage.saveOutput(taskId, 'storyboard_table', shots);
  }
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  const needsSceneContract = ctx.scene_assets.length && (!Array.isArray(contracts) || contracts.some(contract => !contract?.scene_lock));
  if (!Array.isArray(contracts) || contracts.length !== shots.length || needsSceneContract) {
    contracts = buildKeyframeContracts(ctx, shots);
    storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  }
  const existing = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex))
    ? Number(options.only_index ?? options.onlyIndex)
    : null;
  const indexes = onlyIndex === null
    ? shots.map((_, i) => i)
    : [Math.max(0, Math.min(shots.length - 1, onlyIndex))];
  const missingOnly = options.missing_only === true || options.missingOnly === true;
  const targetIndexes = missingOnly
    ? indexes.filter(i => !isCompleteKeyframe(existing[i]))
    : indexes;
  const keyframes = existing.slice();
  const attempts = [];
  const retainedRegenerationFailures = [];
  const beforeStatus = keyframeCompletion(keyframes, shots);
  if (!targetIndexes.length) {
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: beforeStatus.completed >= beforeStatus.total ? 'done' : 'partial',
      output_summary: `${beforeStatus.completed}/${beforeStatus.total} image keyframes`,
      diagnostics: { attempts, keyframe_status: beforeStatus, skipped: true },
    });
    if (beforeStatus.completed >= beforeStatus.total) {
      storage.updateTask(taskId, { status: 'done', stage: 'keyframes_ready', error: '' });
    }
    return { keyframes, keyframe_contracts: contracts, attempts, keyframe_status: beforeStatus, skipped: true };
  }
  storage.updateTask(taskId, { status: 'running', stage: 'keyframes' });
  storage.saveStage(taskId, 'keyframes', { status: 'running', input_summary: `${targetIndexes.length} image keyframes` });
  const progressStartedAt = new Date().toISOString();
  const generationProgress = {
    stage: 'keyframes', status: 'running', target_total: targetIndexes.length,
    processed: 0, succeeded: 0, failed: 0,
    current_index: (targetIndexes[0] ?? 0) + 1,
    target_indexes: targetIndexes.map(index => index + 1),
    started_at: progressStartedAt, updated_at: progressStartedAt,
  };
  storage.updateTask(taskId, { generation_progress: generationProgress });
  for (const i of targetIndexes) {
    const shot = shots[i] || {};
    const previousAcceptedFrame = hasUsablePreviousKeyframe(existing[i]) ? { ...existing[i] } : null;
    let currentAttemptFailed = false;
    const previousFrame = previousKeyframeContext(keyframes, i);
    const sceneAsset = sceneAssetForShot(ctx, shot, i);
    const basePrompt = buildKeyframePrompt(ctx, shot, contracts[i] || {}, i, { previousFrame, sceneAsset });
    const filename = `scene_new_story_ad_${taskId}_${String(i + 1).padStart(2, '0')}_${Date.now()}`;
    const shotCandidates = [];
    try {
      const sceneReference = selectedSceneReference(sceneAsset, contracts[i] || {});
      const referenceImages = keyframeReferenceImages(ctx, sceneReference, previousFrame);
      const requireVisualQa = !!sceneReference || personIdentity.personRequired(ctx) || productIdentity.productRequired(ctx);
      const maxQaRetries = requireVisualQa
          ? Math.max(0, Math.min(1, Number(options.max_scene_retries ?? options.maxSceneRetries ?? 1) || 0))
        : 0;
      let accepted = null;
      let qa = null;
      let feedback = '';
      for (let qaAttempt = 0; qaAttempt <= maxQaRetries; qaAttempt += 1) {
        const correction = feedback
          ? `Previous visual QA rejected the frame. Correct these scene, person and product consistency problems without changing the requested shot, industry, location, person or product: ${cleanText(feedback, 320)}`
          : '';
        const prompt = correction
          ? `${cleanText(basePrompt, Math.max(1200, 2390 - correction.length))}\n${correction}`
          : basePrompt;
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
        const imageUrl = keyframeUrlFromResult(result);
        if (!imageUrl) throw new Error('Image provider returned no image url');
        // Use the provider URL for immediate remote QA when available, while
        // keeping the persisted VIDO URL as the production/display asset.
        const qaImageUrl = result.source_url || mediaAdapter.absolutePublicImageUrl(imageUrl);
        const sceneQa = sceneReference
          ? await sceneSpace.reviewKeyframe({
            taskId,
            sceneReferenceUrl: sceneReference,
            generatedUrl: qaImageUrl,
            contract: contracts[i]?.scene_lock || sceneAsset?.scene_contract || {},
            shot,
          })
          : {
            pass: true,
            status: 'not_applicable',
            reason: '当前任务没有已锁定场景资产，不执行场景空间一致性比较。',
            checked_at: new Date().toISOString(),
          };
        const personQa = await personKeyframeQa.reviewPersonKeyframe({
          taskId,
          ctx,
          shot,
          generatedUrl: qaImageUrl,
        });
        const productQa = await productKeyframeQa.reviewProductKeyframe({
          taskId,
          ctx,
          shot,
          generatedUrl: qaImageUrl,
        });
        const conflicts = [
          ...(sceneQa.mismatch_reasons || []),
          ...(sceneQa.forbidden_new_elements || []),
          ...(personQa.conflicts || []),
          ...(productQa.conflicts || []),
          personQa.retry_instruction || '',
          productQa.retry_instruction || '',
        ].filter(Boolean);
        qa = {
          pass: sceneQa.pass === true && personQa.pass === true && productQa.pass === true,
          status: sceneQa.pass === true && personQa.pass === true && productQa.pass === true ? 'verified' : 'rejected',
          scene: sceneQa,
          person: personQa,
          product: productQa,
          mismatch_reasons: conflicts,
          checked_at: new Date().toISOString(),
        };
        shotCandidates.push({
          id: `shot_${i + 1}_candidate_${qaAttempt + 1}_${Date.now()}`,
          image_url: imageUrl,
          provider_used: result.provider_used || '',
          qa,
          status: qa.pass ? 'accepted' : 'rejected',
          created_at: new Date().toISOString(),
        });
        attempts.push({
          index: i,
          qa_attempt: qaAttempt + 1,
          ok: qa.pass === true,
          provider_id: result.provider_used || '',
          image_url: imageUrl,
          qa,
        });
        if (qa.pass) {
          accepted = { result, imageUrl, prompt };
          break;
        }
        feedback = (qa.mismatch_reasons || []).join('; ');
      }
      if (!accepted) {
        const error = new Error('第 ' + (i + 1) + ' 镜场景空间一致性 QA 未通过：' + (feedback || '空间、机位或材质与参考场景不一致'));
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
      };
    } catch (err) {
      currentAttemptFailed = true;
      attempts.push({ index: i, ok: false, code: err.code || 'KEYFRAME_FAILED', error: String(err.message || err) });
      if (previousAcceptedFrame) {
        retainedRegenerationFailures.push({ index: i, error: String(err.message || err), code: err.code || 'KEYFRAME_FAILED' });
        keyframes[i] = {
          ...previousAcceptedFrame,
          shot_index: i,
          index: i + 1,
          title: shot.title || `Shot ${i + 1}`,
          error: '',
          error_code: '',
          regeneration_error: String(err.message || err),
          regeneration_error_code: err.code || 'KEYFRAME_FAILED',
          regeneration_failed_at: new Date().toISOString(),
          contract: contracts[i] || previousAcceptedFrame.contract || null,
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
        };
      }
    }
    storage.saveOutput(taskId, 'keyframes', keyframes);
    generationProgress.processed += 1;
    if (currentAttemptFailed) generationProgress.failed += 1;
    else generationProgress.succeeded += 1;
    const nextTarget = targetIndexes[generationProgress.processed];
    generationProgress.current_index = nextTarget === undefined ? i + 1 : nextTarget + 1;
    generationProgress.updated_at = new Date().toISOString();
    storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
  }
  if (retainedRegenerationFailures.length) {
    const finalStatus = keyframeCompletion(keyframes, shots);
    const shotNumbers = retainedRegenerationFailures.map(item => item.index + 1);
    const message = `第 ${shotNumbers.join('、')} 镜的新版本未通过生成或 QA，已保留上一版可用画面。请根据具体原因调整后重试。`;
    generationProgress.status = 'failed';
    generationProgress.finished_at = new Date().toISOString();
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: finalStatus.completed >= finalStatus.total ? 'done' : 'partial',
      output_summary: `${finalStatus.completed}/${finalStatus.total} image keyframes; ${retainedRegenerationFailures.length} rejected regeneration`,
      diagnostics: { attempts, keyframe_status: finalStatus, retained_regeneration_failures: retainedRegenerationFailures },
    });
    storage.updateTask(taskId, finalStatus.completed >= finalStatus.total
      ? { status: 'done', stage: 'keyframes_ready', error: '', error_code: '', generation_progress: { ...generationProgress } }
      : { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', generation_progress: { ...generationProgress } });
    const err = new Error(message);
    err.code = 'KEYFRAME_REGENERATION_REJECTED';
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
    status: finalStatus.completed >= finalStatus.total ? 'done' : 'partial',
    output_summary: `${finalStatus.completed}/${finalStatus.total} image keyframes`,
    diagnostics: { attempts, keyframe_status: finalStatus },
  });
  storage.updateTask(taskId, finalStatus.completed >= finalStatus.total
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

function keyframeReferenceImages(ctx = {}, sceneReference = '', previousFrame = null) {
  const refs = [sceneReference];
  const person = ctx.person_asset || {};
  const personViews = Array.isArray(person.view_images) ? person.view_images : [];
  refs.push(person.image_url || person.url || '', personViews[0]?.url || personViews[0]?.image_url || '');
  const assets = Array.isArray(ctx.assets) ? ctx.assets : [];
  const product = assets.find(asset => /product|subject|商品|产品|主体/i.test(String(asset.type || '') + ' ' + String(asset.name || '')));
  refs.push(product?.url || product?.image_url || '', previousFrame?.image_url || '');
  const seen = new Set();
  return refs.map(mediaAdapter.absolutePublicImageUrl).filter(url => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  }).slice(0, 4);
}

async function ensureStoryboardForMedia(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('Storyboard table is empty');
  return shots;
}

async function ensureContractsForMedia(taskId, ctx, shots) {
  let contracts = storage.getOutput(taskId, 'keyframe_contracts');
  if (!Array.isArray(contracts) || contracts.length !== shots.length) {
    const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
    const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
    contracts = buildKeyframeContracts(contractCtx, shots);
    storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  }
  return contracts;
}

function assertVideoInputsReady({ ctx = {}, shots = [], keyframes = [], contracts = [] } = {}) {
  assertVerifiedSceneAssets(ctx.scene_assets || []);
  const personContract = personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
  const failures = [];
  const personRequired = personIdentity.personRequired(ctx);
  const productRequired = productIdentity.productRequired(ctx);
  for (let index = 0; index < shots.length; index += 1) {
    const frame = keyframes[index] || {};
    const qa = frame.qa || {};
    if (!isCompleteKeyframe(frame)) {
      failures.push(`第 ${index + 1} 镜缺少可用关键帧`);
      continue;
    }
    if (qa.pass !== true || qa.status === 'rejected') {
      failures.push(`第 ${index + 1} 镜尚未通过关键帧总 QA`);
      continue;
    }
    const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shots[index] || {}, contracts[index] || {});
    if (shotNeedsPerson && (qa.person?.pass !== true || qa.person?.status !== 'verified')) {
      failures.push(`第 ${index + 1} 镜缺少已通过的人物一致性 QA`);
    }
    if (productRequired && (qa.product?.pass !== true || qa.product?.status !== 'verified')) {
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
  return cleanText(
    options.voice_id
      || options.voiceId
      || ctx.voice_id
      || ctx.voiceId
      || existingTtsAudio?.voice_id
      || existingTtsAudio?.voiceId
      || '',
    120,
  );
}

async function generateTtsStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const existingTtsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  const voiceId = resolveTtsVoiceId(options, ctx, existingTtsAudio);
  storage.updateTask(taskId, { status: 'running', stage: 'tts' });
  storage.saveStage(taskId, 'tts', { status: 'running', input_summary: `${shots.length} shot voice tracks` });
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

async function generateVideoStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  assertVideoInputsReady({ ctx, shots, keyframes, contracts });
  let ttsAudio = storage.getOutput(taskId, 'tts_audio');
  const voiceId = resolveTtsVoiceId(options, ctx, ttsAudio);
  const autoTtsEnabled = options.auto_tts !== false && options.autoTts !== false;
  const ttsNeedsRefresh = !ttsAdapter.voiceoverPlanMatches(ttsAudio, shots, voiceId);
  if (ttsNeedsRefresh && autoTtsEnabled) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
  }
  storage.updateTask(taskId, { status: 'running', stage: 'video' });
  storage.saveStage(taskId, 'video', { status: 'running', input_summary: `${shots.length} shot videos` });
  const existingClips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [];
  const generated = await videoAdapter.generateShotVideos({
    taskId,
    shots,
    keyframes: Array.isArray(keyframes) ? keyframes : [],
    ttsAudio,
    contracts,
    ctx,
    options,
    existingClips,
    onClip: async (clip, clips) => {
      storage.saveOutput(taskId, 'video_clips', clips);
      storage.saveStage(taskId, 'video', {
        status: 'running',
        input_summary: `${shots.length} shot videos`,
        output_summary: `${clips.length}/${shots.length} video clips`,
        diagnostics: { last_provider_used: clip.provider_used || '' },
      });
    },
  });
  const clips = generated.clips.slice();
  const targetIndexes = Array.isArray(generated.target_indexes) ? generated.target_indexes : shots.map((_, index) => index);
  const qaFailures = [];
  for (const index of targetIndexes) {
    const clip = clips[index];
    if (!clip) continue;
    const qa = await videoFrameQa.reviewVideoClip({ taskId, clip, shot: shots[index] || {}, contract: contracts[index] || {}, ctx, index });
    clips[index] = { ...clip, qa, error: qa.pass ? '' : '视频抽帧 QA 未通过', error_code: qa.pass ? '' : 'VIDEO_FRAME_QA_FAILED' };
    if (!qa.pass) qaFailures.push({ index, problems: qa.problems || [] });
  }
  const crossIndexes = [...new Set(targetIndexes.flatMap(index => [index, index + 1]).filter(index => index > 0 && index < clips.length))];
  for (const index of crossIndexes) {
    const previous = clips[index - 1];
    const current = clips[index];
    if (!previous?.qa?.pass || !current?.qa?.pass) continue;
    const crossQa = await videoFrameQa.reviewCrossShot({ taskId, previous: previous.qa, current: current.qa, previousShot: shots[index - 1] || {}, currentShot: shots[index] || {}, ctx });
    clips[index] = { ...current, cross_shot_qa: crossQa, error: crossQa.pass ? current.error : '相邻镜头视觉连续性 QA 未通过', error_code: crossQa.pass ? current.error_code : 'CROSS_SHOT_CONTINUITY_FAILED' };
    if (!crossQa.pass) qaFailures.push({ index, problems: crossQa.problems || [] });
  }
  storage.saveOutput(taskId, 'video_clips', clips);
  if (qaFailures.length) {
    storage.saveStage(taskId, 'video', { status: 'failed', output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips`, error: '视频审片未通过', diagnostics: { qa_failures: qaFailures } });
    storage.updateTask(taskId, { status: 'failed', stage: 'video_failed', error: '部分视频镜头未通过视觉审核，请只重试失败镜头', error_code: 'VIDEO_QA_FAILED', retryable: true });
    const error = new Error('视频审片未通过：' + qaFailures.map(item => `第 ${item.index + 1} 镜`).join('、'));
    error.code = 'VIDEO_QA_FAILED';
    error.retryable = true;
    error.video_clips = clips;
    error.qa_failures = qaFailures;
    throw error;
  }
  storage.saveStage(taskId, 'video', {
    status: 'done',
    output_summary: `${clips.filter(Boolean).length} video clips`,
    diagnostics: { provider_used: generated.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'video_ready' });
  return { video_clips: clips };
}

function selectKeyframeCandidate(taskId, shotIndex, candidateId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('Task not found');
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
  keyframes[index] = { ...frame, image_url: candidate.image_url, imageUrl: candidate.image_url, qa: candidate.qa, provider_used: candidate.provider_used || frame.provider_used, selected_candidate_id: candidate.id, error: '', error_code: '' };
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.deleteOutput(taskId, 'video_clips');
  storage.deleteOutput(taskId, 'final_video');
  storage.updateTask(taskId, { status: 'done', stage: 'keyframes_ready', error: '', error_code: '' });
  return { keyframe: keyframes[index], keyframes };
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
  if (!task) throw new Error('Task not found');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  let clips = storage.getOutput(taskId, 'video_clips');
  if (!Array.isArray(clips) || !clips.length) {
    const generated = await generateVideoStage(taskId, options);
    clips = generated.video_clips || [];
  }
  storage.updateTask(taskId, { status: 'running', stage: 'compose' });
  storage.saveStage(taskId, 'compose', { status: 'running', input_summary: `${clips.length} clips` });
  const subtitleEnabled = options.subtitle !== false && ctx.subtitle !== false;
  const subtitleStyle = cleanText(options.subtitle_style || options.subtitleStyle || ctx.subtitle_style || ctx.subtitleStyle || 'popup', 60);
  const rawSubtitleConfig = options.subtitle_config || options.subtitleConfig || ctx.subtitle_config || ctx.subtitleConfig || {};
  const subtitleConfig = {
    ...(rawSubtitleConfig && typeof rawSubtitleConfig === 'object' ? rawSubtitleConfig : {}),
    show: subtitleEnabled,
    style: subtitleStyle,
  };
  const bgmAsset = options.bgm_asset || options.bgmAsset || ctx.bgm_asset || ctx.bgmAsset || null;
  storage.saveOutput(taskId, 'context', {
    ...ctx,
    voice_id: cleanText(options.voice_id || options.voiceId || ctx.voice_id || ctx.voiceId || '', 120),
    voice_name: cleanText(options.voice_name || options.voiceName || ctx.voice_name || ctx.voiceName || '', 120),
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
    bgmAsset,
    bgmVolume: options.bgm_volume ?? options.bgmVolume ?? ctx.bgm_volume ?? ctx.bgmVolume ?? 0.16,
    voiceVolume: options.voice_volume ?? options.voiceVolume ?? ctx.voice_volume ?? ctx.voiceVolume ?? 1,
    subtitles: subtitleSegmentsFromShots(shots, subtitleConfig),
    subtitleEnabled,
    subtitleStyle,
    transitions: shots,
  });
  storage.saveOutput(taskId, 'final_video', final_video);
  storage.saveStage(taskId, 'compose', {
    status: 'done',
    output_summary: `final video from ${final_video.clip_count || clips.length} clips`,
    diagnostics: { provider_used: final_video.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'final_video_ready' });
  return { final_video, video_clips: clips };
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

function enforceAssistedPersonSpec(spec = {}, current = {}) {
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
  output.appearanceText = alignPersonAgeDescription(output.appearanceText || output.appearance || output.description || '', output.age);
  return output;
}

async function assistBrief(body = {}, user = {}) {
  const ctx = buildContext(body, user);
  const mode = cleanText(body.mode || body.assist_mode || 'write', 20);
  const isStyleControl = mode === 'style_control' || mode === 'style';
  const isNegativeControl = mode === 'negative_control' || mode === 'negative';
  const isPersonSpec = mode === 'person_spec' || mode === 'person';
  const isSceneSpec = mode === 'scene_spec' || mode === 'scene';
  const systemPrompt = [
    '你是剧情广告模块的广告需求整理助手。只输出 JSON 对象，不要 markdown。',
    '你的任务是把用户的一句话或零散信息整理成可直接生成商用剧情广告的需求表单。',
    '必须保持用户原始业务主体，不得编造未授权行业、人物、宠物、机器人或旧任务内容。',
    '当 mode 是 style_control 时，只补写画面风格方向，不要写剧本、分镜、卖点或执行步骤。',
    '当 mode 是 negative_control 时，只整理画面禁止项，每条都必须是明确不能出现的内容。',
    '当 mode 是 person_spec 时，只补齐人物设定字段，必须包含外貌、穿着、发型妆造和人物禁止项。',
    '当 mode 是 scene_spec 时，只补齐场景空间设定字段，必须围绕当前广告需求，不得写死行业、城市、人物或旧任务场景。',
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
    "negativeText": "场景四视图不能出现的空间错误、材质错误、风格错误、文字水印或无关元素，分号分隔"
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
  const userPrompt = `${contextPrompt(ctx)}

模式：${isStyleControl ? 'style_control 风格方向帮写' : isNegativeControl ? 'negative_control 禁止项帮写' : isPersonSpec ? 'person_spec 人物设定补齐' : isSceneSpec ? 'scene_spec 场景空间设定补齐' : mode === 'clean' ? 'clean 整理内容' : 'write 帮我写'}

${isPersonSpec ? '人物设定中用户已经明确选择的数量、性别、年龄、地域、身份和姓名是硬约束，必须原样保留；外貌、穿着、发型妆造和禁止项必须根据这些选择重新生成，不能保留与当前年龄冲突的旧描述。' : ''}

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
    const spec = enforceAssistedPersonSpec(raw && typeof raw === 'object' ? raw : {}, ctx.person_spec);
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
    const spec = raw && typeof raw === 'object' ? raw : {};
    return {
      scene_spec: {
        layoutText: cleanText(spec.layoutText || spec.layout_text || spec.layout || spec.description || '', 420),
        materialLightText: cleanText(spec.materialLightText || spec.material_light_text || spec.materialLight || spec.material || spec.light || '', 420),
        interactionText: cleanText(spec.interactionText || spec.interaction_text || spec.interaction || spec.camera || '', 320),
        negativeText: cleanText(spec.negativeText || spec.negative_text || spec.negative || '', 420),
      },
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
  assertTaskOwner,
  createTask,
  updateTaskRequest,
  updateBlueprint,
  updateStoryboardTable,
  generateSceneConfig,
  generateBlueprintStage,
  generateStoryboardStage,
  buildKeyframeContractStage,
  generateKeyframesStage,
  resolveTtsVoiceId,
  generateTtsStage,
  generateVideoStage,
  assertVideoInputsReady,
  verifyPersonContract,
  verifyProductContract,
  selectKeyframeCandidate,
  composeStage,
  runFull,
  publicTaskBundle,
  taskSummary,
  listTaskSummaries,
  modelHealth,
  assistBrief,
  alignPersonAgeDescription,
  enforceAssistedPersonSpec,
  keyframeCompletion,
  compactKeyframePrompt,
  isCompleteKeyframe,
  subtitleSegmentsFromShots,
};

