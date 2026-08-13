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
  const updated = storage.getWork('work-1');
  assert.strictEqual(updated.aggregate_version, 2);
  assert.strictEqual(updated.domain_revisions.brief, created.domain_revisions.brief + 1);
  assert.strictEqual(updated.domain_revisions.scenes, created.domain_revisions.scenes);
  assert(updated.invalidated_domains.includes('compose'));
  assert(!updated.invalidated_domains.includes('brief'));
  assert.strictEqual(works.syncFromTask('work-1', { domains: ['brief'], commandId: 'brief-save-1' }).aggregate_version, 2, '已由最早写入同步的数据不得重复增加版本');
  assert.throws(
    () => works.syncFromTask('work-1', { domains: ['storyboard'], commandId: 'stale', expectedVersion: 1 }),
    error => error.code === 'WORK_VERSION_CONFLICT',
  );
  assert.deepStrictEqual(works.compareWithTask('work-1').issues, []);
  assert.strictEqual(storage.listWorkEvents('work-1').length, 2);

  storage.saveOutput('work-1', 'tts_audio', { tracks: [{ id: 'voice-1' }] }, { content_revision: 2 });
  storage.saveOutput('work-1', 'sound_journey', { cues: [{ id: 'rain' }] }, { content_revision: 2 });
  storage.saveOutput('work-1', 'video_clips', [{ id: 'clip-1' }], { content_revision: 2 });
  storage.saveOutput('work-1', 'final_video', { filename: 'final.mp4' }, { content_revision: 2 });
  works.promoteToAuthoritative('work-1');
  storage.pruneLegacyOutputRows('work-1', Object.keys(works.OUTPUT_DOMAIN_MAP));
  assert.deepStrictEqual(storage.getOutput('work-1', 'video_clips'), [{ id: 'clip-1' }]);
  assert.deepStrictEqual(storage.getOutput('work-1', 'final_video'), { filename: 'final.mp4' });
  const beforeDeleteWork = storage.getWork('work-1');
  storage.deleteOutputs('work-1', ['video_clips', 'final_video', 'tts_audio']);
  assert.strictEqual(storage.getOutput('work-1', 'video_clips'), null);
  assert.strictEqual(storage.getOutput('work-1', 'final_video'), null);
  assert.strictEqual(storage.getOutput('work-1', 'tts_audio'), null);
  assert.deepStrictEqual(storage.getOutput('work-1', 'sound_journey'), { cues: [{ id: 'rain' }] }, '删除配音不得误删同一 audio 域的声音旅程');
  const deletedWork = storage.getWork('work-1');
  assert.strictEqual(deletedWork.domain_revisions.video, beforeDeleteWork.domain_revisions.video + 1);
  assert.strictEqual(deletedWork.domain_revisions.compose, beforeDeleteWork.domain_revisions.compose + 1);
  assert.strictEqual(deletedWork.domain_revisions.audio, beforeDeleteWork.domain_revisions.audio + 1);
  assert(deletedWork.invalidated_domains.includes('compose'));
  assert.strictEqual(storage.listWorkEvents('work-1').at(-1).type, 'work.authoritative_outputs_deleted');
  const deleteVersion = deletedWork.aggregate_version;
  storage.deleteOutputs('work-1', ['video_clips', 'final_video', 'tts_audio']);
  assert.strictEqual(storage.getWork('work-1').aggregate_version, deleteVersion, '重复删除必须幂等');

  storage.createTask({
    id: 'work-shadow-failure', brief: '影子故障前', user_id: 'user-1', content_revision: 1, lineage_enforced: true,
    request: { brief: '影子故障前', brief_source: 'user', target_duration: 30, output_ratio: '9:16' },
  });
  storage.saveOutput('work-shadow-failure', 'context', { brief: '影子故障前', brief_source: 'user', scene_assets: [] });
  works.ensureShadowWork('work-shadow-failure');
  storage.updateTask('work-shadow-failure', { content_revision: 2, request: { brief: '影子故障后', brief_source: 'user' } });
  const originalUpdate = storage.updateWork;
  storage.updateWork = () => { throw Object.assign(new Error('shadow unavailable'), { code: 'SHADOW_DOWN' }); };
  storage.saveOutput('work-shadow-failure', 'context', { brief: '影子故障后', brief_source: 'user', scene_assets: [] }, { content_revision: 2 });
  storage.updateWork = originalUpdate;
  const safeFailure = works.compareWithTask('work-shadow-failure');
  assert.strictEqual(safeFailure.ok, false, '影子同步失败必须保留可审计差异而不得伪装为一致');
  assert.strictEqual(safeFailure.ok, false, '影子同步失败必须显式记录但不得推翻旧权威写入');
  const shadowStage = storage.getTaskBundle('work-shadow-failure').stages.find(stage => stage.stage === 'work_shadow_sync');
  assert.strictEqual(shadowStage.status, 'failed');
  assert.strictEqual(shadowStage.diagnostics.model_calls_started, 0);
  console.log(JSON.stringify({ passed: true, aggregate_version: updated.aggregate_version, brief_revision: updated.domain_revisions.brief, idempotent: true, stale_write_blocked: true, precise_invalidation: true, authoritative_delete_verified: true, composite_domain_preserved: true, shadow_failure_isolated: true }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
