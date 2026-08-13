'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-generation-job-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const units = require('../src/services/newStoryAd/generationUnitService');
const releaseBundle = require('../src/services/storyAdReleaseBundleService');

const waitFor = async (predicate, timeoutMs = 2500) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('timed out waiting for job projection');
};

(async () => {
  try {
    storage.createTask({ id: 'job-success', content_revision: 1, request: { brief: 'job success' } });
    let executions = 0;
    const accepted = jobs.queueStage({
      taskId: 'job-success', stage: 'storyboard', expectedContentRevision: 1,
      inputFingerprint: 'storyboard-input-v1', idempotencyKey: 'job-success:storyboard:r1',
      execute: async () => { executions += 1; },
    });
    assert.strictEqual(accepted.accepted, true);
    assert(accepted.job.generation_unit_id);
    const succeeded = await waitFor(() => storage.getGenerationRun(accepted.job.generation_unit_id)?.state === 'succeeded'
      && storage.getGenerationRun(accepted.job.generation_unit_id));
    assert.strictEqual(succeeded.billing_state, 'not_submitted');
    assert.strictEqual(succeeded.provider_submission_state, 'not_applicable');
    const duplicate = jobs.queueStage({
      taskId: 'job-success', stage: 'storyboard', expectedContentRevision: 1,
      inputFingerprint: 'storyboard-input-v1', idempotencyKey: 'job-success:storyboard:r1',
      execute: async () => { executions += 1; },
    });
    assert.strictEqual(duplicate.accepted, false);
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.job.generation_unit_id, succeeded.id);
    assert.strictEqual(executions, 1, '相同输入不得二次执行后台生成');

    storage.createTask({ id: 'job-unknown', content_revision: 1, request: { brief: 'billing unknown' } });
    const failed = jobs.queueStage({
      taskId: 'job-unknown', stage: 'visual_assets', expectedContentRevision: 1,
      inputFingerprint: 'visual-input-v1', idempotencyKey: 'job-unknown:visual:r1',
      execute: async () => {
        const error = new Error('provider response ambiguous');
        error.code = 'PROVIDER_5XX_AMBIGUOUS';
        error.retryable = false;
        error.billingState = 'unknown';
        error.providerSubmissionState = 'submitted_unknown';
        error.providerTaskId = 'paid-task-unknown';
        throw error;
      },
    });
    const unknown = await waitFor(() => storage.getGenerationRun(failed.job.generation_unit_id)?.state === 'billing_unknown'
      && storage.getGenerationRun(failed.job.generation_unit_id));
    assert.strictEqual(unknown.retry_blocked, true);
    assert.strictEqual(unknown.provider_task_id, 'paid-task-unknown');
    assert.throws(
      () => jobs.queueStage({
        taskId: 'job-unknown', stage: 'visual_assets', expectedContentRevision: 1,
        inputFingerprint: 'visual-input-v2', idempotencyKey: 'job-unknown:visual:r1:retry', execute: async () => {},
      }),
      error => error.code === 'GENERATION_BILLING_REVIEW_REQUIRED',
    );

    storage.createTask({ id: 'job-interrupted', content_revision: 1, request: { brief: 'interrupted' } });
    storage.updateTask('job-interrupted', {
      status: 'running', stage: 'storyboard', active_stage: 'storyboard', active_generation_id: 'old-worker-job',
      generation_started_at: '2020-01-01T00:00:00.000Z',
    });
    const interruptedClaim = units.claim({
      work_id: 'job-interrupted', domain: 'storyboard', target_permanent_id: 'job-interrupted:storyboard',
      operation: 'run_storyboard', input_fingerprint: 'interrupted-input-v1', spec_revision: 1,
      provider_id: 'internal-orchestrator', model_id: releaseBundle.identity().bundle_id,
    });
    const interruptedQueued = units.transition(interruptedClaim.unit.id, 'queued', {
      orchestration_job_id: 'old-worker-job', billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
    }, { expected_version: interruptedClaim.unit.unit_version });
    units.transition(interruptedQueued.id, 'running', {
      billing_state: 'not_submitted', provider_submission_state: 'not_applicable',
    }, { expected_version: interruptedQueued.unit_version });
    const reconciliation = jobs.reconcileInterruptedJobs({ now: Date.now() });
    assert.strictEqual(reconciliation.interrupted >= 1, true);
    assert.strictEqual(storage.getGenerationRun(interruptedQueued.id).state, 'failed_retryable');
    const restartedAfterCrash = jobs.queueStage({
      taskId: 'job-interrupted', stage: 'storyboard', expectedContentRevision: 1,
      inputFingerprint: 'interrupted-input-v1', idempotencyKey: 'job-interrupted:storyboard:r1', execute: async () => {},
    });
    assert.strictEqual(restartedAfterCrash.accepted, true);
    await waitFor(() => storage.getGenerationRun(interruptedQueued.id)?.state === 'succeeded');

    console.log(JSON.stringify({
      passed: true,
      real_queue_integrated: true,
      duplicate_execution_count: executions,
      billing_unknown_blocks_new_queue: true,
      provider_task_evidence_preserved: true,
      worker_restart_recovered: true,
    }));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
