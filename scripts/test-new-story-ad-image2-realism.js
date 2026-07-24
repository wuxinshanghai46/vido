#!/usr/bin/env node

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.DB_ENABLED = '0';

const formatter = require('../src/services/newStoryAd/assistTextFormatterService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const newStoryAdRouter = require('../src/routes/newStoryAd');
const visualPolicy = require('../src/services/newStoryAd/visualRealismPolicyService');
const complianceKb = require('../src/services/seeds/ai_visual_compliance');

function testBriefFormatter() {
  const input = String.raw`\n\n**广告主题**：真实家庭日常\n\n**核心故事线**：产品自然进入生活\n\n### 画面风格：真实摄影`;
  const output = formatter.formatAssistedBrief(input);
  assert.doesNotMatch(output, /\\n|\\r|\\t|\*\*|^###/m);
  assert.match(output, /【广告主题】真实家庭日常/);
  assert.match(output, /【核心故事线】产品自然进入生活/);
  assert.match(output, /【画面风格】真实摄影/);
  assert.match(output, /\n\n【核心故事线】/);
}

function testFrontendDefensiveFormatter() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const sandbox = { window: {}, setTimeout, clearTimeout };
  vm.runInNewContext(source, sandbox);
  const output = sandbox.window.NewStoryAdGenerationFlow.formatBriefText(String.raw`**广告主题**：测试\n\n**场景设定**：真实空间`);
  assert.doesNotMatch(output, /\\n|\*\*/);
  assert.match(output, /\n\n/);
}

async function testAssistServiceFormatsDoubleEscapes() {
  const originalGenerateText = modelGateway.generateText;
  modelGateway.generateText = async () => ({
    text: JSON.stringify({
      brief: String.raw`\n\n**广告主题**：办公室服务\n\n**核心卖点**：真实可信`,
      product_subject: '办公室服务',
    }),
    used_model: 'mock/escaped-layout',
    fallback_used: false,
    failed_models: [],
  });
  try {
    const result = await storyAd.assistBrief({
      mode: 'write',
      brief: '办公室服务广告',
      product_subject: '办公室服务',
    }, { id: 'test-user' });
    assert.doesNotMatch(result.brief, /\\n|\*\*/);
    assert.match(result.brief, /【广告主题】办公室服务/);
    assert.match(result.brief, /\n\n【核心卖点】真实可信/);
  } finally {
    modelGateway.generateText = originalGenerateText;
  }
}

function testPersonPortraitAndRealismPolicy() {
  const description = newStoryAdRouter.buildActorDescription({
    brief: '真实办公服务广告',
    spec: { age: 'young_adult_17_25', gender: 'female' },
  });
  const sheet = newStoryAdRouter.buildActorSheetPrompt(description);
  assert.match(description, /18-25 years old adult/);
  assert.match(description, /distance-appropriate pores/i);
  assert.match(description, /no beauty filter/i);
  assert.match(sheet, /top-left FRONT SHOULDER-UP PORTRAIT/i);
  assert.match(sheet, /face about two thirds/i);
  assert.match(sheet, /never generate or submit a portrait video/i);
  assert.doesNotMatch(sheet, /top-left FRONT full body/i);
}

function testSceneAndKeyframeRealismPolicy() {
  const scenePrompt = sceneAssets.buildSceneSheetPrompt({
    ctx: { brief: '真实商业空间', cast_mode: 'no_human' },
  });
  assert.match(scenePrompt, /physically used and photographed/i);
  assert.match(scenePrompt, /task-relevant traces/i);
  assert.match(scenePrompt, /Do not dirty every surface uniformly/i);

  const keyframePrompt = storyAd.buildKeyframePrompt({
    brief: '成年人在真实办公室使用产品',
    product_subject: '办公服务',
    cast_mode: 'single',
    person_asset: { id: 'actor-001', name: '测试演员' },
  }, {
    title: '自然交流',
    visual: '一位成年女性在真实办公室自然交流',
    action: '她自然地看向同事并点头',
    characters: [{ name: '测试演员' }],
  }, { visual_contract: {} }, 0);
  assert.match(keyframePrompt, /Actor photorealism lock/i);
  assert.match(keyframePrompt, /real pores/i);
  assert.match(keyframePrompt, /No beauty filter/i);
  assert.match(keyframePrompt, /Actor compliance lock/i);
}

function testProviderReferencePriority() {
  const url = videoAdapter.personReferenceUrl({
    person_contract: {
      reference_views: {
        front: '/outputs/person/front-full.png',
        front_closeup: '/outputs/person/front-closeup.png',
      },
    },
  });
  assert.equal(url, '/outputs/person/front-closeup.png');
  const payloadSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert.match(payloadSource, /deyunai_asset_id:/);
  assert.match(payloadSource, /deyunai_asset_group_type:/);
}

function testComplianceKnowledgeBase() {
  const entry = complianceKb.find(item => item.id === 'kb_gpt_image2_domestic_compliance_preflight');
  assert.ok(entry, 'Image 2 合规知识必须进入种子知识库');
  assert.match(entry.content, /单张参考图必须小于 25MB/);
  assert.match(entry.content, /默认最多使用 6 张/);
  assert.match(entry.content, /默认只传图片，不传视频/);
  assert.match(entry.content, /不得自动重试|不可自动重试/);
  assert.match(entry.content, /不用于规避供应商审核/);
  assert.doesNotMatch(visualPolicy.image2CompliancePrompt(), /bypass moderation|evade review/i);
}

async function main() {
  testBriefFormatter();
  testFrontendDefensiveFormatter();
  await testAssistServiceFormatsDoubleEscapes();
  testPersonPortraitAndRealismPolicy();
  testSceneAndKeyframeRealismPolicy();
  testProviderReferencePriority();
  testComplianceKnowledgeBase();
  console.log('剧情广告 Image 2 合规、人物/场景真实感与需求布局：全部测试通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
