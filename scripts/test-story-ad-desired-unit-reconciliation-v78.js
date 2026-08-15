'use strict';

const assert = require('assert/strict');
const reconciliation = require('../src/services/newStoryAd/visualAssetDesiredUnitReconciliationService');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');

const profile = { id: 'person-1', wardrobeText: '黑色腰带与长靴', hairMakeupText: '自然长发造型' };
const owners = {}, checkpoints = {};
for (let index = 0; index < 25; index += 1) {
  const key = `complete-${index}`; owners[key] = { subject_id: 'person-1', index: 0 };
  checkpoints[key] = { key, unit: `body:view-${index}`, status: 'completed', billing_state: 'confirmed', provider_submission_state: 'completed', result: { image_url: `/asset-${index}.png` } };
}
for (const unit of ['waist_accessories', 'shoes', 'hair_makeup', 'hair_accessories']) {
  const key = `failed-${unit}`; owners[key] = { subject_id: 'person-1', index: 0 };
  checkpoints[key] = {
    key, unit: `wearable_accessory:${unit}`, status: 'failed', billing_state: 'not_billed', provider_submission_state: 'rejected',
    error: { code: 'PROVIDER_CONTENT_AUDIT', message: 'public reason' }, lineage: { generation_id: 'gen-1' },
    billing_review: { id: `review-${unit}`, state: 'not_billed', revision: 2, reviewer: 'ops', evidence: 'provider rejection', resolved_at: '2026-08-15T00:00:00.000Z' },
  };
}
const plan = reconciliation.reconcileCheckpointMap({ checkpoints, owners, profiles: [profile], at: '2026-08-15T01:00:00.000Z' });
assert.deepEqual(plan.obsolete_keys, ['failed-hair_accessories']);
assert.deepEqual(plan.blocked_keys, []);
const obsolete = plan.checkpoints['failed-hair_accessories'];
assert.equal(obsolete.status, 'cancelled'); assert.equal(obsolete.lifecycle_state, 'obsolete');
assert.equal(obsolete.obsolete_from_status, 'failed'); assert.deepEqual(obsolete.error, checkpoints['failed-hair_accessories'].error);
assert.deepEqual(obsolete.billing_review, checkpoints['failed-hair_accessories'].billing_review);
assert.deepEqual(obsolete.lineage, checkpoints['failed-hair_accessories'].lineage);

const projected = projection.projectCheckpoint({ person_dossier_checkpoints: plan.checkpoints, subject_checkpoint_owners: owners }, [profile])[0];
assert.equal(projected.completed_unit_count, 25); assert.equal(projected.total_unit_count, 28); assert.equal(projected.failed_units.length, 3);
assert.equal(reconciliation.reconcileCheckpointMap({ checkpoints: plan.checkpoints, owners, profiles: [profile] }).changed, false, 'obsolete reconciliation must be idempotent');

const unknown = { ...checkpoints, 'failed-hair_accessories': { ...checkpoints['failed-hair_accessories'], billing_state: 'unknown', provider_submission_state: 'submitted_unknown', billing_review: { state: 'pending', revision: 3 } } };
const blocked = reconciliation.reconcileCheckpointMap({ checkpoints: unknown, owners, profiles: [profile] });
assert.deepEqual(blocked.obsolete_keys, []); assert.deepEqual(blocked.blocked_keys, ['failed-hair_accessories']);
assert.throws(() => reconciliation.reconcileCheckpointMap({ checkpoints: unknown, owners, profiles: [profile], resolutions: { 'failed-hair_accessories': { state: 'not_billed', evidence: 'not billed evidence', reviewer: 'ops' } }, expectedRevisions: { 'failed-hair_accessories': 2 } }), error => error.code === 'VISUAL_ASSET_DESIRED_UNIT_REVISION_CONFLICT');
const unverifiable = reconciliation.reconcileCheckpointMap({ checkpoints: unknown, owners, profiles: [profile], resolutions: { 'failed-hair_accessories': { state: 'unverifiable', evidence: 'cannot verify', reviewer: 'ops' } }, expectedRevisions: { 'failed-hair_accessories': 3 } });
assert.deepEqual(unverifiable.obsolete_keys, []); assert.deepEqual(unverifiable.blocked_keys, ['failed-hair_accessories']);
const resolved = reconciliation.reconcileCheckpointMap({ checkpoints: unknown, owners, profiles: [profile], resolutions: { 'failed-hair_accessories': { state: 'not_billed', evidence: 'provider confirms not billed', reviewer: 'ops' } }, expectedRevisions: { 'failed-hair_accessories': 3 } });
assert.deepEqual(resolved.obsolete_keys, ['failed-hair_accessories']); assert.equal(resolved.checkpoints['failed-hair_accessories'].billing_review.state, 'not_billed');
const otherKey = 'other-person-hair';
const multi = reconciliation.reconcileCheckpointMap({
  checkpoints: { ...checkpoints, [otherKey]: { ...checkpoints['failed-hair_accessories'], key: otherKey } },
  owners: { ...owners, [otherKey]: { subject_id: 'person-2', index: 0 } }, profiles: [profile], subjectIds: ['person-1'],
});
assert.equal(multi.checkpoints[otherKey].status, 'failed', '单人物编译阶段不得跨人物废止同索引checkpoint');
console.log(JSON.stringify({ passed: true, completed: 25, total: 28, missing: 3, model_calls: 0 }));
