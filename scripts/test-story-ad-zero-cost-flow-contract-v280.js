#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.OUTPUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-flow-v280-'));
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const flow = require('../src/services/storyAdWorkspace/storyFlowContractService');
const legacyFlow = require('../src/services/storyAdWorkspace/storyFlowSketchService');
const imageGate = require('../src/services/storyAdWorkspace/storyboardImageConfirmationGateService');
const storyboardImages = require('../src/services/storyAdWorkspace/storyboardSketchService');
const storyboard = require('../src/services/newStoryAd/storyboardTableService');
const sound = require('../src/services/newStoryAd/soundDesignAssetService');
const stageProgress = require('../src/services/newStoryAd/stageProgressService');
const pipeline = require('../src/services/pipelineModelService');
const axios = require('axios');

const owner = { id: 'v280-owner', role: 'user' };
const taskId = 'story-flow-v280';
const created = storyAd.createTask({
  task_id: taskId, content_mode: 'narrative_story', content_mode_source: 'user', project_name: 'V280',
  brief: '陈默进入展厅查看材料并离开。', cast_mode: 'single', scene_mode: 'multi', client_edit_seq: 1,
}, owner);
const blueprint = {
  story_title: '展厅路线', logline: '陈默依次查看展厅与展台。', revision: 1,
  beats: [
    { beat_id: 'beat_entry', beat_index: 1, title: '进入展厅', plot: '陈默进入现代高端家居展示厅。', action: '陈默走入并观察', state_before: '在门外', state_after: '到达展厅中央' },
    { beat_id: 'beat_material', beat_index: 2, title: '查看材料', plot: '陈默来到高端商业展台查看金属材料。', action: '陈默触摸样板', state_before: '手未接触样板', state_after: '确认材料质感' },
  ],
};
blueprint.fingerprint = storage.canonicalFingerprint(blueprint);
const context = {
  ...(storage.getOutput(taskId, 'context') || created.context || {}),
  scene_setup_confirmed: true,
  cast_profiles: [{ id: 'character_chenmo', name: '陈默', revision: 3, voice_id: 'voice_chenmo', look_profiles: [{ id: 'look_business', name: '商务造型' }] }],
};
const scenes = [
  { scene_id: 'scene_showroom', name: '现代高端家居展示厅', scene_revision: 5, view_images: [{ key: 'master', image_url: '/fixtures/showroom.png' }] },
  { scene_id: 'scene_exhibition', name: '高端商业展台', scene_revision: 2, view_images: [{ key: 'master', image_url: '/fixtures/exhibition.png' }] },
];
storage.saveOutput(taskId, 'blueprint', blueprint);
storage.saveOutput(taskId, 'context', context);
storage.saveOutput(taskId, 'scene_assets', scenes);
storage.saveOutput(taskId, 'scene_config', { spaces: [
  { id: 'scene_showroom', covered_beat_ids: ['beat_entry'] },
  { id: 'scene_exhibition', covered_beat_ids: ['beat_material'] },
] });
storage.updateTask(taskId, { request: context });

const protectedKinds = ['context', 'blueprint', 'scene_config', 'scene_assets'];
const before = Object.fromEntries(protectedKinds.map(kind => [kind, storage.canonicalFingerprint(storage.getOutput(taskId, kind))]));
const draft = flow.draft(taskId);
assert.equal(draft.model_call_count, 0);
assert.equal(draft.units.length, 2);
assert.deepEqual(draft.units.map(unit => unit.scene_id), ['scene_showroom', 'scene_exhibition']);
assert(draft.units.every(unit => unit.character_ids[0] === 'character_chenmo'));
assert(!JSON.stringify(draft).includes('image_model'));
assert(!JSON.stringify(draft.units).includes('image_url'));
assert.throws(() => legacyFlow.startBatch(taskId), error => error.code === 'LEGACY_STORY_FLOW_SKETCH_ROUTE_DISABLED' && error.status === 410);
assert(!pipeline.NEW_STORY_AD_IMAGE_STAGE_IDS.has('new_story_ad.story_flow_sketch'));

const confirmed = flow.confirm(taskId, draft.units, owner);
assert.equal(confirmed.model_call_count, 0);
assert.equal(confirmed.gate.ready, true);
assert.equal(confirmed.contract.status, 'confirmed');
assert.deepEqual(Object.fromEntries(protectedKinds.map(kind => [kind, storage.canonicalFingerprint(storage.getOutput(taskId, kind))])), before);
const repeat = flow.confirm(taskId, draft.units, owner);
assert.equal(repeat.downstream_invalidated, false, '重复确认必须幂等');

