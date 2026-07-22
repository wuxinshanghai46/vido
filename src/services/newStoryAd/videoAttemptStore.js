const crypto = require('crypto');

const OUTPUT_KIND = 'video_attempt_store_v1';
const STORE_VERSION = 1;
const EVENT_TYPES = new Set([
  'claimed',
  'submitting',
  'provider_submitted',
  'provider_running',
  'succeeded',
  'pre_provider_failed',
  'failed',
  'billing_unknown',
  'cancelled',
]);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'review_required']);

function clean(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fail(message, code, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = false;
  return error;
}

function requireStorage(storage) {
  if (!storage || typeof storage.getOutput !== 'function' || typeof storage.saveOutput !== 'function') {
    throw fail('video attempt store 需要显式注入 getOutput/saveOutput storage', 'VIDEO_ATTEMPT_STORAGE_REQUIRED', 500);
  }
  return storage;
}

function normalizedLedger(value, taskId = '') {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: STORE_VERSION,
    task_id: clean(source.task_id || taskId, 160),
    headers: Array.isArray(source.headers) ? source.headers.map(item => ({ ...item })) : [],
    events: Array.isArray(source.events) ? source.events.map(item => ({ ...item })) : [],
  };
}

function readLedger(storage, taskId) {
  requireStorage(storage);
  const id = clean(taskId, 160);
  if (!id) throw fail('video attempt store 缺少 taskId', 'VIDEO_ATTEMPT_TASK_REQUIRED', 422);
  return normalizedLedger(storage.getOutput(id, OUTPUT_KIND), id);
}

function idempotencyFields(input = {}) {
  const fields = {
    task_id: clean(input.taskId ?? input.task_id, 160),
    shot_index: Number(input.shotIndex ?? input.shot_index),
    generation_id: clean(input.generationId ?? input.generation_id, 160),
    lineage_fingerprint: clean(input.lineageFingerprint ?? input.lineage_fingerprint, 160),
    provider_id: clean(input.providerId ?? input.provider_id, 80).toLowerCase(),
    model_id: clean(input.modelId ?? input.model_id, 160).toLowerCase(),
    cost_fingerprint: clean(input.costFingerprint ?? input.cost_fingerprint, 160),
  };
  const missing = Object.entries(fields)
    .filter(([key, value]) => key === 'shot_index'
      ? !Number.isInteger(value) || value < 0
      : !value)
    .map(([key]) => key);
  if (missing.length) {
    throw fail(`video attempt 幂等输入不完整: ${missing.join(', ')}`, 'VIDEO_ATTEMPT_IDEMPOTENCY_INPUT_REQUIRED', 422);
  }
  return fields;
}

function buildIdempotencyKey(input = {}) {
  const fields = idempotencyFields(input);
  return sha256(JSON.stringify([
    fields.task_id,
    fields.shot_index,
    fields.generation_id,
    fields.lineage_fingerprint,
    fields.provider_id,
    fields.model_id,
    fields.cost_fingerprint,
  ]));
}

function eventsForAttempt(ledger, attemptId) {
  return ledger.events.filter(event => String(event.attempt_id) === String(attemptId));
}

function eventTime(event = {}) {
  return clean(event.at || event.created_at, 40);
}

