#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const audioUi = require('../public/js/new-story-ad/audio-preflight');
const mediaConfiguration = require('../src/services/newStoryAd/mediaConfigurationService');
const mediaPipeline = require('../src/services/newStoryAd/mediaPipelineService');

function fakeStorage(initial = {}) {
  const outputs = new Map(Object.entries(initial.outputs || {}));
  return {
    getTask: () => initial.task || { id: 'audio-task', request: {} },
    getOutput: (_taskId, kind) => outputs.get(kind),
    saveOutput: (_taskId, kind, payload) => { outputs.set(kind, payload); return payload; },
    outputs,
  };
}

/** 验证自动音色只使用明确人物字段，不依赖行业或场景名称。 */
function testUniversalVoiceRecommendation() {
  const voices = [
    { id: 'male-default', name: '男声', gender: 'male', tag: '推荐' },
    { id: 'female-default', name: '女声', gender: 'female' },
  ];
  const female = audioUi.recommendVoice(voices, { context: { person_spec: { gender: 'female' }, brief: '任意行业任务' } });
  assert.strictEqual(female.id, 'female-default');
  const existing = audioUi.recommendVoice(voices, { voiceId: 'male-default', context: { person_spec: { gender: 'female' } } });
  assert.strictEqual(existing.id, 'male-default', '已有用户选择必须优先于自动推荐');
}

/** 验证公开曲目只在用户确认后导入，关闭音乐不会恢复旧资产。 */
async function testAudioSelectionApplication() {
  const state = { voiceId: '', voiceName: '', bgmAsset: { name: '旧音乐' } };
  let imports = 0;
  await audioUi.apply({ voiceId: 'voice-a', voiceName: '通用音色', music: null }, {
    state,
    api: async () => { imports += 1; return {}; },
  });
  assert.strictEqual(state.voiceId, 'voice-a');
  assert.strictEqual(state.bgmAsset, null, '明确关闭音乐后不得恢复历史 BGM');
  assert.strictEqual(imports, 0);

  await audioUi.apply({ voiceId: '', voiceName: '', music: { id: 'open-music', title: '公开音乐' } }, {
    state,
    api: async () => { imports += 1; return { bgm_asset: { id: 'imported', file_url: '/music.mp3' } }; },
  });
  assert.strictEqual(state.bgmAsset.id, 'imported');
  assert.strictEqual(imports, 1);
}

/** 验证媒体链先准备配音，视频始终纯视觉，最后才执行本地合成。 */
async function testDecoupledMediaPipeline() {
  const storage = fakeStorage({
    task: { id: 'media-task', request: {} },
    outputs: { storyboard_table: [{ voiceover: '测试台词' }] },
  });
  const calls = [];
  const service = {
    generateTtsStage: async (_id, options) => {
      calls.push({ stage: 'tts', options });
      storage.saveOutput('media-task', 'tts_audio', { voice_id: options.voice_id, tracks: [{ text: '测试台词' }] });
    },
    generateVideoStage: async (_id, options) => { calls.push({ stage: 'video', options }); },
    composeStage: async (_id, options) => { calls.push({ stage: 'compose', options }); return { ok: true }; },
  };
  const ttsAdapter = { voiceoverPlanMatches: audio => audio.voice_id === 'voice-a' && audio.tracks?.length === 1 };
  await mediaPipeline.runMediaPipeline({
    taskId: 'media-task', generationId: 'generation-a', service, storage, ttsAdapter,
    options: { voice_id: 'voice-a', voice_name: '通用音色', include_voiceover: true, bgm_asset: { id: 'bgm-a' } },
  });
  assert.deepStrictEqual(calls.map(item => item.stage), ['tts', 'video', 'compose']);
  assert.strictEqual(calls[1].options.visual_only, true);
  assert.strictEqual(calls[1].options.include_voiceover, false);
  assert.strictEqual(calls[1].options.auto_tts, false);
  assert.strictEqual(calls[2].options.voice_id, 'voice-a');
  assert.strictEqual(calls[2].options.bgm_asset.id, 'bgm-a');
  assert.strictEqual(storage.getOutput('media-task', 'context').voice_id, 'voice-a', '声音配置必须在付费视频前持久化');

  calls.length = 0;
  await mediaPipeline.runMediaPipeline({
    taskId: 'media-task', generationId: 'generation-b', service, storage, ttsAdapter,
    options: { voice_id: 'voice-a', include_voiceover: true, bgm_asset: null },
  });
  assert.deepStrictEqual(calls.map(item => item.stage), ['video', 'compose'], '相同配音计划不得重复调用 TTS');
  assert.strictEqual(storage.getOutput('media-task', 'context').bgm_asset, null);
}

