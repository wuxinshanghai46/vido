const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const concurrency = require('../src/services/newStoryAd/generationConcurrencyService');
const guard = require('../src/services/newStoryAd/generationBillingGuardService');
const projection = require('../src/services/newStoryAd/subjectCheckpointProjectionService');
const sceneProjection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const workspaceProjection = require('../src/services/storyAdWorkspace/projectBundleService');
const { sceneProjectionRows } = require('../src/services/newStoryAd/taskViewService');
const storage = require('../src/services/newStoryAd/storageService');
const billing = require('../src/services/newStoryAd/visualAssetBillingAuthorizationService');
const subjectAssets = require('../src/services/newStoryAd/subjectAssetBundleService');
const readiness = require('./check-new-story-ad-active-tasks');

assert.equal(readiness.isUnknownBilling({ billing_state: 'unknown', provider_submission_state: 'submitted_unknown' }), true,
  'readiness must block submitted_unknown billing records');
assert.equal(readiness.isUnknownBilling({ billing_state: 'confirmed', provider_submission_state: 'completed' }), false);
const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-immutable-release.js'), 'utf8');
assert(deploySource.includes('blockingUnknownBilling'), 'deployment must distinguish historical unresolved billing from an active generation blocker');
assert(deploySource.includes('active_unknown_billing_count'), 'deployment reporting must preserve the current-generation billing blocker count');

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
  const first = guard.run({ taskId: 'task-a', generationId: 'gen-a', unitKey: 'scene-1:layout' }, async () => {
    sameScopeInvocations += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
    throw ambiguousError();
  });
  const queued = guard.run({ taskId: 'task-a', generationId: 'gen-a', unitKey: 'scene-1:layout' }, async () => {
    sameScopeInvocations += 1;
    return 'must-not-submit';
  });
  const independentUnit = guard.run({ taskId: 'task-a', generationId: 'gen-a', unitKey: 'scene-2:master' }, async () => 'independent-unit-ok');
  const otherUser = guard.run({ taskId: 'task-b', generationId: 'gen-b', unitKey: 'scene-1:layout' }, async () => 'other-user-ok');
  const [firstResult, queuedResult, independentResult, otherResult] = await Promise.allSettled([first, queued, independentUnit, otherUser]);
  assert.equal(firstResult.status, 'rejected');
  assert.equal(queuedResult.status, 'rejected');
  assert.equal(queuedResult.reason.code, 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN');
  assert.equal(queuedResult.reason.providerSubmissionState, 'not_submitted');
  assert.equal(sameScopeInvocations, 1, 'same-generation queued provider call must not be invoked');
  assert.equal(peak, 1, 'same generation must have at most one paid image call active');
  assert.equal(independentResult.value, 'independent-unit-ok', 'an ambiguous unit must not block an independent unit in the same generation');
  assert.equal(otherResult.value, 'other-user-ok', 'another task/user must remain isolated');
}

async function testConfirmedNotSubmitted5xxDoesNotTripBillingGuard() {
  guard.resetForTests();
  concurrency.resetForTests();
  const safeFailure = new Error('provider gateway timeout');
  safeFailure.code = 'PROVIDER_5XX_NOT_SUBMITTED';
  safeFailure.providerSubmissionState = 'submission_rejected';
  safeFailure.billingState = 'not_billed';
  safeFailure.response = { status: 504 };
  const first = await guard.run({ taskId: 'task-safe', generationId: 'gen-safe', unitKey: 'scene:detail' }, async () => {
    throw safeFailure;
  }).then(() => null, error => error);
  assert.strictEqual(first, safeFailure);
  let fallbackInvocations = 0;
  const fallback = await guard.run({ taskId: 'task-safe', generationId: 'gen-safe', unitKey: 'scene:detail' }, async () => {
    fallbackInvocations += 1;
    return 'fallback-ok';
  });
  assert.equal(fallback, 'fallback-ok');
  assert.equal(fallbackInvocations, 1, 'confirmed not-submitted 5xx must allow the next safe provider candidate');
}

