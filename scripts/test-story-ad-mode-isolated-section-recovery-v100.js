'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-mode-isolated-recovery-v100-'));
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

function narrativeContext(id) {
  return {
    request_id: id,
    brief: '古代恋人在祭台分别，千年后在竹海重逢。',
    content_mode: 'narrative_story',
    content_mode_source: 'user',
    product_presentation: { mode: 'narrative_story', subject: '', standalone_generation_supported: false },
    expected_people: 2,
    cast_mode: 'dual',
    target_duration: 60,
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

function commercialContext(id) {
  return {
    ...narrativeContext(id),
    brief: '为智能门锁制作广告，年轻女性回家并展示开锁过程。',
    content_mode: 'commercial_subject',
    product_subject: '智能门锁',
    product_presentation: { mode: 'commercial_subject', subject: '智能门锁', standalone_generation_supported: true },
    expected_people: 1,
    cast_mode: 'single',
  };
}

function onlyNarrativeCast() {
  return {
    cast_profiles: [
      { id: 'ancient_lead', name: '古代恋人', role: '古代线主角', appearanceText: '年轻清俊', wardrobeText: '古代华服', look_profiles: [] },
      { id: 'modern_lead', name: '现代转世', role: '现代线主角', appearanceText: '年轻清秀', wardrobeText: '现代服装', look_profiles: [] },
    ],
  };
}

function onlyCommercialCast() {
  return {
    cast_profiles: [
      { id: 'homeowner', name: '归家女性', role: '产品体验者', appearanceText: '年轻都市女性', wardrobeText: '现代通勤装', look_profiles: [] },
    ],
  };
}

function narrativeRecovery({ contaminated = false } = {}) {
  return {
    prop_plan: contaminated
      ? [{ id: 'injected_product', name: '智能门锁', type: 'advertised_product', description: '不应进入剧情' }]
      : [],
    story_seed: {
      logline: '跨越千年的重逢', opening: '祭台相爱', development: '被迫分别', turning_point: '等待千年', resolution: '竹海重逢',
    },
    scene_plan: {
      business_boundary: '纯剧情爱情故事',
      advertised_subject: contaminated ? '智能门锁' : '',
      cast_mode: 'dual',
      scene_mode: 'multi',
      spaces: [
        { id: 'ancient_altar', name: '古代祭台', description: '石阶、祭台与云海形成分别空间', story_purpose: '古代分别' },
        { id: 'bamboo_sea', name: '竹海', description: '竹径与溪流形成重逢空间', story_purpose: '现代重逢' },
      ],
      forbidden: ['禁止商品、品牌、卖点与购买引导'],
    },
  };
}

function commercialRecovery({ missingSubject = false } = {}) {
  return {
    prop_plan: [{ id: 'smart_lock', name: '智能门锁', type: 'advertised_product', description: '安装在入户门上的智能门锁' }],
    story_seed: {
      logline: '展示顺畅开锁并安心归家', opening: '走近家门', development: '验证身份', turning_point: '门锁开启', resolution: '安心进门',
    },
    scene_plan: {
      business_boundary: '智能门锁使用体验广告',
      advertised_subject: missingSubject ? '' : '智能门锁',
      cast_mode: 'single',
      scene_mode: 'single',
      spaces: [{ id: 'home_entry', name: '住宅玄关', description: '入户门、智能门锁与玄关柜构成连续空间', story_purpose: '展示开锁过程' }],
      forbidden: ['禁止虚构产品功效'],
    },
  };
}

function createTask(id, ctx) {
  storage.createTask({ id, brief: ctx.brief, content_revision: 1, request: ctx });
  storage.saveOutput(id, 'context', ctx);
}

(async () => {
  const calls = { unified: 0, recovery: 0 };
  let failRecoveryOnceFor = '';
  modelGateway.generateText = async (options = {}) => {
    if (options.stage === 'new_story_ad.asset_plan') {
      calls.unified += 1;
      const payload = options.taskId.startsWith('commercial') ? onlyCommercialCast() : onlyNarrativeCast();
      return { text: JSON.stringify(payload), used_model: 'mock/unified', fallback_used: false, failed_models: [] };
    }
    if (options.stage === 'new_story_ad.asset_plan_section_patch') {
      calls.recovery += 1;
      if (failRecoveryOnceFor === options.taskId) {
        failRecoveryOnceFor = '';
        const error = new Error('模拟恢复供应商暂时失败');
        error.code = 'PROVIDER_5XX';
        throw error;
      }
      const payload = options.taskId === 'narrative-crosstalk'
        ? narrativeRecovery({ contaminated: true })
        : (options.taskId === 'commercial-missing-subject'
          ? commercialRecovery({ missingSubject: true })
          : (options.taskId.startsWith('commercial') ? commercialRecovery() : narrativeRecovery()));
      const request = JSON.parse(options.userPrompt || '{}');
      const section = request.required_missing_sections?.[0];
      return {
        text: JSON.stringify({
          required_missing_sections: [section],
          section_patch: { section, value: payload[section] },
        }),
        used_model: 'mock/section-recovery', fallback_used: false, failed_models: [],
      };
    }
    throw new Error(`未预期的模型阶段：${options.stage}`);
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({ payload, repaired: false, assessment: { pass: true } });

  assert.equal(modelGateway.routeStage('new_story_ad.asset_plan_missing_sections_recovery'), 'new_story_ad.asset_plan_missing_sections_recovery');
  assert.equal(modelGateway.routeStage('new_story_ad.asset_plan_section_patch'), 'new_story_ad.asset_plan_section_patch');
  assert.equal(modelGateway.routeStage('new_story_ad.asset_plan_scene_recovery'), 'new_story_ad.asset_plan_scene_recovery');

  const sameTask = { id: 'fingerprint-check', content_revision: 1 };
  const narrativeFingerprint = assetPlan.fingerprint(sameTask, narrativeContext('fingerprint-check'));
  const commercialFingerprint = assetPlan.fingerprint(sameTask, { ...narrativeContext('fingerprint-check'), content_mode: 'commercial_subject', product_presentation: { mode: 'commercial_subject' } });
  assert.notEqual(narrativeFingerprint, commercialFingerprint, '剧情与广告必须使用不同检查点指纹');

  createTask('narrative-only-cast', narrativeContext('narrative-only-cast'));
  failRecoveryOnceFor = 'narrative-only-cast';
  await assert.rejects(() => assetPlan.generate('narrative-only-cast'), /模拟恢复供应商暂时失败/);
  const narrativeCheckpoint = storage.getOutput('narrative-only-cast', 'asset_plan_draft_checkpoint');
  assert.equal(narrativeCheckpoint.reusable, true, '只有有效人物区段的草稿也必须可复用');
  assert.deepEqual(narrativeCheckpoint.valid_sections, ['cast_profiles']);
  assert.deepEqual(narrativeCheckpoint.missing_sections, ['prop_plan', 'scene_plan', 'story_seed']);
  assert.equal(narrativeCheckpoint.content_mode, 'narrative_story');
  const unifiedBeforeRetry = calls.unified;
  const narrativePlan = await assetPlan.generate('narrative-only-cast');
  assert.equal(calls.unified, unifiedBeforeRetry, '恢复重试不得再次调用已成功的统一规划');
  assert.equal(narrativePlan.spaces.length, 2);
  const savedNarrative = storage.getOutput('narrative-only-cast', 'asset_plan');
  assert.equal(savedNarrative.model_meta.content_mode, 'narrative_story');
  assert.deepEqual(savedNarrative.model_meta.recovered_sections, ['prop_plan', 'scene_plan', 'story_seed']);
  assert.equal(savedNarrative.prop_plan.some(item => item.type === 'advertised_product'), false);
  assert.equal(savedNarrative.scene_plan.advertised_subject, '');

  createTask('commercial-only-cast', commercialContext('commercial-only-cast'));
  const commercialPlan = await assetPlan.generate('commercial-only-cast');
  assert.equal(commercialPlan.advertised_subject, '智能门锁');
  const savedCommercial = storage.getOutput('commercial-only-cast', 'asset_plan');
  assert.equal(savedCommercial.model_meta.content_mode, 'commercial_subject');
  assert(savedCommercial.prop_plan.some(item => item.type === 'advertised_product'));

  createTask('narrative-crosstalk', narrativeContext('narrative-crosstalk'));
  await assert.rejects(
    () => assetPlan.generate('narrative-crosstalk'),
    error => (error?.code === 'ASSET_PLAN_SECTION_RECOVERY_INCOMPLETE'
      && error.section_issues?.includes('narrative_prop_plan_contains_advertised_product'))
      || (error?.code === 'PROVIDER_RESPONSE_INVALID'
        && error.content_mode_violations?.includes('prop_plan.advertised_product')),
    '纯剧情恢复出现广告结构时必须在模型输出验收阶段阻断',
  );
  assert.equal(storage.getOutput('narrative-crosstalk', 'asset_plan'), null);

  createTask('commercial-missing-subject', commercialContext('commercial-missing-subject'));
  await assert.rejects(
    () => assetPlan.generate('commercial-missing-subject'),
    error => error?.code === 'PROVIDER_RESPONSE_INVALID'
      && error.content_mode_violations.includes('scene_plan.advertised_subject_missing'),
    '商业广告恢复缺少广告主体时必须在模型输出验收阶段阻断',
  );
  assert.equal(storage.getOutput('commercial-missing-subject', 'asset_plan'), null);

  console.log(JSON.stringify({
    passed: true,
    recovery_route: modelGateway.routeStage('new_story_ad.asset_plan_missing_sections_recovery'),
    narrative_checkpoint_reused: true,
    narrative_commercial_fingerprint_isolated: true,
    narrative_crosstalk_blocked: true,
    commercial_crosstalk_blocked: true,
    repeated_unified_call_on_retry: 0,
    unified_calls: calls.unified,
    recovery_calls: calls.recovery,
    real_model_calls: 0,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
