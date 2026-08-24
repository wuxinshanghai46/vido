#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const pipeline = require('../src/services/pipelineModelService');
const { loadSettings } = require('../src/services/settingsService');

const TEXT_CANDIDATE = Object.freeze({ provider_id: 'webang-maas', model_id: 'gpt-5.6-terra', enabled: true });
const DIALOGUE_CANDIDATE = Object.freeze({ provider_id: 'webang-maas', model_id: 'gpt-5.6-luna', enabled: true });
const VISION_CANDIDATE = Object.freeze({ provider_id: 'webang-maas', model_id: 'gemini-2.5-flash', enabled: true });

function providerReady(settings = loadSettings()) {
  const provider = (settings.providers || []).find(item =>
    item?.enabled !== false
      && [item.id, item.preset].some(value => String(value || '').toLowerCase() === 'webang-maas'));
  if (!provider?.api_key) return false;
  const modelIds = new Set((provider.models || []).filter(item => item?.enabled !== false).map(item => String(item.id || '')));
  return [TEXT_CANDIDATE.model_id, DIALOGUE_CANDIDATE.model_id, VISION_CANDIDATE.model_id]
    .every(modelId => modelIds.has(modelId));
}

function targetStages() {
  return Object.keys(pipeline.listDefaults()).filter(stage => {
    if (!stage.startsWith('new_story_ad.')) return false;
    const type = String(pipeline.getStageMeta(stage)?.type || '').toLowerCase();
    return type === 'story' || type === 'vlm';
  });
}

function candidateFor(stage = '') {
  if (stage === 'new_story_ad.brief_dialogue') return DIALOGUE_CANDIDATE;
  return String(pipeline.getStageMeta(stage)?.type || '').toLowerCase() === 'vlm'
    ? VISION_CANDIDATE
    : TEXT_CANDIDATE;
}

function mergeCandidate(route = [], candidate = {}) {
  const current = (Array.isArray(route) ? route : []).filter(Boolean).map(item => ({ ...item }));
  const withoutCandidate = current.filter(item => !(
    String(item.provider_id) === candidate.provider_id && String(item.model_id) === candidate.model_id
  ));
  const firstEnabledIndex = withoutCandidate.findIndex(item => item.enabled !== false);
  const insertAt = firstEnabledIndex >= 0 ? firstEnabledIndex + 1 : 0;
  withoutCandidate.splice(insertAt, 0, { ...candidate });
  return withoutCandidate.map((item, index) => ({ ...item, priority: index + 1 }));
}

function plan(config = pipeline.loadConfig()) {
  const stages = {};
  for (const stage of targetStages()) {
    const source = Array.isArray(config.stages?.[stage]) && config.stages[stage].length
      ? config.stages[stage]
      : pipeline.getStageDefaults(stage);
    const candidate = candidateFor(stage);
    const report = pipeline.validateStageModel(stage, candidate);
    if (!report.ok) throw new Error(`${stage} 拒绝 ${candidate.provider_id}/${candidate.model_id}: ${report.reason}`);
    stages[stage] = mergeCandidate(source, candidate);
  }
  return stages;
}

function apply({ write = false } = {}) {
  if (!providerReady()) throw new Error('微众 MaaS 文本/视觉模型或密钥未就绪，未修改路由');
  const config = pipeline.loadConfig();
  const stages = plan(config);
  if (!write) return { applied: false, stage_count: Object.keys(stages).length, stages };
  const backupDir = path.resolve(process.env.OUTPUT_DIR || path.resolve(__dirname, '../outputs'), 'deployment_backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `pipeline-webang-content-v204-${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ created_at: new Date().toISOString(), stages: config.stages || {} }, null, 2));
  pipeline.saveConfig({ ...config, stages: { ...(config.stages || {}), ...stages } });
  const persisted = pipeline.loadConfig();
  for (const stage of Object.keys(stages)) {
    if (JSON.stringify(persisted.stages?.[stage]) !== JSON.stringify(stages[stage])) {
      throw new Error(`${stage} 持久化核对失败；备份：${backupPath}`);
    }
  }
  return { applied: true, stage_count: Object.keys(stages).length, backup_path: backupPath };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(apply({ write: process.argv.includes('--apply') }), null, 2)}\n`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}

module.exports = { TEXT_CANDIDATE, DIALOGUE_CANDIDATE, VISION_CANDIDATE, providerReady, targetStages, candidateFor, mergeCandidate, plan, apply };
