'use strict';

const { v4: uuidv4 } = require('uuid');
const storage = require('../newStoryAd/storageService');
const mediaAdapterDefault = require('../newStoryAd/mediaAdapter');
const flowGate = require('./storyFlowSketchGateService');

const OUTPUT_KIND = flowGate.OUTPUT_KIND;
const BATCH_KIND = 'story_flow_sketch_batch';
const activeBatches = new Set();

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function now() { return new Date().toISOString(); }

function saveProgress(taskId, patch = {}) {
  const task = storage.getTask(taskId) || {};
  const previous = storage.getOutput(taskId, BATCH_KIND) || {};
  const requested = Math.max(0, Number(patch.requested ?? previous.requested ?? 0) || 0);
  const completed = Math.max(0, Math.min(requested, Number(patch.completed ?? previous.completed ?? 0) || 0));
  const failed = Math.max(0, Math.min(requested, Number(patch.failed ?? previous.failed ?? 0) || 0));
  const next = {
    ...previous,
    ...patch,
    requested,
    completed,
    failed,
    remaining: Math.max(0, requested - completed - failed),
    percent: requested ? Math.round(((completed + failed) / requested) * 100) : 100,
    updated_at: now(),
  };
  storage.saveOutput(taskId, BATCH_KIND, next, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `flow:${taskId}`,
  });
  return next;
}

function normalize(taskId, rows = []) {
  const { task, beats, fingerprint } = flowGate.blueprintState(taskId);
  const indexes = new Set(beats.map((beat, index) => Number(beat.beat_index || beat.index || index + 1) || index + 1));
  return list(rows).map((item, index) => {
    const beatIndex = Number(item.beat_index || item.beatIndex || item.index || index + 1) || index + 1;
    if (!indexes.has(beatIndex)) return null;
    return {
      id: clean(item.id || `story-flow-sketch-${beatIndex}`, 120),
      beat_index: beatIndex,
      status: item.status === 'confirmed' ? 'confirmed' : 'draft',
      image_url: clean(item.image_url || item.imageUrl || item.url, 1200),
      flow_notes: clean(item.flow_notes || item.flowNotes || item.notes, 1200),
      source: clean(item.source || 'generated', 60),
      source_blueprint_fingerprint: fingerprint,
      source_content_revision: Number(task.content_revision || 1) || 1,
      provider_used: clean(item.provider_used, 160),
      updated_at: clean(item.updated_at, 80) || now(),
    };
  }).filter(Boolean).sort((a, b) => a.beat_index - b.beat_index);
}

function assertSceneReady(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  if (context.scene_setup_confirmed !== true) {
    throw Object.assign(new Error('请先完成并确认全部人物与场景资产。'), {
      code: 'SCENE_CONFIRMATION_REQUIRED_FOR_STORY_FLOW', status: 409, retryable: false,
    });
  }
  const { beats } = flowGate.blueprintState(taskId);
  if (!beats.length) throw Object.assign(new Error('请先生成并确认剧情与对白。'), {
    code: 'BLUEPRINT_REQUIRED_FOR_STORY_FLOW', status: 409, retryable: false,
  });
  return { task, context, beats };
}

