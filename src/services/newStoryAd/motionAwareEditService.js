const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const cancellation = require('./cancellationContext');

const POLICY_VERSION = 'motion-aware-edit-v1';
const FRAME_WIDTH = 96;
const FRAME_HEIGHT = 54;
const FRAME_BYTES = FRAME_WIDTH * FRAME_HEIGHT;
const analysisCache = new Map();
let analysisRunCount = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function extractGrayFrames(filePath, { startSec = 0, durationSec = 1, fps = 5 } = {}) {
  if (!ffmpegPath || !filePath || !fs.existsSync(filePath)) return Promise.resolve([]);
  const safeFps = clamp(fps, 1, 12);
  const safeDuration = Math.max(0.2, Number(durationSec) || 1);
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-ss', String(Math.max(0, Number(startSec) || 0)), '-t', String(safeDuration),
      '-i', filePath, '-an', '-vf', `fps=${safeFps},scale=${FRAME_WIDTH}:${FRAME_HEIGHT},format=gray`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ];
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    const signal = cancellation.signal();
    const chunks = [];
    let stderr = '';
    let timedOut = false;
    const abort = () => child.kill('SIGKILL');
    const timer = setTimeout(() => { timedOut = true; abort(); }, 60000);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(signal.reason || new Error('Motion analysis aborted'));
      if (timedOut) return reject(new Error('Motion analysis timed out after 60 seconds'));
      if (code !== 0) return reject(new Error(stderr || `motion analysis exited ${code}`));
      const raw = Buffer.concat(chunks);
      const frames = [];
      for (let offset = 0; offset + FRAME_BYTES <= raw.length; offset += FRAME_BYTES) {
        frames.push(raw.subarray(offset, offset + FRAME_BYTES));
      }
      return resolve(frames);
    });
  });
}

