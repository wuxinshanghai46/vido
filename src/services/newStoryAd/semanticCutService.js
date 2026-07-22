const motionAwareEdit = require('./motionAwareEditService');

/**
 * 运动分析只作为剪辑建议；实际 QA 切片永远使用编剧定义的语义边界，防止下一镜内容污染当前镜头。
 */
async function buildLockedEditPlan({ filePath = '', beats = [], searchWindowSec = 0.8, fps = 6 } = {}) {
  let motionPlan;
  try {
    motionPlan = await motionAwareEdit.selectSafeCutPoints({ filePath, beats, searchWindowSec, fps });
  } catch (error) {
    motionPlan = { evidence: { fallback_reason: `motion_analysis_failed:${String(error.code || error.message || 'unknown').slice(0, 120)}` } };
  }
  const advisory = Array.isArray(motionPlan?.evidence?.boundaries) ? motionPlan.evidence.boundaries : [];
  return {
    beats: beats.map(beat => ({
      ...beat,
      start_sec: Number(beat.start_sec || 0),
      end_sec: Number(beat.end_sec || 0),
      duration_sec: Math.max(0, Number(beat.end_sec || 0) - Number(beat.start_sec || 0)),
      planned_start_sec: Number(beat.start_sec || 0),
      planned_end_sec: Number(beat.end_sec || 0),
    })),
    evidence: {
      ...(motionPlan?.evidence || {}),
      policy_version: motionAwareEdit.POLICY_VERSION,
      method: 'authored_semantic_boundaries',
      semantic_boundaries_locked: true,
      motion_boundaries_advisory: advisory,
      boundaries: advisory.map(boundary => ({
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

module.exports = { buildLockedEditPlan };
