#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-sound-layout-v347-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const soundDesign = require('../src/services/newStoryAd/soundDesignAssetService');

function main() {
  const taskId = 'sound-layout-v347';
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  const storyboard = [
    { shot_id: 'shot_1', shot_index: 1, duration_sec: 4, ambient_sound: '安静展厅内轻微空调底噪', sfx: [] },
    { shot_id: 'shot_2', shot_index: 2, duration_sec: 3, ambient_sound: '安静室内', sfx: ['手指划过金属表面的摩擦声'] },
    { shot_id: 'shot_3', shot_index: 3, duration_sec: 8, ambient_sound: '远处空间底噪', sfx: [] },
  ];
  storage.saveOutput(taskId, 'storyboard_table', storyboard);
  const before = storage.canonicalFingerprint(storage.getOutput(taskId, 'storyboard_table'));
  const compiled = soundDesign.compile(taskId);

  assert.deepStrictEqual(compiled.shots.map(row => row.auto_recommend_sound), [false, true, false], '只有剧情明确动作音效才应主动推荐');
  assert(compiled.shots.every(row => row.sound_optional === true), '逐镜场景音效必须明确为可选');
  assert.deepStrictEqual(compiled.shots.map(row => row.preview_duration_sec), [4, 3, 6], '场景音效试听必须按分镜时长且最多 6 秒');
  assert.strictEqual(soundDesign.shouldAutoRecommend({ ambient_sound: 'room tone', sfx: [] }), false);
  assert.strictEqual(soundDesign.shouldAutoRecommend({ ambient_sound: 'room tone', sfx: ['door close'] }), true);

  audioProduction.savePlan(taskId, { include_voiceover: true, voice_id: '' });
  const confirmed = audioProduction.confirm(taskId);
  assert.strictEqual(confirmed.approved, true, '不采用场景音效和背景音乐也必须可以确认声音并继续');
  assert.strictEqual(confirmed.approval.sound_track_count, 0);
  assert.strictEqual(storage.canonicalFingerprint(storage.getOutput(taskId, 'storyboard_table')), before, '声音页不得回写前五步分镜');

  const root = path.resolve(__dirname, '..');
  const view = [
    path.join(root, 'public/story-ad/views/finalSoundDesignView.js'),
    path.join(root, 'public/story-ad/views/soundDesignFeature.js'),
    path.join(root, 'public/story-ad/controllers/liveAudioPreviewController.js'),
  ].map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const shell = fs.readFileSync(path.join(root, 'public/story-ad/views/finalSoundView.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'src/services/newStoryAd/composeService.js'), 'utf8');
  assert(shell.includes('data-confirm-audio'), '确认入口必须位于页面顶部操作区');
  assert(!view.includes('sound-confirm-flow'), '页面底部不得重复放置确认入口');
  assert(view.includes('背景音乐') && view.includes('场景音效') && view.includes('均为可选'), '背景音乐和场景音效必须拆分并明确可选');
  assert(view.includes('[data-auto-recommend="true"]'), '前端只能为标记后的剧情声音主动匹配');
  assert(!view.includes('data-use-all-sound-recommendations'), '可选声音不得提供误导性一键全铺按钮');
  assert(view.includes('data-play-sound-preview') && view.includes('data-preview-seconds'), '原素材必须通过受分镜时长约束的试听控件播放');
  assert(css.includes('v347 sound workflow') && css.includes('font-size:13px'), '声音页必须使用统一字号基线');
  assert(compose.includes('atrim=0:${length.toFixed(3)}'), '最终混音必须继续按时间线长度裁切素材');

  console.log(JSON.stringify({ ok: true, auto_recommended_shots: 1, optional_shots: 3, sound_tracks: 0, upstream_unchanged: true }));
}

try { main(); } finally { fs.rmSync(temporaryRoot, { recursive: true, force: true }); }
