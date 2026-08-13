const assert = require('assert');
const preflight = require('../src/services/newStoryAd/videoPreflightService');
const storyService = require('../src/services/newStoryAd/storyAdService');

const sceneId = 'scene-current';
const contract = () => ({
  contract_fingerprint: `contract-${Math.random()}`,
  scene_lock: { scene_id: sceneId, scene_revision: 1, scene_contract: { lighting: 'warm' } },
});
const contracts = Array.from({ length: 6 }, contract);
const person = name => [{ name }];
const shots = [
  { title: '开场人物', scene_id: sceneId, duration: 5, characters: person('林清漪'), visual: '人物与完整墙面', action: '人物站稳后轻微转头，镜头缓慢横移', camera: 'pan slow', exit_frame_state: '人物面向墙面' },
  { title: '触碰墙面', scene_id: sceneId, duration: 5, characters: person('林清漪'), visual: '人物伸手触碰墙面', action: '人物从当前站位轻微抬手', camera: 'push in', transition_type: 'hard_cut', entry_frame_state: '人物面向墙面', exit_frame_state: '手指接触墙面' },
  { title: '材质微距', scene_id: sceneId, duration: 5, characters: [], visual: '同一墙面微距', action: '镜头沿纹理极慢横移，光影流动', camera: 'truck slow', transition_type: 'match_cut', entry_frame_state: '手指接触墙面' },
  { title: '材料对比', scene_id: sceneId, duration: 5, characters: [], visual: '无人材料对比', action: '镜头沿材料样品缓慢横移', camera: 'truck slow', transition_type: 'hard_cut' },
  { title: '人物收束', scene_id: sceneId, duration: 5, characters: person('林清漪'), visual: '人物与墙面', action: '人物从当前姿态轻轻点头', camera: 'push slow', transition_type: 'hard_cut', exit_frame_state: '人物保持稳定' },
  { title: '品牌结尾', scene_id: sceneId, duration: 5, characters: [], visual: '人物仍在右侧，品牌留白', action: '粒子汇聚形成 logo', camera: 'static', transition_type: 'dissolve', entry_frame_state: '人物保持稳定', motion_effect: { type: 'particle_assembly', target_state: 'logo' } },
];
const frame = (index, presence, manual = false) => ({
  image_url: `/api/new-story-ad/assets/frame-${index + 1}.png`,
  contract_fingerprint: contracts[index].contract_fingerprint,
  current_generation_id: `frame-generation-${index + 1}`,
  current_generation_status: manual ? 'manual_accepted' : 'accepted',
  qa: { pass: true, manual_override: manual, person: { person_presence: presence } },
});
const keyframes = [frame(0, 'person'), frame(1, 'person'), frame(2, 'partial', true), frame(3, 'none', true), frame(4, 'person'), frame(5, 'partial')];
const media = index => ({ video_url: `/video-${index + 1}.mp4`, lineage_fingerprint: `lineage-${index + 1}`, cross_shot_qa: { pass: true } });
const clips = [
  { ...media(0), qa: { pass: false, failure_dimensions: ['person_identity', 'action_fulfillment'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  { ...media(1), qa: { pass: true } },
  { ...media(2), qa: { pass: false, failure_dimensions: ['person_identity', 'scene_consistency', 'people_count'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  { ...media(3), qa: { pass: false, failure_dimensions: ['people_count'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  null,
  { ...media(5), qa: { pass: true } },
];
const statuses = [{}, {}, {}, {}, { error_code: 'PROVIDER_BILLING' }, {}];

const projectedOutput = storyService.projectVideoOutputContext(
  { output_ratio: '16:9', video_resolution: '1080p', video_quality: 'final' },
  { video_resolution: '720p' },
);
assert.strictEqual(projectedOutput.output_ratio, '16:9');
assert.strictEqual(projectedOutput.video_resolution, '720p');
assert.strictEqual(projectedOutput.video_quality, 'final');

const economy = preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses, mode: 'economy', providerRoute: 'deyunai/seedance',
});
assert.deepStrictEqual(economy.shots.map(item => item.action), ['provider_generate', 'reuse', 'review_only', 'local_motion', 'provider_generate', 'reuse']);
assert.strictEqual(economy.paid_unit_count, 2);
assert.strictEqual(economy.local_unit_count, 1);
assert.strictEqual(economy.review_only_count, 1);
assert.strictEqual(economy.automatic_retry_count, 0);
assert.strictEqual(economy.status, 'partial_ready');
assert.strictEqual(economy.blockers[0].code, 'VIDEO_PROVIDER_BILLING_BLOCKED');
assert(economy.shots[0].repair_instruction.includes('only visual reference'));

const evidenceOnlyClips = clips.slice();
evidenceOnlyClips[1] = {
  ...media(1),
  qa: { pass: true, frames: [{ image_url: '/shot-2-head.jpg' }] },
  cross_shot_qa: { pass: false, error_code: 'VIDEO_QA_EVIDENCE_MISSING' },
  error_code: 'CROSS_SHOT_CONTINUITY_FAILED',
};
const evidenceOnly = preflight.buildVideoPreflight({
  taskId: 'preflight-evidence-only', shots, keyframes, contracts, clips: evidenceOnlyClips, statuses: [],
  mode: 'economy', providerRoute: 'deyunai/seedance', onlyIndexes: [1],
});
assert.strictEqual(evidenceOnly.paid_unit_count, 0, 'missing cross-shot evidence must never require another video generation');
assert.strictEqual(evidenceOnly.review_only_count, 1);
assert.strictEqual(evidenceOnly.shots[0].review_scope, 'cross_shot');
assert.match(evidenceOnly.shots[0].label, /不重新生成/);
assert.strictEqual(evidenceOnly.units.length, 1, 'evidence-only review must be selectable in the unit picker');
assert.strictEqual(evidenceOnly.units[0].paid, false);
assert.strictEqual(evidenceOnly.units[0].review_scope, 'cross_shot');

const targeted = preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses, mode: 'economy', providerRoute: 'deyunai/seedance', onlyIndexes: [3],
});
assert.deepStrictEqual(targeted.shots.map(item => item.shot_index), [4]);
assert.strictEqual(targeted.paid_unit_count, 0);
assert.strictEqual(targeted.local_unit_count, 1);
assert.strictEqual(targeted.blockers.length, 0, 'an unrelated billing failure must not block a zero-cost targeted fix');

const localMotionWithMissingArtifact = preflight.buildVideoPreflight({
  taskId: 'preflight-local-motion-compatibility',
  shots,
  keyframes,
  contracts,
  clips,
  statuses: [],
  mode: 'economy',
  providerRoute: 'deyunai/seedance',
  onlyIndexes: [3],
  compatibilityReport: {
    fingerprint: 'compatibility-missing-media',
    decisions: [{
      index: 3,
      status: 'regenerate_required',
      reason_codes: ['MEDIA_MISSING'],
    }],
  },
});
assert.strictEqual(localMotionWithMissingArtifact.paid_unit_count, 0, 'missing legacy media must not promote local motion into a paid provider call');
assert.strictEqual(localMotionWithMissingArtifact.local_unit_count, 1);
assert.strictEqual(localMotionWithMissingArtifact.shots[0].action, 'local_motion');
assert.strictEqual(localMotionWithMissingArtifact.shots[0].paid, false);
assert.strictEqual(localMotionWithMissingArtifact.units[0].input_strategy, 'approved_keyframe_local_motion');

const quality = preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses: [], mode: 'quality', providerRoute: 'deyunai/seedance',
});
assert.deepStrictEqual(quality.units.map(unit => unit.shots), [[1], [3], [4], [5]]);
assert.deepStrictEqual(quality.units.map(unit => unit.action), ['provider_generate', 'review_only', 'local_motion', 'provider_generate']);
assert(quality.units.every(unit => unit.duration_sec <= 10), '高质量逐镜生成单元必须遵守 10 秒硬上限');
assert.strictEqual(quality.paid_unit_count, 2, '已有合格视频必须复用，不能因进入整条广告模式而重新付费生成');
assert.strictEqual(quality.local_unit_count, 1);
assert.strictEqual(quality.review_only_count, 1);
assert.strictEqual(quality.reuse_count, 2);
assert.strictEqual(quality.paid_video_seconds, 10);
assert.strictEqual(quality.fingerprint, preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses: [], mode: 'quality', providerRoute: 'deyunai/seedance',
}).fingerprint, 'preflight confirmation fingerprint must be stable');

const freshQuality = preflight.buildVideoPreflight({
  taskId: 'preflight-fresh-task', shots, keyframes, contracts, clips: Array(6).fill(null), statuses: [], mode: 'quality', providerRoute: 'deyunai/seedance',
});
assert.deepStrictEqual(freshQuality.units.map(unit => unit.shots), [[1], [2], [3], [4], [5], [6]]);
assert.deepStrictEqual(freshQuality.units.map(unit => unit.action), ['provider_generate', 'provider_generate', 'local_motion', 'local_motion', 'provider_generate', 'provider_generate']);
assert.strictEqual(freshQuality.paid_unit_count, 4, '全新任务必须让每个付费镜头分别使用自己的批准关键帧，本地运镜不能被相邻镜头升级为付费');
assert.strictEqual(freshQuality.local_unit_count, 2);
assert.strictEqual(freshQuality.paid_video_seconds, 20);

console.log('new story ad video preflight: ok');
