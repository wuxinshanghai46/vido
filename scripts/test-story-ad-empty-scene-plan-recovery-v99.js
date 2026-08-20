'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-empty-scene-plan-v99-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const outputLanguage = require('../src/services/newStoryAd/outputLanguageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');

const originalGenerateText = modelGateway.generateText;
const originalEnsureChineseOutput = outputLanguage.ensureChineseOutput;

function context(id) {
  return {
    request_id: id,
    brief: '古代恋人在祭台生死分别，千年后男主在曾经相遇的竹海遇见女主转世，两人静静相望。',
    content_mode: 'narrative_story',
    product_presentation: { mode: 'narrative_story', subject: '', standalone_generation_supported: false },
    expected_people: 3,
    cast_mode: 'dual',
    target_duration: 90,
    shot_count: 12,
    output_ratio: '9:16',
    characters: [],
    cast_profiles: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [],
    assets: [],
    forbidden: [],
    creative_direction: {},
    performance: {},
  };
}

function incompleteUnifiedPayload() {
  return {
    cast_profiles: [
      { id: 'male_lead', name: '男主', role: '跨越千年的等待者', age_range: '28~32岁', ethnicity: '东亚原创男性外貌', asset_scope: 'primary', appearanceText: '清俊沉静', wardrobeText: '华丽古装', look_profiles: [] },
      { id: 'female_lead_ancient', name: '云知月', role: '古代恋人', age_range: '22~26岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', appearanceText: '清秀年轻', wardrobeText: '古代华服', look_profiles: [] },
      { id: 'female_lead_modern', name: '林知月', role: '女主的现代转世，独立身份', age_range: '22~26岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', identity_continuity: 'reincarnation', appearanceText: '清秀年轻', wardrobeText: '现代服装', look_profiles: [] },
    ],
    prop_plan: [],
    story_seed: {
      logline: '一场跨越千年的重逢',
      opening: '古代相爱',
      development: '祭台分别',
      turning_point: '千年等待',
      resolution: '竹海重逢',
    },
  };
}

function recoveredScenePayload() {
  return {
    scene_plan: {
      business_boundary: '纯剧情神话爱情故事',
      advertised_subject: '',
      cast_mode: 'dual',
      scene_mode: 'multi',
      spaces: [
        { id: 'ancient_altar', name: '古代祭台', description: '山巅祭台、石阶与云海构成生死分别空间', story_purpose: '古代生死分别' },
        { id: 'bamboo_sea', name: '竹海', description: '竹径、溪流与相遇空地构成跨时代重逢空间', story_purpose: '古代相遇与现代转世重逢' },
      ],
      asset_strategy: [],
      story_strategy: [],
      forbidden: ['禁止商品、品牌、卖点和购买引导'],
      suggested_shot_count: 12,
    },
  };
}

function commercialContext(id) {
  return {
    ...context(id),
    brief: '为智能门锁制作一条广告，年轻女性回到住宅玄关，展示开锁和安心回家的过程。',
    product_subject: '智能门锁',
    content_mode: 'commercial_subject',
    product_presentation: { mode: 'commercial_subject', subject: '智能门锁', standalone_generation_supported: true },
    expected_people: 1,
    cast_mode: 'single',
  };
}

function commercialIncompletePayload() {
  return {
    cast_profiles: [{ id: 'homeowner', name: '归家女性', role: '演示门锁使用', age_range: '25~30岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', appearanceText: '年轻都市女性', wardrobeText: '现代通勤装', look_profiles: [] }],
    prop_plan: [{ id: 'smart_lock', name: '智能门锁', type: 'advertised_product', description: '安装在入户门上的智能门锁' }],
    story_seed: { logline: '顺畅开锁并安心归家', opening: '走近家门', development: '验证身份', turning_point: '门锁开启', resolution: '安心进门' },
  };
}

function commercialRecoveredScenePayload() {
  return {
    scene_plan: {
      business_boundary: '智能门锁使用体验广告', advertised_subject: '智能门锁', cast_mode: 'single', scene_mode: 'single',
      spaces: [{ id: 'home_entry', name: '住宅玄关', description: '入户门、智能门锁、玄关柜与室内通道构成连续空间', story_purpose: '展示开锁和归家体验' }],
      asset_strategy: [], story_strategy: [], forbidden: ['禁止虚构产品功效'], suggested_shot_count: 5,
    },
  };
}

function createTask(id) {
  const ctx = context(id);
  storage.createTask({ id, brief: ctx.brief, content_revision: 1, request: ctx });
  storage.saveOutput(id, 'context', ctx);
}

function createCommercialTask(id) {
  const ctx = commercialContext(id);
  storage.createTask({ id, brief: ctx.brief, content_revision: 1, request: ctx });
  storage.saveOutput(id, 'context', ctx);
}

