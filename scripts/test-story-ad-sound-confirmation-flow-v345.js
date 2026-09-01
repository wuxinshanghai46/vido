#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-sound-v345-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');
const axios = require('axios');

async function main() {
  const taskId = 'sound-confirmation-v345';
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'storyboard_table', [
    { shot_index: 1, speech_mode: 'offscreen', voiceover: '这是旁白。', ambient_sound: '现代展厅室内环境声。' },
    { shot_index: 2, speech_mode: 'on_camera_dialogue', dialogue_lines: [
      { speaker: '苏晚', line: '这是一句对白。' },
      { speaker: '旁白', kind: 'voiceover', line: '这是画外音。' },
    ] },
  ]);

  const initial = audioProduction.current(taskId);
  assert.strictEqual(initial.include_voiceover, true, '有旁白或对白的新任务必须默认启用声音');
  assert.deepStrictEqual(initial.speakers, ['苏晚'], '旁白不得再次出现在人物对白音色列表');
  await assert.rejects(async () => audioProduction.confirm(taskId), error => error.code === 'AUDIO_VOICE_REQUIRED');

  audioProduction.savePlan(taskId, { include_voiceover: false, voice_id: '' });
  assert.strictEqual(audioProduction.current(taskId).include_voiceover, false, '用户明确关闭声音后必须保留决定');

  assert.deepStrictEqual(soundDesign.openverseQueryCandidates('showroom ambience'), [
    'showroom ambience', 'indoor ambience', 'indoor room tone',
  ]);
  const calls = [];
  const originalGet = axios.get;
  axios.get = async (_url, options) => {
    calls.push(options.params.q);
    if (options.params.q === 'showroom ambience') return { data: { results: [] } };
    return { data: { results: [{
      id: 'open-audio-1', title: 'Indoor room', creator: 'Tester', license: 'cc0',
      url: 'https://cdn.freesound.org/previews/1/1.mp3', duration: 5,
    }] } };
  };
  try {
    const result = await soundDesign.searchOpenverse('showroom ambience');
    assert.strictEqual(result.results.length, 1);
    assert.strictEqual(result.selected_query, 'indoor ambience');
    assert.strictEqual(result.fallback_used, true);
    assert.deepStrictEqual(calls, ['showroom ambience', 'indoor ambience']);
    axios.get = async () => ({ data: { results: [] } });
    const safeFallback = await soundDesign.searchOpenverse('quiet indoor room');
    assert.match(safeFallback.results[0].id, /^vido_generated_/);
    assert(fs.existsSync(safeFallback.results[0].file_path), '在线曲库无结果时必须仍提供真实可播放文件');
    const imported = await soundDesign.importOpenverseAsset(taskId, {
      openverse_id: safeFallback.results[0].id,
      shot_index: 1,
      track_type: 'ambient',
    });
    assert.strictEqual(imported.asset.license, 'VIDO_GENERATED');
    assert.strictEqual(soundDesign.resolvedTracks(taskId).length, 1, '本地安全声音必须能进入最终合成轨道');
  } finally {
    axios.get = originalGet;
  }

  const root = path.resolve(__dirname, '..');
  const soundView = ['finalSoundDesignView.js', 'soundDesignFeature.js'].map(file => fs.readFileSync(path.join(root, 'public/story-ad/views', file), 'utf8')).join('\n');
  const shellView = fs.readFileSync(path.join(root, 'public/story-ad/views/finalSoundView.js'), 'utf8');
  assert(!soundView.includes('自动（按可用链回退）'), '页面不得再展示没有落到真实音色的自动选项');
  assert(!soundView.includes('data-preview-sound'), '搜索按钮不得再伪装成已经存在的试听声音');
  assert(shellView.includes('确认声音并进入视频与合成'));
  assert(soundView.includes('data-auto-sound-recommendation'));
  assert(shellView.includes('navigate: context.navigate'));

  console.log('story ad sound confirmation flow v345: ok');
}

main().finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true })).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
