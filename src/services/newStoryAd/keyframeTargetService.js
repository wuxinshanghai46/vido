function requestedIndexes(shots = [], options = {}) {
  const onlyIndex = Number.isFinite(Number(options.only_index ?? options.onlyIndex))
    ? Number(options.only_index ?? options.onlyIndex)
    : null;
  const many = Array.isArray(options.only_indexes || options.onlyIndexes)
    ? (options.only_indexes || options.onlyIndexes)
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < shots.length)
    : null;
  if (many?.length) return [...new Set(many)];
  if (onlyIndex === null) return shots.map((_, index) => index);
  return [Math.max(0, Math.min(Math.max(0, shots.length - 1), onlyIndex))];
}

/**
 * 选择本次付费关键帧目标。
 * missing_only 保留给旧客户端，但语义必须与 missing_images_only 一样严格。
 */
function missingImagesOnly(options = {}) {
  return options.missing_images_only === true
    || options.missingImagesOnly === true
    || options.missing_only === true
    || options.missingOnly === true;
}

function qaRetryLimit(options = {}, requireVisualQa = false) {
  if (!requireVisualQa || missingImagesOnly(options)) return 0;
  return Math.max(0, Math.min(1, Number(options.max_scene_retries ?? options.maxSceneRetries ?? 1) || 0));
}

function select(shots = [], existing = [], options = {}, checks = {}) {
  const indexes = requestedIndexes(shots, options);
  if (missingImagesOnly(options)) return indexes.filter(index => !checks.hasImage(existing[index] || {}));
  const needsRegenerationOnly = options.needs_regeneration_only === true || options.needsRegenerationOnly === true;
  return needsRegenerationOnly
    ? indexes.filter(index => !checks.isCurrent(existing[index] || {}))
    : indexes;
}

module.exports = { requestedIndexes, missingImagesOnly, qaRetryLimit, select };
