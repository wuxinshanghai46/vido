#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const storage = require('../src/services/newStoryAd/storageService');
const subjectText = require('../src/services/newStoryAd/subjectProfileTextService');
const sceneText = require('../src/services/newStoryAd/sceneAssistCompletenessService');
const referenceAnalysis = require('../src/services/newStoryAd/referenceVideoAnalysisService');

const RAW_EVIDENCE = /(?:逐帧分析|逐帧说明|时间点\s*\d+(?:\.\d+)?\s*秒)/u;

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function repairReferenceAnalysis(reference = {}) {
  if (!reference || typeof reference !== 'object') return reference;
  const prompts = Array.isArray(reference.scene_prompts) ? reference.scene_prompts : [];
  const first = (key, fallback = '') => parsed.map(item => item[key]).find(Boolean) || fallback;
  const existing = reference.source_facts && typeof reference.source_facts === 'object'
    ? reference.source_facts
    : {};
  const repairableSourceFacts = {
    product_or_service: existing.product_or_service,
    environment: existing.environment,
    materials: existing.materials,
    colors: existing.colors,
    layout: existing.layout,
    lighting: existing.lighting,
    human_actions: existing.human_actions,
  };
  const requiresRepair = prompts.some(prompt => RAW_EVIDENCE.test(String(prompt?.layout_prompt || '')))
    || RAW_EVIDENCE.test(JSON.stringify(repairableSourceFacts));
  if (!requiresRepair) return reference;
  const parsed = prompts.map(prompt => referenceAnalysis._private.visualEvidenceFacts(prompt?.layout_prompt || ''));
  const parsedMaterials = [...new Set(parsed.map(item => item.materials).filter(Boolean))];
  const parsedColors = [...new Set(parsed.map(item => item.colors).filter(Boolean))];
  const parsedActions = [...new Set(parsed.map(item => item.action).filter(Boolean))];
  const nextFacts = {
    ...existing,
    product_or_service: first('product', existing.product_or_service),
    environment: first('environment', existing.environment),
    materials: parsedMaterials.length ? parsedMaterials : (Array.isArray(existing.materials) ? existing.materials : []),
    colors: parsedColors.length ? parsedColors : (Array.isArray(existing.colors) ? existing.colors : []),
    layout: first('layout', existing.layout),
    lighting: first('lighting', existing.lighting),
    human_actions: parsedActions.length ? parsedActions : (Array.isArray(existing.human_actions) ? existing.human_actions : []),
  };
  const nextPrompts = prompts.map((prompt, index) => {
    const facts = parsed[index] || {};
    const layout = [
      facts.environment || nextFacts.environment,
      facts.layout || nextFacts.layout,
      facts.product || nextFacts.product_or_service ? `广告主体：${facts.product || nextFacts.product_or_service}` : '',
    ].filter(Boolean).join('；');
    const material = [
      facts.materials || nextFacts.materials[0],
      facts.colors || nextFacts.colors[0],
      facts.lighting || nextFacts.lighting,
    ].filter(Boolean).join('；');
    return {
      ...prompt,
      location_type: facts.environment || prompt.location_type,
      layout_prompt: layout || prompt.layout_prompt,
      material_light_prompt: material || prompt.material_light_prompt,
      interaction_prompt: facts.action || prompt.interaction_prompt,
    };
  });
  return { ...reference, source_facts: nextFacts, scene_prompts: nextPrompts };
}

function repairTree(value, options = {}, key = '') {
  if (Array.isArray(value)) return value.map(item => repairTree(item, options, key));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    const age = options.age || '';
    if (key === 'appearanceText') return subjectText.alignAgeDescription(value, age, 800);
    if (!RAW_EVIDENCE.test(value)) return value;
    if (/material|light|source_text|dominant_finish/i.test(key)) return sceneText.conciseSceneText(value, 'material');
    if (/interaction/i.test(key)) return sceneText.conciseSceneText(value, 'interaction');
    if (/layout|description/i.test(key)) return sceneText.conciseSceneText(value, 'layout');
    return value;
  }
  const localAge = value.age || value.ageRange || options.age || '';
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    childKey === 'reference_video_analysis'
      ? repairTree(repairReferenceAnalysis(child), { ...options, age: localAge }, childKey)
      : repairTree(child, { ...options, age: localAge }, childKey),
  ]));
}

function repairTaskBundle(bundle = {}) {
  const task = bundle.task || {};
  const request = task.request || {};
  const age = request.person_spec?.age || '';
  return {
    task: {
      ...task,
      request: repairTree(request, { age }),
    },
    outputs: (bundle.outputs || []).map(row => ({
      ...row,
      payload: repairTree(row.payload, { age }),
    })),
  };
}

function changedOutputs(before = [], after = []) {
  const prior = new Map(before.map(row => [row.kind, row]));
  return after.filter(row => fingerprint(row.payload) !== fingerprint(prior.get(row.kind)?.payload));
}

function summarize(before = {}, after = {}) {
  const beforeRequest = before.task?.request || {};
  const afterRequest = after.task?.request || {};
  return {
    task_id: before.task?.id || '',
    request_changed: fingerprint(beforeRequest) !== fingerprint(afterRequest),
    outputs_changed: changedOutputs(before.outputs || [], after.outputs || []).map(row => row.kind),
    before: {
      appearance: String(beforeRequest.person_spec?.appearanceText || '').slice(0, 180),
      scene_layout: String(beforeRequest.scene_spec?.layoutText || '').slice(0, 180),
    },
    after: {
      appearance: String(afterRequest.person_spec?.appearanceText || '').slice(0, 180),
      scene_layout: String(afterRequest.scene_spec?.layoutText || '').slice(0, 180),
    },
  };
}

async function main() {
  const taskId = String(process.argv[2] || '').trim();
  const apply = process.argv.includes('--apply');
  if (!taskId) throw new Error('用法：node scripts/repair-new-story-ad-assist-content.js <task_id> [--apply]');
  const before = storage.getTaskBundle(taskId, { diagnostics: false });
  if (!before.task) throw new Error(`任务不存在：${taskId}`);
  if (before.task.active_generation_id || before.task.active_stage) {
    throw new Error('任务仍有活动生成，已停止修复，避免覆盖并发结果');
  }
  const after = repairTaskBundle(before);
  const summary = summarize(before, after);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', ...summary }, null, 2));
    return;
  }
  const backupDir = path.resolve(process.env.OUTPUT_DIR || path.join(__dirname, '../outputs'), 'repair-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `${taskId}-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    task: before.task,
    outputs: (before.outputs || []).filter(row => summary.outputs_changed.includes(row.kind)),
  }, null, 2));
  storage.updateTask(taskId, { request: after.task.request });
  for (const row of changedOutputs(before.outputs || [], after.outputs || [])) {
    storage.saveOutput(taskId, row.kind, row.payload);
  }
  const verified = repairTaskBundle(storage.getTaskBundle(taskId, { diagnostics: false }));
  const verifySummary = summarize(storage.getTaskBundle(taskId, { diagnostics: false }), verified);
  if (verifySummary.request_changed || verifySummary.outputs_changed.length) {
    throw new Error('修复写入后仍检测到可修复旧内容，已保留备份并停止');
  }
  console.log(JSON.stringify({ mode: 'applied', backup_path: backupPath, ...summary, verified: true }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  RAW_EVIDENCE,
  repairReferenceAnalysis,
  repairTree,
  repairTaskBundle,
  summarize,
};
