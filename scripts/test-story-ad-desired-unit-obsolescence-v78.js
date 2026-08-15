'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const reconciliation = require('../src/services/newStoryAd/visualAssetDesiredUnitReconciliationService');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');

const personId = 'yun-reincarnation';
const hairKey = 'person_detail:actor-yun:1:wearable_accessory:hair_accessories';
const positiveUnits = ['waist_accessories', 'ear_accessories', 'neck_accessories'];
const profile = {
  id: personId,
  name: '林知月（现代）',
  hairMakeupText: '现代自然长发，不加发饰，无发簪',
  wardrobe_contract: {
    accessories: { mode: 'specified', items: [
      { type: '细腰带', position: '腰间', material: '皮革' },
      { type: '银耳钉', position: '耳部', material: '银' },
      { type: '细项链', position: '颈部', material: '银' },
    ] },
    hair_makeup: { hair_accessories: ['无发饰'], hairstyle: '自然长发' },
  },
};
const completed = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`kept-${index + 1}`, {
  key: `kept-${index + 1}`, unit: `identity:kept-${index + 1}`, status: 'completed',
  provider_submission_state: 'completed', billing_state: 'confirmed',
  result: { image_url: `/kept-${index + 1}.png` }, input_fingerprint: `stable-${index + 1}`,
}]));
const missing = Object.fromEntries(positiveUnits.map(unit => [`missing-${unit}`, {
  key: `missing-${unit}`, unit: `wearable_accessory:${unit}`, status: 'failed',
  provider_submission_state: 'not_submitted', billing_state: 'not_billed',
  error: { code: 'PROVIDER_CONTENT_AUDIT', message: '待定向恢复' },
  billing_review: { id: `review-${unit}`, state: 'not_billed', revision: 2, reviewer: 'billing', evidence: '未计费' },
}]));
const legacyHair = {
  key: hairKey, unit: 'wearable_accessory:hair_accessories', status: 'submitted_unknown',
  provider_submission_state: 'submitted_unknown', billing_state: 'unknown', provider_request_id: 'legacy-provider-request',
  input_fingerprint: 'legacy-hair-fingerprint', lineage: { source_revision: 7 },
  error: { code: 'PROVIDER_ASSET_URL_UNAVAILABLE', message: 'legacy URL fetch failed' },
  billing_review: { id: 'review-hair', state: 'pending', revision: 3, reviewer: '', evidence: '' },
};
const source = { ...completed, ...missing, [hairKey]: legacyHair };
const owners = Object.fromEntries(Object.keys(source).map(key => [key, { kind: 'human', subject_id: personId, index: 0 }]));
const snapshot = JSON.stringify(source);

const desired = reconciliation.desiredWearableUnits(profile);
assert.deepEqual([...desired].sort(), [...positiveUnits.map(unit => `wearable_accessory:${unit}`), 'wearable_accessory:hair_makeup'].sort(),
  'current authoritative evidence must retain hair/makeup plus three positive accessories and exclude only false hair-accessory object');

const blocked = reconciliation.reconcileCheckpointMap({ checkpoints: source, owners, profiles: [profile], at: '2026-08-15T12:00:00.000Z' });
assert.deepEqual(blocked.obsolete_keys, []);
assert.deepEqual(blocked.blocked_keys, [hairKey], 'pending/unknown legacy unit without review evidence must never be cancelled');
assert.equal(JSON.stringify(source), snapshot, 'preview must not mutate source checkpoints');

const unknownWithoutSubmissionProof = {
  ...source,
  [hairKey]: {
    ...legacyHair,
    status: 'failed',
    provider_submission_state: 'not_submitted',
    billing_state: 'unknown',
  },
};
const blockedUnknown = reconciliation.reconcileCheckpointMap({
  checkpoints: unknownWithoutSubmissionProof, owners, profiles: [profile], at: '2026-08-15T12:00:00.000Z',
});
assert.deepEqual(blockedUnknown.obsolete_keys, [],
  'billing unknown must remain blocked even when a legacy wrapper says not_submitted; submission wording is not proof of no charge');
assert.deepEqual(blockedUnknown.blocked_keys, [hairKey]);

const unverifiable = reconciliation.reconcileCheckpointMap({
  checkpoints: source, owners, profiles: [profile],
  resolutions: { [hairKey]: { state: 'unverifiable', reviewer: 'billing-operator', evidence: 'provider cannot determine billing' } },
  expectedRevisions: { [hairKey]: 3 },
});
assert.deepEqual(unverifiable.obsolete_keys, [],
  'unverifiable is not proof of no charge and must never obsolete an unknown checkpoint');
assert.deepEqual(unverifiable.blocked_keys, [hairKey]);

