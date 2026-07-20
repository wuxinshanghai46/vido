function attempt({ generationId = '', status = 'failed', error = null, candidates = [] } = {}) {
  return {
    generation_id: generationId,
    status,
    ...(error ? {
      error: String(error.message || error),
      error_code: error.code || 'KEYFRAME_FAILED',
    } : {}),
    candidates: Array.isArray(candidates) ? candidates : [],
    finished_at: new Date().toISOString(),
  };
}

function describeBatchFailures({ targetIndexes = [], keyframes = [], shots = [], isComplete = () => false } = {}) {
  return targetIndexes
    .filter(index => !isComplete(keyframes[index]) || keyframes[index]?.qa?.pass !== true)
    .map(index => ({
      index,
      shot_number: index + 1,
      title: shots[index]?.title || `镜头 ${index + 1}`,
      code: keyframes[index]?.error_code || keyframes[index]?.latest_attempt?.error_code || 'KEYFRAME_FAILED',
      message: keyframes[index]?.error || keyframes[index]?.latest_attempt?.error || '分镜图生成或视觉审核未通过',
      status: keyframes[index]?.current_generation_status || 'failed',
      candidate_exists: Array.isArray(keyframes[index]?.candidates)
        && keyframes[index].candidates.some(candidate => candidate?.image_url || candidate?.url),
    }));
}

function batchError(failures = [], keyframes = [], attempts = []) {
  const error = new Error(`第 ${failures.map(item => item.shot_number).join('、')} 镜未生成可用分镜图；已保留成功镜头，可仅补齐失败镜头。`);
  error.code = 'KEYFRAME_BATCH_PARTIAL_FAILURE';
  error.retryable = true;
  error.details = failures;
  error.keyframes = keyframes;
  error.attempts = attempts;
  return error;
}

module.exports = { attempt, describeBatchFailures, batchError };
