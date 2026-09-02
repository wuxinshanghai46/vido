'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const flow = require('../src/services/newStoryAd/storyboardFlowConsistencyService');
const personPlan = require('../src/services/newStoryAd/independentPersonPlanService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');

const contract = {
  contract_fingerprint: 'flow-current',
  units: [{ beat_id: 'beat-1', scene_id: 'space_01_showroom' }],
};
const rebased = flow.rebaseWhenPresent([{
  index: 1, source_beat_id: 'beat-1', scene_id: 'space_01_showroom',
  scene_asset_id: 'space_01_showroom', scene_revision: 2, sceneRevision: 2,
  story_flow_contract_fingerprint: 'flow-old',
}], contract).shots[0];
assert.equal(rebased.scene_id, 'space_01_showroom');
assert.equal(rebased.scene_revision, undefined, '剧情流重绑定必须清除旧 snake_case 场景版本');
assert.equal(rebased.sceneRevision, undefined, '剧情流重绑定必须清除旧 camelCase 场景版本');

const generated = {
  appearanceText: '25岁女性，鹅蛋脸和清晰五官，身形修长挺拔，真实肤质，神态自然专注。',
  wardrobeText: '哑光米白短袖针织上衣、高腰深灰直筒西裤、黑色低跟皮鞋，银色圆钉耳饰，颜色材质跨视图一致。',
  hairMakeupText: '黑色及肩中长直发，中分且发尾微内扣；薄透底妆、浅棕眉和裸粉唇色，不佩戴帽子眼镜发带。',
  negativeText: '禁止改变年龄性别脸型五官；禁止改变发型发色妆容；禁止服装鞋履配饰变色或增减；禁止塑料皮肤和畸形肢体。',
  look_profiles: [{ id: 'look-1', wardrobeText: 'generated look' }],
};
const replaceable = personPlan.mergeGeneratedProfile({
  id: 'p1', displayName: '陈默', roleName: '背景人物', age: '25岁',
  wardrobeText: '固定穿紫色晚礼服和黑色高跟鞋',
  negativeText: '禁止出现紫色晚礼服和黑色高跟鞋',
  generation_prompt: '服装：固定穿紫色晚礼服和黑色高跟鞋',
  field_authority: { wardrobeText: 'system_default', negativeText: 'system_default' },
}, generated);
assert.equal(replaceable.wardrobeText, generated.wardrobeText);
assert(!replaceable.generation_prompt.includes('紫色晚礼服'), '可替换旧提示词不得进入新生成合同');
assert.equal(replaceable.look_profiles[0].wardrobeText, generated.wardrobeText, '首套造型必须与最终人物合同一致');

const userOwned = personPlan.mergeGeneratedProfile({
  id: 'p2', displayName: '用户人物', roleName: '主角', age: '25岁',
  appearanceText: generated.appearanceText,
  wardrobeText: '用户明确指定的蓝色西装、白衬衫、黑色皮鞋和银色腕表，材质颜色保持一致。',
  hairMakeupText: generated.hairMakeupText,
  negativeText: generated.negativeText,
  generation_prompt: '用户完整提示词',
  user_edited_fields: ['wardrobeText', 'generation_prompt'],
}, generated);
assert.equal(userOwned.wardrobeText, '用户明确指定的蓝色西装、白衬衫、黑色皮鞋和银色腕表，材质颜色保持一致。');
assert.equal(userOwned.generation_prompt, '用户完整提示词\n\n随身道具：无');

const normalized = assetPlan.normalizePlan({
  cast_profiles: [{ ...generated, id: 'p3', displayName: '人物', roleName: '角色' }],
  scene_plan: { count: 0, scenes: [] },
}, {
  cast_profiles: [{ id: 'p3', displayName: '人物', roleName: '角色', wardrobeText: userOwned.wardrobeText,
    field_authority: { wardrobeText: 'user' }, user_edited_fields: ['wardrobeText'] }],
  content_mode: 'commercial_subject', scene_assets: [], pet_profiles: [],
}, { allowPartialScene: true });
assert.equal(normalized.cast_profiles[0].wardrobeText, userOwned.wardrobeText);
assert(!normalized.cast_profiles[0].wardrobeText.includes('AI补充'), '资产方案归一化不得拼接两个服装合同');

const assetView = read('public/story-ad/views/assetCenterView.js');
const drawer = read('public/story-ad/views/assetCenterPlanningDetails.js');
const dossier = read('public/story-ad/views/personDossierShowcase.js');
const actorSources = read('public/story-ad/views/assetCenterPersonSources.js');
assert(!assetView.includes('中性参考图（1 张，可能计费）'));
assert(!drawer.includes('中性参考图（1 张，可能计费）'));
assert.match(assetView, /完整视图加载失败/);
assert.match(dossier, /item\.image_url \|\| item\.imageUrl \|\| item\.url \|\| item\.file_url/);
assert.match(actorSources, /portrait_fallback_urls/);
assert.match(actorSources, /bindActorImageFallbacks/);

console.log(JSON.stringify({
  passed: true,
  stale_scene_revision_removed: true,
  conflicting_person_prompt_replaced: true,
  explicit_user_prompt_preserved: true,
  full_view_url_aliases_supported: true,
  actor_portrait_fallbacks: true,
  product_button_copy_and_layout: true,
  paid_model_calls: 0,
}));
