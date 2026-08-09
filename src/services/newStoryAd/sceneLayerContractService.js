'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const pipeline = require('../pipelineModelService');
const releaseBundle = require('../storyAdReleaseBundleService');

const CONTRACT_VERSION = 'scene-layer-contract-v6';
const CORE_KIND_PREFIX = 'scene_core_active:';
const ENHANCEMENT_CANDIDATE_PREFIX = 'scene_enhancement_candidate:';
const ENHANCEMENT_ACTIVE_PREFIX = 'scene_enhancement_active:';
const CHECKPOINT_PREFIX = 'scene_enhancement_checkpoint:';
const ENHANCEMENT_KEYS = new Set([
  'reference_evidence',
  'experience',
  'spatial',
  'visual_detail',
  'production_notes',
]);
const PROTECTED_KEYS = new Set([
  'id', 'scene_id', 'sceneId', 'production_scene_key', 'productionSceneKey',
  'narrative_visit_id', 'covered_beat_ids', 'coveredBeatIds', 'scene_spec',
  'topology_hash', 'base_visual', 'baseVisual', 'content_revision', 'core_revision', 'core_fingerprint',
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function assertManagedModelStage(stage = '', options = {}) {
  const id = cleanId(stage);
  if (!id) {
    if (options.required === true) {
      const error = new Error('scene_enhancement_model_stage_required');
      error.code = 'MODEL_STAGE_NOT_REGISTERED';
      error.status = 409;
      error.retryable = false;
      throw error;
    }
    return true;
  }
  if (!id.startsWith('new_story_ad.') || !pipeline.getStageMeta(id)) {
    const error = new Error(`scene_enhancement_model_stage_not_registered:${id}`);
    error.code = 'MODEL_STAGE_NOT_REGISTERED';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  return true;
}

function cleanId(value, max = 160) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniqueStrings(value, max = 128) {
  return [...new Set((Array.isArray(value) ? value : []).map(item => cleanId(item)).filter(Boolean))].slice(0, max);
}

function sceneIdOf(scene = {}) {
  return cleanId(scene.id || scene.scene_id || scene.sceneId);
}

function normalizeVisualArtifact(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const artifact = {
    asset_id: cleanId(value.asset_id || value.assetId || value.id),
    asset_hash: cleanId(value.asset_hash || value.assetHash || value.sha256),
    image_url: cleanId(value.image_url || value.imageUrl || value.url, 1000),
    lineage: clone(value.lineage || value.source_lineage || value.sourceLineage || {}),
  };
  return artifact.asset_hash ? artifact : null;
}

function normalizeBaseVisual(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const master = normalizeVisualArtifact(source.master || source.master_view || source.masterView || {});
  const atlas = normalizeVisualArtifact(source.atlas || source.atlas_view || source.atlasView || {});
  if (!master && !atlas) return null;
  return { master, atlas };
}

function kind(prefix, sceneId) {
  const id = cleanId(sceneId);
  if (!id) {
    const error = new Error('scene_id_required');
    error.code = 'SCENE_LAYER_CORE_INVALID';
    error.status = 422;
    throw error;
  }
  return `${prefix}${id}`;
}

function normalizeCore(scene = {}) {
  const id = sceneIdOf(scene);
  const core = {
    id,
    production_scene_key: cleanId(scene.production_scene_key || scene.productionSceneKey),
    narrative_visit_id: cleanId(scene.narrative_visit_id || scene.narrativeVisitId),
    covered_beat_ids: uniqueStrings(scene.covered_beat_ids || scene.coveredBeatIds),
    name: cleanId(scene.name || scene.title, 240),
    description: cleanId(scene.description, 2000),
    story_purpose: cleanId(scene.story_purpose || scene.storyPurpose, 2000),
    scene_spec: clone(scene.scene_spec || scene.sceneSpec || {}),
    topology_hash: cleanId(scene.topology_hash || scene.topologyHash),
    base_visual: normalizeBaseVisual(scene.base_visual || scene.baseVisual || {}),
  };
  const issues = [];
  if (!core.id) issues.push('scene_id_missing');
  if (!core.production_scene_key) issues.push('production_scene_key_missing');
  if (!core.covered_beat_ids.length) issues.push('covered_beat_ids_missing');
  if (!core.scene_spec || typeof core.scene_spec !== 'object' || Array.isArray(core.scene_spec)) {
    issues.push('scene_spec_invalid');
  }
  if (issues.length) {
    const error = new Error(`scene_core_invalid:${issues.join('|')}`);
    error.code = 'SCENE_LAYER_CORE_INVALID';
    error.status = 422;
    error.retryable = false;
    error.issues = issues;
    throw error;
  }
  return core;
}

function coreFingerprint(scene = {}) {
  return hash(normalizeCore(scene));
}

function recordBundleCurrent(record = {}) {
  return !!record && String(record.release_envelope?.producer_bundle_id || '') === releaseBundle.identity().bundle_id;
}

function coreEligibility(record = {}) {
  const issues = [];
  if (!record || typeof record !== 'object') return { eligible: false, issues: ['scene_core_missing'] };
  if (record.contract_version !== CONTRACT_VERSION) issues.push('scene_core_contract_mismatch');
  if (record.status !== 'active') issues.push('scene_core_status_invalid');
  if (!recordBundleCurrent(record)) issues.push('scene_core_bundle_mismatch');
  try {
    if (coreFingerprint(record.core || {}) !== record.core_fingerprint) issues.push('scene_core_fingerprint_mismatch');
  } catch {
    issues.push('scene_core_payload_invalid');
  }
  return { eligible: issues.length === 0, issues };
}

function activeCore(taskId, sceneId, options = {}) {
  const record = storage.getOutput(taskId, kind(CORE_KIND_PREFIX, sceneId));
  return options.include_incompatible === true || coreEligibility(record).eligible ? record : null;
}

function activeEnhancement(taskId, sceneId, options = {}) {
  const record = storage.getOutput(taskId, kind(ENHANCEMENT_ACTIVE_PREFIX, sceneId));
  return options.include_incompatible === true || recordBundleCurrent(record) ? record : null;
}

function checkpoint(taskId, sceneId, options = {}) {
  const record = storage.getOutput(taskId, kind(CHECKPOINT_PREFIX, sceneId));
  return options.include_incompatible === true || recordBundleCurrent(record) ? record : null;
}

function publishCore(taskId, scene, options = {}) {
  const core = normalizeCore(scene);
  const previous = activeCore(taskId, core.id);
  const fingerprint = coreFingerprint(core);
  if (previous && options.expected_core_revision !== undefined
    && Number(options.expected_core_revision) !== Number(previous.core_revision || 0)) {
    const error = new Error('scene_core_revision_conflict');
    error.code = 'SCENE_LAYER_CORE_REVISION_CONFLICT';
    error.status = 409;
    throw error;
  }
  if (previous?.core_fingerprint === fingerprint) return previous;
  const task = storage.getTask(taskId) || {};
  const record = {
    contract_version: CONTRACT_VERSION,
    status: 'active',
    scene_id: core.id,
    core_revision: Math.max(1, Number(previous?.core_revision || 0) + 1),
    content_revision: Number(options.content_revision || task.content_revision || 1) || 1,
    core_fingerprint: fingerprint,
    core,
    release_envelope: releaseBundle.envelope({
      content_revision: Number(options.content_revision || task.content_revision || 1) || 1,
    }),
    activated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, kind(CORE_KIND_PREFIX, core.id), record, {
    content_revision: record.content_revision,
    input_fingerprint: fingerprint,
    qa_status: 'published',
  });
  return record;
}

function normalizeEnhancementPatch(patch = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    const error = new Error('scene_enhancement_patch_object_required');
    error.code = 'SCENE_ENHANCEMENT_INVALID';
    error.status = 422;
    throw error;
  }
  const forbidden = Object.keys(patch).filter(key => PROTECTED_KEYS.has(key));
  const unknown = Object.keys(patch).filter(key => !ENHANCEMENT_KEYS.has(key));
  if (forbidden.length || unknown.length) {
    const error = new Error(`scene_enhancement_patch_out_of_scope:${[...forbidden, ...unknown].join('|')}`);
    error.code = 'SCENE_ENHANCEMENT_SCOPE_INVALID';
    error.status = 422;
    error.retryable = false;
    error.forbidden_keys = forbidden;
    error.unknown_keys = unknown;
    throw error;
  }
  if (!Object.keys(patch).length) {
    const error = new Error('scene_enhancement_patch_empty');
    error.code = 'SCENE_ENHANCEMENT_INVALID';
    error.status = 422;
    throw error;
  }
  return clone(patch);
}

function checkpointRecord(core, status, extra = {}) {
  return {
    contract_version: CONTRACT_VERSION,
    scene_id: core.scene_id,
    status,
    base_core_revision: core.core_revision,
    base_core_fingerprint: core.core_fingerprint,
    release_envelope: releaseBundle.envelope({ content_revision: core.content_revision }),
    updated_at: new Date().toISOString(),
    ...extra,
  };
}

function stageEnhancement(taskId, sceneId, patch, options = {}) {
  assertManagedModelStage(options.model_stage || options.modelStage, { required: options.requires_model === true });
  const core = activeCore(taskId, sceneId);
  if (!core || core.status !== 'active') {
    const error = new Error('active_scene_core_missing');
    error.code = 'ACTIVE_SCENE_CORE_MISSING';
    error.status = 409;
    throw error;
  }
  if (options.expected_core_fingerprint
    && String(options.expected_core_fingerprint) !== String(core.core_fingerprint)) {
    const error = new Error('scene_enhancement_base_changed');
    error.code = 'SCENE_ENHANCEMENT_BASE_CHANGED';
    error.status = 409;
    throw error;
  }
  const normalized = normalizeEnhancementPatch(patch);
  if (typeof options.validate === 'function') options.validate(normalized, core);
  const candidate = {
    contract_version: CONTRACT_VERSION,
    status: 'candidate',
    candidate_id: crypto.randomUUID(),
    scene_id: core.scene_id,
    base_core_revision: core.core_revision,
    base_core_fingerprint: core.core_fingerprint,
    enhancement_fingerprint: hash(normalized),
    enhancements: normalized,
    release_envelope: releaseBundle.envelope({ content_revision: core.content_revision }),
    created_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, kind(ENHANCEMENT_CANDIDATE_PREFIX, sceneId), candidate, {
    content_revision: core.content_revision,
    input_fingerprint: core.core_fingerprint,
    qa_status: 'candidate',
  });
  storage.saveOutput(taskId, kind(CHECKPOINT_PREFIX, sceneId), checkpointRecord(core, 'candidate_ready', {
    candidate_id: candidate.candidate_id,
    enhancement_fingerprint: candidate.enhancement_fingerprint,
  }), { content_revision: core.content_revision, input_fingerprint: core.core_fingerprint });
  return candidate;
}

function activateEnhancement(taskId, sceneId, options = {}) {
  const core = activeCore(taskId, sceneId);
  const candidate = storage.getOutput(taskId, kind(ENHANCEMENT_CANDIDATE_PREFIX, sceneId));
  if (!core || !candidate) {
    const error = new Error('scene_enhancement_candidate_missing');
    error.code = 'SCENE_ENHANCEMENT_CANDIDATE_MISSING';
    error.status = 409;
    throw error;
  }
  if (candidate.base_core_revision !== core.core_revision
    || candidate.base_core_fingerprint !== core.core_fingerprint) {
    const error = new Error('scene_enhancement_candidate_stale');
    error.code = 'SCENE_ENHANCEMENT_BASE_CHANGED';
    error.status = 409;
    throw error;
  }
  if (options.candidate_id && String(options.candidate_id) !== String(candidate.candidate_id)) {
    const error = new Error('scene_enhancement_candidate_conflict');
    error.code = 'SCENE_ENHANCEMENT_CANDIDATE_CONFLICT';
    error.status = 409;
    throw error;
  }
  if (typeof options.validate === 'function') options.validate(candidate.enhancements, core);
  const previous = activeEnhancement(taskId, sceneId);
  const record = {
    ...candidate,
    status: 'active',
    enhancement_revision: Math.max(1, Number(previous?.enhancement_revision || 0) + 1),
    activated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, kind(ENHANCEMENT_ACTIVE_PREFIX, sceneId), record, {
    content_revision: core.content_revision,
    input_fingerprint: core.core_fingerprint,
    qa_status: 'published',
  });
  storage.saveOutput(taskId, kind(CHECKPOINT_PREFIX, sceneId), checkpointRecord(core, 'complete', {
    candidate_id: candidate.candidate_id,
    enhancement_revision: record.enhancement_revision,
    enhancement_fingerprint: record.enhancement_fingerprint,
  }), { content_revision: core.content_revision, input_fingerprint: core.core_fingerprint });
  return record;
}

function composeActiveScene(coreRecord, enhancementRecord = null) {
  if (!coreRecord?.core || !coreEligibility(coreRecord).eligible) return null;
  const enhancement = enhancementRecord
    && enhancementRecord.status === 'active'
    && enhancementRecord.contract_version === CONTRACT_VERSION
    && recordBundleCurrent(enhancementRecord)
    && enhancementRecord.base_core_revision === coreRecord.core_revision
    && enhancementRecord.base_core_fingerprint === coreRecord.core_fingerprint
    ? clone(enhancementRecord.enhancements)
    : {};
  return {
    ...clone(coreRecord.core),
    enhancements: enhancement,
    scene_layer_contract_version: CONTRACT_VERSION,
    core_revision: coreRecord.core_revision,
    core_fingerprint: coreRecord.core_fingerprint,
    enhancement_revision: Number(enhancementRecord?.enhancement_revision || 0),
  };
}

async function enhance(taskId, sceneId, builder, options = {}) {
  if (typeof builder !== 'function') throw new TypeError('scene_enhancement_builder_required');
  assertManagedModelStage(options.model_stage || options.modelStage, { required: options.requires_model === true });
  const core = activeCore(taskId, sceneId);
  if (!core) {
    const error = new Error('active_scene_core_missing');
    error.code = 'ACTIVE_SCENE_CORE_MISSING';
    error.status = 409;
    throw error;
  }
  const activeBefore = activeEnhancement(taskId, sceneId);
  storage.saveOutput(taskId, kind(CHECKPOINT_PREFIX, sceneId), checkpointRecord(core, 'running'), {
    content_revision: core.content_revision,
    input_fingerprint: core.core_fingerprint,
  });
  try {
    const patch = await builder(clone(core.core), {
      core_revision: core.core_revision,
      core_fingerprint: core.core_fingerprint,
      active_enhancement: clone(activeBefore),
    });
    const candidate = stageEnhancement(taskId, sceneId, patch, {
      ...options,
      expected_core_fingerprint: core.core_fingerprint,
    });
    return activateEnhancement(taskId, sceneId, { ...options, candidate_id: candidate.candidate_id });
  } catch (error) {
    storage.saveOutput(taskId, kind(CHECKPOINT_PREFIX, sceneId), checkpointRecord(core, 'failed', {
      error_code: cleanId(error.code || 'SCENE_ENHANCEMENT_FAILED'),
      error_message: cleanId(error.message || error, 500),
      active_enhancement_revision_preserved: Number(activeBefore?.enhancement_revision || 0),
    }), { content_revision: core.content_revision, input_fingerprint: core.core_fingerprint });
    throw error;
  }
}

module.exports = {
  CONTRACT_VERSION,
  CORE_KIND: CORE_KIND_PREFIX,
  ENHANCEMENT_CANDIDATE_KIND: ENHANCEMENT_CANDIDATE_PREFIX,
  ENHANCEMENT_ACTIVE_KIND: ENHANCEMENT_ACTIVE_PREFIX,
  CHECKPOINT_KIND: CHECKPOINT_PREFIX,
  normalizeCore,
  normalizeBaseVisual,
  assertManagedModelStage,
  coreFingerprint,
  coreEligibility,
  recordBundleCurrent,
  activeCore,
  activeEnhancement,
  checkpoint,
  publishCore,
  stageEnhancement,
  activateEnhancement,
  composeActiveScene,
  enhance,
};
