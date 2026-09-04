'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-motion-edit-v431-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';
const service = require('../src/services/newStoryAd/blueprintMotionEditService');

const beat = (index, extra = {}) => ({
  shot_id: `shot-${index}`, title: `镜头 ${index}`, scene: '展厅', visual: '人物位于展厅入口',
  action: '人物静立', camera_movement: '固定镜头', spoken_line: '旁白', duration: 8,
  ...extra,
});
const blueprint = { story_title: '测试', logline: '测试', characters: [{ id: 'p1', name: '人物' }], beats: [beat(1), beat(2)], revision: 2, fingerprint: 'old' };

const motion = { ...blueprint, revision: 3, fingerprint: 'new', beats: [beat(1, { action: '人物缓慢前行', camera_movement: '同速跟随' }), beat(2)] };
assert.deepStrictEqual(service.plan(blueprint, motion), { eligible: true, changed_indexes: [0], reason: 'motion_only' });

const visual = { ...motion, beats: [beat(1, { visual: '人物已经站在墙前', action: '人物缓慢前行', camera_movement: '同速跟随' }), beat(2)] };
assert.strictEqual(service.plan(blueprint, visual).eligible, false, '静态画面变化不得复用旧首帧');

const speech = { ...motion, beats: [beat(1, { action: '人物缓慢前行', camera_movement: '同速跟随', spoken_line: '新旁白' }), beat(2)] };
assert.strictEqual(service.plan(blueprint, speech).eligible, false, '台词变化不得复用旧配音');

const patched = service.patchStoryboard([{ shot_id: 'shot-1', action: '旧动作', camera_movement: '旧运镜' }, { shot_id: 'shot-2', action: '不变' }], motion, [0]);
assert.strictEqual(patched[0].action, '人物缓慢前行');
assert.strictEqual(patched[0].camera_movement, '同速跟随');
assert.strictEqual(patched[1].action, '不变');

const rebased = service.rebaseImages([{ shot_index: 1, image_url: '/one.png', source_content_revision: 2 }, { shot_index: 2, image_url: '/two.png', source_content_revision: 2 }], patched, 3, [0]);
assert.strictEqual(rebased[0].source_content_revision, 3);
assert.strictEqual(rebased[0].motion_only_rebased, true);
assert.ok(rebased[0].shot_contract_fingerprint);
assert.strictEqual(rebased[1].source_content_revision, 3);
assert.strictEqual(rebased[1].motion_only_rebased, undefined);

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const owner = { id: 'motion-edit-owner' };
const task = storyAd.createTask({ brief: '验证只改动作与运镜', cast_mode: 'no_human', content_mode: 'narrative_story', content_mode_source: 'user' }, owner).task;
const saved = storyAd.updateBlueprint(task.id, blueprint, owner);
const storedShots = saved.beats.map((item, index) => ({ ...item, index: index + 1, shot_index: index + 1, visual: item.visual || item.plot, action: item.action, camera_movement: item.camera_movement }));
storage.saveOutput(task.id, 'storyboard_table', storedShots);
storage.saveOutput(task.id, 'storyboard_images', storedShots.map((item, index) => ({ shot_index: index + 1, image_url: `/shot-${index + 1}.png`, source_content_revision: storage.getTask(task.id).content_revision })));
storage.saveOutput(task.id, 'tts_audio', { tracks: [{ shot_id: 'shot-1', text: '旁白', audio_url: '/one.mp3' }] });
storage.saveOutput(task.id, 'video_clips', [{ video_url: '/old.mp4' }, null]);
const next = { ...saved, beats: saved.beats.map((item, index) => index ? item : { ...item, action: '人物缓慢前行', camera_movement: '同速跟随' }) };
storyAd.updateBlueprint(task.id, next, owner);
const currentRevision = storage.getTask(task.id).content_revision;
assert.strictEqual(storage.getOutput(task.id, 'storyboard_table')[0].action, '人物缓慢前行');
assert.strictEqual(storage.getOutput(task.id, 'storyboard_images').length, 2);
assert.strictEqual(storage.getOutput(task.id, 'storyboard_images')[0].source_content_revision, currentRevision);
assert.ok(storage.getOutput(task.id, 'tts_audio'));
assert.strictEqual(storage.getOutput(task.id, 'video_clips'), null);
assert.strictEqual(storage.getTask(task.id).stage, 'keyframes_ready');
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('story-ad motion-only blueprint edit v431: 18 checks passed');
