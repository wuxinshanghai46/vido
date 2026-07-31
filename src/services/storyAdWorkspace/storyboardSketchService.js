const storage = require('../newStoryAd/storageService');
const storyAd = require('../newStoryAd');
const mediaAdapterDefault = require('../newStoryAd/mediaAdapter');
const { v4: uuidv4 } = require('uuid');

const ALLOWED_STATUSES = new Set(['draft', 'confirmed', 'skipped']);

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
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const prompt = [
    '商业影视分镜线稿，黑白或灰度，干净的铅笔线条与少量明暗块。',
    '只表达当前镜头的构图、主体数量、站位、视线、景别、机位和运动方向。',
    '不要加入文字、字幕、镜头编号、水印、品牌标识或彩色成片效果。',
    `镜头标题：${clean(shot.title || `镜头 ${numericIndex}`, 160)}`,
    `画面：${clean(shot.visual || shot.visual_description || '', 1200)}`,
    `动作：${clean(shot.action || '', 800)}`,
    `场景：${clean(shot.scene_zone || shot.scene_id || '', 220)}`,
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
  });
  const previous = storage.getOutput(taskId, 'storyboard_sketches') || [];
  const nextSketch = {
    id: `storyboard-sketch-${numericIndex}`,
    shot_index: numericIndex,
    status: 'draft',
    image_url: clean(generated.image_url || generated.url, 1200),
    composition_notes: clean(options.composition_notes || '', 1200),
    source: 'generated',
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

module.exports = { generateSketch, normalizeSketches, saveSketches };
