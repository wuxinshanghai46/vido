'use strict';

const releaseBundle = require('../storyAdReleaseBundleService');

function clean(value = '') { return String(value || '').trim(); }

function legacyTask(task = {}) {
  const state = clean(task.planning_migration_state).toLowerCase();
  return task.legacy_planning_read_only === true
    || state === 'migration_required'
    || state === 'replan_required'
    || state.startsWith('legacy_');
}

function envelope(task = {}, extra = {}) {
  return releaseBundle.envelope({
    content_revision: Number(task.content_revision || 1) || 1,
    ...extra,
  });
}

function checkpointFields(task = {}, extra = {}) {
  return {
    content_revision: Number(task.content_revision || 1) || 1,
    release_envelope: envelope(task),
    ...extra,
  };
}

function compatibility(task = {}, checkpoint = null, options = {}) {
  const issues = [];
  const currentBundleId = releaseBundle.identity().bundle_id;
  const expectedRevision = Number(task.content_revision || 1) || 1;
  if (!checkpoint || typeof checkpoint !== 'object') issues.push('checkpoint_missing');
  if (legacyTask(task)) issues.push('task_legacy_planning_read_only');
  if (clean(checkpoint?.release_envelope?.producer_bundle_id) !== currentBundleId) issues.push('checkpoint_bundle_mismatch');
  if (Number(checkpoint?.content_revision || 0) !== expectedRevision) issues.push('checkpoint_content_revision_mismatch');
  if (options.fingerprint !== undefined
    && clean(checkpoint?.fingerprint) !== clean(options.fingerprint)) issues.push('checkpoint_input_fingerprint_mismatch');
  if (options.contentMode !== undefined
    && clean(checkpoint?.content_mode) !== clean(options.contentMode)) issues.push('checkpoint_content_mode_mismatch');
  if (options.requireReusable === true && checkpoint?.reusable !== true) issues.push('checkpoint_not_reusable');
  return { reusable: issues.length === 0, issues: [...new Set(issues)], current_bundle_id: currentBundleId };
}

function currentPlanningTaskPatch() {
  return {
    planning_migration_state: 'current_bundle',
    planning_migration_id: '',
    legacy_planning_read_only: false,
    required_bundle_id: releaseBundle.identity().bundle_id,
  };
}

// A scene-plan run is a fresh, explicitly queued planning transaction. Bind
// the task to that transaction's release before the first checkpoint CAS; the
// stricter job release/snapshot/revision guards still reject stale workers.
// Do not clear legacy planning flags here: those are only cleared after a
// complete plan has been persisted by currentPlanningTaskPatch().
function queuedPlanningTaskPatch(stage = '', bundleId = '') {
  if (!['scene_config', 'scene_plan'].includes(clean(stage))) return {};
  const currentBundleId = releaseBundle.identity().bundle_id;
  if (clean(bundleId) !== currentBundleId) return {};
  return { required_bundle_id: currentBundleId };
}

module.exports = {
  legacyTask,
  envelope,
  checkpointFields,
  compatibility,
  currentPlanningTaskPatch,
  queuedPlanningTaskPatch,
};
