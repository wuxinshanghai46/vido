'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const publication = require('./assetPlanPublicationService');
const releaseBundle = require('../storyAdReleaseBundleService');
const authorityLifecycle = require('./authorityLifecycleService');

const PROTECTED_STAGES = new Set([
  'subject_assets', 'person_provider_sync', 'scene_asset', 'visual_assets', 'scene_panorama', 'product_asset',
  // person_plan / scene_plan / scene_config create or repair the Active Plan.
  // Requiring an Active Plan before these stages can run creates a bootstrap
  // deadlock (active_plan_missing -> plan generator is forbidden to run).
  'storyboard', 'line_art',
  'keyframes', 'tts', 'video', 'media', 'compose', 'final_video', 'full',
]);

function protectedStage(stage = '') { return PROTECTED_STAGES.has(String(stage || '').trim()); }

function kindFor(stage = '', idempotencyKey = '') {
  const digest = crypto.createHash('sha256').update(`${stage}|${idempotencyKey}`).digest('hex').slice(0, 20);
  return `generation_permit:${stage}:${digest}`;
}

function stageEligibility(eligibility = {}, stage = '') {
  return ['subject_assets', 'person_provider_sync'].includes(String(stage || ''))
    ? { ...eligibility, ...(eligibility.person || {}) }
    : eligibility;
}

function releaseSyncBlockedError(migration = {}, eligibility = {}) {
  const issues = [
    ...(Array.isArray(migration?.safetyIssues) ? migration.safetyIssues : []),
    ...(Array.isArray(migration?.safety_issues) ? migration.safety_issues : []),
    ...(Array.isArray(migration?.compatibility?.issues) ? migration.compatibility.issues : []),
  ];
  const billingReview = issues.some(issue => [
    'active_unknown_billing_exists',
    'unknown_billing_unquarantined',
  ].includes(String(issue || '')));
  const activeGeneration = issues.includes('active_generation_exists');
  const error = new Error(billingReview
    ? '当前任务有历史图片调用的计费状态尚未核清，系统已停止自动重试；请先在失败项中完成一次计费风险确认，再继续生成。'
    : (activeGeneration
      ? '当前任务仍有上一轮生成正在收尾，系统没有发起新的模型调用；请等待当前处理结束后刷新重试。'
      : '当前任务暂时无法安全同步到本版本生成方案，系统没有发起模型调用；请刷新任务状态后重试。'));
  error.code = billingReview ? 'GENERATION_BILLING_REVIEW_REQUIRED' : 'GENERATION_RELEASE_SYNC_BLOCKED';
  error.status = 409;
  error.retryable = false;
  // Keep the public failure actionable without exposing internal validator,
  // provider or release-bundle issue names.
  error.details = {
    release_sync_pending: true,
    requires_billing_review: billingReview,
    wait_for_active_generation: activeGeneration,
    action: billingReview ? 'confirm_billing_risk_on_failed_item'
      : (activeGeneration ? 'wait_then_refresh' : 'refresh_task_state'),
    model_call_started: false,
    plan_id: String(eligibility?.plan_id || ''),
  };
  return error;
}

