'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const contentSkill = require('./contentSkillService');
const storySceneCoverage = require('./storySceneCoverageService');
const taskStateAudit = require('./taskStateAuditService');
const authorityLifecycle = require('./authorityLifecycleService');
const releaseBundle = require('../storyAdReleaseBundleService');

const CANDIDATE_KIND = 'asset_plan_candidate';
const ACTIVE_KIND = 'asset_plan_active';
const RELEASE_MIGRATION_KIND = 'asset_plan_release_migration';
const FINGERPRINT_CONTRACT = 'asset-plan-input-v15';
const LEGACY_FINGERPRINT_CONTRACT = 'asset-plan-input-v14';
const PLAN_DOMAINS = ['person', 'scene'];
const ENVELOPE_CONTRACT_FIELDS = [
  'contract_version',
  'story_facts_schema_version',
  'normalizer_version',
  'topology_compiler_version',
  'validator_version',
  'scene_layer_contract_version',
  'reference_expansion_contract_version',
  'storyboard_coverage_contract_version',
];

function clean(value) { return String(value ?? '').trim(); }

function itemId(item = {}) {
  return clean(item.permanent_id || item.stable_id || item.id || item.cast_id
    || item.scene_id || item.space_id || item.prop_id || item.pet_id || item.beat_id);
}

function stableIdentityIssues(plan = {}) {
  const groups = [
    ['cast_profiles', plan.cast_profiles],
    ['pet_profiles', plan.pet_profiles],
    ['prop_plan', plan.prop_plan],
    ['scene_plan.spaces', plan.scene_plan?.spaces],
    ['story_seed.plot_beats', plan.story_seed?.plot_beats],
  ];
  const issues = [];
  groups.forEach(([label, values]) => {
    if (!Array.isArray(values)) return;
    const ids = values.map(itemId);
    ids.forEach((id, index) => { if (!id) issues.push(`stable_id_missing:${label}[${index}]`); });
    const populated = ids.filter(Boolean);
    if (new Set(populated).size !== populated.length) issues.push(`stable_id_duplicate:${label}`);
  });
  return issues;
}

function legacyV14Proof(taskId, task = {}, context = {}, expectedFingerprint = '') {
  const revision = Number(task.content_revision || 1) || 1;
  const artifact = storage.listArtifacts(taskId, 'context')
    .find(row => Number(row.source_content_revision || revision) === revision)?.payload;
  const backup = storage.getOutput(taskId, 'person_demographics_migration_backup_v63')?.context;
  const sources = [context, task.request, artifact, backup];
  const fingerprintService = require('./assetPlanService');
  const legacyFingerprint = fingerprintService.legacyFingerprintV14;
  const fingerprints = sources.map(source => (source && typeof source === 'object'
    ? legacyFingerprint(task, source)
    : ''));
  const currentFingerprints = sources.map(source => (source && typeof source === 'object'
    ? fingerprintService.fingerprint(task, source)
    : ''));
  return {
    proven: fingerprints.length === 4
      && fingerprints.every(value => value && value === clean(expectedFingerprint))
      && currentFingerprints.every(value => value && value === currentFingerprints[0]),
    source_count: fingerprints.filter(Boolean).length,
    sources_equal: new Set(fingerprints.filter(Boolean)).size === 1,
    current_sources_equal: new Set(currentFingerprints.filter(Boolean)).size === 1,
    current_fingerprint: currentFingerprints[0],
  };
}

