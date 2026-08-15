'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const source = `${read('public/story-ad/views/billingRecoveryBanner.js')}\n${read('public/story-ad/views/assetCheckpointRecovery.js')}`.replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = { escapeHtml };
vm.runInNewContext(`${source}\nglobalThis.__tested={checkpointRecoverySummary,checkpointRecoveryBanner};`, sandbox, { filename: 'assetCheckpointRecovery.js' });
const failures = [];
const verify = (name, fn) => { try { fn(); } catch (error) { failures.push(`${name}: ${error.message}`); } };

function peopleFor(reviewState, { retryBlocked, billingState, submissionState } = {}) {
  return [7, 6, 6, 6].map((completed, index) => ({
    name: `人物${index + 1}`,
    checkpoint_recovery_summary: {
      completed_units: completed, total_units: completed + 1, retry_blocked: retryBlocked,
      missing_units: [{
        key: `missing-${index + 1}`, label: index < 2 ? '腰部配饰' : '发饰', reason: '需要平台核对后处理',
        billing_review_state: reviewState, billing_state: billingState, provider_submission_state: submissionState,
        retry_blocked: retryBlocked,
      }],
    },
  }));
}
const render = people => { const summary = sandbox.__tested.checkpointRecoverySummary(people); return { summary, html: sandbox.__tested.checkpointRecoveryBanner(summary) }; };
const pending = render(peopleFor('pending', { retryBlocked: true, billingState: 'unknown', submissionState: 'submitted_unknown' }));
const notBilled = render(peopleFor('not_billed', { retryBlocked: false, billingState: 'not_billed', submissionState: 'submission_rejected' }));
const unverifiable = render(peopleFor('unverifiable', { retryBlocked: true, billingState: 'unknown', submissionState: 'submitted_unknown' }));

verify('25 successes and only four missing units remain authoritative in every recovery state', () => {
  for (const state of [pending, notBilled, unverifiable]) {
    assert.equal(state.summary.completed, 25); assert.equal(state.summary.total, 29); assert.equal(state.summary.missing.length, 4);
  }
});
verify('pending review offers a clear non-generation next step but keeps retry prohibited', () => {
  assert.match(pending.html, /(?:平台核账中|核账尚未完成|核账进行中|等待平台核账)/);
  assert.match(pending.html, /<button\b[^>]*data-generate-recovery[^>]*disabled[^>]*>生成剩余\s*4\s*项<\/button>/);
  assert.doesNotMatch(pending.html, /接受[^<]*重复计费风险/);
  assert.doesNotMatch(pending.html, /data-update-person-plan|更新人物方案/);
});
verify('confirmed not-billed review exposes generation of exactly the remaining four units', () => {
  assert.equal(notBilled.summary.retry_blocked, false);
  assert.match(notBilled.html, /<(?:a|button)\b[^>]*data-generate-recovery[^>]*>[^<]*生成剩余\s*4\s*项[^<]*<\/(?:a|button)>/);
  assert.doesNotMatch(notBilled.html, /全部|29\s*项|接受[^<]*重复计费风险|data-update-person-plan/);
});
verify('unverifiable review requires one explicit bounded-risk action and never silently retries', () => {
  assert.match(unverifiable.html, /最多\s*4\s*次重复计费/);
  assert.match(unverifiable.html, /<button\b[^>]*data-history-safe[^>]*data-generate-recovery[^>]*>生成剩余\s*4\s*项<\/button>/);
  assert.doesNotMatch(unverifiable.html, /data-accept-billing-risk|data-update-person-plan/);
});

const billingService = read('src/services/newStoryAd/visualAssetBillingAuthorizationService.js');
verify('billing authorization distinguishes pending, not-billed and unverifiable instead of treating every unknown as authorizable', () => {
  assert.match(billingService, /(?:billing_review_state|review_state|resolution_state)/);
  assert.match(billingService, /(?:pending|reviewing)[\s\S]*VISUAL_ASSET_BILLING_REVIEW_PENDING/);
  assert.match(billingService, /reviewStates\.STATES\.UNVERIFIABLE/);
  assert.match(billingService, /not_billed/);
});

const assetView = read('public/story-ad/views/assetCenterView.js');
verify('recovery remains targeted and protected by the existing idempotency guard', () => {
  assert.match(assetView, /createKeyedRequestGuard\(\)/);
  assert.match(assetView, /subjectGenerationPayload\(bundle,\s*target,\s*requestKey\)/);
  assert.doesNotMatch(assetView, /data-update-person-plan[^\n]*(?:缺图|剩余|恢复)/);
});

if (failures.length) throw new Error(`V75 billing recovery next-step acceptance is red (${failures.length}):\n- ${failures.join('\n- ')}`);
console.log(JSON.stringify({ passed: true, completed_reused: 25, missing_targets: 4, paid_model_calls: 0 }));
