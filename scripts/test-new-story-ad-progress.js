#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/progress.js'), 'utf8');
const sandbox = { window: {}, Date, Math, Number, String };
vm.runInNewContext(source, sandbox, { filename: 'progress.js' });

const result = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', generationId: 'generation-current', startedAt: Date.now() - 65000, total: 6 },
  completed: 6,
  serverProgress: { stage: 'keyframes', generation_id: 'generation-current', target_total: 6, processed: 2, succeeded: 1, failed: 1, current_index: 3 },
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

const submittingBatch = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'keyframes', generationId: '', submissionPending: true, startedAt: Date.now(), total: 6 },
  completed: 6,
  serverProgress: { stage: 'keyframes', generation_id: 'generation-old', target_total: 6, processed: 6, succeeded: 2, failed: 4, current_index: 6 },
});
assert.strictEqual(submittingBatch.title, '正在启动画面生成');
assert.strictEqual(submittingBatch.stat, '准备中');
assert.strictEqual(submittingBatch.indeterminate, true);
assert(!/6\/6|成功|失败|96%/.test(`${submittingBatch.title}${submittingBatch.stat}${submittingBatch.message}`), '提交窗口不得闪现上一批终态统计');

const video = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'media', generationId: 'video-current', startedAt: Date.now() - 6 * 60 * 1000, total: 6 },
  taskStage: 'video', taskStatus: 'running',
  serverProgress: {
    stage: 'video', generation_id: 'video-current', total: 6, generated: 3,
    completed: 2, qa_passed: 2, failed: 0, active_indexes: [3, 4],
  },
});
assert.match(video.stat, /已完成 2\/6 镜 · 33%/);
assert.match(video.message, /已生成 3\/6 镜，审片通过 2 镜/);
assert(!video.stat.includes('86%'), '视频进度不得再按耗时模拟并封顶在 86%');

const videoWaiting = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'media', generationId: 'video-current', startedAt: Date.now() - 30 * 60 * 1000, total: 6 },
  taskStage: 'video', taskStatus: 'running',
  serverProgress: { stage: 'video', generation_id: 'video-current', total: 6, generated: 0, completed: 0, qa_passed: 0, active_indexes: [1, 2, 3] },
});
assert.match(videoWaiting.stat, /已完成 0\/6 镜 · 0%/);
assert.strictEqual(videoWaiting.indeterminate, true);

const composing = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'media', generationId: 'video-current', startedAt: Date.now() - 10 * 60 * 1000, total: 6 },
  taskStage: 'compose', taskStatus: 'running',
  serverProgress: { stage: 'video', generation_id: 'video-current', total: 6, completed: 6, qa_passed: 6 },
});
assert.match(composing.stat, /逐镜视频 6\/6 · 合成中/);
assert.strictEqual(composing.indeterminate, true);
assert(!/%/.test(composing.stat), '最终封装阶段未知进度时不得显示虚假百分比');

const storyboardProgress = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'storyboard', startedAt: Date.now() - 6 * 60 * 1000, total: 6 },
});
assert.strictEqual(storyboardProgress.indeterminate, true);
assert(!/%/.test(storyboardProgress.stat), '没有真实计数的阶段不得根据耗时伪造百分比');

const blueprintProgress = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'blueprint', generationId: 'blueprint-current', startedAt: Date.now() - 65000 },
  serverProgress: {
    stage: 'blueprint', generation_id: 'blueprint-current', phase: 'language_checked',
    completed: 4, total: 6, percent: 67, message: '中文表达已检查，正在执行质量与版权/IP 风险审核。',
  },
});
assert.match(blueprintProgress.title, /质量与版权\/IP 风险审核/);
assert.match(blueprintProgress.stat, /4\/6 · 67%/);
assert.equal(blueprintProgress.indeterminate, false);
assert.match(blueprintProgress.message, /中文表达已检查/);

const blueprintWaiting = sandbox.window.NewStoryAdProgress.snapshot({
  progress: { stage: 'blueprint', generationId: 'blueprint-new', startedAt: Date.now() },
  serverProgress: { stage: 'blueprint', generation_id: 'blueprint-old', completed: 6, total: 6, percent: 100 },
});
assert.equal(blueprintWaiting.indeterminate, true, '不得混用上一批剧本进度');
assert(!/100%/.test(blueprintWaiting.stat));

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

const keyframeState = {
  activeGenerationId: '', activeStage: 'keyframes',
  stageProgress: { active: true, stage: 'keyframes', generationId: '', submissionPending: true, startedAt: localStart, total: 6 },
  generationProgress: { stage: 'keyframes', status: 'submitting', target_total: 6, processed: 0, succeeded: 0, failed: 0 },
  shots: Array.from({ length: 6 }, (_, index) => ({ index: index + 1 })), contracts: [], keyframes: [], videoClips: [],
};
sync.normalizeBundle({
  task: {
    active_generation_id: '', active_stage: '',
    generation_progress: { stage: 'keyframes', generation_id: 'generation-old', target_total: 6, processed: 6, succeeded: 2, failed: 4 },
  },
  outputs: {},
}, { state: keyframeState });
assert.strictEqual(keyframeState.generationProgress.processed, 0, '保存或轮询返回的历史进度不得覆盖提交中的 0/N');

keyframeState.activeGenerationId = 'generation-new';
keyframeState.activeStage = 'keyframes';
keyframeState.stageProgress.generationId = 'generation-new';
keyframeState.stageProgress.submissionPending = false;
sync.normalizeBundle({
  task: {
    active_generation_id: 'generation-new', active_stage: 'keyframes',
    generation_progress: { stage: 'keyframes', generation_id: 'generation-old', target_total: 6, processed: 6, succeeded: 2, failed: 4 },
  },
  outputs: {},
}, { state: keyframeState });
assert.strictEqual(keyframeState.generationProgress.processed, 0, '迟到的旧 generation_id 不得覆盖新批次');

sync.normalizeBundle({
  task: {
    active_generation_id: '', active_stage: '',
    generation_progress: { stage: 'keyframes', generation_id: 'generation-old', target_total: 6, processed: 6, succeeded: 2, failed: 4 },
  },
  outputs: {},
}, { state: keyframeState });
assert.strictEqual(keyframeState.activeGenerationId, 'generation-new', '迟到的旧终态响应不得清空当前生成 ID');

sync.normalizeBundle({
  task: {
    active_generation_id: 'generation-new', active_stage: 'keyframes',
    generation_progress: { stage: 'keyframes', generation_id: 'generation-new', target_total: 6, processed: 1, succeeded: 1, failed: 0 },
  },
  outputs: {},
}, { state: keyframeState });
assert.strictEqual(keyframeState.generationProgress.processed, 1, '必须接收当前 generation_id 的真实进度');

const keyframesSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/keyframes.js'), 'utf8');
vm.runInNewContext(keyframesSource, sandbox, { filename: 'keyframes.js' });
const keyframes = sandbox.window.NewStoryAdKeyframes;
assert.match(keyframes.friendlyError('HTTP 400: {"code":1102,"message":"Account balance not enough"}'), /不代表平台账户总余额为零/);
assert.match(keyframes.friendlyError('new_story_ad.person_keyframe_qa 视觉模型全部失败：deyunai\/gpt-4o:UNKNOWN', 'VISION_QA_UNAVAILABLE'), /只重试审核，没有因审核异常额外生成图片/);
assert(!/high-tech command center|blue shield|tunnel-like/i.test(keyframesSource), 'QA 文案不得写死具体场景');
console.log('new-story-ad progress tests passed');