function releaseCompatibility({ task = {}, context = {}, plan = {}, activeRecord: active = null, candidate = null, fingerprint = '' } = {}) {
  const identity = releaseBundle.identity();
  const currentEnvelope = releaseBundle.envelope();
  const previousEnvelope = plan?.release_envelope || {};
  const issues = [];
  if (!plan || typeof plan !== 'object') issues.push('active_plan_missing');
  else {
    if (clean(plan.status) !== 'active') issues.push('active_plan_status_invalid');
    if (!clean(previousEnvelope.producer_bundle_id)) issues.push('active_plan_bundle_missing');
    if (!active || clean(active.plan_id) !== clean(plan.candidate_id)
      || Number(active.active_revision || 0) !== Number(plan.active_revision || 0)
      || clean(active.fingerprint) !== clean(plan.fingerprint)
      || clean(active.fingerprint_contract) !== clean(plan.fingerprint_contract)) issues.push('active_plan_record_inconsistent');
    if (!candidate || clean(candidate.candidate_id) !== clean(plan.candidate_id)
      || clean(candidate.fingerprint) !== clean(plan.fingerprint)
      || clean(candidate.fingerprint_contract) !== clean(plan.fingerprint_contract)
      || Number(candidate.content_revision || 0) !== Number(plan.content_revision || 0)
      || clean(candidate.validation_status) !== 'passed') issues.push('asset_plan_candidate_inconsistent');
    if (Number(plan.content_revision || 0) !== Number(task.content_revision || 1)) issues.push('active_plan_content_revision_mismatch');
    const previousFingerprintContract = clean(plan.fingerprint_contract);
    if (previousFingerprintContract) {
      if (previousFingerprintContract === FINGERPRINT_CONTRACT) {
        if (!clean(fingerprint) || clean(plan.fingerprint) !== clean(fingerprint)) issues.push('active_plan_input_fingerprint_mismatch');
      } else if (previousFingerprintContract === LEGACY_FINGERPRINT_CONTRACT) {
        const proof = legacyV14Proof(task.id, task, context, plan.fingerprint);
        if (!proof.proven) issues.push('active_plan_legacy_v14_proof_failed');
        else if (!clean(fingerprint) || clean(fingerprint) !== proof.current_fingerprint) issues.push('active_plan_input_fingerprint_mismatch');
      } else issues.push('active_plan_fingerprint_contract_mismatch');
    } else {
      // Pre-contract plans carry an opaque digest produced by the release that
      // created them. Re-hashing their context with today's projection can
      // create false drift when defaults/normalizers changed. The persist-time
      // lineage marker plus unchanged content revision is the legacy proof.
      if (!clean(context.asset_plan_fingerprint)) issues.push('legacy_asset_plan_lineage_missing');
      else if (clean(context.asset_plan_fingerprint) !== clean(plan.fingerprint)) issues.push('legacy_asset_plan_lineage_mismatch');
    }
    ENVELOPE_CONTRACT_FIELDS.forEach((field) => {
      if (!clean(previousEnvelope[field]) || clean(previousEnvelope[field]) !== clean(currentEnvelope[field])) {
        issues.push(`active_plan_contract_component_mismatch:${field}`);
      }
    });
    if (contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story') {
      if (Number(plan.story_scene_contract_version || 0) !== storySceneCoverage.CONTRACT_VERSION) issues.push('active_plan_contract_mismatch');
      issues.push(...storySceneCoverage.coverageIssues(plan, context).map(issue => `coverage:${issue}`));
    }
    issues.push(...stableIdentityIssues(plan));
  }
  const uniqueIssues = [...new Set(issues)];
  const alreadyCurrent = clean(previousEnvelope.producer_bundle_id) === identity.bundle_id;
  return {
    compatible: uniqueIssues.length === 0,
    migration_required: uniqueIssues.length === 0 && !alreadyCurrent,
    already_current: uniqueIssues.length === 0 && alreadyCurrent,
    issues: uniqueIssues,
    from_bundle_id: clean(previousEnvelope.producer_bundle_id),
    to_bundle_id: identity.bundle_id,
    content_revision: Number(task.content_revision || 1) || 1,
    fingerprint: clean(fingerprint),
    fingerprint_contract: FINGERPRINT_CONTRACT,
    fingerprint_basis: clean(plan?.fingerprint_contract) === LEGACY_FINGERPRINT_CONTRACT
      ? 'legacy_v14_four_source_exact_match'
      : (clean(plan?.fingerprint_contract) ? 'same_contract_strict_hash' : 'legacy_revision_and_persisted_lineage'),
  };
}

