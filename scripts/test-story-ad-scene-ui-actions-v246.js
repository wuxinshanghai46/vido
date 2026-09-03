'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');

function loadAssetActions() {
  const sandbox = {
    document: { getElementById: () => ({}) },
    confirmDialog: async () => false,
  };
  vm.runInNewContext(`${executable('public/story-ad/views/assetCenterView.js')}\nglobalThis.__tested={materialReferenceState,submitProductGeneration};`, sandbox);
  return sandbox.__tested;
}

function loadApiErrorMessage() {
  const sandbox = { CLIENT_BUILD_ID: 'test-build', CLIENT_CONTRACT_VERSION: 'test-contract' };
  vm.runInNewContext(`${executable('public/story-ad/api.js')}\nglobalThis.__tested=errorMessage;`, sandbox);
  return sandbox.__tested;
}

async function main() {
  const actions = loadAssetActions();
  const material = { name: '铂棕碎钻板', image_url: '/neutral.png', reference_only: true, source: 'new_story_ad_subject_reference_generator', presentation: { mode: 'material_surface', standalone_generation_supported: false } };
  assert.equal(actions.materialReferenceState(material).generatedNeutral, true);
  assert.equal(actions.materialReferenceState({ ...material, reference_only: false, source: 'user_uploaded' }).realSample, true);
  assert.equal(actions.materialReferenceState({ ...material, reference_only: false, source: '' }).sourcePending, true,
    'unknown material image provenance must not be promoted to a real sample');

  let calls = 0;
  const store = { async runStage() { calls += 1; } };
  const cancelled = await actions.submitProductGeneration({ item: material, store, confirmAction: async () => false });
  assert.equal(cancelled.cancelled, true);
  assert.equal(calls, 0, 'cancelling the one-image confirmation must make zero model submissions');
  const accepted = await actions.submitProductGeneration({ item: material, store, confirmAction: async (message, options) => {
    assert.match(message, /1 次图片模型/);
    assert.match(message, /不能替代真实材料样片/);
    assert.equal(options.confirmText, '确认生成 1 张');
    return true;
  } });
  assert.equal(accepted.submitted, true);
  assert.equal(calls, 1, 'confirmed material reference generation must submit exactly one stage request');

  const publicError = loadApiErrorMessage();
  const activePlan = publicError({ error: '当前任务没有可用于生成的本版本 Active Plan: active_plan_bundle_mismatch, scene_plan_stale', code: 'GENERATION_ACTIVE_PLAN_REQUIRED' }, 409);
  assert.match(activePlan, /校验状态尚未同步/);
  assert.doesNotMatch(activePlan, /旧版人物|旧版场景/);
  assert.match(activePlan, /已有素材/);
  assert.match(activePlan, /没有提交新的模型调用/);
  assert.doesNotMatch(activePlan, /Active Plan|active_plan|scene_plan_stale/);
  const contentChanged = publicError({ error: 'active_plan_input_fingerprint_mismatch, active_plan_content_revision_mismatch', code: 'GENERATION_ACTIVE_PLAN_REQUIRED' }, 409);
  assert.match(contentChanged, /项目内容已经更新/);
  assert.match(contentChanged, /重新确认/);
  assert.doesNotMatch(contentChanged, /input_fingerprint|content_revision|Active Plan/i);
  const qaError = publicError({ error: '视觉模型全部失败: smscrw/claude:UNKNOWN; webang-maas/gemini:PROVIDER_RESPONSE_INVALID; zhipu/glm:RATE_LIMIT' }, 409);
  assert.match(qaError, /图片已保留/);
  assert.match(qaError, /重新审核不会重新生成图片/);
  assert.doesNotMatch(qaError, /smscrw|webang|zhipu|claude|gemini|PROVIDER_RESPONSE|RATE_LIMIT|UNKNOWN/);

  console.log(JSON.stringify({ passed: true, cancelled_model_submissions: 0, confirmed_stage_submissions: calls, public_error_redactions: 3 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
