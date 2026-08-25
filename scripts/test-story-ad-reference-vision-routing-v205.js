#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-reference-vision-v205-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';

fs.writeFileSync(path.join(outputDir, 'settings.json'), JSON.stringify({ providers: [
  { id: 'zhipu', enabled: true, api_key: 'fixture', models: [{ id: 'glm-4.6v-flash', enabled: true, use: 'vision' }] },
  { id: 'apismile', enabled: true, api_key: 'fixture', models: [
    { id: 'gemini-2.5-pro', enabled: true, use: 'story' },
    { id: 'gemini-2.5-flash', enabled: true, use: 'story' },
  ] },
  { id: 'webang-maas', enabled: true, api_key: 'fixture', models: [{ id: 'gemini-2.5-flash', enabled: true, use: 'story' }] },
] }, null, 2));

const pipeline = require('../src/services/pipelineModelService');
const migration = require('./configure-story-ad-reference-vision-routing-v205');
const original = [{ provider_id: 'zhipu', model_id: 'glm-4.6v-flash', enabled: true, priority: 1 }];
pipeline.saveConfig({ stages: { [migration.STAGE]: original } });

try {
  const dry = migration.apply({ write: false });
  assert.equal(dry.changed, true);
  assert.deepEqual(dry.route, [
    'zhipu/glm-4.6v-flash',
    'apismile/gemini-2.5-pro',
    'apismile/gemini-2.5-flash',
    'webang-maas/gemini-2.5-flash',
  ]);
  assert.deepEqual(pipeline.pickAllEnabled(migration.STAGE), original, '只读预检不得写配置');
  const applied = migration.apply({ write: true });
  assert.equal(applied.applied, true);
  assert.equal(applied.provider_count, 3);
  assert.equal(migration.apply({ write: true }).changed, false, '重复执行必须幂等');
  assert.equal(migration.rollback().rolled_back, true);
  assert.deepEqual(pipeline.pickAllEnabled(migration.STAGE), original);
  assert.equal(migration.apply({ write: true }).applied, true);
  assert.equal(migration.commit().removed_backup, true);
  console.log(JSON.stringify({ passed: true, checks: 11, providers: applied.provider_count, route: applied.route }));
} finally {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
