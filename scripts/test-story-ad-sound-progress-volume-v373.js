#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-sound-v373-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_TTS = '1';

const storage = require('../src/services/newStoryAd/storageService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');

async function main() {
  const taskId = 'sound-progress-volume-v373';
  const shots = Array.from({ length: 7 }, (_, index) => ({
    shot_id: `shot_${index + 1}`,
    shot_index: index + 1,
    duration_sec: 3,
    speech_mode: 'offscreen_voiceover',
    voiceover: `第${index + 1}段旁白`,
  }));
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'storyboard_table', shots);

  const checkpoints = [];
  const generated = await ttsAdapter.generateVoiceover({
    taskId,
    shots,
    voiceId: 'mock-voice',
    voiceAssignments: { narrator: 'mock-voice', speakers: {} },
    concurrency: 3,
    onCheckpoint: (_tracks, progress) => checkpoints.push(progress),
  });
  assert.strictEqual(generated.tracks.length, 7, '七镜必须生成七条可试听轨');
  assert.deepStrictEqual(checkpoints.map(item => item.completed), [3, 6, 7], '并发生成必须在每个批次发布真实完成数');
  assert(checkpoints.every(item => item.total === 7), '进度总数必须稳定为七段');
  assert(generated.tracks.every((track, index) => track.index === index + 1 && track.audio_url), '每条轨必须保留一基镜号与试听 URL');

  storage.saveOutput(taskId, 'tts_audio', generated);
  let state = audioProduction.savePlan(taskId, { voice_id: 'mock-voice', voice_volume: 0.72, bgm_volume: 0.11 });
  assert.strictEqual(state.plan.voice_volume, 0.72, '配音音量必须持久化');
  assert.strictEqual(state.plan.bgm_volume, 0.11, '背景音乐音量必须独立持久化');
  state = audioProduction.savePlan(taskId, { voice_id: 'mock-voice', voice_volume: 9, bgm_volume: -1 });
  assert.strictEqual(state.plan.voice_volume, 1.2, '服务端必须限制异常过大的人声音量');
  assert.strictEqual(state.plan.bgm_volume, 0, '服务端必须限制负背景音乐音量');

  const root = path.resolve(__dirname, '..');
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/soundDesignFeature.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'public/story-ad/components/ui.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/storyAdWorkspace.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'src/services/newStoryAd/storyAdService.js'), 'utf8');
  const progressService = fs.readFileSync(path.join(root, 'src/services/newStoryAd/ttsProgressService.js'), 'utf8');
  const ttsStart = service.indexOf('async function generateTtsStage');
  const ttsBlock = service.slice(ttsStart, service.indexOf('/** 编译通用执行方案', ttsStart));
  assert(view.includes('data-tts-inline-progress') && view.includes('data-tts-progress-label'), '声音页必须在生成按钮附近展示逐段进度条');
  assert(ui.includes("tts: 'sound'") && ui.includes("view.stage === 'tts'"), 'TTS 全局与行内进度必须归属声音页');
  assert(view.includes("mode === 'offscreen_voiceover'"), '新版旁白合同不得再显示成无语音');
  assert(view.includes('ttsTrackMap') && view.includes('track?.index'), '逐镜播放器必须按镜号匹配，不得依赖数组偶然顺序');
  assert(view.includes('data-preview-kind="voice"') && view.includes('data-preview-kind="bgm"'), '人声和背景音乐必须分别接入试听音量');
  assert(view.includes('voice_volume: Number') && route.includes('voice_volume: production.plan.voice_volume ?? 1'), '人声音量必须贯通前端载荷和读取接口');
  assert(!ttsBlock.includes('assertVideoInputsReady'), '声音生成不得被人物或关键帧视频门禁误拦截');
  assert(ttsBlock.includes('ttsProgress.create') && ttsBlock.includes('onCheckpoint: progress.checkpoint'), 'TTS 阶段必须把真实检查点交给独立进度状态机');
  assert(progressService.includes('voice_generating') && progressService.includes("storage.saveOutput(taskId, 'tts_audio'"), 'TTS 进度服务必须原子保存试听轨和可轮询完成数');
  assert(!view.includes('已将“'), '音乐检索不得展示无法由结果证明的识别结论');

  console.log(JSON.stringify({
    ok: true,
    tts_tracks: generated.tracks.length,
    checkpoint_completed: checkpoints.map(item => item.completed),
    voice_volume_persisted: 0.72,
    bgm_volume_persisted: 0.11,
    provider_calls: 0,
  }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