const ctx = { ...context, scene_assets: scenes, target_duration: 12, shot_count: 4, story_flow_contract: confirmed.contract };
const planned = storyboard.plannedBeats(blueprint, ctx);
assert(planned.length >= blueprint.beats.length);
assert(planned.every(beat => beat.flow_scene_id && beat.flow_character_ids?.[0] === 'character_chenmo'));
const aligned = storyboard.alignShotsToBeats(planned.map((beat, index) => ({ index: index + 1, title: `镜头 ${index + 1}`, characters: [{ name: '陌生男性' }], scene_id: 'invented_scene' })), planned);
assert(aligned.every(shot => shot.scene_id !== 'invented_scene'));
assert(aligned.every(shot => shot.characters.every(person => person.name === '陈默')));
assert(aligned.every(shot => shot.source_beat_id && shot.shot_id));

storage.saveOutput(taskId, 'storyboard_table', aligned);
assert.equal(imageGate.inspect(taskId).ready, false);
storage.saveOutput(taskId, 'storyboard_images', storyboardImages.normalizeSketches(taskId,
  aligned.map((shot, index) => ({
    shot_index: index + 1, status: 'confirmed', image_url: `/storyboard-${index + 1}.png`,
    subject_qa_policy_version: 2, subject_count_qa: { pass: true },
  }))));
assert.equal(imageGate.inspect(taskId).ready, true);
const changedShots = aligned.map((shot, index) => index ? shot : { ...shot, camera_angle: 'low_angle' });
storage.saveOutput(taskId, 'storyboard_table', changedShots);
assert.deepEqual(imageGate.inspect(taskId).stale_indexes, [1], '镜头合同变化后不得复用旧分镜图');
storage.saveOutput(taskId, 'storyboard_table', aligned);

const audioPath = path.join(process.env.OUTPUT_DIR, 'owned.wav');
fs.writeFileSync(audioPath, Buffer.from('RIFF-owned-audio-fixture'));
const added = sound.addUserAsset(taskId, {
  shot_index: 1, track_type: 'ambient',
  asset: { id: 'owned-audio', name: '自有展厅底噪', filename: 'owned.wav', file_path: audioPath, mimetype: 'audio/wav' },
}, owner);
assert.equal(added.ledger.license, 'USER_OWNED');
assert.equal(added.ledger.redistributable, false);
assert.equal(added.ledger.file_sha256.length, 64);
assert.equal(sound.resolvedTracks(taskId).length, 1);

stageProgress.update(taskId, { stage: 'storyboard', generationId: 'old-generation', startedAt: '2020-01-01T00:00:00.000Z', status: 'failed' });
const fresh = stageProgress.update(taskId, { stage: 'storyboard', generationId: 'fresh-generation', status: 'running' });
assert.notEqual(fresh.started_at, '2020-01-01T00:00:00.000Z', '新批次不得继承历史耗时');

const originalAxiosGet = axios.get;
axios.get = async url => String(url).endsWith('/v1/audio/')
  ? { data: { results: [{ id: 'open-audio-1', title: 'Showroom ambience', creator: 'CC Artist', license: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/', foreign_landing_url: 'https://freesound.org/s/1', url: 'https://cdn.freesound.org/previews/1/1.mp3', duration: 4 }] } }
  : (String(url).includes('/v1/audio/open-audio-1/')
    ? { data: { id: 'open-audio-1', title: 'Showroom ambience', creator: 'CC Artist', license: 'by', license_url: 'https://creativecommons.org/licenses/by/4.0/', foreign_landing_url: 'https://freesound.org/s/1', url: 'https://cdn.freesound.org/previews/1/1.mp3', duration: 4 } }
    : { data: Buffer.alloc(1600, 1), headers: { 'content-type': 'audio/mpeg' } });

(async () => {
  const library = await sound.searchOpenverse('showroom ambience');
  assert.equal(library.results.length, 1);
  const imported = await sound.importOpenverseAsset(taskId, { openverse_id: 'open-audio-1', shot_index: 1, track_type: 'room_tone' });
  assert.equal(imported.ledger.requires_attribution, true);
  assert.equal(imported.ledger.file_sha256.length, 64);
  assert(sound.attributionManifest(taskId).some(item => item.asset_id === imported.asset.asset_id));
  console.log(JSON.stringify({ passed: true, checks: 36, model_calls: 0, paid_calls: 0, protected_upstream_hashes_unchanged: true, old_flow_disabled: true, storyboard_authority_enforced: true, storyboard_image_gate: true, user_audio_ledger: true, openverse_license_ledger: true, fresh_progress_clock: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { axios.get = originalAxiosGet; });
