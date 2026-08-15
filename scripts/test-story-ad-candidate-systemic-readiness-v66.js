'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const systemicAudit = require('../src/services/newStoryAd/taskStateAuditService');
const systemicMigration = require('../src/services/newStoryAd/systemicMigrationService');
const activeTaskReadiness = require('./check-new-story-ad-active-tasks');

const root = path.resolve(__dirname, '..');
const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-immutable-release.js'), 'utf8');

function fixture({ includeUnquarantined = true } = {}) {
  const isolated = {
    id: 'historical-isolated-call', task_id: 'task-a', stage: 'visual_assets',
    billing_state: 'unknown', provider_submission_state: 'failed', status: 'failed',
  };
  const unquarantined = {
    id: 'real-unquarantined-call', task_id: 'task-a', stage: 'visual_assets',
    billing_state: 'unknown', provider_submission_state: 'failed', status: 'failed',
  };
  return {
    tasks: [{ id: 'task-a', content_revision: 1, lineage_enforced: true, active_generation_id: '' }],
    outputs: [], manifests: [], artifacts: [],
    works: [{ id: 'task-a', task_id: 'task-a', mode: 'authoritative' }], work_events: [],
    model_calls: includeUnquarantined ? [isolated, unquarantined] : [isolated],
    generation_runs: [{
      id: 'isolated-run', task_id: 'task-a', state: 'billing_unknown', billing_state: 'unknown',
      retry_blocked: true, automatic_retry_allowed: false, legacy_model_call_id: isolated.id,
    }],
  };
}

function candidateOnlyLegacyReadiness(db) {
  const activeTaskIds = new Set(db.tasks.filter(task => task.active_generation_id).map(task => task.id));
  const unknown = db.model_calls.filter(activeTaskReadiness.isUnknownBilling);
  const activeUnknown = unknown.filter(call => activeTaskIds.has(call.task_id));
  return { active_count: activeTaskIds.size, active_unknown_billing_count: activeUnknown.length };
}

const unsafeDb = fixture({ includeUnquarantined: true });
const legacyCandidate = candidateOnlyLegacyReadiness(unsafeDb);
assert.deepEqual(legacyCandidate, { active_count: 0, active_unknown_billing_count: 0 },
  '复现前提：旧 candidate-only readiness 会错误放行非活动任务上的真实未隔离未知计费');

const unsafeAudit = systemicAudit.auditSnapshot(unsafeDb);
assert.equal(unsafeAudit.summary.unquarantined_unknown_billing_count, 1,
  '全量 systemic audit 必须识别真实未隔离 unknown');
assert.equal(unsafeAudit.summary.active_generation_count, 0,
  '该发布缺口与活动任务无关，不能靠 active-task readiness 覆盖');
assert.equal(unsafeAudit.summary.task_with_issue_count, 1,
  '真实未隔离 unknown 必须成为发布阻断问题');

const isolatedAudit = systemicAudit.auditSnapshot(fixture({ includeUnquarantined: false }));
assert.equal(isolatedAudit.summary.unknown_billing_count, 1,
  '历史已隔离 unknown 仍应保留在审计证据中');
assert.equal(isolatedAudit.summary.unquarantined_unknown_billing_count, 0,
  '已有 billing_unknown generation run 的历史记录不得误判为未隔离');
assert.equal(isolatedAudit.summary.task_with_issue_count, 0,
  '仅有历史已隔离 unknown 时不得阻断候选发布');
assert.equal(isolatedAudit.summary.task_with_warning_count, 1,
  '历史已隔离 unknown 应作为可见警告保留，而不是静默删除');

assert.equal(systemicAudit.isUnknownBilling({
  billing_state: 'unknown', provider_submission_state: 'submitted_unknown',
}), false, '终态 submitted_unknown 是待人工核账风险，不得伪装成仍在运行的活动提交');
assert.equal(systemicAudit.isUnknownBilling({
  billing_state: 'unknown', provider_submission_state: 'submitted',
}), true, '真实 submitted 活动态 unknown 仍必须阻断发布');

