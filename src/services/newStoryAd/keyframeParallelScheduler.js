const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 3;

function falseLike(value) {
  return ['0', 'false', 'off', 'no', 'disabled'].includes(String(value ?? '').trim().toLowerCase());
}

function resolveConcurrency(options = {}, targetCount = 0, env = process.env) {
  const enabledOption = options.parallel_keyframes ?? options.parallelKeyframes;
  const enabledEnv = env.NEW_STORY_AD_KEYFRAME_PARALLEL;
  if (enabledOption === false || falseLike(enabledOption) || falseLike(enabledEnv)) return 1;
  const raw = options.keyframe_concurrency
    ?? options.keyframeConcurrency
    ?? env.NEW_STORY_AD_KEYFRAME_CONCURRENCY
    ?? DEFAULT_CONCURRENCY;
  const requested = Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : DEFAULT_CONCURRENCY;
  const bounded = Math.max(1, Math.min(MAX_CONCURRENCY, requested || DEFAULT_CONCURRENCY));
  return Math.max(1, Math.min(bounded, Math.max(1, Number(targetCount) || 1)));
}

function isThrottleError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  return code === '429'
    || /RATE.?LIMIT|TOO_MANY_REQUESTS|CONCURRENCY_LIMIT|PROVIDER_BUSY|THROTTL/i.test(code)
    || /(?:HTTP\s*)?429|too many requests|rate.?limit|concurrenc(?:y|ies).*(?:limit|exceed)|provider.*busy|请求过于频繁|并发.*(?:超限|限制)|限流/i.test(message);
}

