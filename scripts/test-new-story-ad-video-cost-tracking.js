const assert = require('assert');
const db = require('../src/models/database');
const tokenTracker = require('../src/services/tokenTracker');
const deyunai = require('../src/services/deyunaiService');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

function run() {
  const originalInsert = db.insertTokenUsage;
  let captured = null;
  db.insertTokenUsage = row => { captured = row; };
  try {
    const submittedFailure = tokenTracker.record({
      provider: 'deyunai',
      model: 'doubao-seedance-2-0-260128',
      category: 'video',
      videoSeconds: 5,
      status: 'fail',
      requestId: 'provider-task-1',
      billingState: 'unknown',
      errorMsg: 'simulated terminal provider failure',
    });
    assert.strictEqual(submittedFailure.video_seconds, 5);
    assert.strictEqual(submittedFailure.cost_usd, 0.5);
    assert.strictEqual(submittedFailure.usage_source, 'estimated_on_failure');
    assert.strictEqual(submittedFailure.billing_state, 'unknown');
    assert.strictEqual(captured.id, submittedFailure.id);

    const preflightFailure = tokenTracker.record({
      provider: 'deyunai', model: 'doubao-seedance-2-0-260128', category: 'video',
      videoSeconds: 5, status: 'fail', billingState: 'not_submitted', errorMsg: 'invalid input',
    });
    assert.strictEqual(preflightFailure.video_seconds, 0);
    assert.strictEqual(preflightFailure.cost_usd, 0);

    const providerError = deyunai.attachSubmittedVideoTask(new Error('quota failed after submit'), 'provider-task-2', 10);
    assert.strictEqual(providerError.providerTaskId, 'provider-task-2');
    assert.strictEqual(providerError.requestedVideoSeconds, 10);
    assert.strictEqual(providerError.billingState, 'unknown');
    assert.ok(deyunai.estimateTextTokens('视频审片质量检查') >= 8, 'missing provider usage should still produce a conservative QA token estimate');
    assert.deepStrictEqual(videoAdapter.successfulProviderAccounting('provider-success-1', 10), {
      provider_task_id: 'provider-success-1', provider_submission_state: 'completed', billing_state: 'confirmed', requested_video_seconds: 10,
    }, 'a provider output file must persist confirmed billing instead of remaining unknown');
    assert.deepStrictEqual(videoAdapter.successfulProviderAccounting('', 10), {
      provider_task_id: '', provider_submission_state: 'not_submitted', billing_state: 'not_submitted', requested_video_seconds: 0,
    });
  } finally {
    db.insertTokenUsage = originalInsert;
  }
  console.log('new story ad video cost tracking: ok');
}

run();
