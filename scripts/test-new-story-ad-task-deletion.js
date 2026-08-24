#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const http = require('http');
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

function requestDelete(baseUrl, taskId, userId) {
  const target = new URL(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}`, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(target, {
      method: 'DELETE',
      headers: { 'x-test-user': userId },
    }, response => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { raw += chunk; });
      response.on('end', () => {
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (error) { return reject(error); }
        resolve({ status: response.statusCode, body });
      });
    });
    request.on('error', reject);
    request.end();
  });
}

function createFixture(taskId, ownerId, brief = '通用剧情广告任务删除测试') {
  const created = service.createTask({
    task_id: taskId,
    brief,
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
    const ownedFile = path.join(tempDir, 'new-story-ad-assets', 'owned-delete.png');
    const sharedFile = path.join(tempDir, 'new-story-ad-assets', 'shared-keep.png');
    const outsideFile = path.join(os.tmpdir(), `vido-delete-outside-${process.pid}.png`);
    fs.mkdirSync(path.dirname(ownedFile), { recursive: true });
    fs.writeFileSync(ownedFile, 'owned');
    fs.writeFileSync(sharedFile, 'shared');
    fs.writeFileSync(outsideFile, 'outside');
    storage.saveOutput(taskId, 'deletion_files', { owned: { file_path: ownedFile }, shared: { file_path: sharedFile, role: 'person_reference', source_library_asset_id: 'library-person-1' }, outside: { file_path: outsideFile } });
    createFixture('delete-shared-owner', 'owner-a', '共享文件保留测试');
    storage.saveOutput('delete-shared-owner', 'shared_file', { file_path: sharedFile, role: 'person_reference', source_library_asset_id: 'library-person-1' });

    assert.equal(service.listTaskSummaries({ userId: 'owner-a' }).tasks.some(task => task.id === taskId), true);
    assert.equal(service.listTaskSummaries({ userId: 'owner-b' }).tasks.some(task => task.id === taskId), false);
    service.updateTaskRequest(taskId, { brief: '通用剧情广告任务删除测试（已保存）' }, { id: 'owner-b', role: 'user' });
    assert.equal(storage.getTask(taskId).user_id, 'owner-a', 'progress saves must not transfer task ownership');
    assert.equal(storage.getOutput(taskId, 'context').user_id, 'owner-a', 'saved context must keep the original owner');

    const forbidden = await requestDelete(baseUrl, taskId, 'owner-b');
    assert.equal(forbidden.status, 403);
    assert(storage.getTask(taskId), 'unauthorized deletion must keep the task');

    const deletionStartedAt = Date.now();
    const deleted = await requestDelete(baseUrl, taskId, 'owner-a');
    const deletionResponseMs = Date.now() - deletionStartedAt;
    const deletedBody = deleted.body;
    assert.equal(deleted.status, 200);
    assert.equal(deletedBody.success, true);
    assert.equal(deletedBody.deleted, true);
    assert.equal(deletedBody.cleanup.cleanup_pending, true);
    assert(deletionResponseMs < 3000, `logical deletion must respond before deferred file cleanup, got ${deletionResponseMs}ms`);
    await waitUntil(() => !fs.existsSync(ownedFile));
    assert.equal(fs.existsSync(ownedFile), false, 'task-owned output file must be removed');
    assert.equal(fs.existsSync(sharedFile), true, 'file referenced by another task must be preserved');
    assert.equal(fs.existsSync(outsideFile), true, 'file outside OUTPUT_DIR must never be removed');
    assert.equal(storage.getTask(taskId), null);
    for (const key of ['stages', 'outputs', 'model_calls', 'reviews']) {
      assert.equal(storage.readDb()[key].some(row => String(row.task_id) === taskId), false, `${key} must be deleted`);
    }

    const missing = await requestDelete(baseUrl, taskId, 'owner-a');
    assert.equal(missing.status, 404);

    const ownerlessTaskId = 'ownerless-legacy-task';
    createFixture(ownerlessTaskId, '');
    assert.equal(service.listTaskSummaries({ userId: 'owner-a' }).tasks.some(task => task.id === ownerlessTaskId), false);
    const ownerlessForbidden = await requestDelete(baseUrl, ownerlessTaskId, 'owner-a');
    assert.equal(ownerlessForbidden.status, 403, 'ownerless legacy tasks must not leak into ordinary user accounts');
    storage.deleteTask(ownerlessTaskId);

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

    const runningDeleted = await requestDelete(baseUrl, runningTaskId, 'owner-a');
    const runningBody = runningDeleted.body;
    assert.equal(runningDeleted.status, 200);
    assert.equal(runningBody.cancelled_running_job, true);
    release();
    await waitUntil(() => jobs.getJob(runningTaskId)?.status === 'cancelled');
    assert.equal(storage.getTask(runningTaskId), null);
    assert.equal(storage.getOutput(runningTaskId, 'late_output'), null);

    storage.deleteTask('delete-shared-owner');
    fs.rmSync(outsideFile, { force: true });

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
