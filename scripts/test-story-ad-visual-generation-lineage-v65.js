'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-visual-lineage-v65-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const storage = require('../src/services/newStoryAd/storageService');
const assetPlan = require('../src/services/newStoryAd/assetPlanService');
const lifecycle = require('../src/services/newStoryAd/personAssetLifecycleService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const checkpoints = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const recovery = require('./repair-story-ad-visual-generation-lineage-v65');
const revisions = require('../src/services/newStoryAd/revisionService');

async function main() {
try {
  const taskId = 'visual-lineage-v65';
  const authoritativeCast = [{
    id: 'yun-zhiyue',
    name: '云知月',
    displayName: '云知月',
    role: '现代转世之人',
    roleName: '现代转世之人',
    age_range: '25~35岁',
    age_source: 'platform_story_inference',
    appearanceText: '原创成年女子外貌设定',
    wardrobeText: '米白色棉麻长裙与棕色皮鞋，无配饰',
    hairMakeupText: '黑色长发，淡妆，不佩戴发饰',
    look_profiles: [{ id: 'modern', name: '现代造型', wardrobeText: '米白色棉麻长裙与棕色皮鞋，无配饰' }],
  }];
  const context = {
    content_mode: 'narrative_story', brief: '现代转世之人在竹海重逢',
    cast_profiles: authoritativeCast, pet_profiles: [], expected_people: 1, expected_animals: 0,
    revisions: { person: 8 }, target_duration: 30, shot_count: 6, output_ratio: '9:16',
    asset_plan_generated_cast_fingerprint: storage.canonicalFingerprint(authoritativeCast),
  };
  storage.createTask({ id: taskId, status: 'done', stage: 'person_asset', request: context });
  storage.saveOutput(taskId, 'context', context);
  const before = assetPlan.fingerprint(storage.getTask(taskId), context);

  lifecycle.commitGeneratedSubjectAssets(taskId, {
    counts: { mode: 'single' }, pet_profiles: [],
    cast_assets: [{
      id: 'provider-asset-1', actor_id: 'provider-actor-1', actor_asset_id: 'provider-asset-1',
      name: '云知月', image_url: '/generated/yun.png', view_images: [{ key: 'front', image_url: '/generated/front.png' }],
      // Real browser generation projection intentionally lacks the authority
      // aliases name/role/age_range/age_source.
      subject_profile: { id: 'yun-zhiyue', displayName: '云知月', roleName: '现代转世之人', apparent_age: 'young adult' },
    }],
    person_contract: {
      status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true },
      member_contracts: [{ status: 'verified', verification: { state: 'verified' }, cross_view_qa: { pass: true } }],
    },
  }, {}, { change_kind: 'visual_dossier' });
  const afterContext = storage.getOutput(taskId, 'context');
  assert.equal(assetPlan.fingerprint(storage.getTask(taskId), afterContext), before,
    'visual-only assets and derived fields must not stale the approved textual asset plan');
  assert.equal(afterContext.revisions.person, 9, 'visual revision must still advance');
  assert.equal(afterContext.revisions.person_semantic, 8, 'semantic person revision must remain stable');
  assert.equal(afterContext.asset_plan_generated_cast_fingerprint, storage.canonicalFingerprint(afterContext.cast_profiles),
    'generated cast lineage must follow the visual projection only when its prior lineage was current');
  assert.equal(afterContext.cast_profiles[0].id, 'yun-zhiyue', 'stable cast id must be preserved');
  assert.equal(afterContext.cast_profiles[0].image_url, '/generated/yun.png', 'visual result must still be persisted');
  assert.equal(afterContext.cast_profiles[0].name, '云知月', 'visual projection must not erase authoritative name');
  assert.equal(afterContext.cast_profiles[0].role, '现代转世之人', 'visual projection must not erase authoritative role');
  assert.equal(afterContext.cast_profiles[0].age_range, '25~35岁', 'visual projection must not erase authoritative age');
  assert.equal(afterContext.cast_profiles[0].age_source, 'platform_story_inference', 'visual projection must retain demographic source');
  const semanticEdit = revisions.applyRevisions(afterContext, {
    ...afterContext,
    cast_profiles: [{ ...afterContext.cast_profiles[0], name: '云知月（重逢）', age_range: '30~40岁' }],
  }, 'person');
  assert.equal(semanticEdit.revisions.person_semantic, 9, 'user person edit must advance semantic revision');
  assert.notEqual(assetPlan.fingerprint(storage.getTask(taskId), semanticEdit), before,
    'user name/age/wardrobe semantics must stale the prior plan');
  const petInput = { ...context, cast_profiles: [], expected_people: 0, pet_profiles: [{ id: 'pet-1', name: '月白', type: '猫', breed: '中华田园猫', appearance: '白色短毛' }] };
  const petVisual = { ...petInput, pet_profiles: [{ id: 'pet_asset_pet-1', pet_id: 'pet-1', name: '月白', type: '猫', breed: '中华田园猫', appearance: '白色短毛', image_url: '/pet.png', view_images: [{ url: '/pet-front.png' }], pet_contract: { status: 'verified' } }] };
  assert.equal(assetPlan.fingerprint(storage.getTask(taskId), petVisual), assetPlan.fingerprint(storage.getTask(taskId), petInput),
    'generated pet media and contract must not stale the textual asset plan');

  const trackerEvents = [];
  const tracker = mediaAdapter.createImageSubmissionTracker({
    onSubmitting: event => trackerEvents.push(event.status),
    onSubmitted: event => trackerEvents.push(event.status),
  });
  await tracker.onSubmitting({ status: 'submitting' });
  assert.deepEqual(tracker.failure(new Error('network timeout')), {
    provider_submission_state: 'submitted_unknown', billing_state: 'unknown',
    provider_request_id: '', provider_task_id: '',
  }, 'a failure after request submission begins must be written as unknown billing');
  await tracker.onSubmitted({ status: 'completed', providerRequestId: 'request-1' });
  assert.deepEqual(tracker.evidence(), {
    provider_submission_state: 'completed', billing_state: 'confirmed',
    provider_request_id: 'request-1', provider_task_id: '',
  }, 'provider completion must produce confirmed model-call evidence');
  const rejectedTracker = mediaAdapter.createImageSubmissionTracker();
  await rejectedTracker.onSubmitting({ status: 'submitting' });
  await rejectedTracker.onSubmitted({ status: 'rejected', providerRequestId: 'rejected-request' });
  assert.equal(rejectedTracker.failure(new Error('invalid input')).billing_state, 'not_billed',
    'explicit provider rejection must remain safely retryable and must not be mislabeled unknown billing');
  assert.deepEqual(trackerEvents, ['submitting', 'completed']);

  const recoveryTaskId = 'visual-lineage-recovery-v65';
  const recoveryContext = { ...context, request_id: recoveryTaskId };
  const recoveryFingerprint = assetPlan.fingerprint({ id: recoveryTaskId }, recoveryContext);
  storage.createTask({ id: recoveryTaskId, status: 'done', stage: 'person_asset', request: recoveryContext });
  storage.saveOutput(recoveryTaskId, 'context', {
    ...recoveryContext,
    revisions: { person: 9 },
    cast_profiles: [{ ...authoritativeCast[0], name: '', role: '', age_range: '', image_url: '/generated/yun.png' }],
  });
  storage.saveOutput(recoveryTaskId, 'asset_plan_active', {
    fingerprint: recoveryFingerprint,
    plan: { status: 'active', fingerprint: recoveryFingerprint, cast_profiles: authoritativeCast },
  });
  const unknown = checkpoints.normalizeCheckpoint({
    key: 'unknown-unit', status: 'submitted_unknown', provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown', error: { code: 'PROVIDER_5XX_AMBIGUOUS' },
  });
  storage.saveOutput(recoveryTaskId, `subject_asset_checkpoint:${recoveryTaskId}:partial`, {
    person_dossier_checkpoints: { 'unknown-unit': unknown },
  });
  const blockedBefore = storage.canonicalFingerprint(storage.getTaskBundle(recoveryTaskId, { diagnostics: true }));
  assert.throws(() => recovery.apply(recoveryTaskId),
    error => error.code === 'VISUAL_LINEAGE_RECOVERY_BILLING_UNKNOWN_BLOCKED',
    'unknown checkpoint must block recovery before every write');
  assert.equal(storage.canonicalFingerprint(storage.getTaskBundle(recoveryTaskId, { diagnostics: true })), blockedBefore,
    'blocked recovery must be zero-write');
  storage.saveOutput(recoveryTaskId, `subject_asset_checkpoint:${recoveryTaskId}:partial`, {
    person_dossier_checkpoints: {
      'unknown-unit': checkpoints.authorizeAmbiguousRetry(unknown, {
        acceptDuplicateChargeRisk: true, acceptedBy: 'v65-test', supportId: 'review-v65',
      }),
    },
  });
  const recovered = recovery.apply(recoveryTaskId);
  assert.equal(recovered.applied, true);
  assert.equal(recovered.model_calls_delta, 0);
  const recoveredContext = storage.getOutput(recoveryTaskId, 'context');
  assert.equal(assetPlan.fingerprint(storage.getTask(recoveryTaskId), recoveredContext), recoveryFingerprint);
  assert.equal(recoveredContext.cast_profiles[0].name, '云知月', 'recovery must restore active-plan text authority');
  assert.equal(recoveredContext.cast_profiles[0].image_url, '/generated/yun.png', 'recovery must retain successful visual assets');

  console.log(JSON.stringify({
    passed: true,
    fingerprint_stable_after_visual_generation: true,
    semantic_revision: afterContext.revisions.person_semantic,
    visual_revision: afterContext.revisions.person,
    billing_evidence_synchronized: true,
    unknown_checkpoint_zero_write_blocked: true,
    recovery_after_explicit_authorization: true,
    model_calls: 0,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
