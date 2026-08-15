const assert = require('assert');

const readiness = require('../src/services/newStoryAd/visualAssetUrlReadinessService');

(async () => {
  const calls = [];
  const ready = await readiness.probe('https://provider.test/asset.png', {
    timeoutMs: 321,
    client: { get: async (url, options) => {
      calls.push({ url, options });
      return { status: 200, data: Buffer.from('image') };
    } },
  });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.status, 200);
  assert.equal(calls[0].options.timeout, 321, 'the bounded readiness timeout must be passed to the HTTP client');

  const missing = await readiness.probe('https://provider.test/missing.png', {
    client: { get: async () => { const error = new Error('404'); error.response = { status: 404 }; throw error; } },
  });
  assert.equal(missing.state, 'missing');
  const missingError = readiness.readinessError(missing);
  assert.equal(missingError.billingState, 'not_billed');
  assert.equal(missingError.providerSubmissionState, 'submission_rejected');

  const slow = await readiness.probe('https://provider.test/slow.png', {
    timeoutMs: 100,
    client: { get: async () => { const error = new Error('timeout'); error.code = 'ECONNABORTED'; throw error; } },
  });
  assert.equal(slow.state, 'unknown');
  const slowError = readiness.readinessError(slow);
  assert.equal(slowError.billingState, 'unknown');
  assert.equal(slowError.providerSubmissionState, 'submitted_unknown');

  console.log(JSON.stringify({ passed: true, http_200: 'ready', http_404: 'missing/not_billed', slow: 'unknown' }));
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
