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

async function render({ checkpoint = null, stale = true, active = false, ready = false, historicalReadOnly = false,
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
    outputs: ready ? { production_graph_v1: { validation: { status: 'ready' } } } : {},
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
  for (const checkpointState of ['not_billed', 'pending', 'unverifiable', 'complete']) {
    const mounted = await render({ checkpoint: recovery(checkpointState), stale: true });
    assert.equal(recoveryCards(mounted.html).length, 0, 'legacy recovery state must not mount in the live asset center');
    assert.equal(withAttr(mounted.buttons, 'data-generate-recovery').length, 0);
    assert.equal(withAttr(mounted.buttons, 'data-update-person-plan').length, 0);
    assert.equal(withAttr(mounted.buttons, 'data-generate-subject-assets').length, 1);
  }
  const active = await render({ active: true });
  assert.equal(withAttr(active.buttons, 'data-generate-subject-assets').length, 1);
  assert.equal(withAttr(active.buttons, 'data-generate-subject-assets')[0].disabled, true);
  const ready = await render({ ready: true });
  assert.equal(withAttr(ready.buttons, 'data-generate-subject-assets').length, 1,
    'graph state must not hide an independently incomplete person asset');
  console.log(JSON.stringify({ passed: true, subject_generation_actions: 1, legacy_recovery_actions: 0, model_calls: 0 }));
}

module.exports = { render, tags, withAttr, resetStageLoads: () => { stageLoads = 0; }, stageLoadCount: () => stageLoads };
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
