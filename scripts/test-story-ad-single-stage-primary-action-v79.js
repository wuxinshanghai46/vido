'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const recoverySource = `${read('public/story-ad/views/billingRecoveryBanner.js')}\n${read('public/story-ad/views/assetCheckpointRecovery.js')}`
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const recoverySandbox = { escapeHtml: value => String(value || '') };
vm.runInNewContext(`${recoverySource}\nglobalThis.__summary=checkpointRecoverySummary;globalThis.__banner=checkpointRecoveryBanner;`, recoverySandbox);
const planSource = `${read('public/story-ad/views/assetCenterPlanReleaseStatus.js')}\n${read('public/story-ad/views/assetCenterStageView.js')}`
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+\{.*$/gm, '').replace(/\bexport\s+/g, '');
const planSandbox = { makePersonGuard: () => ({}), makeGuardMap: () => ({}) };
vm.runInNewContext(`${planSource}\nglobalThis.__stage=assetPlanStageView;`, planSandbox);

function people(state, missing = 3) {
  if (!missing) return [];
  return [{ name: '人物', checkpoint_recovery_summary: {
    completed_units: 25, total_units: 28, retry_blocked: state !== 'not_billed',
    missing_units: Array.from({ length: missing }, (_, index) => ({ key: `missing-${index}`, label: `缺失${index + 1}`, billing_review_state: state })),
  } }];
}
function page(state, { missing = 3, eligible = false } = {}) {
  const summary = recoverySandbox.__summary(people(state, missing));
  summary.plan_eligible = eligible;
  const recoveryActive = summary.missing.length > 0 && ['pending', 'not_billed', 'unverifiable'].includes(summary.billing_review_state);
  return recoverySandbox.__banner(summary) + planSandbox.__stage({
    assetPlanReady: eligible, recoveryActive, eligibility: { eligible, issues: eligible ? [] : ['person_plan_stale'] },
    missingSubjectCount: missing, counts: { people: 4, animals: 0, scenes: 9 },
  });
}

const actionable = page('not_billed');
assert.match(actionable, /data-recovery-count="3"/);
assert.match(actionable, /data-update-person-plan[^>]*>先更新人物方案/);
assert.match(actionable, /自动切换为“生成剩余 3 项”/);
assert.doesNotMatch(actionable, /data-generate-recovery|人物方案需要更新|更新当前内容的人物方案|asset-visual-next-step/);
assert.equal((actionable.match(/data-(?:generate-recovery|update-person-plan)/g) || []).length, 1, '恢复阶段只能有一个主动作');

const pending = page('pending');
assert.match(pending, /data-update-person-plan/); assert.doesNotMatch(pending, /data-billing-review|人物方案需要更新/);
const completedButStale = page('completed', { missing: 0, eligible: false });
assert.doesNotMatch(completedButStale, /data-checkpoint-recovery-banner/);
assert.match(completedButStale, /data-update-person-plan/);
assert.match(completedButStale, /人物方案需要更新/);
const ordinaryStale = planSandbox.__stage({ assetPlanReady: false, recoveryActive: false, eligibility: { issues: ['person_plan_stale'] } });
assert.match(ordinaryStale, /data-update-person-plan/);
const readyRecovery = page('not_billed', { eligible: true });
assert.doesNotMatch(readyRecovery, /data-generate-missing-subjects|data-confirm-assets|asset-visual-next-step/);
assert.match(readyRecovery, /data-generate-recovery[^>]*>生成剩余 3 项/);

console.log(JSON.stringify({ passed: true, actionable_primary_actions: 1, pending_plan_cards: 0, completed_stale_plan_cards: 1, model_calls: 0 }));
