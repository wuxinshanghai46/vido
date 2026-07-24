#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const isolatedOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-duration-contract-'));
process.env.OUTPUT_DIR = isolatedOutputDir;
process.env.DB_ENABLED = 'false';
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const storage = require('../src/services/newStoryAd/storageService');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');

const fifteenSecondBrief = [
  '制作一条十五秒横屏平台品牌宣传片。',
  '镜头数量由系统根据十五秒内容和节奏动态规划，不设置固定分镜数。',
].join('');

assert.equal(contextBuilder.inferBriefTargetDuration(fifteenSecondBrief), 15);
assert.equal(contextBuilder.inferBriefTargetDuration('目标时长一分钟，内容按节奏动态规划。'), 60);
assert.equal(contextBuilder.inferBriefTargetDuration('每个镜头五秒，最终时长由用户另行选择。'), 0);
assert.equal(contextBuilder.inferBriefTargetDuration('总时长十五秒，但另一处写目标时长三十秒。'), 0);

const hiddenDefault = contextBuilder.buildContext({
  brief: fifteenSecondBrief,
  duration: 30,
  duration_sec: 30,
  target_duration: 30,
  duration_source: 'ui_default',
});
assert.equal(hiddenDefault.target_duration, 15, '隐藏控件默认值不得覆盖需求文本中的明确总时长');
assert.equal(hiddenDefault.duration_source, 'explicit_brief');
assert.equal(hiddenDefault.shot_count, 0, '明确十五秒不得把动态分镜数量固化');

const explicitSelection = contextBuilder.buildContext({
  brief: fifteenSecondBrief,
  target_duration: 30,
  duration_source: 'user_selected',
});
assert.equal(explicitSelection.target_duration, 30, '用户明确选择的结构化时长必须高于文本推断');
assert.equal(explicitSelection.duration_source, 'user_selected');
assert.doesNotThrow(() => contextBuilder.assertContextConsistent(explicitSelection));
assert.throws(() => contextBuilder.assertContextConsistent({
  brief: fifteenSecondBrief,
  target_duration: 30,
}), /需求文本明确要求 15 秒，但任务结构化时长为 30 秒/, '旧错误状态不得继续进入付费生成链路');

assert.equal(contextBuilder.buildContext({
  brief: '制作一条产品广告，每个镜头五秒。',
  duration_sec: 45,
  duration_source: 'user_selected',
}).target_duration, 45, 'duration_sec 别名必须进入统一时长合同');
assert.equal(contextBuilder.buildContext({
  brief: '制作一条广告。',
  target_duration: 999,
  duration_source: 'user_selected',
}).target_duration, 120, '总时长必须受最大长度门禁保护');
assert.equal(contextBuilder.buildContext({
  brief: '制作一条广告。',
  target_duration: 1,
  duration_source: 'user_selected',
}).target_duration, 10, '总时长必须受最小长度门禁保护');

assert.notEqual(
  storage.taskFingerprint({ id: 'duration-15', brief: '同一内容', request: { target_duration: 15, output_ratio: '16:9' } }),
  storage.taskFingerprint({ id: 'duration-30', brief: '同一内容', request: { target_duration: 30, output_ratio: '16:9' } }),
  '不同 target_duration 的任务不得被去重逻辑错误合并',
);

const stateSyncSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/state-sync.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad-legacy-ui.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, '../public/digital-human.html'), 'utf8');
const browser = { window: {}, document: { querySelector: () => null } };
vm.runInNewContext(stateSyncSource, browser, { filename: 'state-sync.js' });

const fields = new Map([
  ['#dhNsaAdDuration', { value: '30', dataset: {} }],
  ['#dhNsaAdText', { value: '', dataset: {} }],
  ['#dhNsaAdProductionMode', { value: '', dataset: {} }],
  ['#dhNsaAdVoiceId', { value: '', dataset: {} }],
]);
const state = {
  subtitleOptions: {},
  sceneAssets: [],
  uploadedAssets: [],
  castProfiles: [],
};
browser.window.NewStoryAdStateSync.hydrateTaskBundle({
  task: { id: 'duration-restore', status: 'working', stage: 'scene_config_done' },
  outputs: {
    context: {
      brief: fifteenSecondBrief,
      target_duration: 15,
      duration_source: 'explicit_brief',
      output_ratio: '16:9',
    },
  },
}, {
  state,
  within: selector => fields.get(selector) || null,
  rememberTaskId: () => {},
  hydrateControlledProduction: () => {},
  applyPersonAssetConstraints: () => {},
  root: () => ({ querySelector: () => null }),
});
assert.equal(fields.get('#dhNsaAdDuration').value, '15', '恢复任务必须读取 canonical target_duration');
assert.equal(fields.get('#dhNsaAdDuration').dataset.durationSource, 'explicit_brief');
assert.match(uiSource, /collectDurationContract\(within\('#dhNsaAdDuration'\)\)/);
assert.deepEqual(
  browser.window.NewStoryAdStateSync.collectDurationContract({
    value: '30',
    dataset: { durationSource: 'ui_default' },
  }),
  {
    duration_sec: 30,
    duration: 30,
    target_duration: 30,
    duration_source: 'ui_default',
  },
);
assert.match(uiSource, /target\.dataset\.durationSource = 'user_selected'/);
assert.match(htmlSource, /id="dhNsaAdDuration"[^>]+data-duration-source="ui_default"/);

async function main() {
  const taskId = 'duration-mismatch-paid-gate';
  const mismatchedContext = {
    brief: fifteenSecondBrief,
    target_duration: 30,
    output_ratio: '16:9',
    characters: [],
    assets: [],
    forbidden: [],
  };
  storage.createTask({
    id: taskId,
    brief: mismatchedContext.brief,
    request: mismatchedContext,
  });
  storage.saveOutput(taskId, 'context', mismatchedContext);
  await assert.rejects(
    sceneAssetService.generateSceneAsset(taskId, {}),
    /需求文本明确要求 15 秒，但任务结构化时长为 30 秒/,
    '时长冲突必须在任何场景图片供应商调用前停止',
  );
  assert.deepEqual(storage.listOutputs(taskId).map(row => row.kind), ['context']);
  assert.equal(storage.getTaskBundle(taskId).model_calls.length, 0);
  console.log('new story ad duration contract: ok');
}

main()
  .finally(() => fs.rmSync(isolatedOutputDir, { recursive: true, force: true }))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
