'use strict';

const assert = require('assert/strict');
const review = require('../src/services/newStoryAd/visualAssetBillingReviewStateService');

const pending = {
  key: 'person-1:waist', status: 'submitted_unknown', provider_submission_state: 'submitted_unknown', billing_state: 'unknown',
  billing_review: { id: 'review-1', state: 'pending', revision: 3 },
};
assert.deepEqual(review.publicState(pending), { state: 'pending', revision: 3 });

assert.throws(() => review.resolve(pending, { state: 'not_billed', expected_revision: 3 }), error =>
  error.code === 'VISUAL_ASSET_BILLING_REVIEW_EVIDENCE_REQUIRED');
const cleared = review.resolve(pending, {
  state: 'not_billed', expected_revision: 3, reviewer: 'billing-operator', evidence: 'provider invoice confirms no charge',
}, { at: '2026-08-15T10:00:00.000Z' });
assert.equal(cleared.billing_review.id, 'review-1'); assert.equal(cleared.billing_review.revision, 4);
assert.equal(cleared.billing_review.reviewer, 'billing-operator'); assert.equal(cleared.billing_review.evidence, 'provider invoice confirms no charge');
assert.equal(cleared.billing_review.resolved_at, '2026-08-15T10:00:00.000Z');
assert.equal(cleared.billing_state, 'not_billed'); assert.equal(cleared.provider_submission_state, 'not_submitted');
assert.equal(cleared.retry_authorization, null);

assert.throws(() => review.resolve(pending, {
  state: 'unverifiable', expected_revision: 2, reviewer: 'billing-operator', evidence: 'provider has no retained lookup',
}), error => error.code === 'VISUAL_ASSET_BILLING_REVIEW_REVISION_CONFLICT');
assert.throws(() => review.resolve(cleared, {
  state: 'unverifiable', expected_revision: 4, reviewer: 'billing-operator', evidence: 'late contradictory result',
}), error => error.code === 'VISUAL_ASSET_BILLING_REVIEW_INVALID_TRANSITION');

assert.throws(() => review.resolve(pending, {
  state: 'completed', expected_revision: 3, reviewer: 'billing-operator', evidence: 'provider reports complete',
}), error => error.code === 'VISUAL_ASSET_BILLING_REVIEW_RESULT_REQUIRED');
const recovered = review.resolve({ ...pending, provider_result: { image_url: '/assets/recovered.png' } }, {
  state: 'completed', expected_revision: 3, reviewer: 'billing-operator', evidence: 'provider result downloaded and hash verified',
});
assert.equal(recovered.status, 'completed'); assert.equal(recovered.billing_state, 'confirmed');
assert.equal(recovered.result.image_url, '/assets/recovered.png');

console.log(JSON.stringify({ passed: true, legal_states: 4, revision_conflict: true, audited: true, paid_model_calls: 0 }));
