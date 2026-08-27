#!/usr/bin/env node
'use strict';

const assert = require('assert');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const sceneCheckpoints = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const sceneProjection = require('../src/services/newStoryAd/sceneCheckpointProjectionService');
const storage = require('../src/services/newStoryAd/storageService');

const route = { provider_id: 'smscrw', model_id: 'gpt-image-2', enabled: true };
const provider = enabled => ({
  id: 'smscrw', enabled, api_key: 'test-only-not-a-real-key',
  models: [{ id: 'gpt-image-2', enabled: true, use: 'image' }],
});
assert.strictEqual(modelGateway.isConfiguredAndUsable(route, 'image', { providers: [provider(false)] }).reason, 'provider_disabled_or_missing_key');
assert.strictEqual(modelGateway.isConfiguredAndUsable(route, 'image', { providers: [{ ...provider(true), api_key: '' }] }).reason, 'provider_disabled_or_missing_key');
assert.strictEqual(modelGateway.isConfiguredAndUsable(route, 'image', { providers: [provider(true)] }).ok, true);

const ambiguous504 = {
  status: 'failed', error_code: 'PROVIDER_5XX_AMBIGUOUS', billing_state: 'unknown',
  provider_submission_state: 'submitted_unknown', provider_request_id: '', provider_task_id: '', image_url: '',
};
assert.strictEqual(sceneCheckpoints.requiresBillingReview(ambiguous504), true, 'a handleless 504 is still billing-unknown');
assert.strictEqual(sceneCheckpoints.requiresBillingReview({
  status: 'failed', error_code: 'PROVIDER_5XX_NOT_SUBMITTED', billing_state: 'not_billed', provider_submission_state: 'not_submitted',
}), false, 'explicit not-submitted/not-billed evidence remains safely retryable');

const originalGetOutput = storage.getOutput;
const originalSaveOutput = storage.saveOutput;
let saved;
storage.getOutput = () => saved;
storage.saveOutput = (_taskId, _kind, value) => { saved = JSON.parse(JSON.stringify(value)); return value; };
try {
  saved = {
    schema_version: sceneCheckpoints.CHECKPOINT_SCHEMA_VERSION,
    task_id: 'task-1', scene_id: 'scene-1', input_fingerprint: 'fp-1', candidate_revision: 1,
    status: 'partial', updated_at: new Date().toISOString(), view_keys: ['master', 'layout', 'reverse', 'interaction', 'detail'],
    views: {
      master: { key: 'master', status: 'succeeded', image_url: '/master.png', billing_state: 'confirmed' },
      layout: { key: 'layout', status: 'succeeded', image_url: '/layout.png', billing_state: 'confirmed' },
      reverse: { key: 'reverse', status: 'succeeded', image_url: '/reverse.png', billing_state: 'confirmed' },
      interaction: { key: 'interaction', status: 'succeeded', image_url: '/interaction.png', billing_state: 'confirmed' },
      detail: { key: 'detail', ...ambiguous504, submission_id: 'platform-x-request-id' },
    },
  };
  assert.throws(() => sceneCheckpoints.open({
    taskId: 'task-1', sceneId: 'scene-1', fingerprint: 'fp-1', candidateRevision: 1,
    viewKeys: saved.view_keys,
  }), error => error.code === 'SCENE_ASSET_BILLING_UNKNOWN' && error.details.failed_views[0].submission_id === 'platform-x-request-id');

  sceneCheckpoints.authorizeRetry(saved, 'detail', { acceptDuplicateChargeRisk: true, acceptedBy: 'test' });
  const reopened = sceneCheckpoints.open({
    taskId: 'task-1', sceneId: 'scene-1', fingerprint: 'fp-1', candidateRevision: 1,
    viewKeys: saved.view_keys,
  }).checkpoint;
  assert.deepStrictEqual(['master', 'layout', 'reverse', 'interaction'].filter(key => sceneCheckpoints.checkpointView(reopened, key)), ['master', 'layout', 'reverse', 'interaction']);
  assert.strictEqual(sceneCheckpoints.checkpointView(reopened, 'detail'), null, 'recovery must submit only the failed detail view');
} finally {
  storage.getOutput = originalGetOutput;
  storage.saveOutput = originalSaveOutput;
}

const diagnostics = sceneAssets.sceneFailureDiagnostics(Object.assign(new Error('stopped'), {
  code: 'PROVIDER_5XX_AMBIGUOUS', billingState: 'unknown', providerSubmissionState: 'submitted_unknown',
  submissionId: 'platform-x-request-id', attempts: [{ model: 'webang-maas/gpt-image-2', code: 'PROVIDER_5XX_AMBIGUOUS',
    provider_status: '504', billing_state: 'unknown', provider_submission_state: 'submitted_unknown' }],
}));
assert.deepStrictEqual({
  provider_id: diagnostics.provider_id, model_id: diagnostics.model_id, http_status: diagnostics.http_status,
  platform_request_id: diagnostics.platform_request_id, billing_state: diagnostics.billing_state,
  provider_submission_state: diagnostics.provider_submission_state,
}, {
  provider_id: 'webang-maas', model_id: 'gpt-image-2', http_status: '504',
  platform_request_id: 'platform-x-request-id', billing_state: 'unknown', provider_submission_state: 'submitted_unknown',
});
assert.strictEqual(JSON.stringify(diagnostics).includes('test-only-not-a-real-key'), false);

const preview = sceneProjection.checkpointPreview({
  kind: 'scene_asset_checkpoint:scene-1',
  payload: {
    scene_id: 'scene-1', status: 'partial', views: {
      master: { status: 'succeeded', image_url: '/master.png' },
      detail: { ...ambiguous504, provider_id: 'webang-maas', model_id: 'gpt-image-2', provider_status: '504',
        platform_request_id: 'platform-x-request-id', submission_id: 'platform-x-request-id' },
    },
  },
});
assert.strictEqual(preview.billing_review_required, true);
assert.deepStrictEqual({
  provider_id: preview.view_statuses.detail.provider_id,
  model_id: preview.view_statuses.detail.model_id,
  http_status: preview.view_statuses.detail.http_status,
  platform_request_id: preview.view_statuses.detail.platform_request_id,
}, { provider_id: 'webang-maas', model_id: 'gpt-image-2', http_status: '504', platform_request_id: 'platform-x-request-id' });

console.log(JSON.stringify({
  passed: true,
  disabled_or_keyless_image_provider_filtered: true,
  handleless_504_requires_billing_review: true,
  explicit_not_submitted_remains_retryable: true,
  recovery_reuses_four_views_and_only_retries_detail: true,
  safe_diagnostics_projected: true,
}));
