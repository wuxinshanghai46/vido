#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-storyboard-prompt-assist-v313-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const assist = require('../src/services/storyAdWorkspace/storyboardPromptAssistService');
const targets = require('../src/services/storyAdWorkspace/storyboardSketchTargetService');
const asyncLaunch = require('../src/services/storyAdWorkspace/storyboardAsyncLaunchService');
const sketchServiceSource = fs.readFileSync(path.join(__dirname, '../src/services/storyAdWorkspace/storyboardSketchService.js'), 'utf8');
const workspaceRouteSource = fs.readFileSync(path.join(__dirname, '../src/routes/storyAdWorkspace.js'), 'utf8');

const taskId = 'storyboard-prompt-assist-v313';
storage.createTask({
  id: taskId,
  title: '全行业逐镜提示词 AI 帮写',
  user_id: 'fixture-owner',
  content_revision: 3,
  request: { brief: '一只牧羊犬穿过户外草场追赶羊群，最后在围栏前停下。', output_ratio: '16:9' },
});
storage.saveOutput(taskId, 'context', { brief: '一只牧羊犬穿过户外草场追赶羊群，最后在围栏前停下。', output_ratio: '16:9' });
storage.saveOutput(taskId, 'scene_assets', [{
  id: 'scene_field', scene_id: 'scene_field', name: '户外草场', revision: 1,
  story_purpose: '表现动物群体运动与追逐路线',
  view_images: [{ key: 'master', image_url: '/fixtures/field-master.png' }],
  scene_contract: { schema_version: 6, status: 'verified', requirement_qa: { pass: true }, photographic_realism_qa: { pass: true }, camera_design_qa: { pass: true }, cross_view_qa: { pass: true }, spatial_coverage_qa: { pass: true }, layout_contract: { status: 'available' } },
}]);
const shots = [
  { shot_index: 1, source_beat_id: 'beat_1', title: '草场建立', visual: '完整草场和羊群', action: '羊群向围栏移动', expected_people: 0, expected_animals: 8, subject_type: 'animal_group', scene_id: 'scene_field', scene_view: 'master', camera_id: 'camera_master', shot_size: 'wide' },
  { shot_index: 2, source_beat_id: 'beat_2', title: '牧羊犬追赶', visual: '牧羊犬从画左追赶羊群', action: '牧羊犬跑向羊群', expected_people: 0, expected_animals: 9, subject_type: 'animal_group', scene_id: 'scene_field', scene_view: 'master', camera_id: 'camera_master', shot_size: 'wide' },
];
storage.saveOutput(taskId, 'storyboard_table', shots);
storage.saveOutput(taskId, 'story_flow_contract', { version: 3, units: [
  { beat_id: 'beat_1', plot: '羊群穿过草场', scene_id: 'scene_field' },
  { beat_id: 'beat_2', plot: '牧羊犬追赶羊群并在围栏前停下', scene_id: 'scene_field' },
] });
storage.saveOutput(taskId, 'shot_reference_packs', [{ shot_index: 2, references: [
  { role: 'scene_identity', required: true, order: 1, url: '/fixtures/field-master.png' },
  { role: 'pet_identity_1', required: true, order: 2, url: '/fixtures/dog.png' },
] }]);

let providerCalls = 0;
let captured = null;
const modelGateway = {
  generateText: async request => {
    providerCalls += 1;
    captured = request;
    return {
      parsed_json: {
        prompt_text: '户外草场广角单帧：一只牧羊犬位于画面左侧，羊群整体向右侧围栏移动；只表现追赶过程中的一个决定性瞬间，保持动物身份、数量关系、运动方向和草场空间连续，不出现人物或重复的同一只牧羊犬。',
        diagnosis: '当前草稿同时描述追赶和停下两个时间阶段。',
        conflicts: ['单张图包含两个决定性瞬间'],
        improvements: ['收敛为单一追赶瞬间', '锁定动物数量与运动方向'],
        recommended_action: 'regenerate_current_shot',
        action_reason: '只修改了第 2 镜提示词。',
      },
      used_model: 'fixture/text', fallback_used: false,
    };
  },
};

