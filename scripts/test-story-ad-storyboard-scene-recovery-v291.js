#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const completion = require('../src/services/newStoryAd/generationSpecCompletionService');
const jsonRepair = require('../src/services/newStoryAd/jsonRepairService');
const projectBundle = require('../src/services/storyAdWorkspace/projectBundleService');
const sceneWorld = require('../src/services/storyAdWorkspace/sceneWorldService');
const coverageLifecycle = require('../src/services/newStoryAd/storyboardCoverageLifecycleService');

function incompleteSceneSpec() {
  return {
    layoutText: '空间布局明确主体展示区、前景、背景、入口、出口、通道、边界与真实纵深位置。',
    materialLightText: '空间使用金属和石材，灰棕配色，窗光与灯光形成明确阴影反射和尺度纹理。',
    interactionText: '人物从入口沿路线移动到互动位置，主机位、反向机位和细节机位连续拍摄。',
    negativeText: '禁止无关人物、文字、水印、结构变形、材质漂移、光向矛盾和不可到达路线。',
    storyStates: [{ id: 'state_1', label: '展示状态' }],
    interactionAnchors: [{ id: 'anchor_1', label: '互动点' }],
    routes: [{ id: 'route_1', label: '行动路线', from: '入口', to: '互动点' }],
    cameraPlan: ['主建立机位', '反向机位', '互动机位', '细节机位'].map((label, index) => ({ id: `camera_${index + 1}`, label })),
  };
}

function testDirectorCoordinatesClosure() {
  const closed = completion.closeSceneSpec(incompleteSceneSpec(), { scene_id: 'scene_a', scene_name: '任意行业场景' }).scene_spec;
  assert.equal(closed.cameraPlan.length, 4);
  assert.deepEqual(closed.cameraPlan[0].normalized_position, [0.12, 0.82]);
  assert.deepEqual(closed.cameraPlan[2].look_at, [0.58, 0.46]);
  assert.deepEqual(closed.interactionAnchors[0].normalized_position, [0.58, 0.46]);
  assert.deepEqual(closed.routes[0].path_points, [[0.12, 0.82], [0.28, 0.7], [0.58, 0.46]]);
  assert.equal(closed.cameraPlan[0].coordinate_source, 'deterministic_director_plan');
}

function testWorkspaceAndWorldProjection() {
  const outputs = {
    scene_config: { spaces: [{ id: 'scene_a', name: '任意行业场景', scene_spec: incompleteSceneSpec() }] },
    scene_assets: [{ scene_id: 'scene_a', name: '任意行业场景', image_url: '/scene.png', scene_contract: { cameras: [
      { id: 'asset_master', view_id: 'master', label: '主建立机位' },
      { id: 'asset_reverse', view_id: 'reverse', label: '反向机位' },
      { id: 'asset_interaction', view_id: 'interaction', label: '互动机位' },
      { id: 'asset_detail', view_id: 'detail', label: '细节机位' },
    ] } }],
  };
  const scenes = projectBundle.sceneAssets(outputs, { content_mode: 'narrative_story' });
  assert.equal(scenes[0].camera_plan.filter(camera => camera.position.length === 2 && camera.look_at.length === 2).length, 4);
  assert.equal(scenes[0].cameras.filter(camera => camera.position.length === 2 && camera.look_at.length === 2).length, 4);
  assert.equal(scenes[0].scene_spec.routes[0].path_points.length, 3);
  const bundle = {
    assets: {
      people: [{ id: 'person_1', name: '人物甲', profile: { displayName: '人物甲' } }],
      scenes,
    },
    brief: { cast_intent: { decision: 'single', status: 'explicit', expected_people: 1 } },
    storyboard: { shots: [] },
  };
  const worlds = sceneWorld.buildSceneWorlds(bundle);
  assert.equal(worlds[0].cameras.filter(camera => camera.pose.planned).length, 4);
  const manifest = sceneWorld.productionManifest(bundle, worlds);
  const cell = manifest.character_world_matrix[0].cells[0];
  assert.deepEqual(cell.blocking_position, [0.58, 0.46]);
  assert.equal(cell.route_points.length, 3);
  assert.equal(cell.camera_id, 'asset_interaction');
}