function projectAttempt(header = {}, events = []) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter(event => String(event.attempt_id) === String(header.attempt_id))
    .slice()
    .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const projection = {
    attempt_id: header.attempt_id || '',
    idempotency_key: header.idempotency_key || '',
    task_id: header.task_id || '',
    shot_index: Number(header.shot_index),
    generation_id: header.generation_id || '',
    lineage_fingerprint: header.lineage_fingerprint || '',
    provider_id: header.provider_id || '',
    model_id: header.model_id || '',
    cost_fingerprint: header.cost_fingerprint || '',
    status: 'claimed',
    terminal: false,
    retry_blocked: false,
    provider_task_id: '',
    provider_submission_state: 'not_submitted',
    provider_status: '',
    billing_state: 'not_submitted',
    requested_video_seconds: 0,
    error_code: '',
    error_message: '',
    claimed_at: header.claimed_at || header.created_at || '',
    updated_at: header.claimed_at || header.created_at || '',
    event_count: ordered.length,
  };
  for (const event of ordered) {
    const type = clean(event.type, 60);
    const providerTaskId = clean(event.provider_task_id, 200);
    if (providerTaskId) projection.provider_task_id = providerTaskId;
    if (event.provider_status !== undefined) projection.provider_status = clean(event.provider_status, 120);
    if (event.requested_video_seconds !== undefined) {
      projection.requested_video_seconds = Math.max(0, Number(event.requested_video_seconds) || 0);
    }
    if (event.error_code !== undefined) projection.error_code = clean(event.error_code, 160);
    if (event.error_message !== undefined) projection.error_message = clean(event.error_message, 1000);
    projection.updated_at = eventTime(event) || projection.updated_at;

    if (type === 'claimed') projection.status = 'claimed';
    if (type === 'submitting') projection.status = 'submitting';
    if (type === 'provider_submitted') {
      projection.status = 'provider_submitted';
      projection.provider_submission_state = 'submitted';
      projection.billing_state = clean(event.billing_state, 40).toLowerCase() || 'unknown';
    }
    if (type === 'provider_running') {
      projection.status = 'provider_running';
      projection.provider_submission_state = 'submitted';
      projection.billing_state = clean(event.billing_state, 40).toLowerCase() || projection.billing_state || 'unknown';
    }
    if (type === 'succeeded') {
      projection.status = 'succeeded';
      projection.terminal = true;
      projection.provider_submission_state = projection.provider_task_id ? 'completed' : 'not_submitted';
      projection.billing_state = clean(event.billing_state, 40).toLowerCase()
        || (projection.provider_task_id ? 'confirmed' : 'not_submitted');
    }
    if (type === 'pre_provider_failed') {
      projection.status = 'failed';
      projection.terminal = true;
      projection.provider_task_id = '';
      projection.provider_submission_state = 'not_submitted';
      projection.billing_state = 'not_submitted';
      projection.requested_video_seconds = 0;
    }
    if (type === 'failed') {
      projection.status = 'failed';
      projection.terminal = true;
      const submitted = !!projection.provider_task_id;
      projection.provider_submission_state = submitted ? 'submitted' : 'not_submitted';
      projection.billing_state = clean(event.billing_state, 40).toLowerCase() || (submitted ? 'unknown' : 'not_submitted');
      projection.retry_blocked = projection.billing_state === 'unknown';
    }
    if (type === 'billing_unknown') {
      projection.status = 'review_required';
      projection.terminal = true;
      projection.retry_blocked = true;
      projection.provider_submission_state = projection.provider_task_id ? 'submitted' : projection.provider_submission_state;
      projection.billing_state = 'unknown';
    }
    if (type === 'cancelled') {
      projection.status = 'cancelled';
      projection.terminal = true;
      const submitted = !!projection.provider_task_id;
      projection.provider_submission_state = submitted ? 'submitted' : 'not_submitted';
      projection.billing_state = clean(event.billing_state, 40).toLowerCase() || (submitted ? 'unknown' : 'not_submitted');
      projection.retry_blocked = projection.billing_state === 'unknown';
    }
  }
  projection.terminal = projection.terminal || TERMINAL_STATUSES.has(projection.status);
  if (projection.billing_state === 'unknown') projection.retry_blocked = true;
  return projection;
}

function projectedAttempts(ledger, shotIndex = null) {
  return ledger.headers
    .filter(header => shotIndex === null || Number(header.shot_index) === Number(shotIndex))
    .map(header => projectAttempt(header, eventsForAttempt(ledger, header.attempt_id)))
    .sort((a, b) => {
      const sequenceA = Number(ledger.headers.find(item => item.attempt_id === a.attempt_id)?.sequence || 0);
      const sequenceB = Number(ledger.headers.find(item => item.attempt_id === b.attempt_id)?.sequence || 0);
      return sequenceA - sequenceB;
    });
}

function projectCurrentAndLast(storage, { taskId, shotIndex } = {}) {
  const index = Number(shotIndex);
  if (!Number.isInteger(index) || index < 0) {
    throw fail('current/last attempt 投影缺少有效 shotIndex', 'VIDEO_ATTEMPT_SHOT_REQUIRED', 422);
  }
  const ledger = readLedger(storage, taskId);
  const attempts = projectedAttempts(ledger, index);
  return {
    current: attempts.at(-1) || null,
    last: attempts.length > 1 ? attempts.at(-2) : null,
    attempts,
  };
}

function blockingAttempt(attempts = []) {
  return attempts.slice().reverse().find(attempt => !attempt.terminal || attempt.retry_blocked) || null;
}

function projectClaim(storage, input = {}) {
  const fields = idempotencyFields(input);
  const ledger = readLedger(storage, fields.task_id);
  const key = buildIdempotencyKey(fields);
  const existingHeader = ledger.headers.find(header => header.idempotency_key === key);
  if (existingHeader) {
    return {
      ready: false,
      duplicate: true,
      conflict: false,
      idempotency_key: key,
      attempt: projectAttempt(existingHeader, eventsForAttempt(ledger, existingHeader.attempt_id)),
    };
  }
  const blocker = blockingAttempt(projectedAttempts(ledger, fields.shot_index));
  return {
    ready: !blocker,
    duplicate: false,
    conflict: !!blocker,
    idempotency_key: key,
    blocking_attempt: blocker,
  };
}

