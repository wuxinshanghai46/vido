const storage = require('../newStoryAd/storageService');
const storyAd = require('../newStoryAd');
const mediaAdapterDefault = require('../newStoryAd/mediaAdapter');
const sketchGate = require('./storyboardSketchGateService');
const knowledgePolicyRuntime = require('../newStoryAd/knowledgePolicyRuntimeService');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_STATUSES = new Set(['draft', 'confirmed', 'skipped']);
const activeSketchBatches = new Set();
const SKETCH_BATCH_OUTPUT = 'storyboard_image_batch';

function batchProgress(taskId) {
  const value = storage.getOutput(taskId, SKETCH_BATCH_OUTPUT);
  return value && typeof value === 'object' ? value : null;
}

function saveBatchProgress(taskId, patch = {}) {
  const task = storage.getTask(taskId) || {};
  const previous = batchProgress(taskId) || {};
  const requested = Math.max(0, Number(patch.requested ?? previous.requested ?? 0) || 0);
  const completed = Math.max(0, Math.min(requested, Number(patch.completed ?? previous.completed ?? 0) || 0));
  const next = {
    ...previous,
    ...patch,
    requested,
    completed,
    remaining: Math.max(0, requested - completed),
    percent: requested ? Math.round((completed / requested) * 100) : 100,
    updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, SKETCH_BATCH_OUTPUT, next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `manual:${taskId}`,
  });
  return next;
}

