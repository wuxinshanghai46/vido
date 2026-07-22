function hasTerminalFailure(task = {}) {
  return String(task.status || '').toLowerCase() === 'failed'
    || !!String(task.error || task.error_code || '').trim()
    || /_failed$/.test(String(task.stage || '').toLowerCase());
}

function taskPatch(task = {}, { progressStage = 'draft', hasActiveGeneration = false, changeScope = 'none' } = {}) {
  if (hasActiveGeneration) return {};
  const failed = hasTerminalFailure(task);
  if (failed && changeScope === 'none') return {};
  const finalDone = ['final_video_ready', 'done'].includes(progressStage);
  return {
    status: finalDone ? (failed ? 'done' : (task.status || 'done')) : 'working',
    stage: progressStage,
    ...(failed ? {
      error: '', error_code: '', support_id: '', retryable: false,
      generation_progress: null, generation_finished_at: '',
    } : {}),
  };
}

module.exports = { hasTerminalFailure, taskPatch };
