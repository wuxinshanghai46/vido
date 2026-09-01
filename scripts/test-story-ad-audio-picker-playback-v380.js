#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-audio-v380-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.NEW_STORY_AD_AUDIO_CACHE_DIR = path.join(temporaryRoot, 'audio-cache');
process.env.DB_ENABLED = '0';

const root = path.resolve(__dirname, '..');
const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const storage = require('../src/services/newStoryAd/storageService');

try {
  const ogg = Buffer.alloc(2048, 0);
  ogg.write('OggS', 0, 'ascii');
  assert.strictEqual(soundDesign.validDownloadedAudio(ogg, 'application/ogg'), true, 'Wikimedia 的标准 application/ogg 必须通过音频格式校验');
  assert.strictEqual(soundDesign.validDownloadedAudio(Buffer.alloc(2048, 0), 'application/ogg'), false, '只有 MIME 没有音频签名的伪文件必须拒绝');
  const html = Buffer.alloc(2048, 0); html.write('<html>', 0, 'ascii');
  assert.strictEqual(soundDesign.validDownloadedAudio(html, 'text/html'), false, '远端错误页不能写入音频缓存');

  const taskId = 'audio-picker-playback-v380';
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'storyboard_table', [{ shot_id: 'shot_1', shot_index: 1, duration_sec: 5 }]);
  const state = audioProduction.savePlan(taskId, { voice_volume: 9, bgm_volume: 9 });
  assert.strictEqual(state.plan.voice_volume, 1.5, '配音必须允许提升到 150% 并限制异常值');
  assert.strictEqual(state.plan.bgm_volume, 1, '背景音乐必须允许提升到 100% 并限制异常值');

  const controller = fs.readFileSync(path.join(root, 'public/story-ad/controllers/liveAudioPreviewController.js'), 'utf8');
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/soundDesignFeature.js'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'src/services/newStoryAd/composeService.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  assert(view.includes('max="1.5"') && view.includes('max="1"'), '两路音量范围必须分别扩展到 150% 和 100%');
  assert(!view.includes('data-overall-bgm-player data-preview-kind="bgm" data-audio-group="overall" loop'), '整体背景音乐不能依赖无限 loop 属性');
  assert(controller.includes("setPlayButton('⏸ 暂停')") && controller.includes("'▶ 继续试听'"), '整体试听必须由可暂停/继续的播放状态机控制');
  assert(controller.indexOf("overallState = 'playing'") < controller.indexOf('startPromise.catch'), '播放器启动 Promise 不得阻塞按钮进入可暂停状态');
  assert(!controller.includes('await Promise.all([voicePlayer.play(), bgmPlayer.play()])'), '不能等待双播放器启动 Promise 后才恢复按钮');
  assert(controller.includes("voicePlayer?.addEventListener('ended', finishOverall)"), '配音时间轴结束必须统一关闭两条播放器');
  assert(controller.includes('armEndGuard()') && controller.includes('clearEndGuard()'), '必须有基于成片时长的结束保护，避免背景音乐残留播放');
  assert(!controller.includes("setButtonBusy(event.currentTarget, true, '正在准备整体试听…'"), '试听按钮不得复用长任务耗时计时器');
  assert(controller.includes('createMediaElementSource') && controller.includes('voiceGain.gain.value = voiceVolume'), '超过 100% 的试听音量必须通过 Web Audio 增益真实生效');
  assert(view.includes('candidate?.classList.add(\'is-selected\')') && css.includes('.bgm-candidate.is-selected'), '点击候选后必须立即把选中框移动到当前候选');
  assert(compose.includes('clampVolume(voiceVolume, 1, 0.6, 1.5)') && compose.includes('clampVolume(bgmVolume, 0.16, 0, 1)'), '最终成片必须使用与试听一致的新音量上限');

  console.log(JSON.stringify({
    ok: true,
    ogg_application_mime: 'accepted_with_signature',
    selected_state: 'persisted_and_optimistic',
    playback_states: ['idle', 'loading', 'playing', 'paused', 'ended'],
    voice_max_percent: 150,
    bgm_max_percent: 100,
    paid_calls: 0,
  }));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