/** 把用户输入整理为安全短文本。 */
function clean(value = '', max = 800) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** 规范化逐镜人物场景分镜图，禁止脱离真实分镜合同创建游离数据。 */
function normalizeSketches(taskId, sketches = []) {
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const shotIndexes = new Set(shots.map((shot, index) => Number(shot.shot_index || shot.index || index + 1) || index + 1));
  return (Array.isArray(sketches) ? sketches : [])
    .map((item, index) => {
      const shotIndex = Number(item.shot_index || item.shotIndex || item.index || index + 1) || index + 1;
      if (!shotIndexes.has(shotIndex)) return null;
      const status = ALLOWED_STATUSES.has(clean(item.status, 30)) ? clean(item.status, 30) : 'draft';
      return {
        id: clean(item.id || `storyboard-image-${shotIndex}`, 120),
        shot_index: shotIndex,
        status,
        image_url: clean(item.image_url || item.imageUrl || item.url, 1200),
        composition_notes: clean(item.composition_notes || item.compositionNotes || item.notes, 1200),
        source: clean(item.source || (item.image_url || item.imageUrl ? 'upload' : 'manual'), 60),
        reference_count: Math.max(0, Number(item.reference_count || 0) || 0),
        story_context_fingerprint: clean(item.story_context_fingerprint || item.storyContextFingerprint, 160),
        source_content_revision: Math.max(1, Number(item.source_content_revision || item.sourceContentRevision || 1) || 1),
        knowledge_policy: item.knowledge_policy && typeof item.knowledge_policy === 'object' ? item.knowledge_policy : null,
        updated_at: clean(item.updated_at, 80) || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.shot_index - b.shot_index);
}

/** 比较业务字段而不是更新时间，避免空保存制造新版本。 */
function sketchFingerprint(sketches = []) {
  return storage.canonicalFingerprint((Array.isArray(sketches) ? sketches : []).map(item => ({
    id: item.id,
    shot_index: item.shot_index,
    status: item.status,
    image_url: item.image_url,
    composition_notes: item.composition_notes,
    source: item.source,
    reference_count: item.reference_count,
    story_context_fingerprint: item.story_context_fingerprint,
    source_content_revision: item.source_content_revision,
  })));
}

/** 保存人物场景分镜图；只有确认时才把构图约束写回分镜权威数据。 */
function saveSketches(taskId, sketches = [], user = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时修改人物场景分镜');
    error.status = 409;
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    throw error;
  }
  sketchGate.assertReady(taskId);
  const normalized = normalizeSketches(taskId, sketches);
  const previous = storage.getOutput(taskId, 'storyboard_images') || [];
  if (sketchFingerprint(previous) === sketchFingerprint(normalized)) {
    return { sketches: previous, changed: false, content_revision: Number(task.content_revision || 1) || 1 };
  }

  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const previousByShot = new Map(previous.map(item => [Number(item.shot_index), item]));
  const now = new Date().toISOString();
  const persisted = normalized.map(item => {
    const old = previousByShot.get(item.shot_index);
    return sketchFingerprint(old ? [old] : []) === sketchFingerprint([item])
      ? { ...item, updated_at: old.updated_at || item.updated_at }
      : { ...item, updated_at: now };
  });
  const changedConfirmed = new Map(persisted
    .filter(item => {
      if (item.status !== 'confirmed') return false;
      const old = previousByShot.get(item.shot_index);
      return !old
        || old.status !== 'confirmed'
        || clean(old.composition_notes, 1200) !== clean(item.composition_notes, 1200)
        || clean(old.image_url, 1200) !== clean(item.image_url, 1200);
    })
    .map(item => [item.shot_index, item]));
  const nextShots = shots.map((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const sketch = changedConfirmed.get(shotIndex);
    if (!sketch) return shot;
    const note = clean(sketch.composition_notes, 1200);
    const currentNotes = String(shot.keyframe_notes || '')
      .split(/\r?\n/)
      .filter(line => !/^\s*(?:线稿|分镜)构图约束：/.test(line))
      .join('\n')
      .trim();
    return {
      ...shot,
      storyboard_image: {
        id: sketch.id,
        image_url: sketch.image_url,
        composition_notes: note,
        status: sketch.status,
      },
      keyframe_notes: [currentNotes, note ? `分镜构图约束：${note}` : ''].filter(Boolean).join('\n'),
    };
  });

  let result = { content_revision: Number(task.content_revision || 1) || 1 };
  if (changedConfirmed.size) result = storyAd.updateStoryboardTable(taskId, nextShots, user);
  const currentTask = storage.getTask(taskId);
  storage.saveOutput(taskId, 'storyboard_images', persisted, {
    content_revision: Number(currentTask.content_revision || 1) || 1,
    snapshot_id: currentTask.current_snapshot_id || `manual:${taskId}`,
  });
  return {
    sketches: persisted,
    changed: true,
    content_revision: Number(currentTask.content_revision || 1) || 1,
    shots: result.shots || nextShots,
  };
}

/** 为真实分镜生成一张绑定人物、场景、动作与机位的分镜图；结果确认后进入关键帧合同。 */
async function generateSketch(taskId, shotIndex, options = {}, dependencies = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时生成人物场景分镜');
    error.status = 409;
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    throw error;
  }
  sketchGate.assertReady(taskId);
  if (activeSketchBatches.has(taskId) && options.batch_owner !== taskId) {
    const error = new Error('当前项目正在批量生成人物场景分镜，请等待本批完成');
    error.status = 409;
    error.code = 'SKETCH_BATCH_IN_PROGRESS';
    throw error;
  }
  if (options.confirmed !== true) {
    const error = new Error('生成分镜图前需要用户明确确认本次图片调用');
    error.status = 400;
    error.code = 'SKETCH_GENERATION_CONFIRMATION_REQUIRED';
    throw error;
  }
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const numericIndex = Number(shotIndex);
  const shot = shots.find((item, index) => Number(item.shot_index || item.index || index + 1) === numericIndex);
  if (!shot) {
    const error = new Error('没有找到对应镜头');
    error.status = 404;
    error.code = 'STORYBOARD_SHOT_NOT_FOUND';
    throw error;
  }
  const mediaAdapter = dependencies.mediaAdapter || mediaAdapterDefault;
  const baseContext = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseContext.scene_assets || [];
  const context = { ...baseContext, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const contracts = storage.getOutput(taskId, 'keyframe_contracts') || [];
  const contract = contracts.find((item, index) => Number(item.shot_index || item.index || index + 1) === numericIndex)
    || contracts[numericIndex - 1]
    || {};
  const sceneId = clean(contract.scene_lock?.scene_id || shot.scene_id || shot.scene_asset_id, 160);
  const sceneAsset = context.scene_assets.find(item => [item.scene_id, item.id].map(value => clean(value, 160)).includes(sceneId))
    || context.scene_assets[numericIndex - 1]
    || context.scene_assets[0]
    || {};
  const wantedView = clean(contract.scene_lock?.scene_view || shot.scene_view || 'master', 80);
  const sceneViews = Array.isArray(sceneAsset.view_images) ? sceneAsset.view_images : [];
  const sceneView = sceneViews.find(item => clean(item.key || item.view || item.view_id, 80) === wantedView)
    || sceneViews.find(item => clean(item.key || item.view || item.view_id, 80) === 'master')
    || sceneViews[0]
    || {};
  const sceneReference = sceneView.image_url || sceneView.url || sceneAsset.image_url || '';
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const shotPosition = shots.indexOf(shot);
  const previousShot = shotPosition > 0 ? shots[shotPosition - 1] : null;
  const nextShot = shotPosition >= 0 && shotPosition < shots.length - 1 ? shots[shotPosition + 1] : null;
  const storyContext = {
    story_title: blueprint.title || '',
    logline: blueprint.logline || blueprint.story_logline || '',
    theme: blueprint.theme || '',
    scene_name: sceneAsset.name || '',
    scene_story_purpose: sceneAsset.story_purpose || '',
    current: {
      purpose: shot.purpose || '', dialogue: shot.dialogue || '', voiceover: shot.voiceover || '',
      entry_frame_state: shot.entry_frame_state || '', exit_frame_state: shot.exit_frame_state || '',
      screen_direction: shot.screen_direction || '', camera_axis: shot.camera_axis || '', eyeline: shot.eyeline || '',
      object_states: shot.object_states || '', transition_reason: shot.transition_reason || '',
    },
    previous: previousShot ? { title: previousShot.title || '', action: previousShot.action || '', exit_frame_state: previousShot.exit_frame_state || '', screen_direction: previousShot.screen_direction || '', object_states: previousShot.object_states || '' } : null,
    next: nextShot ? { title: nextShot.title || '', action: nextShot.action || '', entry_frame_state: nextShot.entry_frame_state || '', screen_direction: nextShot.screen_direction || '', object_states: nextShot.object_states || '' } : null,
  };
  const storyContextFingerprint = storage.canonicalFingerprint(storyContext);
  const sketchKnowledge = knowledgePolicyRuntime.resolveTaskMany({
    storage, taskId,
    selectors: [{ stage: 'keyframe', assetType: 'shot' }, { stage: 'keyframe', assetType: 'person' }, { stage: 'keyframe', assetType: 'scene' }],
    context,
  });
  const referenceImages = storyAd.keyframeReferenceImages(context, sceneReference, null, shot, contract, sceneAsset);
  const hasBoundAssets = Boolean(sceneId
    || (Array.isArray(shot.characters) && shot.characters.length)
    || (Array.isArray(shot.character_ids) && shot.character_ids.length)
    || context.person_asset
    || context.product_contract?.identity);
  if (hasBoundAssets && !referenceImages.length) {
    const error = new Error('当前镜头已绑定人物、场景或商品，但没有可追溯参考图；已停止分镜图生成，避免人物和空间漂移');
    error.status = 409;
    error.code = 'SKETCH_REFERENCE_ASSET_MISSING';
    error.retryable = false;
    throw error;
  }
  const prompt = [
    '商业影视人物场景分镜图，清晰呈现已确认人物、场景、动作、站位、景别、机位和运动方向。',
    '严格结合当前人物与场景参考资产，不得退化为只表达剧情流向的线稿。',
    '不要加入文字、字幕、镜头编号、水印、品牌标识或彩色成片效果。',
    `镜头标题：${clean(shot.title || `镜头 ${numericIndex}`, 160)}`,
    `画面：${clean(shot.visual || shot.visual_description || '', 1200)}`,
    `动作：${clean(shot.action || '', 800)}`,
    `场景：${clean(sceneAsset.name || shot.scene_zone || shot.scene_id || '', 220)}；剧情用途：${clean(sceneAsset.story_purpose || '', 500)}`,
    `故事与连续性权威：${clean(JSON.stringify(storyContext), 2600)}`,
    '分镜图必须画出本镜在故事中的动作因果，并承接上一镜退出状态、交给下一镜进入状态；银幕方向、视线、轴线和道具状态不得跳变。',
    referenceImages.length ? '附件参考图是当前任务的人物、商品与场景权威资产；只借鉴其中真实主体和空间关系，不复制档案排版、拼图边框或参考图背景。' : '',
    referenceImages.length ? '人物身份、服装、家具、桌床等道具、空间布局和机位方向必须与附件一致；附件中没有的物件不得自行增加。' : '',
    `镜头设置：${clean([
      shot.shot_size,
      shot.camera_angle,
      shot.lens_mm ? `${shot.lens_mm}mm` : '',
      shot.composition,
      shot.subject_position,
      shot.camera_movement,
    ].filter(Boolean).join('；'), 700)}`,
    knowledgePolicyRuntime.promptBlock(sketchKnowledge),
  ].filter(line => !line.endsWith('：')).join('\n');
  const generated = await mediaAdapter.generateImage({
    taskId,
    stage: 'new_story_ad.storyboard_image',
    prompt,
    auditSafePrompt: prompt,
    filename: `storyboard_image_${taskId}_${numericIndex}_${Date.now()}`,
    aspectRatio: clean(context.output_ratio || '9:16', 20),
    resolution: '1K',
    imageModel: options.image_model || options.imageModel || 'auto',
    singleAttempt: true,
    clientRequestId: clean(options.client_request_id || uuidv4(), 120),
    shotIndex: numericIndex - 1,
    referenceImages,
    requireReferences: referenceImages.length > 0,
    inputFidelity: referenceImages.length ? 'high' : undefined,
  });
  const previous = storage.getOutput(taskId, 'storyboard_images') || [];
  const nextSketch = {
    id: `storyboard-image-${numericIndex}`,
    shot_index: numericIndex,
    status: 'draft',
    image_url: clean(generated.image_url || generated.url, 1200),
    composition_notes: clean(options.composition_notes || '', 1200),
    source: 'generated',
    reference_count: referenceImages.length,
    story_context_fingerprint: storyContextFingerprint,
    source_content_revision: Number(task.content_revision || 1) || 1,
    knowledge_policy: knowledgePolicyRuntime.trace(sketchKnowledge),
    updated_at: new Date().toISOString(),
  };
  const next = normalizeSketches(taskId, [
    ...previous.filter(item => Number(item.shot_index) !== numericIndex),
    nextSketch,
  ]);
  storage.saveOutput(taskId, 'storyboard_images', next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `manual:${taskId}`,
  });
  return { sketch: next.find(item => item.shot_index === numericIndex), provider_used: clean(generated.provider_used, 160) };
}

