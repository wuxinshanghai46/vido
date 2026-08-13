'use strict';

const assert = require('assert');
const audit = require('../src/services/newStoryAd/taskStateAuditService');

const report = audit.auditSnapshot({
  tasks: [
    { id: 'healthy', content_revision: 2, lineage_enforced: true },
    { id: 'legacy', content_revision: 4, lineage_enforced: false },
  ],
  outputs: [
    { id: 'healthy:scene_assets', task_id: 'healthy', kind: 'scene_assets', payload: { scenes: [{ semantic_key: 'cafe' }] } },
    { id: 'legacy:scene_plan', task_id: 'legacy', kind: 'scene_plan', payload: { scenes: [{ scene_id: 'room' }, { scene_id: 'room' }] } },
    { id: 'orphan:context', task_id: 'orphan', kind: 'context', payload: {} },
  ],
  manifests: [
    { id: 'healthy', task_id: 'healthy', artifacts: { scene_assets: 'healthy-artifact' } },
  ],
  artifacts: [{ id: 'healthy-artifact', task_id: 'healthy', kind: 'scene_assets' }],
  generation_runs: [
    { id: 'run-1', task_id: 'legacy', state: 'running', billing_state: 'confirmed' },
    { id: 'run-2', task_id: 'legacy', state: 'queued', billing_state: 'not_submitted' },
    { id: 'run-3', task_id: 'healthy', state: 'billing_unknown', billing_state: 'unknown' },
  ],
  model_calls: [
    { id: 'call-1', task_id: 'legacy', billing_state: 'unknown', provider_submission_state: 'running' },
  ],
});

assert.strictEqual(report.read_only, true);
assert.strictEqual(report.summary.task_count, 2);
assert.strictEqual(report.summary.lineage_enforced_count, 1);
assert.strictEqual(report.summary.unknown_billing_count, 1);
assert.deepStrictEqual(report.orphan_output_task_ids, ['orphan']);
const legacy = report.tasks.find(task => task.task_id === 'legacy');
assert(legacy.issues.includes('lineage_not_enforced'));
assert(legacy.issues.includes('outputs_without_manifest'));
assert(legacy.issues.includes('duplicate_scene_identity'));
assert(legacy.issues.includes('global_revision_without_dependency_manifest'));
assert(legacy.issues.includes('multiple_active_generation_runs'));
assert.strictEqual(report.tasks.find(task => task.task_id === 'healthy').billing_unknown_unit_count, 1);
assert(legacy.issues.includes('active_unknown_billing'));
assert(legacy.issues.includes('unknown_billing_unquarantined'));
assert(report.tasks.find(task => task.task_id === 'healthy').warnings.includes('unknown_billing_requires_review'));
console.log(JSON.stringify({ passed: true, tasks: report.summary.task_count, issue_types: Object.keys(report.summary.issue_counts).length }));
