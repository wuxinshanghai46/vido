'use strict';

const crypto = require('crypto');
const storage = require('./storageService');
const contentSkill = require('./contentSkillService');
const storySceneCoverage = require('./storySceneCoverageService');
const releaseBundle = require('../storyAdReleaseBundleService');

const CANDIDATE_KIND = 'asset_plan_candidate';
const ACTIVE_KIND = 'asset_plan_active';
const PLAN_DOMAINS = ['person', 'scene'];

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

function publish(taskId, rawPlan = {}, { fingerprint = '', source = '', model_meta = null, scope = 'all' } = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const candidateId = crypto.randomUUID();
  const compiledPlan = contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
    ? storySceneCoverage.compileAssetPlan(rawPlan)
    : rawPlan;
  const candidate = {
    ...compiledPlan,
    status: 'candidate',
    candidate_id: candidateId,
    content_revision: Number(task.content_revision || 1) || 1,
    fingerprint,
    story_scene_contract_version: contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
      ? storySceneCoverage.CONTRACT_VERSION
      : Number(context.story_scene_contract_version || 0),
    release_envelope: releaseBundle.envelope(),
    source,
    model_meta,
    validated_at: new Date().toISOString(),
  };
  const preflightIssues = contentSkill.mode(context.content_mode || context.product_presentation?.mode) === 'narrative_story'
    ? storySceneCoverage.coverageIssues(candidate, context)
    : [];
  storage.saveOutput(taskId, CANDIDATE_KIND, {
    ...candidate,
    validation_status: preflightIssues.length ? 'rejected' : 'passed',
    validation_issues: preflightIssues,
  });
  if (preflightIssues.length) {
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
  storage.saveOutput(taskId, ACTIVE_KIND, {
    plan_id: candidateId,
    active_revision: activeRevision,
    content_revision: activePlan.content_revision,
    fingerprint,
    release_envelope: activePlan.release_envelope,
    domain_state: activePlan.domain_state,
    plan: activePlan,
    activated_at: activePlan.activated_at,
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
  const carriedPlan = {
    ...plan,
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
  storage.saveOutput(taskId, ACTIVE_KIND, {
    ...active,
    active_revision: activeRevision,
    content_revision: nextContentRevision,
    plan: carriedPlan,
    carried_forward_at: carriedAt,
    carried_forward_reason: String(reason || ''),
  }, { content_revision: nextContentRevision });
  return carriedPlan;
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
  };
}

module.exports = {
  CANDIDATE_KIND,
  ACTIVE_KIND,
  currentPlan,
  activeRecord,
  planIssues,
  domainIssues,
  nextDomainState,
  publish,
  carryForward,
  eligibility,
};
