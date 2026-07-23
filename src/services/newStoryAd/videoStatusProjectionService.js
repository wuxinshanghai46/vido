const FAILED_VIDEO_ATTEMPT_STATUSES = new Set(['failed', 'review_required', 'cancelled']);

function resolveAttempts(ledger, { taskId = '', status = {}, index = 0 } = {}) {
  const attempts = ledger.projectCurrentAndLast({ taskId, shotIndex: index });
  const currentAttempt = attempts.current || null;
  const currentFailed = !!currentAttempt
    && FAILED_VIDEO_ATTEMPT_STATUSES.has(String(currentAttempt.status || '').toLowerCase());
  const legacyFailureWithoutLedger = !currentAttempt
    && FAILED_VIDEO_ATTEMPT_STATUSES.has(String(status.last_attempt_status || '').toLowerCase());
  const restoredCurrentFailure = status.previous_clip_restored === true && currentFailed;
  const untouched = status.stopped_after_unit_failure === true && !currentAttempt && !attempts.last;
  return {
    currentAttempt: restoredCurrentFailure ? null : currentAttempt,
    lastAttempt: restoredCurrentFailure ? currentAttempt : null,
    exposeLastAttempt: (restoredCurrentFailure || legacyFailureWithoutLedger) && !untouched,
    untouched,
  };
}

module.exports = {
  FAILED_VIDEO_ATTEMPT_STATUSES,
  resolveAttempts,
};
