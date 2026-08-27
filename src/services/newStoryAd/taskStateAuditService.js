'use strict';

const storage = require('./storageService');

const RUNNING_STATES = new Set(['queued', 'submitting', 'submitted', 'accepted', 'polling', 'running', 'generating', 'retrying']);

function text(value = '') { return String(value ?? '').trim(); }
function rows(value) { return Array.isArray(value) ? value : []; }

function isUnknownBilling(call = {}) {
  return text(call.billing_state).toLowerCase() === 'unknown'
    && RUNNING_STATES.has(text(call.provider_submission_state || call.status).toLowerCase());
}

function checkpointBillingRows(outputs = [], taskId = '') {
  const normalizedTaskId = text(taskId);
  const found = [];
  const seen = new Set();
  const add = (key, value = {}, outputKind = '') => {
    const checkpointKey = text(key);
    if (!checkpointKey || seen.has(checkpointKey)) return;
    seen.add(checkpointKey);
    const billing = text(value.billing_state).toLowerCase();
    const submission = text(value.provider_submission_state || value.submission_state || value.status).toLowerCase();
    if (billing !== 'unknown' && submission !== 'submitted_unknown') return;
    found.push({
      id: `checkpoint:${checkpointKey}`,
      task_id: normalizedTaskId,
      stage: text(value.unit || value.asset_type || outputKind || 'visual_asset_checkpoint'),
      status: text(value.status || submission),
      provider_submission_state: submission,
      billing_state: 'unknown',
      provider_request_id: text(value.provider_request_id),
      provider_task_id: text(value.provider_task_id),
      provider_id: text(value.provider_id),
      model_id: text(value.model_id),
      provider_status: text(value.provider_status),
      provider_reason: text(value.provider_reason),
      provider_error_code: text(value.provider_error_code),
      platform_request_id: text(value.platform_request_id || value.submission_id || value.key || checkpointKey),
      submission_id: text(value.submission_id || value.key || checkpointKey),
      retry_authorized: value.retry_authorization?.accept_duplicate_charge_risk === true
        && Number(value.retry_authorization?.remaining_uses || 0) > 0,
      retry_authorization_key: text(value.retry_authorization?.checkpoint_key),
      source: 'generation_checkpoint',
      source_kind: outputKind,
      checkpoint_key: checkpointKey,
    });
  };
  rows(outputs).filter(output => text(output.task_id) === normalizedTaskId)
    .sort((left, right) => text(right.updated_at || right.payload?.updated_at)
      .localeCompare(text(left.updated_at || left.payload?.updated_at)))
    .forEach(output => {
      const kind = text(output.kind);
      const payload = output.payload || {};
      if (kind.startsWith('subject_asset_checkpoint:')) {
        Object.entries(payload.person_dossier_checkpoints || {})
          .forEach(([key, value]) => add(text(value?.key) || key, value, kind));
      } else if (kind.startsWith('prop_asset_checkpoint:')) {
        Object.entries(payload.units || {})
          .forEach(([key, value]) => add(text(value?.key) || key, value, kind));
      } else if (kind.startsWith('scene_asset_checkpoint:')) {
        Object.entries(payload.views || {})
          .forEach(([key, value]) => add(`${kind}#${key}`, value, kind));
      }
    });
  return found;
}

function sameBillingAttempt(call = {}, checkpoint = {}) {
  if (text(call.task_id) !== text(checkpoint.task_id)) return false;
  return Boolean(
    (text(call.submission_id) && text(call.submission_id) === text(checkpoint.submission_id))
    || (text(call.provider_task_id) && text(call.provider_task_id) === text(checkpoint.provider_task_id))
    || (text(call.provider_request_id) && text(call.provider_request_id) === text(checkpoint.provider_request_id)),
  );
}

