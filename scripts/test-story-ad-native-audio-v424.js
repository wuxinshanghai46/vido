'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-native-audio-'));
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_MOCK_LLM = '1';
const native = require('../src/services/newStoryAd/nativeAudioWorkflowService');
const qa = require('../src/services/newStoryAd/nativeAudioQaService');
const timeline = require('../src/services/newStoryAd/audioTimelineIntegrityService');
const storage = require('../src/services/newStoryAd/storageService');
const media = require('../src/services/newStoryAd/mediaPipelineService');
const navigation = require('../src/services/storyAdWorkspace/workflowNavigationService');
const child = require('node:child_process');
const tts = require('../src/services/newStoryAd/ttsAdapter');

(async () => {
  const shot = { duration: 4, speech_mode: 'on_camera_introduction', speaker: '小林', dialogue: '你好，欢迎光临。' };
  const result = { audio_observed: true, transcription_confidence: 0.99, speaker_assignment_correct: true, utterances: [{ text: '你好，欢迎光临。', start_sec: 0.3, end_sec: 2.5, complete: true }], lip_sync: { verified: true, max_offset_ms: 40, confidence: 0.99 } };
  assert.equal(tts.speechMode(shot), 'on_camera_dialogue');
  assert.equal(native.speech(shot)[0].kind, 'dialogue');
  assert(qa.evaluate(result, shot, 4).pass);
  for (const bad of [
    { audio_observed: false }, { transcription_confidence: undefined }, { transcription_confidence: 0.4 },
    { utterances: [] }, { utterances: [{ ...result.utterances[0], text: '你好' }] },
    { utterances: [{ ...result.utterances[0], end_sec: 3.9 }] },
    { utterances: [{ ...result.utterances[0], complete: false }] },
    { lip_sync: { verified: true, max_offset_ms: 0 } },
    { lip_sync: { verified: true, max_offset_ms: 300, confidence: 1 } },
    { lip_sync: { verified: false, max_offset_ms: 0, confidence: 1 } },
    { speaker_assignment_correct: false },
  ]) assert.equal(qa.evaluate({ ...result, ...bad }, shot, 4).pass, false);
  assert(qa.evaluate({ ...result, lip_sync: null }, { voiceover: '你好，欢迎光临。' }, 4).pass);
  const voiceoverResult = {
    audio_observed: true,
    transcription_confidence: 0.99,
    speaker_assignment_correct: false,
    utterances: [{ text: '提到不銹鋼，很多人想到的是廠房和管道。', start_sec: 0.3, end_sec: 3.74, complete: true }],
    lip_sync: { verified: false, max_offset_ms: null, confidence: 0 },
  };
  assert(qa.evaluate(voiceoverResult, { speech_mode: 'offscreen_voiceover', voiceover: '提到不锈钢，很多人想到的是厂房和管道。' }, 4).pass,
    '繁简体差异、旁白口型 false 和 260ms 安全尾量都不能误报为口型失败');
  assert(!qa.evaluate({ ...result, utterances: [...result.utterances, ...result.utterances] }, shot, 4).pass);
  assert.throws(() => native.prepareShots([{ voiceover: '长'.repeat(100) }]), { code: 'VIDEO_SPEECH_SHOT_TOO_LONG' });
  assert.throws(() => native.prepareShots([{ duration: 16 }]), { code: 'VIDEO_SHOT_DURATION_UNSUPPORTED' });
  const source = [{ duration: 3, voiceover: '完整台词必须在当前镜头结束之前说完。' }];
  assert(native.prepareShots(source)[0].duration > source[0].duration);
  assert.equal(source[0].duration, 3);
  assert.match(native.prompt(shot), /口型/);
  assert.match(native.prompt({ voiceover: '旁白' }), /画外音/);
  const context = native.context({ voice_id: 'old', bgm_asset: { id: 'old' }, include_voiceover: true });
  assert.equal(context.include_voiceover, false); assert.equal(context.bgm_asset, null);
  assert.throws(() => qa.candidate(), { code: 'VIDEO_AUDIO_QA_TEST_FIXTURE_REQUIRED' });
  assert.throws(() => native.assertPostproduction('empty', storage), { code: 'AUDIO_EDIT_FINAL_REQUIRED' });

  const clip = { duration_sec: 4, native_audio_qa: { utterances: result.utterances, observed_duration_sec: 4 } };
  assert.equal(timeline.editedSpeech(clip, { speed: 2 })[0].end_sec, 1.25);
  for (const edit of [{ trim_start_sec: 1 }, { trim_end_sec: 2 }, { muted: true }]) assert.throws(() => timeline.editedSpeech(clip, edit), { code: 'AUDIO_TIMELINE_INTEGRITY_FAILED' });
  assert.throws(() => timeline.assertReplacementFits(4, 4), { code: 'AUDIO_TIMELINE_INTEGRITY_FAILED' });
  timeline.assertReplacementFits(3, 4);
  assert.throws(() => timeline.assertTransitionSpeech([clip, clip], [], [{}, { overlap_sec: 0.5 }], [4, 4]));

  storage.createTask({ id: 'edit-preserves-final' });
  storage.saveOutput('edit-preserves-final', 'storyboard_table', [shot]);
  storage.saveOutput('edit-preserves-final', 'video_clips', [clip]);
  storage.saveOutput('edit-preserves-final', 'final_video', { video_url: '/existing.mp4' });
  require('../src/services/newStoryAd/storyAdTimelineService').save('edit-preserves-final', { items: [{ shot_index: 1, speed: 1 }] });
  require('../src/services/newStoryAd/audioProductionService').savePlan('edit-preserves-final', { voice_id: 'replacement' });
  assert.equal(storage.getOutput('edit-preserves-final', 'final_video').video_url, '/existing.mp4');

  const calls = [];
  await media.runMediaPipeline({ taskId: 'unit', options: { include_voiceover: true, voice_id: 'old', apply_audio_edits: true }, service: {
    generateTtsStage: () => { throw Error('unexpected paid TTS'); },
    generateVideoStage: async (id, options) => { calls.push(['video', options]); },
    composeStage: async (id, options) => { calls.push(['compose', options]); },
  } });
  assert.deepEqual(calls.map(row => row[0]), ['video', 'compose']);
  assert.equal(calls[0][1].audio_mode, native.MODE); assert.equal(calls[1][1].apply_audio_edits, false);
  const nav = navigation.build({ context: { shot_design_confirmed: true }, outputs: {}, clean: value => String(value || ''), list: value => Array.isArray(value) ? value : [] });
  assert(nav.steps.compose.enabled); assert(!nav.steps.sound.enabled); assert(!nav.steps.edit.enabled);

  // Synthetic media plus an explicitly injected evaluator exercise storage and
  // concurrency. These fixtures do not assert a real model can measure lips.
  const file = path.join(process.env.OUTPUT_DIR, 'fixture.mp4');
  child.execFileSync(require('ffmpeg-static'), ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-c:a', 'aac', '-t', '4', file], { stdio: 'ignore' });
  let requested = 0;
  const taskId = 'native-' + 'x'.repeat(170);
  const options = { taskId, clip: { file_path: file }, shot, index: 0, modelFor: () => ({ provider_id: 'fixture', model_id: 'gemini-fixture' }), generate: async payload => {
    requested++; assert.equal(payload.retryEmptyResponse, false);
    assert(payload.messages[0].content.some(part => part.type === 'input_audio'));
    assert(payload.messages[0].content.filter(part => part.type === 'image_url').length >= 47);
    assert(!payload.messages[0].content[0].text.includes('欢迎光临'));
    return { text: JSON.stringify(result) };
  } };
  const records = await Promise.all([qa.review(options), qa.review(options), qa.review(options)]);
  assert.equal(requested, 1); assert(records.every(row => row.pass));
  await qa.review(options); assert.equal(requested, 1);
  qa.assertVerified({ file_path: file, native_audio_qa: records[0] }, shot);
  assert.throws(() => qa.assertVerified({ file_path: file, native_audio_qa: records[0] }, { ...shot, dialogue: '另一句话' }));
  const failureOptions = { ...options, taskId: taskId + '-other', generate: async () => { requested++; throw Error('fixture timeout'); } };
  await assert.rejects(qa.review(failureOptions), { code: 'VIDEO_AUDIO_QA_FAILED' });
  assert.equal((await qa.review(failureOptions)).pass, false); assert.equal(requested, 2);
  console.log(JSON.stringify({ passed: true, contract_groups: 11, real_media_fixture: true, concurrent_requests: 3, injected_model_calls: 2, real_model_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