function claimAttempt(storage, input = {}) {
  requireStorage(storage);
  const fields = idempotencyFields(input);
  const claim = projectClaim(storage, fields);
  if (!claim.ready) return { claimed: false, ...claim };
  const ledger = readLedger(storage, fields.task_id);
  // Storage outputs are synchronous in the current service. Recheck after the
  // read-only projection so duplicate calls in the same process remain safe.
  const repeated = ledger.headers.find(header => header.idempotency_key === claim.idempotency_key);
  if (repeated) {
    return {
      claimed: false,
      ready: false,
      duplicate: true,
      conflict: false,
      idempotency_key: claim.idempotency_key,
      attempt: projectAttempt(repeated, eventsForAttempt(ledger, repeated.attempt_id)),
    };
  }
  const now = clean(input.at || input.now || new Date().toISOString(), 40);
  const attemptId = `va_${claim.idempotency_key.slice(0, 24)}`;
  const header = Object.freeze({
    attempt_id: attemptId,
    idempotency_key: claim.idempotency_key,
    task_id: fields.task_id,
    shot_index: fields.shot_index,
    generation_id: fields.generation_id,
    lineage_fingerprint: fields.lineage_fingerprint,
    provider_id: fields.provider_id,
    model_id: fields.model_id,
    cost_fingerprint: fields.cost_fingerprint,
    sequence: ledger.headers.length + 1,
    claimed_at: now,
    created_at: now,
  });
  const event = Object.freeze({
    event_id: `vae_${sha256(`${attemptId}:claimed`).slice(0, 24)}`,
    attempt_id: attemptId,
    type: 'claimed',
    sequence: ledger.events.length + 1,
    at: now,
  });
  const next = {
    ...ledger,
    task_id: fields.task_id,
    headers: [...ledger.headers, header],
    events: [...ledger.events, event],
  };
  storage.saveOutput(fields.task_id, OUTPUT_KIND, next);
  return {
    claimed: true,
    ready: true,
    duplicate: false,
    conflict: false,
    idempotency_key: claim.idempotency_key,
    attempt: projectAttempt(header, [event]),
  };
}

function comparableEvent(event = {}) {
  const copy = { ...event };
  delete copy.sequence;
  return JSON.stringify(copy);
}

function appendEvent(storage, input = {}) {
  requireStorage(storage);
  const taskId = clean(input.taskId ?? input.task_id, 160);
  const attemptId = clean(input.attemptId ?? input.attempt_id, 160);
  const type = clean(input.type, 60);
  const eventKey = clean(input.eventId ?? input.event_id ?? input.eventKey ?? input.event_key, 240);
  if (!taskId || !attemptId || !EVENT_TYPES.has(type) || !eventKey) {
    throw fail('attempt event 缺少 taskId、attemptId、合法 type 或幂等 eventKey', 'VIDEO_ATTEMPT_EVENT_INPUT_REQUIRED', 422);
  }
  const ledger = readLedger(storage, taskId);
  const header = ledger.headers.find(item => item.attempt_id === attemptId);
  if (!header) throw fail('attempt event 对应的 header 不存在', 'VIDEO_ATTEMPT_NOT_FOUND', 404);
  const eventId = clean(input.eventId ?? input.event_id, 160)
    || `vae_${sha256(`${attemptId}:${type}:${eventKey}`).slice(0, 24)}`;
  const event = {
    event_id: eventId,
    attempt_id: attemptId,
    type,
    at: clean(input.at || new Date().toISOString(), 40),
    provider_task_id: clean(input.providerTaskId ?? input.provider_task_id, 200),
    provider_status: clean(input.providerStatus ?? input.provider_status, 120),
    provider_submission_state: clean(input.providerSubmissionState ?? input.provider_submission_state, 40),
    billing_state: clean(input.billingState ?? input.billing_state, 40),
    requested_video_seconds: Math.max(0, Number(input.requestedVideoSeconds ?? input.requested_video_seconds) || 0),
    error_code: clean(input.errorCode ?? input.error_code, 160),
    error_message: clean(input.errorMessage ?? input.error_message, 1000),
  };
  const existing = ledger.events.find(item => item.event_id === eventId);
  if (existing) {
    if (comparableEvent(existing) !== comparableEvent(event)) {
      throw fail('同一 attempt event_id 对应了不同内容', 'VIDEO_ATTEMPT_EVENT_ID_CONFLICT', 409);
    }
    return { appended: false, duplicate: true, event: existing, attempt: projectAttempt(header, eventsForAttempt(ledger, attemptId)) };
  }
  event.sequence = ledger.events.length + 1;
  storage.saveOutput(taskId, OUTPUT_KIND, { ...ledger, events: [...ledger.events, event] });
  return {
    appended: true,
    duplicate: false,
    event,
    attempt: projectAttempt(header, [...eventsForAttempt(ledger, attemptId), event]),
  };
}

function createVideoAttemptStore(storage) {
  requireStorage(storage);
  return {
    read: taskId => readLedger(storage, taskId),
    buildIdempotencyKey,
    projectClaim: input => projectClaim(storage, input),
    claim: input => claimAttempt(storage, input),
    appendEvent: input => appendEvent(storage, input),
    projectCurrentAndLast: input => projectCurrentAndLast(storage, input),
  };
}

module.exports = {
  OUTPUT_KIND,
  STORE_VERSION,
  EVENT_TYPES,
  appendEvent,
  buildIdempotencyKey,
  claimAttempt,
  createVideoAttemptStore,
  projectAttempt,
  projectClaim,
  projectCurrentAndLast,
  readLedger,
};
