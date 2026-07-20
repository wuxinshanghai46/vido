#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/task-store.js'), 'utf8');
const taskCenterSource = fs.readFileSync(path.join(__dirname, '../public/js/digital-human.js'), 'utf8');
const legacyUiSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/bootstrap.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
const storyService = require('../src/services/newStoryAd/storyAdService');
const values = new Map([['vido_new_story_ad_current_task_id', 'old-task']]);
const location = {
  href: 'https://example.test/digital-human?tab=new-story-ad&nsa_task_id=old-task&nsa_step=4',
  search: '?tab=new-story-ad&nsa_task_id=old-task&nsa_step=4',
  hash: '',
};
let replacedUrl = '';
const context = {
  URL,
  URLSearchParams,
  window: {},
  location,
  localStorage: {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  },
  history: {
    replaceState: (_state, _title, nextUrl) => {
      replacedUrl = String(nextUrl || '');
      const next = new URL(replacedUrl, 'https://example.test');
      location.href = next.href;
      location.search = next.search;
      location.hash = next.hash;
    },
  },
};
vm.runInNewContext(source, context, { filename: 'task-store.js' });
const store = context.window.NewStoryAdTaskStore;

assert.equal(store.resumeStep({ stage: 'created' }, {}), 1);
assert.equal(store.resumeStep({ stage: 'scene_config_done' }, {}), 2);
assert.equal(store.resumeStep({ stage: 'blueprint_failed' }, {}), 2, '剧本失败且没有保存结果时必须回到第 2 步');
assert.equal(store.resumeStep({ stage: 'blueprint_failed' }, { blueprint: { beats: [{ beat_index: 1 }] } }), 3, '重新生成失败但旧剧本仍存在时可以继续查看旧剧本');
assert.match(store.blueprintFailureMessage({ taskErrorCode: 'STAGE_DEADLINE_EXCEEDED' }), /没有产生可用剧本/);
const failureHost = { hidden: true, innerHTML: '' };
store.syncBlueprintFailureHost({ taskStatus: 'failed', taskStage: 'blueprint_failed', taskErrorCode: 'STAGE_DEADLINE_EXCEEDED' }, failureHost, String);
assert.equal(failureHost.hidden, false);
assert.match(failureHost.innerHTML, /人物、场景和已通过的空间验证均已保留/);
assert.equal(store.resumeStep({ stage: 'keyframes_failed', shot_count: 6 }, {}), 4);
assert.equal(store.resumeStep({ stage: 'video_failed' }, {}), 4);
assert.equal(store.resumeStep({ stage: 'video_ready' }, { video_clips: [{ video_url: '/shot.mp4', qa: { pass: true } }] }), 4);
assert.equal(store.resumeStep({ stage: 'media_failed' }, { video_clips: [{ video_url: '/shot.mp4' }] }), 4);
assert.equal(store.resumeStep({ stage: 'tts_ready' }, { tts_audio: { tracks: [] } }), 5);
assert.equal(store.resumeStep({ stage: 'compose_failed' }, {}), 5);
assert.equal(store.resumeStep({}, [
  { kind: 'scene_config', payload: { id: 'scene-1' } },
  { kind: 'blueprint', payload: { beats: [] } },
  { kind: 'storyboard_table', payload: [{ id: 'shot-1' }] },
]), 4);
assert.equal(store.resumeStep({}, { final_video: { video_url: '/video.mp4' } }), 5);
assert.equal(store.resumeStep({}, { video_clips: [] }), 1);
assert.equal(store.canContinue({ status: 'working' }), true);
assert.equal(store.canContinue({ status: 'failed' }), true);
assert.equal(store.canContinue({ status: 'done' }), true);
assert.equal(store.canContinue({ status: 'completed' }), true);
assert.equal(store.canContinue({ status: 'succeeded' }), true);
assert.equal(store.canContinue({ status: 'done', videoUrl: '/final.mp4' }), false);
assert.match(taskCenterSource, /canContinueNewStoryAdTask\s*\?/);
assert.match(taskCenterSource, /创建时间 \$\{escapeHtml\(created\)\} · 更新时间 \$\{escapeHtml\(updated\)\}/);
assert.match(taskCenterSource, /\(b\.updatedAt \|\| b\.startedAt \|\| 0\) - \(a\.updatedAt \|\| a\.startedAt \|\| 0\)/);
assert.match(taskCenterSource, /\.filter\(taskBelongsToCurrentUser\)/, 'task center must remove stale tasks that belong to another signed-in user');
assert.doesNotMatch(taskCenterSource, /\$\{isNewStoryAdTask\s*\?\s*`<button[^`]+data-new-story-ad-continue/);

