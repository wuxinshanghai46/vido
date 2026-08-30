#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const planning = require('../src/services/storyAdWorkspace/storyFlowPlanningService');

const scenes = [
  { scene_id: 'scene_living', name: '现代高端家居展示厅', story_purpose: '人物进入客厅并体验整面背景墙', required_in_story: true },
  { scene_id: 'scene_exhibition', name: '高端商业展台', story_purpose: '从客厅前往展台并完成品牌收束', required_in_story: true },
];
const state = {
  context: { story_seed: {
    opening: '陈默先进入现代高端家居展示厅，观察客厅整面背景墙。',
    development: '她在现代高端家居展示厅完成触摸体验。',
    resolution: '随后从现代高端家居展示厅前往高端商业展台，在展台前完成收束。',
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
assert.match(JSON.stringify(prompt.story_seed), /家居展示厅前往高端商业展台/u);
assert(prompt.rules.some(rule => rule.includes('不得为了平均覆盖场景而改写该顺序')));

console.log(JSON.stringify({ passed: true, declared_sequence: declared, correct_flow_accepted: true, reversed_flow_blocked: true, unsupported_reentry_blocked: true, provider_calls: 0 }));
