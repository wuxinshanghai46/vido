'use strict';

function list(value) { return Array.isArray(value) ? value : []; }
function shotIndex(shot = {}, index = 0) { return Number(shot.shot_index || shot.index || index + 1) || index + 1; }

function selectedIndexes(options = {}) {
  const source = options.target_indexes || options.targetIndexes;
  return [...new Set(list(source).map(Number).filter(value => Number.isInteger(value) && value > 0))]
    .sort((left, right) => left - right);
}

function select({ shots = [], existing = [], confirmation = {}, options = {} } = {}) {
  const all = list(shots).map(shotIndex);
  const explicit = selectedIndexes(options);
  if (explicit.length) {
    const known = new Set(all);
    const missing = explicit.filter(index => !known.has(index));
    if (missing.length) {
      const error = new Error(`没有找到选中的分镜：${missing.join('、')}`);
      error.status = 400;
      error.code = 'STORYBOARD_TARGET_INDEX_INVALID';
      error.details = { missing_indexes: missing };
      throw error;
    }
    return explicit;
  }
  if (options.regenerate_all === true || options.regenerateAll === true) return all;
  const existingByShot = new Map(list(existing).map(item => [Number(item.shot_index), item]));
  const stale = new Set(list(confirmation.stale_indexes).map(Number));
  return all.filter(index => !existingByShot.get(index)?.image_url || stale.has(index));
}

module.exports = { select, selectedIndexes, shotIndex };
