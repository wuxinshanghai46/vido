#!/usr/bin/env node

const storage = require('../src/services/newStoryAd/storageService');
const subjectProfileText = require('../src/services/newStoryAd/subjectProfileTextService');
const sceneCheckpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');

const taskId = String(process.argv[2] || '').trim();
if (!taskId) throw new Error('Usage: node scripts/repair-new-story-ad-subject-scene-recovery.js <task-id>');

const task = storage.getTask(taskId);
if (!task) throw new Error(`Task not found: ${taskId}`);

const context = storage.getOutput(taskId, 'context') || task.request || {};
const castProfiles = (Array.isArray(context.cast_profiles) ? context.cast_profiles : [])
  .map(profile => subjectProfileText.canonicalProfile(profile));
const personAsset = context.person_asset && typeof context.person_asset === 'object'
  ? {
      ...context.person_asset,
      cast_assets: (Array.isArray(context.person_asset.cast_assets) ? context.person_asset.cast_assets : [])
        .map(asset => ({
          ...asset,
          subject_profile: subjectProfileText.canonicalProfile({
            ...(asset.subject_profile && typeof asset.subject_profile === 'object' ? asset.subject_profile : {}),
            person_contract: asset.person_contract || asset.subject_profile?.person_contract || null,
          }),
        })),
    }
  : null;
const repairedContext = {
  ...context,
  cast_profiles: castProfiles,
  ...(personAsset ? { person_asset: personAsset } : {}),
};

storage.saveOutput(taskId, 'context', repairedContext);
if (storage.getOutput(taskId, 'cast_profiles') || castProfiles.length) {
  storage.saveOutput(taskId, 'cast_profiles', castProfiles);
}
if (personAsset && storage.getOutput(taskId, 'person_asset')) {
  storage.saveOutput(taskId, 'person_asset', personAsset);
}

const cancellationError = Object.assign(new Error('用户取消了误触发的场景生成'), {
  code: 'USER_CANCELLED',
  cancelled: true,
});
let repairedCheckpoints = 0;
for (const row of storage.listOutputs(taskId)) {
  if (!String(row.kind || '').startsWith('scene_asset_checkpoint:')) continue;
  const checkpoint = row.payload && typeof row.payload === 'object' ? row.payload : {};
  if (checkpoint.status !== 'running') continue;
  sceneCheckpoint.markCancelled(checkpoint, '', cancellationError);
  repairedCheckpoints += 1;
}

storage.updateTask(taskId, {
  request: repairedContext,
  status: 'working',
  stage: 'scene_config',
  error: '',
  error_code: '',
  retryable: false,
  generation_progress: null,
  updated_at: new Date().toISOString(),
});

const verifiedProfiles = castProfiles.filter(profile => (
  profile.appearanceText
  && profile.wardrobeText
  && profile.hairMakeupText
  && profile.appearanceText !== '[object Object]'
)).length;
console.log(JSON.stringify({
  task_id: taskId,
  cast_profiles: castProfiles.length,
  complete_cast_profiles: verifiedProfiles,
  repaired_checkpoints: repairedCheckpoints,
  task_status: storage.getTask(taskId)?.status,
  task_stage: storage.getTask(taskId)?.stage,
}));
