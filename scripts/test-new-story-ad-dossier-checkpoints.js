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
  console.log(JSON.stringify({
    passed: true,
    provider_calls: calls,
    checkpoint_hits: 1,
    billing_unknown_resubmissions: unsafeCalls,
    concurrency_peak: peak,
  }));
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
