#!/usr/bin/env node
const assert = require('assert');
const projection = require('../src/services/newStoryAd/mediaResultProjectionService');
const chineseError = require('../src/services/videoGenerationCore/chineseError');
const videoReview = require('../public/js/new-story-ad/video-review');

const storyboard = Array.from({ length: 5 }, (_, index) => ({ index: index + 1, title: `镜头 ${index + 1}` }));
const passedClip = index => ({ shot_index: index, video_url: `/shot-${index + 1}.mp4`, qa: { pass: true }, ...(index ? { cross_shot_qa: { pass: true } } : {}) });
const rawError = '漫路素材库 CreateAssetGroup 失败 [SubscriptionRequired]: This API requires an active subscription.';
const mediaResult = projection.projectMediaResult({
  task: { status: 'failed', stage: 'media_failed', error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED', error: rawError, generation_progress: { current_index: 5 } },
  outputs: { video_clips: [0, 1, 2, 3].map(passedClip) },
  storyboard,
  videoShotStatuses: [
    ...[1, 2, 3, 4].map(index => ({ index, lifecycle: 'qa_passed', qa_status: 'passed' })),
    { index: 5, lifecycle: 'failed', error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED', error: rawError, provider_submission_state: 'submitted', billing_state: 'unknown' },
  ],
});

assert.deepStrictEqual(mediaResult.passed_shot_indexes, [1, 2, 3, 4]);
assert.strictEqual(mediaResult.failed_shots[0].index, 5);
assert.strictEqual(mediaResult.failed_shots[0].phase, 'pre_submit');
assert.strictEqual(mediaResult.failed_shots[0].provider_submission_state, 'not_submitted');
assert.strictEqual(mediaResult.failed_shots[0].billing_state, 'not_submitted');
assert.match(mediaResult.title, /第 1–4 镜已成功；第 5 镜未成功/);
assert.match(mediaResult.failure_text, /视频模型提交前失败/);
assert.match(mediaResult.cost_text, /未产生本轮视频费用；自动重试 0/);
assert.match(mediaResult.compose_text, /最终封装未执行/);
assert(!mediaResult.failure_text.includes('This API'));

const banner = videoReview.outcomeBannerHtml(mediaResult, value => String(value));
assert.match(banner, /第 1–4 镜已成功/);
assert.match(banner, /第 5 镜未成功/);
assert.match(banner, /未产生本轮视频费用/);
assert.match(banner, /最终封装未执行/);

const subscriptionError = new Error(rawError);
subscriptionError.code = 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED';
const mapped = chineseError.classifyChineseMessage(subscriptionError);
assert.match(mapped, /未开通高级素材库/);
assert(!mapped.includes('This API'));

const finalResult = projection.projectMediaResult({
  task: { status: 'failed', stage: 'media_failed', error_code: 'OLD_ERROR' },
  outputs: { video_clips: [0, 1, 2, 3, 4].map(passedClip), final_video: { video_url: '/final.mp4' } },
  storyboard,
  videoShotStatuses: storyboard.map((_, index) => ({ index: index + 1, lifecycle: 'qa_passed' })),
});
assert.strictEqual(finalResult.outcome, 'success', '最终成片存在时必须优先显示成功，不得复用旧失败状态');
assert.strictEqual(finalResult.compose.status, 'done');

console.log('new story ad media result projection: ok');
