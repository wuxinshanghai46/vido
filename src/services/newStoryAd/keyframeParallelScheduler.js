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

  async function runWave(wave, kind = 'parallel') {
    const waveStartedMs = Date.now();
    const frozenSnapshot = snapshot();
    const waveMeta = {
      kind,
      indexes: wave.slice(),
      concurrency: effectiveConcurrency,
      wave_number: waves.length + 1,
      started_at: new Date(waveStartedMs).toISOString(),
    };
    if (typeof onWaveStart === 'function') await onWaveStart(waveMeta);
    const settled = await Promise.allSettled(wave.map(index => worker(index, {
      ...waveMeta,
      dependency_index: dependencyOf(index),
      throttle_retry: (throttleRetries.get(index) || 0) > 0,
      snapshot: frozenSnapshot,
    })));
    const rejected = settled.find(item => item.status === 'rejected');
    const values = settled.map((item, position) => item.status === 'fulfilled' ? item.value : ({
      index: wave[position], failed: true, usable: false, fatal: true,
      error: String(item.reason?.message || item.reason || 'worker rejected'),
      error_code: item.reason?.code || 'WORKER_REJECTED',
    }));
    values.forEach((value, position) => {
      const index = Number(value?.index);
      if (settled[position]?.status === 'rejected') {
        if (Number.isInteger(index)) {
          completed.add(index);
          resultByIndex.set(index, value);
        }
        results.push(value);
        return;
      }
      if (value?.retry_required === true && Number.isInteger(index) && (throttleRetries.get(index) || 0) < 1) {
        throttleRetries.set(index, 1);
        pending.push(index);
        effectiveConcurrency = 1;
        return;
      }
      if (Number.isInteger(index)) {
        completed.add(index);
        resultByIndex.set(index, value);
      }
      results.push(value);
    });
    const waveFinishedMs = Date.now();
    const completedWave = {
      ...waveMeta,
      results: values,
      wave_size: wave.length,
      actual_concurrency: wave.length,
      finished_at: new Date(waveFinishedMs).toISOString(),
      duration_ms: waveFinishedMs - waveStartedMs,
    };
    waves.push(completedWave);
    if (values.some(value => value?.throttled === true || value?.force_sequential === true)) {
      effectiveConcurrency = 1;
    }
    if (typeof onWaveComplete === 'function') {
      await onWaveComplete({ ...completedWave, effective_concurrency: effectiveConcurrency });
    }
    if (rejected) {
      rejected.reason.partial_schedule = { results: results.slice(), waves: waves.slice() };
      throw rejected.reason;
    }
  }

  while (pending.length) {
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
    if (blocked.length) {
      const blockedSet = new Set(blocked.map(item => item.index));
      for (let i = pending.length - 1; i >= 0; i -= 1) {
        if (blockedSet.has(pending[i])) pending.splice(i, 1);
      }
      blocked.forEach(item => {
        const value = { ...item, blocked: true, failed: true, usable: false };
        completed.add(item.index);
        resultByIndex.set(item.index, value);
        results.push(value);
      });
      waves.push({ kind: 'blocked', indexes: blocked.map(item => item.index), concurrency: 0, results: blocked });
      continue;
    }
    const ready = pending.filter(index => {
      const dependency = dependencyOf(index);
      return !Number.isInteger(dependency) || !targetSet.has(dependency) || completed.has(dependency);
    });
    if (!ready.length) {
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
      waves.push({ kind: 'blocked', indexes: unresolved.map(item => item.index), concurrency: 0, results: unresolved });
      break;
    }
    const wave = ready.slice(0, Math.max(1, effectiveConcurrency));
    const waveSet = new Set(wave);
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (waveSet.has(pending[i])) pending.splice(i, 1);
    }
    await runWave(wave, effectiveConcurrency > 1 && wave.length > 1 ? 'parallel' : 'sequential');
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
