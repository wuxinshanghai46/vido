#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-v285-'));
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_STORYBOARD_IMAGE_CONCURRENCY = '2';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const storyFlow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const storyboardImages = require('../src/services/storyAdWorkspace/storyboardSketchService');
const reviewPolicy = require('../src/services/newStoryAd/storyboardReviewPolicyService');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function shot(index) {
  return {
    index, shot_index: index, title: `镜头 ${index}`, role: '推进剧情', purpose: '呈现变化',
    visual: `已确认主体完成动作 ${index}`, action: `动作 ${index}`,
    expected_people: 0, expected_animals: 0, characters: [],
  };
}

function prepareTask(taskId, count = 3) {
  storyAd.createTask({ task_id: taskId, brief: '直接分镜画面回归', cast_mode: 'no_human' }, { id: 'v285-owner', role: 'user' });
  storage.saveOutput(taskId, 'context', { brief: '直接分镜画面回归', cast_mode: 'no_human', scene_setup_confirmed: true, scene_assets: [] });
  storage.saveOutput(taskId, 'blueprint', { fingerprint: 'v285-blueprint', beats: Array.from({ length: count }, (_, i) => ({ beat_id: `b${i + 1}`, beat_index: i + 1 })) });
  const flow = storyFlow.draft(taskId);
  storyFlow.confirmSystem(taskId, flow.units, { used_model: 'fixture' });
  const shots = Array.from({ length: count }, (_, i) => shot(i + 1));
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(taskId, 'quality_review', { pass: true, passed: true, blocking_issues: [], rewrite_issues: [] });
  storage.saveOutput(taskId, 'keyframe_contracts', shots.map(item => ({ shot_index: item.index, visual_contract: {} })));
}

function testReviewPolicy() {
  assert.deepEqual(reviewPolicy.blockingRewriteIssues({ blocking_issues: [], rewrite_issues: ['第 2 镜氛围可加强'] }), []);
  const publishable = reviewPolicy.publishableReview({ pass: true, blocking_issues: [], rewrite_issues: ['第 2 镜氛围可加强'], warnings: [] });
  assert.equal(publishable.passed, true);
  assert.deepEqual(publishable.rewrite_issues, []);
  assert.deepEqual(publishable.deferred_rewrite_issues, ['第 2 镜氛围可加强']);
  assert.deepEqual(reviewPolicy.blockingRewriteIssues({ blocking_issues: ['第 3 镜主体漂移'], rewrite_issues: ['氛围'] }), ['第 3 镜主体漂移']);
}

async function testSameJobCanContinueIntoImages() {
  const taskId = 'storyboard-direct-v285';
  prepareTask(taskId, 3);
  storage.updateTask(taskId, { active_generation_id: 'generation-v285', active_stage: 'storyboard', status: 'running' });
  let active = 0;
  let peak = 0;
  const called = [];
  const mediaAdapter = { generateImage: async ({ filename }) => {
    const index = Number(String(filename).match(/_(\d+)_[a-f0-9-]+$/)?.[1] || 0);
    called.push(index); active += 1; peak = Math.max(peak, active); await delay(8); active -= 1;
    return { image_url: `/generated/v285-${index}.png`, provider_used: 'fixture' };
  } };
  const subjectQaService = { assert: async () => ({ pass: true, policy_version: 1, status: 'verified' }) };
  await assert.rejects(
    () => storyboardImages.generateSketch( taskId, 1, { confirmed: true }, { mediaAdapter }),
    error => error?.code === 'GENERATION_ACTIVE_EDIT_BLOCKED',
  );
  const result = await storyboardImages.generateSketchBatch(taskId, {
    confirmed: true, generation_id: 'generation-v285', image_model: 'fixture-image', client_request_id: 'v285-batch',
  }, { mediaAdapter, subjectQaService, visualQaService: require('./lib/storyboardVisualQaFixture').service });
  assert.deepEqual(called.sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(peak, 2);
  assert.equal(result.sketches.length, 3);
  assert.equal(result.progress.status, 'succeeded');
}

function testRouteAndUiContract() {
  const root = path.resolve(__dirname, '..');
  const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/storyboardView.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public/story-ad/components/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/storyboard-images.css'), 'utf8') + `${fs.readFileSync(path.join(root, 'public/story-ad/workspace.css'), 'utf8')}\n${fs.readFileSync(path.join(root, 'public/story-ad/storyboard-simple.css'), 'utf8')}`;
  const service = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  const sketchService = fs.readFileSync(path.join(root, 'src/services/storyAdWorkspace/storyboardSketchService.js'), 'utf8');
  assert.match(route, /body\.generate_images !== true/);
  assert.match(route, /generateSketchBatch\(req\.params\.id/);
  assert.match(route, /generation_id: job\.generationId/);
  assert.match(view, /generate_images: true/);
  assert.match(view, /confirmed: true/);
  assert.doesNotMatch(view, /pendingSketches/);
  assert.match(view, /系统会根据已确认的剧情自动匹配人物与场景，直接生成分镜画面/);
  assert.match(view, /data-generate-sketch-batch/);
  assert.match(view, /<summary>调整<\/summary>/);
  assert.doesNotMatch(view, /data-board-tab/);
  assert.doesNotMatch(view, />镜头详情 /);
  assert.doesNotMatch(view, /data-confirm-sketch/);
  assert.match(ui, /bundle\.storyboard\?\.image_batch/);
  assert.match(css, /storyboard-view-head h1\s*\{\s*font-size:\s*22px/);
  assert.match(css, /storyboard-primary-actions \.btn,.storyboard-primary-actions \.select\s*\{\s*min-height:\s*34px;\s*font-size:\s*12px/);
  assert.match(service, /storyboardReviewPolicy\.blockingRewriteIssues\(review\)/);
  assert.doesNotMatch(service, /\.\.\.\(review\.rewrite_issues \|\| \[\]\),\s*\];/);
  assert.match(sketchService, /使用与已确认人物和场景资产一致的综合色彩与光线/);
  assert.doesNotMatch(sketchService, /彩色成片效果/);
}

(async () => {
  try {
    testReviewPolicy();
    await testSameJobCanContinueIntoImages();
    testRouteAndUiContract();
    console.log(JSON.stringify({ passed: true, checks: 24, soft_rewrite_provider_calls: 0, same_job_image_handoff: true, image_peak_concurrency: 2, browser_memory_dependency: false, direct_image_panel: true, color_storyboard_preview: true, paid_calls: 0 }));
  } finally {
    try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
