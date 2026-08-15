const assert = require('assert');

const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const checkpointService = require('../src/services/newStoryAd/assetGenerationCheckpointService');

async function trackerEvidence(sequence) {
  const tracker = mediaAdapter.createImageSubmissionTracker();
  await sequence(tracker);
  return tracker;
}

(async () => {
  const rejected = await trackerEvidence(async tracker => {
    await tracker.onSubmitting({});
    await tracker.onSubmitted({ status: 'rejected', providerRequestId: 'http-400' });
  });
  assert.deepStrictEqual(rejected.failure(new Error('HTTP 400')), {
    provider_submission_state: 'submission_rejected',
    billing_state: 'not_billed',
    provider_request_id: 'http-400',
    provider_task_id: '',
  }, 'HTTP 400/rejected is terminal not_billed and must not be overwritten by a later generic catch');

  const explicitNotBilled = await trackerEvidence(async tracker => {
    await tracker.onSubmitting({});
    await tracker.onSubmitted({ status: 'rejected', providerRequestId: 'provider-rejected' });
  });
  const downstreamUnknown = Object.assign(new Error('downstream wrapper'), { billingState: 'unknown' });
  assert.equal(explicitNotBilled.failure(downstreamUnknown).billing_state, 'not_billed',
    'an explicit provider rejection/not_billed observation outranks a later wrapper-level unknown');

  const serverFailure = await trackerEvidence(async tracker => {
    await tracker.onSubmitting({});
    await tracker.onSubmitted({ status: 'submitted', providerRequestId: 'http-500' });
  });
  assert.equal(serverFailure.failure(Object.assign(new Error('HTTP 500'), { billingState: 'unknown' })).billing_state, 'unknown');
  assert.equal(serverFailure.failure(Object.assign(new Error('HTTP 500'), { billingState: 'unknown' })).provider_submission_state, 'submitted');

  const disconnected = await trackerEvidence(async tracker => tracker.onSubmitting({}));
  const disconnectedFailure = disconnected.failure(new Error('socket disconnected'));
  assert.equal(disconnectedFailure.billing_state, 'unknown');
  assert.equal(disconnectedFailure.provider_submission_state, 'submitted_unknown');

  let stored = null;
  await assert.rejects(() => checkpointService.runCheckpointedUnit({
    identity: { key: 'http-400', taskId: 'v75', assetType: 'person', assetId: 'p1', unit: 'hair', revision: 1 },
    load: async () => stored,
    save: async (_key, value) => { stored = JSON.parse(JSON.stringify(value)); },
    execute: async controls => {
      await controls.onSubmitting();
      await controls.onSubmitted({ status: 'rejected', billing_state: 'not_billed', providerRequestId: 'http-400' });
      throw new Error('HTTP 400');
    },
  }), /HTTP 400/);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.billing_state, 'not_billed');
  assert.equal(stored.provider_submission_state, 'not_submitted');

  console.log(JSON.stringify({ passed: true, http_400: 'not_billed', http_500: 'unknown', disconnect: 'unknown' }));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
