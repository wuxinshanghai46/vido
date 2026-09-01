#!/usr/bin/env node
'use strict';

const pipeline = require('../src/services/pipelineModelService');

const PRIMARY = Object.freeze([
  Object.freeze({ provider_id: 'deyunai', model_id: 'doubao-seedance-2-0-260128', enabled: true }),
  Object.freeze({ provider_id: 'smscrw', model_id: 'doubao-seedance-2.0', enabled: true }),
  Object.freeze({ provider_id: 'webang-seedance', model_id: 'doubao-seedance-2-0-260128', enabled: true }),
]);
const STAGES = Object.freeze(['new_story_ad.video']);

function key(model = {}) {
  return `${String(model.provider_id || '').trim().toLowerCase()}/${String(model.model_id || '').trim().toLowerCase()}`;
}

function desiredModels(current = []) {
  const existing = new Map((Array.isArray(current) ? current : []).map(model => [key(model), model]));
  const primaryKeys = new Set(PRIMARY.map(key));
  const primary = PRIMARY.map((model, index) => ({ ...existing.get(key(model)), ...model, priority: index + 1 }));
  const rest = (Array.isArray(current) ? current : [])
    .filter(model => !primaryKeys.has(key(model)))
    .filter(model => String(model.provider_id || '').trim().toLowerCase() !== 'smscrw')
    .map((model, index) => ({ ...model, priority: primary.length + index + 1 }));
  return [...primary, ...rest];
}

function mergedStageSource(stage, current = [], pipelineService = pipeline) {
  const defaults = typeof pipelineService.getStageDefaults === 'function'
    ? pipelineService.getStageDefaults(stage) : [];
  const seen = new Set(current.map(key));
  return [...current, ...defaults.filter(model => !seen.has(key(model)))];
}

function migrate({ apply = false, pipelineService = pipeline } = {}) {
  const reports = STAGES.map(stage => {
    const before = pipelineService.getStageConfig(stage);
    const desired = desiredModels(mergedStageSource(stage, before, pipelineService));
    const changed = JSON.stringify(before) !== JSON.stringify(desired);
    return { stage, changed, before: before.map(key), after: desired.map(key), desired };
  });
  const changed = reports.some(row => row.changed);
  if (apply && changed) {
    const rejected = reports.flatMap(report => PRIMARY.map(model => ({
      stage: report.stage,
      model: key(model),
      validation: pipelineService.validateStageModel(report.stage, model),
    }))).filter(item => item.validation?.ok !== true);
    if (rejected.length) {
      const error = new Error(`目标 Seedance 路线校验失败：${rejected.map(item => `${item.stage}:${item.model}:${item.validation?.reason}`).join(', ')}`);
      error.code = 'PUBLIC_MEDIA_MODEL_MIGRATION_VALIDATION_FAILED';
      error.rejected = rejected;
      throw error;
    }
    const config = pipelineService.loadConfig();
    const next = { ...config, stages: { ...(config.stages || {}) } };
    reports.forEach(report => { next.stages[report.stage] = report.desired; });
    pipelineService.saveConfig(next);
  }
  return {
    schema_version: 2, mode: apply ? 'apply' : 'dry-run', changed,
    reports: reports.map(({ desired, ...report }) => report), model_calls: 0, paid_calls: 0,
  };
}

if (require.main === module) console.log(JSON.stringify(migrate({ apply: process.argv.includes('--apply') })));

module.exports = { PRIMARY, STAGES, desiredModels, key, mergedStageSource, migrate };
