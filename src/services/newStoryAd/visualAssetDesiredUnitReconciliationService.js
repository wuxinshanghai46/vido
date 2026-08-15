const storageDefault = require('./storageService');
const authorizationDefault = require('./visualAssetBillingAuthorizationService');
const checkpoints = require('./assetGenerationCheckpointService');
const reviewStates = require('./visualAssetBillingReviewStateService');
const compositesDefault = require('./dossierCompositeService');

function desiredWearableUnits(profile = {}, composites = compositesDefault) {
  return composites.desiredWearableUnits(profile);
}

function profilesByOwner(profiles = []) {
  const byId = new Map();
  profiles.forEach((profile, index) => {
    [profile?.id, profile?.subject_id, profile?.asset_id].filter(Boolean)
      .forEach(id => byId.set(String(id), profile));
    byId.set(`index:${index}`, profile);
  });
  return byId;
}

function reconcileCheckpointMap({
  checkpoints: source = {}, owners = {}, profiles = [], subjectIds = [], resolutions = {}, expectedRevisions = {}, at = new Date().toISOString(),
} = {}, deps = {}) {
  const composites = deps.composites || compositesDefault;
  const next = { ...source }, obsoleteKeys = [], blockedKeys = [];
  const profileMap = profilesByOwner(profiles);
  const subjectFilter = new Set(subjectIds.map(String).filter(Boolean));
  for (const [key, raw] of Object.entries(source || {})) {
    const checkpoint = checkpoints.normalizeCheckpoint(raw, { key });
    if (checkpoints.isObsolete(checkpoint) || !checkpoint.unit.startsWith('wearable_accessory:')) continue;
    const owner = owners[key] || {};
    if (subjectFilter.size && !subjectFilter.has(String(owner.subject_id || ''))) continue;
    const profile = owner.subject_id
      ? profileMap.get(String(owner.subject_id))
      : profileMap.get(`index:${Number(owner.index || 0)}`);
    if (!profile || desiredWearableUnits(profile, composites).has(checkpoint.unit)) continue;
    let resolved = checkpoint;
    const resolution = resolutions[key];
    const expected = Number(expectedRevisions[key] || resolution?.expected_revision || resolution?.expectedRevision || 0);
    if (expected && expected !== reviewStates.reviewRevision(checkpoint)) {
      const error = new Error('核账版本已变化，未写入任何单元。');
      error.code = 'VISUAL_ASSET_DESIRED_UNIT_REVISION_CONFLICT'; error.status = 409; throw error;
    }
    const safelyNotBilled = checkpoint.billing_state === 'not_billed'
      || ['rejected', 'submission_rejected'].includes(checkpoint.provider_submission_state)
      || reviewStates.reviewState(checkpoint) === reviewStates.STATES.NOT_BILLED;
    if (!safelyNotBilled) {
      if (!resolution) { blockedKeys.push(key); continue; }
      if (String(resolution.state || '').toLowerCase() !== reviewStates.STATES.NOT_BILLED) {
        blockedKeys.push(key); continue;
      }
      resolved = reviewStates.resolve(checkpoint, { ...resolution, state: reviewStates.STATES.NOT_BILLED, expected_revision: expected });
    }
    next[key] = {
      ...raw,
      ...resolved,
      status: 'cancelled',
      lifecycle_state: 'obsolete',
      obsolete: true,
      obsolete_at: at,
      obsolete_reason: 'compiler_desired_unit_removed',
      obsolete_from_status: String(raw?.status || checkpoint.status),
      updated_at: at,
    };
    obsoleteKeys.push(key);
  }
  return {
    changed: obsoleteKeys.length > 0,
    checkpoints: next,
    obsolete_keys: obsoleteKeys,
    blocked_keys: blockedKeys,
  };
}

function taskProfiles(storage, taskId) {
  const context = storage.getOutput(taskId, 'context') || {};
  const task = storage.getTask(taskId) || {};
  return Array.isArray(context.cast_profiles) ? context.cast_profiles
    : (Array.isArray(task.request?.cast_profiles) ? task.request.cast_profiles : []);
}

function reconcileTask(input = {}, deps = {}) {
  const storage = deps.storage || storageDefault;
  const authorization = deps.authorization || authorizationDefault;
  const taskId = String(input.taskId || input.task_id || '');
  const task = storage.getTask(taskId);
  if (!task) { const error = new Error('任务不存在。'); error.code = 'TASK_NOT_FOUND'; error.status = 404; throw error; }
  if (String(task.active_generation_id || '')) {
    const error = new Error('当前任务仍在运行，不能迁移恢复单元。');
    error.code = 'VISUAL_ASSET_DESIRED_UNIT_ACTIVE_TASK'; error.status = 409; throw error;
  }
  const row = authorization.subjectCheckpointRows(taskId)[0];
  if (!row) return { applied: false, dry_run: input.apply !== true, task_id: taskId, obsolete_keys: [], blocked_keys: [] };
  const plan = reconcileCheckpointMap({
    checkpoints: row.payload?.person_dossier_checkpoints || {},
    owners: row.payload?.subject_checkpoint_owners || {},
    profiles: taskProfiles(storage, taskId),
    resolutions: input.resolutions || {},
    expectedRevisions: input.expectedRevisions || input.expected_review_revisions || {},
    at: input.at,
  }, deps);
  if (input.apply !== true || !plan.changed) return {
    applied: false, dry_run: input.apply !== true, task_id: taskId,
    obsolete_keys: plan.obsolete_keys, blocked_keys: plan.blocked_keys,
  };
  let reconciledOuter = [];
  storage.withWriteBatch(() => {
    storage.saveOutput(taskId, row.kind, {
      ...row.payload, person_dossier_checkpoints: plan.checkpoints, updated_at: input.at || new Date().toISOString(),
    });
    reconciledOuter = authorization.reconcileNestedOrchestrator(taskId, plan.obsolete_keys);
  });
  return {
    applied: true, dry_run: false, task_id: taskId,
    obsolete_keys: plan.obsolete_keys, blocked_keys: plan.blocked_keys,
    reconciled_outer_ids: reconciledOuter.map(item => item.id),
  };
}

module.exports = { desiredWearableUnits, reconcileCheckpointMap, reconcileTask };
