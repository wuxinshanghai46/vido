const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-asset-plan-'));
process.env.OUTPUT_DIR = outputDir;

const storage = require('../src/services/newStoryAd/storageService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const outputLanguage = require('../src/services/newStoryAd/outputLanguageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');

const originalGenerateText = modelGateway.generateText;
const originalEnsureChineseOutput = outputLanguage.ensureChineseOutput;

function baseContext(overrides = {}) {
  return {
    request_id: 'asset-plan-test',
    brief: '为智能门锁制作一条三十秒真人剧情广告，人物回家后用门锁开门',
    product_subject: '智能门锁',
    cast_mode: 'single',
    target_duration: 30,
    shot_count: 5,
    output_ratio: '9:16',
    characters: [],
    assets: [],
    forbidden: [],
    cast_profiles: [],
    pet_profiles: [],
    prop_assets: [],
    scene_assets: [],
    creative_direction: {},
    performance: {},
    ...overrides,
  };
}

function createTask(id, context) {
  storage.createTask({
    id,
    brief: context.brief,
    content_revision: 1,
    request: context,
  });
  storage.saveOutput(id, 'context', context);
}

(async () => {
  let modelCalls = 0;
  modelGateway.generateText = async () => {
    modelCalls += 1;
    return {
      text: JSON.stringify({
        cast_profiles: [{
          id: 'person_1',
          name: '归家女性',
          role: '完成开门动作',
          appearanceText: '三十岁左右，可信赖的都市职业气质',
          wardrobeText: '原创米色风衣与深色通勤包',
          performanceText: '自然走近并确认门锁状态',
          continuityText: '发型、服装和随身包全程一致',
          negativeText: '禁止复制任何真人身份',
        }],
        prop_plan: [{
          id: 'key_card',
          name: '门禁卡',
          type: 'story_prop',
          description: '磨砂深灰色卡片，掌心大小',
          states: ['收纳', '取出'],
        }],
        scene_plan: {
          advertised_subject: '智能门锁',
          cast_mode: 'single',
          scene_mode: 'single',
          spaces: [{
            id: 'home_entry',
            name: '住宅玄关',
            description: '住宅入户门内外衔接的玄关空间',
            story_purpose: '完成归家与开门',
            scene_spec: {
              layoutText: '入户门、玄关柜和室内通道位置固定',
              materialLightText: '木质柜体与傍晚暖色室内光',
              interactionText: '人物从门外走到门锁前并进入室内',
              negativeText: '禁止出现其它地点和水印',
              storyStates: [],
              interactionAnchors: [],
              routes: [],
              propPlacements: [],
            },
          }],
          asset_strategy: [],
          story_strategy: ['先建立归家问题，再展示开门结果'],
          forbidden: ['禁止品牌水印'],
          suggested_shot_count: 5,
        },
        story_seed: {
          logline: '人物归家，通过智能门锁顺畅进入室内',
          opening: '人物走近家门',
          development: '完成身份确认',
          turning_point: '门锁解锁',
          resolution: '人物安心进入室内',
        },
      }),
      used_model: 'mock/text',
      fallback_used: false,
      failed_models: [],
    };
  };
  outputLanguage.ensureChineseOutput = async ({ payload }) => ({
    payload,
    repaired: false,
    assessment: { pass: true },
  });

  const noReference = baseContext();
  createTask('asset-plan-model', noReference);
  const first = await assetPlan.generate('asset-plan-model');
  assert.strictEqual(modelCalls, 1, '无参考视频必须只调用一次统一资产规划模型');
  assert.strictEqual(first.spaces.length, 1);
  assert.strictEqual(storage.getOutput('asset-plan-model', 'asset_plan').prop_plan.length, 1);
  assert.strictEqual(storage.getOutput('asset-plan-model', 'asset_plan').cast_profiles.length, 1);
  const plannedContext = storage.getOutput('asset-plan-model', 'context');
  assert.strictEqual(plannedContext.cast_profiles.length, 1);
  assert.strictEqual(plannedContext.expected_people, 1);
  assert.strictEqual(plannedContext.cast_mode, 'single');
  assert.strictEqual(plannedContext.person_spec.expectedPeople, 1);
  assert.strictEqual(plannedContext.person_spec.castMode, 'single');
  assert(plannedContext.person_spec.hairMakeupText);
  assert.strictEqual(storage.getOutput('asset-plan-model', 'prop_assets').length, 1);
  assert.strictEqual(storage.getOutput('asset-plan-model', 'prop_assets')[0].status, 'planned_not_generated');
  assetPlan.syncPrevious('asset-plan-model');
  assert.strictEqual(storage.readDb().stages.find(
    item => item.task_id === 'asset-plan-model' && item.stage === 'scene_config',
  ).status, 'done');
  assert.strictEqual(storage.getTask('asset-plan-model').stage, 'scene_config_done');

  const reused = await assetPlan.generate('asset-plan-model');
  assert.strictEqual(modelCalls, 1, '输入指纹未变化时不得重复调用规划模型');
  assert.strictEqual(reused.spaces[0].id, 'home_entry');
  assert.strictEqual(storage.getOutput('asset-plan-model', 'scene_config').spaces[0].id, 'home_entry');
  storage.updateTask('asset-plan-model', { content_revision: 2 });
  await assetPlan.generate('asset-plan-model');
  assert.strictEqual(modelCalls, 1);

  const reference = baseContext({
    request_id: 'asset-plan-reference-test',
    reference_video_analysis: {
      analysis_id: 'analysis-1',
      status: 'completed',
      analysis_quality: { valid: true },
      source_facts: {
        product_or_service: '智能门锁',
        environment: '住宅玄关',
        layout: '入户门与玄关柜相邻',
        lighting: '傍晚暖光',
      },
      story_outline: { logline: '人物归家并完成开门' },
      plot_beats: [{ purpose: '建立归家情境' }, { purpose: '展示开门结果' }],
      character_prompts: [{
        role: '归家人物',
        appearance_direction: '原创成年人物',
        wardrobe_direction: '原创通勤服装',
      }],
      scene_prompts: [{
        location_type: '住宅玄关',
        layout_prompt: '入户门与玄关柜相邻',
        material_light_prompt: '木质柜体和傍晚暖光',
        interaction_prompt: '人物走近门锁并进入室内',
        negative_prompt: '禁止水印和其它地点',
      }],
      camera_intents: [{ movement: 'slow_push_in' }],
    },
  });
  createTask('asset-plan-reference', reference);
  const projected = await assetPlan.generate('asset-plan-reference');
  assert.strictEqual(modelCalls, 1, '有效参考分析必须确定性投影，不得再次调用模型理解');
  assert.strictEqual(projected.spaces.length, 1);
  assert.strictEqual(storage.getOutput('asset-plan-reference', 'asset_plan').source, 'reference_analysis_projection');
  assert.strictEqual(storage.getOutput('asset-plan-reference', 'asset_plan').model_meta.model_call_count, 0);

  const userBriefWithReference = baseContext({
    ...reference,
    request_id: 'asset-plan-user-brief-reference-test',
    brief_source: 'user',
    brief: '用户明确要求以红色跑车为唯一广告主体，花朵参考只用于节奏，不得成为场景或商品。',
    product_subject: '高性能红色电动跑车',
  });
  createTask('asset-plan-user-brief-reference', userBriefWithReference);
  await assetPlan.generate('asset-plan-user-brief-reference');
  assert.strictEqual(modelCalls, 2, '用户目标与参考素材同时存在时必须按用户目标规划，参考内容不得零模型覆盖用户场景');
  assert.notStrictEqual(storage.getOutput('asset-plan-user-brief-reference', 'asset_plan').source, 'reference_analysis_projection');
  assert.strictEqual(storage.getOutput('asset-plan-user-brief-reference', 'context').brief, userBriefWithReference.brief);

  console.log(JSON.stringify({
    passed: true,
    no_reference_model_calls: 1,
    unchanged_fingerprint_additional_calls: 0,
    valid_reference_model_calls: 0,
    authoritative_user_brief_reference_model_calls: 1,
    projected_cast_count: storage.getOutput('asset-plan-reference', 'asset_plan').cast_profiles.length,
    projected_prop_count: storage.getOutput('asset-plan-reference', 'asset_plan').prop_plan.length,
    projected_scene_count: projected.spaces.length,
  }, null, 2));
})().finally(() => {
  modelGateway.generateText = originalGenerateText;
  outputLanguage.ensureChineseOutput = originalEnsureChineseOutput;
  fs.rmSync(outputDir, { recursive: true, force: true });
});