store.rememberRouteStep(1);
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_task_id'), 'old-task');
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_step'), '1');

assert(legacyUiSource.includes("state.pendingRestoreTaskId = routeTaskId() || storedTaskId()"));
assert(legacyUiSource.includes("showStep(routeStep(), { remember: false })"));
assert(legacyUiSource.includes("showStep(state.currentStep, { remember: !state.restoringTask })"));
assert(legacyUiSource.includes("state.pendingRestoreTaskId || routeTaskId() || storedTaskId() || await fallbackLatestTaskId()"));
const restoreBlock = legacyUiSource.slice(
  legacyUiSource.indexOf('async function restoreCurrentTask()'),
  legacyUiSource.indexOf('function resumeActiveGeneration()'),
);
assert(!restoreBlock.includes('await recoverPersonAssetFromLibrary(bundle)'));
const immediateRender = restoreBlock.match(/state\.restoringTask = false;\s*renderAll\(\);/);
assert(immediateRender);
assert(immediateRender.index < restoreBlock.indexOf('recoverPersonAssetFromLibrary(bundle).then'));
assert(legacyUiSource.includes('正在恢复任务 ${String(state.pendingRestoreTaskId'));
assert(restoreBlock.includes('?compact=1'));
assert(restoreBlock.includes("new-story-ad:restore-finished"));
assert(bootstrapSource.includes('preloadScripts();'));
assert(bootstrapSource.includes('prefetchRouteTask();'));
assert(bootstrapSource.includes('await waitForStoryTemplate();'));
assert(bootstrapSource.includes('(document.body || document.head || document.documentElement).appendChild(script)'));
assert(bootstrapSource.includes('(restoring || routeTaskExpected) && !restoreFinished'));
assert(bootstrapSource.includes("document.documentElement.dataset.nsaStoryLoading = '1'"));
assert(bootstrapSource.includes('delete document.documentElement.dataset.nsaStoryLoading'));
assert(bootstrapSource.includes("link.rel = 'preload'"));
assert(bootstrapSource.includes('正在恢复已保存的任务数据，任务内容不会丢失'));
assert(routeSource.includes("String(req.query.compact || '') === '1'"));
assert(serverSource.includes("const compression = require('compression')"));
assert(serverSource.includes("requestPath === '/digital-human'"));
assert(serverSource.includes("/^\\/api\\/new-story-ad\\/tasks\\/[^/]+$/.test(requestPath)"));

const fullBundle = {
  task: { id: 'resume-task', request: { brief: 'original', scene_assets: [{ id: 'scene-1' }] } },
  context: { brief: 'original', scene_assets: [{ id: 'scene-1' }] },
  outputs: {
    context: { brief: 'original', scene_assets: [{ id: 'scene-1' }], person_contract: { id: 'person-1' } },
    scene_assets: [{ id: 'scene-1' }],
    person_contract: { id: 'person-1' },
  },
};
const compactBundle = storyService.compactPublicTaskBundle(fullBundle);
assert.equal(compactBundle.task.request, undefined);
assert.equal(compactBundle.context, undefined);
assert.equal(compactBundle.outputs.context.scene_assets, undefined);
assert.equal(compactBundle.outputs.context.person_contract, undefined);
assert.deepEqual(compactBundle.outputs.scene_assets, [{ id: 'scene-1' }]);
assert.deepEqual(fullBundle.outputs.context.scene_assets, [{ id: 'scene-1' }], 'compaction must not mutate stored/full data');

store.rememberTaskId('', 1);
assert.equal(values.has('vido_new_story_ad_current_task_id'), false);
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.has('nsa_task_id'), false);
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_step'), '1');

store.rememberTaskId('restored-task', 4);
assert.equal(values.get('vido_new_story_ad_current_task_id'), 'restored-task');
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_task_id'), 'restored-task');
assert.equal(new URL(replacedUrl, 'https://example.test').searchParams.get('nsa_step'), '4');

console.log('new story ad task resume routing: ok');
