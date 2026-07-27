#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-scene-authority-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');

const owner = { id: 'scene-authority-owner', role: 'user' };

function sceneSpec(label) {
  return {
    layoutText: `${label}空间采用连续、可复核的平面布局`,
    materialLightText: `${label}空间使用自然材质与稳定日光`,
    interactionText: `${label}空间允许人物按既定动线完成互动`,
    negativeText: `${label}空间禁止结构漂移、镜像和额外主体`,
  };
}

function scenePlan(secondLabel = '城市公园草坪') {
  return {
    scene_mode: 'multi',
    spaces: [
      {
        id: 'home_space',
        name: '现代家庭空间',
        description: '开放式客餐厨一体空间',
        story_purpose: '承载家庭生活段落',
        scene_spec: sceneSpec('家庭'),
      },
      {
        id: 'park_space',
        name: secondLabel,
        description: secondLabel === '城市公园草坪'
          ? '城市公园中央的开阔草坪'
          : '城市公园中央新增林荫步道的草坪',
        story_purpose: '承载户外活动段落',
        scene_spec: sceneSpec(secondLabel === '城市公园草坪' ? '公园' : '林荫公园'),
      },
    ],
  };
}

function verifiedSceneAsset(sceneId, revision = 1) {
  const viewKeys = ['master', 'reverse', 'interaction', 'detail', 'layout'];
  return {
    id: sceneId,
    scene_id: sceneId,
    space_id: sceneId,
    name: sceneId === 'home_space' ? '现代家庭空间' : '城市公园草坪',
    scene_revision: revision,
    generation_contract_version: 7,
    image_url: `/${sceneId}/master.png`,
    view_images: viewKeys.map(key => ({
      key,
      url: `/${sceneId}/${key}.png`,
      image_url: `/${sceneId}/${key}.png`,
    })),
    scene_contract: {
      schema_version: 7,
      status: 'verified',
      scene_revision: revision,
      requirement_qa: { pass: true },
      photographic_realism_qa: { pass: true },
      camera_design_qa: { pass: true },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true, coverage_status: 'complete' },
      layout_contract: { status: 'available' },
    },
  };
}

function createLockedTask(suffix) {
  const plan = scenePlan();
  const assets = [
    verifiedSceneAsset('home_space', 4),
    verifiedSceneAsset('park_space', 3),
  ];
  const created = service.createTask({
    task_id: `scene-authority-${suffix}`,
    brief: '制作一支包含家庭与城市公园两个独立空间的品牌广告',
    product_subject: '测试品牌产品',
    cast_mode: 'no_human',
    scene_mode: 'multi',
    scene_spec: plan.spaces[0].scene_spec,
    scene_assets: assets,
    client_edit_seq: 1,
  }, owner);
  storage.saveOutput(created.task.id, 'scene_config', plan);
  storage.saveOutput(created.task.id, 'scene_assets', assets);
  return { taskId: created.task.id, plan, assets };
}

function partialCheckpoint(taskId, sceneId) {
  storage.saveOutput(taskId, `scene_asset_checkpoint:${sceneId}`, {
    task_id: taskId,
    scene_id: sceneId,
    status: 'partial',
    metadata: { space_id: sceneId, generation_contract_version: 7 },
    views: {
      master: {
        key: 'master',
        status: 'succeeded',
        url: `/historical/${sceneId}/master.png`,
      },
    },
  });
}

function assertSceneAssetIds(actual, expected, message) {
  assert.deepStrictEqual(
    (Array.isArray(actual) ? actual : []).map(asset => asset.scene_id || asset.space_id || asset.id),
    expected,
    message,
  );
}

