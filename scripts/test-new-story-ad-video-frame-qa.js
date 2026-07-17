const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-video-frame-qa');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.NEW_STORY_AD_MOCK_LLM = '1';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const videoAdapter = require('../src/services/newStoryAd/videoAdapter');
const videoQa = require('../src/services/newStoryAd/videoFrameQaService');

(async () => {
  const provenanceDecision = videoQa.reviewDecision({
    pass: false,
    person_pass: true,
    product_pass: true,
    scene_pass: true,
    action_pass: true,
    people_count_pass: true,
    text_watermark_pass: false,
  }, [
    "Watermark 'AI生成' visible in footage.",
    'Product specifications are not validated due to missing reference QA data.',
  ], { provider_used: 'zhipu/cogvideox-flash' });
  assert.strictEqual(provenanceDecision.pass, true);
  assert.strictEqual(provenanceDecision.accepted_provenance_watermark, true);
  assert.strictEqual(provenanceDecision.problems.length, 0);
  assert.strictEqual(provenanceDecision.warnings.length, 2);
  assert.strictEqual(videoQa.reviewDecision({
    pass: false,
    person_pass: true,
    product_pass: true,
    scene_pass: true,
    action_pass: false,
    people_count_pass: true,
    text_watermark_pass: false,
  }, ["Watermark 'AI生成' visible in footage."], { provider_used: 'zhipu/cogvideox-flash' }).pass, false);
  assert.strictEqual(videoQa.reviewDecision({
    pass: false,
    person_pass: true,
    product_pass: true,
    scene_pass: true,
    action_pass: true,
    people_count_pass: true,
    text_watermark_pass: false,
  }, ['Unexpected commercial watermark visible.'], { provider_used: 'other/provider' }).pass, false);
  assert.strictEqual(videoQa.reviewDecision({
    pass: true,
    person_pass: true,
    product_pass: true,
    scene_pass: true,
    action_pass: true,
    text_watermark_pass: true,
  }, [], { provider_used: 'deyunai/doubao-seedance-2-0-260128' }).pass, false);
  assert.strictEqual(videoQa.expectedPeopleForShot({ cast_mode: 'single' }, {}), 1);
  assert.strictEqual(videoQa.expectedPeopleForShot({ cast_mode: 'single' }, { characters: [] }), 0);
  assert.strictEqual(videoQa.expectedPeopleForShot({ cast_mode: 'no_human' }, {}), 0);
  assert.strictEqual(videoQa.expectedPeopleForShot({}, { characters: [{ name: '甲' }, { name: '乙' }] }), 2);
  assert.strictEqual(videoQa.peopleProblemMatchesApprovedKeyframe('Expected no visible human, but a partial human hand is present.'), true);
  const manualPrompt = videoAdapter.clipPrompt(
    { visual: '展示不锈钢饰面', action: '光线缓慢扫过' },
    { product_subject: '不锈钢饰面' },
    {},
    null,
    {
      image_url: '/api/new-story-ad/assets/manual-approved.png',
      current_generation_status: 'manual_accepted',
      qa: { pass: true, manual_override: true, override_reason: '用户确认多条拼缝符合设计' },
    },
  );
  assert(manualPrompt.includes('The current approved keyframe is authoritative'));
  assert(manualPrompt.includes('用户确认多条拼缝符合设计'));

  const clipPath = path.join(videoAdapter.VIDEO_DIR, 'qa-source.mp4');
  await videoAdapter.renderLocalClip({ outputPath: clipPath, durationSec: 2, aspectRatio: '9:16' });
  const qa = await videoQa.reviewVideoClip({
    taskId: 'video-qa-test',
    clip: { file_path: clipPath, duration_sec: 2 },
    shot: { title: '当前任务镜头', visual: '按当前任务生成的画面', action: '主体自然完成动作' },
    contract: {},
    ctx: { cast_mode: 'no_human', assets: [] },
    index: 0,
  });
  assert.strictEqual(qa.pass, true);
  assert.strictEqual(qa.frames.length, 5);
  assert.deepEqual(qa.frames.map(frame => frame.point), [0, 0.25, 0.5, 0.75, 1]);
  assert(qa.frames.every(frame => fs.existsSync(frame.file_path)));
  process.env.NEW_STORY_AD_MOCK_LLM = '0';
  const matchedKeyframeQa = await videoQa.reviewVideoClip({
    taskId: 'video-qa-keyframe-people-match',
    clip: { file_path: clipPath, duration_sec: 2 },
    shot: { title: 'detail', characters: [] },
    keyframe: { image_url: '/api/new-story-ad/assets/approved-detail.png', contract_fingerprint: 'contract-current', qa: { pass: true } },
    contract: { contract_fingerprint: 'contract-current' },
    ctx: { cast_mode: 'no_human' },
    index: 0,
    gateway: { generateVision: async () => ({ text: JSON.stringify({ pass: false, person_pass: false, product_pass: true, scene_pass: true, action_pass: true, people_count_pass: false, keyframe_people_match: true, unexpected_people_added: false, text_watermark_pass: true, problems: ['Expected no visible human, but a partial human hand is present.'] }), used_model: 'test/vision' }) },
    repair: { parseOrRepair: async ({ raw }) => JSON.parse(raw) },
  });
  assert.strictEqual(matchedKeyframeQa.pass, true, 'a partial person already present in the approved keyframe must not trigger a paid redraw');
  assert.strictEqual(matchedKeyframeQa.people_count_pass, true);
  assert.deepStrictEqual(matchedKeyframeQa.problems, []);
  const manualPartialQa = await videoQa.reviewVideoClip({
    taskId: 'video-qa-manual-partial-person',
    clip: { file_path: clipPath, duration_sec: 2 },
    shot: { title: 'material detail', characters: [], expected_people: 1 },
    keyframe: {
      image_url: '/api/new-story-ad/assets/manual-partial-person.png',
      contract_fingerprint: 'contract-manual-partial',
      current_generation_status: 'manual_accepted',
      qa: { pass: true, manual_override: true, override_reason: '用户确认画面中的手部有效', person: { person_presence: 'partial' } },
    },
    contract: { contract_fingerprint: 'contract-manual-partial' },
    ctx: { cast_mode: 'no_human' },
    index: 0,
    gateway: { generateVision: async () => ({ text: JSON.stringify({
      pass: false, person_pass: false, product_pass: true, scene_pass: false, action_pass: true,
      people_count_pass: false, keyframe_people_match: false, unexpected_people_added: true,
      text_watermark_pass: true,
      problems: [
        'The presence of a hand interacting with the surface introduces a visible partial person, which was not part of the authoritative keyframe.',
        'The inclusion of the hand conflicts with the hard rule against new visible body parts appearing in the clip.',
      ],
    }), used_model: 'test/vision' }) },
    repair: { parseOrRepair: async ({ raw }) => JSON.parse(raw) },
  });
  assert.strictEqual(manualPartialQa.pass, true, 'structured human-approved partial-person evidence must override a contradictory people-presence model verdict');
  assert.strictEqual(manualPartialQa.unexpected_people_added, false);
  assert.deepStrictEqual(manualPartialQa.problems, []);
  const savedContractQa = videoQa.reconcileExistingApprovedPartialPersonQa({
    qa: {
      pass: false,
      person_pass: false,
      product_pass: true,
      scene_pass: false,
      action_pass: true,
      people_count_pass: false,
      text_watermark_pass: true,
      problems: ['The presence of a hand conflicts with the rule to avoid visible human elements.'],
      failure_dimensions: ['person_identity', 'scene_consistency', 'people_count'],
    },
    keyframe: {
      image_url: '/assets/approved-partial.jpg',
      contract_fingerprint: 'contract-partial',
      current_generation_status: 'manual_accepted',
      qa: { pass: true, manual_override: true, person: { person_presence: 'partial' } },
    },
    contract: { contract_fingerprint: 'contract-partial' },
  });
  assert.strictEqual(savedContractQa.pass, true, 'saved manual partial-person evidence should reconcile old contradictory QA without another model call');
  assert.strictEqual(savedContractQa.used_model, undefined, 'saved contract reconciliation must not claim another QA model call');
  assert.strictEqual(savedContractQa.decision_source, 'saved_keyframe_contract_reconciliation');
  const localMotionQa = videoQa.deterministicLocalMotionQa({
    clip: { mode: 'deterministic_local_camera_motion' },
    keyframe: { image_url: '/assets/approved.jpg', contract_fingerprint: 'contract-local', qa: { pass: true } },
    contract: { contract_fingerprint: 'contract-local' },
  });
  assert.strictEqual(localMotionQa.pass, true, 'a pixel transform of the current approved keyframe should pass deterministic QA');
  assert.strictEqual(localMotionQa.used_model, 'none/local-ffmpeg-contract', 'deterministic local motion must not call a QA model');
  process.env.NEW_STORY_AD_MOCK_LLM = '1';
  const cross = await videoQa.reviewCrossShot({ taskId: 'video-qa-test', previous: qa, current: qa, previousShot: {}, currentShot: {}, ctx: {} });
  assert.strictEqual(cross.pass, true);
  console.log('new story ad video frame QA: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
