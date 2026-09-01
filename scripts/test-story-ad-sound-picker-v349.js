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
  const view = ['finalSoundDesignView.js', 'soundDesignFeature.js'].map(file => fs.readFileSync(path.join(root, 'public/story-ad/views', file), 'utf8')).join('\n');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  const routes = fs.readFileSync(path.join(root, 'src/routes/storyAdWorkspace.js'), 'utf8');
  assert(view.includes('type="radio" name="story-voice-mode"'), '人声选择必须使用两个有解释的单选卡，而不是裸复选框');
  assert(!view.includes('type="checkbox" data-include-voiceover'), '不得继续显示含义不清的默认勾选框');
  assert(view.includes('检测到 ${spokenShots} 个分镜包含人声内容'), '默认建议必须向用户展示实际检测依据');
  assert(view.includes('只有点击“生成配音试听”才会执行和计费'), '必须说明默认选择不会在打开页面时计费');
  assert(view.includes('data-open-bgm-library') && view.includes('data-bgm-library-dialog') && view.includes('data-search-bgm-library'), '背景音乐必须通过独立弹窗提供风格选择和搜索入口');
  assert(view.includes('data-import-bgm') && view.includes('切换为这首'), '每个背景音乐候选必须可以试听并切换');
  assert(view.includes("items.slice(0, 1).map(bgmCandidateMarkup)"), '页面默认推荐必须只展示一首，更多候选留在独立音乐库');
  assert(view.includes(':not([data-sound-track="bgm"])'), '场景音效试听时长不得错误读取全片 BGM 行');
  assert(view.includes('原音乐不会重复叠加'), '切换成功反馈必须解释单轨替换结果');
  assert(routes.includes('subtitle: production.plan.subtitle !== false') && routes.includes('bgm_volume: production.plan.bgm_volume ?? 0.16'), '声音接口必须返回已保存的字幕和 BGM 音量，避免刷新后显示默认值');
  assert(css.includes('v349 sound choice cards') && css.includes('.bgm-candidate-grid'), '新交互必须有独立响应式样式');

  const axios = require('axios');
  const originalGet = axios.get;
  const searched = [];
  axios.get = async (_url, options = {}) => {
    const query = String(options.params?.q || '');
    searched.push(query);
    const count = query === 'warm piano background music' ? 2 : 8;
    return { data: { results: Array.from({ length: count }, (_, index) => ({
      id: `${query}-${index}`, title: `${query} ${index}`, creator: 'Open creator', license: 'cc0',
      url: `https://cdn.freesound.org/previews/${encodeURIComponent(query)}-${index}.mp3`, duration: 30,
    })) } };
  };
  try {
    const expanded = await soundDesign.searchOpenverse('warm piano background music');
    assert(expanded.results.length >= 8, '首个精确关键词只有两首时，必须继续合并通用开源关键词结果');
    assert(searched.includes('instrumental music'), '稀疏音乐结果必须继续查询通用器乐关键词');
  } finally {
    axios.get = originalGet;
  }

  console.log(JSON.stringify({ ok: true, voice_choice_explained: true, default_bgm_candidates_visible: 1, expanded_library_candidates: true, bgm_tracks_after_switch: bgmRows.length, upstream_unchanged: true, model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
