const storage = require('../newStoryAd/storageService');
const storyAd = require('../newStoryAd');
const mediaAdapterDefault = require('../newStoryAd/mediaAdapter');
const sketchGate = require('./storyboardSketchGateService');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_STATUSES = new Set(['draft', 'confirmed', 'skipped']);
const activeSketchBatches = new Set();
const SKETCH_BATCH_OUTPUT = 'storyboard_sketch_batch';

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

/** 规范化逐镜线稿记录，禁止脱离真实分镜创建游离数据。 */
function normalizeSketches(taskId, sketches = []) {
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const shotIndexes = new Set(shots.map((shot, index) => Number(shot.shot_index || shot.index || index + 1) || index + 1));
  return (Array.isArray(sketches) ? sketches : [])
    .map((item, index) => {
      const shotIndex = Number(item.shot_index || item.shotIndex || item.index || index + 1) || index + 1;
      if (!shotIndexes.has(shotIndex)) return null;
      const status = ALLOWED_STATUSES.has(clean(item.status, 30)) ? clean(item.status, 30) : 'draft';
      return {
        id: clean(item.id || `storyboard-sketch-${shotIndex}`, 120),
        shot_index: shotIndex,
        status,
        image_url: clean(item.image_url || item.imageUrl || item.url, 1200),
        composition_notes: clean(item.composition_notes || item.compositionNotes || item.notes, 1200),
        source: clean(item.source || (item.image_url || item.imageUrl ? 'upload' : 'manual'), 60),
        reference_count: Math.max(0, Number(item.reference_count || 0) || 0),
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
  })));
}

/** 保存线稿草稿；只有确认时才把构图约束写回现有分镜权威数据。 */
function saveSketches(taskId, sketches = [], user = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时修改线稿分镜');
    error.status = 409;
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    throw error;
  }
  sketchGate.assertReady(taskId);
  const normalized = normalizeSketches(taskId, sketches);
  const previous = storage.getOutput(taskId, 'storyboard_sketches') || [];
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
      .filter(line => !line.trim().startsWith('线稿构图约束：'))
      .join('\n')
      .trim();
    return {
      ...shot,
      storyboard_sketch: {
        id: sketch.id,
        image_url: sketch.image_url,
        composition_notes: note,
        status: sketch.status,
      },
      keyframe_notes: [currentNotes, note ? `线稿构图约束：${note}` : ''].filter(Boolean).join('\n'),
    };
  });

  let result = { content_revision: Number(task.content_revision || 1) || 1 };
  if (changedConfirmed.size) result = storyAd.updateStoryboardTable(taskId, nextShots, user);
  const currentTask = storage.getTask(taskId);
  storage.saveOutput(taskId, 'storyboard_sketches', persisted, {
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

/** 为真实分镜生成一张低成本构图草图；结果只作为草稿保存，不自动进入关键帧合同。 */
async function generateSketch(taskId, shotIndex, options = {}, dependencies = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const error = new Error('项目不存在');
    error.status = 404;
    error.code = 'TASK_NOT_FOUND';
    throw error;
  }
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时生成线稿');
    error.status = 409;
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    throw error;
  }
  sketchGate.assertReady(taskId);
  if (activeSketchBatches.has(taskId) && options.batch_owner !== taskId) {
    const error = new Error('当前项目正在批量生成线稿，请等待本批完成');
    error.status = 409;
    error.code = 'SKETCH_BATCH_IN_PROGRESS';
    throw error;
  }
  if (options.confirmed !== true) {
    const error = new Error('生成线稿前需要用户明确确认本次图片调用');
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
  const referenceImages = storyAd.keyframeReferenceImages(context, sceneReference, null, shot, contract, sceneAsset);
  const hasBoundAssets = Boolean(sceneId
    || (Array.isArray(shot.characters) && shot.characters.length)
    || (Array.isArray(shot.character_ids) && shot.character_ids.length)
    || context.person_asset
    || context.product_contract?.identity);
  if (hasBoundAssets && !referenceImages.length) {
    const error = new Error('当前镜头已绑定人物、场景或商品，但没有可追溯参考图；已停止线稿生成，避免人物和空间漂移');
    error.status = 409;
    error.code = 'SKETCH_REFERENCE_ASSET_MISSING';
    error.retryable = false;
    throw error;
  }
  const prompt = [
    '商业影视分镜线稿，黑白或灰度，干净的铅笔线条与少量明暗块。',
    '只表达当前镜头的构图、主体数量、站位、视线、景别、机位和运动方向。',
    '不要加入文字、字幕、镜头编号、水印、品牌标识或彩色成片效果。',
    `镜头标题：${clean(shot.title || `镜头 ${numericIndex}`, 160)}`,
    `画面：${clean(shot.visual || shot.visual_description || '', 1200)}`,
    `动作：${clean(shot.action || '', 800)}`,
    `场景：${clean(shot.scene_zone || shot.scene_id || '', 220)}`,
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
  ].filter(line => !line.endsWith('：')).join('\n');
  const generated = await mediaAdapter.generateImage({
    taskId,
    stage: 'new_story_ad.storyboard_sketch',
    prompt,
    auditSafePrompt: prompt,
    filename: `storyboard_sketch_${taskId}_${numericIndex}_${Date.now()}`,
    aspectRatio: clean(context.output_ratio || '9:16', 20),
    resolution: '1K',
    singleAttempt: true,
    clientRequestId: clean(options.client_request_id || uuidv4(), 120),
    shotIndex: numericIndex - 1,
    referenceImages,
    requireReferences: referenceImages.length > 0,
    inputFidelity: referenceImages.length ? 'high' : undefined,
  });
  const previous = storage.getOutput(taskId, 'storyboard_sketches') || [];
  const nextSketch = {
    id: `storyboard-sketch-${numericIndex}`,
    shot_index: numericIndex,
    status: 'draft',
    image_url: clean(generated.image_url || generated.url, 1200),
    composition_notes: clean(options.composition_notes || '', 1200),
    source: 'generated',
    reference_count: referenceImages.length,
    updated_at: new Date().toISOString(),
  };
  const next = normalizeSketches(taskId, [
    ...previous.filter(item => Number(item.shot_index) !== numericIndex),
    nextSketch,
  ]);
  storage.saveOutput(taskId, 'storyboard_sketches', next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `manual:${taskId}`,
  });
  return { sketch: next.find(item => item.shot_index === numericIndex), provider_used: clean(generated.provider_used, 160) };
}

