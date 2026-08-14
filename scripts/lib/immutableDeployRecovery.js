'use strict';

function text(value = '') { return String(value ?? '').trim(); }
function number(value = 0) { return Number(value || 0) || 0; }

function isExpectedActiveRelease(version = {}, expected = {}) {
  return text(version.release_bundle_id) === text(expected.release_bundle_id)
    && text(version.release_bundle?.artifact_id) === text(expected.artifact_id)
    && text(version.release_bundle?.source_revision) === text(expected.source_revision)
    && text(version.release_bundle?.source_tree) === text(expected.source_tree)
    && version.release_bundle?.remote_sync_verified === true
    && text(version.build_id) === text(expected.build_id);
}

function recoveryIssues(snapshot = {}, expected = {}) {
  const issues = [];
  if (!isExpectedActiveRelease(snapshot.version, expected)) issues.push('release_identity_mismatch');
  if (text(snapshot.health?.status) !== 'ok') issues.push('internal_health_failed');
  if (text(snapshot.public_health?.status) !== 'ok') issues.push('public_health_failed');
  if (text(snapshot.public_version?.release_bundle_id) !== text(expected.release_bundle_id)) issues.push('public_release_mismatch');
  if (snapshot.version?.release_control?.allowed !== true) issues.push('release_control_not_active');
  if (text(snapshot.sqlite_quick_check) !== 'ok') issues.push('sqlite_quick_check_failed');
  if (number(snapshot.readiness?.active_count)) issues.push('active_tasks_exist');
  if (number(snapshot.readiness?.active_unknown_billing_count
    ?? snapshot.readiness?.unknown_billing_count)) issues.push('active_unknown_billing_exists');
  return issues;
}

function confirmRecoveredRelease(snapshot = {}, expected = {}) {
  const issues = recoveryIssues(snapshot, expected);
  if (issues.length) {
    const error = new Error(`ALREADY_ACTIVE_RECOVERY_FAILED: ${issues.join(',')}`);
    error.code = 'ALREADY_ACTIVE_RECOVERY_FAILED';
    error.issues = issues;
    throw error;
  }
  const version = snapshot.version || {};
  return {
    recovered_receipt: true,
    build_id: version.build_id,
    release_bundle_id: version.release_bundle_id,
    artifact_id: expected.artifact_id,
    source_revision: version.release_bundle.source_revision,
    source_tree: version.release_bundle.source_tree,
    runtime_hash: version.runtime_hash,
    process_id: version.process_id,
    release_dir: snapshot.release_dir,
    health: snapshot.health.status,
    public_health: snapshot.public_health.status,
    sqlite_quick_check: text(snapshot.sqlite_quick_check),
    active_after: number(snapshot.readiness.active_count),
    active_unknown_billing_after: number(snapshot.readiness.active_unknown_billing_count
      ?? snapshot.readiness.unknown_billing_count),
  };
}

module.exports = { confirmRecoveredRelease, isExpectedActiveRelease, recoveryIssues };
