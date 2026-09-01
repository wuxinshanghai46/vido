#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-audio-order-v376-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_TTS = '1';

const storage = require('../src/services/newStoryAd/storageService');
const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const recovery = require('../src/services/newStoryAd/storyboardNarrativeRecoveryService');

function fixtures() {
  const blueprint = { beats: Array.from({ length: 7 }, (_, index) => ({
    beat_index: index + 1,
    shot_id: `beat_${index + 1}`,
    spoken_line: `剧本第${index + 1}段旁白`,
  })) };
  const coverage = { beat_coverage: blueprint.beats.map((beat, index) => ({
    source_index: index + 1,
    story_beat_id: `${beat.shot_id}:source:${index + 1}`,
    coverage_units: [{
      coverage_id: `${beat.shot_id}:source:${index + 1}:coverage:1`,
      global_sequence: index + 1,
      spoken_line: beat.spoken_line,
    }],
  })) };
  const order = [6, 5, 1, 2, 3, 4, 7];
  const shots = order.map((sourceIndex, position) => ({
    shot_id: `beat_${sourceIndex}:source:${sourceIndex}:coverage:1`,
    coverage_id: `beat_${sourceIndex}:source:${sourceIndex}:coverage:1`,
    shot_index: position + 1,
    index: position + 1,
    speech_mode: 'offscreen_voiceover',
    voiceover: `剧本第${sourceIndex}段旁白`,
  }));
  return { blueprint, coverage, order, shots };
}

async function main() {
  const taskId = 'audio-narrative-order-v376';
  const { blueprint, coverage, order, shots } = fixtures();
  storage.createTask({ id: taskId, request: {}, user_id: 'test-user' });
  storage.saveOutput(taskId, 'blueprint', blueprint);
  storage.saveOutput(taskId, 'storyboard_coverage_plan', coverage);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  storage.saveOutput(taskId, 'storyboard_images', order.map(sourceIndex => ({ image_url: `/image-${sourceIndex}.png` })));
  storage.saveOutput(taskId, 'tts_audio', { voice_id: 'mock-voice', tracks: order.map((sourceIndex, position) => ({
    index: position + 1,
    shot_index: position,
    text: `剧本第${sourceIndex}段旁白`,
    audio_url: `/audio-${sourceIndex}.mp3`,
  })) });

  const projected = audioProduction.current(taskId);
  assert.deepStrictEqual(projected.speech.map(row => row.units[0].text), blueprint.beats.map(beat => beat.spoken_line), '声音读取边界必须先恢复剧本权威顺序');
  const result = recovery.recoverTask(taskId);
  assert.strictEqual(result.recovered, true, '无视频下游的错序历史任务必须可零费用恢复');
  assert.deepStrictEqual({ model_calls: result.model_calls, paid_calls: result.paid_calls }, { model_calls: 0, paid_calls: 0 });
  const repairedShots = storage.getOutput(taskId, 'storyboard_table');
  assert.deepStrictEqual(repairedShots.map(shot => shot.voiceover), blueprint.beats.map(beat => beat.spoken_line), '分镜旁白必须逐镜等于剧本旁白');
  assert.deepStrictEqual(repairedShots.map(shot => shot.shot_index), [1, 2, 3, 4, 5, 6, 7], '恢复后镜号必须连续且一基');
  assert.deepStrictEqual(storage.getOutput(taskId, 'storyboard_images').map(row => row.image_url), blueprint.beats.map((_, index) => `/image-${index + 1}.png`), '已有分镜图必须随对应镜头重排，不能覆盖或丢失');
  const repairedTracks = storage.getOutput(taskId, 'tts_audio').tracks;
  assert.deepStrictEqual(repairedTracks.map(track => track.audio_url), blueprint.beats.map((_, index) => `/audio-${index + 1}.mp3`), '已有音频必须按文本确定性重绑，不能重新付费生成');
  assert(repairedTracks.every((track, index) => track.shot_id === repairedShots[index].shot_id && track.shot_index === index + 1 && track.index === index + 1), '音轨必须持久化镜头 ID 与一基镜号');

  const generated = await ttsAdapter.generateVoiceover({ taskId: `${taskId}-new`, shots: repairedShots.slice(0, 2), voiceId: 'mock-voice' });
  assert(generated.tracks.every((track, index) => track.shot_id === repairedShots[index].shot_id && track.shot_index === index + 1 && track.index === index + 1), '新生成音轨不得再用零基或数组偶然位置作为身份');

  const view = fs.readFileSync(path.resolve(__dirname, '../public/story-ad/views/soundDesignFeature.js'), 'utf8');
  const audioController = fs.readFileSync(path.resolve(__dirname, '../public/story-ad/controllers/liveAudioPreviewController.js'), 'utf8');
  assert(audioController.includes("host.addEventListener('play'") && audioController.includes("host.querySelectorAll('audio')"), '任何音频开始播放时必须停止页面内其他音频');
  assert(view.includes('ttsTrackFor') && view.includes('row.shot_id'), '播放器必须优先按镜头 ID 绑定音轨');

  console.log(JSON.stringify({ ok: true, repaired_shots: repairedShots.length, rebound_tracks: repairedTracks.length, preserved_images: 7, model_calls: 0, paid_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
