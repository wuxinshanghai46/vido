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
  const cross = await videoQa.reviewCrossShot({ taskId: 'video-qa-test', previous: qa, current: qa, previousShot: {}, currentShot: {}, ctx: {} });
  assert.strictEqual(cross.pass, true);
  console.log('new story ad video frame QA: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
