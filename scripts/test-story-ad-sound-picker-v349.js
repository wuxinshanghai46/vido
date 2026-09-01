#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-sound-picker-v349-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');

async function main() {
  const taskId = 'sound-picker-v349';
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'storyboard_table', [
    { shot_id: 'shot_1', shot_index: 1, duration_sec: 4, voiceover: '品牌旁白。', music_cue: '高级克制' },
    { shot_id: 'shot_2', shot_index: 2, duration_sec: 3, dialogue: '欢迎了解产品。', speaker: '主讲人' },
  ]);
  const upstreamBefore = storage.canonicalFingerprint(storage.getOutput(taskId, 'storyboard_table'));
  assert.strictEqual(audioProduction.current(taskId).include_voiceover, true, '检测到真实旁白或对白时仍应默认建议生成配音');

  const first = path.join(temporaryRoot, 'bgm-first.mp3');
  const second = path.join(temporaryRoot, 'bgm-second.mp3');
  fs.writeFileSync(first, Buffer.alloc(2048, 1));
  fs.writeFileSync(second, Buffer.alloc(2048, 2));
  soundDesign.addUserAsset(taskId, { track_type: 'bgm', shot_index: 1, asset: { id: 'bgm-first', filename: 'bgm-first.mp3', file_path: first, file_url: '/first.mp3', mimetype: 'audio/mpeg' } });
  soundDesign.addUserAsset(taskId, { track_type: 'bgm', shot_index: 1, asset: { id: 'bgm-second', filename: 'bgm-second.mp3', file_path: second, file_url: '/second.mp3', mimetype: 'audio/mpeg' } });
  const bgmRows = soundDesign.compile(taskId).timeline.filter(row => row.track_type === 'bgm');
  assert.strictEqual(bgmRows.length, 1, '切换背景音乐必须替换原 BGM，禁止叠加多条全片音乐');
  assert.strictEqual(bgmRows[0].asset_id, 'bgm-second');
  assert.deepStrictEqual(soundDesign.normalizeTimelineTracks([
    { timeline_id: 'old', track_type: 'bgm', asset_id: 'old' },
    { timeline_id: 'effect', track_type: 'sfx', asset_id: 'effect' },
    { timeline_id: 'latest', track_type: 'bgm', asset_id: 'latest' },
  ]).map(row => row.asset_id), ['effect', 'latest'], '历史多 BGM 状态必须只投影最后选择的一首，同时保留其他音效轨');
  assert.strictEqual(storage.canonicalFingerprint(storage.getOutput(taskId, 'storyboard_table')), upstreamBefore, '背景音乐切换不得回写前五步分镜');

  const root = path.resolve(__dirname, '..');
  const view = [
    path.join(root, 'public/story-ad/views/finalSoundDesignView.js'),
    path.join(root, 'public/story-ad/views/soundDesignFeature.js'),
    path.join(root, 'public/story-ad/controllers/liveAudioPreviewController.js'),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'src/routes/storyAdWorkspace.js'), 'utf8');
  assert(!view.includes('name="story-voice-mode"') && !view.includes('data-include-voiceover'), '声音页不得重复询问剧情已经确定的旁白/对白开关');
  assert(view.includes('声音内容已按剧情自动确定'), '声音页必须说明内容直接继承剧情合同');
  assert(view.includes('旁白按旁白生成，对白按对应人物生成，两者并存时会自动组合'), '必须清楚说明旁白与人物对白的自动组合规则');
  assert(view.includes('data-open-bgm-library') && view.includes('data-bgm-library-dialog') && view.includes('data-search-bgm-library'), '背景音乐必须通过独立弹窗提供风格选择和搜索入口');
  assert(!view.includes('已将“') && view.includes('曲库不保证收录同名商业歌曲'), '音乐库不得用结果无法证明的“已识别”提示误导用户');
  assert(view.includes('data-import-bgm') && view.includes('切换为这首'), '每个背景音乐候选必须可以试听并切换');
  assert(view.includes("items.slice(0, 1).map((item, index) => bgmCandidateMarkup(item, index, activeBgmSourceId))"), '页面默认推荐必须只展示一首，更多候选留在独立音乐库');
  assert(view.includes('&track_type=bgm') && routes.includes("trackType: req.query.track_type || ''"), '背景音乐搜索必须把音轨类型传到开放音乐检索服务');
  assert(view.includes(':not([data-sound-track="bgm"])'), '场景音效试听时长不得错误读取全片 BGM 行');
  assert(view.includes('原音乐不会重复叠加'), '切换成功反馈必须解释单轨替换结果');
  assert(routes.includes('subtitle: production.plan.subtitle !== false') && routes.includes('voice_volume: production.plan.voice_volume ?? 1') && routes.includes('bgm_volume: production.plan.bgm_volume ?? 0.16'), '声音接口必须返回已保存的字幕、人声和 BGM 音量，避免刷新后显示默认值');
  assert(css.includes('v349 sound choice cards') && css.includes('.bgm-candidate-grid') && css.includes('v373 sound progress'), '新交互必须有独立响应式样式');

  const axios = require('axios');
  const originalGet = axios.get;
  const searched = [];
  axios.get = async (_url, options = {}) => {
    const query = String(options.params?.q || '');
    searched.push(query);
    const count = ['warm piano background music', '星月神话'].includes(query) ? 2 : 8;
    return { data: { results: Array.from({ length: count }, (_, index) => ({
      id: `${query}-${index}`, title: query === 'longing traditional Chinese instrumental music' && index === 0 ? 'cat recorder field recording'
        : query === 'longing traditional Chinese instrumental music' && index === 1 ? 'Protests in Chile group of musicians'
        : `${query} ${index}`, creator: 'Open creator', license: 'cc0',
      url: `https://cdn.freesound.org/previews/${encodeURIComponent(query)}-${index}.mp3`, duration: 30,
    })) } };
  };
  try {
    const expanded = await soundDesign.searchOpenverse('warm piano background music');
    assert(expanded.results.length >= 8, '首个精确关键词只有两首时，必须继续合并通用开源关键词结果');
    assert(searched.includes('instrumental music'), '稀疏音乐结果必须继续查询通用器乐关键词');
    searched.length = 0;
    const chineseTitle = await soundDesign.searchOpenverse('相思', { trackType: 'bgm' });
    assert(chineseTitle.results.length >= 8, '中文歌名或意境作为 BGM 查询时不得退化成单条空间底噪');
    assert.strictEqual(chineseTitle.match_mode, 'similar_open_license', '商业歌曲名必须标记为相似开放授权检索，禁止冒充原曲');
    assert.strictEqual(chineseTitle.reference_query, '相思');
    assert(!chineseTitle.results.some(item => /cat|protest/i.test(item.name)), '背景音乐候选必须过滤现场录音、动物声等明显非配乐素材');
    assert.strictEqual(searched[0], 'longing traditional Chinese instrumental music', '相思类意境必须优先查询包含思念语义的东方器乐，而不是宽泛古筝关键词');
    assert(!searched.includes('instrumental music'), '相思类意境不得回退到过宽的通用器乐关键词');
    assert(chineseTitle.results.every(item => item.match_reason === '思念、离别与东方器乐'), '每首中文主题候选必须展示真实检索方向，让用户知道与输入的关系');
  } finally {
    axios.get = originalGet;
  }

  console.log(JSON.stringify({ ok: true, story_authoritative_voice: true, default_bgm_candidates_visible: 1, expanded_library_candidates: true, chinese_bgm_intent_expanded: true, chinese_query: '相思', bgm_tracks_after_switch: bgmRows.length, upstream_unchanged: true, model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
