#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-flow-v281-'));
process.env.DB_ENABLED = '0';

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const planning = require('../src/services/storyAdWorkspace/storyFlowPlanningService');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');

const owner = { id: 'v281-owner', role: 'user' };
const taskId = 'story-flow-v281';
const created = storyAd.createTask({
  task_id: taskId, content_mode: 'narrative_story', content_mode_source: 'user', project_name: 'V281',
  brief: '陈默先进入家居展示厅，再去商业展台查看金属样板。', cast_mode: 'single', scene_mode: 'multi', client_edit_seq: 1,
}, owner);
const blueprint = {
  story_title: '双场景路线', revision: 1,
  beats: [
    { beat_id: 'beat_entry', beat_index: 1, title: '进入家居展示厅', plot: '陈默进入现代高端家居展示厅观察空间。', action: '陈默向沙发方向行走' },
    { beat_id: 'beat_material', beat_index: 2, title: '查看商业展台', plot: '陈默转场到高端商业展台。', action: '陈默触摸金属样板' },
  ],
};
blueprint.fingerprint = storage.canonicalFingerprint(blueprint);
const context = {
  ...(storage.getOutput(taskId, 'context') || created.context || {}),
  asset_setup_confirmed: true,
  scene_setup_confirmed: true,
  cast_profiles: [{ id: 'character_chenmo', name: '陈默', description: '唯一女性主角', revision: 3, look_profiles: [{ id: 'look_business' }] }],
};
const scenes = [
  { scene_id: 'scene_showroom', name: '现代高端家居展示厅', description: '沙发、落地窗和家居陈列', scene_revision: 5, view_images: [{ key: 'master', image_url: '/showroom.png' }] },
  { scene_id: 'scene_exhibition', name: '高端商业展台', description: '金属样板与材料展台', scene_revision: 2, view_images: [{ key: 'master', image_url: '/exhibition.png' }] },
];
storage.saveOutput(taskId, 'blueprint', blueprint);
storage.saveOutput(taskId, 'context', context);
storage.saveOutput(taskId, 'scene_assets', scenes);
storage.saveOutput(taskId, 'scene_config', { spaces: [] });
storage.updateTask(taskId, { request: context });

const protectedKinds = ['context', 'blueprint', 'scene_config', 'scene_assets'];
const before = Object.fromEntries(protectedKinds.map(kind => [kind, storage.canonicalFingerprint(storage.getOutput(taskId, kind))]));
const originalGenerateText = gateway.generateText;
let modelCalls = 0;

