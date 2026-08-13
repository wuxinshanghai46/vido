#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-authoritative-create-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const service = require('../src/services/newStoryAd/storyAdService');
const storage = require('../src/services/newStoryAd/storageService');

try {
  const created = service.createTask({
    task_id: 'authoritative-create-task',
    brief: '雨夜车站的重逢剧情',
    content_form: 'narrative_live_action',
    target_duration: 30,
    output_ratio: '16:9',
  }, { id: 'owner-1' });
  assert.strictEqual(created.task.id, 'authoritative-create-task');
  assert.strictEqual(created.task.lineage_enforced, true);
  const work = storage.getWork(created.task.id);
  assert(work, '新任务必须同步创建 Work');
  assert.strictEqual(work.mode, 'authoritative', '新任务必须直接使用权威 Work，不得停留在影子双轨');
  assert.strictEqual(work.domain_payloads.brief.brief, '雨夜车站的重逢剧情');
  assert.strictEqual(storage.getOutput(created.task.id, 'context').brief, '雨夜车站的重逢剧情');
  assert.strictEqual(
    storage.readDb().outputs.some(row => row.id === `${created.task.id}:context`),
    false,
    'Work 接管后不得保留 context 旧核心输出行',
  );

  const beforeCandidate = storage.getWork(created.task.id);
  const originalWriteFileSync = fs.writeFileSync;
  let physicalDbWrites = 0;
  fs.writeFileSync = function measuredWrite(filePath, ...args) {
    if (String(filePath).startsWith(`${storage.DB_PATH}.`) && String(filePath).endsWith('.tmp')) physicalDbWrites += 1;
    return originalWriteFileSync.call(fs, filePath, ...args);
  };
  try {
    storage.saveOutput(created.task.id, 'asset_plan_candidate', { status: 'candidate', candidate_id: 'candidate-1' });
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }
  assert.strictEqual(physicalDbWrites, 1, '一个权威输出命令在 JSON 模式下必须合并为一次原子整库写入');
  const afterCandidate = storage.getWork(created.task.id);
  assert.deepStrictEqual(storage.getOutput(created.task.id, 'asset_plan_candidate'), { status: 'candidate', candidate_id: 'candidate-1' });
  assert.deepStrictEqual(afterCandidate.invalidated_domains, beforeCandidate.invalidated_domains, '候选方案不得失效已发布生产链');
  const candidateEvent = storage.listWorkEvents(created.task.id).at(-1);
  assert.deepStrictEqual(candidateEvent.invalidated_domains, [], '候选方案事件不得冒充本次失效了生产域');
  storage.saveOutput(created.task.id, 'asset_plan_active', { plan_id: 'candidate-1', plan: { status: 'active' } });
  assert.strictEqual(storage.getOutput(created.task.id, 'asset_plan_active').plan.status, 'active');

  storage.saveOutput(created.task.id, 'keyframe_contracts', [{ shot_index: 1, contract_fingerprint: 'contract-1' }]);
  storage.saveOutput(created.task.id, 'keyframes', [{ shot_index: 1, image_url: '/frame-1.png' }]);
  storage.saveOutput(created.task.id, 'keyframe_provider_audit', { entries: [{ shot_index: 1, ok: true }] });
  storage.saveOutput(created.task.id, 'quality_review', { passed: true });
  assert.strictEqual(storage.getOutput(created.task.id, 'keyframes')[0].image_url, '/frame-1.png');
  assert.strictEqual(storage.getOutput(created.task.id, 'keyframe_contracts')[0].contract_fingerprint, 'contract-1');
  assert.strictEqual(
    storage.readDb().outputs.some(row => [
      'asset_plan_candidate', 'asset_plan_active', 'keyframe_contracts', 'keyframes', 'keyframe_provider_audit', 'quality_review',
    ].includes(row.kind)),
    false,
    'Active Plan 与关键帧核心状态不得回落旧 outputs 双写',
  );
  storage.deleteOutput(created.task.id, 'keyframes');
  assert.strictEqual(storage.getOutput(created.task.id, 'keyframes'), null);
  assert.strictEqual(storage.getOutput(created.task.id, 'keyframe_contracts')[0].contract_fingerprint, 'contract-1', '删除关键帧不得误删同域合同');
  const events = storage.listWorkEvents(created.task.id);
  assert(events.some(event => event.type === 'work.authority_promoted'));

  storage.saveOutput(created.task.id, 'video_clips', [{ id: 'clip-new' }], { content_revision: 1 });
  assert.deepStrictEqual(storage.getOutput(created.task.id, 'video_clips'), [{ id: 'clip-new' }]);
  assert.strictEqual(
    storage.readDb().outputs.some(row => row.id === `${created.task.id}:video_clips`),
    false,
    '权威任务的新视频写入不得回落旧 outputs 双写',
  );

  console.log(JSON.stringify({
    passed: true,
    task_id: created.task.id,
    work_mode: work.mode,
    legacy_context_rows: 0,
    legacy_video_rows: 0,
    authority_event_present: true,
    active_plan_authoritative: true,
    keyframes_authoritative: true,
    physical_db_writes_per_command: physicalDbWrites,
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
