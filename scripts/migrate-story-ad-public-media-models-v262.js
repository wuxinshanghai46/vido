#!/usr/bin/env node
'use strict';

const pipeline = require('../src/services/pipelineModelService');

const PRIMARY = Object.freeze([
  Object.freeze({ provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', enabled: true }),
  Object.freeze({ provider_id: 'smscrw', model_id: 'doubao-seedance-2-0-260128', enabled: true }),
  Object.freeze({ provider_id: 'webang-seedance', model_id: 'doubao-seedance-2-0-260128', enabled: true }),
]);
const STAGES = Object.freeze(['new_story_ad.video', 'new_story_ad.sound_generation']);

function key(model = {}) {
  return `${String(model.provider_id || '').trim().toLowerCase()}/${String(model.model_id || '').trim().toLowerCase()}`;
}

function desiredModels(current = []) {
  const existing = new Map((Array.isArray(current) ? current : []).map(model => [key(model), model]));
  const primaryKeys = new Set(PRIMARY.map(key));
  const primary = PRIMARY.map((model, index) => ({ ...existing.get(key(model)), ...model, priority: index + 1 }));
  const rest = (Array.isArray(current) ? current : [])
    .filter(model => !primaryKeys.has(key(model)))
    .map((model, index) => ({ ...model, priority: primary.length + index + 1 }));
  return [...primary, ...rest];
}

function migrate({ apply = false, pipelineService = pipeline } = {}) {
  const reports = STAGES.map(stage => {
    const before = pipelineService.getStageConfig(stage);
    const desired = desiredModels(before);
    const changed = JSON.stringify(before) !== JSON.stringify(desired);
    const result = apply && changed ? pipelineService.setStageConfig(stage, desired) : { models: desired, rejected: [] };
    if (apply && result.rejected?.length) throw new Error(`${stage} 模型配置迁移存在拒绝项`);
    return { stage, changed, before: before.map(key), after: result.models.map(key) };
  });
  return { schema_version: 1, mode: apply ? 'apply' : 'dry-run', changed: reports.some(row => row.changed), reports, model_calls: 0, paid_calls: 0 };
}

if (require.main === module) console.log(JSON.stringify(migrate({ apply: process.argv.includes('--apply') })));

module.exports = { PRIMARY, STAGES, desiredModels, key, migrate };
