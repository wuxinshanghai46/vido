'use strict';

function disabled() {
  throw Object.assign(new Error('旧剧情流向图片生成服务已禁用。第 5 步只允许零费用结构确认。'), {
    code: 'LEGACY_STORY_FLOW_SKETCH_ROUTE_DISABLED', status: 410, retryable: false,
  });
}

module.exports = {
  BATCH_KIND: 'story_flow_sketch_batch',
  OUTPUT_KIND: 'story_flow_sketches',
  confirmAll: disabled,
  generateBeat: disabled,
  getBatch: disabled,
  normalize: disabled,
  startBatch: disabled,
};