function issue(taskId, stage, { idempotencyKey = '' } = {}) {
  if (!protectedStage(stage)) return null;
  let active = publication.activeRecord(taskId);
  let eligibility = publication.eligibility(taskId, { fingerprint: active?.fingerprint || '' });
  if (!eligibility.eligible
    && eligibility.release_migration?.compatible === true
    && eligibility.release_migration?.migration_required === true) {
    let migrated;
    try {
      migrated = publication.migrateCompatibleRelease(taskId, {
        fingerprint: active?.fingerprint || '',
        reason: `${String(stage || 'generation')}_permit_release_sync`,
      });
    } catch (error) {
      if (error?.code !== 'AUTHORITY_PROMOTION_BLOCKED') throw error;
      throw releaseSyncBlockedError({ safetyIssues: ['unknown_billing_unquarantined'] }, eligibility);
    }
    if (migrated?.blocked === true) throw releaseSyncBlockedError(migrated, eligibility);
    if (migrated.migrated) {
      active = publication.activeRecord(taskId);
      eligibility = publication.eligibility(taskId, { fingerprint: active?.fingerprint || '' });
    }
  }
  const required = stageEligibility(eligibility, stage);
  if (!required.eligible) {
    const error = new Error(`当前任务没有可用于生成的本版本 Active Plan：${required.issues.join('、')}`);
    error.code = 'GENERATION_ACTIVE_PLAN_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.details = eligibility;
    throw error;
  }
  const authority = authorityLifecycle.ensureCurrent(taskId, active);
  authorityLifecycle.assertCurrent(taskId, {
    authority_id: authority.authority_id,
    plan_id: eligibility.plan_id,
    content_revision: eligibility.content_revision,
    release_bundle_id: eligibility.release_bundle_id,
  });
  const key = String(idempotencyKey || `${taskId}:${stage}:r${eligibility.content_revision}`);
  const kind = kindFor(stage, key);
  const existing = storage.getOutput(taskId, kind);
  if (existing && existing.plan_id === eligibility.plan_id
    && existing.authority_id === authority.authority_id
    && existing.release_bundle_id === eligibility.release_bundle_id
    && existing.execution_disabled !== true
    && ['issued', 'consumed'].includes(existing.status)) return existing;
  const permit = {
    permit_id: crypto.randomUUID(),
    status: 'issued',
    task_id: taskId,
    stage,
    idempotency_key: key,
    plan_id: eligibility.plan_id,
    authority_id: authority.authority_id,
    authority_token: authority.authority_token,
    execution_identity: authority.execution_identity,
    active_revision: eligibility.active_revision,
    content_revision: eligibility.content_revision,
    topology_hash: eligibility.topology_hash,
    release_bundle_id: eligibility.release_bundle_id,
    release_envelope: releaseBundle.envelope(),
    issued_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, kind, permit);
  return permit;
}

function consume(taskId, permit = null) {
  if (!permit) return null;
  const kind = kindFor(permit.stage, permit.idempotency_key);
  const stored = storage.getOutput(taskId, kind);
  if (!stored || stored.permit_id !== permit.permit_id) {
    const error = new Error('生成许可不存在或已失效，本次没有调用模型');
    error.code = 'GENERATION_PERMIT_INVALID';
    error.status = 409;
    throw error;
  }
  if (stored.disabled === true || stored.execution_disabled === true || stored.status === 'disabled') {
    const error = new Error('生成许可属于已封存方案，本次没有调用模型');
    error.code = 'GENERATION_PERMIT_DISABLED';
    error.status = 409;
    throw error;
  }
  authorityLifecycle.assertCurrent(taskId, stored);
  const active = publication.activeRecord(taskId);
  const eligibility = publication.eligibility(taskId, { fingerprint: active?.fingerprint || '' });
  const required = stageEligibility(eligibility, stored.stage);
  if (!required.eligible
    || eligibility.plan_id !== stored.plan_id
    || eligibility.release_bundle_id !== stored.release_bundle_id
    || eligibility.content_revision !== stored.content_revision) {
    const error = new Error('生成许可对应的计划、输入或运行版本已变化，本次没有调用模型');
    error.code = 'GENERATION_PERMIT_STALE';
    error.status = 409;
    error.details = eligibility;
    throw error;
  }
  if (stored.status === 'consumed') return stored;
  const consumed = { ...stored, status: 'consumed', consumed_at: new Date().toISOString() };
  storage.saveOutput(taskId, kind, consumed);
  return consumed;
}

module.exports = {
  PROTECTED_STAGES,
  protectedStage,
  issue,
  consume,
  kindFor,
  stageEligibility,
  releaseSyncBlockedError,
};
