#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projection = require('../src/services/newStoryAd/mediaResultProjectionService');
const videoReview = require('../public/js/new-story-ad/video-review');

const storyboard = count => Array.from({ length: count }, (_, index) => ({ index: index + 1, title: `镜头 ${index + 1}` }));
const passedClip = (index, extra = {}) => ({
  shot_index: index,
  video_url: `/shot-${index + 1}.mp4`,
  qa: { pass: true },
  ...(index ? { cross_shot_qa: { pass: true } } : {}),
  ...extra,
});
const passedStatus = index => ({ index: index + 1, lifecycle: 'qa_passed', qa_status: 'passed' });

function result({ count = 1, task = {}, clips = [], statuses = [], finalVideo = null } = {}) {
  return projection.projectMediaResult({
    task,
    outputs: { video_clips: clips, ...(finalVideo ? { final_video: finalVideo } : {}) },
    storyboard: storyboard(count),
    videoShotStatuses: statuses,
  });
}

// 生产同构：第 1–4 镜成功，第 5 镜在素材准备阶段失败。
{
  const rawError = '漫路素材库 CreateAssetGroup 失败 [SubscriptionRequired]: This API requires an active subscription.';
  const media = result({
    count: 5,
    task: { status: 'failed', stage: 'media_failed', error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED', error: rawError, generation_progress: { current_index: 5 } },
    clips: [0, 1, 2, 3].map(passedClip),
    statuses: [
      ...[0, 1, 2, 3].map(passedStatus),
      { index: 5, lifecycle: 'failed', error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED', error: rawError, provider_submission_state: 'submitted', billing_state: 'unknown' },
    ],
  });
  assert.deepStrictEqual(media.passed_shot_indexes, [1, 2, 3, 4]);
  assert.deepStrictEqual(media.pending_shot_indexes, []);
  assert.strictEqual(media.failed_shots[0].index, 5);
  assert.strictEqual(media.failed_shots[0].state, 'pre_submit_failed');
  assert.strictEqual(media.failed_shots[0].phase, 'pre_submit');
  assert.strictEqual(media.failed_shots[0].provider_submission_state, 'not_submitted');
  assert.strictEqual(media.failed_shots[0].billing_state, 'not_submitted');
  assert.strictEqual(media.failed_shots[0].automatic_retry_count, 0);
  assert.match(media.title, /第 1–4 镜已成功；第 5 镜尚未成功/);
  assert.match(media.failure_text, /视频模型提交前失败/);
  assert.match(media.cost_text, /未产生本轮视频生成费用；自动付费重试 0/);
  assert.match(media.compose_text, /最终封装已阻止/);
  assert(!media.failure_text.includes('This API'));
}

// QA 三态及尚未开始必须互斥，不能把有文件但未 QA 的片段算作成功。
{
  const notStarted = result({ count: 1 });
  assert.strictEqual(notStarted.outcome, 'not_started');
  assert.strictEqual(notStarted.shot_results[0].state, 'not_started');
  assert.strictEqual(notStarted.compose.status, 'not_started');

  const pending = result({ count: 1, clips: [{ shot_index: 0, video_url: '/pending.mp4', qa: null }], statuses: [{ index: 1, lifecycle: 'generated', provider_task_id: 'provider-pending', billing_state: 'confirmed' }] });
  assert.strictEqual(pending.shot_results[0].state, 'generated_qa_pending');
  assert.deepStrictEqual(pending.generated_qa_pending_indexes, [1]);
  assert.deepStrictEqual(pending.passed_shot_indexes, []);
  assert.match(pending.failure_text, /质量审核尚未完成/);

  const failed = result({ count: 1, clips: [{ shot_index: 0, video_url: '/failed.mp4', qa: { pass: false, problems: ['人物错误'] } }], statuses: [{ index: 1, lifecycle: 'qa_failed', qa_status: 'failed', provider_task_id: 'provider-qa', provider_submission_state: 'completed', billing_state: 'confirmed' }] });
  assert.strictEqual(failed.shot_results[0].state, 'qa_failed');
  assert.deepStrictEqual(failed.qa_failed_indexes, [1]);
  assert.match(failed.failure_text, /视频已生成，但质量审核未通过/);
  assert.match(failed.cost_text, /已提交视频模型并产生视频生成费用/);

  const passed = result({ count: 1, clips: [passedClip(0)], statuses: [passedStatus(0)] });
  assert.strictEqual(passed.shot_results[0].state, 'passed');
  assert.strictEqual(passed.outcome, 'ready_to_compose');
  assert.strictEqual(passed.compose.status, 'ready');
}

// 单镜 QA 通过但 1→2 交接失败，必须单独归类为 boundary_failed。
{
  const boundary = result({
    count: 2,
    clips: [passedClip(0), passedClip(1, { cross_shot_qa: { pass: false, problems: ['动作重置'] } })],
    statuses: [passedStatus(0), { index: 2, lifecycle: 'qa_failed', qa_status: 'failed' }],
  });
  assert.strictEqual(boundary.shot_results[1].state, 'boundary_failed');
  assert.deepStrictEqual(boundary.boundary_failed_indexes, [2]);
  assert.match(boundary.failure_text, /相邻镜头衔接审核未通过/);
  assert.strictEqual(boundary.compose.status, 'blocked');
}

// provider 已提交后的失败不得被显示成“未提交/未计费”。
{
  const provider = result({
    count: 1,
    task: { status: 'failed', stage: 'media_failed', error_code: 'PROVIDER_5XX_AMBIGUOUS', error: '供应商失败' },
    statuses: [{ index: 1, lifecycle: 'failed', error_code: 'PROVIDER_5XX_AMBIGUOUS', provider_task_id: 'provider-task-1', provider_submission_state: 'submitted', billing_state: 'unknown' }],
  });
  assert.strictEqual(provider.failed_shots[0].phase, 'provider');
  assert.strictEqual(provider.failed_shots[0].billing_state, 'unknown');
  assert.match(provider.failure_text, /视频供应商生成阶段失败/);
  assert.match(provider.cost_text, /计费状态待核对，禁止直接重试/);
}

// 全部镜头通过后 compose 失败，只能报封装失败，不能倒推镜头失败。
{
  const compose = result({
    count: 2,
    task: { status: 'failed', stage: 'compose_failed', error_code: 'COMPOSE_FAILED', error: 'ffmpeg failed' },
    clips: [passedClip(0), passedClip(1)],
    statuses: [passedStatus(0), passedStatus(1)],
  });
  assert.strictEqual(compose.outcome, 'compose_failed');
  assert.deepStrictEqual(compose.passed_shot_indexes, [1, 2]);
  assert.deepStrictEqual(compose.failed_shots, []);
  assert.strictEqual(compose.compose.status, 'failed');
  assert.match(compose.compose_text, /最终封装失败/);
}

// 历史 final 成功必须覆盖残留失败和版本兼容提示。
{
  const final = result({
    count: 2,
    task: { status: 'failed', stage: 'media_failed', error_code: 'OLD_ERROR', error: '旧错误' },
    clips: [passedClip(0), passedClip(1, { compatibility_status: 'outdated' })],
    statuses: [passedStatus(0), { ...passedStatus(1), compatibility_status: 'outdated' }],
    finalVideo: { video_url: '/final.mp4' },
  });
  assert.strictEqual(final.outcome, 'success');
  assert.strictEqual(final.compose.status, 'done');
  assert.strictEqual(final.compatibility.final_success_override, true);
  assert.strictEqual(final.failure_text, '');
  assert.match(final.cost_text, /不会因历史失败状态自动再次付费/);
}

// 第 1–4、6 镜成功，第 5 镜与当前版本不兼容：不能把第 6 镜吞进连续范围。
{
  const clips = [0, 1, 2, 3, null, 5].map((value, index) => (value === null ? null : passedClip(index)));
  const statuses = [0, 1, 2, 3, 4, 5].map(index => (index === 4
    ? { index: 5, lifecycle: 'regenerate_required', compatibility_status: 'outdated', regenerate_required: true }
    : passedStatus(index)));
  const compatibility = result({ count: 6, clips, statuses });
  assert.deepStrictEqual(compatibility.passed_shot_indexes, [1, 2, 3, 4, 6]);
  assert.deepStrictEqual(compatibility.regenerate_required_indexes, [5]);
  assert.deepStrictEqual(compatibility.pending_shot_indexes, [5]);
  assert.strictEqual(compatibility.shot_results[4].state, 'regenerate_required');
  assert.strictEqual(compatibility.compatibility.status, 'regenerate_required');
  assert.match(compatibility.title, /第 1–4、6 镜已成功；第 5 镜尚未成功/);
  assert.match(compatibility.failure_text, /第 5 镜与当前版本不兼容，需要重新生成/);
  assert.match(compatibility.cost_text, /必须重新预检并确认费用/);
}

// 恢复旧 clip 后，当前可用结果与最近一次失败必须分开，不能互相覆盖计费状态。
{
  const restored = result({
    count: 1,
    task: { status: 'failed', stage: 'media_failed', error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED', error: '素材准备失败' },
    clips: [passedClip(0, { provider_task_id: 'old-provider', billing_state: 'confirmed' })],
    statuses: [{
      index: 1,
      lifecycle: 'failed',
      error_code: 'DEYUNAI_ASSET_SUBSCRIPTION_REQUIRED',
      error: '素材准备失败',
      previous_clip_restored: true,
      last_attempt_provider_submission_state: 'not_submitted',
      last_attempt_billing_state: 'not_submitted',
    }],
  });
  assert.strictEqual(restored.shot_results[0].current_attempt.state, 'passed');
  assert.strictEqual(restored.shot_results[0].current_attempt.provider_task_id, 'old-provider');
  assert.strictEqual(restored.shot_results[0].current_attempt.billing_state, 'confirmed');
  assert.strictEqual(restored.shot_results[0].last_attempt.state, 'pre_submit_failed');
  assert.strictEqual(restored.shot_results[0].last_attempt.billing_state, 'not_submitted');
  assert.deepStrictEqual(restored.failed_shots, []);
  assert.strictEqual(restored.last_attempt_failed_shots.length, 1);
  assert.match(restored.failure_text, /当前可用结果已保留；最近一次尝试在视频模型提交前失败/);
}

// 生产同构：选择第 2、4 镜后第 2 镜 fail-fast，第 4 镜未执行，任务错误不得污染第 4 镜。
{
  const privacy = result({
    count: 4,
    task: {
      status: 'failed', stage: 'media_failed', error_code: 'INPUT_PERSON_PRIVACY',
      error: '第 2 镜输入图片可能包含真人',
      generation_progress: { repair_indexes: [2, 4], failed_indexes: [2], current_index: 2 },
    },
    clips: [0, 1, 2, 3].map(passedClip),
    statuses: [
      passedStatus(0),
      { index: 2, lifecycle: 'failed', error_code: 'INPUT_PERSON_PRIVACY', previous_clip_restored: true, last_attempt_error_code: 'INPUT_PERSON_PRIVACY', last_attempt_status: 'failed', last_attempt_provider_submission_state: 'not_submitted', last_attempt_billing_state: 'not_submitted' },
      passedStatus(2),
      { ...passedStatus(3), stopped_after_unit_failure: true },
    ],
  });
  assert.deepStrictEqual(privacy.passed_shot_indexes, [1, 2, 3, 4]);
  assert.deepStrictEqual(privacy.last_attempt_failed_shots.map(item => item.index), [2]);
  assert.deepStrictEqual(privacy.not_executed_indexes, [4]);
  assert.strictEqual(privacy.shot_results[3].last_attempt, null, 'untouched shot 4 must not inherit shot 2 failure');
  assert.match(privacy.title, /现有已审核片段仍保留；本次第 2 镜生成失败/);
  assert.match(privacy.failure_text, /第 2 镜当前可用结果已保留/);
  assert.match(privacy.failure_text, /真人隐私信息/);
  assert.match(privacy.failure_text, /第 4 镜因前一生成单元失败，本次未执行/);
  assert(!privacy.failure_text.includes('第 4 镜当前可用结果已保留'));
  assert.strictEqual(privacy.compose.status, 'blocked');
}

// 历史兼容状态要公开为 compatibility 结果，不应强制判失败。
{
  const legacy = result({
    count: 1,
    clips: [passedClip(0, { compatibility_status: 'legacy_partial' })],
    statuses: [{ ...passedStatus(0), legacy_inferred: true }],
  });
  assert.strictEqual(legacy.shot_results[0].compatibility.status, 'legacy_compatible');
  assert.strictEqual(legacy.compatibility.status, 'legacy_compatible');
  assert.strictEqual(legacy.shot_results[0].state, 'passed');
}

// DOM 片段必须使用结构化结果并转义用户可控文本。
{
  const media = result({ count: 1 });
  media.title = '<img src=x onerror=alert(1)>';
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const banner = videoReview.outcomeBannerHtml(media, escape);
  assert.match(banner, /data-nsa-media-outcome="not_started"/);
  assert(!banner.includes('<img'));
  assert(banner.includes('&lt;img'));
}

// 状态同步在切换任务或服务端明确返回 null 时必须清理旧媒体结果。
{
  const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
  const sandbox = { window: {}, Object, String, Number, Array, Date };
  vm.runInNewContext(source, sandbox, { filename: 'state-sync.js' });
  const sync = sandbox.window.NewStoryAdStateSync;
  const state = { taskId: 'task-old', mediaResult: { outcome: 'partial_failed' } };
  sync.syncMediaResult(state, { bundle: { task: { id: 'task-new' }, media_result: null }, incomingTaskId: 'task-new' });
  assert.strictEqual(state.mediaResult, null);
  sync.syncMediaResult(state, { bundle: { task: { id: 'task-new' }, media_result: { outcome: 'success' } }, incomingTaskId: 'task-new' });
  assert.strictEqual(state.mediaResult.outcome, 'success');
}

console.log('new story ad media result projection: ok');
