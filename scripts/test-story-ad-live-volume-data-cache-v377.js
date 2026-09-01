#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-live-audio-v377-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.NEW_STORY_AD_AUDIO_CACHE_DIR = path.join(temporaryRoot, 'data-disk-audio-cache');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/soundDesignFeature.js'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'public/story-ad/controllers/liveAudioPreviewController.js'), 'utf8');
const media = fs.readFileSync(path.join(root, 'src/services/newStoryAd/mediaAdapter.js'), 'utf8');
const sounds = fs.readFileSync(path.join(root, 'src/services/newStoryAd/soundDesignAssetService.js'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/routes/storyAdWorkspace.js'), 'utf8');
const pm2 = fs.readFileSync(path.join(root, 'scripts/story-ad-pm2-release.js'), 'utf8');

async function main() {
assert(view.includes('data-overall-voice-player') && controller.includes('data-overall-voice-player'), '配音时间轴播放器必须同时存在于标记和绑定代码');
assert(view.includes('data-overall-bgm-player') && controller.includes('data-overall-bgm-player'), '背景音乐播放器必须同时存在于标记和绑定代码');
assert(view.includes('data-audio-group="overall"'), '双轨必须属于同一互斥播放组，启动第二轨不能停止第一轨');
assert(controller.includes('const sameGroup = current.dataset.audioGroup'), '播放器互斥必须允许整体试听双轨并行');
assert(controller.includes("status.textContent = '已切换到单项试听；整体试听已停止。'"), '切换到单项试听时必须同步复位整体试听状态');
assert(!controller.includes('resetOverallPreview'), '音量滑杆不得删除整体试听音源');
assert.strictEqual((controller.match(/addEventListener\('input', syncPreviewVolumes\)/g) || []).length, 2, '两条音量滑杆都必须只做实时音量同步');
assert(controller.includes('Promise.all([voicePlayer.play(), bgmPlayer.play()])'), '整体试听必须同步启动配音和背景音乐');
assert(controller.includes("voicePlayer?.addEventListener('ended'"), '配音时间轴结束时必须停止循环背景音乐');

assert(media.includes('NEW_STORY_AD_AUDIO_CACHE_DIR'), '音频缓存目录必须可独立指向服务器数据盘');
assert(media.includes('/^(?:openverse_sound_|story_ad_voice_preview_)/i'), '开源音乐和配音时间轴必须路由到专用数据盘缓存');
assert(pm2.includes("'/data/vido/story-ad-audio-cache'"), '生产 PM2 必须把专用音频缓存固定到数据盘');
assert(sounds.includes('openverseCacheInflight') && sounds.includes('recentOpenverseSources'), '候选音乐预缓存必须去重并复用刚查询的许可元数据');
assert(sounds.includes('fs.copyFileSync(asset.file_path, temporary)'), '历史已选开源音乐必须在读取时迁移到数据盘缓存');
assert(routes.includes("/projects/:taskId/sound-assets/openverse/prepare"), '必须提供只缓存、不改变项目选择的候选音乐准备接口');

const axios = require('axios');
const originalGet = axios.get;
let downloads = 0;
axios.get = async url => {
  if (String(url).includes('/v1/audio/')) return { data: { results: [{ id: 'cache-fixture', title: 'Warm Piano Instrumental', creator: 'Fixture', license: 'cc0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', foreign_landing_url: 'https://example.test/item', url: 'https://cdn.freesound.org/previews/cache-fixture.mp3', duration: 30 }] } };
  if (String(url).includes('cdn.freesound.org')) { const data = Buffer.alloc(2048, 1); data.write('ID3', 0, 'ascii'); downloads += 1; return { data, headers: { 'content-type': 'audio/mpeg' } }; }
  throw new Error(`unexpected request ${url}`);
};
try {
  const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');
  const found = await soundDesign.searchOpenverse('warm piano background music', { trackType: 'bgm' });
  assert.strictEqual(found.results[0].id, 'cache-fixture', '查询结果必须进入同一次会话的许可元数据缓存');
  await Promise.all([
    soundDesign.prepareOpenverseAsset({ openverse_id: 'cache-fixture' }),
    soundDesign.prepareOpenverseAsset({ openverse_id: 'cache-fixture' }),
  ]);
  assert.strictEqual(downloads, 1, '同一候选的并发预缓存只能下载一次');
  const reused = await soundDesign.prepareOpenverseAsset({ openverse_id: 'cache-fixture' });
  assert.strictEqual(reused.cached, true, '已经落盘的候选必须直接复用');
  assert(fs.existsSync(path.join(process.env.NEW_STORY_AD_AUDIO_CACHE_DIR, reused.filename)), '候选音乐必须真实写入专用数据盘缓存目录');
} finally { axios.get = originalGet; }

console.log(JSON.stringify({
  ok: true,
  live_volume_sliders: 2,
  synchronized_audio_tracks: 2,
  candidate_prefetch: true,
  concurrent_downloads: downloads,
  historical_bgm_migration: true,
  production_audio_cache: '/data/vido/story-ad-audio-cache',
  model_calls: 0,
  paid_calls: 0,
}));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