(async () => {
  const calls = { unified: 0, recovery: 0 };
  let failRecoveryOnce = false;
  const structuredRequests = [];
  modelGateway.generateText = async (options = {}) => {
    structuredRequests.push({ stage: options.stage, structuredOutput: options.structuredOutput, maxTokens: options.maxTokens });
    if (options.stage === 'new_story_ad.asset_plan') {
      calls.unified += 1;
      return { text: JSON.stringify(options.taskId === 'commercial-empty-scenes' ? commercialIncompletePayload() : incompleteUnifiedPayload()), used_model: 'mock/unified', fallback_used: false, failed_models: [] };
    }
    if (options.stage === 'new_story_ad.asset_plan_section_patch') {
      calls.recovery += 1;
      if (failRecoveryOnce) {
        failRecoveryOnce = false;
        const error = new Error('模拟场景恢复供应商失败');
        error.code = 'PROVIDER_5XX';
        throw error;
      }
      const request = JSON.parse(options.userPrompt || '{}');
      const section = request.required_missing_sections?.[0];
      const recoveredPayload = options.taskId === 'commercial-empty-scenes' ? commercialRecoveredScenePayload() : recoveredScenePayload();
      return {
        text: JSON.stringify({
          required_missing_sections: [section],
          section_patch: { section, value: recoveredPayload[section] },
        }),
        used_model: 'mock/scene-recovery', fallback_used: false, failed_models: [],
      };
    }
    throw new Error(`未预期的模型阶段：${options.stage}`);
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({ payload, repaired: false, assessment: { pass: true } });

  createTask('empty-scenes-recovered');
  const recovered = await assetPlan.generate('empty-scenes-recovered');
  assert.equal(recovered.spaces.length, 2, '统一规划遗漏 spaces 时必须由专用场景规划恢复并继续保存');
  assert.equal(calls.unified, 1);
  assert.equal(calls.recovery, 1);
  assert.equal(storage.getOutput('empty-scenes-recovered', 'asset_plan').model_meta.scene_recovery_used, true);
  assert.equal(storage.getOutput('empty-scenes-recovered', 'asset_plan').model_meta.model_call_count, 2);
  assert.equal(storage.getOutput('empty-scenes-recovered', 'asset_plan_draft_checkpoint'), null, '成功后必须清理不完整草稿检查点');
  recovered.spaces.forEach(space => {
    assert(space.id);
    ['layoutText', 'materialLightText', 'interactionText', 'negativeText'].forEach(key => assert(space.scene_spec?.[key], `${space.name} 缺少 ${key}`));
  });
  assert.doesNotMatch(JSON.stringify(recovered), /广告主体|商业配色|人物或商品/);

  createTask('empty-scenes-retry');
  failRecoveryOnce = true;
  await assert.rejects(() => assetPlan.generate('empty-scenes-retry'), /模拟场景恢复供应商失败/);
  const checkpoint = storage.getOutput('empty-scenes-retry', 'asset_plan_draft_checkpoint');
  assert.equal(checkpoint.status, 'asset_plan_sections_recovery_ready');
  assert.equal(checkpoint.reusable, true);
  const unifiedCallsBeforeRetry = calls.unified;
  const retryResult = await assetPlan.generate('empty-scenes-retry');
  assert.equal(retryResult.spaces.length, 2);
  assert.equal(calls.unified, unifiedCallsBeforeRetry, '场景恢复失败后重试必须复用完整的人物/故事草稿，不得再次收费生成统一规划');
  assert.equal(storage.getOutput('empty-scenes-retry', 'asset_plan').model_meta.draft_checkpoint_reused, true);
  assert.equal(storage.getOutput('empty-scenes-retry', 'asset_plan').model_meta.model_call_count, 1, '重试轮只允许调用缺失的场景恢复模型');

  createCommercialTask('commercial-empty-scenes');
  const commercial = await assetPlan.generate('commercial-empty-scenes');
  assert.equal(commercial.spaces.length, 1);
  assert.match(JSON.stringify(commercial), /广告主体|商业配色|人物或商品/, '商业广告恢复分支必须保留广告场景合同');
  assert.equal(commercial.advertised_subject, '智能门锁');

  assert(structuredRequests.some(item => item.stage === 'new_story_ad.asset_plan'
    && item.structuredOutput?.mode === 'json_object' && item.maxTokens === 6200));
  assert(structuredRequests.some(item => item.stage === 'new_story_ad.asset_plan_section_patch'
    && item.structuredOutput?.mode === 'json_object'));

  console.log(JSON.stringify({
    passed: true,
    reproduced_space_count: 0,
    recovered_space_count: recovered.spaces.length,
    commercial_recovered_space_count: commercial.spaces.length,
    unified_calls: calls.unified,
    scene_recovery_calls: calls.recovery,
    retry_reused_partial_draft: true,
    repeated_unified_call_on_retry: 0,
    real_model_calls: 0,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