function testActiveSceneSpecIsUiState() {
  const { taskId, plan, assets } = createLockedTask('active-tab');
  const beforeConfig = storage.getOutput(taskId, 'scene_config');
  const beforeAssets = storage.getOutput(taskId, 'scene_assets');

  const saved = service.updateTaskRequest(taskId, {
    scene_spec: plan.spaces[1].scene_spec,
    save_progress: true,
    change_scope: 'none',
    changed_domains: [],
    base_content_revision: 1,
    client_edit_seq: 2,
  }, owner);

  assert.deepStrictEqual(saved.changed_domains, [],
    '只切换活动场景 scene_spec 属于 UI 状态，不得形成内容域变更');
  assert.equal(saved.content_revision, 1, '只切换活动场景不得递增内容版本');
  assert.deepStrictEqual(storage.getOutput(taskId, 'scene_config'), beforeConfig,
    '普通保存不得删除或重写权威 scene_config');
  assert.deepStrictEqual(storage.getOutput(taskId, 'scene_assets'), beforeAssets,
    '普通保存不得失效已验证的 scene_assets');

  const prepared = service.prepareGeneration(taskId, {
    expected_content_revision: 1,
    client_edit_seq: 2,
    target_stage: 'script_package',
  }, owner);
  assert.equal(prepared.preflight.ready, true,
    '双场景合同和资产均有效时 script_package prepare 必须成功');
  assert.equal(prepared.preflight.model_calls_started, 0);
  assert.equal(prepared.preflight.scene_count, assets.length);

  const refreshed = service.publicTaskBundle(taskId);
  assertSceneAssetIds(refreshed.outputs.scene_assets, ['home_space', 'park_space'],
    '刷新任务后仍必须返回两个当前场景资产');

  const repeated = service.updateTaskRequest(taskId, {
    scene_spec: plan.spaces[0].scene_spec,
    save_progress: true,
    change_scope: 'none',
    changed_domains: [],
    base_content_revision: 1,
    client_edit_seq: 3,
  }, owner);
  assert.equal(repeated.content_revision, 1, '重复普通保存不得制造新版本');
  assert.equal(repeated.acknowledged_client_edit_seq, 3);
  assertSceneAssetIds(storage.getOutput(taskId, 'scene_assets'), ['home_space', 'park_space'],
    '重复保存不得损坏场景资产');

  const currentContext = storage.getOutput(taskId, 'context');
  assert.throws(
    () => service.updateTaskRequest(taskId, {
      controlled_production: {
        ...currentContext.controlled_production,
        environment_control: {
          ...currentContext.controlled_production.environment_control,
          custom: '未经完整计划提交的真实场景修改',
        },
      },
      save_progress: true,
      change_scope: 'none',
      changed_domains: [],
      base_content_revision: 1,
      client_edit_seq: 4,
    }, owner),
    error => error?.code === 'SCENE_PLAN_REQUIRED_FOR_SCENE_SAVE',
    '已有权威计划时，任何真实场景域变更都必须携带完整 scene_plan',
  );
  assert.equal(storage.getTask(taskId).content_revision, 1, '缺少完整计划的场景修改必须在写入前停止');
  assertSceneAssetIds(storage.getOutput(taskId, 'scene_assets'), ['home_space', 'park_space'],
    '被拒绝的部分场景修改不得失效当前资产');

  const lateSave = service.updateTaskRequest(taskId, {
    scene_spec: plan.spaces[1].scene_spec,
    save_progress: true,
    change_scope: 'none',
    changed_domains: [],
    base_content_revision: 1,
    client_edit_seq: 2,
  }, owner);
  assert.equal(lateSave.acknowledged_client_edit_seq, 3,
    '乱序到达的较旧编辑序号不得让服务端确认序号倒退');
  assert.throws(
    () => service.prepareGeneration(taskId, {
      expected_content_revision: 1,
      client_edit_seq: 2,
      target_stage: 'script_package',
    }, owner),
    error => error?.code === 'UNSAVED_CLIENT_EDITS',
    'prepare 必须拒绝落后于服务端确认值的编辑序号',
  );
}