assert.throws(() => reconciliation.reconcileCheckpointMap({
  checkpoints: source, owners, profiles: [profile],
  resolutions: { [hairKey]: { reviewer: 'billing-operator', evidence: 'provider confirmed request was not billed' } },
  expectedRevisions: { [hairKey]: 2 },
}), error => error.code === 'VISUAL_ASSET_DESIRED_UNIT_REVISION_CONFLICT');
assert.equal(JSON.stringify(source), snapshot, 'revision conflict must leave all 29 units unchanged');

const reconciled = reconciliation.reconcileCheckpointMap({
  checkpoints: source, owners, profiles: [profile], at: '2026-08-15T12:01:00.000Z',
  resolutions: { [hairKey]: { state: 'not_billed', reviewer: 'billing-operator', evidence: 'provider confirmed request was not billed' } },
  expectedRevisions: { [hairKey]: 3 },
});
assert.deepEqual(reconciled.obsolete_keys, [hairKey]);
assert.deepEqual(reconciled.blocked_keys, []);
const obsolete = reconciled.checkpoints[hairKey];
assert.equal(obsolete.status, 'cancelled');
assert.equal(obsolete.lifecycle_state, 'obsolete');
assert.equal(obsolete.obsolete, true);
assert.equal(obsolete.obsolete_from_status, 'submitted_unknown');
assert.equal(obsolete.error.code, legacyHair.error.code, 'obsolete audit must preserve original failure evidence');
assert.equal(obsolete.provider_request_id, legacyHair.provider_request_id, 'obsolete audit must preserve provider lineage');
assert.deepEqual(obsolete.lineage, legacyHair.lineage);
assert.equal(obsolete.billing_review.state, 'not_billed');
assert.equal(obsolete.billing_review.reviewer, 'billing-operator');

const repeated = reconciliation.reconcileCheckpointMap({
  checkpoints: reconciled.checkpoints, owners, profiles: [profile],
  resolutions: { [hairKey]: { state: 'not_billed', reviewer: 'billing-operator', evidence: 'same evidence' } },
  expectedRevisions: { [hairKey]: 4 },
});
assert.equal(repeated.changed, false, 'obsolete migration must be idempotent across refresh/retry');

const positiveHairProfile = {
  ...profile, hairMakeupText: '现代盘发，佩戴白玉发簪',
  wardrobe_contract: { ...profile.wardrobe_contract, hair_makeup: { hair_accessories: ['白玉发簪'] } },
};
const retained = reconciliation.reconcileCheckpointMap({
  checkpoints: source, owners, profiles: [positiveHairProfile],
  resolutions: { [hairKey]: { state: 'not_billed', reviewer: 'billing', evidence: 'not billed' } },
  expectedRevisions: { [hairKey]: 3 },
});
assert.equal(retained.changed, false, 'a currently desired positive hair accessory must never be obsoleted');

const fourProfiles = [
  { ...positiveHairProfile, id: 'person-1', name: '人物1' },
  { ...profile, id: 'person-2', name: '人物2' },
  { ...positiveHairProfile, id: 'person-3', name: '人物3', hairMakeupText: '佩戴银发冠' },
  { ...profile, id: 'person-4', name: '人物4' },
];
const multiCheckpoints = {}, multiOwners = {};
fourProfiles.forEach((person, index) => {
  const key = `multi-person-${index + 1}-hair`;
  multiCheckpoints[key] = {
    key, unit: 'wearable_accessory:hair_accessories', status: 'failed',
    provider_submission_state: 'submission_rejected', billing_state: 'not_billed',
    billing_review: { id: `review-${index + 1}`, state: 'not_billed', revision: 2, reviewer: 'billing', evidence: 'not billed' },
  };
  multiOwners[key] = { kind: 'human', subject_id: person.id, index };
});
const allPeoplePlan = reconciliation.reconcileCheckpointMap({
  checkpoints: multiCheckpoints, owners: multiOwners, profiles: fourProfiles,
});
assert.deepEqual(allPeoplePlan.obsolete_keys.sort(), ['multi-person-2-hair', 'multi-person-4-hair'],
  'four-person reconciliation must apply each person own desired set without cross-owner contamination');
const isolatedPerson2 = reconciliation.reconcileCheckpointMap({
  checkpoints: multiCheckpoints, owners: multiOwners, profiles: [fourProfiles[1]],
});
assert.deepEqual(isolatedPerson2.obsolete_keys, ['multi-person-2-hair'],
  'compiler per-member reconciliation must never use index fallback to obsolete another person checkpoint');

const checkpoint = { person_dossier_checkpoints: reconciled.checkpoints, subject_checkpoint_owners: owners, status: 'partial' };
const preview = projection.projectCheckpoint(checkpoint, [profile])[0];
assert.equal(preview.completed_unit_count, 25, 'all 25 successful assets must remain unchanged');
assert.equal(preview.total_unit_count, 28, 'obsolete false unit must leave the authoritative 25/28 denominator');
assert.equal(preview.failed_units.length, 3);
assert(!preview.failed_units.some(unit => /hair_accessories|发饰/.test(`${unit.key} ${unit.unit}`)));

const bannerSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/assetCheckpointRecovery.js'), 'utf8')
  .replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const bannerSandbox = {
  escapeHtml: value => String(value),
  renderCheckpointRecoveryBanner(summary) {
    return `<button data-generate-recovery>生成剩余 ${summary.missing.length} 项</button><b>${summary.completed}/${summary.total}</b>`;
  },
};
vm.runInNewContext(`${bannerSource}\nglobalThis.__summary=checkpointRecoverySummary;globalThis.__banner=checkpointRecoveryBanner;`, bannerSandbox);
const summary = bannerSandbox.__summary([{ name: '林知月', checkpoint_recovery_summary: {
  completed_units: preview.completed_unit_count, total_units: preview.total_unit_count,
  missing_units: preview.failed_units, retry_blocked: false,
} }]);
assert.equal(summary.completed, 25); assert.equal(summary.total, 28); assert.equal(summary.missing.length, 3);
assert.match(bannerSandbox.__banner(summary), /生成剩余 3 项/);

(async () => {
  const memory = new Map(Object.entries(reconciled.checkpoints));
  let providerCalls = 0;
  const activeKeys = [...Object.keys(completed), ...Object.keys(missing)];
  const runs = await Promise.all(activeKeys.map(key => checkpointService.runCheckpointedUnit({
    identity: { key }, load: async id => memory.get(id), save: async (id, value) => memory.set(id, value),
    execute: async () => { providerCalls += 1; return { image_url: `/generated/${providerCalls}.png` }; },
  })));
  assert.equal(runs.filter(row => row.reused).length, 25);
  assert.equal(providerCalls, 3, 'compiler recovery must call the fake provider only for the three genuinely missing desired units');
  assert.equal(memory.get(hairKey).lifecycle_state, 'obsolete', 'compiler recovery must never revive the false historical unit');

  const row = { kind: 'subject_asset_checkpoint:v78', payload: {
    person_dossier_checkpoints: JSON.parse(JSON.stringify(source)),
    subject_checkpoint_owners: owners,
    status: 'partial',
  } };
  let writes = 0;
  const storage = {
    getTask: () => ({ id: 'task-v78', active_generation_id: '' }),
    getOutput: (_id, kind) => kind === 'context' ? { cast_profiles: [profile] } : null,
    saveOutput: (_id, _kind, payload) => { writes += 1; row.payload = payload; },
    withWriteBatch(callback) {
      const before = JSON.parse(JSON.stringify(row.payload));
      try { return callback(); } catch (error) { row.payload = before; throw error; }
    },
  };
  const authorization = {
    subjectCheckpointRows: () => [{ ...row }],
    reconcileNestedOrchestrator: () => { throw Object.assign(new Error('injected outer reconciliation failure'), { code: 'INJECTED_FAILURE' }); },
  };
  const beforeFailure = JSON.stringify(row.payload);
  assert.throws(() => reconciliation.reconcileTask({
    taskId: 'task-v78', apply: true, at: '2026-08-15T12:02:00.000Z',
    resolutions: { [hairKey]: { state: 'not_billed', reviewer: 'billing', evidence: 'confirmed' } },
    expectedRevisions: { [hairKey]: 3 },
  }, { storage, authorization }), error => error.code === 'INJECTED_FAILURE');
  assert.equal(JSON.stringify(row.payload), beforeFailure, 'mid-transaction failure must expose zero checkpoint writes');

  const outerKeys = [];
  authorization.reconcileNestedOrchestrator = (_taskId, keys) => {
    outerKeys.push(...keys);
    return [{ id: 'outer-exact-hair' }];
  };
  writes = 0;
  const applied = reconciliation.reconcileTask({
    taskId: 'task-v78', apply: true, at: '2026-08-15T12:03:00.000Z',
    resolutions: { [hairKey]: { state: 'not_billed', reviewer: 'billing', evidence: 'confirmed' } },
    expectedRevisions: { [hairKey]: 3 },
  }, { storage, authorization });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.obsolete_keys, [hairKey]);
  assert.deepEqual(applied.reconciled_outer_ids, ['outer-exact-hair']);
  assert.deepEqual(outerKeys, [hairKey], 'outer reconciliation must receive only the exact obsoleted checkpoint key');
  assert.equal(writes, 1);
  const writesAfterApply = writes;
  const duplicateApply = reconciliation.reconcileTask({ taskId: 'task-v78', apply: true }, { storage, authorization });
  assert.equal(duplicateApply.applied, false);
  assert.equal(writes, writesAfterApply, 'repeated apply after refresh must perform zero additional writes');

  console.log(JSON.stringify({ passed: true, kept_successes: 25, authoritative_total: 28, missing_targets: 3, fake_provider_calls: 3, model_calls: 0 }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