/** 按真实分镜合同并行生成所有缺失人物场景分镜图；逐镜落盘，失败后只补缺失项。 */
async function generateSketchBatch(taskId, options = {}, dependencies = {}) {
  sketchGate.assertReady(taskId);
  if (options.confirmed !== true) {
    const error = new Error('批量生成分镜图前需要确认本次图片调用数量');
    error.status = 400;
    error.code = 'SKETCH_BATCH_CONFIRMATION_REQUIRED';
    throw error;
  }
  if (activeSketchBatches.has(taskId)) {
    const error = new Error('当前项目已有分镜图批次正在生成');
    error.status = 409;
    error.code = 'SKETCH_BATCH_IN_PROGRESS';
    throw error;
  }
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  if (!shots.length) {
    const error = new Error('请先生成绑定人物、场景、动作和机位的分镜合同，再生成分镜图');
    error.status = 409;
    error.code = 'STORYBOARD_REQUIRED_FOR_SKETCH_BATCH';
    throw error;
  }
  const existing = storage.getOutput(taskId, 'storyboard_images') || [];
  const existingByShot = new Map(existing.map(item => [Number(item.shot_index), item]));
  const targets = shots.map((shot, index) => Number(shot.shot_index || shot.index || index + 1) || index + 1)
    .filter(shotIndex => options.regenerate_all === true || !existingByShot.get(shotIndex)?.image_url);
  if (!targets.length) {
    const progress = saveBatchProgress(taskId, {
      id: clean(options.client_request_id || uuidv4(), 120),
      status: 'succeeded',
      requested: 0,
      completed: 0,
      skipped_existing: shots.length,
      target_indexes: [],
      current_index: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      message: '所有人物场景分镜图均已存在，无需重复生成。',
    });
    return { sketches: existing, requested: 0, completed: 0, skipped_existing: shots.length, progress };
  }
  activeSketchBatches.add(taskId);
  const batchId = clean(options.client_request_id || uuidv4(), 120);
  const startedAt = new Date().toISOString();
  let completed = 0;
  saveBatchProgress(taskId, {
    id: batchId,
    status: 'running',
    requested: targets.length,
    completed: 0,
    skipped_existing: shots.length - targets.length,
    target_indexes: targets,
    completed_indexes: [],
    current_index: targets[0] || 0,
    started_at: startedAt,
    finished_at: '',
    error: '',
    error_code: '',
    message: `正在生成第 ${targets[0]} 镜人物场景分镜图，完成后会显示在本页对应镜头卡片中。`,
  });
  try {
    const completedIndexes = [];
    const results = await Promise.allSettled(targets.map(async shotIndex => {
      const result = await generateSketch(taskId, shotIndex, {
        confirmed: true,
        batch_owner: taskId,
        client_request_id: `${batchId}:${shotIndex}`,
        image_model: options.image_model || options.imageModel,
      }, dependencies);
      completed += 1;
      completedIndexes.push(shotIndex);
      saveBatchProgress(taskId, {
        status: 'running',
        completed,
        completed_indexes: [...completedIndexes].sort((a, b) => a - b),
        current_index: 0,
        message: `人物场景分镜图并行生成中，已完成 ${completed}/${targets.length}。`,
      });
      return result;
    }));
    const failedIndexes = results.map((result, index) => result.status === 'rejected' ? targets[index] : 0).filter(Boolean);
    if (failedIndexes.length) {
      const firstFailure = results.find(result => result.status === 'rejected')?.reason || new Error('分镜图批次存在失败项');
      firstFailure.details = { ...(firstFailure.details || {}), requested: targets.length, completed, remaining: failedIndexes.length, failed_indexes: failedIndexes };
      saveBatchProgress(taskId, {
        status: 'failed', completed, completed_indexes: [...completedIndexes].sort((a, b) => a - b), failed_indexes: failedIndexes,
        current_index: 0, finished_at: new Date().toISOString(), error: clean(firstFailure.message, 600),
        error_code: clean(firstFailure.code || 'STORYBOARD_IMAGE_BATCH_FAILED', 100),
        message: `人物场景分镜图完成 ${completed}/${targets.length}，失败 ${failedIndexes.length}；重试只补失败镜头。`,
      });
      throw firstFailure;
    }
    saveBatchProgress(taskId, {
      status: 'succeeded', completed, completed_indexes: [...completedIndexes].sort((a, b) => a - b), current_index: 0,
      finished_at: new Date().toISOString(), message: `人物场景分镜图批量生成完成，共完成 ${completed}/${targets.length}。`,
    });
    return {
      sketches: storage.getOutput(taskId, 'storyboard_images') || [],
      requested: targets.length,
      completed,
      skipped_existing: shots.length - targets.length,
      progress: batchProgress(taskId),
    };
  } catch (error) {
    error.details = { ...(error.details || {}), requested: targets.length, completed, remaining: Math.max(0, targets.length - completed) };
    if (batchProgress(taskId)?.status !== 'failed') saveBatchProgress(taskId, {
      status: 'failed', completed, finished_at: new Date().toISOString(), error: clean(error.message, 600),
      error_code: clean(error.code || 'STORYBOARD_IMAGE_BATCH_FAILED', 100),
      message: `分镜图批次已停止；已完成 ${completed}/${targets.length}，重试只补缺失项。`,
    });
    throw error;
  } finally {
    activeSketchBatches.delete(taskId);
  }
}

function getSketchBatch(taskId) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  let progress = batchProgress(taskId);
  const active = Boolean(progress && ['queued', 'running'].includes(String(progress.status || '')) && activeSketchBatches.has(taskId));
  if (progress && ['queued', 'running'].includes(String(progress.status || '')) && !active) {
    progress = saveBatchProgress(taskId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: '分镜图批次进程已中断。已完成图片已经保留，重新提交只会补生成缺失镜头。',
      error_code: 'SKETCH_BATCH_INTERRUPTED',
      message: `分镜图批次已中断；已完成 ${Number(progress.completed || 0)}/${Number(progress.requested || 0)}，可以重新提交补齐。`,
    });
  }
  return {
    progress,
    active,
    sketches: storage.getOutput(taskId, 'storyboard_images') || [],
  };
}

module.exports = { generateSketch, generateSketchBatch, getSketchBatch, normalizeSketches, saveSketches };
