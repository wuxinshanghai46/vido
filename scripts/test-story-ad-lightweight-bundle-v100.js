#!/usr/bin/env node
'use strict';

const assert = require('assert');

function clean(value = '', max = 240) {
  return String(value || '').slice(0, max);
}

function taskViewCallGate() {
  const calls = { sceneCheckpoint: 0, subjectCheckpoint: 0, eligibility: 0, videoRecovery: 0, videoBoundary: 0, mediaProjection: 0 };
  const rawBundle = {
    task: { id: 'lightweight-task', status: 'draft', stage: 'brief', request: { brief: '轻量首屏' } },
    stages: [],
    outputs: [
      { kind: 'context', payload: { brief: '轻量首屏' } },
      { kind: 'asset_plan_active', payload: { plan: { people: [] }, fingerprint: 'plan-fp' } },
      { kind: 'video_clips', payload: [{ video_url: '/should-not-project.mp4' }] },
      { kind: 'video_shot_status_1', payload: { index: 1, lifecycle: 'generated' } },
    ],
    manifest: null,
  };
  const { createTaskViewService } = require('../src/services/newStoryAd/taskViewService');
  const service = createTaskViewService({
    storage: { getTaskBundle: () => rawBundle, listTaskRows: () => [] },
    cleanText: clean,
    sceneCheckpointProjection: { projectSceneAssets() { calls.sceneCheckpoint += 1; return []; } },
    videoStatusProjection: { resolveAttempts: () => ({ currentAttempt: null, lastAttempt: null, exposeLastAttempt: false, untouched: true }) },
    videoAttemptLedger: {},
    sceneAssetLifecycle: { normalizeSceneAssets: value => value },
    personAssetLifecycle: { projectLatestSubjectCheckpoint(rows) { calls.subjectCheckpoint += 1; return rows; } },
    videoClipStatusRecovery: { recoverFromOutputRows(rows, clips) { calls.videoRecovery += 1; return clips || []; } },
    videoBoundaryPolicy: { taskFailurePatch() { calls.videoBoundary += 1; return null; } },
    mediaResultProjection: { projectMediaResult() { calls.mediaProjection += 1; return null; } },
    assetPlanPublication: { eligibility() { calls.eligibility += 1; return { eligible: true, issues: [] }; } },
    keyframeFailure: { taskSummaryPatch: () => ({}) },
    blueprintFingerprint: () => '',
    keyframeCompletion: () => ({ total: 0, completed: 0, failed: 0, fresh_pass: 0 }),
    isBeforeOrAtKeyframes: () => true,
    assetPlanFingerprint: () => 'plan-fp',
  });

  const bundle = service.publicTaskBundle('lightweight-task', { sections: 'summary,reference' });
  assert.equal(bundle.task.id, 'lightweight-task');
  assert.deepEqual(calls, {
    sceneCheckpoint: 0,
    subjectCheckpoint: 0,
    eligibility: 0,
    videoRecovery: 0,
    videoBoundary: 0,
    mediaProjection: 0,
  }, 'summary/reference 首屏不得执行资产资格、检查点、视频或媒体重投影');
}

function projectBundleCallGate() {
  const storyAd = require('../src/services/newStoryAd');
  const checkpoint = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
  const projectBundlePath = require.resolve('../src/services/storyAdWorkspace/projectBundleService');
  const originalPublicTaskBundle = storyAd.publicTaskBundle;
  const originalTaskSummary = storyAd.taskSummary;
  const originalMergePeople = checkpoint.mergePeople;
  let mergePeopleCalls = 0;
  const assetContextReads = {};
  let receivedSections = '';
  let receivedTaskSummaryOptions = null;
  const lightweightContext = { brief: '轻量首屏' };
  ['prop_assets', 'person_asset', 'cast_profiles', 'pet_profiles', 'product_asset', 'brand_overlay', 'scene_plan', 'scene_assets', 'assets']
    .forEach(key => Object.defineProperty(lightweightContext, key, {
      configurable: true,
      enumerable: false,
      get() { assetContextReads[key] = (assetContextReads[key] || 0) + 1; return key === 'assets' || key.endsWith('s') ? [] : null; },
    }));
  storyAd.publicTaskBundle = (taskId, options = {}) => {
    receivedSections = options.sections || '';
    return {
      task: { id: taskId, title: '轻量项目', status: 'draft', stage: 'brief', request: { brief: '轻量首屏' } },
      context: lightweightContext,
      outputs: { context: lightweightContext },
    };
  };
  storyAd.taskSummary = (task, options = {}) => { receivedTaskSummaryOptions = options; return task; };
  checkpoint.mergePeople = (...args) => { mergePeopleCalls += 1; return originalMergePeople(...args); };
  delete require.cache[projectBundlePath];
  try {
    const projectBundles = require(projectBundlePath);
    const bundle = projectBundles.buildProjectBundle('lightweight-task', { sections: 'summary,reference', user: { role: 'admin' } });
    assert.equal(receivedSections, 'summary,reference', '工作区服务必须把请求分区继续传给底层任务投影');
    assert.deepEqual(receivedTaskSummaryOptions, { detailed: false }, '已有 raw task 时不得再次读取全部输出生成详细摘要');
    assert.equal(mergePeopleCalls, 0, '未请求 assets 时不得构造人物检查点资产');
    assert.deepEqual(assetContextReads, {}, '未请求 assets 时不得读取人物、商品、场景或道具大域');
    assert.equal(bundle.assets, undefined, '轻量首屏响应不得包含资产大域');
  } finally {
    storyAd.publicTaskBundle = originalPublicTaskBundle;
    storyAd.taskSummary = originalTaskSummary;
    checkpoint.mergePeople = originalMergePeople;
    delete require.cache[projectBundlePath];
  }
}

taskViewCallGate();
projectBundleCallGate();
console.log(JSON.stringify({ passed: true, checks: 7, scope: 'story-ad-lightweight-bundle-v100', model_calls: 0 }));
