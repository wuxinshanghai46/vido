const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'story-ad-regeneration-assignment-v2');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const people = require('../src/services/newStoryAd/personAssetLifecycleService');
const sceneWorlds = require('../src/services/storyAdWorkspace/sceneWorldService');

const taskId = 'regeneration-assignment-v2';
storage.createTask({
  id: taskId,
  title: '通用场景版本回归',
  brief: '一个人物在一个场景中完成广告动作',
  request: {},
  content_revision: 1,
  status: 'draft',
});
storage.saveOutput(taskId, 'context', {
  revisions: { person: 4 },
  cast_profiles: [{ id: 'stable-person-1', displayName: '苏晚', roleName: '美学策展人' }],
});
storage.saveOutput(taskId, 'blueprint', { story_title: '保留的剧情蓝图' });
storage.saveOutput(taskId, 'storyboard_table', [{ scene_id: 'gallery', characters: ['苏晚'], action: '观察墙面材质' }]);
storage.saveOutput(taskId, 'storyboard_meta', { status: 'ready' });
storage.saveOutput(taskId, 'tts_audio', [{ url: '/voice.mp3' }]);
storage.saveOutput(taskId, 'keyframes', [{ image_url: '/old-person.png' }]);
storage.saveOutput(taskId, 'final_video', { video_url: '/old-person.mp4' });

const committed = people.commitGeneratedSubjectAssets(taskId, {
  counts: { mode: 'single' },
  cast_assets: [{
    id: 'new-provider-asset',
    actor_id: 'new-provider-actor',
    actor_asset_id: 'new-provider-asset',
    name: '苏晚',
    image_url: '/new-person.png',
    subject_profile: { displayName: '苏晚', roleName: '美学策展人' },
    view_images: [{ key: 'front', image_url: '/front.png' }],
  }],
  pet_profiles: [],
}, {}, { change_kind: 'visual_dossier' });

assert.equal(committed.visual_refresh.change_scope, 'person_visual');
assert.equal(committed.cast_profiles[0].id, 'stable-person-1', 'provider asset replacement must not replace the stable character id');
assert(storage.getOutput(taskId, 'blueprint'), 'visual dossier refresh must preserve blueprint');
assert.equal(storage.getOutput(taskId, 'storyboard_table').length, 1, 'visual dossier refresh must preserve text storyboard');
assert(storage.getOutput(taskId, 'storyboard_meta'), 'visual dossier refresh must preserve storyboard metadata');
assert(storage.getOutput(taskId, 'tts_audio'), 'visual dossier refresh must preserve voice');
assert.equal(storage.getOutput(taskId, 'keyframes'), null, 'visual output containing old person must be invalidated');
assert.equal(storage.getOutput(taskId, 'final_video'), null, 'final video containing old person must be invalidated');

storage.deleteOutput(taskId, 'storyboard_table');
storage.saveArtifact(taskId, 'storyboard_table', [
  { scene_id: 'gallery', characters: ['苏晚'], action: '观察墙面材质' },
  { scene_id: 'gallery', characters: ['苏晚'], action: '走向展台' },
], { qa_status: 'published', content_revision: 1, snapshot_id: 'published-history' });

const bundle = {
  project: { id: taskId },
  revisions: { content: 1 },
  assets: {
    people: [{ id: 'stable-person-1', subject_id: 'stable-person-1', name: '苏晚', profile: { id: 'stable-person-1', displayName: '苏晚' } }],
    animals: [], products: [],
    scenes: [{ id: 'gallery', name: '光影艺廊', description: '开放展览空间', view_images: [{ key: 'master', image_url: '/gallery.png' }] }],
  },
  storyboard: { shots: [] },
};
const recovered = sceneWorlds.resolve(taskId, bundle);
const recoveredCell = recovered.manifest.character_world_matrix[0].cells[0];
assert.equal(recoveredCell.presence, 'confirmed');
assert.equal(recoveredCell.shot_count, 2);
assert.equal(recoveredCell.source, 'published_history');
assert.match(recoveredCell.reason, /历史已发布故事板/);
assert.equal(recovered.worlds[0].experience.current_mode, 'photo_views');
assert.deepEqual(recovered.worlds[0].experience.requirements.panorama_360, ['至少一个 2:1 等距柱状全景观察点']);

const saved = sceneWorlds.saveAssignments(taskId, [{
  character_id: 'stable-person-1', world_id: 'gallery', presence: 'excluded', role: '本场景不出场',
}], { expected_revision: 1, content_revision: 1 });
assert.equal(saved.assignment_revision, 2);
const manual = sceneWorlds.resolve(taskId, bundle).manifest.character_world_matrix[0].cells[0];
assert.equal(manual.presence, 'excluded', 'manual assignment must override current or historical storyboard projection');
assert.equal(manual.source, 'manual');
const longId = `person-${'x'.repeat(180)}`;
const maxLengthSave = sceneWorlds.saveAssignments(taskId, [{
  character_id: longId, world_id: 'gallery', presence: 'confirmed', role: '最大长度人物 ID 回归',
}], { expected_revision: 2, content_revision: 1 });
assert.equal(maxLengthSave.assignments[0].character_id.length, 120, 'persisted assignment ids must stay within the contract maximum');
assert.throws(() => sceneWorlds.saveAssignments(taskId, [], {
  expected_revision: 2, content_revision: 1,
}), error => error?.code === 'SCENE_WORLD_ASSIGNMENT_CONFLICT' && error?.status === 409, 'concurrent stale assignment writes must be rejected');

const ui = fs.readFileSync(path.join(root, 'public/story-ad/components/ui.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/story-ad/app.js'), 'utf8');
const sceneUi = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldView.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
assert(ui.includes('data-hover-video-preview'));
assert(ui.includes('pointerenter'));
assert(app.includes('bindHoverVideoPreviews(host)'));
assert(sceneUi.includes('选择360 / 3D模式'));
assert(sceneUi.includes('data-enter-scene-world'));
assert(!sceneUi.includes('打开3D导演预演（免供应商）'));
assert(sceneUi.includes('data-save-world-assignments'));
assert(server.includes("app.get('/js/new-story-ad-legacy-ui.js'"));
assert(server.includes('no-store, no-cache, must-revalidate, private'));

console.log(JSON.stringify({
  success: true,
  preserved_story_outputs: 4,
  invalidated_visual_outputs: committed.invalidated_outputs.length,
  historical_shots_recovered: recoveredCell.shot_count,
  stable_character_id: committed.cast_profiles[0].id,
  assignment_revision: maxLengthSave.assignment_revision,
  max_id_length: maxLengthSave.assignments[0].character_id.length,
  stale_concurrent_write_rejected: true,
  hover_video_preview: true,
  legacy_runtime_disabled: true,
}, null, 2));

fs.rmSync(outputDir, { recursive: true, force: true });
