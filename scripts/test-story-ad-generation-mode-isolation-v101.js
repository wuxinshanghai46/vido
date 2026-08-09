'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-generation-mode-isolation-v101-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const outputLanguage = require('../src/services/newStoryAd/outputLanguageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const checkpointLineage = require('../src/services/newStoryAd/assetPlanCheckpointLineageService');
const sectionRecovery = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');

const originalGenerateText = modelGateway.generateText;
const originalEnsureChineseOutput = outputLanguage.ensureChineseOutput;

function context(brief = '古代恋人在祭台分别，千年后在竹海重逢。') {
  return {
    request_id: 'mode-v101',
    brief,
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_subject: '',
    product_presentation: { mode: 'narrative_story', subject: '' },
    expected_people: 2,
    cast_mode: 'dual',
    target_duration: 90,
    shot_count: 8,
    output_ratio: '9:16',
    cast_profiles: [],
    characters: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [],
    assets: [],
    forbidden: [],
    creative_direction: {},
    performance: {},
  };
}

function cast() {
  return [
    { id: 'male_lead', name: '男主', role: '跨越千年的恋人', appearanceText: '年轻清俊', wardrobeText: '古代华服', look_profiles: [] },
    { id: 'female_lead', name: '女主', role: '古代恋人与现代转世', appearanceText: '年轻清秀', wardrobeText: '古代与现代独立造型', look_profiles: [] },
  ];
}

function scene(advertisedSubject = '纯剧情 / 故事主题') {
  return {
    business_boundary: '纯剧情爱情故事',
    advertised_subject: advertisedSubject,
    cast_mode: 'dual',
    scene_mode: 'single',
    spaces: [{
      id: 'bamboo_sea',
      name: '竹海',
      description: '竹径与溪流形成重逢空间',
      story_purpose: '现代重逢',
      scene_spec: {
        layoutText: '竹径贯穿竹海，溪流位于一侧',
        materialLightText: '自然竹叶、薄雾与柔和天光',
        interactionText: '人物沿竹径相向而行并停下凝望',
        negativeText: '禁止商品、品牌和销售文案',
        storyStates: [], interactionAnchors: [], routes: [], propPlacements: [],
      },
    }],
  };
}

