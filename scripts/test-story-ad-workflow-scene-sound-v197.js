'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lineage = require('../src/services/newStoryAd/sceneLineageContractService');
const sceneWorld = require('../src/services/storyAdWorkspace/sceneWorldService');

const modern = lineage.modernRebuiltBambooForest();
assert.equal(modern.continuity_type, 'same_rebuilt');
assert(modern.preserved_anchors.includes('竹林地貌'));
assert(modern.rebuilt_elements.some(item => item.includes('现代新建竹林')));
assert(modern.forbidden_elements.includes('城市主干道'));
assert(modern.forbidden_elements.includes('摩天楼'));

const bundle = { project: { id: 't1' }, revisions: { content: 1 }, assets: {
  people: [{ id: 'p1', name: '沈砚辞', profile: { id: 'p1', displayName: '沈砚辞', age_states: [{ id: 'young' }], look_profiles: [{ id: 'modern', story_state: '现代', scene_ids: ['modern_bamboo'] }] } }],
  scenes: [{ id: 'modern_bamboo', name: '现代重建竹林', description: '沈砚辞沿现代新建林间道路回到竹海旧址', story_purpose: '重逢', place_lineage: modern }],
}, storyboard: { shots: [] }, asset_editor: { scene_plan: { spaces: [] } } };
const worlds = sceneWorld.buildSceneWorlds(bundle, {});
assert.equal(worlds.length, 1, '文字场景未生成图片前也必须进入场景世界');
assert.equal(worlds[0].visual_authority_ready, false);
const manifest = sceneWorld.productionManifest(bundle, worlds, {});
assert.equal(manifest.character_world_matrix[0].cells[0].presence, 'suggested');
assert.equal(manifest.character_world_matrix[0].cells[0].look_id, 'modern');

const app = fs.readFileSync(path.join(__dirname, '../public/story-ad/app.js'), 'utf8');
const matrix = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/sceneWorldView.js'), 'utf8');
const finalView = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/finalView.js'), 'utf8');
assert(app.includes("['brief', 'assets', 'scene', 'plot', 'storyboard', 'final', 'workflow']"));
assert(app.includes("scene: ['3', '场景世界']"));
assert(app.includes("plot: ['4', '剧本']"));
assert(app.includes("storyboard: ['5', '分镜与线稿']"));
assert(app.includes("final: ['6', '镜头、声音与成片']"));
assert(matrix.includes('data-world-assignment-order'));
assert(matrix.includes('data-world-assignment-camera'));
assert(finalView.includes('场景声音设计'));
console.log('story-ad six-step workflow, scene planning and sound projection: ok');
