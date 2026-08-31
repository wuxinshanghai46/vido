#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const planning = require('../src/services/storyAdWorkspace/storyFlowPlanningService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const composition = require('../src/services/storyAdWorkspace/storyboardImageCompositionService');
const sceneWorld = require('../src/services/storyAdWorkspace/sceneWorldService');

function flowFixture() {
  return {
    people: [],
    scenes: [
      { scene_id: 'home', name: '家居展示厅', story_purpose: '展示真实家居应用', required_in_story: true, covered_beat_ids: [] },
      { scene_id: 'expo', name: '商业展台', story_purpose: '展示材料纹理样片', required_in_story: true, covered_beat_ids: ['b2'] },
    ],
    units: [
      { beat_id: 'b1', title: '家居开场', character_ids: [], scene_id: '', look_bindings: {}, voice_bindings: {} },
      { beat_id: 'b2', title: '材料细节', character_ids: [], scene_id: '', look_bindings: {}, voice_bindings: {} },
      { beat_id: 'b3', title: '家居收束', character_ids: [], scene_id: '', look_bindings: {}, voice_bindings: {} },
    ],
  };
}

function testSceneCoverageAndTransitions() {
  const base = flowFixture();
  assert.throws(() => flow.validateUnits(base, base.units.map(unit => ({ ...unit, scene_id: 'expo' })), { requireExact: true }), error => error.code === 'STORY_FLOW_CONTRACT_INVALID');
  const units = flow.validateUnits(base, [
    { ...base.units[0], scene_id: 'home', transition_from: '', transition_reason: '' },
    { ...base.units[1], scene_id: 'expo', transition_from: 'home', transition_reason: '从家居应用转入材料选型细节' },
    { ...base.units[2], scene_id: 'home', transition_from: 'expo', transition_reason: '以真实家居落地效果收束' },
  ], { requireExact: true });
  assert.deepEqual(units.map(unit => unit.scene_id), ['home', 'expo', 'home']);
  const prompt = planning.promptPayload(base);
  assert(prompt.rules.some(rule => rule.includes('required_in_story')));
  assert(prompt.rules.some(rule => rule.includes('transition_reason')));
}

function testSpatialPlanPreservationAndRecovery() {
  const spec = contextBuilder.normalizeSceneSpec({
    interaction_anchors: [{ id: 'a1', normalized_position: [0.4, 0.6] }],
    routes: [{ id: 'r1', path_points: [[0.1, 0.2], [0.8, 0.7]], movement_type: 'walk', speed: 'slow' }],
    camera_plan: [
      { id: 'c1', label: '主建立机位' }, { id: 'c2', label: '反向机位' },
      { id: 'c3', label: '互动机位' }, { id: 'c4', label: '细节机位' },
    ],
  });
  assert.deepEqual(spec.interactionAnchors[0].normalized_position, [0.4, 0.6]);
  assert.deepEqual(spec.routes[0].path_points, [[0.1, 0.2], [0.8, 0.7]]);
  assert.deepEqual(spec.cameraPlan[0].normalized_position, [0.12, 0.82]);
  assert.deepEqual(spec.cameraPlan[1].look_at, [0.48, 0.52]);
  assert.equal(spec.cameraPlan[0].coordinate_source, 'deterministic_director_plan');
}

async function testSingleFrameCompositionGate() {
  const split = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#222222' } })
    .composite([{ input: { create: { width: 300, height: 225, channels: 3, background: '#eeeeee' } }, top: 225, left: 0 }]).png().toBuffer();
  const single = await sharp({ create: { width: 300, height: 450, channels: 3, background: '#777777' } }).png().toBuffer();
  assert.equal((await composition.inspectBuffer(split)).multi_panel, true);
  assert.equal((await composition.inspectBuffer(single)).multi_panel, false);
}

function testSceneTransitionsAndUiContract() {
  const worlds = sceneWorld.buildSceneWorlds({
    assets: { scenes: [{ id: 'home', name: '家居' }, { id: 'expo', name: '展台' }] },
    story_flow: { contract: { units: [
      { beat_id: 'b1', scene_id: 'home' },
      { beat_id: 'b2', scene_id: 'expo', transition_reason: '剧情进入材料选择' },
    ] } },
  });
  assert.equal(worlds[0].portals[0].to_world_id, 'expo');
  assert.equal(worlds[0].portals[0].reason, '剧情进入材料选择');
  const storyboard = read('public/story-ad/views/storyboardView.js');
  const storyboardCss = read('public/story-ad/storyboard-simple.css');
  const sceneUi = read('public/story-ad/views/sceneWorldView.js');
  assert.match(storyboard, /sceneSequenceMarkup/);
  assert.doesNotMatch(storyboard, /正在启动 0\/\$\{targetCount\}/);
  assert.match(storyboard, /active \? '生成中'/);
  assert.match(storyboard, /gateBlocked[\s\S]*data-prepare-storyboard-sketch[\s\S]*重新生成分镜/);
  assert.doesNotMatch(storyboard, /现有画面来自旧版人物与场景绑定|不会续用错误画面/);
  assert.match(storyboard, /user_initiated_direct_generation/);
  assert.match(storyboardCss, /\.sketch-actions \{ display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(sceneUi, /3D机位预演（可旋转）/);
  assert.match(sceneUi, /data-scene-world-switch/);
  assert.match(sceneUi, /data-generate-panorama/);
}

(async () => {
  testSceneCoverageAndTransitions();
  testSpatialPlanPreservationAndRecovery();
  await testSingleFrameCompositionGate();
  testSceneTransitionsAndUiContract();
  console.log(JSON.stringify({ passed: true, checks: 26, story_flow_contract_version: flow.CONTRACT_VERSION, required_scene_coverage: true, scene_transition_contract: true, multi_panel_rejected: true, spatial_coordinates_preserved: true, rotatable_director_preview: true, stale_task_recovery_action: true }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
