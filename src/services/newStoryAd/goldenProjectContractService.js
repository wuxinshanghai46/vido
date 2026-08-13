'use strict';

const fs = require('fs');
const path = require('path');
const capabilityPacks = require('./capabilityPackService');

const REGISTRY_PATH = path.resolve(__dirname, '../../../config/story-ad-golden-projects.json');
const CORE_KINDS = ['context', 'scene_config', 'blueprint', 'storyboard_table', 'keyframes', 'tts_audio', 'video_clips', 'final_video'];

function rows(value) { return Array.isArray(value) ? value : []; }
function text(value = '') { return String(value ?? '').trim(); }
function readRegistry() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  if (registry.schema_version !== 1 || !Array.isArray(registry.projects) || registry.projects.length !== 3) {
    throw new Error('GOLDEN_PROJECT_REGISTRY_INVALID');
  }
  return registry;
}
function byId(id = '') {
  const project = readRegistry().projects.find(item => item.id === id);
  if (!project) throw new Error(`GOLDEN_PROJECT_NOT_FOUND:${id}`);
  return project;
}
function mediaUrl(value = {}) { return text(value.video_url || value.videoUrl || value.audio_url || value.image_url || value.url); }
function containsForbidden(value, terms = []) {
  const serialized = JSON.stringify(value || {});
  return rows(terms).filter(term => term && serialized.includes(term));
}
function combinedText(value) { return JSON.stringify(value || {}); }
function sceneItems(outputs = {}, context = {}) {
  const sceneConfig = outputs.scene_config || {};
  return rows(sceneConfig.scenes || sceneConfig.scene_plan || sceneConfig.spaces || context.scene_plan || context.scene_assets);
}
function identitySet(items = []) {
  return new Set(rows(items).map(item => text(item.permanent_id || item.stable_id || item.id)).filter(Boolean));
}
function firstNonEmpty(...values) {
  return values.map(rows).find(items => items.length) || [];
}
function hasStableReplans(snapshots = [], cycles = 0) {
  const required = Math.max(0, Number(cycles || 0));
  if (!required) return true;
  if (rows(snapshots).length < required + 1) return false;
  const baseline = snapshots[0] || {};
  const baselineSubjects = identitySet(baseline.subjects);
  const baselineScenes = identitySet(baseline.scenes);
  return snapshots.slice(1, required + 1).every(snapshot => {
    const subjects = identitySet(snapshot.subjects);
    const scenes = identitySet(snapshot.scenes);
    return baselineSubjects.size === subjects.size && baselineScenes.size === scenes.size
      && [...baselineSubjects].every(id => subjects.has(id)) && [...baselineScenes].every(id => scenes.has(id))
      && rows(snapshot.assets).every(asset => asset.reused !== false);
  });
}

function validateDefinition(project = {}) {
  const issues = [];
  const request = project.request || {};
  const expected = project.expected || {};
  const pack = capabilityPacks.resolve(request);
  if (request.brief_source !== 'user' || request.content_mode_source !== 'user') issues.push('user_authority_missing');
  if (pack.story_structure_id !== expected.story_structure) issues.push('story_structure_mismatch');
  if (pack.scene_prototype_id !== expected.scene_prototype) issues.push('scene_prototype_mismatch');
  const missingProofs = rows(expected.required_final_proofs).filter(proof => !pack.content_form.required_final_proofs.includes(proof));
  if (missingProofs.length) issues.push('required_final_proof_mismatch');
  if (!(Number(request.target_duration) > 0) || !text(request.output_ratio)) issues.push('delivery_contract_missing');
  if (!rows(expected.required_facts).length || Number(expected.min_scene_count || 0) < 1) issues.push('golden_fact_contract_missing');
  if (Number(expected.replan_cycles || 0) < 3) issues.push('replan_contract_too_weak');
  if (!rows(expected.allowed_model_variance).length || !rows(expected.ui_assertions).length || !rows(expected.media_assertions).length) {
    issues.push('acceptance_evidence_contract_missing');
  }
  return { ok: issues.length === 0, issues, pack, project_id: project.id };
}

