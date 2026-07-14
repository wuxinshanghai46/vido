#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-cancel-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const jobs = require('../src/services/newStoryAd/jobService');
const service = require('../src/services/newStoryAd/storyAdService');
const cancellation = require('../src/services/newStoryAd/cancellationContext');

function waitUntil(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('cancellation test timed out'));
      }
    }, 15);
  });
}

async function main() {
  const created = service.createTask({
    brief: '通用行业的剧情广告取消测试',
    product_subject: '用户指定主体',
    cast_mode: 'no_human',
  }, { id: 'cancel-owner', role: 'user' });
  const taskId = created.task.id;
  let release;
  let writesAttempted = 0;

  const queued = jobs.queueStage({
    taskId,
    stage: 'blueprint',
    execute: async () => {
      await new Promise(resolve => { release = resolve; });
      writesAttempted += 1;
      storage.saveOutput(taskId, 'blueprint', { should_not_exist: true });
    },
  });
  assert.equal(queued.accepted, true);
  await waitUntil(() => jobs.getJob(taskId)?.status === 'running' && typeof release === 'function');

  const cancelled = jobs.cancelJob(taskId, { generationId: queued.job.id, cancelledBy: 'cancel-owner' });
  assert.equal(cancelled.cancelled, true);
  assert.equal(storage.getTask(taskId).status, 'cancelled');
  assert.equal(storage.getTask(taskId).stage, 'blueprint_cancelled');
  assert.equal(storage.getTask(taskId).active_generation_id, '');
  release();
  await waitUntil(() => jobs.getJob(taskId)?.status === 'cancelled');
  assert.equal(writesAttempted, 1);
  assert.equal(storage.getOutput(taskId, 'blueprint'), null);

  const secondCancel = jobs.cancelJob(taskId, { generationId: queued.job.id, cancelledBy: 'cancel-owner' });
  assert.equal(secondCancel.already_cancelled, true);

  const restarted = jobs.queueStage({
    taskId,
    stage: 'blueprint',
    execute: async () => {
      storage.saveOutput(taskId, 'blueprint', { version: 2 });
    },
  });
  assert.equal(restarted.accepted, true);
  await waitUntil(() => !storage.getTask(taskId).active_generation_id);
  assert.deepEqual(storage.getOutput(taskId, 'blueprint'), { version: 2 });
  assert.equal(storage.getTask(taskId).status, 'done');

  let releaseAuxiliary;
  const auxiliaryId = 'person-sheet-test-generation';
  const auxiliary = cancellation.run({ generationId: auxiliaryId, stage: 'person_sheet', ownerId: 'cancel-owner' }, async () => {
    await new Promise(resolve => { releaseAuxiliary = resolve; });
    cancellation.throwIfCancelled();
  });
  await waitUntil(() => typeof releaseAuxiliary === 'function');
  assert.equal(cancellation.cancelActive(auxiliaryId, { ownerId: 'other-user' }).forbidden, true);
  assert.equal(cancellation.cancelActive(auxiliaryId, { ownerId: 'cancel-owner' }).cancelled, true);
  releaseAuxiliary();
  await assert.rejects(auxiliary, error => error?.code === 'USER_CANCELLED');

  const deadlineStartedAt = Date.now();
  await assert.rejects(
    cancellation.run({ generationId: 'hard-deadline-test', taskId, stage: 'storyboard', deadlineMs: 40 }, async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
      return 'provider ignored abort';
    }),
    error => error?.code === 'STAGE_DEADLINE_EXCEEDED',
  );
  assert(Date.now() - deadlineStartedAt < 250, 'hard deadline must not wait for an abort-ignoring provider');
  cancellation.forget('hard-deadline-test');
  console.log('new-story-ad cancellation tests passed');
}

main()
  .finally(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