function domainMarker(plan = {}, fallback = {}) {
  return {
    bundle_id: String(plan.release_envelope?.producer_bundle_id || fallback.bundle_id || ''),
    fingerprint: String(plan.fingerprint || fallback.fingerprint || ''),
    content_revision: Number(plan.content_revision || fallback.content_revision || 0),
    updated_at: String(plan.activated_at || fallback.updated_at || ''),
  };
}

function nextDomainState(previous = null, candidate = {}, scope = 'all') {
  const previousPlan = previous?.plan || {};
  const previousState = previousPlan.domain_state || previous?.domain_state || {};
  const inherited = Object.fromEntries(PLAN_DOMAINS.map(domain => [
    domain,
    previousState[domain] || domainMarker(previousPlan, previous || {}),
  ]));
  const current = domainMarker(candidate);
  if (scope === 'all') return { person: current, scene: current };
  if (!PLAN_DOMAINS.includes(scope)) throw new Error(`Unsupported asset plan publication scope: ${scope}`);
  return { ...inherited, [scope]: current };
}

function domainIssues(plan = {}, task = {}) {
  const state = plan.domain_state;
  if (!state || typeof state !== 'object') return [];
  const identity = releaseBundle.identity();
  return PLAN_DOMAINS.flatMap(domain => {
    const marker = state[domain] || {};
    const current = String(marker.bundle_id || '') === identity.bundle_id
      && String(marker.fingerprint || '') === String(plan.fingerprint || '')
      && Number(marker.content_revision || 0) === Number(task.content_revision || 1);
    return current ? [] : [`${domain}_plan_stale`];
  });
}

function currentPlan(taskId) {
  const active = storage.getOutput(taskId, ACTIVE_KIND);
  return active?.plan || null;
}

function activeRecord(taskId) { return storage.getOutput(taskId, ACTIVE_KIND) || null; }

function planIssues({ task = {}, context = {}, plan = {}, fingerprint = '' } = {}) {
  const issues = [];
  const identity = releaseBundle.identity();
  if (!plan || typeof plan !== 'object') return ['active_plan_missing'];
  const envelope = plan.release_envelope || {};
  if (String(plan.status || '') !== 'active') issues.push('active_plan_status_invalid');
  if (String(envelope.producer_bundle_id || '') !== identity.bundle_id) issues.push('active_plan_bundle_mismatch');
  if (String(plan.fingerprint || '') !== String(fingerprint || '')) issues.push('active_plan_input_fingerprint_mismatch');
  if (Number(plan.content_revision || 0) !== Number(task.content_revision || 1)) issues.push('active_plan_content_revision_mismatch');
  issues.push(...domainIssues(plan, task));
  if (contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story') {
    if (Number(plan.story_scene_contract_version || 0) !== storySceneCoverage.CONTRACT_VERSION) issues.push('active_plan_contract_mismatch');
    issues.push(...storySceneCoverage.coverageIssues(plan, context).map(issue => `coverage:${issue}`));
  }
  return [...new Set(issues)];
}

