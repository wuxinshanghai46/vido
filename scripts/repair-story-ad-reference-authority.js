#!/usr/bin/env node
'use strict';

const storage = require('../src/services/newStoryAd/storageService');
const referenceVideoAnalyses = require('../src/services/newStoryAd/referenceVideoAnalysisService');
const referenceUnderstandingEdits = require('../src/services/newStoryAd/referenceUnderstandingEditService');
const referenceSync = require('../src/services/newStoryAd/referenceAnalysisTaskSyncService');
const confirmations = require('../src/services/storyAdWorkspace/referenceUnderstandingConfirmationService');

const apply = process.argv.includes('--apply');
const taskIndex = process.argv.indexOf('--task');
const taskId = taskIndex >= 0 ? String(process.argv[taskIndex + 1] || '').trim() : '';

function fail(message, code = 'REFERENCE_AUTHORITY_REPAIR_INVALID') {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function taskCalls(task) {
  return (storage.readDb().model_calls || []).filter(call => String(call.task_id || '') === String(task.id)).length;
}

function confirmationWasInvalidated({ wouldChange = false, beforeStatus = '', afterStatus = '' } = {}) {
  return !wouldChange || beforeStatus !== 'confirmed' || afterStatus !== 'confirmed';
}

async function main() {
  if (!taskId) fail('Usage: node scripts/repair-story-ad-reference-authority.js --task <task-id> [--apply]', 'TASK_ID_REQUIRED');
  if (apply && taskIndex < 0) fail('--apply 必须与显式 --task 一起使用', 'EXPLICIT_TASK_REQUIRED');
  const task = storage.getTask(taskId);
  if (!task) fail('任务不存在', 'TASK_NOT_FOUND');
  if (String(task.active_generation_id || '').trim()) fail('任务正在生成，禁止修复参考权威投影', 'ACTIVE_GENERATION_BLOCKED');

  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const savedAnalysis = context.reference_video_analysis || {};
  const analysisId = String(savedAnalysis.analysis_id || savedAnalysis.id || context.reference_video_analysis_id || '').trim();
  if (!analysisId) fail('任务没有已绑定的参考分析', 'REFERENCE_ANALYSIS_NOT_BOUND');
  const ownerId = String(task.user_id || context.user_id || context.userId || '').trim();
  if (!ownerId) fail('任务缺少参考分析所有者', 'REFERENCE_OWNER_MISSING');

  const analysisRecord = referenceVideoAnalyses.get(analysisId, { id: ownerId, userId: ownerId });
  if (analysisRecord.task_id && String(analysisRecord.task_id) !== String(taskId)) {
    fail('参考分析绑定到其他任务，已停止修复', 'REFERENCE_TASK_MISMATCH');
  }
  const authoritative = referenceUnderstandingEdits.applyOverride(
    referenceVideoAnalyses.taskRecord(analysisRecord),
    context.reference_understanding_override,
  );
  if (String(authoritative.status || '').toLowerCase() !== 'completed' || authoritative.analysis_quality?.valid !== true) {
    fail('权威参考分析尚未完成或质量无效', 'REFERENCE_ANALYSIS_NOT_READY');
  }

  const oldFingerprint = confirmations.fingerprint(savedAnalysis.reference_understanding || {});
  const newFingerprint = confirmations.fingerprint(authoritative.reference_understanding || {});
  const beforeConfirmation = confirmations.inspect(taskId, context);
  const wouldChange = oldFingerprint !== newFingerprint;
  const report = {
    schema_version: 1,
    task_id: taskId,
    apply,
    read_only: !apply,
    analysis_id: analysisId,
    old_understanding_fingerprint: oldFingerprint,
    new_understanding_fingerprint: newFingerprint,
    would_change: wouldChange,
    confirmation_status_before: beforeConfirmation.status,
    expected_confirmation_status_after: wouldChange && beforeConfirmation.status === 'confirmed'
      ? 'not_confirmed'
      : beforeConfirmation.status,
    changed: false,
    confirmation_status_after: beforeConfirmation.status,
    model_calls_before: taskCalls(task),
    model_calls_after: taskCalls(task),
    model_calls_delta: 0,
  };
  if (!apply) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const syncResult = await referenceSync.syncTerminalAnalysis(analysisRecord, authoritative);
  const nextContext = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
  const afterConfirmation = confirmations.inspect(taskId, nextContext);
  const callsAfter = taskCalls(task);
  const applied = {
    ...report,
    read_only: false,
    changed: syncResult.synced === true,
    sync_reason: syncResult.reason || '',
    confirmation_status_after: afterConfirmation.status,
    model_calls_after: callsAfter,
    model_calls_delta: callsAfter - report.model_calls_before,
  };
  if (Number(syncResult.model_call_count || 0) !== 0 || applied.model_calls_delta !== 0) {
    fail('参考权威投影修复出现了模型调用，已违反零模型合同', 'REFERENCE_REPAIR_MODEL_CALL_DETECTED');
  }
  if (!confirmationWasInvalidated({
    wouldChange,
    beforeStatus: beforeConfirmation.status,
    afterStatus: afterConfirmation.status,
  })) {
    fail('旧指纹确认仍被错误复用', 'REFERENCE_CONFIRMATION_STILL_CURRENT');
  }
  console.log(JSON.stringify(applied, null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ success: false, code: error.code || 'REFERENCE_AUTHORITY_REPAIR_FAILED', error: error.message }));
  process.exitCode = 1;
});

module.exports = { confirmationWasInvalidated, main };