async function generateBeat(taskId, beatIndex, options = {}, dependencies = {}) {
  const { task, context, beats } = assertSceneReady(taskId);
  const numericIndex = Number(beatIndex);
  const position = beats.findIndex((beat, index) => Number(beat.beat_index || beat.index || index + 1) === numericIndex);
  const beat = beats[position];
  if (!beat) throw Object.assign(new Error('没有找到对应剧情节点。'), { code: 'STORY_FLOW_BEAT_NOT_FOUND', status: 404 });
  const previous = position > 0 ? beats[position - 1] : null;
  const next = position < beats.length - 1 ? beats[position + 1] : null;
  const prompt = [
    '影视剧情流向线稿，黑白铅笔草图，少量灰度块，画面简洁清楚。',
    '本图只表达剧情整体流向中的当前事件：人物目标、动作变化、因果结果以及与前后事件的衔接。',
    '一张图只画当前节点的一个连续动作构图；禁止四格漫画、九宫格、拼贴、多画面分屏或在单图中重复人物。',
    '不要设计最终景别、镜头焦段、精确机位或成片级材质；这些属于下一步人物场景分镜。',
    '不要出现文字、字幕、镜号、水印、品牌标识或彩色成片效果。',
    `故事：${clean((storage.getOutput(taskId, 'blueprint') || {}).logline || '', 600)}`,
    `当前节点：${clean(beat.title || `剧情节点 ${numericIndex}`, 160)}；${clean(beat.plot || beat.visual || beat.story_visual || '', 1200)}`,
    `当前动作与变化：${clean(beat.action || '', 600)}；${clean(beat.state_before || '', 400)} → ${clean(beat.state_after || '', 400)}`,
    previous ? `上一节点：${clean(previous.title || previous.plot || previous.visual || '', 600)}` : '上一节点：故事开始。',
    next ? `下一节点：${clean(next.title || next.plot || next.visual || '', 600)}` : '下一节点：故事收束。',
  ].join('\n');
  const mediaAdapter = dependencies.mediaAdapter || mediaAdapterDefault;
  const generated = await mediaAdapter.generateImage({
    taskId,
    stage: 'new_story_ad.story_flow_sketch',
    prompt,
    auditSafePrompt: prompt,
    filename: `story_flow_sketch_${taskId}_${numericIndex}_${Date.now()}`,
    aspectRatio: clean(context.output_ratio || '16:9', 20),
    resolution: '1K',
    imageModel: options.image_model || options.imageModel,
    singleAttempt: true,
    clientRequestId: clean(options.client_request_id || uuidv4(), 120),
    shotIndex: numericIndex - 1,
    referenceImages: [],
  });
  const current = list(storage.getOutput(taskId, OUTPUT_KIND));
  const row = normalize(taskId, [{
    id: `story-flow-sketch-${numericIndex}`,
    beat_index: numericIndex,
    status: 'draft',
    image_url: generated.image_url || generated.url,
    source: 'generated',
    provider_used: generated.provider_used,
  }])[0];
  const persisted = normalize(taskId, [...current.filter(item => Number(item.beat_index) !== numericIndex), row]);
  storage.saveOutput(taskId, OUTPUT_KIND, persisted, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `flow:${taskId}`,
  });
  return row;
}

