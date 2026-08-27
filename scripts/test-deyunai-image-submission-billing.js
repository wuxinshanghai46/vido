const assert = require('assert');
const deyunai = require('../src/services/deyunaiService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');

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

assert.strictEqual(mediaAdapter.shouldStopImageFallback({
  billingUnknown: false,
  classified: { code: 'PROVIDER_CONTENT_AUDIT', terminal: true },
}), false, '明确未计费的内容审核拒绝应继续下一条已配置图片路由');
assert.strictEqual(mediaAdapter.shouldStopImageFallback({
  billingUnknown: true,
  classified: { code: 'PROVIDER_CONTENT_AUDIT', terminal: true },
}), true, '计费未知时必须停止所有备用路由');
assert.strictEqual(mediaAdapter.shouldStopImageFallback({
  billingUnknown: true,
  classified: { code: 'PROVIDER_5XX_AMBIGUOUS', terminal: true },
  providerTaskId: '',
  providerRequestId: '',
}), false, '同步 500 且没有任何厂商任务/请求句柄时应结束该候选并切换独立备用路由');
const normalizedSynchronous500 = mediaAdapter.normalizeHandlelessSynchronous5xx({
  classified: { code: 'PROVIDER_5XX_AMBIGUOUS', retryable: false, terminal: true },
  providerTaskId: '', providerRequestId: '', submission: 'submitted_unknown', billing: 'unknown',
});
assert.strictEqual(normalizedSynchronous500.normalized, true);
assert.strictEqual(normalizedSynchronous500.classified.code, 'PROVIDER_5XX_NOT_SUBMITTED');
assert.strictEqual(normalizedSynchronous500.classified.retryable, true);
assert.strictEqual(normalizedSynchronous500.submission, 'submission_rejected');
assert.strictEqual(normalizedSynchronous500.billing, 'not_billed');
const retainedAsUnknown = mediaAdapter.normalizeHandlelessSynchronous5xx({
  classified: { code: 'PROVIDER_5XX_AMBIGUOUS', retryable: false, terminal: true },
  providerTaskId: 'provider-task-1', providerRequestId: '', submission: 'submitted_unknown', billing: 'unknown',
});
assert.strictEqual(retainedAsUnknown.normalized, false);
assert.strictEqual(retainedAsUnknown.billing, 'unknown');
assert.strictEqual(mediaAdapter.shouldStopImageFallback({
  billingUnknown: true,
  classified: { code: 'PROVIDER_5XX_AMBIGUOUS', terminal: true },
  providerTaskId: 'provider-task-1',
}), true, '已有厂商任务号的 500 仍必须等待核账，不能自动切换');
assert.strictEqual(mediaAdapter.shouldStopImageFallback({
  billingUnknown: false,
  classified: { code: 'PROVIDER_RIGHTS_AUDIT', terminal: true },
}), true, '版权审核拒绝不得切换供应商绕过');

console.log('deyunai image submission billing: ok');
