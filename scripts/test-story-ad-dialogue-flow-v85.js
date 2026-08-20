'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const clean = value => String(value || '').trim();
const list = value => Array.isArray(value) ? value : [];
const build = payload => navigation.build({ ...payload, clean, list });

const brief = { project_name: '佛山智造', brief: '一条30秒不锈钢品牌广告' };
let state = build({ task: { title: brief.project_name }, context: brief, outputs: {} });
assert.equal(state.steps.plot.enabled, true, 'confirmed brief should open plot');
assert.equal(state.steps.assets.enabled, false, 'assets must remain closed before plot');

const blueprint = { beats: [{ id: 'beat-1', dialogue: '经得起时间，才是真正的品质。' }] };
state = build({ task: {}, context: brief, outputs: { blueprint } });
assert.equal(state.steps.assets.enabled, true, 'plot should open assets');
assert.equal(state.steps.assets.completed, false, 'asset step must wait for explicit confirmation');
assert.equal(state.steps.scene.enabled, false, 'scene must not bypass unconfirmed assets');

const assetPlan = { cast_profiles: [], scene_plan: { spaces: [{ id: 'factory' }] } };
const eligible = { eligible: true };
state = build({ task: {}, context: brief, outputs: { blueprint, asset_plan: assetPlan, asset_plan_eligibility: eligible } });
assert.equal(state.steps.assets.completed, false, 'generated plan alone is not user confirmation');
assert.equal(state.steps.scene.enabled, false, 'generated plan alone must not open scene');

state = build({ task: {}, context: { ...brief, asset_setup_confirmed: true }, outputs: { blueprint, asset_plan: assetPlan, asset_plan_eligibility: eligible } });
assert.equal(state.steps.assets.completed, true, 'confirmed assets complete asset step');
assert.equal(state.steps.scene.enabled, true, 'confirmed assets open scene');
assert.equal(state.steps.storyboard.enabled, true, 'confirmed assets and plot open storyboard');

const briefView = read('public/story-ad/views/briefView.js');
const panel = read('public/story-ad/views/briefDialoguePanel.js');
const plotView = read('public/story-ad/views/plotRoomView.js');
const sceneView = read('public/story-ad/views/sceneWorldPage.js');
const demoHtml = read('public/story-ad/dialogue-demo.html');
assert.match(briefView, /runStage\('blueprint',\s*\{[\s\S]*expected_content_revision:[\s\S]*idempotency_key:[\s\S]*\}\);[\s\S]*view=plot/, 'brief confirmation should submit one versioned idempotent plot generation before navigation');
assert.doesNotMatch(briefView, /createAssetPlanAndRefresh/, 'brief must not create asset plan before plot');
assert.match(panel, /对话内容会自动同步到这里/, 'dialogue must explain automatic contract fill');
assert.match(panel, /手动编辑全部设置/, 'advanced settings must remain available');
assert.match(plotView, /确认剧情，进入人物/, 'plot should lead to people');
assert.match(sceneView, /进入第 5 步：线稿与分镜/, 'scene should lead to storyboard');
assert.match(demoHtml, /\/js\/media-delivery\.js\?v=20260729-platform-media-v5/, 'standalone demo must load platform media delivery');

console.log(JSON.stringify({ passed: true, order: ['brief', 'plot', 'assets', 'scene', 'storyboard', 'final'], checks: 16 }));
