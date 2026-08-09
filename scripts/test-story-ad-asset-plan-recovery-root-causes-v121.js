#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const topology = require('../src/services/newStoryAd/narrativeTopologyCompilerService');
const sections = require('../src/services/newStoryAd/assetPlanSectionRecoveryContractService');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function legacyNarrativePlan() {
  return {
    cast_profiles: [{ id: 'lead', name: '主角' }],
    prop_plan: [],
    story_seed: {
      logline: '主角在清晨的旧屋完成告别。',
      plot_beats: [
        {
          id: 'beat_1', phase: 'opening', era: '当代', time_anchor: '清晨', location: '旧屋',
          production_state: '冷色晨光', production_scene_key: 'legacy_old_house', transition_type: 'opening',
          summary: '主角进入旧屋', cause: '返乡', consequence: '开始整理',
          production_requirements: { layout: '旧屋布局', material_light: '冷色晨光', interaction: '门口到书桌', negative: '禁止广告' },
        },
        {
          id: 'beat_2', phase: 'resolution', era: '当代', time_anchor: '清晨稍后', location: '旧屋',
          production_state: '连续晨光', production_scene_key: 'legacy_old_house', transition_type: 'continuity',
          summary: '主角留下信后离开', cause: '完成整理', consequence: '与过去告别',
          production_requirements: { layout: '旧屋布局', material_light: '连续晨光', interaction: '书桌到门口', negative: '禁止广告' },
        },
      ],
    },
  };
}

const compiledOnce = topology.compileAssetPlan(legacyNarrativePlan());
const compiledTwice = topology.compileAssetPlan(compiledOnce);
assert.deepStrictEqual(compiledTwice, compiledOnce, '拓扑编译必须深度幂等');
assert.equal(hash(compiledTwice), hash(compiledOnce), '拓扑双编译哈希必须一致');
assert.deepEqual(
  compiledTwice.story_seed.plot_beats.map(beat => beat.legacy_production_scene_key),
  ['legacy_old_house', 'legacy_old_house'],
  '二次编译不得用确定性 production_scene_key 覆盖首次迁移保存的旧键',
);

const narrative = { content_mode: 'narrative_story', cast_mode: 'single', expected_people: 1 };
assert.equal(sections.sectionDiagnostics({ prop_plan: [] }, narrative).prop_plan.valid, true);
assert.equal(sections.sectionDiagnostics({}, narrative).prop_plan.valid, false);

const contractStandalone = {
  content_mode: 'commercial_subject',
  product_subject: '咖啡机',
  product_presentation: { mode: 'commercial_subject', subject: '咖啡机' },
  advertised_subject_contract: {
    subject: '咖啡机',
    presentation: { mode: 'standalone_product' },
    asset_requirement: { proof_required: true, visual_lock_required: false },
  },
};
assert.equal(sections.sectionDiagnostics({ prop_plan: [] }, contractStandalone).prop_plan.valid, false,
  '合同中的 standalone_product 不得被通用 content mode 遮蔽');

const serviceProof = {
  content_mode: 'commercial_subject',
  advertised_subject_contract: {
    subject: '云端协作服务',
    presentation: { mode: 'service_app_story' },
    asset_requirement: { proof_required: true, visual_lock_required: false },
  },
};
assert.equal(sections.sectionDiagnostics({ prop_plan: [] }, serviceProof).prop_plan.valid, true,
  '服务证明要求本身不得被误判为独立实体产品资产');

assert.throws(() => sections.validateSectionPatch({
  required_missing_sections: ['prop_plan'],
  section_patch: { section: 'cast_profiles', value: [{ id: 'lead' }] },
}, 'prop_plan', narrative), error => error?.code === 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID');

console.log(JSON.stringify({
  passed: true,
  checks: 8,
  topology_double_compile_idempotent: true,
  legacy_scene_key_preserved: true,
  explicit_empty_vs_missing_distinguished: true,
  standalone_contract_precedence_enforced: true,
  proof_only_service_empty_prop_allowed: true,
  paid_provider_calls: 0,
}, null, 2));
