#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pipeline = require('../src/services/pipelineModelService');
const policy = require('../src/services/newStoryAd/modelRoutingPolicyService');

const MIGRATION_ID = 'story-ad-quality-supplier-routing-v327';
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'));
const BACKUP_PATH = path.join(OUTPUT_DIR, `${MIGRATION_ID}-backup.json`);

function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function assertPolicy(routes) {
  for (const [stageId, route] of Object.entries(routes)) {
    const suppliers = route.map(item => item.provider_id);
    if (new Set(suppliers).size !== suppliers.length) throw new Error(`${stageId}: 同一供应商只能出现一个模型`);
    const expected = policy.SUPPLIER_ORDER.filter(id => suppliers.includes(id));
    if (suppliers.join('|') !== expected.join('|')) throw new Error(`${stageId}: 供应商顺序不符合 A→B→C 降级合同`);
    route.forEach((item, index) => {
      if (item.priority !== index + 1 || item.enabled !== true) throw new Error(`${stageId}: priority/enabled 无效`);
    });
  }
}

function apply({ write = false } = {}) {
  const config = pipeline.loadConfig();
  const desired = policy.managedStageRoutes();
  assertPolicy(desired);
  const before = Object.fromEntries(Object.keys(desired).map(stageId => [stageId, config.stages?.[stageId] || []]));
  const changed = Object.keys(desired).filter(stageId => hash(before[stageId]) !== hash(desired[stageId]));
  if (write && changed.length) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(BACKUP_PATH, JSON.stringify({ migration_id: MIGRATION_ID, stages: before, created_at: new Date().toISOString() }, null, 2));
    pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...desired } });
    const persisted = pipeline.loadConfig();
    if (Object.keys(desired).some(stageId => hash(persisted.stages?.[stageId] || []) !== hash(desired[stageId]))) {
      throw new Error(`${MIGRATION_ID}: 模型调用管理写入后读回校验失败`);
    }
  }
  return {
    migration_id: MIGRATION_ID,
    target: 'pipeline_model_config.full / 模型调用管理',
    applied: write && changed.length > 0,
    stage_count: Object.keys(desired).length,
    changed_stage_count: changed.length,
    supplier_order: policy.SUPPLIER_ORDER,
    profiles: policy.PROFILES,
    routes: policy.audit(),
  };
}

function rollback() {
  if (!fs.existsSync(BACKUP_PATH)) return { migration_id: MIGRATION_ID, rolled_back: false, reason: 'backup_not_found' };
  const backup = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
  if (backup.migration_id !== MIGRATION_ID || !backup.stages) throw new Error(`${MIGRATION_ID}: 备份无效`);
  const config = pipeline.loadConfig();
  pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...backup.stages } });
  fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, rolled_back: true };
}

function commit() {
  const removed = fs.existsSync(BACKUP_PATH);
  if (removed) fs.unlinkSync(BACKUP_PATH);
  return { migration_id: MIGRATION_ID, committed: true, removed_backup: removed };
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  const result = args.has('--rollback') ? rollback() : args.has('--commit') ? commit() : apply({ write: args.has('--apply') });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { MIGRATION_ID, assertPolicy, apply, rollback, commit };
