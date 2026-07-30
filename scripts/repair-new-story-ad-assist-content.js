#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const storage = require('../src/services/newStoryAd/storageService');
const subjectText = require('../src/services/newStoryAd/subjectProfileTextService');
const sceneText = require('../src/services/newStoryAd/sceneAssistCompletenessService');
const referenceEvidenceText = require('../src/services/newStoryAd/referenceEvidenceTextService');

const RAW_EVIDENCE = /(?:逐帧分析|逐帧说明|时间点\s*\d+(?:\.\d+)?\s*秒)/u;

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}

function repairReferenceAnalysis(reference = {}) {
  if (!reference || typeof reference !== 'object') return reference;
  return referenceEvidenceText.sanitizeAnalysis(reference);
}

function repairTree(value, options = {}, key = '') {
  if (Array.isArray(value)) return value.map(item => repairTree(item, options, key));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    const age = options.age || '';
    if (/^appearance_?text$/i.test(key)) return subjectText.alignAgeDescription(value, age, 800);
    if (!RAW_EVIDENCE.test(value)) return value;
    const evidenceFacts = options.referenceFacts || {};
    if (/advertised_subject|product(?:_or_service|_subject)?|^name$/i.test(key)) {
      return referenceEvidenceText.kindValue(value, 'product', evidenceFacts.product_or_service);
    }
    if (/material|light|source_text|dominant_finish/i.test(key)) return sceneText.conciseSceneText(value, 'material');
    if (/interaction|action|contact/i.test(key)) return sceneText.conciseSceneText(value, 'interaction');
    if (/layout|description|environment|business_boundary/i.test(key)) return sceneText.conciseSceneText(value, 'layout');
    return referenceEvidenceText.kindValue(value, 'summary');
  }
  const localAge = value.age || value.ageRange || options.age || '';
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    childKey === 'reference_video_analysis'
      ? repairTree(repairReferenceAnalysis(child), { ...options, age: localAge }, childKey)
      : repairTree(child, { ...options, age: localAge }, childKey),
  ]));
}

function autoReferenceProductDraft(value = {}) {
  return value
    && typeof value === 'object'
    && value.type === 'advertised_product'
    && value.source === 'reference_evidence_candidate'
    && (!value.status || value.status === 'planned_not_generated')
    && !value.image_url
    && !value.cover_image_url
    && !(Array.isArray(value.view_images) && value.view_images.length);
}

function removeAutoReferenceProductDrafts(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => !autoReferenceProductDraft(item))
      .map(removeAutoReferenceProductDrafts);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    removeAutoReferenceProductDrafts(child),
  ]));
}

function repairTaskBundle(bundle = {}) {
  const task = bundle.task || {};
  const request = task.request || {};
  const age = request.person_spec?.age || '';
  const reference = repairReferenceAnalysis(request.reference_video_analysis || {});
  const referenceFacts = reference.source_facts || {};
  return removeAutoReferenceProductDrafts({
    task: {
      ...task,
      request: repairTree({ ...request, reference_video_analysis: reference }, { age, referenceFacts }),
    },
    outputs: (bundle.outputs || []).map(row => ({
      ...row,
      payload: repairTree(row.payload, { age, referenceFacts }),
    })),
  });
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
  removeAutoReferenceProductDrafts,
  repairTaskBundle,
  summarize,
};
