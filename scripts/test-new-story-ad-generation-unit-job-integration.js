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
const storyAd = require('../src/services/newStoryAd/storyAdService');

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
      execute: async job => {
        executions += 1;
        storage.updateTask('job-success', {
          generation_progress: {
            schema_version: 1,
            stage: 'storyboard',
            generation_id: job.generationId,
            status: 'running',
            phase: 'finishing',
            total: 1,
            completed: 1,
            percent: 99,
          },
        });
      },
    });
    assert.strictEqual(accepted.accepted, true);
    assert(accepted.job.generation_unit_id);
    const succeeded = await waitFor(() => storage.getGenerationRun(accepted.job.generation_unit_id)?.state === 'succeeded'
      && storage.getGenerationRun(accepted.job.generation_unit_id));
    assert.strictEqual(succeeded.billing_state, 'not_submitted');
    assert.strictEqual(succeeded.provider_submission_state, 'not_applicable');
    const succeededTask = storage.getTask('job-success');
    assert.strictEqual(succeededTask.generation_progress.status, 'done', '后台成功必须把持久化进度收口为终态');
    assert.strictEqual(succeededTask.generation_progress.percent, 100, '后台成功不得把页面遗留在 99%');
    assert.strictEqual(succeededTask.generation_progress.phase, 'complete');

    storage.createTask({ id: 'historical-job-success', content_revision: 1, request: { brief: 'historical job success' } });
    storage.updateTask('historical-job-success', {
      status: 'done',
      stage: 'person_plan_done',
      active_stage: '',
      active_generation_id: '',
      generation_finished_at: '2026-08-25T18:00:21.387Z',
      generation_progress: {
        schema_version: 1,
        stage: 'person_plan',
        generation_id: 'historical-person-generation',
        status: 'running',
        phase: 'finishing',
        total: 1,
        completed: 1,
        processed: 1,
        percent: 99,
      },
    });
    const historicalProjection = storyAd.publicTaskBundle('historical-job-success').task.generation_progress;
    assert.strictEqual(historicalProjection.status, 'done', '历史成功任务读取时必须收口终态');
    assert.strictEqual(historicalProjection.percent, 100, '历史成功任务读取时不得继续显示 99%');
    assert.strictEqual(historicalProjection.phase, 'complete');
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
    let explicitRetryExecutions = 0;
    const explicitRetry = jobs.queueStage({
      taskId: 'job-unknown', stage: 'visual_assets', expectedContentRevision: 1,
      inputFingerprint: 'visual-input-v2', idempotencyKey: 'job-unknown:visual:r1:retry',
      execute: async () => { explicitRetryExecutions += 1; },
    });
    assert.strictEqual(explicitRetry.accepted, true, '用户主动重生成必须进入新队列');
    const explicitSucceeded = await waitFor(() => storage.getGenerationRun(explicitRetry.job.generation_unit_id)?.state === 'succeeded'
      && storage.getGenerationRun(explicitRetry.job.generation_unit_id));
    assert.strictEqual(explicitSucceeded.explicit_user_retry_of, unknown.id);
    assert.strictEqual(storage.getGenerationRun(unknown.id).state, 'billing_unknown');
    assert.strictEqual(explicitRetryExecutions, 1);

    storage.createTask({ id: 'scoped-scenes', content_revision: 1, request: { brief: 'parallel scenes' } });
    let releaseA; let releaseB;
    const gateA = new Promise(resolve => { releaseA = resolve; });
    const gateB = new Promise(resolve => { releaseB = resolve; });
    let sceneExecutions = 0;
    const sceneA = jobs.queueStage({
      taskId: 'scoped-scenes', stage: 'scene_asset', scopeId: 'scene-a', expectedContentRevision: 1,
      inputFingerprint: 'scene-a-v1', idempotencyKey: 'scoped-scenes:scene_asset:scene-a:v1',
      execute: async () => { sceneExecutions += 1; await gateA; },
    });
    const sceneB = jobs.queueStage({
      taskId: 'scoped-scenes', stage: 'scene_asset', scopeId: 'scene-b', expectedContentRevision: 1,
      inputFingerprint: 'scene-b-v1', idempotencyKey: 'scoped-scenes:scene_asset:scene-b:v1',
      execute: async () => { sceneExecutions += 1; await gateB; },
    });
    assert.strictEqual(sceneA.accepted, true, '场景 A 运行时必须允许场景 B 独立排队');
    assert.strictEqual(sceneB.accepted, true, '场景 B 必须拥有独立目标锁');
    const duplicateSceneA = jobs.queueStage({
      taskId: 'scoped-scenes', stage: 'scene_asset', scopeId: 'scene-a', expectedContentRevision: 1,
      inputFingerprint: 'scene-a-v1', idempotencyKey: 'scoped-scenes:scene_asset:scene-a:v1', execute: async () => {},
    });
    assert.strictEqual(duplicateSceneA.accepted, false, '同一场景双击必须幂等拒绝');
    await waitFor(() => Object.keys(storage.getTask('scoped-scenes').active_target_generations || {}).length === 2);
    releaseA(); releaseB();
    await waitFor(() => storage.getGenerationRun(sceneA.job.generation_unit_id)?.state === 'succeeded'
      && storage.getGenerationRun(sceneB.job.generation_unit_id)?.state === 'succeeded');
    await waitFor(() => Object.keys(storage.getTask('scoped-scenes').active_target_generations || {}).length === 0);
    assert.strictEqual(sceneExecutions, 2, '两个不同场景必须各执行一次且不重复付费');
    assert.strictEqual(storage.getTask('scoped-scenes').target_generation_results['scene_asset:scene-a'].status, 'succeeded');
    assert.strictEqual(storage.getTask('scoped-scenes').target_generation_results['scene_asset:scene-b'].status, 'succeeded');

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
      automatic_retry_remains_blocked: true,
      explicit_user_regeneration_allowed: true,
      provider_task_evidence_preserved: true,
      worker_restart_recovered: true,
      parallel_scene_targets: 2,
      duplicate_scene_submissions: 0,
    }));
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
