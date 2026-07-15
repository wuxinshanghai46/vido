#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-test-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const service = require('../src/services/newStoryAd/storyAdService');
const { buildContext, assertContextConsistent } = require('../src/services/newStoryAd/contextBuilder');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');
const personKeyframeQa = require('../src/services/newStoryAd/personConsistencyQaService');
const productKeyframeQa = require('../src/services/newStoryAd/productConsistencyQaService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const storyboardTable = require('../src/services/newStoryAd/storyboardTableService');
const newStoryAdModelConfig = require('./configure-new-story-ad-models');

function waitUntil(predicate, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('test wait timed out'));
      }
    }, 20);
  });
}

async function main() {
  const owner = { id: 'owner-1', role: 'user' };
  const created = service.createTask({
    brief: '制作一条面向通用业务场景的产品功能演示广告，按用户输入动态生成内容。',
    product_subject: '用户指定的广告主体',
    cast_mode: 'no_human',
  }, owner);
  const taskId = created.task.id;
  assert.equal(service.assertTaskOwner(taskId, owner).id, taskId);
  assert.throws(() => service.assertTaskOwner(taskId, { id: 'other-user', role: 'user' }), /无权访问/);

  const conflicting = buildContext({
    brief: '一位讲解者面对镜头演示用户指定的服务。',
    cast_mode: 'single',
    forbidden: ['不能出现人物'],
  }, owner);
  assert.throws(() => assertContextConsistent(conflicting), /约束冲突/);

  let runs = 0;
  const first = jobs.queueStage({
    taskId,
    stage: 'storyboard',
    execute: async () => {
      runs += 1;
      await new Promise(resolve => setTimeout(resolve, 80));
      storage.saveOutput(taskId, 'storyboard_table', [{ index: 1, visual: '按输入生成的画面', action: '主体完成用户要求的演示动作', voiceover: '通用测试' }]);
      storage.updateTask(taskId, { status: 'running', stage: 'storyboard_done' });
    },
  });
  const duplicate = jobs.queueStage({ taskId, stage: 'storyboard', execute: async () => { runs += 1; } });
  assert.equal(first.accepted, true);
  assert.equal(duplicate.duplicate, true);
  await waitUntil(() => !storage.getTask(taskId).active_generation_id);
  assert.equal(runs, 1);
  assert.equal(storage.getTask(taskId).status, 'done');
  assert.equal(storage.getOutput(taskId, 'storyboard_table').length, 1);

  const failed = jobs.queueStage({
    taskId,
    stage: 'video',
    execute: async () => { throw new Error('Token not valid'); },
  });
  assert.equal(failed.accepted, true);
  await waitUntil(() => storage.getTask(taskId).stage === 'video_failed');
  assert.equal(storage.getTask(taskId).error_code, 'AUTH_CONFIG');
  assert.equal(storage.getTask(taskId).retryable, false);
  assert.equal(modelGateway.classifyError(new Error('400 Token not valid')).code, 'AUTH_CONFIG');
  assert.deepEqual(modelGateway.classifyError(new Error('HTTP 400: {"code":1102,"message":"Account balance not enough"}')), { code: 'PROVIDER_BILLING', retryable: false });
  assert.deepEqual(modelGateway.classifyError(new Error('Request timed out.')), { code: 'TIMEOUT_OR_NETWORK', retryable: true });
  assert.strictEqual(service.isQaInfrastructureError(Object.assign(new Error('视觉模型全部失败'), { code: 'VISION_QA_UNAVAILABLE' })), true);
  assert.strictEqual(service.isQaInfrastructureError(new Error('视觉模型未返回有效 JSON')), true);
  assert.strictEqual(service.isQaInfrastructureError(Object.assign(new Error('vision response schema invalid'), { code: 'VISION_QA_SCHEMA_INVALID' })), true);
  assert.match(service.structuredQaFeedback({ mismatch_reasons: ['机位不一致'] }, { conflicts: ['人物身份不一致'] }, {}), /场景空间：机位不一致[\s\S]*人物身份：人物身份不一致/);
  storage.saveOutput(taskId, 'storyboard_table', Array.from({ length: 6 }, (_, index) => ({ index: index + 1 })));
  assert(service.keyframeStageBudgetMs(taskId, {}) > 15 * 60 * 1000, '多镜头批次不应再受固定 15 分钟限制');
  await assert.rejects(() => ttsAdapter.generateShotAudio({ shot: { voiceover: '测试' }, voiceId: '' }), /未选择配音音色/);

  const repeatedSpeechShot = {
    voiceover: '开发 AI 应用，总想找到更强大的开发伙伴。',
    narration: '开发 AI 应用，总想找到更强大的开发伙伴。',
    ad_copy: '开发 AI 应用，总想找到更强大的开发伙伴。',
    subtitle: '开发 AI 应用，总想找到更强大的开发伙伴。',
    dialogue_lines: [{ speaker: '旁白', line: '开发 AI 应用，总想找到更强大的开发伙伴。' }],
  };
  const dedupedSpeech = ttsAdapter.shotSpeechText(repeatedSpeechShot);
  assert.equal(dedupedSpeech, '开发 AI 应用，总想找到更强大的开发伙伴。');
  assert.equal(ttsAdapter.shotSpeechText({
    voiceover: '先介绍产品。',
    dialogue_lines: [{ speaker: '主持人', line: '再演示核心功能。' }],
  }), '先介绍产品。 主持人: 再演示核心功能。');
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-a',
    tracks: [{ text: dedupedSpeech }],
  }, [repeatedSpeechShot], 'voice-a'), true);
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-a',
    tracks: [{ text: `${dedupedSpeech} ${dedupedSpeech}` }],
  }, [repeatedSpeechShot], 'voice-a'), false);
  assert.equal(ttsAdapter.voiceoverPlanMatches({
    voice_id: 'voice-b',
    tracks: [{ text: dedupedSpeech }],
  }, [repeatedSpeechShot], 'voice-a'), false);
  assert.equal(service.resolveTtsVoiceId({}, {}, { voice_id: 'legacy-voice' }), 'legacy-voice');
  assert.equal(service.resolveTtsVoiceId({ voice_id: 'new-voice' }, {}, { voice_id: 'legacy-voice' }), 'new-voice');
  assert.strictEqual(personIdentity.personRequired({ cast_mode: 'single', characters: [{ name: '角色甲' }] }), true);
  assert.strictEqual(personIdentity.shotPersonRequired({ cast_mode: 'single', person_asset: { image_url: 'https://example.test/front.png' } }, { characters: [], subject_type: 'product_only', visual: '产品独立静物展示' }), false);
  assert.strictEqual(personIdentity.shotPersonRequired({ cast_mode: 'single', person_asset: { image_url: 'https://example.test/front.png' } }, { characters: [{ name: '角色甲' }] }), true);
  assert.strictEqual(personIdentity.shotPersonRequired({ cast_mode: 'single', person_asset: { image_url: 'https://example.test/front.png' } }, { characters: [], subject_type: 'product_only', visual: '人物指尖与深色衣袖进入画面触摸产品' }), true);
  assert.strictEqual(personIdentity.shotPersonRequired({ cast_mode: 'single', person_asset: { image_url: 'https://example.test/front.png' } }, { characters: [], visual: '镜面里出现人物倒影与服装' }), true);
  assert.equal(personIdentity.shotPersonPresence({ subject_type: 'human_scene', visual: '手部和深色衣袖进入特写' }).mode, 'partial');
  assert.equal(personIdentity.shotPersonPresence({ visual: '镜面里出现人物倒影与衣袖' }).mode, 'reflection');
  assert.equal(personIdentity.shotForbidsPerson({ cast_mode: 'no_human' }, {}), true);
  assert.throws(
    () => personIdentity.assertVerifiedPerson({ cast_mode: 'single', characters: [{ name: '角色甲' }] }),
    error => error?.code === 'PERSON_ASSET_REQUIRED',
  );
  assert.strictEqual(videoAdapter.deyunaiAssetGroupType({ person_asset: { is_ai_generated: true } }), 'AIGC');
  assert.strictEqual(videoAdapter.deyunaiAssetGroupType({ person_asset: { real_person_reference: true } }), 'LivenessFace');
  assert.throws(
    () => videoAdapter.resolvePinnedVideoModel({}, [
      { video_url: '/a.mp4', provider_used: 'deyunai/doubao-seedance-2-0-260128' },
      { video_url: '/b.mp4', provider_used: 'zhipu/cogvideox-flash' },
    ]),
    error => error?.code === 'MIXED_VIDEO_PROVIDER_REQUIRES_RESET',
  );

  const verifiedPersonContract = {
    person_revision: 3,
    status: 'verified',
    reference_views: { front: 'https://example.test/front.png' },
    cross_view_qa: {
      pass: true,
      identity_score: 0.95,
      age_score: 0.95,
      wardrobe_score: 0.95,
      body_score: 0.95,
      mismatch_reasons: [],
    },
  };
  const verifiedPersonCtx = {
    cast_mode: 'single',
    scene_assets: [],
    person_asset: { image_url: 'https://example.test/front.png', person_contract: verifiedPersonContract },
    person_contract: verifiedPersonContract,
  };
  const verifiedFrame = {
    image_url: 'https://example.test/keyframe.png',
    qa_policy_version: 2,
    contract_fingerprint: 'verified-contract-v3',
    qa: {
      pass: true,
      status: 'verified',
      person: { pass: true, status: 'verified' },
      product: { pass: true, status: 'not_applicable' },
    },
    contract: { cast_lock: { person_contract: { person_revision: 3 } } },
  };
  const verifiedMediaContract = { contract_fingerprint: 'verified-contract-v3', cast_lock: { person_contract: { person_revision: 3 } } };
  const jsonRepair = { parseOrRepair: async ({ raw }) => JSON.parse(raw) };
  const qaFrom = payload => ({ generateVision: async () => ({ text: JSON.stringify(payload), used_model: 'test/vision' }) });
  const faceQa = await personKeyframeQa.reviewPersonKeyframe({
    taskId: 'face-qa', ctx: verifiedPersonCtx, shot: { visual: '人物正脸特写' }, generatedUrl: 'https://example.test/face.png',
    gateway: qaFrom({ pass: true, identity_score: 0.95, age_score: 0.92, wardrobe_score: 0.9, body_score: 0.88, hand_owner_score: 0 }), repair: jsonRepair,
  });
  assert.equal(faceQa.pass, true, '正脸特写不应因画面没有手而失败');
  const reflectionQa = await personKeyframeQa.reviewPersonKeyframe({
    taskId: 'reflection-qa', ctx: verifiedPersonCtx, shot: { visual: '镜面里出现人物倒影与深色衣袖' }, generatedUrl: 'https://example.test/reflection.png',
    gateway: qaFrom({ pass: true, identity_score: 0.1, age_score: 0.9, wardrobe_score: 0.95, body_score: 0.9, hand_owner_score: 0.9 }), repair: jsonRepair,
  });
  assert.equal(reflectionQa.pass, false, '人物倒影不能仅凭衣袖相似就绕过身份验证');
  const forbiddenHumanQa = await personKeyframeQa.reviewPersonKeyframe({
    taskId: 'no-human-qa', ctx: { cast_mode: 'no_human' }, shot: { subject_type: 'product_only' }, generatedUrl: 'https://example.test/product.png',
    gateway: qaFrom({ pass: false, visible_human: true, conflicts: ['画面出现人物手部'] }), repair: jsonRepair,
  });
  assert.equal(forbiddenHumanQa.pass, false, 'no_human 镜头必须拦截意外出现的人手或衣袖');
  const ambiguousNoHumanQa = await personKeyframeQa.reviewPersonKeyframe({
    taskId: 'no-human-ambiguous', ctx: { cast_mode: 'no_human' }, shot: { subject_type: 'product_only' }, generatedUrl: 'https://example.test/product.png',
    gateway: qaFrom({ pass: true, conflicts: [] }), repair: jsonRepair,
  });
  assert.equal(ambiguousNoHumanQa.pass, false, 'no_human QA 未明确返回 visible_human=false 时必须失败关闭');
  assert.strictEqual(service.assertVideoInputsReady({
    ctx: verifiedPersonCtx,
    shots: [{ characters: [{ name: '角色甲' }] }],
    keyframes: [verifiedFrame],
    contracts: [verifiedMediaContract],
  }), true);
  assert.throws(
    () => service.assertVideoInputsReady({
      ctx: verifiedPersonCtx,
      shots: [{ characters: [{ name: '角色甲' }] }],
      keyframes: [{ ...verifiedFrame, qa: { pass: true, status: 'verified' } }],
      contracts: [verifiedMediaContract],
    }),
    error => error?.code === 'VIDEO_INPUT_QA_REQUIRED' && /人物一致性/.test(error.message),
  );
  assert.throws(
    () => service.assertVideoInputsReady({
      ctx: verifiedPersonCtx,
      shots: [{ characters: [{ name: '角色甲' }] }],
      keyframes: [{ ...verifiedFrame, qa_policy_version: 1 }],
      contracts: [verifiedMediaContract],
    }),
    error => error?.code === 'VIDEO_INPUT_QA_REQUIRED' && /旧版视觉 QA/.test(error.message),
  );
  assert.throws(
    () => service.assertVideoInputsReady({
      ctx: verifiedPersonCtx,
      shots: [{ characters: [{ name: '角色甲' }] }],
      keyframes: [{ ...verifiedFrame, current_generation_status: 'pending' }],
      contracts: [verifiedMediaContract],
    }),
    error => error?.code === 'VIDEO_INPUT_QA_REQUIRED' && /仍在生成/.test(error.message),
  );
  assert(newStoryAdModelConfig.VIDEO_MODELS.some(model => (
    model.provider_id === 'zhipu'
      && model.model_id === 'cogvideox-flash'
      && model.enabled === true
  )));

  const staleFailedFrame = service.keyframeCompletion([{ image_url: 'https://example.test/old.png', error: 'latest regeneration failed', error_code: 'IMAGE_ATTEMPTS_EXHAUSTED' }], [{}]);
  assert.deepEqual(staleFailedFrame, { total: 1, completed: 0, fresh_pass: 0, outdated: 0, retained_previous: 0, latest_failed: 1, needs_regeneration: 1, missing: 1, failed: 1, missing_indexes: [0] });
  const outdatedFrame = service.keyframeCompletion([{ image_url: 'https://example.test/old.png', qa: { pass: true } }], [{}]);
  assert.equal(outdatedFrame.fresh_pass, 0);
  assert.equal(outdatedFrame.outdated, 1);

  const candidateTask = service.createTask({ brief: '候选图状态测试', product_subject: '测试主体', cast_mode: 'no_human' }, owner).task;
  storage.saveOutput(candidateTask.id, 'storyboard_table', [{ index: 1, subject_type: 'product_only' }]);
  storage.saveOutput(candidateTask.id, 'keyframe_contracts', [{ contract_fingerprint: 'candidate-contract-v1' }]);
  storage.saveOutput(candidateTask.id, 'keyframes', [{
    image_url: 'https://example.test/old-frame.png',
    qa_policy_version: 1,
    qa: { pass: true, status: 'verified' },
    regeneration_error: 'new rejected',
    regeneration_error_code: 'SCENE_CONSISTENCY_QA_FAILED',
    current_generation_status: 'rejected',
    candidates: [
      { id: 'old-candidate', image_url: 'https://example.test/old-candidate.png', status: 'accepted', qa_policy_version: 1, qa: { pass: true, status: 'verified' } },
      { id: 'new-candidate', image_url: 'https://example.test/new-candidate.png', status: 'accepted', qa_policy_version: 2, contract_fingerprint: 'candidate-contract-v1', generation_id: 'gen-2', qa: { pass: true, status: 'verified' } },
    ],
  }]);
  assert.throws(
    () => service.selectKeyframeCandidate(candidateTask.id, 0, 'old-candidate'),
    error => error?.code === 'KEYFRAME_CANDIDATE_QA_OUTDATED',
  );
  const selected = service.selectKeyframeCandidate(candidateTask.id, 0, 'new-candidate').keyframe;
  assert.equal(selected.regeneration_error, '');
  assert.equal(selected.current_generation_status, 'accepted');
  assert.equal(selected.qa_policy_version, 2);
  assert.equal(selected.accepted_revision.selected_candidate_id, 'new-candidate');
  assert.equal(selected.latest_attempt.status, 'accepted');

  const qaRetryTask = service.createTask({ brief: '现有图片只重试 QA', product_subject: '测试主体', cast_mode: 'no_human' }, owner).task;
  storage.saveOutput(qaRetryTask.id, 'context', { brief: '现有图片只重试 QA', product_subject: '测试主体', cast_mode: 'no_human', scene_assets: [] });
  storage.saveOutput(qaRetryTask.id, 'storyboard_table', [{ index: 1, title: '现有候选', subject_type: 'product_only' }]);
  storage.saveOutput(qaRetryTask.id, 'keyframe_contracts', [{ contract_fingerprint: 'qa-retry-contract-v1' }]);
  storage.saveOutput(qaRetryTask.id, 'keyframes', [{
    image_url: 'https://example.test/retained-old.png',
    qa_policy_version: 2,
    contract_fingerprint: 'qa-retry-contract-v1',
    qa: { pass: true, status: 'verified' },
    regeneration_error: '视觉模型未返回有效 JSON',
    regeneration_error_code: 'VISION_QA_UNAVAILABLE',
    current_generation_status: 'qa_unavailable',
    candidates: [{
      id: 'qa-only-candidate',
      image_url: 'https://example.test/new-image-already-generated.png',
      status: 'qa_unavailable',
      qa_policy_version: 2,
      contract_fingerprint: 'qa-retry-contract-v1',
      generation_id: 'qa-only-gen',
      qa: { pass: false, status: 'unavailable', error: '视觉模型未返回有效 JSON' },
    }],
  }]);
  const originalPersonReview = personKeyframeQa.reviewPersonKeyframe;
  const originalProductReview = productKeyframeQa.reviewProductKeyframe;
  const originalGenerateImage = mediaAdapter.generateImage;
  let generatedImages = 0;
  personKeyframeQa.reviewPersonKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  productKeyframeQa.reviewProductKeyframe = async () => ({ pass: true, status: 'verified', conflicts: [] });
  mediaAdapter.generateImage = async () => { generatedImages += 1; throw new Error('QA retry must not generate media'); };
  try {
    const qaRetried = await service.retryKeyframeCandidateQa(qaRetryTask.id, 0, 'qa-only-candidate');
    assert.equal(qaRetried.status, 'accepted');
    assert.equal(qaRetried.media_generated, false);
    assert.equal(qaRetried.keyframe.selected_candidate_id, 'qa-only-candidate');
    assert.equal(qaRetried.keyframe.image_url, 'https://example.test/new-image-already-generated.png');
    assert.equal(generatedImages, 0);
  } finally {
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
    mediaAdapter.generateImage = originalGenerateImage;
  }

  const qaReuseTask = service.createTask({ brief: '复用已有结构化视觉审核', product_subject: '测试主体', cast_mode: 'no_human' }, owner).task;
  storage.saveOutput(qaReuseTask.id, 'context', { brief: '复用已有结构化视觉审核', product_subject: '测试主体', cast_mode: 'no_human', scene_assets: [] });
  storage.saveOutput(qaReuseTask.id, 'storyboard_table', [{ index: 1, title: '已有结构化结果', subject_type: 'product_only' }]);
  storage.saveOutput(qaReuseTask.id, 'keyframe_contracts', [{ contract_fingerprint: 'qa-reuse-contract-v1' }]);
  storage.saveOutput(qaReuseTask.id, 'keyframes', [{
    image_url: 'https://example.test/retained-old.png',
    qa_policy_version: 2,
    contract_fingerprint: 'qa-reuse-contract-v1',
    qa: { pass: true, status: 'verified' },
    current_generation_status: 'rejected',
    candidates: [{
      id: 'structured-qa-candidate',
      image_url: 'https://example.test/structured-qa.png',
      status: 'rejected',
      qa_policy_version: 2,
      contract_fingerprint: 'qa-reuse-contract-v1',
      qa: {
        pass: false,
        status: 'rejected',
        scene: {
          pass: false,
          status: 'failed',
          scene_consistency_score: 0.85,
          anchor_consistency_score: 0.7,
          camera_match_score: 0.9,
          material_match_score: 0.95,
          mismatch_reasons: ['非阻断构图观察'],
          forbidden_new_elements: [],
        },
        person: { pass: true, status: 'verified', conflicts: [] },
        product: { pass: true, status: 'verified', conflicts: [] },
      },
    }],
  }]);
  let unexpectedVisionReviews = 0;
  personKeyframeQa.reviewPersonKeyframe = async () => { unexpectedVisionReviews += 1; throw new Error('existing structured QA should be reused'); };
  productKeyframeQa.reviewProductKeyframe = async () => { unexpectedVisionReviews += 1; throw new Error('existing structured QA should be reused'); };
  try {
    const reused = await service.retryKeyframeCandidateQa(qaReuseTask.id, 0, 'structured-qa-candidate');
    assert.equal(reused.status, 'accepted');
    assert.equal(reused.media_generated, false);
    assert.equal(reused.vision_review_reused, true);
    assert.equal(reused.qa.reused_structured_review, true);
    assert.equal(unexpectedVisionReviews, 0);
  } finally {
    personKeyframeQa.reviewPersonKeyframe = originalPersonReview;
    productKeyframeQa.reviewProductKeyframe = originalProductReview;
  }

  const rebuildTask = service.createTask({ brief: '合同重建失效测试', product_subject: '测试主体', cast_mode: 'no_human' }, owner).task;
  storage.saveOutput(rebuildTask.id, 'context', { brief: '合同重建失效测试', product_subject: '测试主体', cast_mode: 'no_human', scene_assets: [] });
  storage.saveOutput(rebuildTask.id, 'storyboard_table', [{ index: 1, title: '旧镜头', subject_type: 'scene_only', visual: '旧画面', transition_type: 'none' }]);
  storage.saveOutput(rebuildTask.id, 'keyframes', [{ image_url: 'https://example.test/stale.png', qa_policy_version: 2, contract_fingerprint: 'old-fingerprint', current_generation_status: 'accepted', qa: { pass: true, status: 'verified' } }]);
  storage.saveOutput(rebuildTask.id, 'video_clips', [{ video_url: 'https://example.test/old.mp4' }]);
  storage.saveOutput(rebuildTask.id, 'final_video', { video_url: 'https://example.test/final.mp4' });
  await service.buildKeyframeContractStage(rebuildTask.id);
  const invalidatedFrame = storage.getOutput(rebuildTask.id, 'keyframes')[0];
  assert.equal(invalidatedFrame.contract_outdated, true);
  assert.equal(invalidatedFrame.current_generation_status, 'outdated');
  assert.equal(storage.getOutput(rebuildTask.id, 'video_clips'), null);
  assert.equal(storage.getOutput(rebuildTask.id, 'final_video'), null);

  const deduped = storage.dedupeLatestTasks([
    { id: 'older', user_id: 'same-user', brief: '相同任务', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-01T00:00:00.000Z' },
    { id: 'newer', user_id: 'same-user', brief: ' 相同任务 ', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-02T00:00:00.000Z' },
    { id: 'other-user', user_id: 'other-user', brief: '相同任务', request: { duration_sec: 30, output_ratio: '9:16' }, updated_at: '2026-01-03T00:00:00.000Z' },
  ]);
  assert.deepEqual(deduped.map(task => task.id).sort(), ['newer', 'other-user']);

  const summary = service.taskSummary(storage.getTask(taskId));
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'request'), false);
  assert.equal(summary.id, taskId);

  const freshnessTask = service.createTask({
    brief: '验证剧本与分镜版本一致性',
    product_subject: '用户指定主体',
    cast_mode: 'no_human',
  }, owner);
  const freshnessId = freshnessTask.task.id;
  storage.saveOutput(freshnessId, 'storyboard_table', [{ index: 1, title: '旧分镜', visual: '旧画面' }]);
  await new Promise(resolve => setTimeout(resolve, 10));
  const firstBlueprint = service.updateBlueprint(freshnessId, {
    story_title: '通用测试剧本',
    beats: [{ title: '开场', visual: '用户指定主体出现', action: '完成演示', spoken_line: '开始演示' }],
  }, owner);
  assert.equal(service.publicTaskBundle(freshnessId).storyboard_status.stale, true);
  const sameBlueprint = service.updateBlueprint(freshnessId, firstBlueprint, owner);
  assert.equal(sameBlueprint.revision, firstBlueprint.revision);
  service.updateStoryboardTable(freshnessId, [{ index: 1, title: '新分镜', visual: '当前剧本对应画面', action: '完成演示', voiceover: '开始演示' }], owner);
  const freshBundle = service.publicTaskBundle(freshnessId);
  assert.equal(freshBundle.storyboard_status.ready, true);
  assert.equal(freshBundle.storyboard_status.blueprint_revision, firstBlueprint.revision);

  let resumedCheckpoint = null;
  const resumedStoryboard = await storyboardTable.generateStoryboardTable({
    brief: '通用断点恢复测试',
    target_duration: 6,
    cast_mode: 'no_human',
    scene_assets: [],
  }, {
    beats: [
      { beat_index: 1, title: '第一镜', plot: '主体进入画面' },
      { beat_index: 2, title: '第二镜', plot: '主体完成演示' },
    ],
  }, {
    taskId: freshnessId,
    resumeShots: [
      { index: 1, title: '第一镜', visual: '主体进入画面', action: '进入', voiceover: '开始' },
      { index: 2, title: '第二镜', visual: '主体完成演示', action: '演示', voiceover: '完成' },
    ],
    onCheckpoint: async checkpoint => { resumedCheckpoint = checkpoint; },
  });
  assert.equal(resumedStoryboard.shots.length, 2);
  assert.deepEqual(resumedCheckpoint.completed_indexes, [1, 2]);
  console.log('new-story-ad reliability tests passed');
}

main()
  .finally(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
