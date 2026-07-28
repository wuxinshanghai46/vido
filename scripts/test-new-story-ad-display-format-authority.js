#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-display-authority-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const owner = { id: 'display-authority-owner', role: 'user' };

function sceneSpec(label) {
  return {
    layoutText: `${label}空间采用可复核的连续布局`,
    materialLightText: `${label}空间保持稳定自然光`,
    interactionText: `${label}空间允许主体按固定动线互动`,
    negativeText: `${label}空间禁止镜像、漂移和额外主体`,
  };
}

function scenePlan() {
  return {
    scene_mode: 'multi',
    spaces: [
      {
        id: 'home_space',
        name: '家庭空间',
        description: '开放式家庭客厅',
        story_purpose: '承载家庭互动',
        scene_spec: sceneSpec('家庭'),
      },
      {
        id: 'park_space',
        name: '公园空间',
        description: '城市公园草坪',
        story_purpose: '承载户外互动',
        scene_spec: sceneSpec('公园'),
      },
    ],
  };
}

function verifiedSceneAsset(sceneId) {
  const viewKeys = ['master', 'reverse', 'interaction', 'detail', 'layout'];
  return {
    id: sceneId,
    scene_id: sceneId,
    space_id: sceneId,
    name: sceneId,
    scene_revision: 1,
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
      scene_revision: 1,
      requirement_qa: { pass: true },
      photographic_realism_qa: { pass: true },
      camera_design_qa: { pass: true },
      cross_view_qa: { pass: true },
      spatial_coverage_qa: { pass: true, coverage_status: 'complete' },
      layout_contract: { status: 'available' },
    },
  };
}

function loadBrowserModules() {
  const controls = new Map([
    ['#dhNsaAdText', { value: '', dataset: {}, classList: { contains: () => false } }],
    ['#dhNsaAdCreativeDirection', { value: '', dataset: {}, classList: { contains: () => false } }],
    ['#dhNsaAdDuration', { value: '30', dataset: {}, classList: { contains: () => false } }],
    ['#dhNsaAdProductionMode', { value: 'auto', dataset: {}, classList: { contains: () => false } }],
    ['#dhNsaAdVoiceId', { value: '', dataset: {}, classList: { contains: () => false } }],
  ]);
  const sandbox = {
    window: {},
    document: { querySelector: selector => controls.get(selector) || null },
    console,
    Date,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(sandbox);
  for (const relative of [
    '../public/js/new-story-ad/state-sync.js',
    '../public/js/new-story-ad/story-setup.js',
  ]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, relative), 'utf8'), sandbox, {
      filename: path.basename(relative),
    });
  }
  return { sandbox, controls };
}

function testDisplayOnlyFormattingDoesNotBecomeAuthoritative() {
  const { sandbox, controls } = loadBrowserModules();
  const state = {
    taskId: '',
    context: null,
    sceneAssets: [],
    shots: [],
    contracts: [],
    keyframes: [],
    videoClips: [],
    videoSceneBlocks: [],
    referenceAssets: [],
    castProfiles: [],
    petProfiles: [],
    subtitleOptions: {},
  };
  const flattenedBrief = '【广告主题】家庭宠物广告 【核心卖点】温暖陪伴 1. 可靠 2. 自然';
  const flattenedCreative = '【剧情走向】主人和宠物进入客厅 【关键动作】1. 宠物靠近主人 2. 主人轻抚宠物 【结尾】品牌收束';
  const bundle = {
    task: {
      id: 'historical-task',
      content_revision: 4,
      latest_client_edit_seq: 2,
      request: {
        brief: flattenedBrief,
        creative_direction: { raw: flattenedCreative },
        story_setup_confirmed: true,
      },
    },
    outputs: {
      context: {
        brief: flattenedBrief,
        creative_direction: { raw: flattenedCreative },
        story_setup_confirmed: true,
      },
    },
  };
  sandbox.window.NewStoryAdStateSync.hydrateTaskBundle(bundle, {
    state,
    within: selector => controls.get(selector) || null,
  });

  const displayedBrief = controls.get('#dhNsaAdText').value;
  const displayedCreative = controls.get('#dhNsaAdCreativeDirection').value;
  assert(displayedBrief.includes('\n'), '历史压平需求应在文本框恢复为多行显示');
  assert(displayedCreative.includes('\n'), '历史压平剧情要求应在文本框恢复为多行显示');
  assert.equal(state.context.brief, flattenedBrief, '权威上下文必须保留服务端原文');
  assert.equal(state.context.creative_direction.raw, flattenedCreative, '权威剧情要求必须保留服务端原文');
  assert.equal(
    sandbox.window.NewStoryAdStateSync.authoritativeTextValue(state, 'brief', displayedBrief, ''),
    flattenedBrief,
    '未编辑的显示格式不得进入保存请求',
  );
  assert.equal(
    sandbox.window.NewStoryAdStorySetup.creativeDirection(
      state,
      selector => controls.get(selector) || null,
    ).raw,
    flattenedCreative,
    '剧情要求保存必须取回历史权威原文',
  );

  const editedBrief = `${displayedBrief}\n\n【补充要求】真实新增内容`;
  controls.get('#dhNsaAdText').value = editedBrief;
  assert.equal(
    sandbox.window.NewStoryAdStateSync.authoritativeTextValue(state, 'brief', editedBrief, ''),
    editedBrief,
    '用户真实编辑后必须保存文本框新值',
  );
}

