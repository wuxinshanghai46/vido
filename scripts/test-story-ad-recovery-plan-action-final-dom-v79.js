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
  escapeHtml,
};
vm.runInNewContext(`${executable('public/story-ad/views/assetCenterInlineProgress.js')}\n${executable('public/story-ad/views/assetCenterTechnicalDetails.js')}\n${executable('public/story-ad/views/assetCenterPlanReleaseStatus.js')}\n${executable('public/story-ad/views/assetCenterStageView.js')}\nglobalThis.__plan={personPlanBlockedView,assetPlanStageView};`, planSandbox);

function guard() {
  return { active: false, run: async (...args) => {
    const operation = args.find(value => typeof value === 'function');
    return operation ? operation('request-key') : false;
  } };
}
function control() {
  return {
    dataset: {}, files: [], value: '', disabled: false, isConnected: true,
    addEventListener(type, handler) { this.listeners ||= {}; this.listeners[type] = handler; },
    async click() {
      if (this.disabled) return false;
      const result = this.listeners?.click?.({ currentTarget: this, preventDefault() {} });
      await result;
      await new Promise(resolve => setImmediate(resolve));
      return result;
    },
    classList: { toggle() {} }, hidden: true, textContent: '',
  };
}

let preflightRequestImpl = async () => ({ state: 'ready', safe_to_continue: true, differences: [] });
const billingSandbox = {
  request: (...args) => preflightRequestImpl(...args), setButtonBusy() {}, toast() {}, setTimeout() {},
  document: { visibilityState: 'visible' },
};
vm.runInNewContext(`${executable('public/story-ad/views/assetCenterBillingRetry.js')}\nglobalThis.__billing={bindSubjectBillingRecovery,recoveryRequestKey,ensureSubjectRecoveryReady};`, billingSandbox);
const preflightSandbox = { request: (...args) => preflightRequestImpl(...args) };
vm.runInNewContext(`${executable('public/story-ad/views/subjectRecoveryPreflightAction.js')}\nglobalThis.__ensure=ensureSubjectRecoveryReady;`, preflightSandbox);

