const { cleanText } = require('./contextBuilder');

const DEFAULT_MAX_AUTO_REPAIRS = 1;
const HARD_MAX_AUTO_REPAIRS = 3;
const NON_AUTOMATIC_REPAIR_DIMENSIONS = new Set([
  'people_count',
  'input_person_privacy',
  'content_safety',
  'provider_auth',
  'provider_billing',
]);

function resolveRepairBudget(options = {}) {
  if (options.auto_repair === false || options.autoRepair === false || process.env.NEW_STORY_AD_VIDEO_AUTO_REPAIR === '0') return 0;
  const requested = Number(options.max_auto_repairs ?? options.maxAutoRepairs ?? process.env.NEW_STORY_AD_VIDEO_MAX_AUTO_REPAIRS ?? DEFAULT_MAX_AUTO_REPAIRS);
  return Math.max(0, Math.min(HARD_MAX_AUTO_REPAIRS, Number.isFinite(requested) ? Math.round(requested) : DEFAULT_MAX_AUTO_REPAIRS));
}

function normalizeFailure(item = {}) {
  const dimensions = [...new Set(Array.isArray(item.dimensions) ? item.dimensions.filter(Boolean) : [])];
  const hasDeterministicFailure = dimensions.some(dimension => NON_AUTOMATIC_REPAIR_DIMENSIONS.has(String(dimension).toLowerCase()));
  return {
    index: Math.max(0, Number(item.index) || 0),
    kind: String(item.kind || 'frame_qa'),
    dimensions,
    labels_zh: [...new Set(Array.isArray(item.labels_zh) ? item.labels_zh.filter(Boolean) : [])],
    problems: [...new Set(Array.isArray(item.problems) ? item.problems.map(value => cleanText(value, 300)).filter(Boolean) : [])],
    retry_instruction: cleanText(item.retry_instruction || '', 1000),
    repairable: item.repairable !== false
      && !hasDeterministicFailure
      && ['frame_qa', 'cross_shot_qa'].includes(String(item.kind || 'frame_qa')),
  };
}

function mergeFailures(failures = []) {
  const byIndex = new Map();
  failures.map(normalizeFailure).forEach((item) => {
    const current = byIndex.get(item.index) || { ...item, dimensions: [], labels_zh: [], problems: [], retry_instruction: '', repairable: true };
    current.dimensions = [...new Set([...current.dimensions, ...item.dimensions])];
    current.labels_zh = [...new Set([...current.labels_zh, ...item.labels_zh])];
    current.problems = [...new Set([...current.problems, ...item.problems])];
    current.retry_instruction = [current.retry_instruction, item.retry_instruction].filter(Boolean).join('\n');
    current.repairable = current.repairable && item.repairable;
    current.kind = current.kind === item.kind ? current.kind : 'combined_qa';
    byIndex.set(item.index, current);
  });
  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

function repairInstruction(failure = {}) {
  const item = normalizeFailure(failure);
  return [
    'Regenerate this shot from its current approved keyframe and current task contracts.',
    item.dimensions.length ? `Failed QA dimensions: ${item.dimensions.join(', ')}.` : '',
    item.problems.length ? `Observed problems: ${item.problems.join('; ')}.` : '',
    item.retry_instruction ? `Inspector instruction: ${item.retry_instruction}` : '',
    'Preserve every current-task identity, product, scene, continuity, camera, action and speech constraint that was not identified as failing. Do not invent new content.',
  ].filter(Boolean).join('\n');
}

function buildRepairPlan(failures = [], { attempt = 0, maxAttempts = DEFAULT_MAX_AUTO_REPAIRS } = {}) {
  const merged = mergeFailures(failures);
  const repairable = merged.filter(item => item.repairable);
  const canRetry = attempt < maxAttempts && repairable.length === merged.length && repairable.length > 0;
  return {
    can_retry: canRetry,
    attempt,
    next_attempt: attempt + 1,
    max_attempts: maxAttempts,
    indexes: canRetry ? repairable.map(item => item.index) : [],
    instructions: Object.fromEntries(repairable.map(item => [item.index, repairInstruction(item)])),
    failures: merged,
  };
}

module.exports = { DEFAULT_MAX_AUTO_REPAIRS, HARD_MAX_AUTO_REPAIRS, NON_AUTOMATIC_REPAIR_DIMENSIONS, resolveRepairBudget, normalizeFailure, mergeFailures, repairInstruction, buildRepairPlan };
