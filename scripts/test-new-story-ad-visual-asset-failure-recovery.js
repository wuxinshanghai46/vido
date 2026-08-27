const assert = require('assert');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const visualAssetProgress = require('../src/services/newStoryAd/visualAssetProgressService');
const visualAssetOrchestration = require('../src/services/newStoryAd/visualAssetOrchestrationService');
const projectStorage = require('../src/services/newStoryAd/storageService');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const billingAuthorization = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const dossierComposites = require('../src/services/newStoryAd/dossierCompositeService');

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

  const originalReadHealth = projectStorage.readHealth;
  const originalWriteHealth = projectStorage.writeHealth;
  let providerHealth = {};
  try {
    projectStorage.readHealth = () => clone(providerHealth);
    projectStorage.writeHealth = next => { providerHealth = clone(next); };
    const providerModel = { provider_id: 'provider-a', model_id: 'gpt-image-2' };
    modelGateway.recordHealth(providerModel, {
      ok: false,
      error: Object.assign(new Error('ambiguous upstream 500'), { code: 'PROVIDER_5XX' }),
      latencyMs: 149000,
    });
    const health = modelGateway.healthState(providerModel);
    assert.strictEqual(health.circuit_open, true, 'ambiguous 5xx must open a shared provider/model circuit');
    assert.ok(health.cooldown_remaining_ms > 0 && health.cooldown_remaining_ms <= 5 * 60 * 1000);
    modelGateway.recordHealth(providerModel, { ok: true, latencyMs: 1000 });
    assert.strictEqual(
      modelGateway.healthState(providerModel).circuit_open,
      true,
      'an overlapping success must not clear an ambiguity cooldown opened for other users',
    );
    const availability = mediaAdapter.imageCandidateAvailability([providerModel], 1);
    assert.strictEqual(availability.available.length, 0, 'an open provider circuit must remove the model from executable candidates');
    assert.strictEqual(availability.circuit_open_count, 1);
    assert.ok(availability.retry_after_ms > 0, 'the unavailable-channel response must expose a concrete cooldown');
  } finally {
    projectStorage.readHealth = originalReadHealth;
    projectStorage.writeHealth = originalWriteHealth;
  }

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

  await subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps);
  assert.strictEqual(personProviderCalls, 3, 'default three-view dossier must finish its one atlas and two native masters before the accessory failure');
  assert.strictEqual(isolatedAccessoryCalls, 2, 'the declared watch and completed footwear must each be generated once as isolated catalog objects');
  assert.strictEqual(detailProviderCalls, 0, 'core subject generation must not submit the separately managed wardrobe-detail stage');
  assert.strictEqual(petProviderCalls, 1, 'pet generation must complete independently from person detail generation');

  const subjectCheckpoint = storage.listOutputs('visual-recovery-task')
    .find(row => row.kind.startsWith('subject_asset_checkpoint:'))?.payload;
  assert.strictEqual(subjectCheckpoint.status, 'complete');
  assert.strictEqual(subjectCheckpoint.pets.filter(Boolean).length, 1, 'completed pet must be persisted in the subject checkpoint');
  const accessoryCheckpoint = Object.values(subjectCheckpoint.person_dossier_checkpoints)
    .find(row => row?.unit === 'wearable_accessory:wrist_wearables');
  assert.strictEqual(accessoryCheckpoint.status, 'completed');
  assert.strictEqual(accessoryCheckpoint.billing_state, 'confirmed');

  await subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps);
  assert.strictEqual(personProviderCalls, 3, 'default three-view dossier checkpoints must be reused');
  assert.strictEqual(isolatedAccessoryCalls, 2, 'completed isolated accessories must be reused after a later wardrobe failure');
  assert.strictEqual(petProviderCalls, 1, 'completed pet checkpoint must be reused');

  const detailCheckpoints = {};
  const detailOptions = {
    taskId: 'visual-recovery-task', assetId: 'human-1', revision: 1,
    atomicAssets: [
      { id: 'front', kind: 'body', key: 'front', image_url: '/person-unit-1.png' },
      { id: 'three-quarter', kind: 'body', key: 'three_quarter', image_url: '/person-unit-2.png' },
    ],
    profile: body.cast_profiles[0],
    loadCheckpoint: async key => clone(detailCheckpoints[key]),
    saveCheckpoint: async (key, value) => { detailCheckpoints[key] = clone(value); },
  };
  await assert.rejects(
    dossierComposites.generateWardrobeDetails(detailOptions, { mediaAdapter: fakeMedia }),
    error => error.code === 'PROVIDER_5XX_AMBIGUOUS' && error.billingState === 'unknown',
  );
  assert.strictEqual(detailProviderCalls, 1, 'the ambiguous paid wardrobe detail unit is submitted once');
  const detailKey = Object.keys(detailCheckpoints)
    .find(key => detailCheckpoints[key]?.unit === 'wardrobe_detail:outfit_silhouette');
  assert.ok(detailKey, 'the real wardrobe-detail checkpoint must record the ambiguous unit');
  assert.strictEqual(detailCheckpoints[detailKey].status, 'submitted_unknown');
  assert.strictEqual(detailCheckpoints[detailKey].billing_state, 'unknown');
  await assert.rejects(
    dossierComposites.generateWardrobeDetails(detailOptions, { mediaAdapter: fakeMedia }),
    error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN',
  );
  assert.strictEqual(detailProviderCalls, 1, 'billing-unknown detail must never be resubmitted automatically');

  detailCheckpoints[detailKey] = checkpointService.authorizeAmbiguousRetry(detailCheckpoints[detailKey], {
    acceptDuplicateChargeRisk: true,
    acceptedBy: 'test-user',
    supportId: 'support-test',
  });
  await assert.rejects(
    dossierComposites.generateWardrobeDetails(detailOptions, { mediaAdapter: fakeMedia }),
    error => error.code === 'PROVIDER_5XX_AMBIGUOUS' && error.billingState === 'unknown',
  );
  assert.strictEqual(detailProviderCalls, 2, 'explicit acceptance grants exactly one additional detail submission');
  await assert.rejects(
    dossierComposites.generateWardrobeDetails(detailOptions, { mediaAdapter: fakeMedia }),
    error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN',
  );
  assert.strictEqual(detailProviderCalls, 2, 'a second ambiguous failure must lock again after the one-time authorization is consumed');
  const consumedCheckpoint = detailCheckpoints[detailKey];
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
    visualAssetProgress.initialize('progress-task', 'historical-billing-generation', {
      subjectsRequired: true, subjectTotal: 1, scenesRequired: false, sceneTotal: 0,
    });
    visualAssetOrchestration.markRejectedLanes(
      'progress-task',
      { status: 'rejected', reason: Object.assign(new Error('old provider response'), { code: 'GENERATION_BILLING_STATE_UNKNOWN' }) },
      { status: 'fulfilled', value: null },
    );
    assert.strictEqual(progressTask.generation_progress.lanes.subjects.billing_state, 'unknown');
    assert.match(progressTask.generation_progress.lanes.subjects.message, /本轮没有重复提交该单元/);

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
    visualAssetProgress.updateSceneUnit('progress-task', {
      scene_id: 'scene_001', target_total: 5, processed: 1, status: 'running',
    });
    assert.strictEqual(progressTask.generation_progress.completed, 0, 'one of five scene views must not become 0.2 completed business targets');
    assert.strictEqual(Number.isInteger(progressTask.generation_progress.completed), true, 'public completed target count must always be an integer');
    assert.strictEqual(progressTask.generation_progress.lanes.scenes.completed, 0, 'a scene only counts after the full scene unit completes');
    assert.deepStrictEqual(
      progressTask.generation_progress.lanes.scenes.current_view_progress,
      { completed: 1, total: 5 },
      'internal per-view progress remains available without leaking into the public target count',
    );
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
          billing_review: { state: 'unverifiable', revision: 2, reviewer: 'test-reviewer', evidence: 'provider lookup inconclusive' },
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