function publish(taskId, rawPlan = {}, { fingerprint = '', source = '', model_meta = null, scope = 'all',
  production_graph_authority = false, generation_id = '', generationId = '' } = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const candidateId = crypto.randomUUID();
  const personOnly = scope === 'person';
  const compiledPlan = !personOnly && contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
    ? storySceneCoverage.compileAssetPlan(rawPlan)
    : rawPlan;
  const candidate = {
    ...compiledPlan,
    status: 'candidate',
    candidate_id: candidateId,
    content_revision: Number(task.content_revision || 1) || 1,
    fingerprint,
    fingerprint_contract: FINGERPRINT_CONTRACT,
    story_scene_contract_version: contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
      ? storySceneCoverage.CONTRACT_VERSION
      : Number(context.story_scene_contract_version || 0),
    release_envelope: releaseBundle.envelope(),
    source,
    model_meta,
    validated_at: new Date().toISOString(),
  };
  // A person-only publication is deliberately allowed before scene topology
  // exists. Its scene domain remains stale and therefore cannot authorize
  // storyboard/scene generation, while the current person domain can safely
  // authorize independent subject-image generation.
  const preflightIssues = !personOnly && contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
    ? storySceneCoverage.coverageIssues(candidate, context)
    : [];
  const validatedCandidate = {
    ...candidate,
    validation_status: preflightIssues.length ? 'rejected' : 'passed',
    validation_issues: preflightIssues,
  };
  if (preflightIssues.length) {
    storage.saveOutput(taskId, CANDIDATE_KIND, validatedCandidate);
    const error = new Error(`资产计划候选未通过当前合同：${preflightIssues.join('；')}`);
    error.code = 'ASSET_PLAN_CANDIDATE_REJECTED';
    error.status = 422;
    error.retryable = true;
    error.details = preflightIssues;
    throw error;
  }
  const previous = activeRecord(taskId);
  const activeRevision = Math.max(1, Number(previous?.active_revision || 0) + 1);
  const activePlan = {
    ...candidate,
    domain_state: nextDomainState(previous, candidate, scope),
    publication_scope: scope,
    status: 'active',
    active_revision: activeRevision,
    activated_at: new Date().toISOString(),
  };
  // ACTIVE_KIND is the sole generation authority. The legacy asset_plan output
  // remains a read projection only and cannot authorize paid execution.
  const nextActive = {
    plan_id: candidateId,
    active_revision: activeRevision,
    content_revision: activePlan.content_revision,
    fingerprint,
    fingerprint_contract: FINGERPRINT_CONTRACT,
    release_envelope: activePlan.release_envelope,
    domain_state: activePlan.domain_state,
    plan: activePlan,
    activated_at: activePlan.activated_at,
  };
  storage.withWriteBatch(() => {
    const authority = authorityLifecycle.activate(taskId, activePlan, nextActive, validatedCandidate, {
      production_graph_authority: production_graph_authority === true,
      generation_id: generation_id || generationId,
    });
    Object.assign(activePlan, {
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
    });
    storage.saveOutput(taskId, ACTIVE_KIND, {
      ...nextActive,
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
      plan: activePlan,
    });
  });
  return activePlan;
}

function carryForward(taskId, { contentRevision = 0, reason = '' } = {}) {
  const task = storage.getTask(taskId);
  const active = activeRecord(taskId);
  const plan = active?.plan;
  if (!task || !plan) return null;
  const nextContentRevision = Math.max(1, Number(contentRevision || task.content_revision || 1) || 1);
  const blockingIssues = planIssues({
    task: { ...task, content_revision: Number(plan.content_revision || 1) || 1 },
    context: storage.getOutput(taskId, 'context') || task.request || {},
    plan,
    fingerprint: active.fingerprint || plan.fingerprint || '',
  }).filter(issue => issue !== 'active_plan_content_revision_mismatch');
  if (blockingIssues.length) return null;
  const carriedAt = new Date().toISOString();
  const activeRevision = Math.max(1, Number(active.active_revision || plan.active_revision || 0) + 1);
  const candidateId = crypto.randomUUID();
  const carriedPlan = {
    ...plan,
    candidate_id: candidateId,
    content_revision: nextContentRevision,
    domain_state: Object.fromEntries(PLAN_DOMAINS.map(domain => [domain, {
      ...(plan.domain_state?.[domain] || domainMarker(plan, active)),
      content_revision: nextContentRevision,
    }])),
    active_revision: activeRevision,
    carried_from_content_revision: Number(plan.content_revision || 1) || 1,
    carried_forward_at: carriedAt,
    carried_forward_reason: String(reason || ''),
  };
  const carriedCandidate = {
    ...carriedPlan,
    status: 'candidate',
    validation_status: 'passed',
    validation_issues: [],
    carried_from_plan_id: active.plan_id || plan.candidate_id || '',
  };
  const nextActive = {
    ...active,
    plan_id: candidateId,
    active_revision: activeRevision,
    content_revision: nextContentRevision,
    plan: carriedPlan,
    carried_forward_at: carriedAt,
    carried_forward_reason: String(reason || ''),
  };
  storage.withWriteBatch(() => {
    const authority = authorityLifecycle.activate(taskId, carriedPlan, nextActive, carriedCandidate);
    Object.assign(carriedPlan, {
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
    });
    storage.saveOutput(taskId, ACTIVE_KIND, {
      ...nextActive,
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
      plan: carriedPlan,
    }, { content_revision: nextContentRevision });
  });
  return carriedPlan;
}

