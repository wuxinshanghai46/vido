'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const subjectProfileText = require('../src/services/newStoryAd/subjectProfileTextService');
const workspacePerson = require('../src/services/storyAdWorkspace/personLookProjectionService');
const assistProfiles = require('../src/services/newStoryAd/assistSubjectProfileService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const personIdentity = require('../src/services/newStoryAd/personIdentityContractService');

const actionOnly = '不介绍身份，承担触摸、走过、驻足等画面动作';
const background = contextBuilder.backgroundPerformerCharacter({
  id: 'char_chenmo', name: '陈默', role: '背景出镜人物', age_range: '30岁左右', description: actionOnly,
});
assert.equal(background.performanceText, actionOnly, '背景人物动作说明必须进入 performanceText');

const resolved = subjectProfileText.profileTexts(background);
assert.equal(resolved.appearanceText, '', '通用 description 不得再冒充人物外貌提示词');

const projected = workspacePerson.personProfile(background);
assert.equal(projected.appearanceText, '', '工作台不得把动作说明投影到外貌与气质字段');
assert.equal(projected.performanceText, actionOnly, '工作台必须保留独立表演动作字段');

const normalizedContext = contextBuilder.buildContext({
  brief: '背景人物在不锈钢展厅触摸材质，旁白客观介绍产品。',
  content_mode: 'commercial_subject', content_mode_source: 'user', product_subject: '不锈钢装饰材料',
  cast_mode: 'single', expected_people: 1, cast_profiles: [background],
  brief_intake: { cast_intent: { confirmed: true, mode: 'single', expected_people: 1, background_people: true,
    presentation: 'background_only', participants: [background], source: 'semantic_dialogue' } },
});
assert.equal(normalizedContext.cast_profiles[0].appearanceText, '', '上下文规范化不得把动作说明写入外貌提示词');
assert.equal(normalizedContext.cast_profiles[0].performanceText, actionOnly, '上下文必须独立保留人物动作要求');
const personSpecContext = contextBuilder.buildContext({
  brief: '人物触摸产品，旁白介绍。', content_mode: 'commercial_subject', content_mode_source: 'user',
  product_subject: '产品', cast_mode: 'single', expected_people: 1,
  person_spec: { castMode: 'single', expectedPeople: 1, description: actionOnly },
  cast_profiles: [background],
});
assert.equal(personSpecContext.person_spec.appearanceText || '', '', '全局 person_spec.description 也不得冒充外貌提示词');

const detailedAppearance = '30岁左右东亚女性，鹅蛋脸与清晰下颌线，眉眼舒展、鼻唇比例自然；中等身高、身形匀称且肩背挺直；暖调自然肤色保留细微纹理，目光专注，神态沉静可信。';
const detailedWardrobe = '雾灰色棉质衬衫搭配深炭灰直筒长裤和黑色低跟皮鞋；固定佩戴银色细表，除此之外无配饰，服装颜色、材质纹理、版型和鞋履跨视图保持一致。';
const detailedHair = '深棕色齐肩直发保持固定侧分与发色；自然底妆保留真实肤质，眉形清晰、唇色自然；不佩戴眼镜、帽子、发饰和其它首饰。';
const detailedNegative = '禁止改变年龄、性别、脸型、五官和人物身份；禁止变换发型发色、妆容、服装、鞋履、颜色和配饰；禁止网红脸、塑料皮肤、肢体畸形与多余人物。';
const draft = {
  cast_profiles: [{
    id: 'char_chenmo', displayName: '陈默', roleName: '背景出镜人物', appearanceText: detailedAppearance,
    look_profiles: [{ id: 'look_base', name: '展厅基础造型', wardrobeText: detailedWardrobe,
      hairMakeupText: detailedHair, negativeText: detailedNegative }],
  }],
};
const quality = assistProfiles.modelDraftQuality(draft, {
  kind: 'human', index: 0, id: 'char_chenmo', profile: background,
}, subjectProfileText.ASSIST_DETAIL_FIELDS, normalizedContext);
assert.equal(quality.valid, true, `首套造型里的完整服装妆造不得被原始响应校验误拒绝：${quality.issues.join(',')}`);

const normalizedDraft = assistProfiles.normalizeCastProfiles(draft, normalizedContext, {
  kind: 'human', index: 0, id: 'char_chenmo', profile: background,
})[0];
assetPlan.assertDetailedPersonProfiles([normalizedDraft]);
assert.match(normalizedDraft.appearanceText, /鹅蛋脸/);
assert.match(normalizedDraft.wardrobeText, /衬衫/);
assert.match(normalizedDraft.hairMakeupText, /侧分/);
assert.match(normalizedDraft.negativeText, /禁止改变年龄/);

const identityContract = personIdentity.buildPersonContract({ id: 'char_chenmo', description: actionOnly }, {});
assert.equal(identityContract.identity.face_description, '', '图片身份合同不得从通用动作说明生成脸部描述');

const plannerSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/independentPersonPlanService.js'), 'utf8');
assert.match(plannerSource, /assist_replaceable_fields:\s*subjectProfileText\.ASSIST_DETAIL_FIELDS/,
  '独立人物规划只应要求模型补齐四个生产细节字段，不能重写姓名或身份');
const assistSource = fs.readFileSync(path.join(__dirname, '../src/services/newStoryAd/storyAdService.js'), 'utf8');
assert.match(assistSource, /description、performanceText、动作、走位、触摸、驻足/,
  '人物提示词必须显式禁止动作说明污染外貌字段');
assert.match(assistSource, /structuredOutput:\s*assistSubjectTarget\s*\?\s*\{\s*mode:\s*'json_object'/,
  '独立人物规划必须要求结构化 JSON 输出');

console.log(JSON.stringify({
  passed: true,
  checks: 19,
  description_to_appearance: false,
  performance_preserved: true,
  nested_look_details_accepted: true,
  image_prompt_requires_detailed_profile: true,
  paid_model_calls: 0,
}));
