#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-seven-step-v279-'));
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const flow = require('../src/services/storyAdWorkspace/storyFlowSketchService');
const flowGate = require('../src/services/storyAdWorkspace/storyFlowSketchGateService');
const storyboardImages = require('../src/services/storyAdWorkspace/storyboardSketchService');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');
const pipeline = require('../src/services/pipelineModelService');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function createFixture(id) {
  const owner = { id: 'seven-step-owner', role: 'user' };
  const created = storyAd.createTask({ task_id: id, content_mode: 'narrative_story', content_mode_source: 'user', project_name: '七步流程测试', brief: '人物完成一次有起因、发展和结果的空间行动。', cast_mode: 'single', scene_mode: 'single', client_edit_seq: 1 }, owner);
  const blueprint = {
    story_title: '七步流程', logline: '人物进入空间、完成任务并离开。', revision: 1,
    beats: [1, 2, 3].map(index => ({ index, beat_index: index, title: `节点 ${index}`, plot: `剧情事件 ${index}`, action: `动作 ${index}`, state_before: `状态 ${index - 1}`, state_after: `状态 ${index}` })),
  };
  blueprint.fingerprint = storage.canonicalFingerprint(blueprint);
  storage.saveOutput(id, 'blueprint', blueprint);
  const context = { ...(storage.getOutput(id, 'context') || created.context || {}), scene_setup_confirmed: true, output_ratio: '16:9' };
  storage.saveOutput(id, 'context', context);
  storage.saveOutput(id, 'scene_assets', [{
    id: 'scene-a',
    scene_id: 'scene-a',
    name: '测试场景',
    image_url: '/fixtures/scene-a.png',
    view_images: [{ key: 'master', image_url: '/fixtures/scene-a.png' }],
  }]);
  storage.updateTask(id, { request: context });
  return { owner, task: storage.getTask(id), blueprint, context };
}

async function waitFlow(id) {
  for (let index = 0; index < 100; index += 1) {
    const state = flow.getBatch(id);
    if (['succeeded', 'failed'].includes(String(state.progress?.status || ''))) return state;
    await delay(10);
  }
  throw new Error('流向线稿批次未在测试时间内结束');
}