function validateResult(project = {}, bundle = {}, options = {}) {
  const definition = validateDefinition(project);
  const issues = [...definition.issues];
  const warnings = [];
  const task = bundle.task || {};
  const work = bundle.work || null;
  const outputs = bundle.outputs || {};
  const context = outputs.context || work?.domain_payloads?.brief?.context || {};
  const storyboard = rows(outputs.storyboard_table || work?.domain_payloads?.storyboard);
  const scenes = sceneItems(outputs, context);
  const keyframes = rows(outputs.keyframes);
  const clips = rows(outputs.video_clips || work?.domain_payloads?.video);
  const finalVideo = outputs.final_video || work?.domain_payloads?.compose || null;
  if (!work || work.mode !== 'authoritative') issues.push('work_not_authoritative');
  if (text(context.brief) !== text(project.request.brief) || context.brief_source !== 'user') issues.push('user_brief_changed');
  if (context.content_mode !== project.request.content_mode || context.content_form !== project.request.content_form) issues.push('content_form_changed');
  if (context.capability_pack?.fingerprint !== definition.pack.fingerprint) issues.push('capability_pack_changed');
  if (!outputs.blueprint) issues.push('blueprint_missing');
  if (!outputs.scene_config) issues.push('scene_contract_missing');
  if (scenes.length < Number(project.expected?.min_scene_count || 0)) issues.push('scene_count_incomplete');
  if (!storyboard.length) issues.push('storyboard_missing');
  const permanentIds = storyboard.map(shot => text(shot.permanent_id || shot.shot_permanent_id || shot.id)).filter(Boolean);
  if (new Set(permanentIds).size !== permanentIds.length) issues.push('duplicate_shot_identity');
  if (storyboard.some(shot => !text(shot.scene_permanent_id || shot.scene_id || shot.scene_key))) issues.push('shot_scene_binding_missing');
  const authoredText = combinedText({ blueprint: outputs.blueprint, storyboard, scenes });
  const missingFacts = rows(project.expected?.required_facts).filter(fact => !authoredText.includes(fact));
  if (missingFacts.length) issues.push('required_user_fact_missing');
  const people = firstNonEmpty(context.cast_profiles, context.characters, context.people);
  const pets = firstNonEmpty(context.pet_profiles, context.pet_contract?.profiles);
  if (Number(project.expected?.expected_people || 0) !== people.length) issues.push('people_count_mismatch');
  if (Number(project.expected?.expected_animals || 0) !== pets.length) issues.push('animal_count_mismatch');
  const props = rows(context.prop_assets || outputs.prop_assets);
  if (pets.some(pet => props.some(prop => text(prop.id) === text(pet.id) || text(prop.name) === text(pet.name)))) issues.push('animal_classified_as_prop');
  if (project.request.reference_video_analysis) {
    if (!context.reference_video_analysis) issues.push('reference_analysis_missing');
    const advertisedSubject = text(context.product_subject || context.product_presentation?.subject);
    if (advertisedSubject !== text(project.request.product_subject)) issues.push('reference_overwrote_product');
    if (rows(project.expected?.reference_forbidden_subjects).some(subject => advertisedSubject.includes(subject))) issues.push('reference_became_subject');
  }
  if (!hasStableReplans(bundle.replan_snapshots, project.expected?.replan_cycles)) issues.push('replan_identity_or_asset_reuse_unproven');
  const evidence = bundle.acceptance_evidence || {};
  const evidenceClass = text(evidence.evidence_class);
  const evidencedUiAssertions = new Set(rows(evidence.ui_assertions).map(text));
  const evidencedMediaAssertions = new Set(rows(evidence.media_assertions).map(text));
  if (options.require_acceptance_evidence !== false) {
    if (rows(project.expected?.ui_assertions).some(assertion => !evidencedUiAssertions.has(text(assertion)))) issues.push('ui_acceptance_evidence_missing');
    if (rows(project.expected?.media_assertions).some(assertion => !evidencedMediaAssertions.has(text(assertion)))) issues.push('media_acceptance_evidence_missing');
  }
  if (options.require_real_evidence === true && evidenceClass !== 'real_production_route') issues.push('real_route_evidence_missing');
  const forbidden = containsForbidden({ context, blueprint: outputs.blueprint, storyboard }, project.expected?.forbidden_terms);
  if (forbidden.length) issues.push('forbidden_content_present');
  if (options.require_media !== false) {
    if (keyframes.length < storyboard.length || keyframes.some(frame => !mediaUrl(frame) || frame.qa?.pass !== true)) issues.push('approved_keyframes_incomplete');
    const clipCoverage = new Set();
    clips.forEach((clip, index) => rows(clip.member_indexes).length
      ? rows(clip.member_indexes).forEach(member => clipCoverage.add(Number(member)))
      : clipCoverage.add(Number(clip.shot_index ?? clip.index ?? index)));
    if (storyboard.some((_, index) => !clipCoverage.has(index)) || clips.some(clip => !mediaUrl(clip) || clip.qa?.pass !== true)) issues.push('approved_video_clips_incomplete');
    if (!outputs.tts_audio || !mediaUrl(outputs.tts_audio)) issues.push('tts_audio_missing');
    if (!finalVideo || !mediaUrl(finalVideo) || finalVideo.technical_qa?.pass !== true) issues.push('final_video_not_approved');
  }
  const generations = rows(bundle.generation_runs);
  if (generations.some(run => ['queued', 'submitted', 'running', 'billing_unknown'].includes(text(run.state)))) issues.push('generation_not_closed');
  if (generations.some(run => run.automatic_retry_allowed === true)) issues.push('automatic_paid_retry_enabled');
  if (Number(bundle.model_calls_started_after_completion || 0) > 0) warnings.push('post_completion_model_call_observed');
  if (task.status && !['done', 'completed'].includes(text(task.status).toLowerCase())) issues.push('task_not_completed');
  return {
    contract_version: 'story-ad-golden-v1', project_id: project.id, task_id: text(task.id),
    ok: issues.length === 0, release_eligible: issues.length === 0 && evidenceClass === 'real_production_route',
    evidence_class: evidenceClass || 'unclassified', issues: [...new Set(issues)], warnings: [...new Set(warnings)],
    counts: { storyboard: storyboard.length, keyframes: keyframes.length, clips: clips.length, generation_runs: generations.length },
    fingerprints: { capability_pack: definition.pack.fingerprint, work: text(work?.domain_fingerprints?.compose || work?.domain_fingerprints?.storyboard) },
  };
}

function bundleFromStorage(storage, taskId) {
  const acceptanceEvidence = storage.getOutput(taskId, 'golden_acceptance_evidence') || {};
  return {
    task: storage.getTask(taskId), work: storage.getWork(taskId),
    outputs: Object.fromEntries(CORE_KINDS.map(kind => [kind, storage.getOutput(taskId, kind)])),
    generation_runs: storage.listGenerationRuns().filter(run => text(run.task_id || run.work_id) === text(taskId)),
    acceptance_evidence: acceptanceEvidence,
    replan_snapshots: rows(acceptanceEvidence.replan_snapshots),
  };
}

module.exports = { CORE_KINDS, REGISTRY_PATH, bundleFromStorage, byId, readRegistry, validateDefinition, validateResult };
