'use strict';

const assert = require('assert');
const personPlanRoute = require('../src/routes/newStoryAd/personPlanGenerationRoute');

const look = {
  id: 'look_1',
  name: '现代简洁背景出镜造型',
  wardrobeText: '紫色晚礼服，黑色高跟鞋，银色耳钉',
  hairMakeupText: '黑色齐肩短发，淡妆',
  negativeText: '禁止改变人物身份、服装和饰品',
};
const profile = {
  id: 'char_chenmo',
  identity_id: 'char_chenmo',
  displayName: '陈默',
  roleName: '背景出镜人物',
  age: '25岁',
  appearanceText: '25岁左右女性，真实商业广告质感',
  negativeText: look.negativeText,
  look_profiles: [look],
};
const context = {
  brief: '人物生成生产回归',
  cast_mode: 'single',
  cast_profiles: [profile],
  pet_profiles: [],
  person_spec: {},
};
const storage = {
  getTask: () => ({ id: 'production-person-target', brief: context.brief, request: context }),
  getOutput: (_taskId, kind) => kind === 'context' ? context : null,
};
let projectBundleReads = 0;
const projectBundleService = {
  buildProjectBundle: () => {
    projectBundleReads += 1;
    return { assets: { people: [{ profile, generated_profile: null, dossier_sheet: null, look_assets: [] }], animals: [] } };
  },
};

const body = personPlanRoute.currentPersonGenerationBody({
  taskId: 'production-person-target',
  input: { request_key: 'production-regression' },
  storage,
  projectBundleService,
  service: { publicTaskBundle: () => { throw new Error('普通任务包不得再参与人物图片缺失判定'); } },
});
assert.strictEqual(projectBundleReads, 1, '人物图片缺失判定必须读取与页面相同的工作区项目投影');
assert.deepStrictEqual(body.subject_targets, [{ kind: 'human', id: 'char_chenmo', index: 0 }], '没有人物图片时必须进入真实图片生成，不能在 99% 假成功');
assert.strictEqual(personPlanRoute.completePerson({ profile, generated_profile: null }), false, '空生成档案必须稳定判为缺图，不能抛异常');
assert.doesNotThrow(() => personPlanRoute.profileSnapshot(null), '历史空档案必须可安全规范化');

const staleLocal = {
  profile,
  generated_profile: JSON.parse(JSON.stringify(profile)),
  visual_asset_contract_version: 2,
  dossier_sheet: { image_url: '/api/new-story-ad/assets/v229-definitely-missing-dossier.png' },
  look_assets: [{ id: 'look_1', image_url: '/api/new-story-ad/assets/v229-definitely-missing-look.png' }],
};
assert.strictEqual(personPlanRoute.completePerson(staleLocal), false, '404 的本地人物 URL 不得冒充已完成人物资产');

const availableRemote = {
  ...staleLocal,
  dossier_sheet: { image_url: 'https://assets.example.test/person-dossier.png' },
  look_assets: [{ id: 'look_1', image_url: 'https://assets.example.test/look-1.png' }],
};
assert.strictEqual(personPlanRoute.completePerson(availableRemote), true, '档案、造型和生成快照齐全时必须继续复用，避免重复付费');

console.log(JSON.stringify({
  passed: true,
  checks: 6,
  workspace_projection_reads: projectBundleReads,
  missing_person_targets: body.subject_targets.length,
  stale_local_404_rejected: true,
  completed_asset_reuse_preserved: true,
  paid_model_calls: 0,
  media_calls: 0,
}));
