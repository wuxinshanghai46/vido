'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-person-plan-v194-'));
process.env.OUTPUT_DIR = outputDir;
const storage = require('../src/services/newStoryAd/storageService');
const gateway = require('../src/services/newStoryAd/modelGateway');
const language = require('../src/services/newStoryAd/outputLanguageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const originalGenerate = gateway.generateText;
const originalLanguage = language.ensureChineseOutput;

const profile = suffix => ({
  id: 'linlan', name: '林岚', displayName: '林岚', role: '空间设计师', roleName: '空间设计师', age: '25岁', age_range: '25岁', ethnicity: '东亚外貌设计', asset_scope: 'primary',
  appearanceText: `25岁东亚女性，鹅蛋脸与清晰下颌线，眉眼舒展、鼻唇比例自然；身形修长匀称、肩背挺直；暖调肤色保留真实纹理，目光专注，神态沉静专业${suffix}`,
  wardrobeText: '深炭灰羊毛西装外套搭配象牙白真丝衬衫和同色直筒西裤，黑色低跟皮鞋；银色细表与小号耳钉固定佩戴，颜色、面料纹理和配饰位置保持一致。',
  hairMakeupText: '深棕色长发束成低马尾，侧分发线固定；自然底妆保留肤质，眉形利落、裸色唇妆；不戴眼镜，固定佩戴小号银色耳钉。',
  negativeText: '禁止改变年龄、脸型、五官和人物身份；禁止变换发型发色、妆容、服装、鞋履和配饰；禁止网红脸、塑料皮肤、过度磨皮、畸形肢体及多余人物。',
});
const scenePlan = { advertised_subject: '空间设计服务', cast_mode: 'single', scene_mode: 'single', spaces: [{ id: 'studio', name: '设计工作室', description: '真实设计工作室', story_purpose: '展示设计过程', scene_spec: { layoutText: '工作台、样板墙和通道位置固定', materialLightText: '木材与自然侧光', interactionText: '人物从工作台走向样板墙', negativeText: '禁止其它地点', storyStates: [], interactionAnchors: [], routes: [], propPlacements: [] } }], asset_strategy: [], story_strategy: [], forbidden: [], suggested_shot_count: 5 };
const fullPlan = cast => ({ cast_profiles: [cast], prop_plan: [], scene_plan: scenePlan, story_seed: { logline: '设计师完成空间提案', opening: '进入工作室', development: '检查材料', turning_point: '确认方案', resolution: '交付设计' } });

(async () => {
  let calls = 0;
  gateway.generateText = async options => {
    calls += 1;
    const cast = profile(options.stage === 'new_story_ad.asset_plan_section_patch' ? '，左眉尾有一颗浅痣作为稳定识别特征。' : '。');
    const payload = options.stage === 'new_story_ad.asset_plan_section_patch'
      ? { required_missing_sections: ['cast_profiles'], section_patch: { section: 'cast_profiles', value: [cast] } }
      : fullPlan(cast);
    return { text: JSON.stringify(payload), used_model: 'deterministic/v194', fallback_used: false, failed_models: [] };
  };
  language.ensureChineseOutput = async ({ payload }) => ({ payload, repaired: false, assessment: { pass: true } });
  const context = { brief: '空间设计师在工作室完成材料提案', brief_source: 'user', product_subject: '空间设计服务', content_mode: 'commercial_subject', cast_mode: 'single', expected_people: 1, planning_cast_count: 1, visual_asset_count: 1, characters: [], assets: [], forbidden: [], creative_direction: {}, performance: {}, cast_profiles: [], pet_profiles: [], prop_assets: [], scene_assets: [], target_duration: 30, shot_count: 5, output_ratio: '9:16' };
  storage.createTask({ id: 'person-plan-v194', brief: context.brief, content_revision: 1, request: context });
  storage.saveOutput('person-plan-v194', 'context', context);
  await assetPlan.generate('person-plan-v194');
  const regenerated = await assetPlan.replanPerson('person-plan-v194');
  assert.equal(calls, 2, '显式重新生成人物方案必须调用区段模型，不能只做版本迁移并返回旧文案');
  assert.match(regenerated[0].appearanceText, /浅痣/);
  assert.equal(assetPlan.detailedPersonProfileIssues(regenerated).length, 0);
  const userText = '用户指定：左手佩戴祖传银戒。';
  const authoritative = { ...storage.getOutput('person-plan-v194', 'context'), cast_profiles: [{ ...regenerated[0], wardrobeText: userText, field_authority: { wardrobeText: 'user' }, user_edited_fields: ['wardrobeText'] }] };
  const merged = assetPlan.normalizePlan(fullPlan(profile('，保留稳定识别特征。')), authoritative).cast_profiles[0];
  assert(merged.wardrobeText.startsWith(userText), `用户明确填写的穿着配饰事实必须逐字保留：${merged.wardrobeText}`);
  assert.match(merged.wardrobeText, /AI补充/);
  assert.throws(() => assetPlan.assertDetailedPersonProfiles([{ appearanceText: '穿深色西装。' }]), error => error.code === 'PERSON_PLAN_DETAIL_INCOMPLETE');
  const uiSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterView.js'), 'utf8');
  assert.match(uiSource, /field_authority[\s\S]{0,300}\[field, 'user'\]/, '人物表单保存必须记录用户字段权威');
  assert(!/group === 'people'[^\n]{0,500}(?:生成完整人物档案|重生成完整人物档案)/.test(uiSource), '人物卡片不得再显示档案生成按钮');
  const formSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
  const drawerSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCenterPlanningDetails.js'), 'utf8');
  assert.match(formSource, /data-ai-assist-person/, '完整视图的修改区必须保留 AI 辅助完善入口');
  assert.match(drawerSource, /data-drawer-generate/, '完整视图必须保留按最新设定生成人物图片的入口');
  console.log(JSON.stringify({ passed: true, model_calls: calls, detail_issues: 0, user_text_preserved: true, sparse_plan_rejected: true, card_generation_buttons: 0, drawer_edit_and_generate: true }, null, 2));
})().finally(() => {
  gateway.generateText = originalGenerate;
  language.ensureChineseOutput = originalLanguage;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