async function runSchedule({
  indexes = [],
  concurrency = DEFAULT_CONCURRENCY,
  snapshot = () => null,
  dependencyOf = () => null,
  externalDependencyUsable = () => true,
  worker,
  onWaveStart = null,
  onWaveComplete = null,
} = {}) {
  if (typeof worker !== 'function') throw new TypeError('keyframe schedule worker is required');
  const pending = Array.isArray(indexes) ? indexes.slice() : [];
  const targetSet = new Set(pending);
  const completed = new Set();
  const resultByIndex = new Map();
  const throttleRetries = new Map();
  const configuredConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Number(concurrency) || 1));
  let effectiveConcurrency = configuredConcurrency;
  const results = [];
  const waves = [];
  const active = new Map();
  let fatalError = null;

  function removePending(indexesToRemove) {
    const removing = new Set(indexesToRemove);
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (removing.has(pending[i])) pending.splice(i, 1);
    }
  }

  function readyIndexes() {
    return pending.filter(index => {
      const dependency = dependencyOf(index);
      return !Number.isInteger(dependency) || !targetSet.has(dependency) || completed.has(dependency);
    });
  }

  function blockFailedDependencies() {
    let blockedAny = false;
    while (true) {
      const blocked = [];
      for (const index of pending.slice()) {
        const dependency = dependencyOf(index);
        if (!Number.isInteger(dependency)) continue;
        if (targetSet.has(dependency)) {
          const parent = resultByIndex.get(dependency);
          if (parent && parent.usable !== true) blocked.push({ index, dependency, reason: 'dependency_failed' });
        } else if (!externalDependencyUsable(dependency)) {
          blocked.push({ index, dependency, reason: 'dependency_unavailable' });
        }
      }
      if (!blocked.length) break;
      blockedAny = true;
      removePending(blocked.map(item => item.index));
      const values = blocked.map(item => ({ ...item, blocked: true, failed: true, usable: false }));
      values.forEach(value => {
        completed.add(value.index);
        resultByIndex.set(value.index, value);
        results.push(value);
      });
      waves.push({
        kind: 'blocked', indexes: values.map(item => item.index), concurrency: 0,
        wave_size: values.length, actual_concurrency: 0, results: values,
      });
    }
    return blockedAny;
  }

  async function startReadyWork() {
    if (fatalError) return 0;
    const slots = Math.max(0, effectiveConcurrency - active.size);
    if (!slots) return 0;
    const batch = readyIndexes().slice(0, slots);
    if (!batch.length) return 0;
    removePending(batch);
    const startedMs = Date.now();
    const activeBefore = active.size;
    const frozenSnapshot = snapshot();
    const kind = effectiveConcurrency <= 1
      ? 'sequential'
      : (batch.length > 1 ? 'parallel' : (activeBefore > 0 ? 'rolling' : 'sequential'));
    const waveMeta = {
      kind,
      indexes: batch.slice(),
      concurrency: effectiveConcurrency,
      wave_number: waves.length + 1,
      started_at: new Date(startedMs).toISOString(),
    };
    const waveRecord = {
      ...waveMeta,
      wave_size: batch.length,
      actual_concurrency: Math.min(effectiveConcurrency, activeBefore + batch.length),
      results: [],
    };
    const waveState = { record: waveRecord, remaining: new Set(batch), values: new Map(), startedMs };
    waves.push(waveRecord);
    if (typeof onWaveStart === 'function') await onWaveStart(waveMeta);
    batch.forEach(index => {
      const promise = Promise.resolve()
        .then(() => worker(index, {
          ...waveMeta,
          dependency_index: dependencyOf(index),
          throttle_retry: (throttleRetries.get(index) || 0) > 0,
          snapshot: frozenSnapshot,
        }))
        .then(
          value => ({ index, value, rejected: false, waveState }),
          reason => ({ index, reason, rejected: true, waveState }),
        );
      active.set(index, promise);
    });
    return batch.length;
  }

  async function finishWork(envelope) {
    const { index, rejected, reason, waveState } = envelope;
    active.delete(index);
    const value = rejected ? {
      index, failed: true, usable: false, fatal: true,
      error: String(reason?.message || reason || 'worker rejected'),
      error_code: reason?.code || 'WORKER_REJECTED',
    } : envelope.value;
    waveState.remaining.delete(index);
    waveState.values.set(index, value);

    if (rejected) {
      completed.add(index);
      resultByIndex.set(index, value);
      results.push(value);
      fatalError ||= reason;
    } else if (value?.retry_required === true && Number.isInteger(Number(value.index)) && (throttleRetries.get(index) || 0) < 1) {
      throttleRetries.set(index, 1);
      pending.push(index);
      effectiveConcurrency = 1;
    } else {
      completed.add(index);
      resultByIndex.set(index, value);
      results.push(value);
    }

    if (value?.throttled === true || value?.force_sequential === true) effectiveConcurrency = 1;
    if (!waveState.remaining.size) {
      const finishedMs = Date.now();
      waveState.record.results = waveState.record.indexes.map(item => waveState.values.get(item));
      waveState.record.finished_at = new Date(finishedMs).toISOString();
      waveState.record.duration_ms = finishedMs - waveState.startedMs;
      if (typeof onWaveComplete === 'function') {
        await onWaveComplete({ ...waveState.record, effective_concurrency: effectiveConcurrency });
      }
    }
  }

  while (pending.length || active.size) {
    blockFailedDependencies();
    if (!fatalError) await startReadyWork();

    if (!active.size) {
      if (fatalError) break;
      if (!pending.length) break;
      if (readyIndexes().length) continue;
      // A malformed/cyclic plan must fail closed instead of silently generating
      // without its continuity reference.
      const unresolved = pending.splice(0).map(index => ({
        index,
        dependency: dependencyOf(index),
        reason: 'dependency_cycle',
        blocked: true,
        failed: true,
        usable: false,
      }));
      unresolved.forEach(value => {
        completed.add(value.index);
        resultByIndex.set(value.index, value);
        results.push(value);
      });
      waves.push({
        kind: 'blocked', indexes: unresolved.map(item => item.index), concurrency: 0,
        wave_size: unresolved.length, actual_concurrency: 0, results: unresolved,
      });
      break;
    }

    const envelope = await Promise.race(active.values());
    try {
      await finishWork(envelope);
    } catch (error) {
      fatalError ||= error;
    }
  }

  if (fatalError) {
    fatalError.partial_schedule = { results: results.slice(), waves: waves.slice() };
    throw fatalError;
  }
  return {
    results,
    waves,
    configured_concurrency: configuredConcurrency,
    effective_concurrency: effectiveConcurrency,
    throttle_retries: Object.fromEntries(throttleRetries),
  };
}

module.exports = {
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  resolveConcurrency,
  isThrottleError,
  runSchedule,
};
