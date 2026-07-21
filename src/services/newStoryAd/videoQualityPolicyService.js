const BLOCKING_MANUAL_ACCEPT_DIMENSIONS = new Set([
  'person_identity', 'people_count', 'product_identity', 'scene_consistency', 'scene_continuity',
  'action_fulfillment', 'action_continuity', 'screen_direction', 'person_position', 'wardrobe',
  'prop_state', 'scene_topology', 'identity', 'frame_evidence',
]);

const MINOR_MANUAL_ACCEPT_DIMENSIONS = new Set(['composition', 'framing', 'minor_visual_polish', 'color_tone']);

function manualAcceptDecision(clip = {}) {
  const failedQaRows = [clip.qa, clip.cross_shot_qa].filter(qa => qa && qa.pass === false);
  const failureDimensions = [...new Set(failedQaRows.flatMap(qa => (
    Array.isArray(qa.failure_dimensions) ? qa.failure_dimensions : []
  )).filter(Boolean))];
  const blockingDimensions = failureDimensions.filter(dimension => BLOCKING_MANUAL_ACCEPT_DIMENSIONS.has(dimension));
  const unknownOrNonMinor = failedQaRows.length > 0
    && (!failureDimensions.length || failureDimensions.some(dimension => !MINOR_MANUAL_ACCEPT_DIMENSIONS.has(dimension)));
  return {
    allowed: blockingDimensions.length === 0 && !unknownOrNonMinor,
    failure_dimensions: failureDimensions,
    blocking_dimensions: blockingDimensions,
    policy: 'minor_non_blocking_only',
  };
}

module.exports = {
  BLOCKING_MANUAL_ACCEPT_DIMENSIONS,
  MINOR_MANUAL_ACCEPT_DIMENSIONS,
  manualAcceptDecision,
};
