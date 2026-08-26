const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const personLooks = require('../src/services/newStoryAd/personLookProfileService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const completion = require('../src/services/newStoryAd/generationSpecCompletionService');
const references = require('../src/services/newStoryAd/referenceSelectionService');
const storyboard = require('../src/services/newStoryAd/storyboardTableService');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');

const profile = {
  id: 'lin_jing', displayName: '林静', roleName: '时空连接者', age: 'adult_30_40',
  appearanceText: '三十岁左右的东方女性，面部轮廓稳定，体态从容，肤质自然，目光沉静。',
  negativeText: '禁止改变人物身份和面部特征。',
  look_profiles: [
    { id: 'lin_ancient', name: '古代造型', story_state: '宋代', scene_ids: ['ancient_garden'], wardrobeText: '淡青色棉麻宋式长袍与米白色棉布软底鞋，木簪固定盘发，无其他配饰。', hairMakeupText: '黑色长发以木簪固定盘起，淡妆。' },
    { id: 'lin_modern', name: '现代造型', story_state: '现代', scene_ids: ['modern_hall'], wardrobeText: '米白色亚麻衬衫搭配米白色亚麻直筒长裤、棕色皮革穆勒鞋和银色手链。', hairMakeupText: '黑色长发自然披肩，通透淡妆。' },
  ],
};

async function run() {
  const normalized = personLooks.normalizeProfileLooks(profile);
  assert.equal(normalized.look_profiles.length, 2, '一个人物的古今造型必须保留为两条造型记录');
  assert.equal(normalized.wardrobeText, profile.look_profiles[0].wardrobeText, '标量兼容字段只能投影首个造型，不能拼接多套造型');
  assert.equal(personLooks.lookForScene(normalized, 'modern_hall').id, 'lin_modern');
  assert.equal(personLooks.lookForShot(normalized, { scene_id: 'ancient_garden', look_id: 'lin_ancient' }).id, 'lin_ancient');
  const eraSeparated = personLooks.splitCrossEraProfiles([profile]);
  assert.equal(eraSeparated.length, 2, '古代与现代必须拆成两个独立人物档案');
  assert.deepEqual(eraSeparated.map(item => item.displayName), ['林静（古代）', '林静（现代）']);
  assert(eraSeparated.every(item => item.look_profiles.length === 1));

  const legacy = personLooks.normalizeProfileLooks({ id: 'legacy', wardrobeText: '一套固定服装' });
  assert.equal(legacy.look_profiles.length, 1, '历史单造型任务应无损投影为一个默认造型');

  const plan = assetPlan.normalizePlan({
    cast_profiles: [profile],
    scene_plan: {
      cast_mode: 'single', scene_mode: 'multi',
      spaces: [
        { id: 'ancient_garden', name: '古代竹海庭院', description: '竹林中的古代庭院', story_purpose: '穿越起点', scene_spec: { layoutText: '庭院入口、竹林和凉亭位置明确', materialLightText: '竹木青石与晨间散射光', interactionText: '人物从竹径走向凉亭', negativeText: '禁止现代物件' } },
        { id: 'modern_hall', name: '现代金属展厅', description: '现代金属艺术展厅', story_purpose: '现代展示', scene_spec: { layoutText: '入口、展墙和通道位置明确', materialLightText: '金属墙面与暖白射灯', interactionText: '人物从入口走向展墙', negativeText: '禁止古代建筑' } },
      ],
    },
  });
  assert.equal(plan.cast_profiles.length, 2, '跨时代状态必须增加为独立人物档案');
  assert.deepEqual(plan.cast_profiles.map(item => item.displayName), ['林静（古代）', '林静（现代）']);
  assert(plan.cast_profiles.every(item => item.look_profiles.length === 1), '拆分后每个时代人物只保留本时代造型');
  assert.equal(plan.scene_plan.cast_mode, 'dual');

  const nonCollapsingPlan = assetPlan.normalizePlan({
    cast_profiles: [{ ...profile, look_profiles: [profile.look_profiles[0]] }],
    scene_plan: plan.scene_plan,
  }, { cast_profiles: [profile] });
  assert.equal(nonCollapsingPlan.cast_profiles.length, 2,
    'a later planner response must preserve and split an already approved cross-era profile');

  const unboundProfile = {
    ...profile,
    look_profiles: profile.look_profiles.map((look, index) => ({ ...look, name: `同时代换装 ${index + 1}`, scene_ids: [], story_state: '' })),
  };
  await assert.rejects(
    subjects.generateSubjectBundle({
      taskId: 'unbound-multi-look',
      body: {
        brief: 'one person with two looks', cast_mode: 'single', expected_people: 1,
        person_spec: { castMode: 'single', expectedPeople: 1 }, cast_profiles: [unboundProfile],
      },
    }, {
      deterministic: true,
      mediaAdapter: {},
      storage: { getOutput: () => null, saveOutput: () => {}, listOutputs: () => [] },
    }),
    error => Array.isArray(error?.unbound_look_ids) && error.unbound_look_ids.length === 2,
    'multi-look generation must stop before paid calls when look-to-scene or story-state binding is missing',
  );

  await assert.rejects(
    subjects.generateSubjectBundle({
      taskId: 'cross-era-paid-call-guard',
      body: { brief: '古今双线', cast_mode: 'single', expected_people: 1, cast_profiles: [profile] },
    }, {
      mediaAdapter: {},
      storage: { getOutput: () => null, saveOutput: () => {}, listOutputs: () => [] },
    }),
    error => error?.code === 'PERSON_CROSS_ERA_REPLAN_REQUIRED' && error?.before_paid_call === true,
    '跨时代合并档案必须在任何付费生成前停止并要求重规划',
  );

  const saved = new Map();
  const completed = await completion.completePersonProfiles({ taskId: 'multi-look-test', brief: '同一人物从古代穿越到现代', castProfiles: [profile] }, {
    deterministic: true,
    storage: { getOutput: (_, kind) => saved.get(kind) || null, saveOutput: (_, kind, value) => saved.set(kind, value) },
  });
  assert.equal(completed.cast_profiles[0].look_profiles.length, 2, '生成预检必须逐造型补齐');
  assert.match(completed.cast_profiles[0].look_profiles[0].wardrobeText, /淡青色/);
  assert.doesNotMatch(completed.cast_profiles[0].look_profiles[0].wardrobeText, /亚麻衬衫/);
  assert.match(completed.cast_profiles[0].look_profiles[1].wardrobeText, /亚麻衬衫/);
  assert.doesNotMatch(completed.cast_profiles[0].look_profiles[1].wardrobeText, /宋式长袍/);

  const member = subjects.humanMemberSpecs({}, { cast_profiles: completed.cast_profiles }, 1)[0];
  assert.equal(member.look_profiles.length, 2);
  assert.doesNotMatch(subjects.humanPrompt(member, 1), /现代造型/);

  const personAsset = {
    look_assets: [
      { id: 'lin_ancient', scene_ids: ['ancient_garden'], image_url: '/ancient.png' },
      { id: 'lin_modern', scene_ids: ['modern_hall'], image_url: '/modern.png' },
    ],
  };
  assert.equal(references.memberIdentityReference(personAsset, { scene_id: 'modern_hall' }), '/modern.png');
  assert.equal(references.memberIdentityReference(personAsset, { scene_id: 'ancient_garden', look_id: 'lin_ancient' }), '/ancient.png');
  assert.equal(references.memberIdentityReference(personAsset, { scene_id: 'unknown_scene' }), '', '多造型无匹配时不得静默回落首套');
  assert.equal(references.memberIdentityReference(personAsset, { scene_id: 'modern_hall', look_id: 'unknown_look' }), '', '显式未知造型不得按场景偷偷改选');

  const shots = storyboard.normalizeShots([{ index: 1, duration: 4, visual: '林静走入现代展厅', action: '行走', scene_id: 'modern_hall', look_id: 'lin_modern' }], { target_duration: 4 });
  assert.equal(shots[0].look_id, 'lin_modern', '分镜必须持久化造型绑定');

  const root = path.resolve(__dirname, '..');
  const frontend = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonLooks.js'), 'utf8');
  const drawer = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
  const personForm = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterPersonForm.js'), 'utf8');
  assert.match(frontend, /data-person-look/);
  assert.match(frontend, /collectPersonLookValues/);
  assert.match(drawer, /assetCenterPersonForm\.js/, '人物抽屉必须按需加载独立表单模块');
  assert.match(personForm, /data-person-prompt-workbench/, '人物表单必须使用统一提示词工作台');
  assert.match(personForm, /name="generation_prompt"/, '多造型内容必须经完整人物提示词统一编辑');
  assert.doesNotMatch(personForm, /renderPersonLookEditors/, '旧多造型分段编辑器不得重新进入当前人物合同');
  assert.match(drawer, /look_upgrade_required/);
  assert.match(drawer, /personLookSummary/);
  console.log('person multi-look regression: 27 assertions passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
