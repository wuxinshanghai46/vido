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
const subjectBundles = require('../src/services/newStoryAd/subjectAssetBundleService');
const blueprintQuality = require('../src/services/newStoryAd/blueprintQualityService');
const complianceKb = require('../src/services/seeds/ai_visual_compliance');
const characterAssetKb = require('../src/services/seeds/character_asset_card');

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
  const stateSyncSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
  const generationSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const fields = new Map([
    ['#dhNsaAdText', { value: '', dataset: {} }],
    ['#dhNsaAdDuration', { value: '30', dataset: {} }],
    ['#dhNsaAdProductionMode', { value: '', dataset: {} }],
    ['#dhNsaAdVoiceId', { value: '', dataset: {} }],
  ]);
  const sandbox = { window: {}, document: { querySelector: () => null }, setTimeout, clearTimeout };
  vm.runInNewContext(stateSyncSource, sandbox);
  vm.runInNewContext(generationSource, sandbox);
  const screenshotLikeBrief = String.raw`【狗狗狗粮广告需求】 \n\n**广告主题**：真实家庭日常\n\n**核心故事线**：\n1. **活力展现**：主人与宠物自然互动\n2. **产品时刻**：狗粮自然进入生活`;
  const output = sandbox.window.NewStoryAdGenerationFlow.formatBriefText(screenshotLikeBrief);
  assert.doesNotMatch(output, /\\n|\*\*/);
  assert.match(output, /【广告主题】真实家庭日常/);
  assert.match(output, /\n\n【核心故事线】\n1\. 活力展现：/);

  const state = { subtitleOptions: {}, sceneAssets: [], castProfiles: [] };
  sandbox.window.NewStoryAdStateSync.hydrateTaskBundle({
    task: {
      id: 'escaped-layout-restore',
      request: { brief: screenshotLikeBrief, target_duration: 30 },
    },
    outputs: {},
  }, {
    state,
    within: selector => fields.get(selector) || null,
    rememberTaskId: () => {},
    hydrateControlledProduction: () => {},
    applyPersonAssetConstraints: () => {},
    root: () => ({ querySelector: () => null }),
  });
  assert.equal(fields.get('#dhNsaAdText').value, output, '恢复旧任务必须走同一个需求排版器');
  assert.equal(state.context.brief, screenshotLikeBrief, '恢复后的权威上下文必须保留服务端原文，不能把显示排版当成用户编辑');
  assert.equal(
    sandbox.window.NewStoryAdStateSync.authoritativeTextValue(state, 'brief', output, ''),
    screenshotLikeBrief,
    '未编辑的显示排版在保存时必须还原为服务端权威原文',
  );
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

function testPersonFullBodyAndRealismPolicy() {
  const description = newStoryAdRouter.buildActorDescription({
    brief: '真实办公服务广告',
    spec: { age: 'young_adult_17_25', gender: 'female' },
  });
  const sheet = newStoryAdRouter.buildActorSheetPrompt(description);
  assert.match(description, /18-25 years old adult/);
  assert.match(description, /distance-appropriate pores/i);
  assert.match(description, /no beauty filter/i);
  assert.match(description, /standardized digital face/i);
  assert.match(description, /mouth-only smile/i);
  assert.match(description, /pasted onto the background/i);
  assert.match(sheet, /top-left FRONT full body/i);
  assert.match(sheet, /All four panels must be full-body/i);
  assert.doesNotMatch(sheet, /SHOULDER-UP|face about two thirds|portrait video/i);
}

function testSceneAndKeyframeRealismPolicy() {
  const world_setting = { profiles: [{ id: 'world_live_action', era_family: 'modern_china', visual_medium: 'live_action' }] };
  const scenePrompt = sceneAssets.buildSceneSheetPrompt({
    ctx: { brief: '真实商业空间', cast_mode: 'no_human', world_setting },
  });
  assert.match(scenePrompt, /physically used and photographed/i);
  assert.match(scenePrompt, /task-relevant traces/i);
  assert.match(scenePrompt, /Do not dirty every surface uniformly/i);

  const keyframePrompt = storyAd.buildKeyframePrompt({
    brief: '成年人在真实办公室使用产品',
    product_subject: '办公服务',
    cast_mode: 'single',
    world_setting,
    person_asset: { id: 'actor-001', name: '测试演员' },
  }, {
    title: '自然交流',
    visual: '一位成年女性在真实办公室自然交流',
    action: '她自然地看向同事并点头',
    characters: [{ name: '测试演员' }],
  }, { visual_contract: {} }, 0);
  assert.match(keyframePrompt, /Actor photorealism lock/i);
  assert.match(keyframePrompt, /distance-scaled pores/i);
  assert.match(keyframePrompt, /standardized influencer face/i);
  assert.match(keyframePrompt, /story emotion/i);
  assert.match(keyframePrompt, /No beauty filter/i);
  assert.match(keyframePrompt, /Actor compliance lock/i);
}

