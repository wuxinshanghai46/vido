#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const world = require('../src/services/newStoryAd/worldSettingContractService');
const action = require('../src/services/newStoryAd/actionSemanticsService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const seeds = require('../src/services/knowledgeBaseSeed');

const root = path.resolve(__dirname, '..');
const explicit = world.normalize({
  status: 'confirmed', profiles: [{
    id: 'ancient_world', era_family: 'chinese_historical', time_period: '北宋中期',
    region: '江南', fidelity_mode: 'historical_realism', forbidden_elements: ['现代汽车'],
  }],
});
assert.equal(explicit.status, 'confirmed');
assert.equal(explicit.profiles[0].fidelity_mode, 'historical_realism');
assert.match(explicit.fingerprint, /^[a-f0-9]{64}$/);
assert(world.promptBlock(explicit).length < 900, 'world prompt projection must stay compact');

const overseas = world.normalize({ profiles: [{ era_family: 'modern_overseas' }] });
assert.equal(overseas.status, 'draft', '海外未细化地区时不得伪装成已确认事实');
const custom = world.normalize({ profiles: [{ era_family: 'brand_new_open_domain', time_period: '自定义纪元' }] });
assert.equal(custom.profiles[0].era_family, 'custom', '开放题材不得被硬编码行业枚举拒绝');

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
