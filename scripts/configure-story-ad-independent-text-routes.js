#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { loadSettings, saveSettings } = require('../src/services/settingsService');
const pipeline = require('../src/services/pipelineModelService');
const gateway = require('../src/services/newStoryAd/modelGateway');

const TARGET_STAGES = Object.freeze([
  'new_story_ad.reference_video_synthesis',
  'new_story_ad.blueprint',
  'new_story_ad.blueprint_structure_repair',
  'new_story_ad.blueprint_language_repair',
  'new_story_ad.blueprint_polish',
]);

const PREFERRED_CANDIDATES = Object.freeze([
  { provider_id: 'aiapi', model_id: 'deepseek-chat' },
  { provider_id: 'zhipu', model_id: 'glm-5' },
  { provider_id: 'apismile', model_id: 'gpt-4.1' },
]);

function providerMatches(provider = {}, id = '') {
  const target = String(id).toLowerCase();
  return [provider.id, provider.preset, provider.name].filter(Boolean)
    .some(value => String(value).toLowerCase() === target);
}

function selectCandidates(providers = []) {
  return PREFERRED_CANDIDATES.filter(candidate => {
    const provider = providers.find(item => item.enabled && item.api_key && providerMatches(item, candidate.provider_id));
    const model = (provider?.models || []).find(item => String(item.id) === candidate.model_id);
    return model && model.enabled !== false && ['story', 'chat', 'llm'].includes(String(model.use || model.type || '').toLowerCase());
  }).map((candidate, index) => ({ ...candidate, priority: index + 1, enabled: true }));
}

function ensureRequiredModels(settings = {}) {
  const prepared = JSON.parse(JSON.stringify(settings || {}));
  const zhipu = (prepared.providers || []).find(item => providerMatches(item, 'zhipu'));
  if (!zhipu) return prepared;
  zhipu.models = Array.isArray(zhipu.models) ? zhipu.models : [];
  const existing = zhipu.models.find(item => String(item.id) === 'glm-5');
  if (existing) Object.assign(existing, { use: 'story', type: 'story', enabled: true });
  else zhipu.models.push({ id: 'glm-5', name: 'GLM-5', use: 'story', type: 'story', enabled: true });
  return prepared;
}

function planIndependentRoutes(settings = loadSettings(), options = {}) {
  const prepared = ensureRequiredModels(settings);
  const candidates = selectCandidates(prepared.providers || []);
  if (candidates.length !== PREFERRED_CANDIDATES.length) {
    const available = candidates.map(item => `${item.provider_id}/${item.model_id}`).join(', ') || 'none';
    throw new Error(`独立文本路由前置检查失败：需要 ${PREFERRED_CANDIDATES.length} 个供应商，当前可用 ${available}`);
  }
  const domains = candidates.map(gateway.failureDomainKey);
  if (new Set(domains).size !== candidates.length) throw new Error('独立文本路由前置检查失败：候选模型仍共享故障域');
  if (options.validateCatalog !== false) {
    for (const stage of TARGET_STAGES) {
      for (const candidate of candidates) {
        const report = pipeline.validateStageModel(stage, candidate);
        if (!report.ok) throw new Error(`${stage} 拒绝 ${candidate.provider_id}/${candidate.model_id}: ${report.reason}`);
      }
    }
  }
  return Object.fromEntries(TARGET_STAGES.map(stage => [stage, candidates.map(item => ({ ...item }))]));
}

function applyIndependentRoutes(options = {}) {
  const originalSettings = options.settings || loadSettings();
  const preparedSettings = ensureRequiredModels(originalSettings);
  const config = pipeline.loadConfig();
  const before = Object.fromEntries(TARGET_STAGES.map(stage => [stage, config.stages?.[stage] || []]));
  if (!options.apply) {
    const routes = planIndependentRoutes(preparedSettings, { validateCatalog: false });
    return { applied: false, before, after: routes };
  }

  const backupDir = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'), 'deployment_backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `pipeline-text-routes-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), stages: before }, null, 2), 'utf8');

  let routes;
  try {
    saveSettings(preparedSettings);
    routes = planIndependentRoutes(preparedSettings, { validateCatalog: true });
    config.stages = config.stages || {};
    for (const [stage, candidates] of Object.entries(routes)) config.stages[stage] = candidates;
    pipeline.saveConfig(config);
  } catch (error) {
    saveSettings(originalSettings);
    throw error;
  }

  const persisted = Object.fromEntries(TARGET_STAGES.map(stage => [stage, pipeline.getStageConfig(stage)]));
  for (const stage of TARGET_STAGES) {
    if (JSON.stringify(persisted[stage]) !== JSON.stringify(routes[stage])) {
      throw new Error(`${stage} 持久化核对失败；备份位于 ${backupPath}`);
    }
  }
  return { applied: true, backup_path: backupPath, before, after: persisted };
}

if (require.main === module) {
  try {
    const result = applyIndependentRoutes({ apply: process.argv.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { TARGET_STAGES, PREFERRED_CANDIDATES, ensureRequiredModels, selectCandidates, planIndependentRoutes, applyIndependentRoutes };
