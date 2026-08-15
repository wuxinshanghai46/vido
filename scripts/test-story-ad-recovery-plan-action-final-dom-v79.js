'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+\{.*$/gm, '').replace(/\bexport\s+/g, '');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const recoverySandbox = { escapeHtml };
vm.runInNewContext(`${executable('public/story-ad/views/billingRecoveryBanner.js')}\n${executable('public/story-ad/views/assetCheckpointRecovery.js')}\nglobalThis.__recovery={checkpointRecoverySummary,checkpointRecoveryBanner};`, recoverySandbox);
const planSandbox = {
  makeGuardMap: () => guard(),
  makePersonGuard: () => guard(),
};
vm.runInNewContext(`${executable('public/story-ad/views/assetCenterPlanReleaseStatus.js')}\n${executable('public/story-ad/views/assetCenterStageView.js')}\nglobalThis.__plan={personPlanBlockedView,assetPlanStageView};`, planSandbox);

function guard() {
  return { active: false, run: async (...args) => {
    const operation = args.find(value => typeof value === 'function');
    return operation ? operation('request-key') : false;
  } };
}
function control() {
  return {
    dataset: {}, files: [], value: '', disabled: false, isConnected: true,
    addEventListener() {}, click() {}, classList: { toggle() {} },
  };
}

const billingSandbox = {
  request: async () => ({}), setButtonBusy() {}, toast() {}, setTimeout() {},
  document: { visibilityState: 'visible' },
};
vm.runInNewContext(`${executable('public/story-ad/views/assetCenterBillingRetry.js')}\nglobalThis.__bind=bindSubjectBillingRecovery;`, billingSandbox);

const viewSandbox = {
  __loadAssetCheckpointRecovery: async () => recoverySandbox.__recovery,
  __loadAssetCenterStage: async () => ({ assetPlanStageView: planSandbox.__plan.assetPlanStageView }),
  request: async () => ({}),
  bindMediaLightbox() {},
  emptyState: ({ title = '', body = '', action = '', actionId = '' } = {}) => `<section data-empty><b>${title}</b><p>${body}</p><button data-empty-action="${actionId}">${action}</button></section>`,
  escapeHtml, setButtonBusy() {}, toast() {}, confirmDialog: async () => false,
  openActorLibrary() {}, openRealPersonFlow() {}, authorizeBillingReviews: async () => {},
  bindSubjectBillingRecovery: billingSandbox.__bind,
  confirmBillingAwareAction: async () => ({ accepted: false }),
  collectPersonLookValues: values => values, renderPersonLookTiles: () => '',
  legacyDossierBoard: () => '', mediaSection: () => '', assetCardMedia: () => '<span data-media></span>',
  assertSavedPerson() {}, personAgeDisplay: profile => profile.age_range || '',
  personAssetState: item => item.dossier_sheet?.image_url ? 'complete_dossier' : 'partial',
  personLookSummary: () => '', bindPersonEvolutionForm() {}, collectPersonEvolutionValues: values => values,
  renderPersonEvolutionSummary: () => '', createKeyedRequestGuard: guard, createPersonPlanRequestGuard: guard,
  personPlanBlockedView: planSandbox.__plan.personPlanBlockedView,
};
vm.runInNewContext(`${executable('public/story-ad/views/assetCenterView.js')}\nglobalThis.__mount=mount;`, viewSandbox, { filename: 'assetCenterView.js' });

