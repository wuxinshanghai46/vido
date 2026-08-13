'use strict';

const storage = require('./storageService');

const RUNNING_STATES = new Set(['queued', 'submitted', 'accepted', 'polling', 'running', 'generating', 'retrying']);

function text(value = '') { return String(value ?? '').trim(); }
function rows(value) { return Array.isArray(value) ? value : []; }

function isUnknownBilling(call = {}) {
  return text(call.billing_state).toLowerCase() === 'unknown'
    && RUNNING_STATES.has(text(call.provider_submission_state || call.status).toLowerCase());
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
    const activeGenerations = generations.filter(run => text(run.task_id) === taskId
      && RUNNING_STATES.has(text(run.status).toLowerCase()));
    const unknownBilling = modelCalls.filter(call => text(call.task_id) === taskId && isUnknownBilling(call));
    const issues = [];
    if (task.lineage_enforced !== true) issues.push('lineage_not_enforced');
    if (!manifest && taskOutputs.length) issues.push('outputs_without_manifest');
    if (missingPublishedArtifacts.length) issues.push('manifest_references_missing_artifact');
    if (duplicateScenes.length) issues.push('duplicate_scene_identity');
    if (Number(task.content_revision || 1) > 1 && !manifest) issues.push('global_revision_without_dependency_manifest');
    if (activeGenerations.length > 1) issues.push('multiple_active_generation_runs');
    if (unknownBilling.length) issues.push('unknown_billing_requires_review');
    return {
      task_id: taskId,
      content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
      output_count: taskOutputs.length,
      lineage_enforced: task.lineage_enforced === true,
      manifest_present: Boolean(manifest),
      missing_published_artifact_ids: missingPublishedArtifacts,
      duplicate_scene_keys: duplicateScenes,
      active_generation_count: activeGenerations.length,
      unknown_billing_count: unknownBilling.length,
      issues,
    };
  });

  const knownTaskIds = new Set(tasks.map(task => text(task.id)).filter(Boolean));
  const orphanOutputTaskIds = [...outputTaskIds].filter(taskId => !knownTaskIds.has(taskId)).sort();
  const issueCounts = {};
  taskAudits.forEach(task => task.issues.forEach(issue => { issueCounts[issue] = (issueCounts[issue] || 0) + 1; }));
  if (orphanOutputTaskIds.length) issueCounts.orphan_outputs = orphanOutputTaskIds.length;
  return {
    schema_version: 1,
    read_only: true,
    summary: {
      task_count: tasks.length,
      task_with_issue_count: taskAudits.filter(task => task.issues.length).length,
      lineage_enforced_count: taskAudits.filter(task => task.lineage_enforced).length,
      output_count: outputs.length,
      artifact_count: artifacts.length,
      manifest_count: manifests.length,
      work_count: works.length,
      work_event_count: workEvents.length,
      task_without_work_count: tasks.filter(task => !works.some(work => text(work.id || work.task_id) === text(task.id))).length,
      active_generation_count: taskAudits.reduce((sum, task) => sum + task.active_generation_count, 0),
      unknown_billing_count: taskAudits.reduce((sum, task) => sum + task.unknown_billing_count, 0),
      issue_counts: issueCounts,
    },
    orphan_output_task_ids: orphanOutputTaskIds,
    tasks: taskAudits,
  };
}

function auditCurrent() {
  return auditSnapshot(storage.readDb());
}

module.exports = { RUNNING_STATES, auditCurrent, auditSnapshot, duplicateKeys, isUnknownBilling, semanticSceneKey };
