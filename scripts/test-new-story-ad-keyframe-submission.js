#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-keyframe-submission-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const submissions = require('../src/services/newStoryAd/keyframeSubmissionService');
const deyunai = require('../src/services/deyunaiService');

function testBrowserAndRouteGuardContract() {
  const flow = fs.readFileSync(path.join(__dirname, '../public/js/new-story-ad/generation-flow.js'), 'utf8');
  const workbench = fs.readFileSync(path.join(__dirname, '../public/js/digital-human.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/digital-human.html'), 'utf8');
  assert(flow.includes("payload.code !== 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN'"));
  assert(flow.includes('acknowledge_billing_unknown: true'));
  assert(flow.includes('可能产生重复计费'));
  assert(flow.includes('window.DhDialog.confirm'));
  assert(workbench.includes('window.DhDialog = Object.freeze({ confirm: DhConfirm, alert: DhAlert })'));
  const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const nativeDialogCall = /(^|[^\w$.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/m;
  const browserFiles = [
    path.join(__dirname, '../public/js/digital-human.js'),
    ...fs.readdirSync(path.join(__dirname, '../public/js/new-story-ad'))
      .filter(name => name.endsWith('.js'))
      .map(name => path.join(__dirname, '../public/js/new-story-ad', name)),
  ];
  browserFiles.forEach(file => {
    assert(!nativeDialogCall.test(stripComments(fs.readFileSync(file, 'utf8'))),
      `${path.basename(file)} must not call browser-native alert/confirm/prompt`);
  });
  const routeStart = route.indexOf("router.post('/tasks/:id/keyframes'");
  const guardIndex = route.indexOf('service.keyframeSubmissionPreflight(req.params.id, body, userFromReq(req));', routeStart);
  const queueIndex = route.indexOf('return queueTaskStage(', routeStart);
  assert(routeStart >= 0 && guardIndex > routeStart && queueIndex > guardIndex,
  'billing preflight must run before a background keyframe job is queued');
  assert(html.includes('bootstrap.js?v=20260728-full-pipeline-stop-v54'));
  assert(html.includes('digital-human.js?v=20260728-disable-legacy-entry-v53'));
  const sceneRouteStart = route.indexOf("router.post('/tasks/:id/scene-assets'");
  const sceneRepairRouteStart = route.indexOf("router.post('/tasks/:id/scene-assets/:sceneId/repair'");
  assert(sceneRouteStart >= 0
    && route.indexOf('generation_id: job.generationId', sceneRouteStart) > sceneRouteStart
    && route.indexOf('generationId: job.generationId', sceneRouteStart) > sceneRouteStart,
  '场景生成队列必须把生成编号传入场景服务和模型追踪层');
  assert(sceneRepairRouteStart >= 0
    && route.indexOf('generation_id: job.generationId', sceneRepairRouteStart) > sceneRepairRouteStart
    && route.indexOf('generationId: job.generationId', sceneRepairRouteStart) > sceneRepairRouteStart,
  '场景定向修复队列也必须把生成编号传入模型追踪层');
}

async function testSubmissionLifecycle() {
  const taskId = 'task-submission-lifecycle';
  const first = submissions.begin(taskId, {
    id: 'x'.repeat(500),
    shotIndex: 3,
    generationId: 'g'.repeat(500),
    prompt: 'generic prompt',
    contractFingerprint: 'c'.repeat(500),
  });
  assert(first.id.length <= 100, 'submission id must be bounded');
  assert(first.generation_id.length <= 100, 'generation id must be bounded');
  assert(first.contract_fingerprint.length <= 128, 'contract fingerprint must be bounded');
  assert.throws(
    () => submissions.begin(taskId, { shotIndex: 3, prompt: 'duplicate' }),
    error => error.code === 'KEYFRAME_SUBMISSION_ALREADY_PENDING',
    'an unresolved submission must block a concurrent duplicate',
  );
  assert.throws(
    () => submissions.preflight(taskId, [3], { acknowledgeBillingUnknown: true }),
    error => error.code === 'KEYFRAME_SUBMISSION_ALREADY_PENDING',
    'explicit billing acknowledgement must not abandon an active request',
  );

  submissions.markSubmitting(taskId, first.id);
  const timeout = new Error('timeout of 300000ms exceeded');
  timeout.code = 'DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT';
  timeout.billingState = 'unknown';
  submissions.markFailure(taskId, first.id, timeout);
  assert.throws(
    () => submissions.preflight(taskId, [3], { frames: [] }),
    error => error.code === 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN'
      && error.details?.requires_billing_acknowledgement === true,
  );
  const acknowledged = submissions.preflight(taskId, [3], {
    frames: [],
    acknowledgeBillingUnknown: true,
    acknowledgedBy: 'owner-' + 'z'.repeat(200),
  });
  assert.strictEqual(acknowledged.acknowledged, true);
  const replacement = submissions.begin(taskId, { shotIndex: 3, prompt: 'one explicitly authorized replacement' });
  submissions.markSuccess(taskId, replacement.id, { image_url: '/asset/replacement.png' });
  assert.strictEqual(submissions.preflight(taskId, [3], { frames: [] }).allowed, true);
}

async function testRecoverableCompletedResult() {
  const taskId = 'task-recoverable-result';
  const row = submissions.begin(taskId, { shotIndex: 0, prompt: 'recoverable prompt' });
  submissions.markSubmitting(taskId, row.id);
  submissions.markProgress(taskId, row.id, {
    taskId: 'provider-task-' + 't'.repeat(300),
    providerRequestId: 'provider-request-' + 'r'.repeat(300),
    status: 'completed',
    completedUrls: ['https://example.test/final.png'],
  });
  assert.strictEqual(submissions.preflight(taskId, [0], { frames: [] }).allowed, true,
    'a completed provider result should be recovered instead of requesting billing acknowledgement');
  const claimed = submissions.takeRecoverable(taskId, 0);
  assert.strictEqual(claimed.status, 'recovering');
  assert.strictEqual(claimed.provider_task_id.length <= 160, true);
  assert.throws(
    () => submissions.begin(taskId, { shotIndex: 0, prompt: 'must not submit while recovering' }),
    error => error.code === 'KEYFRAME_SUBMISSION_ALREADY_PENDING',
  );
  submissions.restoreRecoverable(taskId, claimed.id, new Error('temporary download failure'));
  assert.throws(
    () => submissions.preflight(taskId, [0], { frames: [] }),
    error => error.code === 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN',
    'failed recovery must not loop or submit a new paid request automatically',
  );
  submissions.preflight(taskId, [0], { frames: [], acknowledgeBillingUnknown: true, acknowledgedBy: 'owner' });
  const replacement = submissions.begin(taskId, { shotIndex: 0, prompt: 'explicit replacement after recovery failure' });
  submissions.markSuccess(taskId, replacement.id, { image_url: '/asset/recovered.png' });
}

async function testLegacyTimeoutGate() {
  const taskId = 'task-legacy-timeout';
  const frames = [{ error_code: 'TIMEOUT_OR_NETWORK', error: 'timeout of 300000ms exceeded' }];
  assert.throws(
    () => submissions.preflight(taskId, [0], { frames }),
    error => error.code === 'KEYFRAME_SUBMISSION_BILLING_UNKNOWN' && error.details?.blockers?.[0]?.legacy === true,
  );
  submissions.preflight(taskId, [0], { frames, acknowledgeBillingUnknown: true, acknowledgedBy: 'owner' });
  assert.strictEqual(submissions.preflight(taskId, [0], { frames }).allowed, true);
}

async function testIncrementalStreamRecovery() {
  const progress = [];
  const stream = new PassThrough();
  const reading = deyunai.readStreamText(stream, 2000, {
    providerRequestId: 'header-request-id',
    onProgress: event => progress.push(event),
  });
  stream.write('data: {"type":"image_generation.in_progress","task_id":"task-stream"}\n\n');
  stream.write('data: {"type":"image_generation.completed","task_id":"task-stream","data":[{"url":"https://example.test/completed.png"}]}\n\n');
  const text = await reading;
  assert(text.includes('image_generation.completed'));
  assert.deepStrictEqual(deyunai.extractCompletedImageUrlsFromStreamText(text), ['https://example.test/completed.png']);
  await new Promise(resolve => setImmediate(resolve));
  assert(progress.some(event => event.taskId === 'task-stream'
    && event.providerRequestId === 'header-request-id'
    && event.completedUrls?.[0] === 'https://example.test/completed.png'));

  const stalled = new PassThrough();
  const timedOut = deyunai.readStreamText(stalled, 1000, { providerRequestId: 'header-timeout-id' });
  stalled.write('data: {"type":"image_generation.in_progress","task_id":"late-task"}\n\n');
  await assert.rejects(timedOut, error => error.code === 'DEYUNAI_GPT_IMAGE2_STREAM_TIMEOUT'
    && error.providerTaskId === 'late-task'
    && error.providerRequestId === 'header-timeout-id'
    && error.billingState === 'unknown');
  stalled.destroy();
}

async function main() {
  try {
    testBrowserAndRouteGuardContract();
    await testSubmissionLifecycle();
    await testRecoverableCompletedResult();
    await testLegacyTimeoutGate();
    await testIncrementalStreamRecovery();
    console.log('new story ad keyframe submission tests passed');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
