#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-multi-voice-'));
process.env.OUTPUT_DIR = output;
const ffmpeg = require('ffmpeg-static');
const ttsService = require('../src/services/ttsService');
const calls = [];
ttsService.generateSpeech = async (text, outputPath, options = {}) => {
  calls.push({ text, voiceId: options.voiceId });
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${options.voiceId === 'voice-a' ? 440 : 660}:duration=0.25`, '-ac', '1', '-ar', '24000', '-b:a', '96k', outputPath], { encoding: 'utf8', timeout: 30000 });
  assert.strictEqual(result.status, 0, result.stderr);
  return outputPath;
};
ttsService.voiceProviderForId = id => `mock-${id}`;
const adapter = require('../src/services/newStoryAd/ttsAdapter');

(async () => {
  const shot = {
    speech_mode: 'on_camera_dialogue',
    dialogue_lines: [
      { speech_mode: 'dialogue', speaker: '沈砚辞', line: '你为什么来到这里？' },
      { speaker: '云知月', line: '因为我在找你。' },
      { speech_mode: 'voiceover', speaker: '内部错误人物', speaker_id: 'wrong', line: '故事从这里开始。' },
    ],
  };
  const assignments = { narrator: 'voice-n', speakers: { 沈砚辞: 'voice-a', 云知月: 'voice-b' } };
  const units = adapter.shotSpeechUnits(shot, 'voice-n', assignments);
  assert.deepStrictEqual(units.map(x => x.voice_id), ['voice-a', 'voice-b', 'voice-n']);
  assert.deepStrictEqual(units.map(x => x.text), ['你为什么来到这里？', '因为我在找你。', '故事从这里开始。']);
  assert.deepStrictEqual(units.map(x => x.kind), ['dialogue', 'dialogue', 'narration']);
  const result = await adapter.generateShotAudio({ taskId: 'multi-voice', shot, index: 0, voiceId: 'voice-n', voiceAssignments: assignments });
  assert.ok(fs.existsSync(result.file_path));
  assert.ok(fs.statSync(result.file_path).size > 1000);
  assert.deepStrictEqual(calls.map(x => x.voiceId), ['voice-a', 'voice-b', 'voice-n']);
  assert.strictEqual(result.speech_units.length, 3);
  assert.match(result.voice_signature, /沈砚辞:voice-a/);
  assert.match(result.voice_signature, /云知月:voice-b/);
  assert.strictEqual(adapter.voiceoverPlanMatches({ voice_id: 'voice-n', tracks: [result] }, [shot], 'voice-n', assignments), true);
  assert.strictEqual(adapter.voiceoverPlanMatches({ voice_id: 'voice-n', tracks: [result] }, [shot], 'voice-n', { ...assignments, speakers: { ...assignments.speakers, 云知月: 'voice-c' } }), false);
  await assert.rejects(() => adapter.generateShotAudio({ taskId: 'missing-role', shot, voiceId: '', voiceAssignments: { speakers: { 沈砚辞: 'voice-a' } } }), /云知月/);
  fs.rmSync(output, { recursive: true, force: true });
  console.log('new story ad multi-voice TTS: 13 assertions passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