function billingRiskForTask(db = {}, taskId = '') {
  const normalizedTaskId = text(taskId);
  const taskGenerations = rows(db.generation_runs)
    .filter(run => text(run.task_id || run.work_id) === normalizedTaskId);
  const unknownBillingUnits = taskGenerations.filter(run => text(run.state).toLowerCase() === 'billing_unknown'
    || text(run.billing_state).toLowerCase() === 'unknown');
  const modelUnknownBilling = rows(db.model_calls)
    .filter(call => text(call.task_id) === normalizedTaskId && text(call.billing_state).toLowerCase() === 'unknown');
  const allCheckpointUnknownBilling = checkpointBillingRows(db.outputs, normalizedTaskId);
  const checkpointUnknownBilling = allCheckpointUnknownBilling
    .filter(checkpoint => !modelUnknownBilling.some(call => sameBillingAttempt(call, checkpoint)));
  const allUnknownBilling = [
    ...modelUnknownBilling,
    ...checkpointUnknownBilling,
  ];
  const activeUnknownBilling = allUnknownBilling.filter(isUnknownBilling);
  const quarantinedCallIds = new Set(unknownBillingUnits.map(run => text(run.legacy_model_call_id)).filter(Boolean));
  const quarantinedCheckpointKeys = new Set(unknownBillingUnits.map(run => text(run.legacy_checkpoint_key)).filter(Boolean));
  const unquarantinedUnknownBilling = allUnknownBilling.filter(call => call.source === 'generation_checkpoint'
    ? !quarantinedCheckpointKeys.has(text(call.checkpoint_key))
      && !(call.retry_authorized === true && call.retry_authorization_key === text(call.checkpoint_key))
    : !quarantinedCallIds.has(text(call.id))
      && !allCheckpointUnknownBilling.some(checkpoint => checkpoint.retry_authorized === true
        && checkpoint.retry_authorization_key === text(checkpoint.checkpoint_key)
        && sameBillingAttempt(call, checkpoint)));
  return {
    all_unknown_billing: allUnknownBilling,
    active_unknown_billing: activeUnknownBilling,
    unknown_billing_units: unknownBillingUnits,
    unquarantined_unknown_billing: unquarantinedUnknownBilling,
  };
}

function semanticSceneKey(scene = {}) {
  return text(scene.semantic_key || scene.scene_semantic_key || scene.stable_id || scene.scene_id || scene.id).toLowerCase();
}

function sceneRows(outputRows = []) {
  const kinds = new Set(['scene_assets', 'scene_plan', 'asset_plan', 'context']);
  return rows(outputRows).flatMap(output => {
    if (!kinds.has(text(output.kind))) return [];
    const payload = output.payload || {};
    const candidates = [
      payload.scene_assets,
      payload.scenes,
      payload.scene_plan,
      Array.isArray(payload) ? payload : [],
    ];
    return candidates.find(Array.isArray) || [];
  });
}