async function main() {
  const beforeOutputs = storage.listOutputs(taskId).length;
  const result = await assist.suggest(taskId, 2, {
    prompt_text: '未保存草稿：牧羊犬正在追赶，同时已经在围栏前停下。',
    instruction: '只保留追赶瞬间，并与上一镜草场方向一致。',
  }, { modelGateway });
  assert.equal(providerCalls, 1);
  assert.equal(result.shot_index, 2);
  assert.equal(result.saved, false);
  assert.equal(result.generation_started, false);
  assert.match(result.prompt_text, /一只牧羊犬/);
  assert.match(captured.userPrompt, /牧羊犬追赶羊群并在围栏前停下/);
  assert.match(captured.userPrompt, /scene_field/);
  assert.match(captured.userPrompt, /pet_identity_1/);
  assert.match(captured.userPrompt, /未保存草稿/);
  assert.match(captured.userPrompt, /只保留追赶瞬间/);
  assert.match(captured.userPrompt, /上一镜头/);
  assert.match(result.diagnosis, /两个时间阶段/);
  assert.deepEqual(result.conflicts, ['单张图包含两个决定性瞬间']);
  assert.equal(result.recommended_action, 'regenerate_current_shot');
  assert.equal(storage.listOutputs(taskId).length, beforeOutputs, 'AI 帮写只返回建议，不得保存提示词或启动图片生成');
  assert.equal(storage.listModelCalls(taskId).length, 0, 'fixture gateway must not create real model calls');

  assert.deepEqual(targets.select({ shots, existing: [{ shot_index: 1, image_url: '/1.png' }, { shot_index: 2, image_url: '/2.png' }], confirmation: { stale_indexes: [2] }, options: {} }), [2]);
  assert.deepEqual(targets.select({ shots, existing: [], confirmation: {}, options: { target_indexes: [2] } }), [2]);
  assert.deepEqual(targets.select({ shots, existing: [], confirmation: {}, options: { regenerate_all: true } }), [1, 2]);
  assert.throws(() => targets.select({ shots, options: { target_indexes: [3] } }), error => error.code === 'STORYBOARD_TARGET_INDEX_INVALID');
  assert.match(sketchServiceSource, /本张图唯一动作状态.*domainContract\.decisive_moment/s);
  assert.doesNotMatch(sketchServiceSource, /`动作：\$\{clean\(shot\.action/);
  assert.match(workspaceRouteSource, /storyboard-images\/:shotIndex\/prompt-assist/);
  assert.match(workspaceRouteSource, /body\.async_start === true/);
  assert.match(workspaceRouteSource, /res\.status\(202\)/);

  let finishGeneration;
  const pendingGeneration = new Promise(resolve => { finishGeneration = resolve; });
  const launched = await asyncLaunch.resolve(pendingGeneration, () => ({ progress: { status: 'running', requested: 1, target_indexes: [2] } }));
  assert.equal(launched.accepted, true);
  assert.equal(launched.result.progress.status, 'running');
  finishGeneration({ completed: 1 });
  const immediateFailure = Object.assign(new Error('preflight failed'), { code: 'PREFLIGHT_FAILED' });
  await assert.rejects(() => asyncLaunch.resolve(Promise.reject(immediateFailure)), error => error.code === 'PREFLIGHT_FAILED');

  await assert.rejects(() => assist.suggest(taskId, 2, {}, { modelGateway: {
    generateText: async () => {
      storage.updateTask(taskId, { content_revision: 4 });
      return { parsed_json: { prompt_text: '保持户外草场、牧羊犬和羊群身份，只呈现一个清晰的追逐瞬间，并确保场景、数量和运动方向都与当前剧本一致。' } };
    },
  } }), error => error.code === 'STORYBOARD_PROMPT_ASSIST_STALE');

  console.log(JSON.stringify({ passed: true, provider_calls: providerCalls, real_model_calls: 0, outputs_unchanged: true, targeted_single_shot: true, async_progress_launch: true, stale_write_blocked: true }));
}

main().finally(() => fs.rmSync(outputDir, { recursive: true, force: true }));
