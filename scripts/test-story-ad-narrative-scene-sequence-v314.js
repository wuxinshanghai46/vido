#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const planning = require('../src/services/storyAdWorkspace/storyFlowPlanningService');
const fs = require('fs');
const path = require('path');

const scenes = [
  { scene_id: 'scene_living', name: '现代高端家居展示厅', story_purpose: '人物进入客厅并体验整面背景墙', required_in_story: true },
  { scene_id: 'scene_exhibition', name: '高端商业展台', story_purpose: '从客厅前往展台并完成品牌收束', required_in_story: true },
];
const state = {
  context: { story_seed: {
    opening: '陈默先进入明亮现代的高端家居展示厅，观察客厅整面背景墙。',
    development: '她完成触摸体验，随后场景切换至高端商业展台。',
    resolution: '镜头定格材料，说明不锈钢可用于精致高级的家居与展台。',
  } },
};
const declared = flow.declaredSceneSequence(state, scenes);
assert.deepEqual(declared, ['scene_living', 'scene_exhibition']);

const base = {
  people: [], scenes, narrative_scene_sequence: declared,
  units: [1, 2, 3, 4].map(index => ({ beat_id: `beat_${index}`, title: `节点${index}`, character_ids: [] })),
};
const unit = (index, sceneId, transitionFrom = '') => ({
  beat_id: `beat_${index}`, scene_id: sceneId, character_ids: [], look_bindings: {},
  transition_from: transitionFrom, transition_reason: transitionFrom ? '剧情地点切换' : '',
});
const correct = [unit(1, 'scene_living'), unit(2, 'scene_living'), unit(3, 'scene_exhibition', 'scene_living'), unit(4, 'scene_exhibition')];
assert.equal(flow.validateUnits(base, correct, { requireExact: true }).length, 4);
assert.throws(() => flow.validateUnits(base, [
  unit(1, 'scene_exhibition'), unit(2, 'scene_exhibition'), unit(3, 'scene_living', 'scene_exhibition'), unit(4, 'scene_living'),
], { requireExact: true }), error => error.code === 'STORY_FLOW_CONTRACT_INVALID' && error.issues.some(issue => issue.includes('场景访问顺序必须继承剧情种子')));
assert.throws(() => flow.validateUnits(base, [
  unit(1, 'scene_living'), unit(2, 'scene_exhibition', 'scene_living'), unit(3, 'scene_living', 'scene_exhibition'), unit(4, 'scene_exhibition', 'scene_living'),
], { requireExact: true }), error => error.code === 'STORY_FLOW_CONTRACT_INVALID' && error.issues.some(issue => issue.includes('场景访问顺序必须继承剧情种子')));

const prompt = planning.promptPayload({ scenes, people: [], units: base.units, narrative_scene_sequence: declared, story_seed: state.context.story_seed });
assert.deepEqual(prompt.narrative_scene_sequence, declared);
assert.match(JSON.stringify(prompt.story_seed), /场景切换至高端商业展台/u);
assert(prompt.rules.some(rule => rule.includes('不得为了平均覆盖场景而改写该顺序')));

const planned = flow.plannedScenesForBeats({ sceneConfig: {} }, [
  { title: '家居空间建立', plot: '人物进入客厅并观察整面背景墙' },
  { title: '触摸墙面', plot: '人物在客厅体验背景墙' },
  { title: '展台建立', plot: '随后进入商业展台观察样品' },
  { title: '品牌收束', plot: '在展台完成品牌收束' },
], scenes, declared);
assert.deepEqual(planned, ['scene_living', 'scene_living', 'scene_exhibition', 'scene_exhibition']);
const misleading = flow.plannedScenesForBeats({ sceneConfig: {} }, [
  { title: '展台字样误导', plot: '展台' },
  { title: '客厅体验', plot: '人物进入客厅体验背景墙' },
  { title: '展台观察', plot: '进入展台观察样品' },
  { title: '展台收束', plot: '展台品牌收束' },
], scenes, declared);
assert.deepEqual(misleading, ['scene_living', 'scene_living', 'scene_exhibition', 'scene_exhibition'], '剧情种子顺序必须压过局部关键词造成的反向跳转');

const repairSource = fs.readFileSync(path.resolve(__dirname, 'repair-story-ad-target-narrative-order-v319.js'), 'utf8');
assert.match(repairSource, /TARGET_TASK_ID = 'b83fa67c-244a-4869-b3cc-df282fad5c59'/);
assert.match(repairSource, /EXPECTED_OLD_FLOW_FINGERPRINT/);
assert.match(repairSource, /ACTIVE_GENERATION_BLOCKED/);
assert.match(repairSource, /const OLD_INDEX_ORDER = \[6, 5, 1, 2, 3, 4, 7\]/);
assert.match(repairSource, /model_call_delta: afterCalls - beforeCalls/);
assert.match(repairSource, /provider_calls: 0/);

console.log(JSON.stringify({ passed: true, declared_sequence: declared, correct_flow_accepted: true, reversed_flow_blocked: true, unsupported_reentry_blocked: true, monotonic_draft_planning: true, provider_calls: 0 }));
