#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-delete-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const jobs = require('../src/services/newStoryAd/jobService');
const router = require('../src/routes/newStoryAd');

function waitUntil(predicate, timeoutMs = 5000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('task deletion test timed out'));
      }
    }, 15);
  });
}

function createFixture(taskId, ownerId) {
  const created = service.createTask({
    task_id: taskId,
    brief: '通用剧情广告任务删除测试',
    product_subject: '通用主体',
    cast_mode: 'no_human',
  }, { id: ownerId, role: 'user' });
  storage.saveStage(taskId, 'blueprint', { status: 'done', output_summary: 'fixture' });
  storage.saveOutput(taskId, 'blueprint', { beats: [{ id: 'beat-1' }] });
  storage.saveReview(taskId, 'blueprint', { pass: true });
  storage.saveModelCall({ task_id: taskId, stage: 'fixture', status: 'success' });
  return created.task;
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: req.get('x-test-user') || '',
      role: req.get('x-test-role') || 'user',
    };
    next();
  });
  app.use('/api/new-story-ad', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const taskId = 'delete-owned-task';
    createFixture(taskId, 'owner-a');

    const forbidden = await fetch(`${baseUrl}/api/new-story-ad/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner-b' },
    });
    assert.equal(forbidden.status, 403);
    assert(storage.getTask(taskId), 'unauthorized deletion must keep the task');

    const deleted = await fetch(`${baseUrl}/api/new-story-ad/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner-a' },
    });
    const deletedBody = await deleted.json();
    assert.equal(deleted.status, 200);
    assert.equal(deletedBody.success, true);
    assert.equal(deletedBody.deleted, true);
    assert.equal(storage.getTask(taskId), null);
    for (const key of ['stages', 'outputs', 'model_calls', 'reviews']) {
      assert.equal(storage.readDb()[key].some(row => String(row.task_id) === taskId), false, `${key} must be deleted`);
    }

    const missing = await fetch(`${baseUrl}/api/new-story-ad/tasks/${taskId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner-a' },
    });
    assert.equal(missing.status, 404);

    const runningTaskId = 'delete-running-task';
    createFixture(runningTaskId, 'owner-a');
    let release;
    const queued = jobs.queueStage({
      taskId: runningTaskId,
      stage: 'blueprint',
      execute: async () => {
        await new Promise(resolve => { release = resolve; });
        storage.saveOutput(runningTaskId, 'late_output', { should_not_exist: true });
      },
    });
    assert.equal(queued.accepted, true);
    await waitUntil(() => jobs.getJob(runningTaskId)?.status === 'running' && typeof release === 'function');

    const runningDeleted = await fetch(`${baseUrl}/api/new-story-ad/tasks/${runningTaskId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner-a' },
    });
    const runningBody = await runningDeleted.json();
    assert.equal(runningDeleted.status, 200);
    assert.equal(runningBody.cancelled_running_job, true);
    release();
    await waitUntil(() => jobs.getJob(runningTaskId)?.status === 'cancelled');
    assert.equal(storage.getTask(runningTaskId), null);
    assert.equal(storage.getOutput(runningTaskId, 'late_output'), null);

    console.log('new story ad persistent task deletion: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
