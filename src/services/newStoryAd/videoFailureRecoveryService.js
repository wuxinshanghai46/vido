/** 计算失败后必须恢复的镜头：提交前/生成失败恢复当前单元，质检失败只保护尚未运行的后续单元。 */
function rollbackIndexes({ generationError = null, unitIndexes = [], remainingUnits = [] } = {}) {
  const remainingIndexes = (Array.isArray(remainingUnits) ? remainingUnits : []).flatMap(item => item?.member_indexes || []);
  return generationError
    ? [...new Set([...(Array.isArray(unitIndexes) ? unitIndexes : []), ...remainingIndexes])]
    : [...new Set(remainingIndexes)];
}

/** 把失败单元恢复到提交前快照，避免准备素材或供应商拒绝时覆盖已经付费生成的历史片段。 */
function restorePreviousClips({ clips = [], previousClips = [], indexes = [] } = {}) {
  (Array.isArray(indexes) ? indexes : []).forEach(index => { clips[index] = previousClips[index] || clips[index] || null; });
  return clips;
}

module.exports = { rollbackIndexes, restorePreviousClips };
