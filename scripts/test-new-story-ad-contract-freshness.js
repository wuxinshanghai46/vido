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
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const { buildKeyframeContracts, contractFingerprint } = require('../src/services/newStoryAd/keyframeContractService');

function context(characterName) {
  return {
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
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
    content_mode: 'commercial_subject',
    content_mode_source: 'user',
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
  storage.saveOutput(taskId, 'video_clips', oldContracts.map((_, index) => ({ video_url: `https://example.test/old-${index + 1}.mp4` })));
  storage.saveOutput(taskId, 'final_video', { video_url: 'https://example.test/final.mp4' });
  storage.saveOutput(taskId, 'context', nextCtx);

  const result = freshness.refresh(taskId, { ctx: nextCtx, shots: storyboard });
  assert.equal(result.changed_indexes.length, 18, '最大 18 镜时每个语义变化的合同都必须被识别');
  assert.equal(result.invalidated, 18);
  assert(storage.getOutput(taskId, 'keyframes').every(frame => frame.contract_outdated === true));
  const staleClips = storage.getOutput(taskId, 'video_clips');
  assert.equal(staleClips.length, 18, '合同变化必须保留已付费视频证据');
  assert(staleClips.every(clip => clip.lineage_outdated === true && clip.lineage_outdated_reason === 'keyframe_contract_changed'), '每个受影响视频必须明确标记为不可复用');
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
  assert.equal(storage.getOutput(taskId, 'keyframes')[0].contract_outdated, false);
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

function testReadOnlyInspectionIgnoresAuditTimeAndNormalizedBriefDrift() {
  const storyboard = shots(2);
  const verifiedProduct = {
    advertised_subject: '已验证的通用产品主体',
    product_revision: 3,
    reference_fingerprint: 'stable-product-reference',
    status: 'verified',
    updated_at: '2026-07-20T01:00:00.000Z',
  };
  const oldCtx = {
    ...context('稳定人物'),
    product_subject: '最初用户输入的产品描述',
    product_contract: verifiedProduct,
  };
  const nextCtx = {
    ...oldCtx,
    product_subject: '系统后来补充得更详细、但仍属于同一已验证产品的规范化描述',
    product_contract: { ...verifiedProduct, updated_at: '2026-07-21T02:00:00.000Z' },
  };
  const taskId = createStoredTask('freshness-read-only-preflight', oldCtx, storyboard);
  const oldContracts = buildKeyframeContracts(oldCtx, storyboard);
  const nextContracts = buildKeyframeContracts(nextCtx, storyboard);
  assert.deepEqual(
    oldContracts.map(item => item.contract_fingerprint),
    nextContracts.map(item => item.contract_fingerprint),
    '同一已验证产品的规范化描述和审计时间变化不得改变镜头身份',
  );
  assert.deepEqual(
    oldContracts.map(item => freshness.signatureOf(item)),
    nextContracts.map(item => freshness.signatureOf(item)),
    '审计时间不得进入视觉语义签名',
  );
  storage.saveOutput(taskId, 'keyframe_contracts', oldContracts);
  storage.saveOutput(taskId, 'keyframes', oldContracts.map((contract, index) => ({
    image_url: `https://example.test/stable-${index}.png`,
    contract_fingerprint: contract.contract_fingerprint,
    contract,
    current_generation_status: 'accepted',
    qa_policy_version: 2,
    qa: { pass: true },
  })));
  storage.saveOutput(taskId, 'video_clips', [{ video_url: 'https://example.test/preserved.mp4' }]);
  storage.saveOutput(taskId, 'context', nextCtx);
  const before = JSON.stringify(storage.getTaskBundle(taskId));
  const inspection = freshness.inspect(taskId, { ctx: nextCtx, shots: storyboard });
  const after = JSON.stringify(storage.getTaskBundle(taskId));
  assert.deepEqual(inspection.changed_indexes, []);
  assert.strictEqual(after, before, '只读预检不得写合同、关键帧、视频或任务时间');
  assert(storage.getOutput(taskId, 'video_clips'), '只读预检不得删除旧视频片段');
}

function testStoryboardEditsInvalidateOnlyChangedFrames() {
  const cases = [
    { count: 1, changed: [0] },
    { count: 2, changed: [1] },
    { count: 6, changed: [0, 2, 5] },
    { count: 18, changed: [8] },
  ];

  cases.forEach(({ count, changed }, caseIndex) => {
    const ctx = context(`generic-owner-${caseIndex}`);
    const taskId = createStoredTask(`storyboard-subset-${caseIndex}`, ctx, shots(count));
    const initial = service.updateStoryboardTable(taskId, shots(count), { id: 'regression-user' });
    const frames = initial.keyframe_contracts.map((contract, index) => ({
      image_url: `https://example.test/subset-${caseIndex}-${index}.png`,
      candidates: [{ id: `candidate-${index}`, image_url: `https://example.test/candidate-${index}.png` }],
      selected_candidate_id: `candidate-${index}`,
      accepted_revision: index + 1,
      contract_fingerprint: contract.contract_fingerprint,
      contract_compiler_signature: contract.contract_compiler_signature,
      contract,
      current_generation_status: 'accepted',
      qa: { pass: true, status: 'accepted', evidence: { index } },
    }));
    storage.saveOutput(taskId, 'keyframes', frames);
    const originalClips = frames.map((_, index) => ({ video_url: `https://example.test/subset-clip-${caseIndex}-${index}.mp4`, qa: { pass: true } }));
    storage.saveOutput(taskId, 'video_clips', originalClips);
    const persistedFrames = storage.getOutput(taskId, 'keyframes');

    const edited = initial.shots.map((shot, index) => (
      changed.includes(index) ? { ...shot, visual: `${shot.visual} - semantic edit ${index}` } : shot
    ));
    const result = service.updateStoryboardTable(taskId, edited, { id: 'regression-user' });
    const stored = storage.getOutput(taskId, 'keyframes');
    const storedClips = storage.getOutput(taskId, 'video_clips');

    assert.deepStrictEqual(result.changed_indexes, changed,
      `case ${caseIndex}: the response must identify exactly the edited frame indexes`);
    assert.strictEqual(result.keyframes.length, count,
      `case ${caseIndex}: the save response must return the complete authoritative frame list`);
    assert.strictEqual(stored.length, count,
      `case ${caseIndex}: editing a subset must never truncate the frame list`);

    stored.forEach((frame, index) => {
      if (!changed.includes(index)) {
        assert.deepStrictEqual(frame, persistedFrames[index],
          `case ${caseIndex}: unchanged frame ${index} must retain all image and QA evidence`);
        assert.deepStrictEqual(storedClips[index], originalClips[index],
          `case ${caseIndex}: unchanged video clip ${index} must remain reusable`);
        return;
      }
      assert.strictEqual(frame.image_url, persistedFrames[index].image_url);
      assert.deepStrictEqual(frame.candidates, persistedFrames[index].candidates);
      assert.deepStrictEqual(frame.qa, persistedFrames[index].qa);
      assert.strictEqual(frame.selected_candidate_id, persistedFrames[index].selected_candidate_id);
      assert.strictEqual(frame.accepted_revision, persistedFrames[index].accepted_revision);
      assert.strictEqual(frame.contract_outdated, true);
      assert.strictEqual(frame.current_generation_status, 'outdated');
      assert.strictEqual(storedClips[index].video_url, originalClips[index].video_url);
      assert.strictEqual(storedClips[index].lineage_outdated, true,
        `case ${caseIndex}: changed video clip ${index} must be blocked from reuse`);
    });
  });
}

async function testAuditAndTransportDriftIsGloballyNonSemantic() {
  const storyboard = shots(18);
  const ctx = context('全局语义兼容');
  const contracts = buildKeyframeContracts(ctx, storyboard);
  const legacy = contracts.map((contract, index) => ({
    ...contract,
    scene_lock: {
      ...contract.scene_lock,
      scene_contract: {
        ...(contract.scene_lock?.scene_contract || {}),
        verified_at: `2026-07-20T00:00:${String(index).padStart(2, '0')}.000Z`,
        verification: { checked_at: '2026-07-20T00:00:00.000Z', pass: true },
      },
      view_images: [{ view: 'master', url: `https://example.test/scene-${index}.png` }],
    },
  }));
  const normalized = legacy.map(contract => ({
    ...contract,
    scene_lock: {
      ...contract.scene_lock,
      scene_contract: {
        ...contract.scene_lock.scene_contract,
        verified_at: '2026-07-22T08:00:00.000Z',
        verification: { checked_at: '2026-07-22T08:00:00.000Z', pass: true },
      },
      view_images: contract.scene_lock.view_images.map(view => ({
        ...view, filename: '', provider_used: '', source_url: '',
      })),
    },
  }));
  legacy.forEach((contract, index) => {
    assert.equal(contractFingerprint(contract), contractFingerprint(normalized[index]));
    assert.equal(freshness.signatureOf(contract), freshness.signatureOf(normalized[index]));
    assert(freshness.contractMatches(contract, normalized[index]));
    assert(freshness.artifactMatchesContract({
      contract,
      contract_fingerprint: contract.contract_fingerprint,
      contract_compiler_signature: freshness.signatureOf(contract),
    }, normalized[index]));
  });
  const concurrent = await Promise.all(Array.from({ length: 12 }, async () => (
    normalized.map((contract, index) => freshness.contractMatches(legacy[index], contract))
  )));
  assert(concurrent.every(batch => batch.length === 18 && batch.every(Boolean)),
    '最大 18 镜并发只读比较不得把审计/运输字段漂移误判为视觉变化');

  const realChange = JSON.parse(JSON.stringify(normalized[0]));
  realChange.scene_lock.material_summary = '真实材质语义已经改变';
  assert(!freshness.contractMatches(legacy[0], realChange), '真实材质变化必须继续阻断旧关键帧');
  assert(!freshness.artifactMatchesContract({ contract: legacy[0] }, realChange));
}

function testVideoPreflightBlocksWithoutMutatingExistingMedia() {
  const storyboard = shots(1);
  const oldCtx = context('合同旧语义');
  const nextCtx = context('合同新语义');
  const taskId = createStoredTask('freshness-preflight-no-write', oldCtx, storyboard);
  const oldContracts = buildKeyframeContracts(oldCtx, storyboard);
  storage.saveOutput(taskId, 'keyframe_contracts', oldContracts);
  storage.saveOutput(taskId, 'keyframes', [{
    image_url: 'https://example.test/original-frame.png',
    contract_fingerprint: oldContracts[0].contract_fingerprint,
    contract_compiler_signature: oldContracts[0].contract_compiler_signature,
    contract: oldContracts[0],
    current_generation_status: 'accepted',
    qa_policy_version: 2,
    qa: { pass: true, status: 'accepted' },
  }]);
  storage.saveOutput(taskId, 'video_clips', [{
    video_url: 'https://example.test/original-clip.mp4',
    qa: { pass: true },
    cross_shot_qa: { pass: true },
  }]);
  storage.saveOutput(taskId, 'context', nextCtx);
  const before = JSON.stringify(storage.getTaskBundle(taskId));
  const plan = service.buildVideoPreflightPlan(taskId, { video_generation_mode: 'quality' });
  const after = JSON.stringify(storage.getTaskBundle(taskId));
  assert(plan.blockers.some(item => item.code === 'VIDEO_INPUT_QA_REQUIRED'));
  assert.strictEqual(plan.status, 'blocked');
  assert.strictEqual(after, before, '预检失败不得写授权、合同、关键帧、预检缓存或视频片段');
  assert(storage.getOutput(taskId, 'video_clips'), '合同不一致时必须保留旧视频恢复证据');
  assert.strictEqual(storage.getOutput(taskId, 'video_cost_authorization'), null);
  assert.throws(
    () => service.buildVideoPreflightPlan(taskId, { only_indexes: '' }),
    error => error?.code === 'VIDEO_SHOT_INDEX_INVALID',
    '空范围不得退化为全量预检',
  );
  assert.throws(
    () => service.buildVideoPreflightPlan(taskId, { only_indexes: [99] }),
    error => error?.code === 'VIDEO_SHOT_INDEX_INVALID',
    '越界范围不得退化为全量预检',
  );
}

async function testPreProviderFailureVoidsAuthorization() {
  const storyboard = shots(1);
  const oldCtx = context('授权旧语义');
  const nextCtx = context('授权新语义');
  const taskId = createStoredTask('freshness-authorization-void', oldCtx, storyboard);
  const contracts = buildKeyframeContracts(oldCtx, storyboard);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveOutput(taskId, 'keyframes', [{
    image_url: 'https://example.test/authorized-frame.png',
    contract_fingerprint: contracts[0].contract_fingerprint,
    contract: contracts[0],
    current_generation_status: 'accepted',
    qa_policy_version: 2,
    qa: { pass: true },
  }]);
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.saveOutput(taskId, 'video_cost_authorization', { status: 'authorized', fingerprint: 'test-authorization' });
  const beforeCalls = storage.getTaskBundle(taskId).model_calls.length;
  await assert.rejects(
    () => service.generateTtsStage(taskId, { include_voiceover: false }),
    error => error?.code === 'VIDEO_INPUT_QA_REQUIRED',
  );
  const authorization = storage.getOutput(taskId, 'video_cost_authorization');
  assert.strictEqual(authorization.status, 'voided');
  assert.strictEqual(authorization.provider_submitted, false);
  assert.strictEqual(storage.getTaskBundle(taskId).model_calls.length, beforeCalls, '供应商前失败不得产生模型调用');
}

async function testMatchingTtsIsReusedBeforeProviderCall() {
  const storyboard = [{ ...shots(1)[0], voiceover: '现有配音必须直接复用' }];
  const ctx = context('配音复用');
  const taskId = createStoredTask('tts-reuse-before-provider', ctx, storyboard);
  const contracts = buildKeyframeContracts(ctx, storyboard);
  storage.saveOutput(taskId, 'keyframe_contracts', contracts);
  storage.saveOutput(taskId, 'keyframes', [{
    image_url: 'https://example.test/tts-reuse-frame.png',
    contract_fingerprint: contracts[0].contract_fingerprint,
    contract_compiler_signature: contracts[0].contract_compiler_signature,
    contract: contracts[0],
    current_generation_status: 'accepted',
    qa_policy_version: 2,
    qa: { pass: true, status: 'accepted', person: { pass: true, status: 'verified' }, product: { pass: true, status: 'verified' } },
  }]);
  fs.mkdirSync(ttsAdapter.AUDIO_DIR, { recursive: true });
  const audioPath = path.join(ttsAdapter.AUDIO_DIR, 'existing-voice.wav');
  fs.writeFileSync(audioPath, 'existing-audio-evidence');
  const existing = {
    voice_id: 'voice-a',
    provider_used: 'existing/provider',
    tracks: [{ text: '现有配音必须直接复用', file_path: audioPath }],
  };
  storage.saveOutput(taskId, 'tts_audio', existing);
  const originalGenerateVoiceover = ttsAdapter.generateVoiceover;
  let providerCalls = 0;
  ttsAdapter.generateVoiceover = async () => { providerCalls += 1; throw new Error('不应调用配音供应商'); };
  try {
    const result = await service.generateTtsStage(taskId, { voice_id: 'voice-a', include_voiceover: true });
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(providerCalls, 0, '相同脚本、音色和有效音频文件不得重复调用配音供应商');
    assert.deepStrictEqual(storage.getOutput(taskId, 'tts_audio'), existing, '复用不得覆盖已有配音证据');
  } finally {
    ttsAdapter.generateVoiceover = originalGenerateVoiceover;
  }
}

(async () => {
  try {
    testSemanticChangeInvalidatesEveryAffectedFrame();
    testLegacyMetadataUpgradeDoesNotInvalidateEquivalentFrames();
    testStoryboardEditsInvalidateOnlyChangedFrames();
    testProviderAuditPersistsVerifiedContractAndPrompt();
    testReadOnlyInspectionIgnoresAuditTimeAndNormalizedBriefDrift();
    await testAuditAndTransportDriftIsGloballyNonSemantic();
    testVideoPreflightBlocksWithoutMutatingExistingMedia();
    await testPreProviderFailureVoidsAuthorization();
    await testMatchingTtsIsReusedBeforeProviderCall();
    console.log('new-story-ad contract freshness tests passed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
