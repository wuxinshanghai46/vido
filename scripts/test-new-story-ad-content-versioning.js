#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-nsa-versioning-'));
process.env.OUTPUT_DIR = tempDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const jobs = require('../src/services/newStoryAd/jobService');

const owner = { id: 'version-owner', role: 'user' };

function waitUntil(predicate, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error('versioning test timeout'));
      }
    }, 15);
  });
}

async function main() {
  const created = service.createTask({
    brief: '制作一个通用产品广告，突出可靠和易用。',
    product_subject: '通用测试产品',
    cast_mode: 'no_human',
    creative_direction: { raw: '产品从暗处进入亮处，最后出现品牌收束。' },
    client_edit_seq: 1,
  }, owner);
  const taskId = created.task.id;
  assert.equal(created.task.content_revision, 1);
  assert.equal(created.task.lineage_enforced, true);
  assert.equal(created.acknowledged_client_edit_seq, 1);
  assert.equal(storage.getOutput(taskId, 'context').creative_direction.raw, '产品从暗处进入亮处，最后出现品牌收束。');

  storage.saveOutput(taskId, 'scene_assets', [{ id: 'old-scene', scene_id: 'old-scene', image_url: '/old.png' }]);
  storage.saveOutput(taskId, 'blueprint', { beats: [{ beat_index: 1, plot: '旧剧本' }] });
  const updated = service.updateTaskRequest(taskId, {
    brief: '制作一个通用产品广告，突出可靠、易用和安全。',
    base_content_revision: 1,
    client_edit_seq: 2,
    change_scope: 'none',
    save_progress: true,
    progress_snapshot: {
      blueprint: { beats: [{ beat_index: 1, plot: '浏览器试图回传的旧剧本' }] },
      scene_assets: [{ id: 'old-scene', image_url: '/old.png' }],
    },
  }, owner);
  assert.equal(updated.content_revision, 2);
  assert(updated.changed_domains.includes('source'), '服务端必须根据实际差异识别 source，不能相信显式 none');
  assert(updated.invalidated_outputs.includes('scene_assets'), '需求变化必须让旧场景资产失效');
  assert.equal(storage.getOutput(taskId, 'scene_assets'), null);
  assert.equal(storage.getOutput(taskId, 'blueprint'), null, '浏览器 progress_snapshot 不能把旧剧本写回');
  assert.equal(storage.getOutput(taskId, 'context').brief, '制作一个通用产品广告，突出可靠、易用和安全。');

  assert.throws(
    () => service.updateTaskRequest(taskId, {
      brief: '旧窗口覆盖',
      base_content_revision: 1,
      client_edit_seq: 3,
    }, owner),
    error => error?.code === 'CONTENT_REVISION_CONFLICT',
  );

  const prepared = service.prepareGeneration(taskId, {
    expected_content_revision: 2,
    client_edit_seq: 2,
    target_stage: 'blueprint',
  }, owner);
  assert.equal(prepared.content_revision, 2);
  assert.equal(prepared.preflight.ready, true);
  assert(storage.getSnapshot(prepared.snapshot_id));

  const queued = jobs.queueStage({
    taskId,
    stage: 'blueprint',
    expectedContentRevision: prepared.content_revision,
    snapshotId: prepared.snapshot_id,
    inputFingerprint: prepared.input_fingerprint,
    execute: async () => {
      storage.saveOutput(taskId, 'blueprint', { beats: [{ beat_index: 1, plot: '当前版本剧本' }] });
    },
  });
  assert.equal(queued.accepted, true);
  await waitUntil(() => !storage.getTask(taskId).active_generation_id);
  assert.equal(storage.getOutput(taskId, 'blueprint').beats[0].plot, '当前版本剧本');
  const manifest = storage.getManifest(taskId);
  const blueprintArtifact = storage.getArtifact(manifest.artifacts.blueprint);
  assert.equal(blueprintArtifact.source_content_revision, 2);
  assert.equal(blueprintArtifact.snapshot_id, prepared.snapshot_id);

  const changedAgain = service.updateTaskRequest(taskId, {
    creative_direction: { raw: '改为冷静克制的节奏，以产品特写结尾。' },
    base_content_revision: 2,
    client_edit_seq: 3,
    changed_domains: ['creative'],
    save_progress: true,
  }, owner);
  assert.equal(changedAgain.content_revision, 3);
  assert(changedAgain.changed_domains.includes('creative'));
  assert.equal(storage.getOutput(taskId, 'blueprint'), null);
  assert.throws(
    () => jobs.queueStage({
      taskId,
      stage: 'blueprint',
      expectedContentRevision: 2,
      snapshotId: prepared.snapshot_id,
      execute: async () => {},
    }),
    error => error?.code === 'STALE_GENERATION_REVISION',
  );

  const conflictTask = service.createTask({
    brief: '制作一个完全无人出镜的纯产品广告。',
    product_subject: '测试产品',
    cast_mode: 'no_human',
    creative_direction: { raw: '一位女主角面对镜头说出台词。' },
  }, owner);
  assert.throws(
    () => service.prepareGeneration(conflictTask.task.id, {
      expected_content_revision: 1,
      target_stage: 'blueprint',
    }, owner),
    error => error?.code === 'INPUT_CONSTRAINT_CONFLICT',
  );

  let recoveryAttempts = 0;
  const recovered = await service.runTextStageWithRecovery(taskId, 'blueprint', async attempt => {
    recoveryAttempts += 1;
    if (attempt === 1) {
      const error = new Error('structured text quality gate failed');
      error.code = 'BLUEPRINT_POLISH_QUALITY_FAILED';
      throw error;
    }
    return { ok: true, attempt };
  });
  assert.deepEqual(recovered, { ok: true, attempt: 2 });
  assert.equal(recoveryAttempts, 2, '可恢复文本质量问题必须由系统内部完成有界重试');

  console.log('new story ad content versioning: ok');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