function meanAbsoluteDifference(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return null;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

async function analyzeMotionSamples(filePath, { startSec = 0, durationSec = 1, fps = 5 } = {}) {
  const stat = filePath && fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const cacheKey = stat ? `${filePath}|${stat.size}|${stat.mtimeMs}|${startSec}|${durationSec}|${fps}` : '';
  if (cacheKey && analysisCache.has(cacheKey)) {
    return { ...(await analysisCache.get(cacheKey)), cache_hit: true };
  }
  const compute = (async () => {
    analysisRunCount += 1;
    const frames = await extractGrayFrames(filePath, { startSec, durationSec, fps });
  const samples = [];
  for (let i = 1; i < frames.length; i += 1) {
    const score = meanAbsoluteDifference(frames[i - 1], frames[i]);
    if (score === null) continue;
    samples.push({
      second: Number((Number(startSec || 0) + i / fps).toFixed(3)),
      motion_score: Number(score.toFixed(6)),
    });
  }
  return {
    policy_version: POLICY_VERSION,
    method: 'grayscale_mean_absolute_frame_difference',
    fps,
    frame_count: frames.length,
    samples,
    cache_hit: false,
  };
  })();
  if (cacheKey) {
    analysisCache.set(cacheKey, compute);
    while (analysisCache.size > 16) analysisCache.delete(analysisCache.keys().next().value);
  }
  try {
    return await compute;
  } catch (error) {
    if (cacheKey) analysisCache.delete(cacheKey);
    throw error;
  }
}

function clearAnalysisCacheForTest() {
  analysisCache.clear();
  analysisRunCount = 0;
}

function analysisStats() {
  return { analysis_run_count: analysisRunCount, cache_entry_count: analysisCache.size };
}

function boundaryScore(samples = [], second = 0, radiusSec = 0.28) {
  const nearby = samples.filter(item => Math.abs(Number(item.second) - second) <= radiusSec);
  if (!nearby.length) return null;
  return nearby.reduce((sum, item) => sum + Number(item.motion_score || 0), 0) / nearby.length;
}

function isFrozenCandidate(samples = [], second = 0, { radiusSec = 0.45, threshold = 0.0015 } = {}) {
  const nearby = samples.filter(item => Math.abs(Number(item.second) - second) <= radiusSec);
  if (nearby.length < 3) return false;
  const span = Number(nearby[nearby.length - 1].second) - Number(nearby[0].second);
  return span >= radiusSec && nearby.every(item => Number(item.motion_score || 0) <= threshold);
}

async function selectSafeCutPoints({
  filePath = '', beats = [], searchWindowSec = 0.8, fps = 6, minimumBeatSec = 1,
  motionSamples = null, analyzeMotion = analyzeMotionSamples,
} = {}) {
  const source = Array.isArray(beats) ? beats.map(beat => ({ ...beat })) : [];
  const injectedSamples = Array.isArray(motionSamples);
  if (source.length < 2 || (!injectedSamples && (!filePath || !fs.existsSync(filePath)))) {
    return {
      beats: source,
      evidence: { policy_version: POLICY_VERSION, method: 'planned_boundary_fallback', boundaries: [], fallback_reason: 'source_or_boundaries_missing' },
    };
  }
  const totalDuration = Math.max(...source.map(beat => Number(beat.end_sec || 0)));
  const analysis = injectedSamples
    ? { policy_version: POLICY_VERSION, method: 'injected_motion_samples', fps, frame_count: motionSamples.length + 1, samples: motionSamples }
    : await analyzeMotion(filePath, { startSec: 0, durationSec: totalDuration, fps });
  const selectedCuts = [];
  const boundaries = [];
  for (let index = 0; index < source.length - 1; index += 1) {
    const planned = Number(source[index].end_sec || 0);
    const previousCut = selectedCuts[index - 1] || 0;
    const nextPlanned = Number(source[index + 1].end_sec || totalDuration);
    const searchStart = Math.max(previousCut + minimumBeatSec, planned - Math.max(0.2, searchWindowSec));
    const searchEnd = Math.min(totalDuration - minimumBeatSec, planned + Math.max(0.2, searchWindowSec), nextPlanned - minimumBeatSec);
    const candidates = analysis.samples
      .filter(item => item.second >= searchStart && item.second <= searchEnd)
      .map(item => ({
        second: Number(item.second),
        score: boundaryScore(analysis.samples, Number(item.second)),
        frozen: isFrozenCandidate(analysis.samples, Number(item.second)),
      }))
      .filter(item => Number.isFinite(item.score))
      .filter(item => !item.frozen)
      .sort((a, b) => a.score - b.score || b.second - a.second);
    const plannedScore = boundaryScore(analysis.samples, planned);
    const best = candidates[0] || null;
    const useBest = !!best && (plannedScore === null || best.score <= plannedScore * 0.92);
    const selected = useBest ? best.second : planned;
    selectedCuts.push(selected);
    boundaries.push({
      boundary_index: index + 1,
      planned_sec: planned,
      selected_sec: selected,
      shift_sec: Number((selected - planned).toFixed(3)),
      shift_direction: selected < planned ? 'earlier' : (selected > planned ? 'later' : 'unchanged'),
      planned_motion_score: plannedScore === null ? null : Number(plannedScore.toFixed(6)),
      selected_motion_score: best ? Number(best.score.toFixed(6)) : null,
      used_fallback: !useBest,
      fallback_reason: useBest ? '' : (best ? 'no_material_stability_gain' : 'insufficient_motion_samples'),
      candidate_count: candidates.length,
      frozen_candidates_excluded: analysis.samples.filter(item => item.second >= searchStart && item.second <= searchEnd && isFrozenCandidate(analysis.samples, Number(item.second))).length,
    });
  }
  const cuts = [0, ...selectedCuts, totalDuration];
  const adjusted = source.map((beat, index) => ({
    ...beat,
    planned_start_sec: Number(beat.start_sec || 0),
    planned_end_sec: Number(beat.end_sec || 0),
    start_sec: cuts[index],
    end_sec: cuts[index + 1],
    duration_sec: Number((cuts[index + 1] - cuts[index]).toFixed(3)),
  }));
  return {
    beats: adjusted,
    evidence: {
      policy_version: POLICY_VERSION,
      method: analysis.method,
      fps: analysis.fps,
      analyzed_frame_count: analysis.frame_count,
      analysis_cache_hit: analysis.cache_hit === true,
      planned_duration_sec: totalDuration,
      boundaries,
    },
  };
}

function chooseRepresentativeTimes(samples = [], durationSec = 0, limit = 5) {
  const duration = Math.max(0.2, Number(durationSec) || 0.2);
  const count = Math.max(2, Math.min(8, Number(limit) || 5));
  const selected = new Set([0, Number(Math.max(0, duration - 0.05).toFixed(3))]);
  const uniformSlots = Math.max(0, Math.floor((count - 2) / 2));
  for (let i = 1; i <= uniformSlots; i += 1) selected.add(Number((duration * i / (uniformSlots + 1)).toFixed(3)));
  const peaks = [...samples].sort((a, b) => Number(b.motion_score || 0) - Number(a.motion_score || 0));
  for (const peak of peaks) {
    if (selected.size >= count) break;
    selected.add(Number(clamp(peak.second, 0, duration - 0.05).toFixed(3)));
  }
  for (let i = 1; selected.size < count && i < count * 2; i += 1) {
    selected.add(Number((duration * i / (count * 2)).toFixed(3)));
  }
  return [...selected].sort((a, b) => a - b).slice(0, count);
}

module.exports = {
  POLICY_VERSION,
  analyzeMotionSamples,
  clearAnalysisCacheForTest,
  analysisStats,
  boundaryScore,
  isFrozenCandidate,
  selectSafeCutPoints,
  chooseRepresentativeTimes,
};