function migrateCompatibleRelease(taskId, {
  fingerprint = '', reason = 'user_requested_plan_refresh', generationId = '', generation_id: legacyGenerationId = '',
} = {}) {
  const task = storage.getTask(taskId);
  const active = activeRecord(taskId);
  const plan = active?.plan || null;
  const candidate = storage.getOutput(taskId, CANDIDATE_KIND);
  const context = storage.getOutput(taskId, 'context') || task?.request || {};
  const compatibility = releaseCompatibility({ task, context, plan, activeRecord: active, candidate, fingerprint });
  if (!compatibility.compatible || !compatibility.migration_required) {
    return { migrated: false, compatibility, plan };
  }
  const currentGenerationId = clean(generationId || legacyGenerationId);
  const billingRisk = taskStateAudit.billingRiskForTask(storage.readDb(), taskId);
  const safetyIssues = [];
  const legacyV14Migration = compatibility.fingerprint_basis === 'legacy_v14_four_source_exact_match';
  if (task?.active_generation_id
    && (legacyV14Migration || clean(task.active_generation_id) !== currentGenerationId)) safetyIssues.push('active_generation_exists');
  if (billingRisk.active_unknown_billing.length) safetyIssues.push('active_unknown_billing_exists');
  if (billingRisk.unquarantined_unknown_billing.length) safetyIssues.push('unknown_billing_unquarantined');
  if (safetyIssues.length) return {
    migrated: false,
    blocked: true,
    compatibility: { ...compatibility, compatible: false, issues: safetyIssues },
    plan,
  };
  const migratedAt = new Date().toISOString();
  const nextEnvelope = releaseBundle.envelope({
    migrated_from_bundle_id: compatibility.from_bundle_id,
    migrated_at: migratedAt,
    migration_reason: clean(reason),
  });
  const nextDomainState = Object.fromEntries(PLAN_DOMAINS.map(domain => [domain, {
    ...(plan.domain_state?.[domain] || {}),
    bundle_id: compatibility.to_bundle_id,
    fingerprint: compatibility.fingerprint,
    content_revision: compatibility.content_revision,
    updated_at: migratedAt,
  }]));
  const nextPlan = {
    ...plan,
    fingerprint: compatibility.fingerprint,
    fingerprint_contract: FINGERPRINT_CONTRACT,
    content_revision: compatibility.content_revision,
    release_envelope: nextEnvelope,
    domain_state: nextDomainState,
    migrated_from_bundle_id: compatibility.from_bundle_id,
    migrated_at: migratedAt,
    migration_reason: clean(reason),
  };
  const nextActive = {
    ...active,
    content_revision: compatibility.content_revision,
    fingerprint: compatibility.fingerprint,
    fingerprint_contract: FINGERPRINT_CONTRACT,
    release_envelope: nextEnvelope,
    domain_state: nextDomainState,
    plan: nextPlan,
    migrated_from_bundle_id: compatibility.from_bundle_id,
    migrated_at: migratedAt,
  };
  const nextCandidate = {
    ...nextPlan,
    status: 'candidate',
    validation_status: 'passed',
    validation_issues: [],
    migration_only: true,
  };
  const migrationRecord = {
    schema_version: 1,
    status: 'prepared',
    model_call_count: 0,
    plan_id: active.plan_id || plan.candidate_id || '',
    active_revision: Number(active.active_revision || plan.active_revision || 0),
    content_revision: compatibility.content_revision,
    fingerprint: compatibility.fingerprint,
    fingerprint_contract: FINGERPRINT_CONTRACT,
    fingerprint_basis: compatibility.fingerprint_basis,
    from_bundle_id: compatibility.from_bundle_id,
    to_bundle_id: compatibility.to_bundle_id,
    reason: clean(reason),
    migrated_at: migratedAt,
  };
  // The storage batch is a real SQLite transaction (or one atomic JSON batch),
  // so authority, plan, candidate and migration become visible together.
  storage.withWriteBatch(() => {
    const authority = authorityLifecycle.activate(taskId, nextPlan, nextActive, nextCandidate);
    Object.assign(nextPlan, {
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
    });
    Object.assign(nextActive, {
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
      plan: nextPlan,
    });
    Object.assign(nextCandidate, {
      authority_id: authority.authority_id,
      authority_token: authority.authority_token,
      execution_identity: authority.execution_identity,
    });
    storage.saveOutput(taskId, CANDIDATE_KIND, nextCandidate, { content_revision: compatibility.content_revision });
    storage.saveOutput(taskId, 'asset_plan', nextPlan, { content_revision: compatibility.content_revision });
    storage.saveOutput(taskId, RELEASE_MIGRATION_KIND, migrationRecord, { content_revision: compatibility.content_revision });
    storage.saveOutput(taskId, ACTIVE_KIND, nextActive, { content_revision: compatibility.content_revision });
  });
  let auditFinalized = true;
  try {
    storage.saveOutput(taskId, RELEASE_MIGRATION_KIND, { ...migrationRecord, status: 'completed' }, { content_revision: compatibility.content_revision });
  } catch {
    // Active is already the current authority. Keep the prepared receipt for a
    // read-only audit/retry instead of rolling the plan back across releases.
    auditFinalized = false;
  }
  return {
    migrated: true,
    compatibility,
    plan: nextPlan,
    audit_finalized: auditFinalized,
    record: storage.getOutput(taskId, RELEASE_MIGRATION_KIND),
  };
}

