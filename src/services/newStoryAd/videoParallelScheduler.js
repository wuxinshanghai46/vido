const DEFAULT_CONCURRENCY = 2;
const DEFAULT_MAX_CONCURRENCY = 4;
const HARD_MAX_CONCURRENCY = 4;
const DEFAULT_GLOBAL_CONCURRENCY = 4;
const videoCore = require('../videoGenerationCore');
const paidExecutionPolicy = require('./paidVideoExecutionPolicyService');

let globalActive = 0;
const globalQueue = [];

function falseLike(value) {
  return ['0', 'false', 'off', 'no', 'disabled'].includes(String(value ?? '').trim().toLowerCase());
}

function boundedInteger(value, fallback, min = 1, max = HARD_MAX_CONCURRENCY) {
  const parsed = Number.isFinite(Number(value)) ? Math.round(Number(value)) : fallback;
  return Math.max(min, Math.min(max, parsed || fallback));
}

function resolveConcurrency(options = {}, targetCount = 0, env = process.env) {
  const enabled = options.parallel_videos ?? options.parallelVideos ?? env.NEW_STORY_AD_VIDEO_PARALLEL;
  if (enabled === false || falseLike(enabled)) {
    return { configured: 1, maximum: 1, adaptive: false };
  }
  const configured = boundedInteger(
    options.video_concurrency ?? options.videoConcurrency ?? env.NEW_STORY_AD_VIDEO_CONCURRENCY,
    DEFAULT_CONCURRENCY,
  );
  const maximum = Math.max(configured, boundedInteger(
    options.video_max_concurrency ?? options.videoMaxConcurrency ?? env.NEW_STORY_AD_VIDEO_MAX_CONCURRENCY,
    DEFAULT_MAX_CONCURRENCY,
  ));
  const count = Math.max(1, Number(targetCount) || 1);
  return {
    configured: Math.min(configured, count),
    maximum: Math.min(maximum, count),
    adaptive: !falseLike(options.adaptive_video_concurrency ?? options.adaptiveVideoConcurrency ?? env.NEW_STORY_AD_VIDEO_ADAPTIVE ?? '1'),
  };
}

function isThrottleError(error) {
  const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
  const code = [error?.code, ...attempts.map(item => item?.code)].filter(Boolean).join(' ');
  const message = [error?.message || error || '', ...attempts.map(item => item?.error || '')].join(' ');
  return /429|RATE.?LIMIT|TOO_MANY_REQUESTS|CONCURRENCY_LIMIT|PROVIDER_BUSY|THROTTL/i.test(code)
    || /(?:HTTP\s*)?429|too many requests|rate.?limit|concurrenc(?:y|ies).*(?:limit|exceed)|provider.*busy|请求过于频繁|并发.*(?:超限|限制)|限流/i.test(message);
}

function globalLimit(env = process.env) {
  return boundedInteger(env.NEW_STORY_AD_VIDEO_GLOBAL_CONCURRENCY, DEFAULT_GLOBAL_CONCURRENCY, 1, 12);
}

function releaseGlobalSlot() {
  globalActive = Math.max(0, globalActive - 1);
  const next = globalQueue.shift();
  if (next) {
    globalActive += 1;
    next.resolve({ queuedMs: Date.now() - next.queuedAt, release: releaseGlobalSlot });
  }
}

function acquireGlobalSlot({ signal = null } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('video generation cancelled'));
  if (globalActive < globalLimit()) {
    globalActive += 1;
    return Promise.resolve({ queuedMs: 0, release: releaseGlobalSlot });
  }
  return new Promise((resolve, reject) => {
    const item = { resolve, reject, queuedAt: Date.now(), signal, onAbort: null };
    item.onAbort = () => {
      const index = globalQueue.indexOf(item);
      if (index >= 0) globalQueue.splice(index, 1);
      reject(signal.reason || new Error('video generation cancelled'));
    };
    signal?.addEventListener('abort', item.onAbort, { once: true });
    const originalResolve = item.resolve;
    item.resolve = value => {
      signal?.removeEventListener('abort', item.onAbort);
      originalResolve(value);
    };
    globalQueue.push(item);
  });
}

async function withGlobalSlot(worker, options = {}) {
  const slot = await acquireGlobalSlot(options);
  try {
    return await worker({ queuedMs: slot.queuedMs, globalActive, globalLimit: globalLimit() });
  } finally {
    slot.release();
  }
}

