'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const cancellation = require('./cancellationContext');
const contentSkill = require('./contentSkillService');
const releaseBundle = require('../storyAdReleaseBundleService');

const CONTRACT_VERSION = 'asset-plan-section-recovery-v2';
const SECTIONS = Object.freeze(['cast_profiles', 'prop_plan', 'scene_plan', 'story_seed']);
const SECTION_SET = new Set(SECTIONS);
const SECTION_ALIASES = Object.freeze({
  cast_profiles: ['castProfiles'],
  prop_plan: ['propPlan'],
  scene_plan: ['scenePlan', 'scene_config', 'sceneConfig'],
  story_seed: ['storySeed'],
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function clean(value = '', max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function own(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function sectionValue(source = {}, section = '') {
  if (own(source, section)) return source[section];
  const alias = (SECTION_ALIASES[section] || []).find(key => own(source, key));
  if (alias) return source[alias];
  return undefined;
}

function sectionPresent(source = {}, section = '') {
  return own(source, section) || (SECTION_ALIASES[section] || []).some(key => own(source, key));
}

function mode(ctx = {}) {
  return contentSkill.mode(ctx.content_mode || ctx.product_presentation?.mode);
}

function expectedCastRule(ctx = {}) {
  const castMode = clean(ctx.cast_mode, 40).toLowerCase();
  const explicit = Math.max(0, Number(ctx.expected_people || 0) || 0);
  if (['no_human', 'animal'].includes(castMode)) return { kind: 'exact', count: 0 };
  if (explicit > 0) return { kind: 'exact', count: explicit };
  if (castMode === 'single' || castMode === 'human_pet') return { kind: 'exact', count: 1 };
  if (castMode === 'dual') return { kind: 'exact', count: 2 };
  if (['multi', 'group'].includes(castMode)) return { kind: 'minimum', count: 2 };
  return { kind: 'open', count: 0 };
}

function castDiagnostics(source = {}, ctx = {}) {
  const present = sectionPresent(source, 'cast_profiles');
  const value = sectionValue(source, 'cast_profiles');
  const issues = [];
  if (!present) issues.push('cast_profiles_key_missing');
  else if (!Array.isArray(value)) issues.push('cast_profiles_not_array');
  if (Array.isArray(value)) {
    const rule = expectedCastRule(ctx);
    if (rule.kind === 'exact' && value.length !== rule.count) {
      issues.push(`cast_profiles_count_mismatch:${value.length}/${rule.count}`);
    }
    if (rule.kind === 'minimum' && value.length < rule.count) {
      issues.push(`cast_profiles_count_below_minimum:${value.length}/${rule.count}`);
    }
  }
  return { present, valid: issues.length === 0, issues, value };
}

function commercialSubject(source = {}, ctx = {}) {
  const scene = sectionValue(source, 'scene_plan') || {};
  return clean(
    ctx.product_subject
      || ctx.product_presentation?.subject
      || ctx.advertised_subject_contract?.subject
      || ctx.product_contract?.advertised_subject_contract?.subject
      || source.advertised_subject_contract?.subject
      || scene.advertised_subject,
    300,
  );
}

function standaloneProductRequired(source = {}, ctx = {}) {
  const contract = source.advertised_subject_contract
    || ctx.advertised_subject_contract
    || ctx.product_contract?.advertised_subject_contract
    || {};
  const presentationModes = [
    contract.presentation?.mode,
    contract.presentation_mode,
    ctx.product_presentation?.mode,
  ].map(value => clean(value, 80).toLowerCase()).filter(Boolean);
  const assetRequirement = contract.asset_requirement || contract.assetRequirement || {};
  const productControl = ctx.controlled_production?.product_control || ctx.controlledProduction?.productControl || {};
  return presentationModes.includes('standalone_product')
    || assetRequirement.visual_lock_required === true
    || productControl.enabled === true
    || Boolean(ctx.product_asset)
    || ctx.product_asset_required === true
    || ctx.requires_standalone_product_asset === true
    || contract.requires_standalone_asset === true;
}

function propDiagnostics(source = {}, ctx = {}) {
  const present = sectionPresent(source, 'prop_plan');
  const value = sectionValue(source, 'prop_plan');
  const issues = [];
  if (!present) issues.push('prop_plan_key_missing');
  else if (!Array.isArray(value)) issues.push('prop_plan_not_array');
  if (Array.isArray(value)) {
    const advertisedProducts = value.filter(item => clean(item?.type, 80).toLowerCase() === 'advertised_product');
    if (mode(ctx) === 'narrative_story') {
      if (advertisedProducts.length) issues.push('narrative_prop_plan_contains_advertised_product');
      // An explicit empty array is a valid, authoritative no-prop story plan.
    } else {
      const subject = commercialSubject(source, ctx);
      if (!subject) issues.push('commercial_advertised_subject_missing');
      if (standaloneProductRequired(source, ctx) && !advertisedProducts.length) {
        issues.push('commercial_standalone_product_prop_missing');
      }
    }
  }
  return { present, valid: issues.length === 0, issues, value };
}

function objectSectionDiagnostics(source = {}, section = '', validator = null) {
  const present = sectionPresent(source, section);
  const value = sectionValue(source, section);
  const issues = [];
  if (!present) issues.push(`${section}_key_missing`);
  else if (!value || typeof value !== 'object' || Array.isArray(value)) issues.push(`${section}_not_object`);
  if (!issues.length && typeof validator === 'function') {
    const result = validator(value, source);
    if (result === false) issues.push(`${section}_contract_invalid`);
    else if (Array.isArray(result)) issues.push(...result.map(item => `${section}:${clean(item, 500)}`));
  }
  return { present, valid: issues.length === 0, issues, value };
}

function sectionDiagnostics(source = {}, ctx = {}, validators = {}) {
  return {
    cast_profiles: castDiagnostics(source, ctx),
    prop_plan: propDiagnostics(source, ctx),
    scene_plan: objectSectionDiagnostics(source, 'scene_plan', validators.scene_plan),
    story_seed: objectSectionDiagnostics(source, 'story_seed', validators.story_seed),
  };
}

function validSections(source = {}, ctx = {}, validators = {}) {
  const diagnostics = sectionDiagnostics(source, ctx, validators);
  return SECTIONS.filter(section => diagnostics[section].valid);
}

function missingSections(source = {}, ctx = {}, validators = {}) {
  const valid = new Set(validSections(source, ctx, validators));
  return SECTIONS.filter(section => !valid.has(section));
}

function assertRequiredSectionsCandidate(candidate = {}, required = [], ctx = {}, validators = {}) {
  const requested = [...new Set((Array.isArray(required) ? required : []).map(String))];
  const unknown = requested.filter(section => !SECTION_SET.has(section));
  if (!requested.length || unknown.length) {
    const error = new Error(`asset_plan_required_missing_sections_invalid:${unknown.join('|') || 'empty'}`);
    error.code = 'ASSET_PLAN_REQUIRED_SECTIONS_INVALID';
    error.status = 422;
    throw error;
  }
  const diagnostics = sectionDiagnostics(candidate, ctx, validators);
  const incomplete = requested.flatMap(section => (
    diagnostics[section].valid ? [] : diagnostics[section].issues
  ));
  if (incomplete.length) {
    const error = new Error(`asset_plan_required_missing_sections_incomplete:${incomplete.join('|')}`);
    error.code = 'ASSET_PLAN_SECTION_RECOVERY_INCOMPLETE';
    error.status = 502;
    error.retryable = true;
    error.required_missing_sections = requested;
    error.section_issues = incomplete;
    throw error;
  }
  return true;
}

function validateSectionPatch(raw = {}, section = '', ctx = {}, validators = {}) {
  if (!SECTION_SET.has(section)) {
    const error = new Error(`asset_plan_section_patch_unknown:${section}`);
    error.code = 'ASSET_PLAN_SECTION_PATCH_INVALID';
    error.status = 422;
    throw error;
  }
  const rootKeys = Object.keys(raw || {}).sort();
  if (rootKeys.join(',') !== 'required_missing_sections,section_patch') {
    const error = new Error(`asset_plan_section_patch_root_invalid:${rootKeys.join('|')}`);
    error.code = 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID';
    error.status = 422;
    throw error;
  }
  const declared = Array.isArray(raw.required_missing_sections) ? raw.required_missing_sections.map(String) : [];
  if (declared.length !== 1 || declared[0] !== section) {
    const error = new Error(`asset_plan_section_patch_required_sections_mismatch:${declared.join('|')}`);
    error.code = 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID';
    error.status = 422;
    throw error;
  }
  const patch = raw.section_patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)
    || Object.keys(patch).sort().join(',') !== 'section,value'
    || String(patch.section || '') !== section) {
    const error = new Error('asset_plan_section_patch_envelope_invalid');
    error.code = 'ASSET_PLAN_SECTION_PATCH_SCOPE_INVALID';
    error.status = 422;
    throw error;
  }
  assertRequiredSectionsCandidate({ [section]: patch.value }, [section], ctx, validators);
  return patch.value;
}

function mergeSectionPatch(base = {}, raw = {}, section = '', ctx = {}, validators = {}) {
  const value = validateSectionPatch(raw, section, ctx, validators);
  return { ...base, [section]: value };
}

function resolveGenerationId(task = {}, options = {}) {
  const current = cancellation.current() || {};
  const explicit = clean(options.generation_id || options.generationId || current.generationId || task.active_generation_id, 160);
  if (explicit) return explicit;
  const fingerprint = clean(options.fingerprint, 160);
  return `direct:${task.id || 'task'}:r${Number(task.content_revision || 1) || 1}:${fingerprint.slice(0, 24) || 'no-fingerprint'}`;
}

function checkpointCompatibility(task = {}, checkpoint = null, options = {}) {
  const issues = [];
  const bundleId = releaseBundle.identity().bundle_id;
  const contentRevision = Number(options.content_revision || options.contentRevision || task.content_revision || 1) || 1;
  const fingerprint = clean(options.fingerprint, 160);
  const generationId = resolveGenerationId(task, options);
  const current = cancellation.current() || {};
  if (!fingerprint) issues.push('checkpoint_fingerprint_missing');
  if (Number(task.content_revision || 1) !== contentRevision) issues.push('task_content_revision_changed');
  if (task.required_bundle_id && clean(task.required_bundle_id, 200) !== bundleId) issues.push('task_bundle_mismatch');
  if (task.active_generation_id && clean(task.active_generation_id, 160) !== generationId) issues.push('task_generation_changed');
  if (current.generationId && clean(current.generationId, 160) !== generationId) issues.push('context_generation_changed');
  if (current.expectedContentRevision && Number(current.expectedContentRevision) !== contentRevision) issues.push('context_content_revision_changed');
  if (checkpoint) {
    if (checkpoint.contract_version !== CONTRACT_VERSION) issues.push('checkpoint_contract_mismatch');
    if (clean(checkpoint.release_envelope?.producer_bundle_id, 200) !== bundleId) issues.push('checkpoint_bundle_mismatch');
    if (Number(checkpoint.content_revision || 0) !== contentRevision) issues.push('checkpoint_content_revision_mismatch');
    if (clean(checkpoint.fingerprint, 160) !== fingerprint) issues.push('checkpoint_fingerprint_mismatch');
    if (clean(checkpoint.content_mode, 80) !== mode(options.ctx || {})) issues.push('checkpoint_content_mode_mismatch');
    if (clean(checkpoint.generation_id, 160) !== generationId && options.allow_generation_handoff !== true) {
      issues.push('checkpoint_generation_mismatch');
    }
  }
  return {
    compatible: issues.length === 0,
    issues: [...new Set(issues)],
    bundle_id: bundleId,
    content_revision: contentRevision,
    fingerprint,
    generation_id: generationId,
  };
}

function sectionHashes(payload = {}) {
  return Object.fromEntries(SECTIONS.filter(section => sectionPresent(payload, section))
    .map(section => [section, hash(sectionValue(payload, section))]));
}

function saveCheckpointAtomic(taskId, kind, payload = {}, ctx = {}, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('asset_plan_checkpoint_task_missing');
  const previous = storage.getOutput(taskId, kind);
  let authority = checkpointCompatibility(task, previous, { ...options, ctx });
  const replaceIncompatible = options.replace_incompatible === true;
  if (!authority.compatible && previous && replaceIncompatible) {
    authority = checkpointCompatibility(task, null, { ...options, ctx });
  }
  if (!authority.compatible) {
    const error = new Error(`asset_plan_checkpoint_cas_failed:${authority.issues.join('|')}`);
    error.code = 'ASSET_PLAN_CHECKPOINT_CAS_FAILED';
    error.status = 409;
    error.retryable = false;
    error.cas_issues = authority.issues;
    throw error;
  }
  const hashes = sectionHashes(payload);
  const priorRevisions = previous?.section_revisions || {};
  const priorHashes = previous?.section_hashes || {};
  const revisions = Object.fromEntries(Object.entries(hashes).map(([section, value]) => [
    section,
    value === priorHashes[section]
      ? Math.max(1, Number(priorRevisions[section] || 1))
      : Math.max(1, Number(priorRevisions[section] || 0) + 1),
  ]));
  const diagnostics = sectionDiagnostics(payload, ctx, options.validators || {});
  const record = {
    ...(replaceIncompatible && !checkpointCompatibility(task, previous, { ...options, ctx }).compatible ? {} : (previous || {})),
    contract_version: CONTRACT_VERSION,
    status: options.status || 'partial',
    generation_id: authority.generation_id,
    content_revision: authority.content_revision,
    fingerprint: authority.fingerprint,
    content_mode: mode(ctx),
    release_envelope: releaseBundle.envelope({
      content_revision: authority.content_revision,
      generation_id: authority.generation_id,
    }),
    reusable: validSections(payload, ctx, options.validators || {}).length > 0,
    valid_sections: validSections(payload, ctx, options.validators || {}),
    missing_sections: missingSections(payload, ctx, options.validators || {}),
    required_missing_sections: missingSections(payload, ctx, options.validators || {}),
    section_diagnostics: Object.fromEntries(SECTIONS.map(section => [section, diagnostics[section].issues])),
    section_hashes: hashes,
    section_revisions: revisions,
    payload,
    created_at: previous?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(options.extra || {}),
  };
  // saveOutput performs the final synchronous content-revision check. No await
  // occurs between the authority read and this write, so another generation
  // cannot interleave inside this process.
  storage.saveOutput(taskId, kind, record, {
    content_revision: authority.content_revision,
    input_fingerprint: authority.fingerprint,
    qa_status: 'checkpoint',
  });
  return record;
}

module.exports = {
  CONTRACT_VERSION,
  SECTIONS,
  sectionValue,
  sectionPresent,
  expectedCastRule,
  commercialSubject,
  standaloneProductRequired,
  sectionDiagnostics,
  validSections,
  missingSections,
  assertRequiredSectionsCandidate,
  validateSectionPatch,
  mergeSectionPatch,
  resolveGenerationId,
  checkpointCompatibility,
  saveCheckpointAtomic,
};
