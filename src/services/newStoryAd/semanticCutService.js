const motionAwareEdit = require('./motionAwareEditService');

/**
 * 运动分析只作为剪辑建议；实际 QA 切片永远使用编剧定义的语义边界，防止下一镜内容污染当前镜头。
 */
function boundaryHasSemanticEvidence(previousBeat = {}, nextBeat = {}) {
  const previousState = previousBeat.temporal_evidence?.shot_state || previousBeat.temporal_state || {};
  const nextState = nextBeat.temporal_evidence?.shot_state || nextBeat.temporal_state || {};
  const previousEvidence = Array.isArray(previousState.evidence_requirements)
    ? previousState.evidence_requirements.filter(Boolean)
    : [];
  const nextEntry = Array.isArray(nextState.state_before) ? nextState.state_before.filter(Boolean) : [];
  return previousEvidence.length > 0 && nextEntry.length > 0;
}

async function buildLockedEditPlan({
  filePath = '',
  beats = [],
  searchWindowSec = 0.8,
  fps = 6,
  allowSemanticShift = false,
  motionSamples = null,
} = {}) {
  let motionPlan;
  try {
    motionPlan = await motionAwareEdit.selectSafeCutPoints({
      filePath,
      beats,
      searchWindowSec,
      fps,
      ...(Array.isArray(motionSamples) ? { motionSamples } : {}),
    });
  } catch (error) {
    motionPlan = { evidence: { fallback_reason: `motion_analysis_failed:${String(error.code || error.message || 'unknown').slice(0, 120)}` } };
  }
  const advisory = Array.isArray(motionPlan?.evidence?.boundaries) ? motionPlan.evidence.boundaries : [];
  const qualifiedBoundaries = (Array.isArray(beats) ? beats : []).slice(0, -1)
    .map((beat, index) => boundaryHasSemanticEvidence(beat, beats[index + 1]));
  // 只有状态证据完整且调用方明确允许时，运动安全点才可以微调切点；
  // 否则继续锁定编剧边界，避免下一镜内容污染当前镜头。
  const useSemanticShift = allowSemanticShift === true
    && qualifiedBoundaries.length > 0
    && qualifiedBoundaries.every(Boolean)
    && Array.isArray(motionPlan?.beats)
    && motionPlan.beats.length === beats.length;
  const selectedBeats = useSemanticShift ? motionPlan.beats : beats;
  return {
    beats: selectedBeats.map(beat => ({
      ...beat,
      start_sec: Number(beat.start_sec || 0),
      end_sec: Number(beat.end_sec || 0),
      duration_sec: Math.max(0, Number(beat.end_sec || 0) - Number(beat.start_sec || 0)),
      planned_start_sec: Number(beat.planned_start_sec ?? beat.start_sec ?? 0),
      planned_end_sec: Number(beat.planned_end_sec ?? beat.end_sec ?? 0),
    })),
    evidence: {
      ...(motionPlan?.evidence || {}),
      policy_version: motionAwareEdit.POLICY_VERSION,
      method: useSemanticShift ? 'v2_event_evidence_motion_safe_boundaries' : 'authored_semantic_boundaries',
      semantic_boundaries_locked: !useSemanticShift,
      semantic_evidence_qualified: qualifiedBoundaries,
      motion_boundaries_advisory: advisory,
      boundaries: advisory.map(boundary => useSemanticShift ? boundary : ({
          ...boundary,
          advisory_selected_sec: Number(boundary.selected_sec ?? boundary.planned_sec ?? 0),
          selected_sec: Number(boundary.planned_sec || 0),
          shift_sec: 0,
          shift_direction: 'unchanged',
          used_fallback: false,
        })),
    },
  };
}

module.exports = { boundaryHasSemanticEvidence, buildLockedEditPlan };