function testIdentitySheetRealismPolicy() {
  const prompt = subjectBundles.humanPrompt({
    member_index: 1,
    displayName: '林悦',
    roleName: '年轻母亲',
    visual_medium: 'live_action',
    appearanceText: '约30岁，真实自然面部比例',
    wardrobeText: '米白色棉质短袖',
    hairMakeupText: '低马尾与自然碎发',
  }, 2);
  assert.match(prompt, /unretouched real casting reference/i);
  assert.match(prompt, /local skin-color variation/i);
  assert.match(prompt, /restrained role-appropriate expression/i);
  assert.match(prompt, /never default to an influencer grin/i);
  assert.match(prompt, /subtle floor contact/i);
  assert.match(prompt, /featureless render void/i);
  assert.match(prompt, /No beauty filter/i);
  assert.doesNotMatch(prompt, /Neutral seamless studio/i);
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
  assert.equal(url, '/outputs/person/front-full.png');
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
  assert.match(entry.content, /不额外生成或上传大头照/);
  assert.match(entry.content, /不得自动重试|不可自动重试/);
  assert.match(entry.content, /不用于规避供应商审核/);
  assert.doesNotMatch(visualPolicy.image2CompliancePrompt(), /bypass moderation|evade review/i);
}

function testCharacterAssetCardKnowledgeBase() {
  const contract = characterAssetKb.find(item => item.id === 'kb_character_asset_card_visual_contract_20260806');
  const accessory = characterAssetKb.find(item => item.id === 'kb_character_accessory_evidence_fallback_20260806');
  assert.ok(contract, '人物资产卡视觉合同必须进入种子知识库');
  assert.ok(accessory, '配件证据降级协议必须进入种子知识库');
  assert.match(contract.content, /正面、侧面、背面/);
  assert.match(contract.content, /六种表情/);
  assert.match(contract.content, /本地排版合成/);
  assert.match(contract.content, /不要求图片模型在一次调用中/);
  assert.match(accessory.content, /L1 复用[\s\S]*L2 本地派生[\s\S]*L3 模型增强/);
  assert.match(accessory.content, /模型调用为 0/);
  assert.match(accessory.content, /计费未知不得自动重试/);
  assert.match(accessory.content, /普通(?:造型)?配件失败时标记 evidence_pending/);
}

function testSceneRightsPreflightScope() {
  const campaignBrief = '结尾画面中屏幕上浮现品牌Logo和广告语，品牌素材将在成片阶段处理。';
  const sceneBody = {
    scene_id: 'space_home',
    space_id: 'space_home',
    name: '现代家庭空间',
    description: '客厅与厨房开放连接的现代住宅空场。',
    scene_spec: {
      layoutText: '客厅与厨房开放连接，预留连续移动路线。',
      materialLightText: '真实家居材质与自然窗光。',
      interactionText: '场景资产保持空场，预留后续表演位置。',
      negativeText: '禁止人物、商品、文字和水印。',
    },
  };
  assert.doesNotThrow(() => sceneAssets.assertSceneRightsPreflight({
    brief: campaignBrief,
    product_subject: '狗粮广告',
  }, sceneBody), 'later brand end-card copy must not block an unoccupied scene provider prompt');
  const unauthorizedCampaignBrief = '结尾画面要求现场生成并变形品牌Logo。';
  assert.equal(blueprintQuality.assessBlueprintRights({
    story_title: '完整广告',
    logline: unauthorizedCampaignBrief,
    beats: [{ visual: unauthorizedCampaignBrief }],
  }).pass, false, 'full-story brand rights QA must remain active');
  assert.throws(() => sceneAssets.assertSceneRightsPreflight({}, {
    ...sceneBody,
    description: '客厅主墙上浮现品牌Logo。',
  }), error => (
    error.code === 'SCENE_RIGHTS_PREFLIGHT_FAILED'
    && error.scene_id === 'space_home'
    && error.scene_name === '现代家庭空间'
  ), 'a logo request inside the current scene prompt must still be rejected with scene ownership');
}

async function main() {
  testBriefFormatter();
  testFrontendDefensiveFormatter();
  await testAssistServiceFormatsDoubleEscapes();
  testPersonFullBodyAndRealismPolicy();
  testIdentitySheetRealismPolicy();
  testSceneAndKeyframeRealismPolicy();
  testProviderReferencePriority();
  testComplianceKnowledgeBase();
  testCharacterAssetCardKnowledgeBase();
  testSceneRightsPreflightScope();
  console.log('剧情广告 Image 2 合规、人物/场景真实感与需求布局：全部测试通过');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