function person(summary = null) {
  return {
    id: 'person-1', asset_id: 'person-1', subject_id: 'person-1', name: '林知月', status: 'partial',
    profile: { id: 'person-1', displayName: '林知月', roleName: '主角', age_range: '25~35岁', ethnicity: '原创', appearanceText: '现代人物', look_profiles: [{ id: 'look-1', wardrobeText: '日常服装' }] },
    ...(summary ? { checkpoint_recovery_summary: summary } : {}),
  };
}
function recovery(state) {
  if (state === 'complete') return { completed_units: 28, total_units: 28, missing_units: [], retry_blocked: false, billing_review_state: 'completed' };
  const retryBlocked = state !== 'not_billed';
  return {
    completed_units: 25, total_units: 28, retry_blocked: retryBlocked, billing_review_state: state,
    missing_units: Array.from({ length: 3 }, (_, index) => ({
      key: `missing-${index + 1}`, unit: `wearable_accessory:slot-${index + 1}`, label: `缺失项${index + 1}`,
      reason: '待处理', billing_review_state: state, billing_state: state === 'not_billed' ? 'not_billed' : 'unknown',
      provider_submission_state: state === 'not_billed' ? 'submission_rejected' : 'submitted_unknown', retry_blocked: retryBlocked,
    })),
  };
}
function tags(html) {
  return [...html.matchAll(/<button\b([^>]*)>/g)].map(match => ({
    raw: match[0], attrs: match[1], disabled: /\sdisabled(?:\s|=|$)/.test(match[1]),
  }));
}
function withAttr(buttons, attr) { return buttons.filter(button => new RegExp(`\\b${attr}(?:\\s|=|$)`).test(button.attrs)); }
function recoveryCards(html) {
  return [...html.matchAll(/<section\b[^>]*data-checkpoint-recovery-banner[^>]*>[\s\S]*?<\/section>/g)].map(match => match[0]);
}
function independentPlanCards(html) {
  return [...html.matchAll(/<section\b[^>]*class="[^"]*asset-visual-next-step[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map(match => match[0]);
}
function primaryStateActions(html) {
  return tags(html).filter(button => /data-(?:generate-recovery|update-person-plan|billing-review|accept-billing-risk|generate-missing-subjects)\b/.test(button.attrs));
}

async function render({ checkpoint = null, stale = true, active = false } = {}) {
  let html = '';
  const host = {
    isConnected: true,
    get innerHTML() { return html; }, set innerHTML(value) { html = value; },
    querySelector: () => control(), querySelectorAll: () => [],
  };
  const bundle = {
    project: { id: 'task-v79', active_generation_id: active ? 'generation-active' : '', content_mode: 'narrative_story' },
    revisions: { content: 9 }, brief: { text: '剧情目标', cast_mode: 'single' },
    navigation: { asset_plan_eligibility: { eligible: !stale, person: { eligible: !stale, issues: stale ? ['active_plan_stale'] : [] } } },
    assets: { people: [person(checkpoint)], animals: [], products: [], logos: [], scenes: [] },
  };
  await viewSandbox.__mount(host, {
    store: { runStage: async () => {}, updateRequest: async () => bundle, refreshSections: async () => {} },
    bundle, refreshShell: async () => {}, refreshCurrentView: async () => {}, navigate() {},
  });
  return { html, buttons: tags(html) };
}

(async () => {
  const staleRecovery = await render({ checkpoint: recovery('not_billed'), stale: true });
  assert.equal(recoveryCards(staleRecovery.html).length, 1, 'recovery+stale must render one recovery state card');
  assert.equal(independentPlanCards(staleRecovery.html).length, 0, 'recovery card must own the stage instead of duplicating the plan card');
  assert.equal(primaryStateActions(staleRecovery.html).length, 1, 'recovery+stale must expose one state-machine action');
  assert.equal(withAttr(staleRecovery.buttons, 'data-update-person-plan').length, 1,
    'an ineligible plan must be updated before the paid recovery route can be called');
  assert.equal(withAttr(staleRecovery.buttons, 'data-generate-recovery').length, 0,
    'the known 409 recovery action must not be shown before plan eligibility is restored');
  assert.equal(withAttr(staleRecovery.buttons, 'data-update-person-plan')[0].disabled, false);
  assert.match(recoveryCards(staleRecovery.html)[0], /data-recovery-count="3"/,
    'the final DOM must expose the current missing count structurally, not only in copy');

  const safeRecovery = await render({ checkpoint: recovery('not_billed'), stale: false });
  assert.equal(recoveryCards(safeRecovery.html).length, 1);
  assert.equal(independentPlanCards(safeRecovery.html).length, 0);
  assert.equal(primaryStateActions(safeRecovery.html).length, 1);
  assert.equal(withAttr(safeRecovery.buttons, 'data-generate-recovery').length, 1,
    'after person-plan eligibility is restored, the same recovery card must switch to generate-only');
  assert.equal(withAttr(safeRecovery.buttons, 'data-update-person-plan').length, 0);
  assert.equal(withAttr(safeRecovery.buttons, 'data-generate-recovery')[0].disabled, false);

  const pending = await render({ checkpoint: recovery('pending'), stale: true });
  assert.equal(recoveryCards(pending.html).length, 1);
  assert.equal(independentPlanCards(pending.html).length, 0);
  assert.equal(primaryStateActions(pending.html).length, 1);
  assert.equal(withAttr(pending.buttons, 'data-update-person-plan').length, 1,
    'plan eligibility remains the first gate even while billing review is pending');
  assert.equal(withAttr(pending.buttons, 'data-billing-review').length, 0);
  assert.equal(withAttr(pending.buttons, 'data-generate-recovery').length, 0);

  const unverifiable = await render({ checkpoint: recovery('unverifiable'), stale: true });
  assert.equal(recoveryCards(unverifiable.html).length, 1);
  assert.equal(independentPlanCards(unverifiable.html).length, 0);
  assert.equal(primaryStateActions(unverifiable.html).length, 1);
  assert.equal(withAttr(unverifiable.buttons, 'data-update-person-plan').length, 1);
  assert.equal(withAttr(unverifiable.buttons, 'data-accept-billing-risk').length, 0,
    'duplicate-charge acceptance must not precede the active-plan eligibility gate');

  const eligiblePending = await render({ checkpoint: recovery('pending'), stale: false });
  assert.equal(primaryStateActions(eligiblePending.html).length, 1);
  assert.equal(withAttr(eligiblePending.buttons, 'data-billing-review').length, 1,
    'when the plan is eligible, pending billing review remains the next gate');
  assert.equal(withAttr(eligiblePending.buttons, 'data-update-person-plan').length, 0);

  const completedStale = await render({ checkpoint: recovery('complete'), stale: true });
  assert.equal(withAttr(completedStale.buttons, 'data-generate-recovery').length, 0);
  assert.equal(withAttr(completedStale.buttons, 'data-billing-review').length, 0);
  assert.equal(withAttr(completedStale.buttons, 'data-update-person-plan').length, 1,
    'after recovery has no missing units, a genuinely stale person plan must become actionable again');
  assert.equal(withAttr(completedStale.buttons, 'data-update-person-plan')[0].disabled, false);

  const ordinaryStale = await render({ checkpoint: null, stale: true });
  assert.equal(withAttr(ordinaryStale.buttons, 'data-update-person-plan').length, 1,
    'ordinary stale plan without checkpoint recovery must preserve the update action');
  assert.equal(withAttr(ordinaryStale.buttons, 'data-update-person-plan')[0].disabled, false);

  const activeStale = await render({ checkpoint: null, stale: true, active: true });
  assert.equal(withAttr(activeStale.buttons, 'data-update-person-plan').length, 1);
  assert.equal(withAttr(activeStale.buttons, 'data-update-person-plan')[0].disabled, true,
    'active generation must continue disabling plan mutation');

  console.log(JSON.stringify({ passed: true, stale_recovery_update_actions: 1, eligible_recovery_generate_actions: 1, pending_plan_gate_actions: 1, completed_stale_update_actions: 1, model_calls: 0 }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
