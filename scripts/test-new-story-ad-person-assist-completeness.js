#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
}

/** 验证真实 assist 服务在模型部分返回时也会输出完整人物设定。 */
async function testAssistServiceCompletesPartialResponse() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify({ person_spec: { appearanceText: '成熟可信的真实商业人物。' } }),
    used_model: 'mock/partial-person-spec',
    fallback_used: false,
    failed_models: [],
  });
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
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

/** 按顺序运行人物辅助补齐专项回归。 */
async function main() {
  testPartialModelResponseIsCompleted();
  testExistingUserDetailsArePreserved();
  testFrontendCompletenessGuardIsWired();
  await testAssistServiceCompletesPartialResponse();
  console.log('剧情广告人物辅助补齐完整性：全部测试通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
