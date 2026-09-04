'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = source => source.replace(/^export\s+/gm, '');

const stageStateSource = read('public/story-ad/store/stageSubmissionState.js');
const sandbox = { Date };
vm.runInNewContext(`${executable(stageStateSource)}\nglobalThis.begin=beginStageSubmissionState;`, sandbox);
let state = { bundle: { project: { id: 'task-progress' }, generation: {} } };
let notifications = 0;
sandbox.begin({ state, set: patch => { Object.assign(state, patch); notifications += 1; } }, 'video', 7, '任务已开始');
assert.equal(notifications, 1);
assert.equal(state.bundle.project.status, 'queued');
assert.equal(state.bundle.project.generation_progress.percent, 2);
assert.equal(state.bundle.project.generation_progress.target_total, 7);
assert.match(state.bundle.project.active_generation_id, /^client-submitting:/);

const store = read('public/story-ad/store/projectStore.js');
const stageSubmission = read('public/story-ad/store/stageSubmissionState.js');
const runStage = store.slice(store.indexOf('async function runStage'), store.indexOf('async function saveBlueprint'));
assert(runStage.indexOf('beginAutomaticStageSubmission') < runStage.indexOf("request(`/api/new-story-ad/tasks/"), '统一生成入口必须在网络请求前投影进度');
for (const mapping of ["blueprint: 'blueprint'", "'person-plan': 'person_plan'", "'scene-assets': 'scene_asset'", "storyboard: 'storyboard'", "video: 'video'", "compose: 'compose'"]) assert(stageSubmission.includes(mapping), `缺少阶段映射 ${mapping}`);
assert(store.includes("const awaitingSubmission = state.saving === true") && store.includes("active_generation_id: awaitingSubmission ? optimisticGenerationId"), '服务器接单前的轮询不得用旧终态覆盖点击后的进度');

const ui = read('public/story-ad/components/ui.js');
assert(ui.includes("else liveText = '正在处理'"));
assert(!ui.includes("String(progress.phase).replaceAll('_', ' ')"), '不得把后台阶段名暴露给用户');

const storyboard = read('public/story-ad/views/storyboardView.js');
assert(storyboard.includes('const singleTarget = activeSketchTargets.size === 1'));
assert(storyboard.includes('progressHost.hidden = !singleTarget'), '批量分镜必须隐藏单镜进度');

const finalView = read('public/story-ad/views/finalView.js');
const finalEdit = read('public/story-ad/views/finalEditView.js');
assert(finalView.includes('直接下载'));
assert(finalView.includes('openEditorModal'));
assert(finalView.includes('project-progress-track'));
assert(!finalView.includes('post-stage-summary'));
assert(finalEdit.includes('story-editor-modal-backdrop'));
assert(finalEdit.includes('role="dialog" aria-modal="true"'));
assert(!finalEdit.includes('post-stage-summary'));

const index = read('public/index.html');
const tools = index.slice(index.indexOf('data-group="工具项"'), index.indexOf('data-group="我的"'));
assert(tools.includes('视频剪辑') && tools.includes('声音克隆') && tools.includes('背景音乐上传'));
for (const removed of ['素材获取', '素材库', '内容库', '一键复刻', '爆款复刻']) assert(!tools.includes(removed), `工具项仍包含旧入口 ${removed}`);
assert(read('public/js/app.js').includes("requestedToolFilter === 'music'"));

const sound = read('public/story-ad/views/soundDesignFeature.js');
assert(sound.includes('上传自己的音乐'));
assert(sound.includes("row.dataset.soundTrack === 'bgm' ? 'background_music'"));
assert(sound.includes('track_type: row.dataset.soundTrack ||'));

const videoAdapter = read('src/services/newStoryAd/videoAdapter.js');
assert(videoAdapter.includes('供应商诊断') && videoAdapter.includes('未提交供应商任务') && videoAdapter.includes('未计费'), '授权诊断必须保留真正的供应商失败边界');

console.log(JSON.stringify({ passed: true, checks: 30, immediate_progress_percent: 2, batch_storyboard_single_bars: false, editor_modal: true, tool_entries: 3, model_calls: 0 }));
