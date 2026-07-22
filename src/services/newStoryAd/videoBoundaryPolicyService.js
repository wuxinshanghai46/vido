function text(value = '') {
  return String(value || '').trim();
}

function sceneBlockId(clip = {}) {
  return text(clip.scene_block_id || clip.lineage?.scene_block_id);
}

function sameContinuousUnit(previous = {}, current = {}) {
  const previousBlock = sceneBlockId(previous);
  const currentBlock = sceneBlockId(current);
  if (previousBlock && currentBlock) return previousBlock === currentBlock;
  const previousSource = text(previous.scene_block_source_path || previous.source_video_path);
  const currentSource = text(current.scene_block_source_path || current.source_video_path);
  return !!(previousSource && currentSource && previousSource === currentSource);
}

function boundaryRequired(clips = [], index = 0) {
  return index > 0 && index < clips.length && !sameContinuousUnit(clips[index - 1] || {}, clips[index] || {});
}

function boundaryStatus(clips = [], index = 0) {
  if (!boundaryRequired(clips, index)) return { index, required: false, pass: true, status: 'same_generation_unit' };
  const qa = clips[index]?.cross_shot_qa;
  if (qa?.pass === true) return { index, required: true, pass: true, status: 'passed', qa };
  if (qa?.pass === false) return { index, required: true, pass: false, status: 'failed', qa };
  return { index, required: true, pass: false, status: 'missing', qa: null };
}

function audit(clips = [], shotCount = clips.length) {
  const scoped = Array.from({ length: Math.max(0, Number(shotCount) || 0) }, (_, index) => clips[index] || {});
  const boundaries = scoped.map((_, index) => boundaryStatus(scoped, index)).filter(item => item.required);
  const missing = boundaries.filter(item => item.status === 'missing');
  const failed = boundaries.filter(item => item.status === 'failed');
  return {
    ready: boundaries.every(item => item.pass),
    total: boundaries.length,
    passed: boundaries.filter(item => item.pass).length,
    missing_indexes: missing.map(item => item.index),
    failed_indexes: failed.map(item => item.index),
    unready_indexes: boundaries.filter(item => !item.pass).map(item => item.index),
    boundaries,
  };
}

function requiredBoundaryIndexes(clips = [], reviewedIndexes = []) {
  const candidates = [...new Set((reviewedIndexes || []).flatMap(index => [Number(index), Number(index) + 1]))];
  return candidates.filter(index => Number.isInteger(index) && boundaryRequired(clips, index));
}

function taskFailurePatch(clips = [], shotCount = clips.length) {
  const result = audit(clips, shotCount);
  if (!result.failed_indexes.length) return null;
  const details = result.boundaries.filter(item => item.status === 'failed').map(item => {
    const labels = Array.isArray(item.qa?.failure_labels_zh) ? item.qa.failure_labels_zh.filter(Boolean) : [];
    return `第 ${item.index}→${item.index + 1} 镜衔接未通过${labels.length ? `（${labels.join('、')}）` : ''}`;
  });
  return { status: 'failed', stage: 'video_failed', error: details.join('；'), error_code: 'VIDEO_QA_FAILED', retryable: true };
}

module.exports = { sceneBlockId, sameContinuousUnit, boundaryRequired, boundaryStatus, audit, requiredBoundaryIndexes, taskFailurePatch };
