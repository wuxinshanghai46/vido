#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const isolatedOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-duration-contract-'));
process.env.OUTPUT_DIR = isolatedOutputDir;
process.env.DB_ENABLED = 'false';
process.env.NEW_STORY_AD_MOCK_TTS = '1';
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const storage = require('../src/services/newStoryAd/storageService');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');
const blueprintService = require('../src/services/newStoryAd/blueprintService');
const storyboardTableService = require('../src/services/newStoryAd/storyboardTableService');
const productionLimits = require('../src/services/newStoryAd/productionLimitsService');
const qualityReviewService = require('../src/services/newStoryAd/qualityReviewService');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');

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
}).target_duration, 600, '超长输入必须受 10 分钟最大长度门禁保护');
assert.equal(contextBuilder.buildContext({
  brief: '制作一条两分钟的品牌故事片。',
  target_duration: 120,
  duration_source: 'user_selected',
}).target_duration, 120, '界面开放的两分钟选项必须按原值进入生成合同');
assert.equal(contextBuilder.buildContext({
  brief: '制作一条10分钟的通用行业故事片。',
  target_duration: 600,
  duration_source: 'user_selected',
}).target_duration, 600, '10 分钟选项必须保留到权威上下文');
assert.equal(contextBuilder.buildContext({
  brief: '制作长片广告。', target_duration: 9999, duration_source: 'user_selected',
}).target_duration, 600, '总时长必须在 10 分钟极值门禁处截断');
const longBlueprintProfile = blueprintService.pacingProfile({ brief: '通用品牌长片', target_duration: 600 });
assert.equal(longBlueprintProfile.targetDuration, 600);
assert.equal(longBlueprintProfile.maxReasonable, productionLimits.MAX_AUTO_BLUEPRINT_BEATS, '长片剧情蓝图仍保持紧凑章节，不得让单次模型输出100个大对象');
const longFormBeats = storyboardTableService.plannedBeats({ beats: Array.from({ length: 18 }, (_, index) => ({
  beat_index: index + 1, role: 'story', plot: `章节 ${index + 1}`, spoken_line: `旁白 ${index + 1}`,
})) }, { brief: '通用长片', target_duration: 600 });
assert.equal(longFormBeats.length, 100, '600 秒成片按每镜最多 6 秒自动展开为100镜');
assert.equal(storyboardTableService.plannedBeats(
  { beats: longFormBeats.slice(0, 18) },
  { brief: '旧任务长片', target_duration: 600, shot_count: 18 },
).length, 100, '旧任务残留的18镜不得覆盖600秒所需的100镜下限');
assert.equal(longFormBeats.at(-1).beat_index, 100);
assert.ok(longFormBeats.every(beat => beat.long_form_segment?.index <= beat.long_form_segment?.total));
assert.ok(longFormBeats.filter(beat => beat.spoken_line).length <= 18, '章节拆镜不得重复复制旁白');
const longFormChunks = storyboardTableService.storyboardBeatChunks(longFormBeats, longFormBeats);
assert.equal(longFormChunks.length, 18, '长片必须按宏观章节分批，不得每3镜重复发送整份蓝图');
assert.ok(longFormChunks.every(chunk => new Set(chunk.map(beat => beat.long_form_segment.sequence_id)).size === 1));
assert.equal(Object.prototype.hasOwnProperty.call(storyboardTableService.storyboardBlueprintDigest({ beats: longFormBeats, logline: '长片' }), 'beats'), false);
assert.ok(longFormBeats.some(beat => beat.long_form_segment.phase === 'entry'));
assert.ok(longFormBeats.some(beat => beat.long_form_segment.phase === 'progress'));
assert.ok(longFormBeats.some(beat => beat.long_form_segment.phase === 'exit'));
const normalizedLongShots = storyboardTableService.normalizeShots(
  longFormBeats.map(beat => ({ index: beat.beat_index, visual: beat.plot, action: `推进 ${beat.beat_index}` })),
  { brief: '通用长片', target_duration: 600, characters: [], scene_assets: [] },
);
assert.equal(normalizedLongShots.length, 100);
assert.equal(normalizedLongShots.reduce((total, shot) => total + shot.duration, 0), 600, '100 镜标准长片必须精确覆盖 600 秒');
assert.ok(normalizedLongShots.every(shot => shot.duration === productionLimits.MAX_SHOT_DURATION));
const qaWindows = qualityReviewService.storyboardQaChunks(normalizedLongShots);
assert.equal(qaWindows.length, 13, '100镜质量审核必须按窗口覆盖，不能只截取前段');
assert.deepEqual(qaWindows.flat().map(shot => shot.index), normalizedLongShots.map(shot => shot.index));
assert.ok(qaWindows.every(window => window.length <= 8));
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
  let ttsCheckpoints = 0;
  const longTtsShots = Array.from({ length: 100 }, (_, index) => ({
    index: index + 1,
    voiceover: `长片配音 ${index + 1}`,
    duration: 1,
  }));
  const firstTts = await ttsAdapter.generateVoiceover({
    taskId: 'longform-tts',
    shots: longTtsShots,
    voiceId: 'mock-voice',
    concurrency: 3,
    onCheckpoint: () => { ttsCheckpoints += 1; },
  });
  assert.equal(firstTts.tracks.length, 100);
  assert.equal(ttsCheckpoints, 34, '100镜TTS必须按有限并发分批持久化进度');
  let resumeCheckpoints = 0;
  const resumedTts = await ttsAdapter.generateVoiceover({
    taskId: 'longform-tts',
    shots: longTtsShots,
    voiceId: 'mock-voice',
    existingTracks: firstTts.tracks,
    onCheckpoint: () => { resumeCheckpoints += 1; },
  });
  assert.equal(resumeCheckpoints, 0, '重启后已完成的TTS镜头不得重复调用');
  assert.deepEqual(resumedTts.tracks.map(track => track.file_path), firstTts.tracks.map(track => track.file_path));
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
