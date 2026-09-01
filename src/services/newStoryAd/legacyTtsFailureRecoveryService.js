'use strict';

const storage = require('./storageService');

const RECOVERY_KIND = 'legacy_tts_failure_recovery_v375';
function code(task = {}) { return String(task.error_code || task.error?.code || '').trim(); }
function eligible(task = {}) {
  if (task.active_generation_id) return false;
  if (String(task.stage || '') !== 'tts_failed' || code(task) !== 'PERSON_VERIFICATION_REQUIRED') return false;
  const tts = storage.getOutput(task.id, 'tts_audio') || {};
  return !Array.isArray(tts.tracks) || tts.tracks.filter(Boolean).length === 0;
}
function recoverTask(taskId) {
  const task = storage.getTask(taskId);
  if (!task || !eligible(task)) return { recovered: false, task_id: taskId };
  const recoveredAt = new Date().toISOString();
  storage.saveOutput(taskId, RECOVERY_KIND, {
    migration_id: RECOVERY_KIND,
    recovered_at: recoveredAt,
    previous_status: task.status || '',
    previous_stage: task.stage || '',
    previous_error_code: code(task),
    previous_support_id: task.support_id || '',
    reason: '旧版 TTS 错误调用视频人物门禁；当前声音合同不依赖人物验证。',
    model_calls: 0,
    paid_calls: 0,
  });
  storage.updateTask(taskId, {
    status: 'working',
    stage: 'storyboard_ready',
    error: '',
    error_code: '',
    support_id: '',
    retryable: false,
    generation_progress: null,
    generation_finished_at: '',
    legacy_tts_failure_recovered_at: recoveredAt,
  });
  return { recovered: true, task_id: taskId, recovered_at: recoveredAt };
}
function recoverAll() {
  const recovered = storage.listTasks({ limit: 100000 }).filter(eligible).map(task => recoverTask(task.id));
  return { scanned: storage.listTasks({ limit: 100000 }).length, recovered: recovered.filter(item => item.recovered).length, model_calls: 0, paid_calls: 0 };
}

module.exports = { RECOVERY_KIND, eligible, recoverAll, recoverTask };
