#!/usr/bin/env node
'use strict';

const assert = require('assert');
const policy = require('../src/services/newStoryAd/modelRoutingPolicyService');
const pipeline = require('../src/services/pipelineModelService');
const migration = require('./configure-story-ad-quality-supplier-routing-v327');
const flowConsistency = require('../src/services/newStoryAd/storyboardFlowConsistencyService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');

const routes = policy.managedStageRoutes();
migration.assertPolicy(routes);
assert.ok(Object.keys(routes).length >= 35, 'must cover every New Story Ad text/VLM stage');
assert.deepStrictEqual(routes['new_story_ad.storyboard_table'].map(item => `${item.provider_id}/${item.model_id}`), [
  'webang-maas/gpt-5.6-sol', 'apismile/claude-opus-4-8', 'deyunai/claude-opus-4-7', 'aiapi/deepseek-chat',
]);
assert.deepStrictEqual(routes['new_story_ad.qa'].map(item => `${item.provider_id}/${item.model_id}`), [
  'webang-maas/gpt-5.6-terra', 'apismile/gpt-5.5', 'deyunai/gpt-5.5', 'aiapi/deepseek-chat',
]);
assert.deepStrictEqual(routes['new_story_ad.scene_vision'].map(item => `${item.provider_id}/${item.model_id}`), [
  'webang-maas/gemini-2.5-pro', 'apismile/gemini-3.1-pro-preview', 'deyunai/gemini-2.5-pro',
]);
assert.deepStrictEqual(pipeline.getStageDefaults('new_story_ad.storyboard_table'), routes['new_story_ad.storyboard_table']);
const configuredOrder = routes['new_story_ad.reference_video_synthesis'].map(item => ({ ...item }));
assert.deepStrictEqual(
  modelGateway.preferReliableTextCandidates(configuredOrder, 'new_story_ad.reference_video_synthesis'),
  configuredOrder,
  '历史成功率不得越过模型调用管理中配置的供应商顺序',
);

const contract = {
  contract_fingerprint: 'flow-v327',
  units: [
    { beat_id: 'b1', scene_id: 'living' },
    { beat_id: 'b2', scene_id: 'living' },
    { beat_id: 'b3', scene_id: 'showroom' },
  ],
};
const valid = [
  { index: 1, source_beat_id: 'b1', scene_id: 'living', story_flow_contract_fingerprint: 'flow-v327' },
  { index: 2, source_beat_id: 'b2', scene_id: 'living', story_flow_contract_fingerprint: 'flow-v327' },
  { index: 3, source_beat_id: 'b3', scene_id: 'showroom', story_flow_contract_fingerprint: 'flow-v327' },
];
assert.equal(flowConsistency.assertMatches(valid, contract).ok, true);
assert.throws(() => flowConsistency.assertMatches([
  { ...valid[0], scene_id: 'showroom' }, valid[1], valid[2],
], contract), error => error.code === 'STORYBOARD_FLOW_MISMATCH' && /场景应为 living/.test(error.message));
assert.throws(() => flowConsistency.assertMatches([
  { ...valid[0], source_beat_id: 'b3', scene_id: 'showroom' },
  { ...valid[1], source_beat_id: 'b1', scene_id: 'living' },
  { ...valid[2], source_beat_id: 'b2', scene_id: 'living' },
], contract), error => error.code === 'STORYBOARD_FLOW_MISMATCH' && /场景顺序/.test(error.message));
assert.throws(() => flowConsistency.assertMatches([{ ...valid[0], story_flow_contract_fingerprint: 'old' }], contract), error => error.code === 'STORYBOARD_FLOW_MISMATCH');

console.log(JSON.stringify({ ok: true, stage_count: Object.keys(routes).length, supplier_order: policy.SUPPLIER_ORDER, flow_gate_cases: 4 }));
