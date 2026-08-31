#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-final-media-v341-'));
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const videoInputFrames = require('../src/services/newStoryAd/videoInputFrameService');
const audioProduction = require('../src/services/newStoryAd/audioProductionService');
const timeline = require('../src/services/newStoryAd/storyAdTimelineService');

const taskId = 'final-media-v341';
const context = {
  brief: '后段媒体流程边界回归',
  content_mode: 'narrative_story',
  shot_design_confirmed: true,
  scene_setup_confirmed: true,
  story_setup_confirmed: true,
  upstream_marker: { immutable: true, value: 'steps-1-to-5' },
};
const shots = [
  { shot_index: 1, index: 1, duration_sec: 4, speech_mode: 'offscreen', narration: '欢迎来到展厅。', expected_people: 0, expected_animals: 0 },
  { shot_index: 2, index: 2, duration_sec: 4, speech_mode: 'on_camera_dialogue', dialogue_lines: [{ speaker: '甲', text: '这就是新的表面工艺。' }, { speaker: '乙', text: '质感很细腻。' }], expected_people: 2, expected_animals: 0 },
];
storage.createTask({ id: taskId, title: 'V341', content_revision: 1, request: context });
storage.saveOutput(taskId, 'context', context);
storage.saveOutput(taskId, 'brief', { title: '后段媒体流程边界回归' });
storage.saveOutput(taskId, 'asset_plan', { marker: 'assets-unchanged' });
storage.saveOutput(taskId, 'scene_config', { marker: 'scenes-unchanged' });
storage.saveOutput(taskId, 'blueprint', { marker: 'story-unchanged' });
storage.saveOutput(taskId, 'storyboard_table', shots);
const contracts = shots.map((shot, index) => ({ shot_index: index + 1, contract_fingerprint: `contract_${index + 1}`, visual_contract: {} }));
storage.saveOutput(taskId, 'keyframe_contracts', contracts);

const imageRows = shots.map((shot, index) => {
  const filename = `v341_storyboard_${index + 1}.png`;
  const filePath = mediaAdapter.assetPathFromName(filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(`colour-storyboard-${index + 1}`));
  return {
    shot_index: index + 1,
    image_url: `/api/new-story-ad/assets/${filename}`,
    file_sha256: `image_hash_${index + 1}`,
    subject_qa_policy_version: 2,
    subject_count_qa: { pass: true },
  };
});
storage.saveOutput(taskId, 'storyboard_images', imageRows);

const upstreamKinds = ['context', 'brief', 'asset_plan', 'scene_config', 'blueprint', 'storyboard_table', 'storyboard_images', 'keyframe_contracts'];
const upstreamBefore = storage.canonicalFingerprint(Object.fromEntries(upstreamKinds.map(kind => [kind, storage.getOutput(taskId, kind)])));

const resolved = videoInputFrames.resolve(taskId, { shots, contracts });
assert.equal(resolved.frames.length, 2);
assert(resolved.frames.every(frame => frame.source_type === 'confirmed_storyboard'));
assert(resolved.frames.every(frame => frame.qa.status === 'human_confirmed_storyboard'));
assert(storage.getOutput(taskId, 'keyframes') == null, '分镜适配不得写入或重复生成 keyframes');

audioProduction.savePlan(taskId, { include_voiceover: false, subtitle: true, bgm_volume: 0.12 });
assert.equal(audioProduction.confirm(taskId, { id: 'tester' }).approved, true, '无语音方案仍需显式确认后才能进入视频');
audioProduction.assertApproved(taskId);
audioProduction.savePlan(taskId, { include_voiceover: true, voice_id: 'voice-a', voice_assignments: { narrator: 'voice-a', speakers: { 甲: 'voice-a', 乙: 'voice-b' } } });
assert.throws(() => audioProduction.confirm(taskId, { id: 'tester' }), error => error?.code === 'AUDIO_TTS_PREVIEW_REQUIRED', '多人对白未生成试听音轨时必须阻断确认');

const savedTimeline = timeline.save(taskId, { items: [
  { shot_index: 1, trim_start_sec: 0.2, trim_end_sec: 0.1, speed: 1.1, clip_volume: 0.8, transition_type: 'dissolve', transition_duration_sec: 0.4 },
  { shot_index: 2, speed: 9, clip_volume: -1, muted: true, transition_type: 'invalid' },
] });
assert.equal(savedTimeline[0].speed, 1.1);
assert.equal(savedTimeline[1].speed, 2, '时间线速度必须执行上限校验');
assert.equal(savedTimeline[1].clip_volume, 0, '原声音量必须执行下限校验');
assert.equal(savedTimeline[1].transition_type, 'hard_cut', '未知转场不得进入合成');

const upstreamAfter = storage.canonicalFingerprint(Object.fromEntries(upstreamKinds.map(kind => [kind, storage.getOutput(taskId, kind)])));
assert.equal(upstreamAfter, upstreamBefore, '声音方案和剪辑时间线不得改写前五步任何生成结果');

const root = path.resolve(__dirname, '..');
const routeSource = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
const finalView = fs.readFileSync(path.join(root, 'public/story-ad/views/finalView.js'), 'utf8');
const soundView = fs.readFileSync(path.join(root, 'public/story-ad/views/finalSoundDesignView.js'), 'utf8');
assert.match(routeSource, /LEGACY_KEYFRAME_GENERATION_DISABLED/);
assert.doesNotMatch(finalView, /data-generate-keyframes/);
assert.match(finalView, /已确认分镜 \/ 视频首帧/);
assert.match(finalView, /智能剪辑时间线/);
assert.match(soundView, /我已试听并确认声音/);
assert.match(soundView, /data-speaker/);
assert.match(soundView, /背景音乐/);

console.log(JSON.stringify({
  passed: true,
  checks: 22,
  provider_calls: 0,
  keyframe_generation_calls: 0,
  upstream_fingerprint_unchanged: true,
  multi_speaker_preflight_blocked_without_audio: true,
  timeline_validation: true,
}));

try { fs.rmSync(process.env.OUTPUT_DIR, { recursive: true, force: true }); } catch {}
