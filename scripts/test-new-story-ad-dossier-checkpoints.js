const assert = require('assert');
const checkpoints = require('../src/services/newStoryAd/assetGenerationCheckpointService');
const concurrency = require('../src/services/newStoryAd/generationConcurrencyService');

(async () => {
  const store = new Map();
  let calls = 0;
  const options = {
    identity: {
      taskId: 'checkpoint-task',
      assetType: 'person_dossier',
      assetId: 'person-1',
      unit: 'identity',
      revision: 1,
      input: { prompt: 'stable' },
    },
    load: async key => store.get(key) || null,
    save: async (key, value) => store.set(key, JSON.parse(JSON.stringify(value))),
    execute: async () => {
      calls += 1;
      return { image_url: '/identity.png' };
    },
  };
  const first = await checkpoints.runCheckpointedUnit(options);
  const second = await checkpoints.runCheckpointedUnit(options);
  assert.strictEqual(calls, 1);
  assert.strictEqual(first.reused, false);
  assert.strictEqual(second.reused, true);
  assert.strictEqual(second.checkpoint.cache_hits, 1);

  const unsafeStore = new Map();
  const identity = { ...options.identity, unit: 'action' };
  const unsafeKey = checkpoints.checkpointKey(identity);
  unsafeStore.set(unsafeKey, {
    key: unsafeKey,
    status: 'submitted_unknown',
    provider_submission_state: 'submitted_unknown',
    billing_state: 'unknown',
  });
  let unsafeCalls = 0;
  await assert.rejects(() => checkpoints.runCheckpointedUnit({
    identity,
    load: async key => unsafeStore.get(key),
    save: async (key, value) => unsafeStore.set(key, value),
    execute: async () => { unsafeCalls += 1; },
  }), error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN');
  assert.strictEqual(unsafeCalls, 0);

  const postProcessStore = new Map();
  const postProcessIdentity = { ...options.identity, unit: 'post-process-recovery' };
  let paidProviderCalls = 0;
  let failLocalSplit = true;
  const postProcessOptions = {
    identity: postProcessIdentity,
    load: async key => postProcessStore.get(key) || null,
    save: async (key, value) => postProcessStore.set(key, JSON.parse(JSON.stringify(value))),
    execute: async controls => {
      const providerResult = controls.providerResult || { image_url: '/paid-atlas.png', filename: 'paid-atlas.png' };
      if (!controls.providerResult) {
        paidProviderCalls += 1;
        await controls.onProviderResult(providerResult);
      }
      if (failLocalSplit) {
        failLocalSplit = false;
        throw new Error('simulated local split interruption');
      }
      return { atlas: providerResult, views: ['/view-1.png'] };
    },
  };
  await assert.rejects(
    () => checkpoints.runCheckpointedUnit(postProcessOptions),
    error => error.message === 'simulated local split interruption',
  );
  const postProcessKey = checkpoints.checkpointKey(postProcessIdentity);
  assert.strictEqual(postProcessStore.get(postProcessKey).billing_state, 'confirmed');
  assert.strictEqual(postProcessStore.get(postProcessKey).provider_submission_state, 'completed');
  assert.strictEqual(postProcessStore.get(postProcessKey).status, 'failed');
  const recoveredPostProcess = await checkpoints.runCheckpointedUnit(postProcessOptions);
  assert.strictEqual(paidProviderCalls, 1, 'local recovery must reuse the paid provider result');
  assert.strictEqual(recoveredPostProcess.result.views.length, 1);

  concurrency.resetForTests();
  let active = 0;
  let peak = 0;
  const result = await concurrency.map('checkpoint-test-pool', [1, 2, 3, 4, 5], 2, async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active -= 1;
    return value * 2;
  });
  assert.deepStrictEqual(result, [2, 4, 6, 8, 10]);
  assert.strictEqual(peak, 2);
  assert.strictEqual(concurrency.snapshot('checkpoint-test-pool')[0].peak, 2);

  let settlingActive = 0;
  const settledValues = [];
  await assert.rejects(() => concurrency.map('checkpoint-settle-pool', [1, 2, 3], 2, async value => {
    settlingActive += 1;
    try {
      if (value === 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw new Error('first local failure');
      }
      await new Promise(resolve => setTimeout(resolve, 25));
      settledValues.push(value);
      return value;
    } finally {
      settlingActive -= 1;
    }
  }), error => error.message === 'first local failure');
  assert.strictEqual(settlingActive, 0, 'concurrency map must settle active work before rejecting');
  assert.deepStrictEqual(settledValues.sort(), [2, 3]);

  let unknownBillingMapperCalls = 0;
  await assert.rejects(() => concurrency.map('checkpoint-billing-stop-pool', [1, 2, 3], 1, async () => {
    unknownBillingMapperCalls += 1;
    const error = new Error('billing state unknown');
    error.code = 'GENERATION_BILLING_STATE_UNKNOWN';
    throw error;
  }), error => error.code === 'GENERATION_BILLING_STATE_UNKNOWN');
  assert.strictEqual(unknownBillingMapperCalls, 1, 'billing-unknown must stop queued provider work');
  console.log(JSON.stringify({
    passed: true,
    provider_calls: calls,
    checkpoint_hits: 1,
    billing_unknown_resubmissions: unsafeCalls,
    concurrency_peak: peak,
    local_split_recovery_provider_calls: paidProviderCalls,
    settled_after_failure: settlingActive === 0,
    billing_unknown_queued_calls: unknownBillingMapperCalls,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