function testInvalidatedHistoryCannotBecomeCurrentUiAssets() {
  const { taskId, plan } = createLockedTask('historical-projection');
  storage.deleteOutput(taskId, 'scene_config');
  storage.deleteOutput(taskId, 'scene_assets');
  partialCheckpoint(taskId, 'home_space');

  const manifest = storage.getManifest(taskId);
  assert(Object.prototype.hasOwnProperty.call(manifest.invalidated || {}, 'scene_config'));
  assert(Object.prototype.hasOwnProperty.call(manifest.invalidated || {}, 'scene_assets'));

  const projected = service.publicTaskBundle(taskId);
  assert.equal(projected.outputs.scene_config, undefined,
    '失效后的历史 scene_config 不得重新出现在当前任务投影');
  assert.equal(projected.outputs.scene_assets, undefined,
    '只有 context/checkpoint 历史记录时不得展示为当前锁定场景资产');

  service.updateTaskRequest(taskId, {
    scene_plan: plan,
    save_progress: true,
    change_scope: 'scene',
    changed_domains: ['scene'],
    base_content_revision: 1,
    client_edit_seq: 2,
  }, owner);
  assert.equal(storage.getOutput(taskId, 'scene_assets'), null,
    '重新发布场景计划时不得把已失效的 context.scene_assets 提升为当前资产');
  assert.equal(service.publicTaskBundle(taskId).outputs.scene_assets, undefined,
    '重新发布计划后仍应要求重新锁定场景，不得显示历史资产');
}

function testRealScenePlanChangeInvalidatesOnlyChangedStableScene() {
  const { taskId } = createLockedTask('partial-invalidation');
  const updatedPlan = scenePlan('城市公园林荫草坪');

  const saved = service.updateTaskRequest(taskId, {
    scene_plan: updatedPlan,
    save_progress: true,
    change_scope: 'scene',
    changed_domains: ['scene'],
    base_content_revision: 1,
    client_edit_seq: 2,
  }, owner);

  assert(saved.changed_domains.includes('scene'), '完整 scene_plan 真实修改必须进入 scene 变更域');
  assert.equal(saved.content_revision, 2);
  assert.deepStrictEqual(
    storage.getOutput(taskId, 'scene_config').spaces.map(space => space.id),
    ['home_space', 'park_space'],
    '新版本必须原子保存完整双场景合同',
  );
  assert.equal(storage.getOutput(taskId, 'scene_config').spaces[1].name, '城市公园林荫草坪');
  assertSceneAssetIds(storage.getOutput(taskId, 'scene_assets'), ['home_space'],
    '真实修改场景 2 时必须只保留未变的稳定场景 1 资产');
}

function testHistoricalCheckpointCannotBypassPrepareGate() {
  const created = service.createTask({
    task_id: 'scene-authority-missing-current-config',
    brief: '制作一支用于验证历史场景不能冒充当前合同的广告',
    product_subject: '测试品牌产品',
    cast_mode: 'no_human',
    scene_mode: 'multi',
    scene_assets: [
      verifiedSceneAsset('home_space', 4),
      verifiedSceneAsset('park_space', 3),
    ],
    client_edit_seq: 1,
  }, owner);
  partialCheckpoint(created.task.id, 'home_space');

  assert.throws(
    () => service.prepareGeneration(created.task.id, {
      expected_content_revision: 1,
      client_edit_seq: 1,
      target_stage: 'script_package',
    }, owner),
    error => error?.code === 'SCENE_CONFIG_REQUIRED',
    '缺少当前 scene_config 时，历史 context/checkpoint 不能绕过 script_package 门禁',
  );
}

function main() {
  testActiveSceneSpecIsUiState();
  testInvalidatedHistoryCannotBecomeCurrentUiAssets();
  testRealScenePlanChangeInvalidatesOnlyChangedStableScene();
  testHistoricalCheckpointCannotBypassPrepareGate();
  console.log('new story ad scene authority lineage: ok');
}

main();
