#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const storyFlow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const quality = require('../src/services/newStoryAd/qualityReviewService');

function flowFixture(assignments) {
  const scenes = [
    { scene_id: 'scene_home', name: '真实家居空间', required_in_story: true, covered_beat_ids: [] },
    { scene_id: 'scene_booth', name: '商业展台', required_in_story: true, covered_beat_ids: [] },
  ];
  return {
    people: [], scenes,
    units: assignments.map((sceneId, index) => ({
      beat_id: `beat_${index + 1}`, beat_index: index + 1, title: `剧情节点 ${index + 1}`,
      scene_id: sceneId, character_ids: [], look_bindings: {}, voice_bindings: {},
      transition_from: index && assignments[index - 1] !== sceneId ? assignments[index - 1] : '',
      transition_reason: index && assignments[index - 1] !== sceneId ? '剧情进入新的已确认空间' : '',
    })),
  };
}

function testMeaningfulSceneCoverage() {
  const invalid = flowFixture(['scene_booth', 'scene_booth', 'scene_booth', 'scene_booth', 'scene_booth', 'scene_booth', 'scene_home']);
  assert.throws(
    () => storyFlow.validateUnits(invalid, invalid.units, { requireExact: true }),
    error => error.code === 'STORY_FLOW_CONTRACT_INVALID' && /至少需要 2 个有剧情作用的节点/.test(error.message),
  );
  const valid = flowFixture(['scene_home', 'scene_home', 'scene_booth', 'scene_booth', 'scene_booth', 'scene_booth', 'scene_booth']);
  assert.equal(storyFlow.validateUnits(valid, valid.units, { requireExact: true }).length, 7);
}

function testCrossSceneContamination() {
  const sceneAssets = [
    {
      scene_id: 'scene_home', name: '真实家居空间', story_purpose: '展示沙发、茶几与家居墙面的实际应用',
      scene_contract: { anchors: [{ label: '沙发茶几', description: '中央家居休息区' }] },
    },
    {
      scene_id: 'scene_booth', name: '商业展台', story_purpose: '展示商业样板与展台陈列',
      scene_contract: { anchors: [{ label: '展台台面', description: '商业展台台面陈列样板' }] },
    },
  ];
  const issues = quality.sceneSemanticContaminationIssues(sceneAssets, {
    scene_id: 'scene_home', title: '家居收束',
    visual: '人物站在展台台面前，观察商业样板陈列。',
  }, 6);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /第 7 镜绑定“真实家居空间”/);
  assert.equal(quality.sceneSemanticContaminationIssues(sceneAssets, {
    scene_id: 'scene_home', visual: '人物在沙发和茶几旁观察家居墙面。',
  }, 0).length, 0);
}

function testDirectGenerationUxContract() {
  const storyboard = read('public/story-ad/views/storyboardView.js');
  const storyboardCss = read('public/story-ad/storyboard-simple.css');
  const viewer = read('public/story-ad/views/sceneWorldView.js');
  const units = read('src/services/newStoryAd/generationUnitService.js');
  assert.match(storyboard, /checkpointShotCard/);
  assert.match(storyboard, /liveGenerationShotCard/);
  assert.match(storyboard, /data-storyboard-live-results/);
  assert.match(storyboard, /startedAt: progress\.started_at/);
  assert.match(storyboard, /acknowledge_billing_unknown: true/);
  assert.match(storyboard, /user_initiated_direct_generation: true/);
  assert.doesNotMatch(storyboard, /确认可能重复计费|我接受风险|confirmDialog/);
  assert.match(storyboardCss, /generation-model-picker,[^{]+\.btn \{ width:220px;min-width:220px;max-width:220px/);
  assert.match(viewer, /textureNode[\s\S]+view_key[\s\S]+layout/);
  assert.match(viewer, /context\.transform\(/);
  assert.match(viewer, /场景实图参考平面 · 可旋转机位规划/);
  assert.match(units, /automatic_retry_allowed: false/);
  assert.match(units, /计费未知禁止自动重试/);
}

testMeaningfulSceneCoverage();
testCrossSceneContamination();
testDirectGenerationUxContract();
console.log(JSON.stringify({
  passed: true,
  checks: 18,
  required_scene_minimum_when_capacity_allows: 2,
  cross_scene_contamination_blocked: true,
  checkpoint_cards_live: true,
  elapsed_in_progress_panel: true,
  equal_primary_control_width: '220px',
  user_dialogs_for_direct_storyboard_generation: 0,
  automatic_unknown_billing_retry: false,
  paid_model_calls: 0,
}));
