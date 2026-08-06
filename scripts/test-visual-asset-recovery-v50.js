const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const concurrency = require('../src/services/newStoryAd/generationConcurrencyService');
const guard = require('../src/services/newStoryAd/generationBillingGuardService');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
const sceneProjection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const storage = require('../src/services/newStoryAd/storageService');
const billing = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');

function ambiguousError() {
  const error = new Error('provider 500');
  error.code = 'PROVIDER_5XX_AMBIGUOUS';
  error.billingState = 'unknown';
  error.providerSubmissionState = 'submitted_unknown';
  return error;
}

async function testGenerationIsolation() {
  guard.resetForTests();
  concurrency.resetForTests();
  let sameScopeInvocations = 0;
  let active = 0;
  let peak = 0;
  const first = guard.run({ taskId: 'task-a', generationId: 'gen-a' }, async () => {
    sameScopeInvocations += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    throw ambiguousError();
  });
  const queued = guard.run({ taskId: 'task-a', generationId: 'gen-a' }, async () => {
    sameScopeInvocations += 1;
    return 'must-not-submit';
  });
  const otherUser = guard.run({ taskId: 'task-b', generationId: 'gen-b' }, async () => 'other-user-ok');
  const [firstResult, queuedResult, otherResult] = await Promise.allSettled([first, queued, otherUser]);
  assert.equal(firstResult.status, 'rejected');
  assert.equal(queuedResult.status, 'rejected');
  assert.equal(queuedResult.reason.code, 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN');
  assert.equal(queuedResult.reason.providerSubmissionState, 'not_submitted');
  assert.equal(sameScopeInvocations, 1, 'same-generation queued provider call must not be invoked');
  assert.equal(peak, 1, 'same generation must have at most one paid image call active');
  assert.equal(otherResult.value, 'other-user-ok', 'another task/user must remain isolated');
}

function subjectUnit(key, status = 'submitted_unknown') {
  return {
    key, task_id: 'task-a', asset_type: 'person_dossier', asset_id: 'actor-1', unit: 'wardrobe_detail', revision: 1,
    status, provider_submission_state: 'submitted_unknown', billing_state: 'unknown', error: { code: 'PROVIDER_5XX_AMBIGUOUS' },
  };
}

function testExactAuthorization() {
  const original = {
    getTask: storage.getTask,
    listOutputs: storage.listOutputs,
    saveOutput: storage.saveOutput,
  };
  const task = { id: 'task-a', support_id: 'support-a', active_generation_id: '' };
  const rows = [
    {
      kind: 'subject_asset_checkpoint:task-a:one',
      payload: {
        person_dossier_checkpoints: { 'subject-key': subjectUnit('subject-key') },
        subject_checkpoint_owners: { 'subject-key': { kind: 'human', subject_id: 'person-1', index: 0 } },
      },
    },
    {
      kind: 'scene_asset_checkpoint:scene-1',
      payload: {
        task_id: 'task-a', scene_id: 'scene-1', status: 'partial',
        views: { layout: { key: 'layout', status: 'failed', billing_state: 'unknown', provider_submission_state: 'submitted_unknown', error_code: 'PROVIDER_5XX_AMBIGUOUS' } },
      },
    },
  ];
  storage.getTask = id => id === 'task-a' ? task : null;
  storage.listOutputs = id => id === 'task-a' ? rows : [];
  storage.saveOutput = (_id, kind, payload) => {
    const row = rows.find(item => item.kind === kind);
    if (row) row.payload = payload;
    return payload;
  };
  try {
    const listed = billing.listBillingReviews('task-a');
    assert.equal(listed.review_count, 2);
    assert.deepEqual(listed.reviews.map(item => item.lane).sort(), ['scenes', 'subjects']);
    assert.throws(() => billing.authorizeTaskRetry({ taskId: 'task-a', supportId: 'support-a', acceptDuplicateChargeRisk: true }), error => error.code === 'VISUAL_ASSET_MULTIPLE_BILLING_REVIEWS_REQUIRED');
    assert.throws(() => billing.authorizeTaskRetry({ taskId: 'task-a', supportId: 'support-a', checkpointKey: 'foreign-key', acceptDuplicateChargeRisk: true }), error => error.code === 'VISUAL_ASSET_BILLING_REVIEW_MISMATCH');
    const subject = billing.authorizeTaskRetry({
      taskId: 'task-a', supportId: 'support-a', checkpointKey: 'subject-key', acceptedBy: 'user-a', acceptDuplicateChargeRisk: true,
    });
    assert.equal(subject.authorized, true);
    assert.equal(rows[0].payload.person_dossier_checkpoints['subject-key'].retry_authorization.remaining_uses, 1);
    assert.equal(rows[1].payload.views.layout.retry_authorization, undefined, 'authorizing a person must not authorize a scene');
    const sceneKey = billing.listBillingReviews('task-a').reviews.find(item => item.kind === 'scene').review_key;
    const scene = billing.authorizeTaskRetry({
      taskId: 'task-a', supportId: 'support-a', checkpointKey: sceneKey, acceptedBy: 'user-a', acceptDuplicateChargeRisk: true,
    });
    assert.equal(scene.authorized, true);
    assert.equal(rows[1].payload.views.layout.retry_authorization.remaining_uses, 1);
  } finally {
    Object.assign(storage, original);
  }
}

function testPartialProjection() {
  const completed = index => ({
    key: `unit-${index}`, status: 'completed', provider_submission_state: 'completed', billing_state: 'confirmed',
    unit: `atlas-${index}`, result: { sheet: { image_url: `/api/new-story-ad/assets/success-${index}.png` } },
  });
  const units = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`unit-${index}`, completed(index)]));
  units.failed = subjectUnit('failed');
  const people = [{ subject_id: 'person-1', profile: { id: 'person-1' }, image_url: '', category_atlases: [], status: 'draft' }];
  const merged = projection.mergePeople(people, {
    'subject_asset_checkpoint:task-a:partial': {
      status: 'running', updated_at: new Date().toISOString(), person_dossier_checkpoints: units,
      subject_checkpoint_owners: Object.fromEntries(Object.keys(units).map(key => [key, { subject_id: 'person-1', index: 0 }])),
    },
  });
  assert.equal(merged[0].partial_checkpoint, true);
  assert.match(merged[0].image_url, /success-/);
  assert.equal(merged[0].category_atlases.length, projection.MAX_PROJECTED_MEDIA, 'projection payload must be bounded');
  assert.ok(!JSON.stringify(merged[0]).includes('provider 500'), 'failed/unknown provider result must not be presented as successful media');

  const scenes = sceneProjection.projectSceneAssets([
    { kind: 'scene_config', payload: { spaces: [{ id: 'scene-1', name: 'Scene One' }] } },
    { kind: 'scene_asset_checkpoint:scene-1', payload: {
      scene_id: 'scene-1', status: 'failed', views: {
        master: { status: 'succeeded', image_url: '/api/new-story-ad/assets/scene-master.png' },
        layout: { status: 'failed', image_url: '/api/new-story-ad/assets/rejected-layout.png', billing_state: 'unknown' },
      },
    } },
  ]);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].view_images.length, 1);
  assert.equal(scenes[0].checkpoint_status, 'failed', 'aggregate failure must not hide succeeded paid views');
  assert.match(scenes[0].image_url, /scene-master/);
  assert.ok(!JSON.stringify(scenes[0].view_images).includes('rejected-layout'));
}