async function verifySevenStepContract() {
  const fixture = createFixture('seven-step-contract');
  assert.throws(() => flowGate.assertReady(fixture.task.id), error => error.code === 'STORY_FLOW_SKETCH_CONFIRMATION_REQUIRED');
  let active = 0; let maxActive = 0; let calls = 0;
  const mediaAdapter = { async generateImage({ shotIndex }) {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active); await delay([10, 45, 80][shotIndex] || 25); active -= 1;
    return { image_url: `/flow-${shotIndex + 1}.png`, provider_used: 'mock/image' };
  } };
  const started = flow.startBatch(fixture.task.id, { confirmed: true, image_model: 'mock/image', client_request_id: 'flow-batch' }, { mediaAdapter });
  assert.equal(started.accepted, true);
  await delay(28);
  const midProgress = flow.getBatch(fixture.task.id).progress;
  assert(midProgress.completed >= 1 && midProgress.completed < 3, '每张流向线稿完成时必须立即推进进度，不能等全部结束才跳到 100%');
  assert(midProgress.percent > 0 && midProgress.percent < 100);
  const finished = await waitFlow(fixture.task.id);
  assert.equal(finished.progress.status, 'succeeded');
  assert.equal(finished.sketches.length, 3);
  assert.equal(calls, 3);
  assert.equal(maxActive, 3, '全部剧情节点必须并行开始，不得串行等待');
  assert.equal(flowGate.inspect(fixture.task.id).ready, false, '生成完成不能冒充用户确认');
  const confirmed = flow.confirmAll(fixture.task.id);
  assert.equal(confirmed.gate.ready, true);
  assert.equal(confirmed.model_call_count, 0);

  const shots = [1, 2, 3].map(index => ({ index, shot_index: index, title: `分镜 ${index}`, visual: `人物位于场景中完成动作 ${index}`, action: `动作 ${index}`, scene_id: 'scene-a', characters: [{ id: 'person-a', name: '人物甲' }], shot_size: 'medium', camera_angle: 'eye_level', camera_movement: 'static' }));
  storyAd.updateStoryboardTable(fixture.task.id, shots, fixture.owner);
  assert.equal(flowGate.inspect(fixture.task.id).ready, true,
    '下游分镜保存导致的任务版本变化不得反向作废同一剧情蓝图的流向线稿确认');

  storage.saveOutput(fixture.task.id, 'storyboard_meta', { status: 'ready' });
  storage.saveOutput(fixture.task.id, 'quality_review', { passed: true, blocking_issues: [], rewrite_issues: [] });
  storage.saveOutput(fixture.task.id, 'keyframe_contracts', shots.map(shot => ({ shot_index: shot.shot_index })));
  active = 0; maxActive = 0; calls = 0;
  const storyboardMedia = { async generateImage({ shotIndex }) {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active); await delay(25); active -= 1;
    return { image_url: `/storyboard-${shotIndex + 1}.png`, provider_used: 'mock/image' };
  } };
  const result = await storyboardImages.generateSketchBatch(fixture.task.id, { confirmed: true, image_model: 'mock/image', client_request_id: 'storyboard-batch' }, { mediaAdapter: storyboardMedia });
  assert.equal(result.completed, 3);
  assert.equal(storage.getOutput(fixture.task.id, 'storyboard_images').length, 3);
  assert.equal(storage.getOutput(fixture.task.id, 'storyboard_sketches'), null, '新合同不得写入旧合并产物');
  assert.equal(calls, 3);
  assert.equal(maxActive, 3, '人物场景分镜图也必须逐镜并行生成');
  const outputs = Object.fromEntries(storage.listOutputs(fixture.task.id).map(row => [row.kind, row.payload]));
  const nav = navigation.build({ task: storage.getTask(fixture.task.id), context: fixture.context, outputs, counts: {}, clean: value => String(value || '').trim(), list: value => Array.isArray(value) ? value : [] });
  assert.equal(nav.steps.flow.completed, true);
  assert.equal(nav.steps.storyboard.enabled, true);
  assert.equal(nav.steps.final.enabled, false);
}

function verifyStaticContract() {
  const app = read('public/story-ad/app.js');
  const flowView = read('public/story-ad/views/storyFlowSketchView.js');
  const storyboardView = read('public/story-ad/views/storyboardView.js');
  const routes = read('src/routes/storyAdWorkspace.js');
  const storyService = read('src/services/newStoryAd/storyAdService.js');
  assert.match(app, /\['brief', 'plot', 'assets', 'scene', 'flow', 'storyboard', 'final', 'workflow'\]/);
  assert.match(app, /flow:\s*\['5', '流向线稿'\]/);
  assert.match(app, /storyboard:\s*\['6', '人物场景分镜'\]/);
  assert.match(app, /final:\s*\['7', '镜头与合成'\]/);
  assert.match(flowView, /剧情流向线稿/);
  assert.match(flowView, /确认全部流向线稿/);
  assert.match(flowView, /elapsedTimeTag/);
  assert.match(storyboardView, /消费已确认的剧情流向线稿/);
  assert.match(storyboardView, /生成人物场景分镜图/);
  assert.match(storyboardView, /elapsedTimeTag/);
  assert.doesNotMatch(storyboardView, /生成分镜线稿图/);
  assert.match(storyService, /storyFlowSketchGate\.assertReady\(taskId\)/);
  assert.match(routes, /LEGACY_STORYBOARD_SKETCH_ROUTE_DISABLED/);
  assert.match(routes, /storyboard-images/);
  assert.match(routes, /flow-sketches/);
  assert(pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS.has('new_story_ad.story_flow_sketch'));
  assert(pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS.has('new_story_ad.storyboard_image'));
  assert(!pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS.has('new_story_ad.storyboard_sketch'));
}

verifyStaticContract();
verifySevenStepContract().then(() => console.log(JSON.stringify({ passed: true, checks: 33, workflow_steps: 7, flow_and_storyboard_split: true, flow_parallel: true, incremental_progress: true, elapsed_time_visible: true, storyboard_parallel: true, legacy_route_disabled: true, model_calls: 0 }))).catch(error => { console.error(error); process.exitCode = 1; });
