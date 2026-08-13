'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-work-aggregate-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';

const storage = require('../src/services/newStoryAd/storageService');
const works = require('../src/services/newStoryAd/workAggregateService');

try {
  storage.createTask({
    id: 'work-1', brief: '原始需求', user_id: 'user-1', content_revision: 1, lineage_enforced: true,
    request: { brief: '原始需求', brief_source: 'user', target_duration: 30, output_ratio: '9:16' },
  });
  storage.saveOutput('work-1', 'context', { brief: '原始需求', brief_source: 'user', scene_assets: [] });
  const created = works.ensureShadowWork('work-1');
  assert.strictEqual(created.aggregate_version, 1);
  assert.strictEqual(created.authority.brief, 'user');
  assert.strictEqual(storage.listWorkEvents('work-1').length, 1);

  storage.updateTask('work-1', { content_revision: 2, request: { brief: '修改需求', brief_source: 'user' } });
  storage.saveOutput('work-1', 'context', { brief: '修改需求', brief_source: 'user', scene_assets: [] }, { content_revision: 2 });
  const updated = works.syncFromTask('work-1', { domains: ['brief'], commandId: 'brief-save-1', expectedVersion: 1 });
  assert.strictEqual(updated.aggregate_version, 2);
  assert.strictEqual(updated.domain_revisions.brief, created.domain_revisions.brief + 1);
  assert.strictEqual(updated.domain_revisions.scenes, created.domain_revisions.scenes);
  assert(updated.invalidated_domains.includes('compose'));
  assert(!updated.invalidated_domains.includes('brief'));
  assert.strictEqual(works.syncFromTask('work-1', { domains: ['brief'], commandId: 'brief-save-1' }).aggregate_version, 2, '幂等命令不得增加版本');
  assert.throws(
    () => works.syncFromTask('work-1', { domains: ['storyboard'], commandId: 'stale', expectedVersion: 1 }),
    error => error.code === 'WORK_VERSION_CONFLICT',
  );
  assert.deepStrictEqual(works.compareWithTask('work-1').issues, []);
  assert.strictEqual(storage.listWorkEvents('work-1').length, 2);
  storage.updateTask('work-1', { content_revision: 3, request: { brief: '第三版需求', brief_source: 'user' } });
  storage.saveOutput('work-1', 'context', { brief: '第三版需求', brief_source: 'user', scene_assets: [] }, { content_revision: 3 });
  const originalUpdate = storage.updateWork;
  storage.updateWork = () => { throw Object.assign(new Error('shadow unavailable'), { code: 'SHADOW_DOWN' }); };
  const safeFailure = works.syncShadowSafely('work-1', { domains: ['brief'], commandId: 'safe-failure' });
  storage.updateWork = originalUpdate;
  assert.strictEqual(safeFailure.ok, false, '影子同步失败必须显式记录但不得推翻旧权威写入');
  const shadowStage = storage.getTaskBundle('work-1').stages.find(stage => stage.stage === 'work_shadow_sync');
  assert.strictEqual(shadowStage.status, 'failed');
  assert.strictEqual(shadowStage.diagnostics.model_calls_started, 0);
  console.log(JSON.stringify({ passed: true, aggregate_version: updated.aggregate_version, brief_revision: updated.domain_revisions.brief, idempotent: true, stale_write_blocked: true, precise_invalidation: true, shadow_failure_isolated: true }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