function eligibility(taskId, { fingerprint = '' } = {}) {
  const task = storage.getTask(taskId) || {};
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const active = activeRecord(taskId);
  const plan = active?.plan || null;
  const issues = planIssues({ task, context, plan, fingerprint });
  const failedStage = String(task.stage || '').toLowerCase();
  const planningFailed = /^(scene_config|person_plan|scene_plan|asset_plan|story_facts|story_development|scene_coverage|topology)(?:_|$)/.test(failedStage)
    && /_failed$/.test(failedStage);
  if (planningFailed) issues.push('task_current_planning_stage_failed');
  const uniqueIssues = [...new Set(issues)];
  const releaseMigration = releaseCompatibility({
    task,
    context,
    plan,
    activeRecord: active,
    candidate: storage.getOutput(taskId, CANDIDATE_KIND),
    fingerprint,
  });
  const domainEligibility = domain => ({
    eligible: !uniqueIssues.includes(`${domain}_plan_stale`)
      && !uniqueIssues.some(issue => issue.startsWith('active_plan_') || issue === 'task_current_planning_stage_failed'),
    issues: uniqueIssues.filter(issue => issue === `${domain}_plan_stale` || issue.startsWith('active_plan_') || issue === 'task_current_planning_stage_failed'),
  });
  return {
    eligible: uniqueIssues.length === 0,
    issues: uniqueIssues,
    person: domainEligibility('person'),
    scene: domainEligibility('scene'),
    plan_id: active?.plan_id || '',
    active_revision: Number(active?.active_revision || 0),
    content_revision: Number(task.content_revision || 1) || 1,
    release_bundle_id: releaseBundle.identity().bundle_id,
    plan_bundle_id: plan?.release_envelope?.producer_bundle_id || '',
    topology_hash: plan?.story_seed?.topology_hash || plan?.scene_plan?.topology_hash || '',
    release_migration: releaseMigration,
  };
}

module.exports = {
  CANDIDATE_KIND,
  ACTIVE_KIND,
  RELEASE_MIGRATION_KIND,
  FINGERPRINT_CONTRACT,
  LEGACY_FINGERPRINT_CONTRACT,
  legacyV14Proof,
  stableIdentityIssues,
  releaseCompatibility,
  migrateCompatibleRelease,
  currentPlan,
  activeRecord,
  planIssues,
  domainIssues,
  nextDomainState,
  publish,
  carryForward,
  eligibility,
};
