'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const pipeline = require('../pipelineModelService');
const releaseBundle = require('../storyAdReleaseBundleService');

const CONTRACT_VERSION = 'reference-evidence-expansion-v6';
const CHECKPOINT_PREFIX = 'reference_evidence_expansion_checkpoint:';
const CAPABILITY_ORDER = Object.freeze([
  'base_reference',
  'detail_view',
  'multi_view',
  'panorama_360',
  'spatial_3d',
]);
const CAPABILITY_SET = new Set(CAPABILITY_ORDER);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function text(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function unique(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => text(item, 200)).filter(Boolean))];
}

function normalizeCapability(value) {
  const raw = text(value, 60).toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    base: 'base_reference', source: 'base_reference', reference: 'base_reference',
    close_up: 'detail_view', close_detail: 'detail_view', detail: 'detail_view',
    multiview: 'multi_view', views: 'multi_view',
    panorama: 'panorama_360', '360': 'panorama_360',
    spatial: 'spatial_3d', '3d': 'spatial_3d',
  };
  const normalized = aliases[raw] || raw;
  return CAPABILITY_SET.has(normalized) ? normalized : '';
}

function normalizeRequirement(row = {}, index = 0) {
  const target = normalizeCapability(row.target_view || row.target_capability || row.capability || 'detail_view');
  if (!target) {
    const error = new Error(`reference_requirement_target_invalid:${index}`);
    error.code = 'REFERENCE_EXPANSION_PLAN_INVALID';
    error.status = 422;
    throw error;
  }
  return {
    requirement_id: text(row.requirement_id || row.id || `requirement_${index + 1}`, 160),
    description: text(row.description || row.purpose || row.requirement, 1200),
    target_view: target,
    required: row.required !== false,
    model_stage: text(row.model_stage || row.modelStage, 160),
  };
}

function evidenceReusable(row = {}, currentBundleId = '') {
  const assetHash = text(row.asset_hash || row.assetHash, 160);
  if (!assetHash) return { reusable: false, reason: 'asset_hash_missing' };
  const sourceType = text(row.source_type || row.sourceType, 80).toLowerCase();
  const userOwned = row.user_owned === true || ['user_upload', 'external_reference', 'original_capture'].includes(sourceType);
  const producerBundleId = text(row.producer_bundle_id || row.producerBundleId, 160);
  if (!userOwned && producerBundleId !== currentBundleId) {
    return { reusable: false, reason: producerBundleId ? 'producer_bundle_mismatch' : 'producer_bundle_missing' };
  }
  if (!normalizeCapability(row.capability || row.view_type || row.viewType)) {
    return { reusable: false, reason: 'capability_invalid' };
  }
  return { reusable: true, reason: 'compatible' };
}

function normalizeEvidence(row = {}, index = 0, currentBundleId = '') {
  const compatibility = evidenceReusable(row, currentBundleId);
  return {
    evidence_id: text(row.evidence_id || row.id || `evidence_${index + 1}`, 160),
    requirement_ids: unique(row.requirement_ids || row.requirementIds),
    capability: normalizeCapability(row.capability || row.view_type || row.viewType),
    asset_hash: text(row.asset_hash || row.assetHash, 160),
    producer_bundle_id: text(row.producer_bundle_id || row.producerBundleId, 160),
    source_type: text(row.source_type || row.sourceType, 80),
    reusable: compatibility.reusable,
    compatibility_reason: compatibility.reason,
  };
}

function pathTo(target) {
  if (target === 'detail_view') return ['base_reference', 'detail_view'];
  if (target === 'multi_view') return ['base_reference', 'multi_view'];
  if (target === 'panorama_360') return ['base_reference', 'multi_view', 'panorama_360'];
  if (target === 'spatial_3d') return ['base_reference', 'multi_view', 'panorama_360', 'spatial_3d'];
  return ['base_reference'];
}

function operationFor(capability) {
  return {
    base_reference: 'acquire_reference_evidence',
    detail_view: 'derive_detail_view',
    multi_view: 'derive_multi_view_evidence',
    panorama_360: 'derive_panorama_from_multi_view',
    spatial_3d: 'derive_spatial_from_panorama',
  }[capability];
}

