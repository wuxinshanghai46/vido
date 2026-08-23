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

function issue(taskId, stage, { idempotencyKey = '' } = {}) {
  if (!protectedStage(stage)) return null;
  const active = publication.activeRecord(taskId);
  const eligibility = publication.eligibility(taskId, { fingerprint: active?.fingerprint || '' });
  if (!eligibility.eligible) {
    const error = new Error(`当前任务没有可用于生成的本版本 Active Plan：${eligibility.issues.join('、')}`);
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
  if (!eligibility.eligible
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

module.exports = { PROTECTED_STAGES, protectedStage, issue, consume, kindFor };
