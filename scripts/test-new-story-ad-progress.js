#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/progress.js'), 'utf8');
const sandbox = { window: {}, Date, Math, Number, String };
vm.runInNewContext(source, sandbox, { filename: 'progress.js' });

const result = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', startedAt: Date.now() - 65000, total: 6 },
  completed: 6,
  serverProgress: { stage: 'keyframes', target_total: 6, processed: 2, succeeded: 1, failed: 1, current_index: 3 },
});
assert.match(result.title, /第 3\/6 张/);
assert.match(result.stat, /1分0[45]秒/);
assert.match(result.message, /已处理 2\/6 张，成功 1 张，失败 1 张/);

const parallel = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', generationId: 'generation-parallel', startedAt: Date.now(), total: 6 },
  serverProgress: {
    stage: 'keyframes', generation_id: 'generation-parallel', target_total: 6,
    processed: 1, succeeded: 1, failed: 0, current_index: 2,
    configured_concurrency: 2, effective_concurrency: 2, active_indexes: [3, 2, 2],
  },
});
assert.match(parallel.title, /并行生成真实画面：第 2、3 张（共 6 张）/);
assert.match(parallel.message, /正在并行生成第 2、3 张（并发 2）/);

const freshBatch = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', generationId: 'generation-fresh', startedAt: Date.now(), total: 6 },
  completed: 6,
  serverProgress: null,
});
assert.match(freshBatch.title, /第 1\/6 张/, '新批次不得把历史 6 张当作本轮完成进度');
assert.match(freshBatch.message, /已处理 0\/6 张/);

const staleServerBatch = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', generationId: 'generation-fresh', startedAt: Date.now(), total: 6 },
  completed: 6,
  serverProgress: { stage: 'keyframes', generation_id: 'generation-old', target_total: 6, processed: 6, succeeded: 6 },
});
assert.match(staleServerBatch.title, /第 1\/6 张/, '不得混用上一批次的服务端进度');

const syncSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
vm.runInNewContext(syncSource, sandbox, { filename: 'state-sync.js' });
const sync = sandbox.window.NewStoryAdStateSync;
assert(sync.progressStageMatches('storyboard', 'storyboard'));
assert(sync.progressStageMatches('scene', 'scene_config'));
assert(!sync.progressStageMatches('storyboard', 'blueprint'));

const localStart = Date.now();
const state = {
  stageProgress: { active: true, stage: 'storyboard', generationId: '', startedAt: localStart },
  shots: [], contracts: [], keyframes: [], videoClips: [],
};
sync.normalizeBundle({
  task: { active_generation_id: '', active_stage: '', generation_started_at: new Date(localStart - 19000).toISOString() },
  outputs: {},
}, { state });
assert.strictEqual(state.stageProgress.startedAt, localStart, '无当前生成 ID 时旧时间不得覆盖本次点击时间');

const queuedAt = localStart + 500;
sync.normalizeBundle({
  task: { active_generation_id: 'generation-new', active_stage: 'storyboard', generation_queued_at: new Date(queuedAt).toISOString() },
  outputs: {},
}, { state });
assert.strictEqual(state.stageProgress.generationId, 'generation-new');
assert.strictEqual(state.stageProgress.startedAt, queuedAt, '只能采用当前生成任务的排队/开始时间');

const acceptedStart = state.stageProgress.startedAt;
sync.normalizeBundle({
  task: { active_generation_id: 'generation-other', active_stage: 'blueprint', generation_started_at: new Date(localStart - 30000).toISOString() },
  outputs: {},
}, { state });
assert.strictEqual(state.stageProgress.startedAt, acceptedStart, '不同生成 ID 或阶段不得覆盖当前计时');

const keyframesSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/keyframes.js'), 'utf8');
vm.runInNewContext(keyframesSource, sandbox, { filename: 'keyframes.js' });
const keyframes = sandbox.window.NewStoryAdKeyframes;
assert.match(keyframes.friendlyError('HTTP 400: {"code":1102,"message":"Account balance not enough"}'), /不代表平台账户总余额为零/);
assert.match(keyframes.friendlyError('new_story_ad.person_keyframe_qa 视觉模型全部失败：deyunai\/gpt-4o:UNKNOWN', 'VISION_QA_UNAVAILABLE'), /只重试审核，没有因审核异常额外生成图片/);
assert(!/high-tech command center|blue shield|tunnel-like/i.test(keyframesSource), 'QA 文案不得写死具体场景');
console.log('new-story-ad progress tests passed');
