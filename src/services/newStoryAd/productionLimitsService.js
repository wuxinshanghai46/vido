const MIN_TARGET_DURATION = 10;
const MAX_TARGET_DURATION = 600;
const MAX_SHOT_COUNT = 120;
const MAX_AUTO_BLUEPRINT_BEATS = 18;
const MAX_SHOT_DURATION = 6;

function targetDuration(value, fallback = 30) {
  return Math.max(MIN_TARGET_DURATION, Math.min(MAX_TARGET_DURATION, Math.round(Number(value) || fallback)));
}

function shotCount(value, fallback = 0) {
  const count = Math.round(Number(value) || fallback);
  return count > 0 ? Math.max(1, Math.min(MAX_SHOT_COUNT, count)) : 0;
}

function requiredStoryboardShotCount(duration, existingCount = 0) {
  return Math.max(
    Math.max(1, Math.min(MAX_SHOT_COUNT, Math.round(Number(existingCount) || 1))),
    Math.min(MAX_SHOT_COUNT, Math.ceil(targetDuration(duration) / MAX_SHOT_DURATION)),
  );
}

function longFormStageBudgetMs(stage = '', duration = 30, existingShotCount = 0) {
  const target = targetDuration(duration);
  const count = requiredStoryboardShotCount(target, existingShotCount);
  const budgetsMinutes = {
    script_package: Math.max(20, 12 + Math.ceil(count / 8) * 4),
    storyboard: Math.max(15, 8 + Math.ceil(count / 8) * 4),
    tts: Math.max(15, 5 + count),
    video: Math.max(30, 20 + count * 6),
    compose: Math.max(15, 10 + Math.ceil(target / 10)),
  };
  return Math.min(12 * 60 * 60 * 1000, Number(budgetsMinutes[stage] || 20) * 60 * 1000);
}

module.exports = {
  MIN_TARGET_DURATION,
  MAX_TARGET_DURATION,
  MAX_SHOT_COUNT,
  MAX_AUTO_BLUEPRINT_BEATS,
  MAX_SHOT_DURATION,
  targetDuration,
  shotCount,
  requiredStoryboardShotCount,
  longFormStageBudgetMs,
};