/** 按真实文字分镜顺序一次性生成所有缺失线稿；逐镜落盘，失败后重试只补缺失项。 */
async function generateSketchBatch(taskId, options = {}, dependencies = {}) {
  sketchGate.assertReady(taskId);
  if (options.confirmed !== true) {
    const error = new Error('批量生成线稿前需要确认本次图片调用数量');
    error.status = 400;
    error.code = 'SKETCH_BATCH_CONFIRMATION_REQUIRED';
    throw error;
  }
  if (activeSketchBatches.has(taskId)) {
    const error = new Error('当前项目已有线稿批次正在生成');
    error.status = 409;
    error.code = 'SKETCH_BATCH_IN_PROGRESS';
    throw error;
  }
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  if (!shots.length) {
    const error = new Error('请先生成文字分镜，再批量生成线稿');
    error.status = 409;
    error.code = 'STORYBOARD_REQUIRED_FOR_SKETCH_BATCH';
    throw error;
  }
  const existing = storage.getOutput(taskId, 'storyboard_sketches') || [];
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
      message: '所有线稿均已存在，无需重复生成。',
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
    message: `正在生成第 ${targets[0]} 镜线稿，完成后会显示在本页对应镜头卡片中。`,
  });
  try {
    for (const shotIndex of targets) {
      saveBatchProgress(taskId, {
        status: 'running',
        current_index: shotIndex,
        message: `正在生成第 ${shotIndex} 镜线稿，已完成 ${completed}/${targets.length}。`,
      });
      await generateSketch(taskId, shotIndex, {
        confirmed: true,
        batch_owner: taskId,
        client_request_id: `${batchId}:${shotIndex}`,
      }, dependencies);
      completed += 1;
      saveBatchProgress(taskId, {
        status: completed >= targets.length ? 'succeeded' : 'running',
        completed,
        completed_indexes: targets.slice(0, completed),
        current_index: completed < targets.length ? targets[completed] : 0,
        ...(completed >= targets.length ? { finished_at: new Date().toISOString() } : {}),
        message: completed >= targets.length
          ? `线稿批量生成完成，共完成 ${completed}/${targets.length}。`
          : `第 ${shotIndex} 镜已完成，正在准备第 ${targets[completed]} 镜。`,
      });
    }
    return {
      sketches: storage.getOutput(taskId, 'storyboard_sketches') || [],
      requested: targets.length,
      completed,
      skipped_existing: shots.length - targets.length,
      progress: batchProgress(taskId),
    };
  } catch (error) {
    error.details = { ...(error.details || {}), requested: targets.length, completed, remaining: targets.length - completed };
    saveBatchProgress(taskId, {
      status: 'failed',
      completed,
      completed_indexes: targets.slice(0, completed),
      current_index: targets[completed] || 0,
      finished_at: new Date().toISOString(),
      error: clean(error.message, 600),
      error_code: clean(error.code || 'SKETCH_BATCH_FAILED', 100),
      message: `线稿批次在第 ${targets[completed] || targets.length} 镜停止；已完成 ${completed}/${targets.length}，重试只会补缺失项。`,
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
      error: '线稿批次进程已中断。已完成图片已经保留，重新提交只会补生成缺失镜头。',
      error_code: 'SKETCH_BATCH_INTERRUPTED',
      message: `线稿批次已中断；已完成 ${Number(progress.completed || 0)}/${Number(progress.requested || 0)}，可以重新提交补齐。`,
    });
  }
  return {
    progress,
    active,
    sketches: storage.getOutput(taskId, 'storyboard_sketches') || [],
  };
}

module.exports = { generateSketch, generateSketchBatch, getSketchBatch, normalizeSketches, saveSketches };
