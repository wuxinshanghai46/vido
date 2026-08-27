'use strict';

const assert = require('assert/strict');
const storage = require('../src/services/newStoryAd/storageService');
const authorization = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');
const reviewStates = require('../src/services/newStoryAd/visualAssetBillingReviewStateService');
const checkpoints = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const generationUnits = require('../src/services/newStoryAd/generationUnitService');

const task = { id: 'v75-atomic-task', active_generation_id: '', support_id: '' };
const makeUnit = (key, state = 'pending', revision = 2) => ({
  key, task_id: task.id, asset_type: 'human', asset_id: `person-${key}`, unit: `wearable_accessory:${key}`,
  status: 'submitted_unknown', provider_submission_state: 'submitted_unknown', billing_state: 'unknown',
  billing_review: { id: `review-${key}`, state, revision, reviewer: state === 'pending' ? '' : 'billing-operator', evidence: state === 'pending' ? '' : 'provider lookup exhausted' },
});
const rows = [{
  kind: 'subject_asset_checkpoint:v75', updated_at: '2026-08-15T10:00:00.000Z',
  payload: {
    person_dossier_checkpoints: Object.fromEntries(['one', 'two', 'three', 'four'].map(key => [key, makeUnit(key)])),
    subject_checkpoint_owners: Object.fromEntries(['one', 'two', 'three', 'four'].map((key, index) => [key, { subject_id: `person-${index + 1}`, kind: 'human', index }])),
  },
}];
const original = Object.fromEntries(['getTask', 'listOutputs', 'saveOutput', 'withWriteBatch', 'listGenerationRuns'].map(key => [key, storage[key]]));
const originalReconcileBilling = generationUnits.reconcileBilling;
let failAtSave = 0; let saveCount = 0;
storage.getTask = id => id === task.id ? task : null;
storage.listOutputs = id => id === task.id ? rows.map(row => ({ ...row })) : [];
storage.listGenerationRuns = () => [];
storage.saveOutput = (_id, kind, payload) => {
  saveCount += 1; if (failAtSave && saveCount === failAtSave) throw Object.assign(new Error('injected batch write failure'), { code: 'INJECTED_WRITE_FAILURE' });
  const row = rows.find(item => item.kind === kind); row.payload = payload; row.updated_at = payload.updated_at; return payload;
};
storage.withWriteBatch = fn => {
  const before = JSON.parse(JSON.stringify(rows));
  try { return fn(); } catch (error) { rows.splice(0, rows.length, ...before); throw error; }
};

