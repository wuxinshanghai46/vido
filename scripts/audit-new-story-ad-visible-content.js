#!/usr/bin/env node

require('dotenv').config();

const storage = require('../src/services/newStoryAd/storageService');

const REPEATED_AGE = /(?:成熟青年年龄感[\s，、；]*){2,}/u;
const RAW_FRAME_EVIDENCE = /(?:逐帧分析|逐帧说明|时间点\s*\d+(?:\.\d+)?\s*秒)/u;
const DISPLAY_PATH = /(?:person_spec|cast_profiles|characters|scene_spec|scene_plan|scene_config|spaces|reference_video_analysis|director)/i;

function inspectStrings(value, path = '', rows = []) {
  if (typeof value === 'string') {
    if (DISPLAY_PATH.test(path) && (REPEATED_AGE.test(value) || RAW_FRAME_EVIDENCE.test(value))) {
      rows.push({
        path,
        issue: REPEATED_AGE.test(value) ? 'repeated_age' : 'raw_frame_evidence',
        length: value.length,
        excerpt: value.replace(/\s+/g, ' ').slice(0, 220),
      });
    }
    return rows;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectStrings(item, `${path}[${index}]`, rows));
    return rows;
  }
  if (!value || typeof value !== 'object') return rows;
  Object.entries(value).forEach(([key, child]) => {
    inspectStrings(child, path ? `${path}.${key}` : key, rows);
  });
  return rows;
}

function main() {
  const taskId = String(process.argv[2] || '').trim();
  if (!taskId) throw new Error('用法：node scripts/audit-new-story-ad-visible-content.js <task_id>');
  const bundle = storage.getTaskBundle(taskId, { diagnostics: false });
  if (!bundle.task) throw new Error(`任务不存在：${taskId}`);
  const rows = [
    ...inspectStrings(bundle.task.request || {}, 'task.request'),
    ...(bundle.outputs || []).flatMap(output => inspectStrings(output.payload, `outputs.${output.kind}`)),
  ];
  console.log(JSON.stringify({
    task_id: taskId,
    status: bundle.task.status,
    stage: bundle.task.stage,
    active_generation_id: bundle.task.active_generation_id || '',
    active_stage: bundle.task.active_stage || '',
    updated_at: bundle.task.updated_at,
    issues: rows,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
