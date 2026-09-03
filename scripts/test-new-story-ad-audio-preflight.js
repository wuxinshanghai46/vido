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
  assert.deepStrictEqual(calls.map(item => item.stage), ['video', 'compose']);
  assert.strictEqual(calls[0].options.audio_mode, 'seedance_native_audio_v1');
  assert.strictEqual(calls[0].options.include_voiceover, false);
  assert.strictEqual(calls[0].options.auto_tts, false);
  assert.strictEqual(calls[1].options.voice_id, '');
  assert.strictEqual(calls[1].options.bgm_asset, null);

  calls.length = 0;
  await mediaPipeline.runMediaPipeline({
    taskId: 'media-task', generationId: 'generation-b', service, storage, ttsAdapter,
    options: { voice_id: 'voice-a', include_voiceover: true, bgm_asset: null },
  });
  assert.deepStrictEqual(calls.map(item => item.stage), ['video', 'compose'], '相同配音计划不得重复调用 TTS');
  assert.strictEqual(calls[1].options.bgm_asset, null);
}

/** 验证 TTS 失败发生在付费视频之前，且不会静默继续生成。 */
async function testTtsFailureStopsVideo() {
  let videoCalls = 0;
  await mediaPipeline.runMediaPipeline({ taskId: 'fail-task', service: {
    generateTtsStage: async () => { throw new Error('旧TTS不得执行'); },
    generateVideoStage: async () => { videoCalls++; }, composeStage: async () => {},
  }, options: { voice_id: 'old', include_voiceover: true } });
  assert.strictEqual(videoCalls, 1, '独立TTS不可用不再阻塞原生声音视频');
}

/** 视频补审返回部分完成时必须停止流水线，不能继续封装并覆盖真实审核错误。 */
async function testPartialVideoReviewStopsCompose() {
  const storage = fakeStorage({ task: { id: 'partial-video-task', request: {} }, outputs: { storyboard_table: [{}] } });
  let composeCalls = 0;
  await assert.rejects(() => mediaPipeline.runMediaPipeline({
    taskId: 'partial-video-task', storage,
    service: {
      generateVideoStage: async () => ({ partial: true, remaining_unapproved_indexes: [3] }),
      composeStage: async () => { composeCalls += 1; },
    },
    options: { include_voiceover: false },
  }), error => error.code === 'VIDEO_STAGE_INCOMPLETE' && /第 4 镜/.test(error.message));
  assert.strictEqual(composeCalls, 0, '补审未通过后不得进入最终封装');
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

/** 已有背景音乐时也必须加载公开曲库，并稳定去重和限制候选数量。 */
async function testExistingMusicCanBeReplaced() {
  const existing = {
    id: 'track-current', provider: 'openverse', title: '当前音乐', creator: '作者 A',
    preview_url: 'https://example.test/current.mp3',
  };
  const remote = [
    { ...existing },
    ...Array.from({ length: 15 }, (_, index) => ({
      id: `track-${index}`, provider: 'curated', title: `候选 ${index}`, creator: '公共曲库',
      preview_url: `https://example.test/${index}.mp3`,
    })),
  ];
  let searchCalls = 0;
  const plan = await audioUi.load({
    state: { bgmAsset: existing, voiceList: [] },
    api: async url => { searchCalls += 1; assert(url.includes('/music/search?')); return { results: remote }; },
  });
  assert.strictEqual(searchCalls, 1, '已有 BGM 时仍须查询曲库，不能只显示当前一首');
  assert.strictEqual(plan.music[0]._existing, true);
  assert.strictEqual(plan.music.filter(item => !item._existing).length, 12, '远端替换候选最多展示 12 首');
  assert.strictEqual(new Set(plan.music.map(item => item._identity)).size, plan.music.length, '当前音乐与远端结果必须去重');
  const firstKey = audioUi.musicKey(remote[1]);
  assert.strictEqual(firstKey, audioUi.musicKey(remote[1]));
  assert.strictEqual(firstKey, audioUi.musicKey({ ...remote[1] }), '曲目页面键不得依赖结果顺序');

  const rendered = audioUi.html(plan, String);
  assert(rendered.includes('data-nsa-audio-picker="voice"'));
  assert(rendered.includes('data-nsa-audio-picker="music"'));
  assert(rendered.includes('role="listbox"'));
  assert(!rendered.includes('<select'), '声音选择改为弹窗内联列表，避免原生下拉遮挡弹窗');
}

async function testMusicSearchFailureKeepsExistingChoice() {
  const plan = await audioUi.load({
    state: { bgmAsset: { id: 'keep', title: '保留当前音乐' }, voiceList: [] },
    api: async () => { throw new Error('曲库暂不可用'); },
  });
  assert.strictEqual(plan.music.length, 1);
  assert.strictEqual(plan.music[0]._existing, true);
  assert(plan.warnings.some(message => message.includes('公开曲库暂时不可用')));
}

/** 用户同时关闭配音和音乐时即为明确静音，不得再要求第二次勾选。 */
function testSilentSelectionNeedsNoSecondAcknowledgement() {
  const html = audioUi.html({ voices: [], music: [], voiceId: '', musicKey: '' }, String);
  assert(!html.includes('data-nsa-audio-silent-ack'));
  const modal = {
    querySelector(selector) {
      if (selector === '[data-nsa-audio-voice]' || selector === '[data-nsa-audio-music]') return { value: '' };
      return null;
    },
  };
  const selection = audioUi.read(modal, { voices: [], music: [] });
  assert(!selection.error);
  assert.strictEqual(selection.value.silent, true);
}

/** 验证页面和路由实际接入声音预检与解耦媒体流水线。 */
function testIntegrationMarkers() {
  const root = path.resolve(__dirname, '..');
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const audioSource = read('public/js/new-story-ad/audio-preflight.js');
  const preflightSource = read('public/js/new-story-ad/video-preflight-ui.js');
  const route = read('src/routes/newStoryAd.js');
  const mediaLoader = read('public/js/new-story-ad/bootstrap-media-loader.js');
  assert(audioSource.includes('const api = { explicitVoiceGender'));
  assert(preflightSource.includes('loadAudioPlan'));
  assert(preflightSource.includes('readAudio(modal, audioPlan)'));
  assert(route.includes('mediaPipeline.runMediaPipeline'));
  assert(!route.slice(route.indexOf("router.post('/tasks/:id/media'"), route.indexOf("router.post('/storyboard'")).includes('service.generateVideoStage'));
  assert(mediaLoader.includes("'/js/new-story-ad/audio-preflight.js'"));
  assert(read('public/js/new-story-ad/audio-preflight.js').split(/\r?\n/).length <= 320, '声音选择交互必须留在独立小模块，不能回灌旧主前端');
  assert(!read('public/js/new-story-ad/audio-preflight.js').match(/苏晚|不锈钢|墙面|设计师的困境/), '声音推荐不得写死当前人物、行业或场景');
}

(async () => {
  testUniversalVoiceRecommendation();
  await testAudioSelectionApplication();
  await testExistingMusicCanBeReplaced();
  await testMusicSearchFailureKeepsExistingChoice();
  await testDecoupledMediaPipeline();
  await testTtsFailureStopsVideo();
  await testPartialVideoReviewStopsCompose();
  testExplicitZeroVolumesArePreserved();
  testSilentSelectionNeedsNoSecondAcknowledgement();
  testIntegrationMarkers();
  console.log('new story ad audio preflight and decoupled media pipeline: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
