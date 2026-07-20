const assert = require('assert');
const preflight = require('../src/services/newStoryAd/videoPreflightService');

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
const media = index => ({ video_url: `/video-${index + 1}.mp4`, lineage_fingerprint: `lineage-${index + 1}` });
const clips = [
  { ...media(0), qa: { pass: false, failure_dimensions: ['person_identity', 'action_fulfillment'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  { ...media(1), qa: { pass: true } },
  { ...media(2), qa: { pass: false, failure_dimensions: ['person_identity', 'scene_consistency', 'people_count'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  { ...media(3), qa: { pass: false, failure_dimensions: ['people_count'] }, error_code: 'VIDEO_FRAME_QA_FAILED' },
  null,
  { ...media(5), qa: { pass: true } },
];
const statuses = [{}, {}, {}, {}, { error_code: 'PROVIDER_BILLING' }, {}];

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

const targeted = preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses, mode: 'economy', providerRoute: 'deyunai/seedance', onlyIndexes: [3],
});
assert.deepStrictEqual(targeted.shots.map(item => item.shot_index), [4]);
assert.strictEqual(targeted.paid_unit_count, 0);
assert.strictEqual(targeted.local_unit_count, 1);
assert.strictEqual(targeted.blockers.length, 0, 'an unrelated billing failure must not block a zero-cost targeted fix');

const quality = preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses: [], mode: 'quality', providerRoute: 'deyunai/seedance',
});
assert.deepStrictEqual(quality.units.map(unit => unit.shots), [[1, 2, 3], [4], [5], [6]]);
assert.deepStrictEqual(quality.units.map(unit => unit.action), ['provider_generate', 'local_motion', 'provider_generate', 'provider_generate']);
assert.strictEqual(quality.paid_unit_count, 3, '高质量整条广告模式应按兼容连续场景段计费，而不是逐镜提交');
assert.strictEqual(quality.local_unit_count, 1);
assert.strictEqual(quality.paid_video_seconds, 25);
assert.strictEqual(quality.fingerprint, preflight.buildVideoPreflight({
  taskId: 'preflight-task', shots, keyframes, contracts, clips, statuses: [], mode: 'quality', providerRoute: 'deyunai/seedance',
}).fingerprint, 'preflight confirmation fingerprint must be stable');

console.log('new story ad video preflight: ok');
