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

function plotBeats({ commercial = false } = {}) {
  const rows = [
    ['opening', '开始', commercial ? '住宅玄关' : '古代祭台', '建立人物与地点'],
    ['development', '随后', commercial ? '住宅玄关' : '古代祭台', commercial ? '展示智能门锁验证过程' : '推进分别与等待'],
    ['turning_point', '转折时刻', commercial ? '住宅玄关' : '竹海', commercial ? '智能门锁开启' : '完成跨时代转折'],
    ['resolution', '结尾', commercial ? '住宅玄关' : '竹海', commercial ? '人物安心归家' : '两人在竹海重逢'],
  ];
  return rows.map(([phase, time, location, summary], index) => ({
    id: `beat_${index + 1}`, phase, era: commercial ? '当代' : (index < 2 ? '古代' : '现代'),
    time_anchor: time, location, production_state: `${location}的连续可见环境`,
    production_relation: { era: index === 0 || (!commercial && index === 2) ? 'changed' : 'same', time: index === 0 ? 'changed' : 'continuous', location: index === 0 || (!commercial && index === 2) ? 'changed' : 'same', environment: index === 0 || (!commercial && index === 2) ? 'changed' : 'same' },
    production_requirements: { layout: `${location}固定布局`, material_light: '连续真实材质与光线', interaction: summary, negative: commercial ? '禁止虚构产品功效' : '禁止商品、品牌和销售引导' },
    summary, cause: index ? '由上一节拍结果触发' : '故事开始', consequence: index === rows.length - 1 ? '形成结局' : '推动下一节拍',
  }));
}

function detailedPerson(profile = {}, index = 0) {
  const wardrobe = `${profile.wardrobeText || '符合角色身份的完整服装'}；深灰色羊毛外套搭配米色棉质衬衫，下装为黑色直筒长裤，脚穿棕色皮鞋，佩戴银色手表且无其他配饰，所有镜头保持一致。`;
  const hairMakeup = '自然黑色长发或短发，三七分缝且发型固定；使用清透素颜妆，保留真实肤质；不佩戴眼镜、耳饰、帽子或其他首饰。';
  return {
    ...profile,
    appearanceText: `${profile.appearanceText || ''}；椭圆脸型，眉眼清晰，鼻梁挺直，唇形自然；暖色真实肤色和皮肤纹理，身形修长、肩背挺直、体态克制，目光沉静且神态可靠，保持原创真人身份稳定。`,
    wardrobeText: wardrobe,
    hairMakeupText: hairMakeup,
    negativeText: '禁止改变年龄、性别、脸型、五官、发型、服装、鞋履和配饰；禁止网红脸、塑料皮肤、肢体畸形和多余人物。',
    look_profiles: [{ id: `${profile.id || `person_${index + 1}`}_look_1`, name: '主造型', story_state: index < 2 ? '古代段落' : '现代段落', wardrobeText: wardrobe, hairMakeupText: hairMakeup }],
  };
}

