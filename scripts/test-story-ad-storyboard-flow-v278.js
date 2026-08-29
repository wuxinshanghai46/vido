#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-v278-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const acceptance = require('../src/services/newStoryAd/sceneVisualAcceptanceService');
const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');

function scene(id = 'scene-a') {
  return {
    scene_id: id,
    revision: 3,
    scene_master: { image_url: `/${id}/master.png` },
    layout: { image_url: `/${id}/layout.png` },
    view_images: ['reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `/${id}/${key}.png` })),
    scene_contract: { status: 'unverified', space_lock_status: 'unavailable', qa_unavailable: true },
  };
}

function verifyAcceptanceAwareGenerationGate() {
  const scenes = [scene('space-1'), scene('space-2')];
  assert.throws(
    () => sceneBinding.assertSceneModeAssets('multi', scenes, [{ id: 'space-1' }, { id: 'space-2' }]),
    error => error.code === 'SCENE_VERIFICATION_REQUIRED',
    '没有 QA 或用户接受记录时仍必须阻止下游生成',
  );
  const record = {
    status: 'accepted',
    mode: 'explicit_user_acceptance',
    scene_fingerprint: acceptance.fingerprint(scenes),
  };
  assert.equal(
    sceneBinding.assertSceneModeAssets('multi', scenes, [{ id: 'space-1' }, { id: 'space-2' }], { acceptance: record }),
    true,
    '当前五视图的精确用户接受记录必须成为有效的新合同',
  );
  scenes[0].scene_master.image_url = '/space-1/master-v2.png';
  assert.throws(
    () => sceneBinding.assertSceneModeAssets('multi', scenes, [{ id: 'space-1' }, { id: 'space-2' }], { acceptance: record }),
    error => error.code === 'SCENE_VERIFICATION_REQUIRED',
    '任一场景图片变化后必须拒绝复用旧接受记录',
  );
}

function verifyStoryboardServiceUsesNewContractEverywhere() {
  const source = read('src/services/newStoryAd/storyAdService.js');
  const sceneModeCalls = source.match(/assertSceneModeAssets\([^\n]+/g) || [];
  assert(sceneModeCalls.length >= 3);
  assert(sceneModeCalls.every(call => /sceneVerificationOptions\(taskId\)/.test(call)),
    '预检、剧本包和镜头结构生成不得再走旧 QA-only 场景合同');
  assert.match(source, /assertVerifiedSceneAssets\(ctx\.scene_assets, sceneVerificationOptions\(taskId\)\)/,
    '关键帧生成也必须读取同一用户接受记录');
  assert.equal((source.match(/sceneAcceptance: sceneVerificationOptions\(taskId\)\.acceptance/g) || []).length, 3,
    '配音预检、视频方案和视频执行必须共享同一接受状态');
}

function verifyAcceptedProductionEquivalentPreflight() {
  const owner = { id: 'v278-owner', role: 'user' };
  const scenes = [scene('space-1'), scene('space-2')];
  const plan = {
    scene_mode: 'multi',
    spaces: scenes.map((item, index) => ({
      id: item.scene_id,
      name: `测试空间 ${index + 1}`,
      description: '具有完整五视图的测试空间',
      story_purpose: '承载剧情镜头',
      scene_spec: {
        layoutText: '固定空间布局与入口关系',
        materialLightText: '固定材质与光线方向',
        interactionText: '人物按固定动线完成动作',
        negativeText: '禁止结构漂移和镜像翻转',
      },
    })),
  };
  const created = storyAd.createTask({
    task_id: 'storyboard-v278-preflight',
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
    brief: '根据已经确认的剧情生成分镜线稿图。',
    product_subject: '测试产品',
    cast_mode: 'no_human',
    scene_mode: 'multi',
    scene_spec: plan.spaces[0].scene_spec,
    scene_assets: scenes,
    client_edit_seq: 1,
  }, owner);
  storage.saveOutput(created.task.id, 'scene_config', plan);
  storage.saveOutput(created.task.id, 'scene_assets', scenes);
  const accepted = acceptance.create({ storage }).acceptCurrent(created.task.id, owner);
  assert.equal(accepted.model_call_count, 0);
  const prepared = storyAd.prepareGeneration(created.task.id, {
    expected_content_revision: 1,
    client_edit_seq: 1,
    target_stage: 'storyboard',
  }, owner);
  assert.equal(prepared.preflight.ready, true,
    '与生产故障等价的 QA unavailable + 用户接受状态必须通过 storyboard 预检');
  assert.equal(prepared.preflight.model_calls_started, 0,
    '预检只验证合同，不得触发文本或图片模型');
}

function verifyUserFacingFlow() {
  const view = read('public/story-ad/views/storyboardView.js');
  assert.match(view, /剧情内容已在上一步确定/);
  assert.match(view, /生成分镜线稿图/);
  assert.match(view, /系统先在后台整理镜头结构，再使用所选模型生成线稿/);
  assert.match(view, /savePendingSketch/);
  assert.match(view, /startSketchBatch\(batchButton/,
    '一次明确的线稿生成操作必须在镜头结构完成后续接线稿图片生成');
  assert.doesNotMatch(view, />生成文字分镜</);
  assert.doesNotMatch(view, /线稿已锁定/);
  assert.match(view, /data-board-tab="shots">镜头结构/);
  assert.match(view, /data-board-tab="sketches"[^>]*>分镜线稿/);
  assert.match(view, /defaultPanel = shots\.length[\s\S]+\? 'sketches' : 'shots'/,
    '已有镜头结构时默认应展示用户真正要处理的分镜线稿');
  assert.match(view, /if \(!await generateStoryboard\([^\n]+savePendingSketch\(bundle\.project\.id, null\)/,
    '镜头结构提交失败后不得遗留自动付费线稿意图');
}

verifyAcceptanceAwareGenerationGate();
verifyStoryboardServiceUsesNewContractEverywhere();
verifyAcceptedProductionEquivalentPreflight();
verifyUserFacingFlow();
console.log(JSON.stringify({
  passed: true,
  accepted_scene_contract: 'exact-fingerprint-only',
  changed_scene_rejected: true,
  accepted_storyboard_preflight_model_calls: 0,
  primary_action: 'generate-storyboard-sketch-images',
  legacy_primary_text_storyboard_action: 'removed',
}));
