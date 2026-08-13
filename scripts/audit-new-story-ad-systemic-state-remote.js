'use strict';

const path = require('path');
const storage = require(path.resolve(process.cwd(), 'src/services/newStoryAd/storageService'));

const rows = value => Array.isArray(value) ? value : [];
const text = value => String(value ?? '').trim();
const running = new Set(['queued', 'submitted', 'accepted', 'polling', 'running', 'generating', 'retrying']);

function main() {
  const db = storage.readDb();
  const tasks = rows(db.tasks);
  const outputs = rows(db.outputs);
  const manifests = rows(db.manifests);
  const artifacts = rows(db.artifacts);
  const generations = rows(db.generation_runs);
  const works = rows(db.works);
  const workEvents = rows(db.work_events);
  const calls = rows(db.model_calls);
  const taskIds = new Set(tasks.map(row => text(row.id)).filter(Boolean));
  const outputTaskIds = new Set(outputs.map(row => text(row.task_id)).filter(Boolean));
  const lineage = tasks.filter(task => task.lineage_enforced === true).length;
  const activeGeneration = generations.filter(run => running.has(text(run.status).toLowerCase()));
  const unknownBilling = calls.filter(call => text(call.billing_state).toLowerCase() === 'unknown');
  const activeUnknownBilling = unknownBilling.filter(call => running.has(text(call.provider_submission_state || call.status).toLowerCase()));
  const orphanOutputs = [...outputTaskIds].filter(id => !taskIds.has(id));
  console.log(JSON.stringify({
    schema_version: 1,
    read_only: true,
    task_count: tasks.length,
    lineage_enforced_count: lineage,
    lineage_missing_count: Math.max(0, tasks.length - lineage),
    output_count: outputs.length,
    manifest_count: manifests.length,
    artifact_count: artifacts.length,
    generation_run_count: generations.length,
    work_count: works.length,
    work_event_count: workEvents.length,
    active_generation_count: activeGeneration.length,
    unknown_billing_count: unknownBilling.length,
    active_unknown_billing_count: activeUnknownBilling.length,
    orphan_output_task_count: orphanOutputs.length,
  }));
}

main();