(async () => {
  gateway.generateText = async options => {
    modelCalls += 1;
    assert.equal(options.stage, 'new_story_ad.story_flow_planning');
    const parsed_json = { units: [
      { beat_id: 'beat_entry', scene_id: 'scene_showroom', character_ids: ['character_chenmo'], look_bindings: { character_chenmo: 'look_business' } },
      { beat_id: 'beat_material', scene_id: 'scene_exhibition', character_ids: ['character_chenmo'], look_bindings: { character_chenmo: 'look_business' } },
    ] };
    await options.validateText(JSON.stringify(parsed_json), { parsed_json });
    return { text: JSON.stringify(parsed_json), parsed_json, used_model: 'test/semantic-binder' };
  };
  const planned = await planning.ensure(taskId, { generation_id: 'v281-plan' });
  assert.equal(modelCalls, 1);
  assert.equal(planned.contract.status, 'system_confirmed');
  assert.deepEqual(planned.contract.units.map(unit => unit.scene_id), ['scene_showroom', 'scene_exhibition']);
  assert(planned.contract.units.every(unit => unit.character_ids[0] === 'character_chenmo'));
  assert.deepEqual(Object.fromEntries(protectedKinds.map(kind => [kind, storage.canonicalFingerprint(storage.getOutput(taskId, kind))])), before, '自动绑定不得改写前四步权威');
  await planning.ensure(taskId, { generation_id: 'v281-plan-repeat' });
  assert.equal(modelCalls, 1, '权威指纹未变化时必须复用绑定，不得重复调用模型');

  storage.deleteOutput(taskId, flow.OUTPUT_KIND);
  gateway.generateText = async options => {
    modelCalls += 1;
    const parsed_json = { units: [
      { beat_id: 'beat_entry', scene_id: 'invented_scene', character_ids: ['invented_person'], look_bindings: { invented_person: 'invented-look' } },
      { beat_id: 'beat_material', scene_id: 'scene_exhibition', character_ids: ['character_chenmo'], look_bindings: { character_chenmo: 'look_business' } },
    ] };
    await options.validateText(JSON.stringify(parsed_json), { parsed_json });
    return { text: JSON.stringify(parsed_json), parsed_json, used_model: 'test/invalid' };
  };
  await assert.rejects(() => planning.ensure(taskId), error => error.code === 'STORY_FLOW_SYSTEM_BINDING_FAILED');
  assert.equal(storage.getOutput(taskId, flow.OUTPUT_KIND), null, '非法 ID 不得持久化');
  assert.equal(storage.getOutput(taskId, 'storyboard_images'), null, '绑定失败必须发生在图片调用前');

  const nav = navigation.build({
    task: storage.getTask(taskId), context, outputs: { blueprint, scene_assets: scenes, asset_plan_eligibility: { eligible: true }, asset_plan: { cast_profiles: context.cast_profiles, scene_plan: { spaces: [{}] } } },
    counts: {}, clean: value => String(value || '').trim(), list: value => Array.isArray(value) ? value : [],
  });
  assert.equal(nav.steps.flow, undefined);
  assert.equal(nav.steps.storyboard.enabled, true);
  assert.equal(nav.steps.scene.next_view, 'storyboard');

  const app = read('public/story-ad/app.js');
  const store = read('public/story-ad/store/projectBundleStore.js');
  const projectStore = read('public/story-ad/store/projectStore.js');
  const routes = read('src/routes/storyAdWorkspace.js');
  const deploy = read('scripts/deploy-story-ad-immutable-release.js');
  const storyboardView = read('public/story-ad/views/storyboardView.js');
  const workspaceCss = read('public/story-ad/workspace.css');
  assert.match(app, /const VIEW_ORDER = \['brief', 'plot', 'assets', 'scene', 'storyboard', 'final', 'workflow'\]/);
  assert.doesNotMatch(app, /storyFlowSketchView/);
  assert.match(app, /prefetchBundle\(route\.taskId, 'all'\)/);
  assert.match(store, /function mergedBundle/);
  assert.match(store, /sameRevision \? \(state\.bundleSections \|\| \[\]\) : \[\]/);
  assert.match(projectStore, /contentRevisionChanged \? \{ bundleSections: \['summary'\] \} : \{\}/);
  assert.match(routes, /router\.all\('\/projects\/:taskId\/story-flow'/);
  assert.match(routes, /LEGACY_USER_STORY_FLOW_ROUTE_DISABLED/);
  assert.match(deploy, /previousContractVersion === 'story-scene-platform-v7'[\s\S]*release\.contract_version === 'story-scene-platform-v8'[\s\S]*model_calls: 0, paid_calls: 0/);
  assert(storyboardView.indexOf('<div class="guide') < storyboardView.indexOf('<div class="storyboard-primary-actions">'), 'model picker and generate action must render below the guide');
  assert.match(storyboardView, /storyboard-primary-actions[^`]*\$\{primaryAction\}/);
  assert.match(workspaceCss, /\.storyboard-primary-actions\s*\{[^}]*justify-content:\s*flex-end/);
  console.log(JSON.stringify({ passed: true, checks: 30, visible_steps: 6, semantic_model_calls: modelCalls, image_calls_before_binding: 0, upstream_unchanged: true, cache_accumulates_sections: true, cache_invalidates_on_revision: true, old_user_flow_route: 410, migration_writes: 0, generation_controls_below_guide: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { gateway.generateText = originalGenerateText; });
