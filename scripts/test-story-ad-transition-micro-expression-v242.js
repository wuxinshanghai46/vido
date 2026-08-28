const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const knowledge = require('../src/services/seeds/transition_micro_expression_knowledge');
const allSeeds = require('../src/services/knowledgeBaseSeed');
const contract = require('../src/services/newStoryAd/transitionPerformanceContractService');
const storyboard = require('../src/services/newStoryAd/storyboardTableService');
const keyframes = require('../src/services/newStoryAd/keyframeContractService');
const storyAd = require('../src/services/newStoryAd/storyAdService');

function run() {
  const transitions = knowledge.filter(item => item.subcategory === '转场边界');
  const expressions = knowledge.filter(item => item.subcategory === '微表情');
  assert.equal(transitions.length, 18, '本地附件实际只有 18 个可读取转场');
  assert.equal(expressions.length, 10, '本地附件实际只有 10 个可读取微表情');
  assert.equal(new Set(knowledge.map(item => item.id)).size, 28);
  assert(knowledge.every(item => allSeeds.some(seed => seed.id === item.id)), '知识必须接入启动 seed');
  assert(transitions.some(item => item.title.endsWith('物件掠镜') && item.content.includes('完整遮挡帧')));
  assert(expressions.some(item => item.title.endsWith('恍然大悟') && item.content.includes('不瞪眼')));

  const transitionDesign = contract.normalizeTransitionDesign({
    motif: '窗帘拂过', execution_class: 'semantic_cut', source_object: '窗帘',
    outgoing_end_state: '窗帘完全遮挡上一镜', incoming_start_state: '窗帘同方向离开露出新场景',
    verification_evidence: '完整遮挡帧与方向一致',
  }, 'match_cut');
  assert.equal(transitionDesign.execution_class, 'semantic_cut');
  assert.equal(transitionDesign.deterministic_fallback, 'match_cut');

  const microExpression = contract.normalizeMicroExpression({
    label: '恍然大悟', gaze: '锁定新线索', eyelids: '适度睁大', brows: '短暂上抬',
    mouth: '微张后自然收回', trigger: '看见关键证据', hold_sec: 0.6,
  });
  assert.equal(microExpression.label, '恍然大悟');
  assert.equal(microExpression.hold_sec, 0.6);
  assert.match(contract.microExpressionPrompt(microExpression), /禁止只动嘴/);

  const shots = storyboard.normalizeShots([
    { index: 1, title: '观察', duration: 3, visual: '人物低头查看线索', action: '低头', scene_id: 'scene-a' },
    {
      index: 2, title: '发现', duration: 3, visual: '人物抬眸发现真相', action: '抬眸', scene_id: 'scene-b',
      emotional_turn: '恍然大悟', micro_expression: microExpression,
      transition_type: 'match_cut', transition_match_anchor: '头部角度', transition_design: transitionDesign,
    },
  ], { target_duration: 6, output_ratio: '9:16', characters: [], scene_assets: [] });
  assert.equal(shots[1].micro_expression.gaze, '锁定新线索');
  assert.equal(shots[1].continuity.transition_design.motif, '窗帘拂过');
  assert.equal(shots[1].requires_previous_frame, true);

  const contracts = keyframes.buildKeyframeContracts({
    output_ratio: '9:16', forbidden: [], cast_profiles: [], pet_profiles: [], scene_assets: [],
    product_contract: {}, controlled_production: {}, knowledge_policy_snapshot: null,
  }, shots);
  assert.equal(contracts[1].performance_lock.micro_expression.label, '恍然大悟');
  assert.match(contracts[1].performance_lock.micro_expression_prompt, /锁定新线索/);
  assert.equal(contracts[1].continuity_lock.transition_design.outgoing_end_state, '窗帘完全遮挡上一镜');
  const prompt = storyAd.buildKeyframePrompt({
    brief: '人物发现真相', product_subject: '剧情线索', output_ratio: '9:16',
    forbidden: [], scene_assets: [], controlled_production: {},
  }, shots[1], contracts[1], 1);
  assert.match(prompt, /Micro-expression performance lock:.*锁定新线索/s);
  assert.match(prompt, /Transition boundary.*窗帘完全遮挡上一镜/s);
  const changedExpression = JSON.parse(JSON.stringify(contracts[1]));
  changedExpression.performance_lock.micro_expression.gaze = '转向右侧出口';
  changedExpression.performance_lock.micro_expression_prompt = '视线：转向右侧出口';
  changedExpression.contract_fingerprint = keyframes.contractFingerprint(changedExpression);
  assert.notEqual(changedExpression.contract_fingerprint, contracts[1].contract_fingerprint, '微表情变化必须使旧关键帧失效');

  const root = path.resolve(__dirname, '..');
  const qaSource = fs.readFileSync(path.join(root, 'src/services/newStoryAd/videoFrameQaService.js'), 'utf8');
  assert.match(qaSource, /生成式转场缺少边界合同字段/);
  assert.match(qaSource, /outgoing_end_state.*incoming_start_state.*verification_evidence/s);

  console.log(JSON.stringify({
    passed: true,
    verified_transition_cards: transitions.length,
    verified_micro_expression_cards: expressions.length,
    unavailable_claimed_transition_cards: 70,
    unavailable_claimed_expression_cards: 30,
    keyframe_contract_propagation: true,
    keyframe_prompt_enforcement: true,
    micro_expression_freshness_gate: true,
    cross_shot_qa_schema_gate: true,
    real_model_calls: 0,
  }, null, 2));
}

run();