async function main() {
  try {
    const pending = authorization.listBillingReviews(task.id);
    assert.equal(pending.review_count, 4); assert.ok(pending.reviews.every(item => item.billing_review_state === 'pending'));
    const pendingAuthorized = authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: pending.support_id, checkpointKeys: pending.reviews.map(item => item.review_key),
      expectedReviewRevisions: Object.fromEntries(pending.reviews.map(item => [item.review_key, item.review_revision])),
      acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.equal(pendingAuthorized.count, 4, '直接生成动作必须原子授权所有选中的 pending 单元');
    assert.ok(Object.values(rows[0].payload.person_dossier_checkpoints)
      .every(unit => unit.retry_authorization?.reason === 'user_direct_generation_action'));
    Object.values(rows[0].payload.person_dossier_checkpoints).forEach(unit => { unit.retry_authorization = null; });

    Object.values(rows[0].payload.person_dossier_checkpoints).forEach(unit => { unit.billing_review.state = 'unverifiable'; unit.billing_review.reviewer = 'billing-operator'; unit.billing_review.evidence = 'provider lookup exhausted'; });
    const risk = authorization.listBillingReviews(task.id); const keys = risk.reviews.map(item => item.review_key);
    const revisions = Object.fromEntries(risk.reviews.map(item => [item.review_key, item.review_revision]));
    assert.equal(risk.support_id, authorization.listBillingReviews(task.id).support_id, 'refresh must preserve support/idempotency key');
    assert.throws(() => authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: risk.support_id, checkpointKeys: keys,
      expectedReviewRevisions: { ...revisions, [keys[2]]: revisions[keys[2]] - 1 }, acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    }), error => error.code === 'VISUAL_ASSET_BILLING_REVIEW_REVISION_CONFLICT');
    assert.throws(() => authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: risk.support_id, checkpointKeys: keys, expectedReviewRevisions: revisions, acceptedBy: 'owner', acceptDuplicateChargeRisk: false,
    }), error => error.code === 'GENERATION_DUPLICATE_CHARGE_ACCEPTANCE_REQUIRED');

    const atomicBefore = JSON.stringify(rows); saveCount = 0; failAtSave = 2;
    assert.throws(() => authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: risk.support_id, checkpointKeys: keys, expectedReviewRevisions: revisions, acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    }), error => error.code === 'INJECTED_WRITE_FAILURE');
    assert.equal(JSON.stringify(rows), atomicBefore, 'mid-batch failure must roll back every authorization');

    saveCount = 0; failAtSave = 0;
    const authorized = authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: risk.support_id, checkpointKeys: keys, expectedReviewRevisions: revisions, acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.equal(authorized.count, 4); assert.deepEqual(authorized.checkpoint_keys, keys.slice().sort());
    assert.ok(Object.values(rows[0].payload.person_dossier_checkpoints).every(unit => unit.retry_authorization?.remaining_uses === 1));
    const duplicate = authorization.authorizeTaskRetryBatch({
      taskId: task.id, supportId: risk.support_id, checkpointKeys: keys, expectedReviewRevisions: revisions, acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.equal(duplicate.count, 4); assert.ok(duplicate.results.every(item => item.duplicate === true));

    const memory = new Map(); let providerCalls = 0;
    for (let index = 0; index < 29; index += 1) memory.set(`unit-${index}`, index < 25
      ? { key: `unit-${index}`, status: 'completed', provider_submission_state: 'completed', billing_state: 'confirmed', result: { image_url: `/kept-${index}.png` } }
      : { key: `unit-${index}`, status: 'failed', provider_submission_state: 'not_submitted', billing_state: 'not_billed' });
    const runs = await Promise.all(Array.from({ length: 29 }, (_, index) => checkpoints.runCheckpointedUnit({
      identity: { key: `unit-${index}` }, load: async key => memory.get(key), save: async (key, value) => memory.set(key, value),
      execute: async () => { providerCalls += 1; return { image_url: `/new-${index}.png` }; },
    })));
    assert.equal(runs.filter(item => item.reused).length, 25); assert.equal(providerCalls, 4);

    const unknownMemory = new Map([['new-unknown', { key: 'new-unknown', status: 'failed', provider_submission_state: 'not_submitted', billing_state: 'not_billed' }]]);
    let unknownCalls = 0;
    await assert.rejects(() => checkpoints.runCheckpointedUnit({
      identity: { key: 'new-unknown' }, load: async key => unknownMemory.get(key), save: async (key, value) => unknownMemory.set(key, value),
      execute: async controls => { unknownCalls += 1; await controls.onSubmitting(); throw Object.assign(new Error('ambiguous timeout'), { billingState: 'unknown', providerSubmissionState: 'submitted_unknown' }); },
    }));
    await assert.rejects(() => checkpoints.runCheckpointedUnit({
      identity: { key: 'new-unknown' }, load: async key => unknownMemory.get(key), save: async (key, value) => unknownMemory.set(key, value), execute: async () => { unknownCalls += 1; },
    }), error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN');
    assert.equal(unknownCalls, 1, 'a new unknown must stop before another provider call');

    assert.equal(reviewStates.reviewState({ billing_state: 'unknown', provider_submission_state: 'submitted_unknown' }), 'pending', 'legacy unknown migrates only to pending');
    assert.equal(reviewStates.reviewState({ billing_state: 'unknown', provider_submission_state: 'submitted_unknown', billing_review: { state: 'unverifiable' } }), 'unverifiable');

    const reconciledRuns = [];
    storage.listGenerationRuns = () => [
      { id: 'exact-nested', state: 'billing_unknown', provider_id: 'internal-orchestrator', domain: 'subject_assets', nested_billing_review_required: true },
      { id: 'generic-internal', state: 'billing_unknown', provider_id: 'internal-orchestrator', domain: 'subject_assets' },
      { id: 'real-provider', state: 'billing_unknown', provider_id: 'real-image-provider', domain: 'subject_assets', nested_billing_review_required: true },
    ];
    generationUnits.reconcileBilling = id => { reconciledRuns.push(id); return { id }; };
    authorization.reconcileNestedOrchestrator(task.id, keys);
    assert.deepStrictEqual(reconciledRuns, ['exact-nested'],
      'historical reconciliation must migrate only explicitly nested internal-orchestrator risk, never generic or real-provider unknown');

    const jobSource = require('fs').readFileSync(require('path').join(__dirname, '../src/services/newStoryAd/jobService.js'), 'utf8');
    assert.match(jobSource, /nestedCheckpointRisk[\s\S]*billing_state:\s*'not_submitted'[\s\S]*provider_submission_state:\s*'not_applicable'/);
    const routeSource = require('fs').readFileSync(require('path').join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
    assert.doesNotMatch(routeSource, /billing-review(?:s)?\/resolve/, 'controlled resolver must not be exposed as an ordinary user HTTP endpoint');

    console.log(JSON.stringify({ passed: true, authorized_atomic: 4, cached_successes: 25, fake_provider_calls: providerCalls, new_unknown_calls: unknownCalls, planning_model_calls: 0 }));
  } finally { Object.assign(storage, original); generationUnits.reconcileBilling = originalReconcileBilling; }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