let stageLoads = 0;
let confirmationImpl = async () => ({ accepted: false });
const viewSandbox = {
  __loadAssetCheckpointRecovery: async () => recoverySandbox.__recovery,
  __loadAssetCenterStage: async () => { stageLoads += 1; return { assetPlanStageView: planSandbox.__plan.assetPlanStageView }; },
  request: async () => ({}),
  bindMediaLightbox() {},
  emptyState: ({ title = '', body = '', action = '', actionId = '' } = {}) => `<section data-empty><b>${title}</b><p>${body}</p><button data-empty-action="${actionId}">${action}</button></section>`,
  escapeHtml, setButtonBusy() {}, toast() {}, confirmDialog: async () => false,
  openActorLibrary() {}, openRealPersonFlow() {}, authorizeBillingReviews: async () => {},
  bindSubjectBillingRecovery: billingSandbox.__billing.bindSubjectBillingRecovery,
  recoveryRequestKey: billingSandbox.__billing.recoveryRequestKey,
  ensureSubjectRecoveryReady: options => preflightSandbox.__ensure({ ...options, setButtonBusy() {}, toast() {} }),
  confirmBillingAwareAction: (...args) => confirmationImpl(...args),
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
    profile: { id: 'person-1', displayName: '林知月', roleName: '主角', age_range: '25~35岁', ethnicity: '原创', appearanceText: '现代人物', hairMakeupText: '黑色长发，淡妆', look_profiles: [{ id: 'look-1', wardrobeText: '日常服装' }] },
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

async function render({ checkpoint = null, stale = true, active = false, historicalReadOnly = false,
  preflight = null, confirmation = null } = {}) {
  let html = '';
  const controls = new Map();
  const getControl = selector => {
    if (!controls.has(selector)) controls.set(selector, control());
    const node = controls.get(selector);
    if (/data-generate-recovery/.test(selector)) {
      const tag = html.match(/<button\b[^>]*data-generate-recovery[^>]*>/)?.[0] || '';
      node.disabled = /\sdisabled(?:\s|=|>)/.test(tag);
    }
    return node;
  };
  const host = {
    isConnected: true,
    get innerHTML() { return html; }, set innerHTML(value) { html = value; },
    querySelector: getControl, querySelectorAll: () => [],
  };
  const bundle = {
    project: { id: 'task-v79', active_generation_id: active ? 'generation-active' : '', content_mode: 'narrative_story' },
    revisions: { content: 9 }, brief: { text: '剧情目标', cast_mode: 'single' },
    navigation: { asset_plan_eligibility: { eligible: !stale, person: { eligible: !stale, issues: stale ? ['active_plan_stale'] : [] } } },
    assets: { people: [person(checkpoint)], animals: [], products: [], logos: [], scenes: [] },
  };
  const runStageCalls = [];
  preflightRequestImpl = preflight || (async () => ({ state: 'ready', safe_to_continue: true, differences: [] }));
  confirmationImpl = confirmation || (async () => ({ accepted: false }));
  await viewSandbox.__mount(host, {
    store: { runStage: async (...args) => { runStageCalls.push(args); }, updateRequest: async () => bundle, refreshSections: async () => {} },
    bundle, historicalReadOnly, refreshShell: async () => {}, refreshCurrentView: async () => {}, navigate() {},
  });
  return { html, buttons: tags(html), controls, runStageCalls };
}

async function main() {
  const staleRecovery = await render({ checkpoint: recovery('not_billed'), stale: true });
  assert.equal(recoveryCards(staleRecovery.html).length, 1, 'recovery+stale must render one recovery state card');
  assert.equal(independentPlanCards(staleRecovery.html).length, 0, 'recovery card must own the stage instead of duplicating the plan card');
  assert.equal(primaryStateActions(staleRecovery.html).length, 1, 'recovery+stale must expose one state-machine action');
  assert.equal(withAttr(staleRecovery.buttons, 'data-update-person-plan').length, 0,
    'recovery must not expose the internal person-plan repair operation as a second action');
  assert.equal(withAttr(staleRecovery.buttons, 'data-generate-recovery').length, 1,
    'the single result-oriented action must run recovery preflight before any paid operation');
  assert.equal(withAttr(staleRecovery.buttons, 'data-generate-recovery')[0].disabled, false);
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
  assert.equal(withAttr(pending.buttons, 'data-update-person-plan').length, 0,
    'pending review must not expose an unrelated plan update action');
  assert.equal(withAttr(pending.buttons, 'data-billing-review').length, 0);
  assert.equal(withAttr(pending.buttons, 'data-generate-recovery').length, 1);
  assert.equal(withAttr(pending.buttons, 'data-generate-recovery')[0].disabled, true,
    'pending billing review keeps the single result action disabled');

  const unverifiable = await render({ checkpoint: recovery('unverifiable'), stale: true });
  assert.equal(recoveryCards(unverifiable.html).length, 1);
  assert.equal(independentPlanCards(unverifiable.html).length, 0);
  assert.equal(primaryStateActions(unverifiable.html).length, 1);
  assert.equal(withAttr(unverifiable.buttons, 'data-update-person-plan').length, 0);
  assert.equal(withAttr(unverifiable.buttons, 'data-generate-recovery').length, 1);
  assert.equal(withAttr(unverifiable.buttons, 'data-generate-recovery')[0].disabled, false);
  assert.equal(withAttr(unverifiable.buttons, 'data-accept-billing-risk').length, 0,
    'duplicate-charge acceptance belongs in the later billing confirmation, not a second card action');

  const eligiblePending = await render({ checkpoint: recovery('pending'), stale: false });
  assert.equal(primaryStateActions(eligiblePending.html).length, 1);
  assert.equal(withAttr(eligiblePending.buttons, 'data-billing-review').length, 0);
  assert.equal(withAttr(eligiblePending.buttons, 'data-generate-recovery').length, 1,
    'pending review retains one visible result action');
  assert.equal(withAttr(eligiblePending.buttons, 'data-generate-recovery')[0].disabled, true,
    'pending review remains non-actionable until billing is resolved');
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

  const safeSequence = [];
  const safeClick = await render({
    checkpoint: recovery('not_billed'), stale: true,
    preflight: async (_url, options) => {
      const { apply, expected_proof_token: proofToken } = options.body;
      safeSequence.push(apply ? `apply:${proofToken}` : 'preview');
      return apply
        ? { state: 'ready', safe_to_continue: true, differences: [] }
        : { state: 'safe_rebase_available', safe_to_continue: false, proof_token: 'proof-v81', differences: [] };
    },
    confirmation: async () => { safeSequence.push('confirm'); return { accepted: true, reviewBatch: { reviews: [] } }; },
  });
  const recoveryControl = safeClick.controls.get('[data-generate-recovery], [data-accept-billing-risk]');
  assert(recoveryControl?.listeners?.click, 'the final recovery CTA must be wired to the real generation handler');
  await recoveryControl.click();
  assert.deepEqual(safeSequence, ['preview', 'apply:proof-v81', 'confirm'],
    'safe recovery must preflight, atomically apply the proof, then ask for billing confirmation');
  assert.equal(safeClick.runStageCalls.length, 1, 'safe recovery submits exactly once after confirmation');

  let blockedConfirmations = 0;
  const blockedClick = await render({
    checkpoint: recovery('not_billed'), stale: true,
    preflight: async () => ({
      state: 'blocked', safe_to_continue: false,
      differences: [{ message: '人物1服装已从蓝色长裙改为金色战甲' }],
    }),
    confirmation: async () => { blockedConfirmations += 1; return { accepted: true }; },
  });
  await blockedClick.controls.get('[data-generate-recovery], [data-accept-billing-risk]').click();
  const blockedResult = blockedClick.controls.get('[data-recovery-preflight-result]');
  assert.equal(blockedResult.hidden, false, 'unsafe recovery must reveal the concrete preflight difference');
  assert.match(blockedResult.textContent, /蓝色长裙.*金色战甲/);
  assert.equal(blockedConfirmations, 0, 'unsafe recovery must stop before billing confirmation');
  assert.equal(blockedClick.runStageCalls.length, 0, 'unsafe recovery must not call the provider stage');

  console.log(JSON.stringify({ passed: true, safe_preflight_sequence: safeSequence, blocked_provider_calls: 0,
    stale_recovery_generate_actions: 1, eligible_recovery_generate_actions: 1,
    pending_disabled_actions: 1, completed_stale_update_actions: 1, model_calls: 0 }));
}

module.exports = { render, tags, withAttr, resetStageLoads: () => { stageLoads = 0; }, stageLoadCount: () => stageLoads };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