function testUiScope() {
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
  const retry = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterBillingRetry.js'), 'utf8');
  assert.ok(!view.includes('当前人物配饰存在计费未知记录'));
  assert.ok(view.includes("lane: 'subjects'"));
  assert.ok(view.includes("lane: 'scenes'"));
  assert.ok(retry.includes('checkpoint_key: review.review_key'));
  assert.ok(retry.includes('for (const review of reviews)'), 'unknown units must be authorized one by one');
  assert.ok(view.includes('resume_partial_checkpoint = target.partial_checkpoint === true'));
}

function testPartialResumeSelection() {
  const partial = {
    status: 'failed', counts: { people: 1, pets: 0, mode: 'single' },
    targets: [{ kind: 'human', id: 'person-1', index: 0, key: 'human:person-1:1' }],
    person_dossier_checkpoints: { complete: { status: 'completed', result: { image_url: '/kept.png' } } },
  };
  const selected = subjectAssets.resumablePartialCheckpoint({
    listOutputs: () => [{ kind: 'subject_asset_checkpoint:old', payload: partial, updated_at: new Date().toISOString() }],
  }, 'task-a', { people: 1, pets: 0, mode: 'single' }, {
    selected: [{ kind: 'human', id: 'person-1', index: 0, key: 'human:person-1:1' }],
  }, [{ id: 'person-1' }], []);
  assert.strictEqual(selected, partial, 'single-item retry must resume the prior partial checkpoint');
  const keyA = subjectAssets.checkpointKind('task-a', 'brief', {}, { people: 1, pets: 0 }, {
    regenerate_selected: true, resume_partial_checkpoint: true, request_key: 'click-a',
  });
  const keyB = subjectAssets.checkpointKind('task-a', 'brief', {}, { people: 1, pets: 0 }, {
    regenerate_selected: true, resume_partial_checkpoint: true, request_key: 'click-b',
  });
  assert.equal(keyA, keyB, 'resume request keys must not invalidate successful checkpoint units');
}

async function main() {
  await testGenerationIsolation();
  testExactAuthorization();
  testPartialProjection();
  testUiScope();
  testPartialResumeSelection();
  console.log(JSON.stringify({
    success: true,
    checks: 5,
    guarantees: ['same-task-stop-before-submit', 'cross-task-isolation', 'exact-unit-authorization', 'bounded-partial-projection'],
  }));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
