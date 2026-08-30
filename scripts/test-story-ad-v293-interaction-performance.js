#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const quality = require('../src/services/newStoryAd/qualityReviewService');
const personLooks = require('../src/services/storyAdWorkspace/personLookProjectionService');
const sceneWorlds = require('../src/services/storyAdWorkspace/sceneWorldService');
const directorScenes = require('../src/services/storyAdWorkspace/directorSceneService');
const productionLimits = require('../src/services/newStoryAd/productionLimitsService');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');

const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

const scenes = [
  { id: 'home', name: '现代高端家居展示厅', scene_contract: { zones: [{ label: '沙发休息区' }], anchors: [{ label: '圆形茶几组合' }] } },
  { id: 'booth', name: '高端商业展台', scene_contract: { zones: [{ label: '金属样品陈列台' }], anchors: [{ label: '铂棕纹理展墙' }] } },
];
assert.deepStrictEqual(
  quality.sceneSemanticContaminationIssues(scenes, {
    scene_id: 'booth', visual: '人物自然进入空间，缓慢走向右侧，暖色光线照亮面板并形成细腻颜色。',
  }),
  [],
  'generic verbs, lighting adjectives and generic objects must not trigger a cross-scene rewrite',
);
assert.match(
  quality.sceneSemanticContaminationIssues(scenes, {
    scene_id: 'booth', visual: '镜头明确拍到现代高端家居展示厅的沙发休息区与圆形茶几组合。',
  })[0] || '',
  /混入其他场景独有元素/,
  'a foreign scene name and multiple persisted physical labels must still block publication',
);
assert.strictEqual(productionLimits.requiredStoryboardShotCount(60, 9), 9, 'current story-flow units must determine a new shot count');

const zoneLessScene = { id: 'home', name: '现代高端家居展示厅', scene_revision: 1, scene_contract: { zones: [], anchors: [], cameras: [] } };
const foreignZoneShot = { scene_id: 'home', scene_view: 'detail', scene_zone_id: 'Z2', zone_ids: ['Z2'], scene_zone: '背景展示墙区', scene_zone_label_zh: '背景展示墙区' };
const reboundZoneShot = sceneBinding.bindShotToScene(foreignZoneShot, [zoneLessScene]);
assert.strictEqual(reboundZoneShot.scene_zone_id, undefined, 'a selected scene must not inherit a foreign zone id');
assert.deepStrictEqual(reboundZoneShot.zone_ids, [], 'a scene with no structured zones must publish no machine zone ids');
assert.strictEqual(reboundZoneShot.scene_zone_label_zh, '现代高端家居展示厅主体区域', 'a missing zone authority must use a neutral current-scene label');
assert.deepStrictEqual(sceneBinding.sceneContractForShot({ scene_assets: [zoneLessScene] }, foreignZoneShot).zone_ids, [], 'generation contracts must not reintroduce foreign zone ids');
assert.match(source('src/services/newStoryAd/storyboardCheckpointRecoveryService.js'), /bindShotsToScenes\(checkpointShots, stageCtx\.scene_assets\)/, 'checkpoint recovery must rebind current scene authority before review');

assert.strictEqual(personLooks.personProfile({ id: 'p1', name: '林女士', gender: 'female' }).gender, 'female');
const world = {
  id: 'home', name: '家居厅', revision: 2,
  source_asset: { image_url: '/master.jpg', layout_image_url: '/layout.jpg', source_revision: 2 },
  zones: [{ id: 'z1', bounds: { x: 0, z: 0, width: 6, depth: 4 } }],
  cameras: [{ id: 'c1', name: '主机位', pose: { position: [3, 2, 4], look_at: [0, 1, 0] } }],
};
const bundle = {
  project: { id: 'task-v293' }, revisions: { content: 3 },
  assets: {
    scenes: [], products: [],
    people: [{ subject_id: 'p1', name: '林女士', profile: { id: 'p1', gender: 'female' }, revision: 1 }],
    animals: [{ subject_id: 'cat1', name: '雪球', role: '猫', profile: { species: 'cat' }, revision: 1 }],
  },
  storyboard: { shots: [] },
};
const manifest = sceneWorlds.productionManifest(bundle, [world], {
  assignments: [
    { character_id: 'p1', world_id: 'home', presence: 'confirmed', blocking_position: [.45, .5], entry_point: [.1, .5], route_points: [[.3, .5]] },
    { character_id: 'cat1', world_id: 'home', presence: 'confirmed', blocking_position: [.6, .55], entry_point: [.55, .7], route_points: [[.58, .62]] },
  ],
});
assert.strictEqual(manifest.subject_world_matrix.length, 2, 'people and animals must share the scene subject contract');
const director = directorScenes.defaultState(bundle, world, manifest);
assert.strictEqual(director.entities.find(row => row.entity_id === 'p1').gender, 'female');
assert.strictEqual(director.entities.find(row => row.entity_id === 'cat1').species, 'cat');
assert.strictEqual(director.paths.length, 2, 'persisted subject routes must initialize DirectorScene paths');

const storyboard = source('public/story-ad/views/storyboardView.js');
assert.match(storyboard, /reportedPercent = Number\(progress\.percent\)/, 'authoritative backend percent must drive the progress bar');
assert.match(storyboard, /generationModelPickerPlaceholder/, 'the page must render before the model catalog request completes');
assert.match(storyboard, /确认分镜，进入视频生成/, 'completed storyboards need an explicit next action');
assert.doesNotMatch(storyboard, /现有画面来自旧版人物与场景绑定/, 'internal stale-binding explanations must not be user-visible');
assert.match(source('src/routes/newStoryAd.js'), /user_resume_complete_checkpoint/, 'resume must attempt zero-provider checkpoint publication before queueing work');
assert.match(source('src/services/newStoryAd/storyAdService.js'), /storyFlowContract\.units\?\.length/, 'regeneration must not reuse a stale stored shot count');
assert.match(source('public/story-ad/views/sceneWorldView.js'), /🎥|cameraNode\.lookAt/, 'scene preview must render camera direction semantics');
assert.match(source('public/story-ad/views/directorStudioView.js'), /sceneImages\(world\)/, 'DirectorScene must resolve real layout and master images');
const releaseConfig = JSON.parse(source('config/story-ad-release.json'));
assert.match(source('public/story-ad/release.js'), new RegExp(releaseConfig.build_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the browser release must use the configured immutable build id');

console.log('story-ad v293 interaction/performance regression passed: 25 assertions');
