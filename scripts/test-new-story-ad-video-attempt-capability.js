#!/usr/bin/env node
const assert = require('assert');

const attempts = require('../src/services/newStoryAd/videoAttemptStore');
const capabilities = require('../src/services/newStoryAd/videoProviderCapabilityService');
const privacyRetryPolicy = require('../src/services/newStoryAd/videoPrivacyRetryPolicyService');

function memoryStorage() {
  const values = new Map();
  const key = (taskId, kind) => `${taskId}:${kind}`;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  return {
    getOutput(taskId, kind) {
      return clone(values.get(key(taskId, kind)) ?? null);
    },
    saveOutput(taskId, kind, payload) {
      values.set(key(taskId, kind), clone(payload));
      return clone(payload);
    },
  };
}

function claimInput(overrides = {}) {
  return {
    taskId: 'attempt-test-task',
    shotIndex: 4,
    lineageFingerprint: 'lineage-v1',
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    costFingerprint: 'cost-v1',
    generationId: 'generation-v1',
    at: '2026-07-22T11:41:11.000Z',
    ...overrides,
  };
}

function testAttemptClaimAndAppendOnlyEvents() {
  const storage = memoryStorage();
  const store = attempts.createVideoAttemptStore(storage);
  const first = store.claim(claimInput());
  assert.strictEqual(first.claimed, true);
  assert.strictEqual(first.attempt.status, 'claimed');
  assert.strictEqual(first.attempt.provider_submission_state, 'not_submitted');
  assert.strictEqual(first.attempt.billing_state, 'not_submitted');

  const duplicate = store.claim(claimInput({ at: '2026-07-22T11:41:12.000Z' }));
  assert.strictEqual(duplicate.claimed, false);
  assert.strictEqual(duplicate.duplicate, true);
  assert.strictEqual(store.read('attempt-test-task').headers.length, 1);
  assert.strictEqual(store.read('attempt-test-task').events.length, 1);

  const conflicting = store.projectClaim(claimInput({
    lineageFingerprint: 'lineage-v2',
    costFingerprint: 'cost-v2',
  }));
  assert.strictEqual(conflicting.ready, false);
  assert.strictEqual(conflicting.conflict, true);
  assert.strictEqual(conflicting.blocking_attempt.attempt_id, first.attempt.attempt_id);

  const submitted = store.appendEvent({
    taskId: 'attempt-test-task',
    attemptId: first.attempt.attempt_id,
    type: 'provider_submitted',
    eventKey: 'provider-task-created:cgt-test-1',
    providerTaskId: 'cgt-test-1',
    billingState: 'unknown',
    requestedVideoSeconds: 5,
    at: '2026-07-22T11:41:13.000Z',
  });
  assert.strictEqual(submitted.appended, true);
  assert.strictEqual(submitted.attempt.provider_task_id, 'cgt-test-1');
  assert.strictEqual(submitted.attempt.retry_blocked, true);

  const repeatedEvent = store.appendEvent({
    taskId: 'attempt-test-task',
    attemptId: first.attempt.attempt_id,
    type: 'provider_submitted',
    eventKey: 'provider-task-created:cgt-test-1',
    providerTaskId: 'cgt-test-1',
    billingState: 'unknown',
    requestedVideoSeconds: 5,
    at: '2026-07-22T11:41:13.000Z',
  });
  assert.strictEqual(repeatedEvent.appended, false);
  assert.strictEqual(repeatedEvent.duplicate, true);
  assert.strictEqual(store.read('attempt-test-task').events.length, 2);

  assert.throws(() => store.appendEvent({
    taskId: 'attempt-test-task',
    attemptId: first.attempt.attempt_id,
    type: 'provider_submitted',
    eventKey: 'provider-task-created:cgt-test-1',
    providerTaskId: 'different-provider-task',
    at: '2026-07-22T11:41:13.000Z',
  }), error => error?.code === 'VIDEO_ATTEMPT_EVENT_ID_CONFLICT');
}

function testCurrentAndLastProjection() {
  const storage = memoryStorage();
  const store = attempts.createVideoAttemptStore(storage);
  const first = store.claim(claimInput());
  store.appendEvent({
    taskId: 'attempt-test-task',
    attemptId: first.attempt.attempt_id,
    type: 'pre_provider_failed',
    eventKey: 'asset-capability-failed',
    errorCode: 'VIDEO_PROVIDER_PRIVATE_ASSET_CAPABILITY_UNKNOWN',
    at: '2026-07-22T11:41:14.000Z',
  });
  const second = store.claim(claimInput({
    lineageFingerprint: 'lineage-v2',
    costFingerprint: 'cost-v2',
    generationId: 'generation-v2',
    at: '2026-07-22T12:00:00.000Z',
  }));
  assert.strictEqual(second.claimed, true);
  const view = store.projectCurrentAndLast({ taskId: 'attempt-test-task', shotIndex: 4 });
  assert.strictEqual(view.current.attempt_id, second.attempt.attempt_id);
  assert.strictEqual(view.current.provider_submission_state, 'not_submitted');
  assert.strictEqual(view.last.attempt_id, first.attempt.attempt_id);
  assert.strictEqual(view.last.status, 'failed');
  assert.strictEqual(view.last.billing_state, 'not_submitted');
  assert.strictEqual(view.attempts.length, 2);
}

