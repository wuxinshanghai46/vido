#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-contract-freshness-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const storage = require('../src/services/newStoryAd/storageService');
const freshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const { buildKeyframeContracts } = require('../src/services/newStoryAd/keyframeContractService');

function context(characterName) {
  return {
    brief: '通用行业合同新鲜度回归',
    product_subject: '通用测试主体',
    cast_mode: 'no_human',
    characters: [{ id: 'character-1', name: characterName }],
    scene_assets: [],
    assets: [],
    output_ratio: '9:16',
  };
}

function shots(count) {
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    title: `镜头 ${index + 1}`,
    visual: `展示当前任务主体 ${index + 1}`,
    action: '保持稳定展示',
    characters: [],
    subject_type: 'product_only',
  }));
}

function createStoredTask(id, ctx, storyboard) {
  const taskId = service.createTask({
    brief: ctx.brief,
    product_subject: ctx.product_subject,
    cast_mode: ctx.cast_mode,
  }, { id, role: 'user' }).task.id;
  storage.saveOutput(taskId, 'context', ctx);
  storage.saveOutput(taskId, 'storyboard_table', storyboard);
  return taskId;
}

function testSemanticChangeInvalidatesEveryAffectedFrame() {
  const storyboard = shots(18);
  const oldCtx = context('旧人物约束');
  const nextCtx = context('新人物约束');
  const taskId = createStoredTask('freshness-max-owner', oldCtx, storyboard);
  const oldContracts = buildKeyframeContracts(oldCtx, storyboard);
  const nextContracts = buildKeyframeContracts(nextCtx, storyboard);
  assert.equal(oldContracts[0].contract_fingerprint, nextContracts[0].contract_fingerprint,
    '回归必须覆盖旧指纹未包含、但完整合同语义已经变化的字段');
  assert.notEqual(oldContracts[0].contract_compiler_signature, nextContracts[0].contract_compiler_signature);
  storage.saveOutput(taskId, 'keyframe_contracts', oldContracts);
  storage.saveOutput(taskId, 'keyframes', oldContracts.map((contract, index) => ({
    image_url: `https://example.test/frame-${index + 1}.png`,
    contract_fingerprint: contract.contract_fingerprint,
    contract_compiler_signature: contract.contract_compiler_signature,
    contract,
    current_generation_status: 'accepted',
    qa: { pass: true },
  })));
  storage.saveOutput(taskId, 'video_clips', [{ video_url: 'https://example.test/old.mp4' }]);
  storage.saveOutput(taskId, 'final_video', { video_url: 'https://example.test/final.mp4' });
  storage.saveOutput(taskId, 'context', nextCtx);

  const result = freshness.refresh(taskId, { ctx: nextCtx, shots: storyboard });
  assert.equal(result.changed_indexes.length, 18, '最大 18 镜时每个语义变化的合同都必须被识别');
  assert.equal(result.invalidated, 18);
  assert(storage.getOutput(taskId, 'keyframes').every(frame => frame.contract_outdated === true));
  assert.equal(storage.getOutput(taskId, 'video_clips'), null, '合同变化必须清除下游视频复用');
  assert.equal(storage.getOutput(taskId, 'final_video'), null, '合同变化必须清除旧成片复用');
  assert.throws(
    () => freshness.assertCurrent(taskId, 17, oldContracts[17]),
    error => error?.code === 'KEYFRAME_CONTRACT_CHANGED_DURING_GENERATION' && error?.details?.shot_number === 18,
  );
}

function testLegacyMetadataUpgradeDoesNotInvalidateEquivalentFrames() {
  const storyboard = shots(1);
  const ctx = context('语义未变化');
  const taskId = createStoredTask('freshness-legacy-owner', ctx, storyboard);
  const current = buildKeyframeContracts(ctx, storyboard);
  const legacy = current.map(contract => {
    const copy = { ...contract };
    delete copy.contract_compiler_signature;
    return copy;
  });
  storage.saveOutput(taskId, 'keyframe_contracts', legacy);
  storage.saveOutput(taskId, 'keyframes', [{
    image_url: 'https://example.test/legacy-frame.png',
    contract_fingerprint: legacy[0].contract_fingerprint,
    contract: legacy[0],
    current_generation_status: 'accepted',
    qa: { pass: true },
  }]);
  storage.saveOutput(taskId, 'video_clips', [{ video_url: 'https://example.test/keep.mp4' }]);

  const result = freshness.refresh(taskId, { ctx, shots: storyboard });
  assert.deepEqual(result.changed_indexes, []);
  assert.equal(result.invalidated, 0, '仅缺新签名的等价历史合同不得误伤已有画面');
  assert(storage.getOutput(taskId, 'keyframe_contracts')[0].contract_compiler_signature);
  assert(storage.getOutput(taskId, 'keyframes')[0].contract_compiler_signature);
  assert.equal(storage.getOutput(taskId, 'keyframes')[0].contract_outdated, undefined);
  assert(storage.getOutput(taskId, 'video_clips'), '等价升级不得清除下游视频');
}

function testProviderAuditPersistsVerifiedContractAndPrompt() {
  const storyboard = shots(3);
  const ctx = context('审计人物');
  const taskId = createStoredTask('freshness-audit-owner', ctx, storyboard);
  const contracts = buildKeyframeContracts(ctx, storyboard);
  contracts.forEach((contract, index) => {
    freshness.recordProviderAudit(taskId, {
      generationId: 'generation-audit', index, contract, prompt: `prompt-${index + 1}`,
    });
  });
  const audit = storage.getOutput(taskId, 'keyframe_provider_audit');
  assert.equal(audit.entries.length, 3);
  assert(audit.entries.every(entry => entry.status === 'verified_before_provider'));
  assert(audit.entries.every(entry => /^[a-f0-9]{64}$/.test(entry.prompt_fingerprint)));
  assert.deepEqual(audit.entries.map(entry => entry.shot_number), [1, 2, 3]);
}

try {
  testSemanticChangeInvalidatesEveryAffectedFrame();
  testLegacyMetadataUpgradeDoesNotInvalidateEquivalentFrames();
  testProviderAuditPersistsVerifiedContractAndPrompt();
  console.log('new-story-ad contract freshness tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
