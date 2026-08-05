const assert = require('assert');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const visualAssetProgress = require('../src/services/newStoryAd/visualAssetProgressService');
const projectStorage = require('../src/services/newStoryAd/storageService');

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
  let accessoryProviderCalls = 0;
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
        accessoryProviderCalls += 1;
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
  assert.strictEqual(accessoryProviderCalls, 1, 'the ambiguous paid accessory unit is submitted once');
  assert.strictEqual(petProviderCalls, 1, 'pet generation must continue after the independent person unit fails');

  const subjectCheckpoint = storage.listOutputs('visual-recovery-task')
    .find(row => row.kind.startsWith('subject_asset_checkpoint:'))?.payload;
  assert.strictEqual(subjectCheckpoint.status, 'partial');
  assert.strictEqual(subjectCheckpoint.pets.filter(Boolean).length, 1, 'completed pet must be persisted in the partial checkpoint');
  const accessoryCheckpoint = subjectCheckpoint.person_dossier_checkpoints['person_detail:new_story_actor_1e4fbc040212157a:1:wearable_accessory:wrist_wearables']
    || Object.values(subjectCheckpoint.person_dossier_checkpoints).find(row => row?.unit === 'wearable_accessory:wrist_wearables');
  assert.strictEqual(accessoryCheckpoint.status, 'submitted_unknown');
  assert.strictEqual(accessoryCheckpoint.billing_state, 'unknown');

  await assert.rejects(
    subjectAssets.generateSubjectBundle({ taskId: 'visual-recovery-task', body, personDossierConcurrency: 1 }, deps),
    error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN',
  );
  assert.strictEqual(personProviderCalls, 6, 'core person checkpoints must be reused');
  assert.strictEqual(accessoryProviderCalls, 1, 'billing-unknown accessory must never be resubmitted automatically');
  assert.strictEqual(petProviderCalls, 1, 'completed pet checkpoint must be reused');

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
  } finally {
    projectStorage.getTask = originalGetTask;
    projectStorage.updateTask = originalUpdateTask;
  }

  console.log(JSON.stringify({
    passed: true,
    provider_500_classification: 'PROVIDER_5XX_AMBIGUOUS',
    core_person_calls: personProviderCalls,
    accessory_calls: accessoryProviderCalls,
    pet_calls: petProviderCalls,
    billing_unknown_resubmissions: 0,
    stale_running_lanes: 0,
  }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
