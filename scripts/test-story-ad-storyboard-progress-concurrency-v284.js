#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-v284-'));
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_STORYBOARD_CHUNK_CONCURRENCY = '3';
process.env.NEW_STORY_AD_STORYBOARD_IMAGE_CONCURRENCY = '2';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const storyboard = require('../src/services/newStoryAd/storyboardTableService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const generationConcurrency = require('../src/services/newStoryAd/generationConcurrencyService');
const storyFlow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const storyboardImages = require('../src/services/storyAdWorkspace/storyboardSketchService');
const referenceProjection = require('../src/services/storyAdWorkspace/referenceDraftProjectionService');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function currentChunk(userPrompt = '') {
  const match = String(userPrompt).match(/^Current beats:\s*(.+)$/m);
  return match ? JSON.parse(match[1]) : [];
}

function generatedShot(beat = {}, index = 0) {
  const shotIndex = Number(beat.beat_index || index + 1);
  return {
    index: shotIndex,
    title: `镜头 ${shotIndex}`,
    role: '推进剧情',
    purpose: '呈现可见变化',
    visual: `主体完成第 ${shotIndex} 个可见动作`,
    action: `完成动作 ${shotIndex}`,
    voiceover: `这是第 ${shotIndex} 镜`,
    expected_people: 0,
    expected_animals: 0,
    characters: [],
  };
}

async function testTextCheckpointConcurrencyAndResume() {
  const taskId = 'storyboard-text-v284';
  storyAd.createTask({
    task_id: taskId,
    brief: '七镜并发断点恢复验证',
    cast_mode: 'no_human',
    shot_count: 7,
    target_duration: 7,
  }, { id: 'v284-owner', role: 'user' });
  const blueprint = {
    story_title: '七镜测试',
    beats: Array.from({ length: 7 }, (_, index) => ({
      beat_id: `beat_${index + 1}`,
      beat_index: index + 1,
      title: `剧情节点 ${index + 1}`,
      plot: `主体推进到状态 ${index + 1}`,
      action: `动作 ${index + 1}`,
    })),
  };
  const ctx = {
    brief: '七镜并发断点恢复验证', cast_mode: 'no_human', shot_count: 7, target_duration: 7,
    scene_assets: [], characters: [], assets: [], forbidden: [],
  };
  const originalGenerateText = modelGateway.generateText;
  let active = 0;
  let peak = 0;
  let calls = 0;
  const checkpoints = [];
  modelGateway.generateText = async ({ userPrompt }) => {
    const chunk = currentChunk(userPrompt);
    const index = Number(chunk[0]?.beat_index || 0);
    calls += 1;
    const callNumber = calls;
    active += 1;
    peak = Math.max(peak, active);
    await delay(index === 6 ? 18 : 8);
    active -= 1;
    if (callNumber === 6) {
      const error = new Error('模拟生产 JSON_PARSE_FAILED');
      error.code = 'JSON_PARSE_FAILED';
      throw error;
    }
    const rows = chunk.map(generatedShot);
    return { text: JSON.stringify({ shots: rows }), parsed_json: { shots: rows }, used_model: 'fixture-json-model', fallback_used: false, failed_models: [] };
  };
  let failure;
  try {
    await storyboard.generateStoryboardTable(ctx, blueprint, {
      taskId,
      onCheckpoint: async checkpoint => { checkpoints.push(checkpoint); },
    });
  } catch (error) {
    failure = error;
  }
  assert.equal(calls, 7, 'fixture 必须覆盖七个独立镜头批次');
  assert.equal(failure?.code, 'JSON_PARSE_FAILED');
  assert.equal(failure?.partial_results_saved, true);
  assert.equal(failure?.partial_completed, 6);
  assert.equal(peak, 3, '镜头合同应使用三路受控并发');
  const saved = checkpoints.at(-1)?.shots || [];
  assert.equal(saved.length, 6);
  assert.deepEqual(saved.map(item => item.index), [1, 2, 3, 4, 5, 7]);

  calls = 0;
  modelGateway.generateText = async ({ userPrompt }) => {
    const chunk = currentChunk(userPrompt);
    calls += 1;
    const rows = chunk.map(generatedShot);
    return { text: JSON.stringify({ shots: rows }), parsed_json: { shots: rows }, used_model: 'fixture-json-model', fallback_used: false, failed_models: [] };
  };
  const resumed = await storyboard.generateStoryboardTable(ctx, blueprint, { taskId, resumeShots: saved });
  assert.equal(calls, 1, '重试必须只生成缺失镜头合同');
  assert.equal(resumed.shots.length, 7);
  modelGateway.generateText = originalGenerateText;
  assert.equal(generationConcurrency.snapshot(`storyboard-table:${taskId}`)[0]?.peak, 3);
}

async function testImageBatchParallelPersistenceAndRetry() {
  const owner = { id: 'v284-owner', role: 'user' };
  const taskId = 'storyboard-images-v284';
  storyAd.createTask({ task_id: taskId, brief: '四镜图片并发验证', cast_mode: 'no_human' }, owner);
  const blueprint = {
    story_title: '四镜图片测试',
    fingerprint: 'v284-blueprint',
    beats: Array.from({ length: 4 }, (_, index) => ({ beat_id: `image_beat_${index + 1}`, beat_index: index + 1, plot: `画面 ${index + 1}` })),
  };
  storage.saveOutput(taskId, 'context', { brief: '四镜图片并发验证', cast_mode: 'no_human', scene_setup_confirmed: true, scene_assets: [] });
  storage.saveOutput(taskId, 'blueprint', blueprint);
  const flowDraft = storyFlow.draft(taskId);
  storyFlow.confirmSystem(taskId, flowDraft.units, { used_model: 'fixture-planner' });
  const shots = blueprint.beats.map((beat, index) => generatedShot({ ...beat, beat_index: index + 1 }, index));
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(taskId, 'keyframe_contracts', shots.map((shot, index) => ({ shot_index: index + 1, visual_contract: {} })));

  let active = 0;
  let peak = 0;
  const called = [];
  let failThird = true;
  const mediaAdapter = {
    generateImage: async ({ filename }) => {
      const shotIndex = Number(String(filename).match(/_(\d+)_\d+$/)?.[1] || 0);
      called.push(shotIndex);
      active += 1;
      peak = Math.max(peak, active);
      await delay(12);
      active -= 1;
      if (shotIndex === 3 && failThird) throw Object.assign(new Error('模拟第 3 镜图片失败'), { code: 'IMAGE_FIXTURE_FAILED' });
      return { image_url: `/generated/storyboard-${shotIndex}.png`, provider_used: 'fixture-image-provider' };
    },
  };
  await assert.rejects(
    () => storyboardImages.generateSketchBatch(taskId, { confirmed: true }, { mediaAdapter }),
    error => error?.code === 'IMAGE_FIXTURE_FAILED',
  );
  const failedBatch = storyboardImages.getSketchBatch(taskId);
  assert.equal(peak, 2, '分镜图片应使用两路受控并发');
  assert.equal(failedBatch.progress.processed, 4);
  assert.equal(failedBatch.progress.succeeded, 3);
  assert.deepEqual(failedBatch.progress.failed_indexes, [3]);
  assert.deepEqual(failedBatch.sketches.map(item => item.shot_index), [1, 2, 4], '成功图片必须逐镜立即落盘');

  failThird = false;
  called.length = 0;
  const retried = await storyboardImages.generateSketchBatch(taskId, { confirmed: true }, { mediaAdapter });
  assert.deepEqual(called, [3], '图片重试必须只补缺失镜头');
  assert.equal(retried.sketches.length, 4);
  assert.equal(retried.completed, 1);
}

function testUiContract() {
  const view = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/storyboardView.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../public/story-ad/components/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../public/story-ad/workspace.css'), 'utf8');
  assert(view.indexOf("store.beginStageSubmission('storyboard'") < view.indexOf("store.runStage('storyboard', options)"), '点击后必须立即建立乐观进度');
  assert.match(view, /partial_shots/);
  assert.match(view, /renderSketchResults/);
  assert.match(view, /active_indexes/);
  assert.match(css, /storyboard-checkpoint-preview/);
  assert.match(css, /storyboard-empty-card \.empty-state \{ min-height: 112px/);
  assert.doesNotMatch(ui, /文字分镜生成失败/);
  assert.match(ui, /镜头结构整理中断/);

  const partial = Array.from({ length: 5 }, (_, index) => generatedShot({ beat_index: index + 1 }, index));
  const projected = referenceProjection.storyboardSection({
    reference_video_analysis: {
      analysis_id: 'old-reference', status: 'completed', analysis_quality: { valid: true },
      shot_breakdown: [{ title: '不应覆盖当前断点', visual: '旧参考视频草稿' }],
    },
  }, {
    storyboard_checkpoint: { shots: partial, expected_total: 7, phase: 'chunk_done' },
  }, {
    storyboard_status: { checkpoint_available: true, checkpoint_completed: 5, checkpoint_total: 7 },
  });
  assert.equal(projected.shots.length, 0, '断点不得伪装成正式分镜合同');
  assert.equal(projected.partial_shots.length, 5, '断点镜头必须独立投影给页面');
  assert.equal(projected.reference_draft.length, 0, '旧参考草稿不得遮住当前任务断点');
}

(async () => {
  try {
    await testTextCheckpointConcurrencyAndResume();
    await testImageBatchParallelPersistenceAndRetry();
    testUiContract();
    console.log(JSON.stringify({ passed: true, checks: 28, text_peak_concurrency: 3, image_peak_concurrency: 2, checkpoint_resume_only_missing: true, image_retry_only_missing: true, checkpoint_visible_without_promotion: true, optimistic_progress: true, paid_calls: 0 }));
  } finally {
    try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
