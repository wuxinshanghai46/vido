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
console.log('new-story-ad progress tests passed');
