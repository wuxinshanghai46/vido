function gateError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = false;
  return error;
}

/** Normalize a user-authorized shot scope without allowing invalid values to become "all". */
function normalizeOnlyIndexes(options = {}, shotCount = 0) {
  const hasPlural = Object.prototype.hasOwnProperty.call(options, 'only_indexes')
    || Object.prototype.hasOwnProperty.call(options, 'onlyIndexes');
  const hasSingle = Object.prototype.hasOwnProperty.call(options, 'only_index')
    || Object.prototype.hasOwnProperty.call(options, 'onlyIndex');
  if (!hasPlural && !hasSingle) return null;
  const raw = hasPlural
    ? (options.only_indexes ?? options.onlyIndexes)
    : (options.only_index ?? options.onlyIndex);
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap(value => String(value ?? '').split(','))
    .map(value => value.trim());
  const indexes = [...new Set(values.map(value => value === '' ? NaN : Number(value)))];
  if (!indexes.length || indexes.some(index => !Number.isInteger(index) || index < 0 || index >= shotCount)) {
    throw gateError('指定的镜头序号无效，本次没有提交视频模型', 'VIDEO_SHOT_INDEX_INVALID', 422);
  }
  return indexes.sort((a, b) => a - b);
}

/** Convert input QA rejection into a preflight blocker without mutating task data. */
function addInputBlocker(plan, validate) {
  try {
    validate();
  } catch (error) {
    if (error?.code !== 'VIDEO_INPUT_QA_REQUIRED') throw error;
    plan.blockers.push({
      code: error.code,
      message: error.message,
      details: Array.isArray(error.details) ? error.details : [],
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  return plan;
}

/** A provider-before-validation race voids authorization and records that no provider was submitted. */
function validateBeforeProvider({ storage, taskId, validate }) {
  try {
    return validate();
  } catch (error) {
    const authorization = storage.getOutput(taskId, 'video_cost_authorization');
    if (authorization?.status === 'authorized') {
      storage.saveOutput(taskId, 'video_cost_authorization', {
        ...authorization,
        status: 'voided',
        void_reason: error?.code || 'PRE_PROVIDER_VALIDATION_FAILED',
        voided_at: new Date().toISOString(),
        provider_submitted: false,
      });
    }
    throw error;
  }
}

/** Force flags cannot expand a scope beyond the exact cost-confirmed preflight. */
function assertForceScope(options = {}, plan = {}) {
  const requested = Array.isArray(plan.scope?.requested_indexes) ? plan.scope.requested_indexes : [];
  const expanded = new Set(plan.scope?.expanded_indexes || []);
  if ((options.force_regenerate_all === true || options.forceRegenerateAll === true) && requested.length) {
    throw gateError('精确范围提交不能同时要求全量重做，本次没有提交视频模型', 'VIDEO_PREFLIGHT_SCOPE_MISMATCH', 409);
  }
  const raw = options.force_regenerate_indexes ?? options.forceRegenerateIndexes;
  if (raw === undefined) return true;
  const indexes = (Array.isArray(raw) ? raw : [raw])
    .flatMap(value => String(value ?? '').split(','))
    .map(value => value.trim() === '' ? NaN : Number(value));
  if (indexes.some(index => !Number.isInteger(index) || !expanded.has(index))) {
    throw gateError('重做镜头超出已确认的费用范围，本次没有提交视频模型', 'VIDEO_PREFLIGHT_SCOPE_MISMATCH', 409);
  }
  return true;
}

module.exports = { normalizeOnlyIndexes, addInputBlocker, validateBeforeProvider, assertForceScope };