function assertManagedStage(stage = '') {
  const id = text(stage, 160);
  if (!id) return true;
  if (!id.startsWith('new_story_ad.') || !pipeline.getStageMeta(id)) {
    const error = new Error(`reference_expansion_model_stage_not_registered:${id || 'missing'}`);
    error.code = 'MODEL_STAGE_NOT_REGISTERED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  return true;
}

function buildPlan(input = {}) {
  const scopeId = text(input.scope_id || input.scopeId || input.target_id || input.targetId, 160);
  if (!scopeId) {
    const error = new Error('reference_expansion_scope_id_required');
    error.code = 'REFERENCE_EXPANSION_PLAN_INVALID';
    error.status = 422;
    throw error;
  }
  const identity = releaseBundle.identity();
  const requirements = (Array.isArray(input.requirements) ? input.requirements : [])
    .map(normalizeRequirement);
  if (!requirements.length) {
    const error = new Error('reference_expansion_requirements_missing');
    error.code = 'REFERENCE_EXPANSION_PLAN_INVALID';
    error.status = 422;
    throw error;
  }
  requirements.forEach(row => assertManagedStage(row.model_stage));
  const allEvidence = (Array.isArray(input.evidence) ? input.evidence : [])
    .map((row, index) => normalizeEvidence(row, index, identity.bundle_id));
  const reusableEvidence = allEvidence.filter(row => row.reusable);
  const excludedEvidence = allEvidence.filter(row => !row.reusable);
  const steps = [];

  requirements.forEach((requirement) => {
    const relevant = reusableEvidence.filter(row => !row.requirement_ids.length
      || row.requirement_ids.includes(requirement.requirement_id));
    const available = new Set(relevant.map(row => row.capability));
    const path = pathTo(requirement.target_view);
    const highestAvailable = path.reduce((highest, capability, index) => (
      available.has(capability) ? Math.max(highest, index) : highest
    ), -1);
    let priorStepId = '';
    for (let index = highestAvailable + 1; index < path.length; index += 1) {
      const capability = path[index];
      const stepId = `${requirement.requirement_id}:${capability}`;
      const directEvidence = relevant.filter(row => row.capability === path[index - 1]).map(row => row.evidence_id);
      const dependencies = priorStepId ? [priorStepId] : [];
      steps.push({
        step_id: stepId,
        requirement_id: requirement.requirement_id,
        description: requirement.description,
        operation: operationFor(capability),
        target_view: capability,
        source_evidence_ids: directEvidence,
        depends_on: dependencies,
        model_stage: requirement.model_stage,
        required: requirement.required,
      });
      priorStepId = stepId;
    }
  });

  const fingerprintPayload = {
    scope_id: scopeId,
    requirements,
    evidence: reusableEvidence.map(row => ({
      evidence_id: row.evidence_id,
      capability: row.capability,
      asset_hash: row.asset_hash,
      producer_bundle_id: row.producer_bundle_id,
      requirement_ids: row.requirement_ids,
    })),
    steps,
    bundle_id: identity.bundle_id,
  };
  const inputFingerprint = hash(fingerprintPayload);
  const plan = {
    contract_version: CONTRACT_VERSION,
    plan_id: `evidence_plan_${inputFingerprint.slice(0, 20)}`,
    scope_id: scopeId,
    input_fingerprint: inputFingerprint,
    producer_bundle_id: identity.bundle_id,
    requirements,
    evidence: reusableEvidence,
    excluded_evidence: excludedEvidence,
    steps,
    created_at: new Date().toISOString(),
  };
  validatePlan(plan);
  return plan;
}

function validatePlan(plan = {}) {
  const issues = [];
  if (plan.producer_bundle_id !== releaseBundle.identity().bundle_id) issues.push('producer_bundle_mismatch');
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const ids = new Set();
  steps.forEach((step, index) => {
    if (!step.step_id) issues.push(`steps[${index}].step_id_missing`);
    if (ids.has(step.step_id)) issues.push(`steps[${index}].step_id_duplicate`);
    ids.add(step.step_id);
    if (!normalizeCapability(step.target_view)) issues.push(`steps[${index}].target_view_invalid`);
    if (step.model_stage) {
      try { assertManagedStage(step.model_stage); } catch { issues.push(`steps[${index}].model_stage_unmanaged`); }
    }
  });
  steps.forEach((step, index) => {
    (Array.isArray(step.depends_on) ? step.depends_on : []).forEach(dependency => {
      if (!ids.has(dependency)) issues.push(`steps[${index}].dependency_missing:${dependency}`);
    });
    if (step.target_view === 'panorama_360') {
      const prior = steps.find(item => item.requirement_id === step.requirement_id && item.target_view === 'multi_view');
      const hasSource = Array.isArray(step.source_evidence_ids) && step.source_evidence_ids.length > 0;
      if (!prior && !hasSource) issues.push(`steps[${index}].panorama_requires_multi_view`);
    }
    if (step.target_view === 'spatial_3d') {
      const prior = steps.find(item => item.requirement_id === step.requirement_id && item.target_view === 'panorama_360');
      const hasSource = Array.isArray(step.source_evidence_ids) && step.source_evidence_ids.length > 0;
      if (!prior && !hasSource) issues.push(`steps[${index}].spatial_requires_panorama`);
    }
  });
  if (issues.length) {
    const error = new Error(`reference_expansion_plan_invalid:${issues.join('|')}`);
    error.code = 'REFERENCE_EXPANSION_PLAN_INVALID';
    error.status = 422;
    error.retryable = false;
    error.issues = issues;
    throw error;
  }
  return true;
}

function checkpointKind(scopeId) {
  const id = text(scopeId, 160);
  if (!id) throw new TypeError('reference_expansion_scope_id_required');
  return `${CHECKPOINT_PREFIX}${id}`;
}

function checkpoint(taskId, scopeId) {
  return storage.getOutput(taskId, checkpointKind(scopeId));
}

function assertCheckpointCompatible(plan, currentCheckpoint = null) {
  validatePlan(plan);
  if (!currentCheckpoint) return true;
  const currentBundleId = releaseBundle.identity().bundle_id;
  const compatible = currentCheckpoint.contract_version === CONTRACT_VERSION
    && currentCheckpoint.plan_id === plan.plan_id
    && currentCheckpoint.input_fingerprint === plan.input_fingerprint
    && currentCheckpoint.producer_bundle_id === currentBundleId
    && currentCheckpoint.release_envelope?.producer_bundle_id === currentBundleId;
  if (!compatible) {
    const error = new Error('reference_expansion_checkpoint_generation_mismatch');
    error.code = 'REFERENCE_EXPANSION_CHECKPOINT_MISMATCH';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  return true;
}

function saveCheckpoint(taskId, plan, patch = {}, options = {}) {
  validatePlan(plan);
  const existing = checkpoint(taskId, plan.scope_id);
  assertCheckpointCompatible(plan, existing);
  const stepIds = new Set(plan.steps.map(step => step.step_id));
  const completed = unique([
    ...(existing?.completed_step_ids || []),
    ...(patch.completed_step_ids || patch.completedStepIds || []),
  ]);
  const unknown = completed.filter(id => !stepIds.has(id));
  if (unknown.length) {
    const error = new Error(`reference_expansion_unknown_completed_step:${unknown.join('|')}`);
    error.code = 'REFERENCE_EXPANSION_CHECKPOINT_INVALID';
    error.status = 422;
    throw error;
  }
  const artifacts = { ...(existing?.artifacts || {}), ...(patch.artifacts || {}) };
  completed.forEach(stepId => {
    const artifact = artifacts[stepId];
    if (!artifact || !text(artifact.asset_hash || artifact.assetHash, 160)) {
      const error = new Error(`reference_expansion_completed_step_asset_hash_missing:${stepId}`);
      error.code = 'REFERENCE_EXPANSION_CHECKPOINT_INVALID';
      error.status = 422;
      throw error;
    }
    const artifactBundleId = text(artifact.producer_bundle_id || artifact.producerBundleId, 160);
    if (artifactBundleId !== plan.producer_bundle_id) {
      const error = new Error(`reference_expansion_completed_step_bundle_mismatch:${stepId}`);
      error.code = 'REFERENCE_EXPANSION_CHECKPOINT_INVALID';
      error.status = 422;
      throw error;
    }
  });
  const requiredIds = plan.steps.filter(step => step.required).map(step => step.step_id);
  const derivedComplete = requiredIds.every(id => completed.includes(id));
  const requestedStatus = text(patch.status, 40);
  const status = requestedStatus === 'failed'
    ? 'failed'
    : (derivedComplete ? 'complete' : (requestedStatus === 'running' ? 'running' : 'partial'));
  const task = storage.getTask(taskId) || {};
  const record = {
    contract_version: CONTRACT_VERSION,
    plan_id: plan.plan_id,
    scope_id: plan.scope_id,
    input_fingerprint: plan.input_fingerprint,
    producer_bundle_id: plan.producer_bundle_id,
    status,
    completed_step_ids: completed,
    artifacts,
    failed_step_id: text(patch.failed_step_id || '', 200),
    error_code: text(patch.error_code || '', 160),
    error_message: text(patch.error_message || '', 500),
    release_envelope: releaseBundle.envelope({
      content_revision: Number(options.content_revision || task.content_revision || 1) || 1,
    }),
    updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, checkpointKind(plan.scope_id), record, {
    content_revision: Number(options.content_revision || task.content_revision || 1) || 1,
    input_fingerprint: plan.input_fingerprint,
    qa_status: status === 'complete' ? 'published' : 'checkpoint',
  });
  return record;
}

function nextSteps(plan, currentCheckpoint = null) {
  assertCheckpointCompatible(plan, currentCheckpoint);
  const completed = new Set(currentCheckpoint?.completed_step_ids || []);
  return plan.steps.filter(step => !completed.has(step.step_id)
    && (step.depends_on || []).every(dependency => completed.has(dependency)));
}

async function runStep({ taskId, plan, stepId, execute, contentRevision = 0 } = {}) {
  if (typeof execute !== 'function') throw new TypeError('reference_expansion_executor_required');
  const current = checkpoint(taskId, plan.scope_id);
  assertCheckpointCompatible(plan, current);
  const step = nextSteps(plan, current).find(item => item.step_id === stepId);
  if (!step) {
    const error = new Error(`reference_expansion_step_not_ready:${stepId || 'missing'}`);
    error.code = 'REFERENCE_EXPANSION_STEP_NOT_READY';
    error.status = 409;
    throw error;
  }
  assertManagedStage(step.model_stage);
  try {
    const artifact = await execute(step, { plan, checkpoint: current });
    if (!artifact || !text(artifact.asset_hash || artifact.assetHash, 160)) {
      const error = new Error('reference_expansion_executor_asset_hash_required');
      error.code = 'REFERENCE_EXPANSION_ARTIFACT_INVALID';
      error.status = 422;
      throw error;
    }
    const currentBundleId = releaseBundle.identity().bundle_id;
    return saveCheckpoint(taskId, plan, {
      completed_step_ids: [step.step_id],
      artifacts: { [step.step_id]: { ...artifact, producer_bundle_id: currentBundleId } },
      status: 'partial',
    }, { content_revision: contentRevision });
  } catch (error) {
    saveCheckpoint(taskId, plan, {
      failed_step_id: step.step_id,
      error_code: error.code || 'REFERENCE_EXPANSION_STEP_FAILED',
      error_message: error.message || String(error),
      status: 'failed',
    }, { content_revision: contentRevision });
    throw error;
  }
}

module.exports = {
  CONTRACT_VERSION,
  CHECKPOINT_KIND: CHECKPOINT_PREFIX,
  CAPABILITY_ORDER,
  buildPlan,
  validatePlan,
  assertManagedStage,
  checkpoint,
  saveCheckpoint,
  nextSteps,
  runStep,
  evidenceReusable,
  assertCheckpointCompatible,
};
