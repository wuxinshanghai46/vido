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
  }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
