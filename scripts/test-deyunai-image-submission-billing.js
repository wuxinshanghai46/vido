const assert = require('assert');
const deyunai = require('../src/services/deyunaiService');

const rejected = deyunai.classifyImageSubmissionFailure({
  submissionStarted: true,
  taskId: '',
  status: 400,
  error: new Error('AuditSubmitIllegal'),
});
assert.deepStrictEqual(rejected, {
  ambiguous: false,
  providerSubmissionState: 'rejected',
  billingState: 'not_billed',
});

const rejectedBusinessPayload = deyunai.classifyImageSubmissionFailure({
  submissionStarted: true,
  taskId: '',
  error: Object.assign(new Error('AuditSubmitIllegal'), {
    providerPayload: { code: 400, reason: 'AuditSubmitIllegal' },
  }),
});
assert.strictEqual(rejectedBusinessPayload.ambiguous, false);
assert.strictEqual(rejectedBusinessPayload.billingState, 'not_billed');

const timedOut = deyunai.classifyImageSubmissionFailure({
  submissionStarted: true,
  taskId: '',
  error: Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' }),
});
assert.strictEqual(timedOut.ambiguous, true);
assert.strictEqual(timedOut.billingState, 'unknown');

const acceptedThenFailed = deyunai.classifyImageSubmissionFailure({
  submissionStarted: true,
  taskId: 'provider-task-1',
  status: 400,
});
assert.strictEqual(acceptedThenFailed.ambiguous, true);
assert.strictEqual(acceptedThenFailed.providerSubmissionState, 'submitted_unknown');

console.log('deyunai image submission billing: ok');