function testNoOpRefreshSaveKeepsSceneAuthority() {
  const { sandbox, controls } = loadBrowserModules();
  const plan = scenePlan();
  const assets = [verifiedSceneAsset('home_space'), verifiedSceneAsset('park_space')];
  const flattenedBrief = '【广告主题】家庭宠物广告 【核心卖点】温暖陪伴 1. 可靠 2. 自然';
  const flattenedCreative = '【剧情走向】主人和宠物进入客厅 【关键动作】1. 宠物靠近主人 2. 主人轻抚宠物 【结尾】品牌收束';
  const created = service.createTask({
    brief: flattenedBrief,
    product_subject: '家庭宠物产品',
    cast_mode: 'no_human',
    scene_mode: 'multi',
    scene_spec: plan.spaces[0].scene_spec,
    scene_assets: assets,
    creative_direction: { raw: flattenedCreative },
    story_setup_confirmed: true,
    client_edit_seq: 2,
  }, owner);
  const taskId = created.task.id;
  storage.saveOutput(taskId, 'scene_config', plan);
  storage.saveOutput(taskId, 'scene_assets', assets);

  const state = {
    context: created.context,
    sceneAssets: assets,
    shots: [],
    contracts: [],
    keyframes: [],
    videoClips: [],
    videoSceneBlocks: [],
    referenceAssets: [],
    castProfiles: [],
    petProfiles: [],
    subtitleOptions: {},
  };
  sandbox.window.NewStoryAdStateSync.hydrateTaskBundle(service.publicTaskBundle(taskId), {
    state,
    within: selector => controls.get(selector) || null,
  });
  const savedBrief = sandbox.window.NewStoryAdStateSync.authoritativeTextValue(
    state,
    'brief',
    controls.get('#dhNsaAdText').value,
    state.context.brief,
  );
  const savedCreative = sandbox.window.NewStoryAdStorySetup.creativeDirection(
    state,
    selector => controls.get(selector) || null,
  );
  const updated = service.updateTaskRequest(taskId, {
    brief: savedBrief,
    creative_direction: savedCreative,
    story_setup_confirmed: true,
    save_progress: true,
    change_scope: 'none',
    changed_domains: [],
    base_content_revision: 1,
    client_edit_seq: 3,
  }, owner);

  assert.equal(updated.content_revision, 1, '只刷新并点击生成不得制造新内容修订');
  assert.deepEqual(updated.changed_domains, [], '只恢复显示格式不得形成内容域变更');
  assert(storage.getOutput(taskId, 'scene_config'), '场景配置必须保持当前有效');
  assert.equal(storage.getOutput(taskId, 'scene_assets').length, 2, '场景资产必须保持当前有效');

  const prepared = service.prepareGeneration(taskId, {
    expected_content_revision: 1,
    client_edit_seq: 3,
    target_stage: 'script_package',
  }, owner);
  assert.equal(prepared.preflight.ready, true, '生成剧本预检必须通过');
  assert.equal(prepared.preflight.model_calls_started, 0, '预检不得触发真实模型调用');
  assert.equal(prepared.preflight.scene_count, 2);
}

testDisplayOnlyFormattingDoesNotBecomeAuthoritative();
testNoOpRefreshSaveKeepsSceneAuthority();
console.log('new story ad display format authority: ok');