function startBatch(taskId, options = {}, dependencies = {}) {
  const { beats } = assertSceneReady(taskId);
  if (options.confirmed !== true) throw Object.assign(new Error('生成流向线稿前需要确认本次图片调用。'), {
    code: 'STORY_FLOW_GENERATION_CONFIRMATION_REQUIRED', status: 400, retryable: false,
  });
  if (activeBatches.has(taskId)) throw Object.assign(new Error('当前项目正在生成流向线稿。'), {
    code: 'STORY_FLOW_BATCH_IN_PROGRESS', status: 409, retryable: false,
  });
  const existing = list(storage.getOutput(taskId, OUTPUT_KIND));
  const byBeat = new Map(existing.map(item => [Number(item.beat_index), item]));
  const targets = beats.map((beat, index) => Number(beat.beat_index || beat.index || index + 1) || index + 1)
    .filter(index => options.regenerate_all === true || !byBeat.get(index)?.image_url);
  const batchId = clean(options.client_request_id || uuidv4(), 120);
  const progress = saveProgress(taskId, {
    id: batchId,
    status: targets.length ? 'running' : 'succeeded',
    requested: targets.length,
    completed: 0,
    failed: 0,
    target_indexes: targets,
    completed_indexes: [],
    failed_indexes: [],
    started_at: now(),
    finished_at: targets.length ? '' : now(),
    message: targets.length ? `正在并行生成 ${targets.length} 张剧情流向线稿。` : '全部流向线稿均已存在。',
  });
  if (!targets.length) return { accepted: false, progress, sketches: existing };
  activeBatches.add(taskId);
  const completedIndexes = [];
  const failedIndexes = [];
  void Promise.allSettled(targets.map(index => generateBeat(taskId, index, {
    ...options,
    client_request_id: `${batchId}:${index}`,
  }, dependencies).then(result => {
    completedIndexes.push(index);
    saveProgress(taskId, {
      status: 'running',
      completed: completedIndexes.length,
      failed: failedIndexes.length,
      completed_indexes: [...completedIndexes].sort((a, b) => a - b),
      failed_indexes: [...failedIndexes].sort((a, b) => a - b),
      message: `剧情流向线稿并行生成中，已完成 ${completedIndexes.length}/${targets.length}。`,
    });
    return result;
  }).catch(error => {
    failedIndexes.push(index);
    saveProgress(taskId, {
      status: 'running',
      completed: completedIndexes.length,
      failed: failedIndexes.length,
      completed_indexes: [...completedIndexes].sort((a, b) => a - b),
      failed_indexes: [...failedIndexes].sort((a, b) => a - b),
      message: `剧情流向线稿并行生成中，已完成 ${completedIndexes.length}/${targets.length}，失败 ${failedIndexes.length}。`,
    });
    throw error;
  }))).then(results => {
    const firstFailure = results.find(result => result.status === 'rejected');
    saveProgress(taskId, {
      status: failedIndexes.length ? 'failed' : 'succeeded',
      completed: completedIndexes.length,
      failed: failedIndexes.length,
      completed_indexes: completedIndexes,
      failed_indexes: failedIndexes,
      finished_at: now(),
      error: firstFailure ? clean(firstFailure.reason?.message || firstFailure.reason, 600) : '',
      error_code: firstFailure ? clean(firstFailure.reason?.code || 'STORY_FLOW_BATCH_FAILED', 100) : '',
      message: failedIndexes.length
        ? `流向线稿完成 ${completedIndexes.length}/${targets.length}，失败 ${failedIndexes.length}；重试只补失败节点。`
        : `剧情流向线稿已完成 ${completedIndexes.length}/${targets.length}。`,
    });
  }).finally(() => activeBatches.delete(taskId));
  return { accepted: true, progress };
}

function confirmAll(taskId) {
  const { beats } = assertSceneReady(taskId);
  if (activeBatches.has(taskId)) throw Object.assign(new Error('流向线稿仍在生成，请等待完成后确认。'), {
    code: 'STORY_FLOW_BATCH_IN_PROGRESS', status: 409, retryable: false,
  });
  const current = normalize(taskId, storage.getOutput(taskId, OUTPUT_KIND) || []);
  if (current.length !== beats.length || current.some(item => !item.image_url)) {
    throw Object.assign(new Error(`流向线稿尚未完整生成（${current.filter(item => item.image_url).length}/${beats.length}）。`), {
      code: 'STORY_FLOW_SKETCHES_INCOMPLETE', status: 409, retryable: false,
    });
  }
  const confirmed = current.map(item => ({ ...item, status: 'confirmed', updated_at: now() }));
  const task = storage.getTask(taskId) || {};
  storage.saveOutput(taskId, OUTPUT_KIND, confirmed, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `flow:${taskId}`,
  });
  return { sketches: confirmed, gate: flowGate.inspect(taskId), model_call_count: 0 };
}

function getBatch(taskId) {
  if (!storage.getTask(taskId)) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  let progress = storage.getOutput(taskId, BATCH_KIND) || null;
  if (progress && ['queued', 'running'].includes(String(progress.status || '')) && !activeBatches.has(taskId)) {
    progress = saveProgress(taskId, {
      status: 'failed',
      finished_at: now(),
      error: '流向线稿进程已中断，已完成图片保留，重新提交只补缺失节点。',
      error_code: 'STORY_FLOW_BATCH_INTERRUPTED',
      message: '流向线稿进程已中断，可以重新提交补齐。',
    });
  }
  return { progress, active: activeBatches.has(taskId), sketches: list(storage.getOutput(taskId, OUTPUT_KIND)), gate: flowGate.inspect(taskId) };
}

module.exports = { BATCH_KIND, OUTPUT_KIND, confirmAll, generateBeat, getBatch, normalize, startBatch };