(async () => {
  const ctxWithLines = context('第一段剧情。\n\n第二段剧情。');
  const ctxWithSpaces = context('第一段剧情。 第二段剧情。');
  assert.equal(
    assetPlan.fingerprint({ id: 'same' }, ctxWithLines),
    assetPlan.fingerprint({ id: 'same' }, ctxWithSpaces),
    '仅换行折叠为空格不得改变资产规划检查点指纹',
  );

  assert.equal(assetPlan.narrativeSubjectMarker('纯剧情 / 故事主题'), true);
  const placeholderPlan = assetPlan.assertContentModeIsolation(assetPlan.normalizePlan({
    cast_profiles: cast(), prop_plan: [], scene_plan: scene(),
    story_seed: { logline: '跨越千年的重逢' },
  }, ctxWithSpaces), ctxWithSpaces);
  assert.equal(placeholderPlan.scene_plan.advertised_subject, '', '纯剧情模式标记必须规范为空，不得误判成广告主体');

  assert.throws(
    () => assetPlan.assertGeneratedContentMode({ scene_plan: scene('智能门锁') }, ctxWithSpaces, 'asset_plan'),
    error => error?.code === 'PROVIDER_RESPONSE_INVALID'
      && error.content_mode_violations.includes('scene_plan.advertised_subject'),
    '模型刚返回真实广告主体时必须在生成阶段拒绝，不能等到保存阶段',
  );
  assert.throws(
    () => assetPlan.assertGeneratedContentMode({
      story_seed: { advertised_subject: '智能门锁', product_proof_requirements: ['展示开锁'] },
    }, ctxWithSpaces, 'asset_plan'),
    error => error?.content_mode_violations.includes('story_seed.advertised_subject')
      && error.content_mode_violations.includes('story_seed.product_proof_requirements'),
  );

  const taskId = 'mode-placeholder-recovery';
  const ctx = context('第一段剧情。 第二段剧情。');
  storage.createTask({ id: taskId, brief: ctx.brief, content_revision: 1, request: ctx });
  storage.saveOutput(taskId, 'context', ctx);
  const currentFingerprint = assetPlan.fingerprint(storage.getTask(taskId), ctx);
  sectionRecovery.saveCheckpointAtomic(taskId, 'asset_plan_draft_checkpoint', {
    cast_profiles: cast(), prop_plan: [], scene_plan: scene(),
  }, ctx, {
    status: 'asset_plan_sections_missing',
    fingerprint: currentFingerprint,
    replace_incompatible: true,
  });

  let unifiedCalls = 0;
  let recoveryCalls = 0;
  modelGateway.generateText = async (options = {}) => {
    assert.equal(typeof options.validateText, 'function', '资产规划模型调用必须携带内容模式语义验收器');
    if (options.stage === 'new_story_ad.asset_plan') {
      unifiedCalls += 1;
      throw new Error('检查点命中时不得调用主规划');
    }
    recoveryCalls += 1;
    assert.equal(options.stage, 'new_story_ad.asset_plan_section_patch');
    const storySeed = { logline: '跨越千年的重逢', opening: '祭台分别', development: '等待千年', turning_point: '竹海相遇', resolution: '静静相望' };
    const payload = {
      required_missing_sections: ['story_seed'],
      section_patch: { section: 'story_seed', value: storySeed },
    };
    await options.validateText(JSON.stringify(payload), { parsed_json: payload });
    return { text: JSON.stringify(payload), used_model: 'mock/recovery', fallback_used: false, failed_models: [] };
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({ payload, repaired: false, assessment: { pass: true } });

  const recovered = await assetPlan.generate(taskId);
  assert.equal(unifiedCalls, 0, '语义相同的失败续作不得重复调用主规划');
  assert.equal(recoveryCalls, 1, '只允许调用一次缺失故事种子恢复');
  assert.equal(recovered.advertised_subject, '');
  assert.equal(storage.getOutput(taskId, 'asset_plan').story_seed.logline, '跨越千年的重逢');

  const staleTaskId = 'mode-stale-contract-checkpoint';
  storage.createTask({ id: staleTaskId, brief: ctx.brief, content_revision: 1, request: ctx });
  storage.saveOutput(staleTaskId, 'context', ctx);
  storage.saveOutput(staleTaskId, 'asset_plan_draft_checkpoint', {
    ...checkpointLineage.checkpointFields(storage.getTask(staleTaskId)),
    contract_version: 'asset-plan-section-recovery-v1',
    generation_id: sectionRecovery.resolveGenerationId(storage.getTask(staleTaskId), {
      fingerprint: assetPlan.fingerprint(storage.getTask(staleTaskId), ctx),
    }),
    status: 'asset_plan_sections_missing',
    fingerprint: assetPlan.fingerprint(storage.getTask(staleTaskId), ctx),
    content_mode: 'narrative_story',
    reusable: true,
    payload: { cast_profiles: cast(), prop_plan: [], scene_plan: scene() },
  });
  const callsBeforeStale = unifiedCalls + recoveryCalls;
  await assert.rejects(
    assetPlan.generate(staleTaskId),
    error => error?.code === 'ASSET_PLAN_CHECKPOINT_CAS_FAILED'
      && error.cas_issues?.includes('checkpoint_contract_mismatch'),
    '旧恢复合同检查点必须在模型调用前拒绝，不能静默复用或只改版本号',
  );
  assert.equal(unifiedCalls + recoveryCalls, callsBeforeStale, '旧合同检查点被拒绝时不得触发模型调用');

  console.log(JSON.stringify({
    passed: true,
    semantic_whitespace_fingerprint_stable: true,
    narrative_marker_canonicalized: true,
    generation_time_crosstalk_rejected: true,
    repeated_unified_call_on_resume: unifiedCalls,
    missing_section_calls: recoveryCalls,
    stale_contract_checkpoint_blocked: true,
    real_model_calls: 0,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
