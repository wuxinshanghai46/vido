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
const task = storyAd.createTask({ brief: '验证展厅入口广告只改动作与运镜', product_subject: '展厅入口', cast_mode: 'no_human', content_mode: 'commercial_subject', content_mode_source: 'user' }, owner).task;
const saved = storyAd.updateBlueprint(task.id, blueprint, owner);
const storedShots = saved.beats.map((item, index) => ({ ...item, index: index + 1, shot_index: index + 1, visual: item.visual || item.plot, action: item.action, camera_movement: item.camera_movement }));
storage.saveOutput(task.id, 'storyboard_table', storedShots);
storage.saveOutput(task.id, 'storyboard_images', storedShots.map((item, index) => ({ shot_index: index + 1, image_url: `/shot-${index + 1}.png`, source_content_revision: storage.getTask(task.id).content_revision })));
storage.saveOutput(task.id, 'tts_audio', { tracks: [{ shot_id: 'shot-1', text: '旁白', audio_url: '/one.mp3' }] });
storage.saveOutput(task.id, 'video_clips', [{ video_url: '/old.mp4' }, null]);
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const publication = require('../src/services/newStoryAd/assetPlanPublicationService');
const generationPermit = require('../src/services/newStoryAd/generationPermitService');
const planFingerprint = assetPlan.fingerprint(storage.getTask(task.id), storage.getOutput(task.id, 'context'));
publication.publish(task.id, {
  cast_profiles: [], pet_profiles: [], prop_plan: [],
  scene_plan: { spaces: [{ id: 'scene-1', scene_id: 'scene-1', name: '展厅' }] },
}, { fingerprint: planFingerprint, source: 'motion-edit-regression', production_graph_authority: true });
const currentActive = publication.activeRecord(task.id);
const currentCandidate = storage.getOutput(task.id, publication.CANDIDATE_KIND);
const oldBundle = 'compatible-release-before-motion-edit';
const oldEnvelope = { ...currentActive.plan.release_envelope, producer_bundle_id: oldBundle, build_id: 'previous-build' };
const oldDomains = Object.fromEntries(['person', 'scene'].map(domain => [domain, {
  ...(currentActive.plan.domain_state?.[domain] || {}), bundle_id: oldBundle,
}]));
const oldPlan = { ...currentActive.plan, release_envelope: oldEnvelope, domain_state: oldDomains };
storage.saveOutput(task.id, publication.CANDIDATE_KIND, { ...currentCandidate, release_envelope: oldEnvelope, domain_state: oldDomains });
storage.saveOutput(task.id, publication.ACTIVE_KIND, { ...currentActive, release_envelope: oldEnvelope, domain_state: oldDomains, plan: oldPlan });
storage.saveOutput(task.id, 'asset_plan', oldPlan);
const next = { ...saved, beats: saved.beats.map((item, index) => index ? item : { ...item, action: '人物缓慢前行', camera_movement: '同速跟随' }) };
storyAd.updateBlueprint(task.id, next, owner);
const currentRevision = storage.getTask(task.id).content_revision;
assert.strictEqual(storage.getOutput(task.id, 'storyboard_table')[0].action, '人物缓慢前行');
assert.strictEqual(storage.getOutput(task.id, 'storyboard_images').length, 2);
assert.strictEqual(storage.getOutput(task.id, 'storyboard_images')[0].source_content_revision, currentRevision);
assert.ok(storage.getOutput(task.id, 'tts_audio'));
assert.strictEqual(storage.getOutput(task.id, 'video_clips'), null);
assert.strictEqual(storage.getTask(task.id).stage, 'keyframes_ready');
const activeAfterMotion = publication.activeRecord(task.id);
assert.strictEqual(activeAfterMotion.plan.content_revision, currentRevision);
assert.strictEqual(activeAfterMotion.plan.release_envelope.producer_bundle_id, require('../src/services/storyAdReleaseBundleService').identity().bundle_id);
assert.strictEqual(publication.eligibility(task.id, { fingerprint: activeAfterMotion.fingerprint }).eligible, true);
assert.ok(generationPermit.issue(task.id, 'video', { idempotencyKey: 'motion-edit-video-submit' }).permit_id);
const revisionBeforeBlockedEdit = storage.getTask(task.id).content_revision;
const contextBeforeBlockedEdit = storage.getOutput(task.id, 'context');
storage.saveOutput(task.id, 'context', { ...contextBeforeBlockedEdit, performance: { pacing: 'changed-without-plan-rebuild' } });
const blockedMotion = { ...next, beats: next.beats.map((item, index) => index ? item : { ...item, action: '人物再次前行' }) };
assert.throws(
  () => generationPermit.issue(task.id, 'video', { idempotencyKey: 'stale-plan-must-not-submit' }),
  error => error.code === 'GENERATION_ACTIVE_PLAN_REQUIRED',
  '付费生成许可必须按当前上下文重新计算指纹，不能信任 Active Plan 自报指纹',
);
assert.throws(
  () => storyAd.updateBlueprint(task.id, blockedMotion, owner),
  error => error.code === 'BLUEPRINT_ACTIVE_PLAN_REBASE_REQUIRED',
  'Active Plan 语义指纹不一致时必须在内容版本推进前停止保存',
);
assert.strictEqual(storage.getTask(task.id).content_revision, revisionBeforeBlockedEdit, '被拒绝的编辑不得推进内容版本');
assert.strictEqual(storage.getOutput(task.id, 'storyboard_images').length, 2, '被拒绝的编辑不得清空已确认首帧');
fs.rmSync(tempDir, { recursive: true, force: true });

console.log('story-ad motion-only blueprint edit v431: 26 checks passed');