function incompleteUnifiedPayload() {
  return {
    cast_profiles: [
      detailedPerson({ id: 'male_lead', name: '男主', role: '跨越千年的等待者', age_range: '28~32岁', ethnicity: '东亚原创男性外貌', asset_scope: 'primary', appearanceText: '清俊沉静', wardrobeText: '华丽古装' }, 0),
      detailedPerson({ id: 'female_lead_ancient', name: '云知月', role: '古代恋人', age_range: '22~26岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', appearanceText: '清秀年轻', wardrobeText: '古代华服' }, 1),
      detailedPerson({ id: 'female_lead_modern', name: '林知月', role: '女主的现代转世，独立身份', age_range: '22~26岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', identity_continuity: 'reincarnation', appearanceText: '清秀年轻', wardrobeText: '现代服装' }, 2),
    ],
    prop_plan: [],
    story_seed: {
      logline: '一场跨越千年的重逢',
      opening: '古代相爱',
      development: '祭台分别',
      turning_point: '千年等待',
      resolution: '竹海重逢',
      plot_beats: plotBeats(),
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
    cast_profiles: [detailedPerson({ id: 'homeowner', name: '归家女性', role: '演示门锁使用', age_range: '25~30岁', ethnicity: '东亚原创女性外貌', asset_scope: 'primary', appearanceText: '年轻都市女性', wardrobeText: '现代通勤装' }, 2)],
    prop_plan: [{ id: 'smart_lock', name: '智能门锁', type: 'advertised_product', description: '安装在入户门上的智能门锁' }],
    story_seed: { logline: '顺畅开锁并安心归家', opening: '走近家门', development: '验证身份', turning_point: '门锁开启', resolution: '安心进门', advertised_subject: '智能门锁', product_proof_requirements: ['展示开锁过程'], plot_beats: plotBeats({ commercial: true }) },
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
      assert(Object.prototype.hasOwnProperty.call(recoveredPayload, section), `empty-scene fixture unexpectedly requested non-scene section: ${section}`);
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
  assert.equal(recovered.spaces.length, 2, '统一规划遗漏 spaces 时必须从完整剧情节拍确定性编译场景并继续保存');
  assert.equal(calls.unified, 1);
  assert.equal(calls.recovery, 0, '完整剧情节拍可确定性编译场景时不得追加场景恢复模型费用');
  assert.notEqual(storage.getOutput('empty-scenes-recovered', 'asset_plan').model_meta.scene_recovery_used, true);
  assert.equal(storage.getOutput('empty-scenes-recovered', 'asset_plan').model_meta.model_call_count, 1);
  assert.equal(storage.getOutput('empty-scenes-recovered', 'asset_plan_draft_checkpoint'), null, '成功后必须清理不完整草稿检查点');
  recovered.spaces.forEach(space => {
    assert(space.id);
    ['layoutText', 'materialLightText', 'interactionText', 'negativeText'].forEach(key => assert(space.scene_spec?.[key], `${space.name} 缺少 ${key}`));
  });
  assert.doesNotMatch(JSON.stringify(recovered), /广告主体|商业配色|人物或商品/);

  createTask('empty-scenes-retry');
  failRecoveryOnce = false;
  const retryResult = await assetPlan.generate('empty-scenes-retry');
  assert.equal(retryResult.spaces.length, 2);
  assert.equal(calls.recovery, 0, '确定性场景编译不得受未调用的恢复供应商故障影响');
  assert.equal(storage.getOutput('empty-scenes-retry', 'asset_plan_draft_checkpoint'), null);
  assert.equal(storage.getOutput('empty-scenes-retry', 'asset_plan').model_meta.model_call_count, 1);

  createCommercialTask('commercial-empty-scenes');
  const commercial = await assetPlan.generate('commercial-empty-scenes');
  assert.equal(commercial.spaces.length, 1);
  assert.match(JSON.stringify(commercial), /广告主体|商业配色|人物或商品/, '商业广告恢复分支必须保留广告场景合同');
  assert.equal(commercial.advertised_subject, '智能门锁');

  assert(structuredRequests.some(item => item.stage === 'new_story_ad.asset_plan'
    && item.structuredOutput?.mode === 'json_object' && item.maxTokens === 6200));
  assert.equal(structuredRequests.filter(item => item.stage === 'new_story_ad.asset_plan_section_patch').length, 1, '纯剧情完整节拍不得追加模型；商业广告仍需一次场景合同修复');

  console.log(JSON.stringify({
    passed: true,
    reproduced_space_count: 0,
    recovered_space_count: recovered.spaces.length,
    commercial_recovered_space_count: commercial.spaces.length,
    unified_calls: calls.unified,
    scene_recovery_calls: calls.recovery,
    narrative_scene_compilation: 'deterministic_no_extra_model',
    commercial_scene_contract_recovery_calls: 1,
    real_model_calls: 0,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
