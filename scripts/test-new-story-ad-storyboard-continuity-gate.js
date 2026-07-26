const assert = require('assert');
const gate = require('../src/services/newStoryAd/storyboardContinuityGateService');
const continuity = require('../src/services/newStoryAd/continuityService');

const inherited = [
  {
    scene_id: 'scene-a',
    scene_revision: 2,
    exit_frame_state: '人物站在墙面左侧，右手停在墙面前 10 厘米，尚未接触墙面',
    action_end: '右手停在墙面前 10 厘米',
    screen_direction: 'left_to_right',
    camera_axis: '人物与墙面的同一侧轴线',
    object_states: '墙面关闭；灯光开启',
  },
  {
    scene_id: 'scene-a',
    scene_revision: 2,
    requires_previous_frame: true,
    transition_type: 'cut_on_action',
    entry_frame_state: '人物站在墙面左侧，右手停在墙面前 10 厘米，尚未接触墙面',
    exit_frame_state: '右手继续靠近墙面',
    action_start: '右手从墙面前 10 厘米处继续移动',
    action_end: '右手靠近但仍未触碰墙面',
    screen_direction: 'left_to_right',
    camera_axis: '人物与墙面的同一侧轴线',
    object_states: '墙面关闭；灯光开启',
  },
];
const contracts = inherited.map(() => ({
  scene_lock: { scene_id: 'scene-a', scene_revision: 2 },
}));
const passing = gate.reviewContinuity({ shots: inherited, contracts });
assert.strictEqual(passing.pass, true);
assert.deepStrictEqual(passing.issues, []);

const contactJump = inherited.concat({
  scene_id: 'scene-a',
  scene_revision: 2,
  requires_previous_frame: true,
  transition_type: 'cut_on_action',
  entry_frame_state: '人物保持站位，指尖已经接触墙面',
  exit_frame_state: '指尖按在墙面上',
  action_start: '指尖从接触墙面的状态开始',
  action_end: '指尖按稳',
  screen_direction: 'left_to_right',
  camera_axis: '人物与墙面的同一侧轴线',
  object_states: '墙面关闭；灯光开启',
});
const failed = gate.reviewContinuity({
  shots: contactJump,
  contracts: contracts.concat({ scene_lock: { scene_id: 'scene-a', scene_revision: 2 } }),
});
assert.strictEqual(failed.pass, false);
assert(failed.issues.some(issue => /未接触.*已接触/.test(issue)), '继承上一帧时不得跳过接触动作');

const revisionMismatch = gate.reviewContinuity({
  shots: inherited,
  contracts: [
    { scene_lock: { scene_id: 'scene-a', scene_revision: 2 } },
    { scene_lock: { scene_id: 'scene-a', scene_revision: 3 } },
  ],
});
assert(revisionMismatch.issues.some(issue => /场景版本不一致/.test(issue)));

const recommended = continuity.withContinuityContracts([
  { scene_id: 'scene-a', action_end: '人物抬起手臂' },
  { scene_id: 'scene-b', action_start: '手臂继续抬起' },
]);
assert.strictEqual(recommended[1].transition_type, 'dissolve', 'a cross-scene boundary without an authored override must receive a visible default recommendation');
assert.strictEqual(recommended[1].transition_source, 'recommended');
assert.strictEqual(recommended[1].boundary_mode, 'intentional_scene_change');
assert(recommended[1].transition_duration_sec > 0);

const authoredMatch = continuity.withContinuityContracts([
  { scene_id: 'scene-a', action_end: '镜头停在圆形灯具' },
  {
    scene_id: 'scene-b',
    transition_type: 'match_cut',
    transition_match_anchor: '画面中心圆形轮廓',
    transition_reason: '由灯具圆形切到产品圆形',
  },
]);
assert.strictEqual(authoredMatch[1].transition_type, 'match_cut');
assert.strictEqual(authoredMatch[1].transition_source, 'authored');
assert.strictEqual(authoredMatch[1].transition_match_anchor, '画面中心圆形轮廓');

const missingAnchor = gate.reviewContinuity({
  shots: [
    { scene_id: 'scene-a' },
    { scene_id: 'scene-b', transition_type: 'match_cut', transition_reason: '视觉匹配' },
  ],
});
assert(missingAnchor.issues.some(issue => /匹配锚点/.test(issue)));

const missingCrossSceneReason = gate.reviewContinuity({
  shots: [
    { scene_id: 'scene-a' },
    { scene_id: 'scene-b', transition_type: 'hard_cut' },
  ],
});
assert(missingCrossSceneReason.issues.some(issue => /缺少转场原因/.test(issue)));

console.log('new story ad storyboard continuity gate: ok');