function testLocalJsonRecovery() {
  const parsed = jsonRepair.parseJson('{"shots":[{"visual":"第一行\n第二行",}],}', 'object');
  assert.equal(parsed.shots[0].visual, '第一行\n第二行');
}

function testCheckpointStoryFlowFreshness() {
  assert.equal(coverageLifecycle.checkpointMatchesStoryFlow({ story_flow_contract_fingerprint: 'flow_a' }, 'flow_a'), true);
  assert.equal(coverageLifecycle.checkpointMatchesStoryFlow({ shots: [{ story_flow_contract_fingerprint: 'flow_a' }] }, 'flow_a'), true);
  assert.equal(coverageLifecycle.checkpointMatchesStoryFlow({ shots: [{ story_flow_contract_fingerprint: 'flow_old' }] }, 'flow_a'), false);
}

function testUiAndBillingContracts() {
  const storyboard = read('public/story-ad/views/storyboardView.js');
  const css = read('public/story-ad/storyboard-simple.css');
  const sceneUi = read('public/story-ad/views/sceneWorldView.js');
  const workspaceCss = read('public/story-ad/workspace.css');
  const job = read('src/services/newStoryAd/jobService.js');
  const units = read('src/services/newStoryAd/generationUnitService.js');
  const service = read('src/services/newStoryAd/storyAdService.js');
  assert.doesNotMatch(storyboard, /aspect-ratio:\$\{Number\(ratio\[1\]\)\} \/ \$\{Number\(ratio\[2\]\)\}/);
  assert.match(css, /storyboard-simple-view \.sketch-tile-media \.media \{[^}]*object-fit:cover/s);
  assert.match(css, /storyboard-scene-sequence ol\{[^}]*flex:1 1 auto/s);
  assert.match(css, /\.sketch-action-bar \{[^}]*padding:6px 10px 8px[^}]*border-top:0/s);
  assert.match(css, /\.sketch-actions \{[^}]*display:grid[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*width:100%/s);
  assert.match(storyboard, /store\.subscribe\?\./);
  assert.match(storyboard, /storyboardActive \|\| \(String\(sketchBatch\?\.status/);
  assert.match(storyboard, /正在整理镜头结构/);
  assert.doesNotMatch(storyboard, /acknowledge_billing_unknown: true/);
  assert.match(storyboard, /user_initiated_direct_generation: true/);
  assert.doesNotMatch(storyboard, /确认可能重复计费|confirmDialog/);
  assert.doesNotMatch(storyboard, /window\.confirm/);
  assert.match(sceneUi, /showNative\('model', 'director'\)/);
  assert.match(sceneUi, /场景实图参考平面 · 可旋转机位规划/);
  assert.match(sceneUi, /data-open-full-director/);
  assert.match(workspaceCss, /\[data-open-full-director\]\{[^}]*min-width:152px[^}]*font-size:12px[^}]*white-space:nowrap/);
  assert.match(job, /acknowledge_billing_unknown: acknowledgeBillingUnknown === true/);
  assert.match(units, /requires_billing_acknowledgement: true/);
  assert.match(service, /checkpointMatchesStoryFlow/);
  assert.match(service, /storyFlowContractFingerprint: storyFlowContract\.contract_fingerprint/);
}

testDirectorCoordinatesClosure();
testWorkspaceAndWorldProjection();
testLocalJsonRecovery();
testCheckpointStoryFlowFreshness();
testUiAndBillingContracts();
console.log(JSON.stringify({ passed: true, checks: 36, paid_model_calls: 0, scene_camera_coordinates: '4/4', person_blocking_coordinates: '1/1', immediate_storyboard_progress: true, billing_confirmation_dialogs: 0, native_browser_dialogs: 0, director_button_min_width: 152 }));