function duplicateKeys(items = [], keyFn) {
  const counts = new Map();
  rows(items).forEach(item => {
    const key = keyFn(item);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function auditSnapshot(db = {}) {
  const tasks = rows(db.tasks);
  const outputs = rows(db.outputs);
  const manifests = rows(db.manifests);
  const artifacts = rows(db.artifacts);
  const modelCalls = rows(db.model_calls);
  const generations = rows(db.generation_runs);
  const works = rows(db.works);
  const workEvents = rows(db.work_events);
  const outputTaskIds = new Set(outputs.map(row => text(row.task_id)).filter(Boolean));
  const manifestByTask = new Map(manifests.map(row => [text(row.task_id || row.id), row]));
  const artifactIds = new Set(artifacts.map(row => text(row.id)).filter(Boolean));

  const taskAudits = tasks.map(task => {
    const taskId = text(task.id);
    const taskOutputs = outputs.filter(row => text(row.task_id) === taskId);
    const manifest = manifestByTask.get(taskId) || null;
    const publishedArtifactIds = Object.values(manifest?.artifacts || {}).map(text).filter(Boolean);
    const missingPublishedArtifacts = publishedArtifactIds.filter(id => !artifactIds.has(id));
    const duplicateScenes = duplicateKeys(sceneRows(taskOutputs), semanticSceneKey);
    const taskGenerations = generations.filter(run => text(run.task_id || run.work_id) === taskId);
    const activeGenerations = taskGenerations.filter(run => RUNNING_STATES.has(text(run.state || run.status).toLowerCase()));
    const billingRisk = billingRiskForTask({ model_calls: modelCalls, generation_runs: generations, outputs }, taskId);
    const allUnknownBilling = billingRisk.all_unknown_billing;
    const activeUnknownBilling = billingRisk.active_unknown_billing;
    const unknownBillingUnits = billingRisk.unknown_billing_units;
    const unquarantinedUnknownBilling = billingRisk.unquarantined_unknown_billing;
    const issues = [];
    const warnings = [];
    if (task.lineage_enforced !== true) issues.push('lineage_not_enforced');
    if (!manifest && taskOutputs.length) issues.push('outputs_without_manifest');
    if (missingPublishedArtifacts.length) issues.push('manifest_references_missing_artifact');
    if (duplicateScenes.length) issues.push('duplicate_scene_identity');
    if (Number(task.content_revision || 1) > 1 && !manifest) issues.push('global_revision_without_dependency_manifest');
    if (activeGenerations.length > 1) issues.push('multiple_active_generation_runs');
    if (activeUnknownBilling.length) issues.push('active_unknown_billing');
    if (unquarantinedUnknownBilling.length) issues.push('unknown_billing_unquarantined');
    if (unknownBillingUnits.length) warnings.push('unknown_billing_requires_review');
    return {
      task_id: taskId,
      content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
      output_count: taskOutputs.length,
      lineage_enforced: task.lineage_enforced === true,
      manifest_present: Boolean(manifest),
      missing_published_artifact_ids: missingPublishedArtifacts,
      duplicate_scene_keys: duplicateScenes,
      active_generation_count: activeGenerations.length,
      unknown_billing_count: allUnknownBilling.length,
      active_unknown_billing_count: activeUnknownBilling.length,
      unquarantined_unknown_billing_count: unquarantinedUnknownBilling.length,
      generation_unit_count: taskGenerations.length,
      billing_unknown_unit_count: unknownBillingUnits.length,
      issues,
      warnings,
    };
  });

  const knownTaskIds = new Set(tasks.map(task => text(task.id)).filter(Boolean));
  const orphanOutputTaskIds = [...outputTaskIds].filter(taskId => !knownTaskIds.has(taskId)).sort();
  const issueCounts = {};
  const warningCounts = {};
  taskAudits.forEach(task => task.issues.forEach(issue => { issueCounts[issue] = (issueCounts[issue] || 0) + 1; }));
  taskAudits.forEach(task => task.warnings.forEach(warning => { warningCounts[warning] = (warningCounts[warning] || 0) + 1; }));
  if (orphanOutputTaskIds.length) issueCounts.orphan_outputs = orphanOutputTaskIds.length;
  return {
    schema_version: 1,
    read_only: true,
    summary: {
      task_count: tasks.length,
      task_with_issue_count: taskAudits.filter(task => task.issues.length).length,
      task_with_warning_count: taskAudits.filter(task => task.warnings.length).length,
      lineage_enforced_count: taskAudits.filter(task => task.lineage_enforced).length,
      output_count: outputs.length,
      artifact_count: artifacts.length,
      manifest_count: manifests.length,
      work_count: works.length,
      work_event_count: workEvents.length,
      authoritative_work_count: works.filter(work => text(work.mode) === 'authoritative').length,
      shadow_work_count: works.filter(work => text(work.mode) !== 'authoritative').length,
      task_without_work_count: tasks.filter(task => !works.some(work => text(work.id || work.task_id) === text(task.id))).length,
      active_generation_count: taskAudits.reduce((sum, task) => sum + task.active_generation_count, 0),
      unknown_billing_count: taskAudits.reduce((sum, task) => sum + task.unknown_billing_count, 0),
      billing_unknown_unit_count: taskAudits.reduce((sum, task) => sum + task.billing_unknown_unit_count, 0),
      unquarantined_unknown_billing_count: taskAudits.reduce((sum, task) => sum + task.unquarantined_unknown_billing_count, 0),
      issue_counts: issueCounts,
      warning_counts: warningCounts,
    },
    orphan_output_task_ids: orphanOutputTaskIds,
    tasks: taskAudits,
  };
}

function auditCurrent() {
  return auditSnapshot(storage.readDb());
}

module.exports = {
  RUNNING_STATES,
  auditCurrent,
  auditSnapshot,
  billingRiskForTask,
  checkpointBillingRows,
  duplicateKeys,
  isUnknownBilling,
  sameBillingAttempt,
  semanticSceneKey,
};
