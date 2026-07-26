#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');

/** 验证模型只返回外貌时，后端仍会补齐全部人物一致性字段。 */
function testPartialModelResponseIsCompleted() {
  const result = service.enforceAssistedPersonSpec({
    appearanceText: '真实商业人物，神态自然。',
  }, {
    castMode: 'single',
    gender: 'female',
    age: 'adult_30_40',
    origin: 'east_asian_cn',
    roleName: '品牌形象代表',
  }, {
    brief: '为办公空间品牌制作一条真实剧情广告',
    product_subject: '办公空间品牌',
  });

  assert.equal(result.castMode, 'single');
  assert.equal(result.gender, 'female');
  assert.equal(result.age, 'adult_30_40');
  assert.equal(result.origin, 'east_asian_cn');
  assert.equal(result.roleName, '品牌形象代表');
  assert.match(result.appearanceText, /30-40岁/);
  assert.ok(result.wardrobeText.length >= 30, '服装字段必须自动补齐');
  assert.ok(result.hairMakeupText.length >= 30, '发型妆造字段必须自动补齐');
  assert.ok(result.negativeText.length >= 30, '人物禁止项必须自动补齐');
  assert.match(result.wardrobeText, /办公空间品牌/);
}

/** 验证模型漏字段时不会覆盖用户已经手动填写的人物约束。 */
function testExistingUserDetailsArePreserved() {
  const current = {
    age: 'adult_30_40',
    roleName: '品牌经理',
    wardrobeText: '用户指定：深蓝色西装外套、米色长裤和黑色低跟鞋。',
    hairMakeupText: '用户指定：齐肩直发、自然淡妆和银色细框眼镜。',
    negativeText: '用户指定：不要白衬衫；不要夸张首饰。',
  };
  const result = service.enforceAssistedPersonSpec({ appearanceText: '成熟、可信。' }, current, {});

  assert.equal(result.wardrobeText, current.wardrobeText);
  assert.equal(result.hairMakeupText, current.hairMakeupText);
  assert.equal(result.negativeText, current.negativeText);
}