/** 验证 TTS 失败发生在付费视频之前，且不会静默继续生成。 */
async function testTtsFailureStopsVideo() {
  const storage = fakeStorage({ task: { id: 'fail-task', request: {} }, outputs: { storyboard_table: [{ voiceover: '台词' }] } });
  let videoCalls = 0;
  await assert.rejects(() => mediaPipeline.runMediaPipeline({
    taskId: 'fail-task', storage,
    ttsAdapter: { voiceoverPlanMatches: () => false },
    service: {
      generateTtsStage: async () => { throw new Error('TTS 不可用'); },
      generateVideoStage: async () => { videoCalls += 1; },
      composeStage: async () => {},
    },
    options: { voice_id: 'voice-a', include_voiceover: true },
  }), /TTS 不可用/);
  assert.strictEqual(videoCalls, 0, '配音失败后不得产生付费视频调用');
}

/** 验证用户明确设置的静音音量不会被默认值覆盖。 */
function testExplicitZeroVolumesArePreserved() {
  const storage = fakeStorage({ task: { id: 'volume-task', request: {} }, outputs: {} });
  const result = mediaConfiguration.persistMediaConfiguration('volume-task', {
    voice_volume: 0,
    bgm_volume: 0,
  }, storage);
  assert.strictEqual(result.voice_volume, 0, '明确设置的 0 配音音量不能被默认值覆盖');
  assert.strictEqual(result.bgm_volume, 0, '明确设置的 0 背景音乐音量不能被默认值覆盖');
  assert.strictEqual(storage.getOutput('volume-task', 'context').bgm_volume, 0, '持久化配置必须保留 0 音量');
}

/** 验证页面和路由实际接入声音预检与解耦媒体流水线。 */
function testIntegrationMarkers() {
  const root = path.resolve(__dirname, '..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const ui = read('public/js/new-story-ad-legacy-ui.js');
  const route = read('src/routes/newStoryAd.js');
  const bootstrap = read('public/js/new-story-ad/bootstrap.js');
  assert(ui.includes('NewStoryAdAudioPreflight.load'));
  assert(ui.includes('NewStoryAdAudioPreflight.read'));
  assert(ui.includes("scheduleAutoSave('video_audio_preflight')"));
  assert(route.includes('mediaPipeline.runMediaPipeline'));
  assert(!route.slice(route.indexOf("router.post('/tasks/:id/media'"), route.indexOf("router.post('/storyboard'")).includes('service.generateVideoStage'));
  assert(bootstrap.includes("'/js/new-story-ad/audio-preflight.js'"));
  assert(!read('public/js/new-story-ad/audio-preflight.js').match(/苏晚|不锈钢|墙面|设计师的困境/), '声音推荐不得写死当前人物、行业或场景');
}

(async () => {
  testUniversalVoiceRecommendation();
  await testAudioSelectionApplication();
  await testDecoupledMediaPipeline();
  await testTtsFailureStopsVideo();
  testExplicitZeroVolumesArePreserved();
  testIntegrationMarkers();
  console.log('new story ad audio preflight and decoupled media pipeline: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
