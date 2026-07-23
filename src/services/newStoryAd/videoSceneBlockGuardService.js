/** 在供应商提交前阻止只有首镜关键帧被时间锚定的多镜生成单元。 */
function assertTemporalKeyframeAnchors(units = []) {
  const unsupported = (Array.isArray(units) ? units : [])
    .find(block => Array.isArray(block.member_indexes)
      && block.member_indexes.length > 1
      && block.temporal_anchor_binding_verified !== true);
  if (!unsupported) return;
  const error = new Error(`生成单元包含第 ${unsupported.member_indexes.map(index => index + 1).join('、')} 镜，但当前视频供应商只能把一个关键帧作为时间首帧，无法同时锁定后续镜头。已在提交供应商前停止，请重新预检为逐镜生成。`);
  error.code = 'VIDEO_MULTI_KEYFRAME_ANCHOR_UNSUPPORTED';
  error.status = 409;
  error.retryable = false;
  error.providerSubmitted = false;
  error.billingState = 'not_submitted';
  throw error;
}

module.exports = {
  assertTemporalKeyframeAnchors,
};