/** 按连续性依赖分波次执行镜头，并把所有持久化失败信息转换为中文。 */
async function runSchedule({
  indexes = [],
  dependencyOf = () => null,
  worker,
  options = {},
  signal = null,
  onWaveStart = null,
  onWaveComplete = null,
} = {}) {
  if (typeof worker !== 'function') throw new TypeError('视频并发计划缺少执行函数');
  const pending = Array.isArray(indexes) ? indexes.slice() : [];
  const targetSet = new Set(pending);
  const completed = new Set();
  const retryCounts = new Map();
  const results = [];
  const waves = [];
  const resolved = resolveConcurrency(options, pending.length);
  const allowThrottleRetry = !paidExecutionPolicy.isPaidExecution(options)
    && (options.allow_throttle_retry === true || options.allowThrottleRetry === true);
  let effective = resolved.configured;

  while (pending.length) {
    if (signal?.aborted) throw signal.reason || new Error('视频生成已取消');
    const ready = pending.filter(index => {
      const dependency = dependencyOf(index);
      return !Number.isInteger(dependency) || !targetSet.has(dependency) || completed.has(dependency);
    });
    if (!ready.length) {
      const error = new Error('视频镜头并发计划存在无法解析的连续性依赖');
      error.code = 'VIDEO_DEPENDENCY_CYCLE';
      throw error;
    }
    const batch = ready.slice(0, effective);
    batch.forEach(index => pending.splice(pending.indexOf(index), 1));
    const startedAt = Date.now();
    const wave = {
      wave_number: waves.length + 1,
      indexes: batch.slice(),
      concurrency: effective,
      configured_concurrency: resolved.configured,
      max_concurrency: resolved.maximum,
      started_at: new Date(startedAt).toISOString(),
    };
    waves.push(wave);
    if (typeof onWaveStart === 'function') await onWaveStart({ ...wave });

    const settled = await Promise.all(batch.map(index => withGlobalSlot(
      slot => worker(index, { ...wave, dependency_index: dependencyOf(index), global_queue_ms: slot.queuedMs }),
      { signal },
    ).then(
      value => ({ index, status: 'fulfilled', value }),
      reason => ({ index, status: 'rejected', reason }),
    )));

    let fatal = null;
    let throttled = false;
    for (const item of settled) {
      if (item.status === 'fulfilled') {
        completed.add(item.index);
        results.push({ index: item.index, value: item.value, ok: true });
        continue;
      }
      if (allowThrottleRetry && isThrottleError(item.reason) && (retryCounts.get(item.index) || 0) < 1) {
        retryCounts.set(item.index, 1);
        pending.unshift(item.index);
        throttled = true;
        effective = 1;
        results.push({ index: item.index, ok: false, throttled: true, retry_scheduled: true, error: videoCore.chineseError.classifyChineseMessage(item.reason, '供应商并发受限，已降低并发后重试。') });
      } else {
        fatal ||= item.reason;
        results.push({ index: item.index, ok: false, error: videoCore.chineseError.classifyChineseMessage(item.reason), error_code: item.reason?.code || '' });
      }
    }

    wave.finished_at = new Date().toISOString();
    wave.duration_ms = Date.now() - startedAt;
    wave.throttled = throttled;
    wave.results = settled.map(item => ({ index: item.index, status: item.status, error: item.status === 'rejected' ? videoCore.chineseError.classifyChineseMessage(item.reason) : '' }));
    if (!fatal && !throttled && resolved.adaptive && effective < resolved.maximum) effective += 1;
    wave.next_concurrency = effective;
    if (typeof onWaveComplete === 'function') await onWaveComplete({ ...wave });

    if (fatal) {
      fatal.partial_schedule = { results: results.slice(), waves: waves.slice() };
      throw fatal;
    }
  }

  return {
    results,
    waves,
    configured_concurrency: resolved.configured,
    effective_concurrency: effective,
    max_concurrency: resolved.maximum,
    throttle_retries: Object.fromEntries(retryCounts),
  };
}

function snapshotGlobalState() {
  return { active: globalActive, queued: globalQueue.length, limit: globalLimit() };
}

module.exports = {
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_CONCURRENCY,
  HARD_MAX_CONCURRENCY,
  resolveConcurrency,
  isThrottleError,
  runSchedule,
  snapshotGlobalState,
};