const explicitOutputs = [
  { task_id: 'task-a', kind: 'context', payload: { nested: { key: 'not-a-checkpoint', billing_state: 'unknown' } } },
  { task_id: 'task-a', kind: 'prop_asset_checkpoint:props', payload: {
    units: { prop: { key: 'prop-unit', status: 'submitted_unknown', billing_state: 'unknown' } },
  } },
  { task_id: 'task-a', kind: 'scene_asset_checkpoint:scene-a', payload: {
    views: { master: { status: 'submitted_unknown', provider_submission_state: 'submitted_unknown', billing_state: 'unknown' } },
  } },
  { task_id: 'task-a', kind: 'subject_asset_checkpoint:old', updated_at: '2026-08-14T00:00:00.000Z', payload: {
    person_dossier_checkpoints: { person: { key: 'person-unit', status: 'submitted_unknown', billing_state: 'unknown' } },
  } },
  { task_id: 'task-a', kind: 'subject_asset_checkpoint:new', updated_at: '2026-08-15T00:00:00.000Z', payload: {
    person_dossier_checkpoints: { person: { key: 'person-unit', status: 'completed', billing_state: 'confirmed' } },
  } },
];
const explicitRisks = systemicAudit.checkpointBillingRows(explicitOutputs, 'task-a');
assert.deepEqual(explicitRisks.map(item => item.checkpoint_key).sort(), [
  'prop-unit', 'scene_asset_checkpoint:scene-a#master',
], '只读取显式subject/prop/scene checkpoint schema，且同key最新成功必须覆盖旧unknown');

let quarantinedPayload = null;
const quarantined = systemicMigration.quarantineCheckpointBilling({
  task_id: 'task-a', checkpoint_key: 'checkpoint-only', provider_submission_state: 'submitted_unknown',
}, {
  getGenerationRun: () => null,
  createGenerationRun: payload => { quarantinedPayload = payload; return payload; },
});
assert.equal(quarantined.created, true);
assert.equal(quarantinedPayload.state, 'billing_unknown');
assert.equal(quarantinedPayload.retry_blocked, true, 'checkpoint-only 隔离必须保持禁止重试');
assert.equal(quarantinedPayload.automatic_retry_allowed, false, '隔离迁移不得静默授权自动重试');
assert.equal('retry_authorization' in quarantinedPayload, false, '隔离记录不能伪造用户计费授权');

const candidateStart = deploySource.indexOf('if (candidateOnly)');
const candidateEnd = deploySource.indexOf("reportPhase('candidate_verified'", candidateStart);
assert(candidateStart >= 0 && candidateEnd > candidateStart, '必须能定位 candidate-only 发布门禁');
const candidateGate = deploySource.slice(candidateStart, candidateEnd);
assert.match(candidateGate, /await auditCandidateSystemicState\(\)/,
  'candidate-only 必须在声明 verified 前执行与切换前一致的全量 systemic audit');
const systemicStart = deploySource.indexOf('async function auditCandidateSystemicState()');
const systemicEnd = deploySource.indexOf('async function restoreSystemicBackup()', systemicStart);
assert(systemicStart >= 0 && systemicEnd > systemicStart, '必须能定位候选 systemic preflight 实现');
const systemicGate = deploySource.slice(systemicStart, systemicEnd);
assert.match(systemicGate, /audit-new-story-ad-systemic-state\.js/,
  'candidate-only systemic preflight 必须运行完整只读审计脚本');
assert.match(systemicGate, /unquarantined_unknown_billing_count/,
  'candidate-only 必须显式阻断真实未隔离 unknown，不能只检查活动任务关联的 unknown');
assert.match(candidateGate, /candidateSystemicAudit\.unquarantined_unknown_billing_count/,
  'candidate-only verified 前必须核对预测隔离是否完整覆盖统一风险');

console.log(JSON.stringify({
  passed: true,
  legacy_candidate_false_green: legacyCandidate,
  unquarantined_blockers: unsafeAudit.summary.unquarantined_unknown_billing_count,
  isolated_historical_unknown: isolatedAudit.summary.unknown_billing_count,
  isolated_historical_blockers: isolatedAudit.summary.unquarantined_unknown_billing_count,
}));