function testCapabilityGateNeverUsesMutationAsProbe() {
  const route = 'deyunai/doubao-seedance-2-0-260128';
  const supported = capabilities.assessProviderCapabilities({
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    requiresPrivateAsset: true,
    registry: {
      [route]: {
        private_asset: {
          state: 'supported',
          source: 'provider_entitlement_read',
          checked_at: '2026-07-22T10:00:00.000Z',
          expires_at: '2026-07-23T10:00:00.000Z',
        },
      },
    },
    now: Date.parse('2026-07-22T11:00:00.000Z'),
  });
  assert.strictEqual(supported.ready, true);
  assert.strictEqual(supported.probe_performed, false);
  assert.strictEqual(supported.create_asset_group_probe_allowed, false);

  const unknown = capabilities.assessProviderCapabilities({
    providerId: 'deyunai', modelId: 'doubao-seedance-2-0-260128', requiresPrivateAsset: true,
  });
  assert.strictEqual(unknown.ready, false);
  assert.strictEqual(unknown.blockers[0].code, 'VIDEO_PROVIDER_PRIVATE_ASSET_UNKNOWN');
  assert.strictEqual(unknown.blockers[0].provider_submitted, false);
  assert.strictEqual(unknown.blockers[0].billing_state, 'not_submitted');

  const unsupported = capabilities.assessProviderCapabilities({
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    requiresPrivateAsset: true,
    registry: { [route]: { private_asset: { state: 'unsupported', source: 'subscription_entitlement' } } },
  });
  assert.strictEqual(unsupported.ready, false);
  assert.strictEqual(unsupported.blockers[0].code, 'VIDEO_PROVIDER_PRIVATE_ASSET_UNSUPPORTED');
  assert.throws(() => capabilities.assertProviderCapabilities({
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    requiresPrivateAsset: true,
    registry: { [route]: { private_asset: 'unsupported' } },
  }), error => error?.code === 'VIDEO_PROVIDER_PRIVATE_ASSET_UNSUPPORTED'
    && error?.providerSubmitted === false
    && error?.billingState === 'not_submitted');

  const expired = capabilities.assessProviderCapabilities({
    providerId: 'deyunai',
    modelId: 'doubao-seedance-2-0-260128',
    requiresPrivateAsset: true,
    registry: {
      [route]: { private_asset: { state: 'supported', expires_at: '2026-07-22T10:59:59.000Z' } },
    },
    now: Date.parse('2026-07-22T11:00:00.000Z'),
  });
  assert.strictEqual(expired.ready, false);
  assert.strictEqual(expired.capabilities[0].state, 'unknown');
  assert.strictEqual(capabilities.CREATE_ASSET_GROUP_PROBE_ALLOWED, false);
}

function testPrivacyFailureBlocksOnlySameDirectFirstFrameInput() {
  const plan = {
    blockers: [], status: 'ready', zero_cost_action_count: 0,
    units: [{ paid: true, member_indexes: [1], input_strategy: 'approved_keyframe_first_frame_only' }],
  };
  privacyRetryPolicy.applyPrivacyRetryBlockers({
    plan,
    statuses: [{}, { error_code: 'INPUT_PERSON_PRIVACY', input_mode: 'approved_keyframe_first_frame_only', lineage_fingerprint: 'lineage-shot-2' }],
    expectedLineages: [{}, { fingerprint: 'lineage-shot-2' }],
  });
  assert.strictEqual(plan.status, 'blocked');
  assert.strictEqual(plan.blockers[0].code, 'VIDEO_PRIVACY_INPUT_REQUIRES_CHANGE');
  assert.match(plan.blockers[0].message, /本任务其他镜头也可以有人物/);
  assert.match(plan.blockers[0].message, /本次视频费用为 ¥0/);

  const changedInputPlan = {
    blockers: [], status: 'ready', zero_cost_action_count: 0,
    units: [{ paid: true, member_indexes: [1], input_strategy: 'approved_keyframe_first_frame_only' }],
  };
  privacyRetryPolicy.applyPrivacyRetryBlockers({
    plan: changedInputPlan,
    statuses: [{}, { error_code: 'INPUT_PERSON_PRIVACY', input_mode: 'approved_keyframe_first_frame_only', lineage_fingerprint: 'lineage-old' }],
    expectedLineages: [{}, { fingerprint: 'lineage-new' }],
  });
  assert.deepStrictEqual(changedInputPlan.blockers, [], 'a changed keyframe/model lineage may be preflighted again');
}

testAttemptClaimAndAppendOnlyEvents();
testCurrentAndLastProjection();
testCapabilityGateNeverUsesMutationAsProbe();
testPrivacyFailureBlocksOnlySameDirectFirstFrameInput();
console.log('new story ad video attempt and provider capability tests: ok');
