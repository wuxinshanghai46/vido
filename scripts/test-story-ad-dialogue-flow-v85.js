'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');
const storage = require('../src/services/newStoryAd/storageService');

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
assert.equal(state.steps.storyboard.enabled, false, '人物确认只能打开场景，不能提前显示或进入线稿');

state = build({ task: {}, context: { ...brief, asset_setup_confirmed: true, scene_setup_confirmed: true }, outputs: { blueprint, asset_plan: assetPlan, asset_plan_eligibility: eligible } });
assert.equal(state.steps.scene.completed, true, '场景生成并确认后才完成场景步骤');
assert.equal(state.steps.flow.enabled, true, '场景确认后才开放剧情流向确认');
assert.equal(state.steps.storyboard.enabled, false, '剧情流向未确认前不得开放人物场景分镜');
state = build({ task: {}, context: { ...brief, asset_setup_confirmed: true, scene_setup_confirmed: true }, outputs: {
  blueprint, asset_plan: assetPlan, asset_plan_eligibility: eligible,
  story_flow_contract: { status: 'confirmed', model_call_count: 0, units: [{ beat_id: 'beat-1', beat_index: 1, character_ids: [], scene_id: 'factory' }] },
} });
assert.equal(state.steps.storyboard.enabled, true, '确认剧情流向绑定后才开放人物场景分镜');

const briefView = read('public/story-ad/views/briefView.js');
const panel = read('public/story-ad/views/briefDialoguePanel.js');
const plotView = read('public/story-ad/views/plotRoomView.js');
const sceneView = read('public/story-ad/views/sceneWorldPage.js');
assert.match(briefView, /runStage\('blueprint',\s*\{[\s\S]*expected_content_revision:[\s\S]*idempotency_key:[\s\S]*\}\);[\s\S]*view=plot/, 'brief confirmation should submit one versioned idempotent plot generation before navigation');
assert.doesNotMatch(briefView, /createAssetPlanAndRefresh/, 'brief must not create asset plan before plot');
assert.match(panel, /由你发起对话/, 'new dialogue must remain empty until the user initiates it');
assert.match(panel, /data-dialogue-professional>手动编辑<\/button>/, 'compact advanced settings entry must remain available');
assert.match(plotView, /确认(?:剧情)?并进入人物/, 'plot should lead to people');
assert.match(sceneView, /确认场景，进入流向线稿|确认场景，进入剧情流向/, '场景生成完成后必须由顶部确认入口进入剧情流向');
assert.doesNotMatch(sceneView, /进入第 5 步：线稿与分镜/, '页面底部不得提前显示线稿入口');
assert.equal(fs.existsSync(path.join(root, 'public/story-ad/dialogue-demo.html')), false, '旧对话 Demo 入口必须退役，不能与正式立项页并行');
assert.equal(fs.existsSync(path.join(root, 'public/story-ad/dialogue-demo.js')), false, '旧对话 Demo 运行代码必须退出发布闭包');

console.log(JSON.stringify({ passed: true, order: ['brief', 'plot', 'assets', 'scene', 'flow', 'storyboard', 'final'], checks: 24 }));
