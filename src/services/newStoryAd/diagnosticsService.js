function summarizeTask({ task, review, modelMeta = {} } = {}) {
  return {
    task_id: task?.id || '',
    status: task?.status || '',
    stage: task?.stage || '',
    pass: review ? review.blocking_issues?.length === 0 : undefined,
    blocking_count: review?.blocking_issues?.length || 0,
    rewrite_count: review?.rewrite_issues?.length || 0,
    warning_count: review?.warnings?.length || 0,
    used_model: modelMeta.used_model || '',
    fallback_used: !!modelMeta.fallback_used,
  };
}

module.exports = { summarizeTask };
