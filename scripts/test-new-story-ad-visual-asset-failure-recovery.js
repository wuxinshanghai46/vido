const assert = require('assert');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const visualAssetProgress = require('../src/services/newStoryAd/visualAssetProgressService');
const visualAssetOrchestration = require('../src/services/newStoryAd/visualAssetOrchestrationService');
const projectStorage = require('../src/services/newStoryAd/storageService');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const billingAuthorization = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeStorage() {
  const outputs = new Map();
  return {
    getOutput(taskId, kind) { return clone(outputs.get(`${taskId}:${kind}`)); },
    saveOutput(taskId, kind, value) { outputs.set(`${taskId}:${kind}`, clone(value)); return value; },
    listOutputs(taskId) {
      return [...outputs.entries()]
        .filter(([key]) => key.startsWith(`${taskId}:`))
        .map(([key, payload]) => ({ kind: key.slice(taskId.length + 1), payload: clone(payload) }));
    },
  };
}

async function main() {
  const raw500 = new Error('internal service failure');
  raw500.response = { status: 500, data: { code: 500, reason: 'image2O100IFR' } };
  assert.strictEqual(
    mediaAdapter.classifyImageGenerationError(raw500).code,
    'PROVIDER_5XX_AMBIGUOUS',
    'HTTP 500 must not fall through to UNKNOWN',
  );

  const storage = makeStorage();
  let personProviderCalls = 0;
  let detailProviderCalls = 0;
  let isolatedAccessoryCalls = 0;
  let petProviderCalls = 0;
  const fakeMedia = {
    ASSET_DIR: '',
    async generateActorReference(input) {
      if (input.stage === 'new_story_ad.pet_dossier') {
        petProviderCalls += 1;
        await input.onSubmitting?.({});
        await input.onSubmitted?.({ providerRequestId: 'pet-request-1' });
        return { image_url: '/pet-sheet.png', filename: 'pet-sheet.png', provider_used: 'mock/image' };
      }
      personProviderCalls += 1;
      return { image_url: `/person-unit-${personProviderCalls}.png`, filename: `person-unit-${personProviderCalls}.png`, provider_used: 'mock/image' };
    },
    async generateImage(input) {
      if (input.stage === 'new_story_ad.person_dossier_wearable_accessory') {
        isolatedAccessoryCalls += 1;
        await input.onSubmitting?.({});
        await input.onSubmitted?.({ providerRequestId: `accessory-request-${isolatedAccessoryCalls}` });
        return { image_url: '/isolated-watch.png', filename: 'isolated-watch.png', provider_used: 'mock/image' };
      }
      if (input.stage === 'new_story_ad.person_dossier_wardrobe_detail') {
        detailProviderCalls += 1;
        await input.onSubmitting?.({});
        const error = new Error('provider 500 after submission');
        error.code = 'PROVIDER_5XX_AMBIGUOUS';
        error.billingState = 'unknown';
        error.providerSubmissionState = 'submitted_unknown';
        throw error;
      }
      throw new Error(`unexpected image stage: ${input.stage}`);
    },
    async splitReferenceSheet(input) {
      return input.viewKeys.map(key => ({ key, url: `/split/${key}.png`, image_url: `/split/${key}.png` }));
    },
    async splitActorSheet(input) {
      return input.viewKeys.map(key => ({ key, url: `/pet/${key}.png`, image_url: `/pet/${key}.png` }));
    },
  };
  const body = {
    brief: '一位人物与一只宠物共同出镜。',
    cast_mode: 'human_pet',
    expected_people: 1,
    expected_animals: 1,
    person_spec: { castMode: 'human_pet', expectedPeople: 1, expectedAnimals: 1 },
    cast_profiles: [{
      id: 'human-1', displayName: '人物一', roleName: '旅行者',
      appearanceText: '成年女性，面部特征稳定，身材比例自然。',
      wardrobeText: '深色夹克、长裤与银色腕表。',
      hairMakeupText: '自然黑色中长发与淡妆。', negativeText: '不得改变年龄和服装。',
    }],
    pet_profiles: [{
      id: 'pet-1', name: '雪球', type: '犬', breed: '白色中型犬',
      appearance: '白色蓬松毛发，深色眼睛，体型比例稳定。',
    }],
  };
  const deps = {
    storage,
    mediaAdapter: fakeMedia,
    personIdentity: { async verifyPersonAsset() { return { status: 'verified', person_revision: 1, cross_view_qa: { pass: true } }; } },
    petIdentity: { async verifyPetAsset() { return { status: 'verified', pet_revision: 1, cross_view_qa: { pass: true } }; } },
    cancellation: { throwIfCancelled() {} },
  };

  await assert.rejects(
    subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps),
    error => error.code === 'PROVIDER_5XX_AMBIGUOUS' && error.billingState === 'unknown',
  );
  assert.strictEqual(personProviderCalls, 6, 'all core person dossier units should finish before the accessory failure');
  assert.strictEqual(isolatedAccessoryCalls, 2, 'the declared watch and completed footwear must each be generated once as isolated catalog objects before wardrobe details');
  assert.strictEqual(detailProviderCalls, 1, 'the ambiguous paid wardrobe detail unit is submitted once');
  assert.strictEqual(petProviderCalls, 1, 'pet generation must continue after the independent person unit fails');

  const subjectCheckpoint = storage.listOutputs('visual-recovery-task')
    .find(row => row.kind.startsWith('subject_asset_checkpoint:'))?.payload;
  assert.strictEqual(subjectCheckpoint.status, 'partial');
  assert.strictEqual(subjectCheckpoint.pets.filter(Boolean).length, 1, 'completed pet must be persisted in the partial checkpoint');
  const detailCheckpoint = Object.values(subjectCheckpoint.person_dossier_checkpoints)
    .find(row => row?.unit === 'wardrobe_detail:outfit_silhouette');
  assert.strictEqual(detailCheckpoint.status, 'submitted_unknown');
  assert.strictEqual(detailCheckpoint.billing_state, 'unknown');
  const accessoryCheckpoint = Object.values(subjectCheckpoint.person_dossier_checkpoints)
    .find(row => row?.unit === 'wearable_accessory:wrist_wearables');
  assert.strictEqual(accessoryCheckpoint.status, 'completed');
  assert.strictEqual(accessoryCheckpoint.billing_state, 'confirmed');

  await assert.rejects(
    subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps),
    error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN',
  );
  assert.strictEqual(personProviderCalls, 6, 'core person checkpoints must be reused');
  assert.strictEqual(detailProviderCalls, 1, 'billing-unknown detail must never be resubmitted automatically');
  assert.strictEqual(isolatedAccessoryCalls, 2, 'completed isolated accessories must be reused after a later wardrobe failure');
  assert.strictEqual(petProviderCalls, 1, 'completed pet checkpoint must be reused');

  const latestRow = storage.listOutputs('visual-recovery-task')
    .find(row => row.kind.startsWith('subject_asset_checkpoint:'));
  const latestAccessoryEntry = Object.entries(latestRow.payload.person_dossier_checkpoints)
    .find(([, checkpoint]) => checkpoint?.status === 'submitted_unknown' && checkpoint?.billing_state === 'unknown');
  const [latestAccessoryKey, latestAccessoryCheckpoint] = latestAccessoryEntry;
  const authorizedCheckpoint = checkpointService.authorizeAmbiguousRetry(latestAccessoryCheckpoint, {
    acceptDuplicateChargeRisk: true,
    acceptedBy: 'test-user',
    supportId: 'support-test',
  });
  storage.saveOutput('visual-recovery-task', latestRow.kind, {
    ...latestRow.payload,
    person_dossier_checkpoints: {
      ...latestRow.payload.person_dossier_checkpoints,
      [latestAccessoryKey]: authorizedCheckpoint,
    },
  });
  await assert.rejects(
    subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps),
    error => error.code === 'PROVIDER_5XX_AMBIGUOUS' && error.billingState === 'unknown',
  );
  assert.strictEqual(detailProviderCalls, 2, 'explicit acceptance grants exactly one additional detail submission');
  assert.strictEqual(isolatedAccessoryCalls, 2, 'authorized wardrobe retry must not regenerate completed accessory objects');
  assert.strictEqual(petProviderCalls, 1, 'authorized accessory retry must still reuse the completed pet');
  await assert.rejects(
    subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps),
    error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN',
  );
  assert.strictEqual(detailProviderCalls, 2, 'a second ambiguous failure must lock again after the one-time authorization is consumed');
  const consumedCheckpoint = Object.values(storage.listOutputs('visual-recovery-task')
    .find(row => row.kind.startsWith('subject_asset_checkpoint:')).payload.person_dossier_checkpoints)
    .find(checkpoint => checkpoint?.unit === 'wardrobe_detail:outfit_silhouette');
  assert.strictEqual(consumedCheckpoint.retry_authorization.remaining_uses, 0);
  assert.ok(consumedCheckpoint.retry_authorization.consumed_at);
  assert.strictEqual(consumedCheckpoint.attempt_history.length, 1);

  const originalGetTask = projectStorage.getTask;
  const originalUpdateTask = projectStorage.updateTask;
  let progressTask = { id: 'progress-task' };
  try {
    projectStorage.getTask = () => clone(progressTask);
    projectStorage.updateTask = (taskId, patch) => {
      progressTask = { ...progressTask, ...clone(patch) };
      return clone(progressTask);
    };
    visualAssetProgress.initialize('progress-task', 'progress-generation', {
      subjectsRequired: true, subjectTotal: 8, scenesRequired: true, sceneTotal: 11,
    });
    visualAssetProgress.updateLane('progress-task', 'subjects', { status: 'running', completed: 6 });
    visualAssetProgress.updateLane('progress-task', 'scenes', { status: 'running', completed: 0 });
    visualAssetProgress.finish('progress-task', 'partial_failed');
    assert.strictEqual(progressTask.generation_progress.lanes.subjects.status, 'failed');
    assert.strictEqual(progressTask.generation_progress.lanes.scenes.status, 'failed');
    assert.strictEqual(progressTask.generation_progress.completed, 6);

    progressTask = { id: 'progress-task' };
    visualAssetProgress.initialize('progress-task', 'stable-denominator-generation', {
      subjectsRequired: true, subjectTotal: 2, scenesRequired: true, sceneTotal: 8,
    });
    visualAssetOrchestration.updateSubjectProgress('progress-task', 'stable-denominator-generation', {
      phase: 'person_dossier', subject_index: 1, total: 21, processed: 7,
    });
    assert.strictEqual(progressTask.generation_progress.total, 10, 'public denominator must stay at two subjects plus eight scenes');
    assert.strictEqual(progressTask.generation_progress.lanes.subjects.total, 2, 'internal dossier work must not replace logical subject count');
    assert.strictEqual(progressTask.generation_progress.lanes.subjects.work_total, 21, 'internal work total remains available as secondary diagnostics');
    assert.strictEqual(progressTask.generation_progress.lanes.subjects.work_completed, 7);
  } finally {
    projectStorage.getTask = originalGetTask;
    projectStorage.updateTask = originalUpdateTask;
  }

  const originalStorage = {
    getTask: projectStorage.getTask,
    listOutputs: projectStorage.listOutputs,
    saveOutput: projectStorage.saveOutput,
    updateTask: projectStorage.updateTask,
  };
  let authorizationTask = {
    id: 'authorization-task', support_id: 'support-authorization', active_generation_id: '',
    retryable: false, error_code: 'GENERATION_BILLING_STATE_UNKNOWN', generation_progress: { lanes: { subjects: {} } },
  };
  let authorizationOutput = {
    kind: 'subject_asset_checkpoint:authorization-task:one',
    payload: {
      person_dossier_checkpoints: {
        'person_detail:actor:1:wearable_accessory:wrist': {
          key: 'person_detail:actor:1:wearable_accessory:wrist',
          status: 'submitted_unknown', provider_submission_state: 'submitted_unknown', billing_state: 'unknown',
        },
      },
    },
  };
  try {
    projectStorage.getTask = () => clone(authorizationTask);
    projectStorage.listOutputs = () => [clone(authorizationOutput)];
    projectStorage.saveOutput = (taskId, kind, payload) => { authorizationOutput = { kind, payload: clone(payload) }; return payload; };
    projectStorage.updateTask = (taskId, patch) => { authorizationTask = { ...authorizationTask, ...clone(patch) }; return clone(authorizationTask); };
    assert.throws(() => billingAuthorization.authorizeTaskRetry({
      taskId: 'authorization-task', supportId: 'support-authorization', acceptedBy: 'owner',
    }), error => error.code === 'GENERATION_DUPLICATE_CHARGE_ACCEPTANCE_REQUIRED');
    const authorization = billingAuthorization.authorizeTaskRetry({
      taskId: 'authorization-task', supportId: 'support-authorization', acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.strictEqual(authorization.authorized, true);
    assert.strictEqual(authorization.remaining_uses, 1);
    assert.strictEqual(authorizationOutput.payload.person_dossier_checkpoints['person_detail:actor:1:wearable_accessory:wrist'].retry_authorization.remaining_uses, 1);
    const duplicateAuthorization = billingAuthorization.authorizeTaskRetry({
      taskId: 'authorization-task', supportId: 'support-authorization', acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.strictEqual(duplicateAuthorization.duplicate, true, 'repeated confirmation before submission must not mint extra uses');
  } finally {
    Object.assign(projectStorage, originalStorage);
  }

  console.log(JSON.stringify({
    passed: true,
    provider_500_classification: 'PROVIDER_5XX_AMBIGUOUS',
    core_person_calls: personProviderCalls,
    detail_calls: detailProviderCalls,
    authorized_retry_calls: 1,
    pet_calls: petProviderCalls,
    billing_unknown_resubmissions: 0,
    stale_running_lanes: 0,
    authorization_remaining_uses: 1,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
