#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-assist-route-v127-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

const settings = {
  providers: [
    {
      id: 'apismile', enabled: true, api_key: 'fixture-key',
      models: [
        { id: 'gpt-5.5', enabled: true, use: 'story' },
        { id: 'gemini-2.5-pro', enabled: true, use: 'story' },
      ],
    },
    {
      id: 'deyunai', enabled: true, api_key: 'fixture-key',
      models: [
        { id: 'gemini-2.5-pro', enabled: true, use: 'story' },
        { id: 'gpt-4o', enabled: true, use: 'story' },
        { id: 'gemini-2.5-flash', enabled: true, use: 'story' },
      ],
    },
    {
      id: 'webang-maas', enabled: true, api_key: 'fixture-key',
      models: [{ id: 'gpt-5.6-terra', enabled: true, use: 'story' }],
    },
  ],
};
fs.writeFileSync(path.join(outputDir, 'settings.json'), JSON.stringify(settings, null, 2));

const pipeline = require('../src/services/pipelineModelService');
const migration = require('./migrate-new-story-ad-assist-route-v127');
const originalRoute = [{ provider_id: 'deyunai', model_id: 'gemini-2.5-pro', enabled: true, priority: 1 }];
pipeline.saveConfig({
  stages: {
    [migration.STAGE]: originalRoute,
    'new_story_ad.qa': [{ provider_id: 'deyunai', model_id: 'gpt-4o', enabled: true, priority: 1 }],
  },
});

try {
  const dry = migration.applyMigration({ dryRun: true });
  assert.equal(dry.changed, true);
  assert.equal(dry.provider_count, 3);
  assert(dry.route.includes('webang-maas/gpt-5.6-terra'), '发布迁移必须保留微众 Terra，不能被旧 V127 路由覆盖');
  assert.equal(pipeline.pickAllEnabled(migration.STAGE).length, 1, 'dry-run 不得写配置');

  const applied = migration.applyMigration({ dryRun: false });
  assert.equal(applied.changed, true);
  assert.equal(new Set(applied.route.map(item => item.split('/')[0])).size, 3);
  assert.deepEqual(
    pipeline.pickAllEnabled(migration.STAGE).map(item => `${item.provider_id}/${item.model_id}`),
    applied.route,
  );
  assert.equal(pipeline.pickAllEnabled('new_story_ad.qa')[0].model_id, 'gpt-4o', '不得改写其它阶段');

  const idempotent = migration.applyMigration({ dryRun: false });
  assert.equal(idempotent.changed, false, '重复迁移必须幂等');

  const rolledBack = migration.rollback();
  assert.equal(rolledBack.rolled_back, true);
  assert.deepEqual(pipeline.pickAllEnabled(migration.STAGE), originalRoute);
  const reapplied = migration.applyMigration({ dryRun: false });
  assert.equal(reapplied.changed, true);
  const committed = migration.commit();
  assert.equal(committed.committed, true);
  assert.equal(committed.removed_backup, true, '成功发布后必须清理本轮回滚备份，避免后续发布误回滚旧配置');
  assert.equal(migration.rollback().rolled_back, false, '已提交迁移不得继续回滚');
  console.log(JSON.stringify({ passed: true, provider_count: applied.provider_count, route_count: applied.route.length, rollback: true, commit: true }, null, 2));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
