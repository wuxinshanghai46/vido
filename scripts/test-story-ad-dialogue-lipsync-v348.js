#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-dialogue-lipsync-v348-'));
process.env.OUTPUT_DIR = temporaryRoot;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_TTS = '1';

const ttsAdapter = require('../src/services/newStoryAd/ttsAdapter');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

async function main() {
  const offscreen = { speech_mode: 'offscreen_voiceover', voiceover: '这是旁白。' };
  const mixed = {
    speech_mode: 'on_camera_dialogue',
    dialogue_lines: [
      { speaker: '旁白', kind: 'voiceover', line: '先说旁白。' },
      { speaker: '演员甲', kind: 'dialogue', line: '再由人物说话。' },
    ],
  };
  const narrationOnlyMarkedDialogue = {
    speech_mode: 'on_camera_dialogue',
    dialogue_lines: [{ speaker: '旁白', kind: 'voiceover', line: '仍然只是旁白。' }],
  };
  const assignments = { narrator: 'voice-narrator', speakers: { '演员甲': 'voice-actor' } };

  const offscreenUnits = ttsAdapter.shotSpeechUnits(offscreen, 'voice-narrator', assignments);
  assert.strictEqual(videoAdapter.requiresLipSyncForAudio(offscreen, {}, { speech_units: offscreenUnits }), false, '纯旁白不得进入口型模型');

  const mixedTrack = await ttsAdapter.generateShotAudio({ taskId: 'mixed', shot: mixed, index: 0, voiceId: 'voice-narrator', voiceAssignments: assignments });
  assert.deepStrictEqual(mixedTrack.speech_units.map(unit => unit.kind), ['narration', 'dialogue']);
  assert.strictEqual(mixedTrack.narration_unit_count, 1);
  assert.strictEqual(mixedTrack.lip_sync_unit_count, 1);
  assert(mixedTrack.lip_sync_audio_url, '混合分镜必须产生独立对白口型驱动轨');
  assert.strictEqual(videoAdapter.requiresLipSyncForAudio(mixed, {}, mixedTrack), true);
  assert.strictEqual(videoAdapter.lipSyncAudioSource(mixedTrack), mixedTrack.lip_sync_audio_url, '口型模型只能读取对白驱动轨');
  assert.strictEqual(videoAdapter.lipSyncAudioSource({ ...mixedTrack, lip_sync_audio_url: '' }), '', '混合分镜缺少对白轨时不得退回整段配音驱动口型');

  const narrationUnits = ttsAdapter.shotSpeechUnits(narrationOnlyMarkedDialogue, 'voice-narrator', assignments);
  assert.strictEqual(videoAdapter.requiresLipSyncForAudio(narrationOnlyMarkedDialogue, {}, { speech_units: narrationUnits }), false, '即使顶层误标为对白，只含旁白也不得做口型');

  const root = path.resolve(__dirname, '..');
  const compose = fs.readFileSync(path.join(root, 'src/services/newStoryAd/composeService.js'), 'utf8');
  const soundView = ['finalSoundDesignView.js', 'soundDesignFeature.js'].map(file => fs.readFileSync(path.join(root, 'public/story-ad/views', file), 'utf8')).join('\n');
  assert(compose.includes('preserveSourceAudio = !unit.clips.some'), '最终混音必须移除口型临时驱动音轨，避免对白重复');
  assert(soundView.includes('旁白/画外音不做口型') && soundView.includes('只有人物出镜对白才进行口型同步'));

  console.log(JSON.stringify({ ok: true, narration_lip_sync: false, mixed_dialogue_driver_tracks: 1, duplicate_dialogue_mix_prevented: true, model_calls: 0 }));
}

main().finally(() => fs.rmSync(temporaryRoot, { recursive: true, force: true })).catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
