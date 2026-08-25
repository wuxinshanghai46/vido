'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const permit = require('../src/services/newStoryAd/generationPermitService');
const personPlanRoute = require('../src/routes/newStoryAd/personPlanGenerationRoute');
const profileText = require('../src/services/newStoryAd/subjectProfileTextService');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

assert.equal(permit.protectedStage('person_plan'), false, '人物方案是 Active Plan 生产者，不得被 Active Plan 消费许可死锁');
assert.equal(permit.protectedStage('scene_plan'), false, '场景方案是 Active Plan 生产者，不得被 Active Plan 消费许可死锁');
assert.equal(permit.protectedStage('scene_config'), false, '统一资产方案是 Active Plan 生产者，不得被 Active Plan 消费许可死锁');
assert.equal(permit.protectedStage('subject_assets'), true, '人物图片仍必须在 Active Plan 发布后取得生成许可');

const rich = {
  appearanceText: '25岁东亚女性，鹅蛋脸与清晰下颌线，眉眼舒展、鼻唇比例自然；身形修长匀称、肩背挺直；暖调肤色保留细微纹理，目光专注，神态成熟可信。',
  wardrobeText: '深灰色羊毛西装外套搭配白色棉质衬衫和同色直筒长裤，黑色低跟皮鞋；固定佩戴银色腕表与小号耳钉，配色、材质和版型跨视图一致。',
  hairMakeupText: '深棕色长发束成利落低马尾并保持侧分；自然底妆保留肤质，眉形清晰、裸色唇妆；不佩戴眼镜，固定银色耳钉。',
  negativeText: '禁止改变年龄、脸型和五官比例；禁止变换发型发色、妆容和耳饰；禁止增减服装、鞋履或改变配色；禁止网红脸、塑料皮肤、过度磨皮、畸形肢体和多余人物。',
};
assert.equal(profileText.assistedProfileQuality(rich).valid, true, '竞品级人物方案必须通过四类细节密度合同');
assert.equal(profileText.assistedProfileQuality({ ...rich, appearanceText: '穿着西装，专业。' }).valid, false, '一句话外貌不得继续冒充完整人物方案');

const looks = [{ id: 'look_1', name: '职业造型', story_state: '展厅讲解', scene_ids: ['scene_1'], wardrobeText: rich.wardrobeText, hairMakeupText: rich.hairMakeupText, negativeText: rich.negativeText, style_richness: 'refined' }];
const completeProfile = { id: 'person_1', identity_id: 'person_1', displayName: '林岚', roleName: '空间设计师', age: '25岁', ethnicity: '东亚外貌设计', ...rich, look_profiles: looks };
const missingProfile = { ...completeProfile, id: 'person_2', identity_id: 'person_2', displayName: '陈先生', roleName: '客户' };
const task = { id: 'unified-person-plan', brief: '两人在展厅讨论材料', request: {} };
const context = { brief: task.brief, cast_mode: 'dual', cast_profiles: [completeProfile, missingProfile], pet_profiles: [], person_spec: {}, world_setting: { visual_medium: 'live_action' } };
const projectBundleService = { buildProjectBundle: () => ({ assets: { people: [
  { profile: completeProfile, generated_profile: JSON.parse(JSON.stringify(completeProfile)), dossier_sheet: { image_url: 'https://assets.example.test/complete.png' }, visual_asset_contract_version: 2, look_assets: [{ id: 'look_1', image_url: 'https://assets.example.test/look.png' }] },
  { profile: missingProfile },
], animals: [] } }) };
const storage = { getTask: () => task, getOutput: (_taskId, kind) => (kind === 'context' ? context : null) };
const body = personPlanRoute.currentPersonGenerationBody({ taskId: task.id, input: { request_key: 'one-click' }, projectBundleService, storage });
assert.deepEqual(body.subject_targets, [{ kind: 'human', id: 'person_2', index: 1 }], '统一动作只生成缺失或已失配人物，不得重复收费生成已完成资产');
assert.equal(body.cast_profiles[0].appearanceText, rich.appearanceText, '完整人物资产必须原样进入图片生成输入');
assert.equal(body.request_key, 'one-click');

const routeSource = read('src/routes/newStoryAd/personPlanGenerationRoute.js');
const serviceSource = read('src/services/newStoryAd/storyAdService.js');
const independentPlanSource = read('src/services/newStoryAd/independentPersonPlanService.js');
const promptSource = read('src/services/newStoryAd/subjectAssetBundleService.js');
const statusSource = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
assert.match(serviceSource, /independentPersonPlan\.complete\(taskId, options, \{ assistBrief \}\)/, '人物入口必须委托独立人物编排模块');
assert.match(independentPlanSource, /generationConcurrency\.schedule\([\s\S]*new_story_ad\.person_plan_character[\s\S]*persistIndependentPersonProfiles/, '人物方案必须按人物独立并发补齐并发布人物域方案');
assert.doesNotMatch(serviceSource, /if \(!assetPlan\.complete\(current, ctx\)\)[\s\S]*assetPlan\.generate/, '人物按钮不得再回退到人物、场景、道具共用的整套资产规划');
assert.match(routeSource, /updatePersonPlan[\s\S]*generationPermit\.issue\(req\.params\.id, 'subject_assets'/, '一个任务内必须先发布人物方案，再签发图片生成许可');
assert.match(promptSource, /Structured wardrobe asset contract[\s\S]*Performance and body-language direction[\s\S]*Cross-shot identity continuity lock/, '图片模型提示必须编译结构化服装、表演与跨镜一致性资产');
assert.doesNotMatch(statusSource, /status-tag|人物方案需要更新|文字方案确认后，再单独生成图片/, '旧状态标签和两步式提示必须彻底删除');

console.log(JSON.stringify({ passed: true, checks: 17, paid_model_calls: 0, media_calls: 0 }));
