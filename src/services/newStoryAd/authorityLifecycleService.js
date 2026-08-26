'use strict';

const crypto = require('crypto');
const storage = require('./storageService');

const AUTHORITY_CONTRACT_VERSION = 1;
const ACTIVE_KIND = 'execution_authority_active';
const HISTORY_PREFIX = 'execution_authority_history:';
const CANDIDATE_HISTORY_PREFIX = 'asset_plan_candidate_history:';
const ACTIVE_RUN_STATES = new Set(['ready', 'queued', 'submitted', 'running']);

function clean(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function fail(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.retryable = false;
  Object.assign(error, details);
  return error;
}

function active(taskId) {
  return storage.getOutput(taskId, ACTIVE_KIND) || null;
}

function historyKind(authorityId) {
  return `${HISTORY_PREFIX}${clean(authorityId, 160)}`;
}

function candidateHistoryKind(candidateId) {
  return `${CANDIDATE_HISTORY_PREFIX}${clean(candidateId, 160)}`;
}

function quarantinedBillingUnknown(run = {}) {
  return clean(run.state, 40).toLowerCase() === 'billing_unknown'
    && clean(run.billing_state, 40).toLowerCase() === 'unknown'
    && run.retry_blocked === true
    && run.automatic_retry_allowed !== true;
}

function ownedAuthorityRun(run = {}, options = {}) {
  const generationId = clean(options.generation_id || options.generationId, 160);
  if (!generationId || clean(run.orchestration_job_id, 160) !== generationId) return false;
  const domain = clean(run.domain, 80);
  return (options.production_graph_authority === true && domain === 'production_assets')
    || (options.person_plan_authority === true && domain === 'person_plan')
    || (options.scene_plan_authority === true && domain === 'scene_plan');
}

function promotionBlockers(taskId, options = {}) {
  const runs = storage.listGenerationRuns({ work_id: taskId });
  return runs.filter(run => {
    if (ownedAuthorityRun(run, options)) return false;
    const state = clean(run.state, 40).toLowerCase();
    const billingUnknown = state === 'billing_unknown' || clean(run.billing_state, 40).toLowerCase() === 'unknown';
    const ownedPromotion = options.production_graph_authority === true
      || options.person_plan_authority === true
      || options.scene_plan_authority === true;
    if (billingUnknown && ownedPromotion && quarantinedBillingUnknown(run)) return false;
    return ACTIVE_RUN_STATES.has(state) || billingUnknown;
  });
}

function assertPromotionAllowed(taskId, options = {}) {
  const blockers = promotionBlockers(taskId, options);
  if (!blockers.length) return true;
  throw fail(
    '当前方案仍有运行中或计费未核清的生成记录，禁止切换新 Active',
    'AUTHORITY_PROMOTION_BLOCKED',
    { blocking_generation_ids: blockers.map(run => run.id), blocking_states: blockers.map(run => run.state) },
  );
}

function createAuthority(taskId, activePlan = {}, activeRecord = {}) {
  const authorityId = `auth_${crypto.randomUUID()}`;
  const at = new Date().toISOString();
  return {
    contract_version: AUTHORITY_CONTRACT_VERSION,
    authority_id: authorityId,
    authority_token: crypto.randomUUID(),
    execution_identity: crypto.randomUUID(),
    task_id: clean(taskId, 160),
    plan_id: clean(activeRecord.plan_id || activePlan.candidate_id, 160),
    active_revision: Math.max(1, Number(activeRecord.active_revision || activePlan.active_revision) || 1),
    content_revision: Math.max(1, Number(activeRecord.content_revision || activePlan.content_revision) || 1),
    topology_hash: clean(activeRecord.topology_hash || activePlan.topology_hash, 200),
    release_bundle_id: clean(activeRecord.release_bundle_id || activeRecord.release_envelope?.producer_bundle_id
      || activePlan.release_envelope?.producer_bundle_id, 200),
    state: 'active',
    execution_disabled: false,
    cache_readonly: false,
    activated_at: at,
  };
}

function disablePrevious(taskId, nextAuthority, at, options = {}) {
  const previous = active(taskId);
  if (previous?.authority_id && previous.authority_id !== nextAuthority.authority_id) {
    const disabled = {
      ...previous,
      state: 'superseded',
      execution_disabled: true,
      cache_readonly: true,
      retry_blocked: true,
      superseded_by: nextAuthority.authority_id,
      superseded_at: at,
    };
    storage.saveOutput(taskId, historyKind(previous.authority_id), disabled);
  }

  const currentCandidate = storage.getOutput(taskId, 'asset_plan_candidate');
  if (currentCandidate?.candidate_id && currentCandidate.candidate_id !== nextAuthority.plan_id) {
    storage.saveOutput(taskId, candidateHistoryKind(currentCandidate.candidate_id), {
      ...currentCandidate,
      status: 'superseded',
      disabled: true,
      execution_disabled: true,
      cache_readonly: true,
      superseded_by: nextAuthority.authority_id,
      superseded_at: at,
    });
  }

  storage.listOutputs(taskId)
    .filter(row => clean(row.kind).startsWith('generation_permit:'))
    .forEach(row => {
      const permit = row.payload || {};
      if (permit.authority_id === nextAuthority.authority_id) return;
      storage.saveOutput(taskId, row.kind, {
        ...permit,
        status: 'disabled',
        disabled: true,
        execution_disabled: true,
        cache_readonly: true,
        retry_blocked: true,
        superseded_by: nextAuthority.authority_id,
        superseded_at: at,
      });
    });

  storage.listGenerationRuns({ work_id: taskId }).forEach(run => {
    if (run.authority_id === nextAuthority.authority_id) return;
    if (ownedAuthorityRun(run, options)) {
      storage.updateGenerationRun(run.id, {
        authority_id: nextAuthority.authority_id,
        execution_identity: nextAuthority.execution_identity,
        execution_disabled: false,
        cache_readonly: false,
        retry_blocked: false,
        automatic_retry_allowed: false,
        superseded_by: '',
        superseded_at: '',
      }, { expected_version: run.unit_version });
      return;
    }
    storage.updateGenerationRun(run.id, {
      execution_disabled: true,
      cache_readonly: true,
      retry_blocked: true,
      automatic_retry_allowed: false,
      superseded_by: nextAuthority.authority_id,
      superseded_at: at,
    }, { expected_version: run.unit_version });
  });

  storage.listArtifactIds(taskId).forEach(artifactId => {
    const artifact = storage.getArtifact(artifactId);
    if (!artifact) return;
    if (artifact.authority_id === nextAuthority.authority_id) return;
    storage.updateArtifact(artifact.id, {
      execution_disabled: true,
      cache_readonly: true,
      retry_blocked: true,
      superseded_by: nextAuthority.authority_id,
      superseded_at: at,
    });
  });
}

function activate(taskId, activePlan = {}, activeRecord = {}, candidate = null, options = {}) {
  assertPromotionAllowed(taskId, options);
  const authority = createAuthority(taskId, activePlan, activeRecord);
  const at = authority.activated_at;
  disablePrevious(taskId, authority, at, options);
  if (candidate?.candidate_id) {
    const activatedCandidate = {
      ...candidate,
      status: 'active',
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
      activated_at: at,
    };
    storage.saveOutput(taskId, 'asset_plan_candidate', activatedCandidate);
    storage.saveOutput(taskId, candidateHistoryKind(candidate.candidate_id), activatedCandidate);
  }
  storage.saveOutput(taskId, ACTIVE_KIND, authority);
  storage.saveOutput(taskId, historyKind(authority.authority_id), authority);
  storage.updateTask(taskId, {
    authority_enforced: true,
    active_authority_id: authority.authority_id,
    active_authority_token: authority.authority_token,
    active_execution_identity: authority.execution_identity,
    active_plan_id: authority.plan_id,
  });
  return authority;
}

function ensureCurrent(taskId, activePlanRecord = null) {
  const existing = active(taskId);
  if (existing) return assertCurrent(taskId, { authority_id: existing.authority_id });
  const planRecord = activePlanRecord || storage.getOutput(taskId, 'asset_plan_active');
  const plan = planRecord?.plan || null;
  if (!plan || clean(plan.status, 40) !== 'active') {
    throw fail('当前任务没有可迁移的 Active Plan', 'EXECUTION_AUTHORITY_MISSING');
  }
  assertPromotionAllowed(taskId);
  let authority = null;
  storage.withWriteBatch(() => {
    authority = createAuthority(taskId, plan, planRecord);
    const candidate = storage.getOutput(taskId, 'asset_plan_candidate');
    if (candidate?.candidate_id) {
      const boundCandidate = {
        ...candidate,
        authority_id: authority.authority_id,
        authority_token: authority.authority_token,
        execution_identity: authority.execution_identity,
      };
      storage.saveOutput(taskId, 'asset_plan_candidate', boundCandidate);
      storage.saveOutput(taskId, candidateHistoryKind(candidate.candidate_id), boundCandidate);
    }
    storage.listOutputs(taskId)
      .filter(row => clean(row.kind).startsWith('generation_permit:'))
      .forEach(row => storage.saveOutput(taskId, row.kind, {
        ...(row.payload || {}),
        status: 'disabled',
        disabled: true,
        execution_disabled: true,
        cache_readonly: true,
        retry_blocked: true,
        superseded_by: authority.authority_id,
        superseded_at: authority.activated_at,
      }));
    storage.listGenerationRuns({ work_id: taskId }).forEach(run => storage.updateGenerationRun(run.id, {
      execution_disabled: true,
      cache_readonly: true,
      retry_blocked: true,
      automatic_retry_allowed: false,
      superseded_by: authority.authority_id,
      superseded_at: authority.activated_at,
    }, { expected_version: run.unit_version }));
    storage.listArtifactIds(taskId).forEach(artifactId => storage.updateArtifact(artifactId, {
      authority_id: authority.authority_id,
      execution_identity: authority.execution_identity,
      execution_disabled: false,
      cache_readonly: false,
    }));
    storage.saveOutput(taskId, ACTIVE_KIND, authority);
    storage.saveOutput(taskId, historyKind(authority.authority_id), authority);
    storage.saveOutput(taskId, 'asset_plan_active', {
      ...planRecord,
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
      plan: {
        ...plan,
        authority_id: authority.authority_id,
        authority_token: authority.authority_token,
        execution_identity: authority.execution_identity,
      },
    });
    storage.updateTask(taskId, {
      authority_enforced: true,
      active_authority_id: authority.authority_id,
      active_authority_token: authority.authority_token,
      active_execution_identity: authority.execution_identity,
      active_plan_id: authority.plan_id,
    });
  });
  return authority;
}

function assertCurrent(taskId, expected = {}) {
  const current = active(taskId);
  const task = storage.getTask(taskId);
  const issues = [];
  if (!current) issues.push('active_authority_missing');
  if (current?.state !== 'active' || current?.execution_disabled === true) issues.push('active_authority_disabled');
  if (current && clean(task?.active_authority_id) !== clean(current.authority_id)) issues.push('task_authority_mismatch');
  if (expected.authority_id && clean(expected.authority_id) !== clean(current?.authority_id)) issues.push('authority_id_stale');
  if (expected.authority_token && clean(expected.authority_token) !== clean(current?.authority_token)) issues.push('authority_token_stale');
  if (expected.execution_identity && clean(expected.execution_identity) !== clean(current?.execution_identity)) issues.push('execution_identity_stale');
  if (expected.plan_id && clean(expected.plan_id) !== clean(current?.plan_id)) issues.push('authority_plan_stale');
  if (expected.content_revision && Number(expected.content_revision) !== Number(current?.content_revision)) issues.push('authority_revision_stale');
  if (expected.release_bundle_id && clean(expected.release_bundle_id) !== clean(current?.release_bundle_id)) issues.push('authority_release_stale');
  if (issues.length) throw fail('当前执行请求不属于唯一 Active 权威，已在模型调用前停止', 'EXECUTION_AUTHORITY_STALE', {
    issues,
    expected_authority_id: clean(expected.authority_id),
    active_authority_id: clean(current?.authority_id),
  });
  return current;
}

module.exports = {
  AUTHORITY_CONTRACT_VERSION,
  ACTIVE_KIND,
  ACTIVE_RUN_STATES,
  active,
  activate,
  ensureCurrent,
  assertCurrent,
  assertPromotionAllowed,
  candidateHistoryKind,
  historyKind,
  promotionBlockers,
};
