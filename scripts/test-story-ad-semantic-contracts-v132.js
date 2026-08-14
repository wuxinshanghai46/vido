#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const world = require('../src/services/newStoryAd/worldSettingContractService');
const action = require('../src/services/newStoryAd/actionSemanticsService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const seeds = require('../src/services/knowledgeBaseSeed');
const subjects = require('../src/services/newStoryAd/subjectAssetBundleService');
const dossier = require('../src/services/newStoryAd/personDossierCompiler');
const scenes = require('../src/services/newStoryAd/sceneAssetService');
const revisions = require('../src/services/newStoryAd/revisionService');

const root = path.resolve(__dirname, '..');
const explicit = world.normalize({
  status: 'confirmed', profiles: [{
    id: 'ancient_world', era_family: 'chinese_historical', time_period: '北宋中期',
    region: '江南', fidelity_mode: 'historical_realism', visual_medium: 'anime_2d', forbidden_elements: ['现代汽车'],
  }],
});
assert.equal(explicit.status, 'confirmed');
assert.equal(explicit.profiles[0].fidelity_mode, 'historical_realism');
assert.equal(explicit.profiles[0].visual_medium, 'anime_2d');
assert.match(explicit.fingerprint, /^[a-f0-9]{64}$/);
assert(world.promptBlock(explicit).length < 900, 'world prompt projection must stay compact');

const overseas = world.normalize({ profiles: [{ era_family: 'modern_overseas' }] });
assert.equal(overseas.status, 'draft', '海外未细化地区时不得伪装成已确认事实');
const custom = world.normalize({ profiles: [{ era_family: 'brand_new_open_domain', time_period: '自定义纪元' }] });
assert.equal(custom.profiles[0].era_family, 'custom', '开放题材不得被硬编码行业枚举拒绝');

const inferredReferenceWorld = world.infer({ profiles: [{ era_family: 'auto', visual_medium: 'auto' }] }, {
  brief: '未来感数字工作室中，一位女性穿西装与全息屏幕互动。',
  content_form: 'narrative_live_action',
  reference_video_analysis: {
    status: 'completed', analysis_quality: { valid: true },
    generated_brief: '未来城市与虚拟数字空间；人物服装为西装，面部化淡妆，动作真实可见。',
  },
});
assert.equal(inferredReferenceWorld.profiles[0].era_family, 'future', '参考内容明确未来科技时必须自动补齐时代类型');
assert.equal(inferredReferenceWorld.profiles[0].visual_medium, 'live_action', '参考人物存在真实服装与面部证据时必须自动补齐真人实拍');
assert.equal(inferredReferenceWorld.profiles[0].era_family_source, 'reference_analysis');
assert.equal(inferredReferenceWorld.profiles[0].visual_medium_source, 'reference_analysis');
assert.equal(inferredReferenceWorld.status, 'draft', 'AI 推断不得冒充用户已确认');
assert.equal(inferredReferenceWorld.authority.user_confirmed, false, 'AI 推断必须保留待用户确认状态');
const inferredContext = contextBuilder.buildContext({
  brief: '未来感数字工作室中，一位女性穿西装与全息屏幕互动。',
  content_mode: 'narrative_story', content_mode_source: 'user', content_form: 'narrative_live_action',
  world_setting: { profiles: [{ era_family: 'auto', visual_medium: 'auto' }] },
  reference_video_analysis: {
    status: 'completed', schema_version: 4,
    analysis_quality: { valid: true },
    source_facts: { product_or_service: 'AI 光影引擎', environment: '未来城市与虚拟数字空间' },
    story_outline: { logline: '讲解者展示未来创作工具' },
    plot_beats: [{ id: 'beat_1', summary: '展示工具' }],
    scene_prompts: [{ id: 'scene_1', location_type: '未来数字工作室' }],
    camera_intents: [{ range: [0, 3], movement: '固定镜头' }],
    generated_brief: '未来城市与虚拟数字空间；人物服装为西装，面部化淡妆，动作真实可见。',
  },
  expected_people: 1,
  cast_profiles: [{ id: 'presenter', name: '林澜', role: '讲解者', age: '25~35岁', ethnicity: '东亚外貌设计', appearanceText: '女性讲解者', wardrobeText: '西装' }],
});
assert.equal(inferredContext.world_setting.profiles[0].era_family, 'future', '上下文构建必须落库自动识别的时代');
assert.equal(inferredContext.world_setting.profiles[0].visual_medium, 'live_action', '上下文构建必须落库自动识别的画面形态');
assert.equal(inferredContext.cast_profiles[0].visual_medium, 'live_action', '自动识别的画面形态必须同步约束人物资产');
const preservedUserWorld = world.infer({ status: 'confirmed', authority: { source: 'user', user_confirmed: true }, profiles: [{
  era_family: 'chinese_historical', era_family_source: 'user', visual_medium: 'anime_2d', visual_medium_source: 'user',
}] }, { brief: '未来城市真人实拍' });
assert.equal(preservedUserWorld.profiles[0].era_family, 'chinese_historical', '用户手动时代不得被自动识别覆盖');
assert.equal(preservedUserWorld.profiles[0].visual_medium, 'anime_2d', '用户手动画面形态不得被自动识别覆盖');

const ctx = contextBuilder.buildContext({
  brief: '一名古代将军在千年后醒来。', content_mode: 'narrative_story',
  world_setting: explicit,
  cast_profiles: [{ id: 'cast_1', name: '凌光', appearanceText: '1000岁，面容清俊', look_profiles: [
    { id: 'look_ancient', wardrobeText: '古代将军服', world_profile_id: 'ancient_world' },
    { id: 'look_modern', wardrobeText: '现代简约服', world_profile_id: 'modern_world' },
  ] }],
});
assert.equal(ctx.story_scene_contract_version, 6);
assert.equal(ctx.world_setting.profiles[0].id, 'ancient_world');
assert.equal(ctx.cast_profiles[0].look_profiles[0].world_profile_id, 'ancient_world');
assert.equal(ctx.cast_profiles[0].visual_medium, 'anime_2d');
const member = subjects.humanMemberSpecs({}, ctx, 1)[0];
assert.equal(member.visual_medium, 'anime_2d');
assert.match(subjects.humanPrompt(member, 1), /original 2D anime\/cel animation/u);
assert.doesNotMatch(subjects.humanPrompt(member, 1), /production-ready photorealistic actor/u);
assert.match(dossier.nativeMasterPrompt(dossier.NATIVE_MASTER_SPECS[0], 'character', '', 'cinematic_3d'), /cinematic 3D animation/u);
const scenePrompt = scenes.buildSceneSheetPrompt({ ctx, outputRole: 'master' });
assert.match(scenePrompt, /original 2D anime\/cel animation/u);
assert.doesNotMatch(scenePrompt, /must be a real on-location photograph/u);
const changedMediumContext = contextBuilder.buildContext({ ...ctx,
  world_setting: { ...explicit, profiles: [{ ...explicit.profiles[0], visual_medium: 'cinematic_3d' }] },
});
assert.equal(changedMediumContext.cast_profiles[0].visual_medium, 'cinematic_3d', '项目画面形态变更必须覆盖旧的项目派生人物形态');
const mediumChangedDomains = revisions.changeDomains(ctx, changedMediumContext);
assert(mediumChangedDomains.includes('source'), '项目级世界/画面合同必须进入内容修订域并失效旧下游输出');
assert(mediumChangedDomains.includes('person'), '画面形态变更必须让旧人物视觉档案进入失效链路');
const pet = subjects.petMemberSpecs({}, { world_setting: explicit, pet_profiles: [{ id: 'pet_1', name: '雪团', type: '猫' }] }, 1)[0];
assert.equal(pet.visual_medium, 'anime_2d');
assert.match(subjects.petPrompt(pet, 1), /original 2D anime\/cel animation/u);
assert.doesNotMatch(subjects.petPrompt(pet, 1), /photorealistic animal identity/u);

const mechanics = action.normalizeAction({ action_id: 'turn', action_start: '背对镜头', kinetic_chain: ['头部先转', '肩髋跟随'], weight_shift: '重心移向右脚', action_end: '面对镜头' });
assert.equal(mechanics.kinetic_chain.length, 2);
const combat = action.normalizeCombat({ beats: [{ phase: 'contact', actor_id: 'a', target_id: 'b', physical_result: '目标后退一步', duration_sec: 2 }] });
assert.equal(combat.beats[0].phase, 'contact');
assert(action.promptBlock().length < 600, 'action prompt projection must stay compact');

const perfStart = process.hrtime.bigint();
for (let task = 0; task < 50; task += 1) {
  const maximal = world.normalize({ profiles: Array.from({ length: 8 }, (_, index) => ({
    id: `world_${task}_${index}`, era_family: index % 2 ? 'custom' : 'future',
    time_period: `period_${index}`, region: `region_${index}`,
    required_elements: Array.from({ length: 16 }, (__, item) => `required_${item}`),
    forbidden_elements: Array.from({ length: 16 }, (__, item) => `forbidden_${item}`),
  })) });
  assert.equal(maximal.profiles.length, 8);
  assert(world.promptBlock(maximal).length < 900);
}
const perfMs = Number(process.hrtime.bigint() - perfStart) / 1e6;
assert(perfMs < 250, `50 maximal world contracts must compile without request slowdown (${perfMs.toFixed(1)}ms)`);

for (const id of ['kb_world_setting_fidelity_contract_v1', 'kb_performance_action_lexicon_v1', 'kb_combat_beat_camera_contract_v1']) {
  assert(seeds.some(doc => doc.id === id && doc.enabled === true), `${id} must be active in the official KB seed`);
}

const assetPlan = fs.readFileSync(path.join(root, 'src/services/newStoryAd/assetPlanService.js'), 'utf8');
const storyAd = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
assert(!assetPlan.includes("wardrobeStyleKnowledge.promptBlock"), 'asset plan old duplicated wardrobe prompt path must be disabled');
assert(!storyAd.includes("wardrobeStyleKnowledge.promptBlock"), 'person assist old duplicated wardrobe prompt path must be disabled');
console.log('story ad semantic contracts v132: ok');