function subjectUnit(key, status = 'submitted_unknown') {
  return {
    key, task_id: 'task-a', asset_type: 'person_dossier', asset_id: 'actor-1', unit: 'wardrobe_detail', revision: 1,
    status, provider_submission_state: 'submitted_unknown', billing_state: 'unknown', error: { code: 'PROVIDER_5XX_AMBIGUOUS' },
    billing_review: { state: 'unverifiable', revision: 2, reviewer: 'test-reviewer', evidence: 'provider lookup inconclusive' },
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
        views: { layout: { key: 'layout', status: 'failed', billing_state: 'unknown', provider_submission_state: 'submitted_unknown', provider_task_id: 'provider-task-layout', error_code: 'PROVIDER_5XX_AMBIGUOUS', billing_review: { state: 'unverifiable', revision: 2, reviewer: 'test-reviewer', evidence: 'provider lookup inconclusive' } } },
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

function testAuthorizationAfterSupportIdCleared() {
  const original = {
    getTask: storage.getTask,
    listOutputs: storage.listOutputs,
    saveOutput: storage.saveOutput,
  };
  const task = { id: 'task-cleared-support', support_id: '', active_generation_id: '', status: 'done' };
  const rows = [{
    kind: 'subject_asset_checkpoint:task-cleared-support:one',
    payload: {
      person_dossier_checkpoints: { 'hair-accessory': { ...subjectUnit('hair-accessory'), task_id: task.id, unit: 'wearable_accessory:hair_accessories' } },
      subject_checkpoint_owners: { 'hair-accessory': { kind: 'human', subject_id: 'person-1', index: 0 } },
    },
  }];
  storage.getTask = id => id === task.id ? task : null;
  storage.listOutputs = id => id === task.id ? rows : [];
  storage.saveOutput = (_id, kind, payload) => {
    const row = rows.find(item => item.kind === kind);
    if (row) row.payload = payload;
    return payload;
  };
  try {
    const first = billing.listBillingReviews(task.id);
    assert.match(first.support_id, /^billing-review-[a-f0-9]{32}$/, 'cleared task support id must be replaced by a stable review-set id');
    assert.equal(first.review_count, 1);
    assert.throws(() => billing.authorizeTaskRetry({
      taskId: task.id, supportId: '', checkpointKey: 'hair-accessory', acceptDuplicateChargeRisk: true,
    }), error => error.code === 'VISUAL_ASSET_RETRY_SUPPORT_ID_MISMATCH');
    const authorized = billing.authorizeTaskRetry({
      taskId: task.id, supportId: first.support_id, checkpointKey: 'hair-accessory', acceptedBy: 'owner', acceptDuplicateChargeRisk: true,
    });
    assert.equal(authorized.authorized, true);
    assert.equal(rows[0].payload.person_dossier_checkpoints['hair-accessory'].retry_authorization.support_id, first.support_id);
    assert.equal(billing.listBillingReviews(task.id).support_id, first.support_id, 'authorizing one unit must not rotate the current review-set id');
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
  assert.ok(merged[0].category_atlases.length <= projection.MAX_PROJECTED_MEDIA, 'projection payload must remain bounded without requiring deprecated generic atlas promotion');
  assert.ok(!JSON.stringify(merged[0]).includes('provider 500'), 'failed/unknown provider result must not be presented as successful media');

  const scenes = sceneProjection.projectSceneAssets([
    { kind: 'scene_config', payload: { spaces: [{ id: 'scene-1', name: 'Scene One' }] } },
    { kind: 'scene_asset_checkpoint:scene-1', payload: {
      scene_id: 'scene-1', status: 'failed', views: {
        master: { status: 'succeeded', image_url: '/api/new-story-ad/assets/scene-master.png' },
        layout: { status: 'failed', image_url: '/api/new-story-ad/assets/rejected-layout.png', billing_state: 'unknown', provider_submission_state: 'submitted_unknown' },
        detail: { status: 'failed', billing_state: 'not_submitted', provider_submission_state: 'not_submitted', error_code: 'GENERATION_STOPPED_AFTER_BILLING_UNKNOWN' },
      },
    } },
  ]);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].view_images.length, 1);
  assert.equal(scenes[0].checkpoint_status, 'failed', 'aggregate failure must not hide succeeded paid views');
  assert.match(scenes[0].image_url, /scene-master/);
  assert.ok(!JSON.stringify(scenes[0].view_images).includes('rejected-layout'));

  const workspaceScenes = workspaceProjection.sceneAssets({
    scene_config: { spaces: [{ id: 'scene-1', name: 'Scene One' }] },
    scene_assets: scenes,
  }, {});
  assert.equal(workspaceScenes[0].partial_checkpoint, true, 'workspace projection must preserve partial checkpoint state');
  assert.equal(workspaceScenes[0].checkpoint_status, 'failed');
  assert.deepEqual(workspaceScenes[0].completed_view_keys, ['master']);
  assert.deepEqual(workspaceScenes[0].failed_view_keys, ['layout', 'detail']);
  assert.equal(workspaceScenes[0].view_statuses.layout.state, 'billing_review', 'workspace must preserve submitted-unknown billing review state');
  assert.equal(workspaceScenes[0].view_statuses.detail.state, 'pending', 'workspace must preserve safely blocked unsubmitted state');
  assert.equal(workspaceScenes[0].repair_plan.action, 'regenerate_failed_views', 'workspace must expose a safe resume action guarded by per-unit billing review');
  assert.deepEqual(workspaceScenes[0].repair_plan.view_keys, ['detail', 'layout']);
  assert.equal(workspaceScenes[0].view_images.length, 1, 'workspace must keep the succeeded scene view visible');

  const lineageRows = sceneProjectionRows([
    { kind: 'scene_config', updated_at: '2026-08-05T14:20:00.000Z', payload: { spaces: [{ id: 'scene-1' }] } },
    { kind: 'scene_assets', updated_at: '2026-08-05T14:00:00.000Z', payload: [{ scene_id: 'scene-1', image_url: '/stale.png' }] },
    { kind: 'scene_asset_checkpoint:scene-old', updated_at: '2026-08-05T14:10:00.000Z', payload: { scene_id: 'scene-1', status: 'partial', views: { master: { status: 'succeeded', image_url: '/old.png' } } } },
    { kind: 'scene_asset_checkpoint:scene-fresh', updated_at: '2026-08-06T06:30:00.000Z', payload: { scene_id: 'scene-1', status: 'partial', views: { master: { status: 'succeeded', image_url: '/fresh.png' } } } },
  ], { invalidated_at: '2026-08-05T14:19:38.722Z' });
  assert.equal(lineageRows.some(row => row.kind === 'scene_assets'), false, 'invalidated formal scene assets must remain hidden');
  assert.equal(lineageRows.some(row => row.kind.includes('scene-old')), false, 'checkpoint older than invalidation must remain hidden');
  assert.equal(lineageRows.some(row => row.kind.includes('scene-fresh')), true, 'fresh checkpoint after invalidation must remain recoverable');
  assert.match(sceneProjection.projectSceneAssets(lineageRows)[0].image_url, /fresh/);
}

function testUiScope() {
  const view = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterView.js'), 'utf8');
  const retry = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterBillingRetry.js'), 'utf8');
  const sceneInteractions = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneCardInteractions.js'), 'utf8');
  assert.ok(!view.includes('当前人物配饰存在计费未知记录'));
  assert.ok(retry.includes("lane: 'subjects'"));
  assert.ok(sceneInteractions.includes("lane: 'scenes'"));
  assert.ok(sceneInteractions.includes('await authorizeBillingReviews({ bundle: context.bundle')
    && !sceneInteractions.includes('confirmBillingAwareAction'), 'scene recovery click must write the revision-bound authorization directly without a second confirmation dialog');
  assert.ok(retry.includes('checkpoint_keys: reviews.map(review => review.review_key)'));
  assert.ok(retry.includes('expected_review_revisions:'), 'unknown units must be authorized by one revision-bound batch');
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
  const authoritativeProfiles = [{ id: 'person-1', displayName: '稳定人物', wardrobeText: '锁定服装' }];
  const overlaid = subjectAssets.resumeProfileOverlay({
    listOutputs: () => [{ kind: 'subject_asset_checkpoint:latest', updated_at: '2026-08-24T01:00:00.000Z', payload: {
      ...partial, input_profiles: { humans: authoritativeProfiles, pets: [] },
    } }],
  }, 'task-a', { expected_people: 1, expected_animals: 0, resume_partial_checkpoint: true,
    cast_profiles: [{ id: 'person-1', displayName: '模型再次规划后的漂移文本' }] });
  assert.deepEqual(overlaid.cast_profiles, authoritativeProfiles,
    '恢复批次必须复用失败检查点的原始人物输入，不能让再次规划的措辞漂移使图片失效');
}

async function main() {
  await testGenerationIsolation();
  await testConfirmedNotSubmitted5xxDoesNotTripBillingGuard();
  testExactAuthorization();
  testAuthorizationAfterSupportIdCleared();
  testPartialProjection();
  testUiScope();
  testPartialResumeSelection();
  console.log(JSON.stringify({
    success: true,
    checks: 8,
    guarantees: ['same-task-stop-before-submit', 'confirmed-not-submitted-fallback', 'cross-task-isolation', 'exact-unit-authorization', 'bounded-partial-projection'],
  }));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