/** 验证前端使用逐字段合并，而不是把部分响应直接当成完整结果。 */
function testFrontendCompletenessGuardIsWired() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert.match(source, /function completePersonSpecSuggestion\(/);
  assert.match(source, /const completedSuggestion = completePersonSpecSuggestion\(suggestion, current, fallback\)/);
  assert.match(source, /applyPersonSpecSuggestion\(completedSuggestion\)/);
  assert.match(source, /function completeSceneSpecSuggestion\(/);
  assert.match(source, /const nextSpec = completeSceneSpecSuggestion\(suggestion, currentSpec, fallbackSpec\)/);
}

function testGeneratedActorAgeConstraintDoesNotDowngrade() {
  const actorSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/actors.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(actorSource, sandbox);
  const ageValue = sandbox.window.NewStoryAdActors.ageValue;
  assert.equal(ageValue('young_adult'), 'young_adult');
  assert.equal(ageValue('25-32 years old'), 'young_adult');
  assert.equal(ageValue('二十七岁中国女性'), 'young_adult');
  assert.equal(ageValue('young_adult_17_25'), 'young_adult_17_25');
  assert.equal(ageValue('17-25 years old'), 'young_adult_17_25');
  assert.equal(ageValue('25'), '', '单独的边界数字不能覆盖已锁定年龄段');

  const legacySource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert.match(legacySource, /asset\.person_contract\?\.identity\?\.age_range/);
  assert.match(legacySource, /personAgeValue\(structuredAge \|\| \(!spec\.age \? asset\.description \|\| '' : ''\)\) \|\| spec\.age/);
}

/** 验证真实 assist 服务在模型部分返回时也会输出完整人物设定。 */
async function testAssistServiceCompletesPartialResponse() {
  const originalGenerateText = modelGateway.generateText;
  let capturedRequest = null;
  modelGateway.generateText = async request => {
    capturedRequest = request;
    return ({
    text: JSON.stringify({ person_spec: { appearanceText: '成熟可信的真实商业人物。' } }),
    used_model: 'mock/partial-person-spec',
    fallback_used: false,
    failed_models: [],
    });
  };
  try {
    const response = await service.assistBrief({
      mode: 'person_spec',
      brief: '办公空间品牌剧情广告，主角是一位30-40岁女性品牌形象代表',
      product_subject: '办公空间品牌',
      person_spec: {
        castMode: 'single',
        gender: 'female',
        age: 'adult_30_40',
        origin: 'east_asian_cn',
        roleName: '品牌形象代表',
      },
    }, { id: 'test-user' });

    assert.ok(response.person_spec.appearanceText);
    assert.ok(response.person_spec.wardrobeText);
    assert.ok(response.person_spec.hairMakeupText);
    assert.ok(response.person_spec.negativeText);
    assert.equal(response.person_spec.roleName, '品牌形象代表');
    assert.match(capturedRequest.systemPrompt, /四视图固定状态规则/);
    assert.match(capturedRequest.systemPrompt, /不得使用“户外时、室内时、运动时/);
    assert.match(capturedRequest.userPrompt, /帽子、眼镜、发带等发饰和首饰始终佩戴或始终不佩戴/);
    assert.match(capturedRequest.userPrompt, /禁止四视图之间增减、更换、变色或移动/);
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

async function testSinglePersonAssistIsScoped() {
  const originalGenerateText = modelGateway.generateText;
  let capturedRequest = null;
  let calls = 0;
  modelGateway.generateText = async request => {
    calls += 1;
    capturedRequest = request;
    return {
      text: JSON.stringify({
        person_spec: { castMode: 'dual', expectedPeople: 2 },
        cast_profiles: [{
          id: 'cast_2',
          displayName: '小杰',
          roleName: '儿子',
          appearanceText: '东亚男孩，约八岁，圆脸，健康活泼。',
          wardrobeText: '固定穿蓝白条纹短袖、卡其短裤和白色运动鞋，不佩戴首饰。',
          hairMakeupText: '固定自然黑色短发，四视图均不佩戴帽子、眼镜或发饰。',
          negativeText: '禁止改变发型、服装、鞋和配饰。',
        }],
        pet_profiles: [],
      }),
      used_model: 'mock/scoped-person-assist',
      fallback_used: false,
      failed_models: [],
    };
  };
  const body = {
    mode: 'person_spec',
    brief: '母子与宠物在家庭和公园互动',
    cast_mode: 'human_pet',
    person_spec: { castMode: 'human_pet', expectedPeople: 2, expectedAnimals: 1 },
    cast_profiles: [
      { id: 'cast_1', displayName: '林悦', roleName: '母亲', appearanceText: '完整外貌', wardrobeText: '完整服装', hairMakeupText: '完整发型' },
      { id: 'cast_2', displayName: '', roleName: '', appearanceText: '', wardrobeText: '', hairMakeupText: '' },
    ],
    pet_profiles: [{ id: 'pet_1', name: '雪球', type: '犬', appearance: '白色蓬松犬' }],
    assist_subject_target: { kind: 'human', index: 1, id: 'cast_2' },
  };
  try {
    const response = await service.assistBrief(body, { id: 'test-user' });
    assert.strictEqual(calls, 1);
    assert.strictEqual(response.cast_profiles.length, 1);
    assert.strictEqual(response.cast_profiles[0].id, 'cast_2');
    assert.strictEqual(response.pet_profiles.length, 0);
    assert.deepStrictEqual(response.assist_subject_target, { kind: 'human', index: 1, id: 'cast_2' });
    assert.match(capturedRequest.systemPrompt, /只能输出目标人物的一条 cast_profiles 记录/);
    assert.match(capturedRequest.userPrompt, /不得返回或改写其他人物和宠物/);

    await assert.rejects(
      () => service.assistBrief({ ...body, assist_subject_target: { kind: 'human', index: 8, id: 'missing' } }, { id: 'test-user' }),
      error => error.code === 'ASSIST_SUBJECT_TARGET_INVALID',
    );
    assert.strictEqual(calls, 1, 'invalid scoped target must fail before the text model call');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

/** 验证场景模型只返回一条残句时，原有四项设定不会被清空。 */
async function testSceneAssistPreservesCompleteExistingSpec() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify({ scene_spec: { layoutText: '一个现代空间，核心墙面由' } }),
    used_model: 'mock/partial-scene-spec',
    fallback_used: false,
    failed_models: [],
  });
  const current = {
    layoutText: '一个可连续拍摄的完整现代空间，入口、前景、背景、展示区和行动通路清晰，多个镜头切换后仍保持同一空间身份。',
    materialLightText: '用户指定的金属表面、色彩、纹理、反射、粗糙度和尺度保持一致，采用自然侧光与克制的商业重点光。',
    interactionText: '预留人物站位、商品展示区、可到达的互动区域以及连续镜头移动路径，场景参考保持空场景。',
    negativeText: '不要人物、文字、水印、Logo、无关装饰、材质漂移、结构变化、模块化拼板或可见接缝。',
    surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'uniform' },
  };
  try {
    const response = await service.assistBrief({
      mode: 'scene_spec',
      brief: '为当前产品制作真实商业空间广告',
      product_subject: '当前产品',
      scene_spec: current,
    }, { id: 'test-user' });
    assert.equal(response.scene_spec.layoutText, current.layoutText, '模型残句不得覆盖完整布局');
    assert.equal(response.scene_spec.materialLightText, current.materialLightText);
    assert.equal(response.scene_spec.interactionText, current.interactionText);
    assert.equal(response.scene_spec.negativeText, current.negativeText);
    assert.equal(response.scene_spec.surfaceTopology.mode, 'continuous');
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

/** 验证没有旧值时也会使用通用兜底补齐四项，而不是放行空字段。 */
function testSceneAssistFallbackIsComplete() {
  const result = service.enforceAssistedSceneSpec({ layoutText: '残句' }, {}, {
    brief: '通用产品广告',
    product_subject: '通用产品',
  });
  assert.ok(result.layoutText.length >= 30);
  assert.ok(result.materialLightText.length >= 30);
  assert.ok(result.interactionText.length >= 24);
  assert.ok(result.negativeText.length >= 24);
  assert.match(result.layoutText, /完整真实空间/);
  assert.match(result.materialLightText, /材质、色彩和光线/);
  assert.match(result.interactionText, /场景参考保持空场景/);
  assert.match(result.negativeText, /不要出现真人/);
}

/** 按顺序运行人物辅助补齐专项回归。 */
async function main() {
  testPartialModelResponseIsCompleted();
  testExistingUserDetailsArePreserved();
  testFrontendCompletenessGuardIsWired();
  testGeneratedActorAgeConstraintDoesNotDowngrade();
  testSceneAssistFallbackIsComplete();
  await testAssistServiceCompletesPartialResponse();
  await testSinglePersonAssistIsScoped();
  await testSceneAssistPreservesCompleteExistingSpec();
  console.log('剧情广告人物/场景辅助补齐完整性：全部测试通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
