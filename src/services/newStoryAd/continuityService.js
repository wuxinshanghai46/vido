const shotDesign = require('./shotDesignService');
const transitionPerformance = require('./transitionPerformanceContractService');

function clean(value = '', max = 320) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

const TRANSITION_TYPES = new Set(['none', 'hard_cut', 'cut_on_action', 'match_cut', 'dissolve', 'fade']);

function normalizeTransitionType(value = '', fallback = 'hard_cut') {
  const normalized = clean(value, 40).toLowerCase().replace(/[\s-]+/g, '_');
  return TRANSITION_TYPES.has(normalized) ? normalized : fallback;
}

function numberInRange(value, fallback = 0, min = 0, max = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function recommendTransition(shot = {}, previousShot = null) {
  if (!previousShot) {
    return {
      type: 'none',
      duration_sec: 0,
      reason: '首镜不需要前置转场',
      boundary_mode: 'opening',
    };
  }
  const sceneId = clean(shot.scene_id || shot.sceneId || '', 120);
  const previousSceneId = clean(previousShot.scene_id || previousShot.sceneId || '', 120);
  const sameScene = !sceneId || !previousSceneId || sceneId === previousSceneId;
  const matchAnchor = clean(
    shot.transition_match_anchor || shot.transitionMatchAnchor
      || shot.match_anchor || shot.matchAnchor || '',
    180,
  );
  const explicitPreviousFrame = shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
    || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true';
  const hasActionHandoff = explicitPreviousFrame
    && !!clean(previousShot.action_end || previousShot.action || '', 180)
    && !!clean(shot.action_start || shot.action || '', 180);
  if (matchAnchor) {
    return {
      type: 'match_cut',
      duration_sec: 0,
      reason: `按“${matchAnchor}”进行视觉匹配切换`,
      boundary_mode: sameScene ? 'same_scene_continuity' : 'intentional_scene_change',
    };
  }
  if (hasActionHandoff) {
    return {
      type: 'cut_on_action',
      duration_sec: 0,
      reason: '在前后镜头的连续动作节点完成切换',
      boundary_mode: sameScene ? 'same_scene_continuity' : 'intentional_scene_change',
    };
  }
  if (!sameScene) {
    return {
      type: 'dissolve',
      duration_sec: 0.45,
      reason: '不同场景之间使用短叠化建立明确而自然的时空变化',
      boundary_mode: 'intentional_scene_change',
    };
  }
  return {
    type: 'hard_cut',
    duration_sec: 0,
    reason: '同场景普通镜头按叙事节奏直接切换',
    boundary_mode: 'same_scene_continuity',
  };
}

function continuityContract(shot = {}, previousShot = null, index = 0) {
  const previousIndex = Number(previousShot?.index || previousShot?.shot_index || index) || index;
  const sceneId = clean(shot.scene_id || shot.sceneId || '', 120);
  const previousSceneId = clean(previousShot?.scene_id || previousShot?.sceneId || '', 120);
  const sameScene = !!previousShot && (!sceneId || !previousSceneId || sceneId === previousSceneId);
  const action = clean(shot.action || shot.visual_action || '', 240);
  const previousExit = clean(previousShot?.exit_frame_state || previousShot?.continuity?.exit_frame_state || previousShot?.action || '', 320);
  const explicitTransition = shot.transition_type || shot.transitionType || shot.transition || '';
  const transitionFallback = !previousShot ? 'none' : 'hard_cut';
  const explicitPreviousFrame = shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
    || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true';
  const temporalState = shot.temporal_state && typeof shot.temporal_state === 'object'
    ? shot.temporal_state
    : (shot.temporal_evidence?.shot_state || {});
  const temporalLinks = Array.isArray(temporalState.continuity_links)
    ? temporalState.continuity_links.map(value => clean(value, 120)).filter(Boolean)
    : [];
  const recommendation = recommendTransition(shot, previousShot);
  const normalizedTransition = normalizeTransitionType(explicitTransition, recommendation.type || transitionFallback);
  const transitionSource = clean(
    shot.transition_source || shot.transitionSource
      || (explicitTransition ? 'authored' : 'recommended'),
    40,
  );
  const inheritsPreviousState = !!previousShot
    && (explicitPreviousFrame || temporalLinks.length > 0 || ['cut_on_action', 'match_cut'].includes(normalizedTransition));
  const transitionDurationDefault = ['dissolve', 'fade'].includes(normalizedTransition)
    ? recommendation.duration_sec || 0.45
    : 0;
  const authoredTransitionDuration = Number(shot.transition_duration_sec ?? shot.transitionDurationSec);
  const audioBridge = clean(shot.audio_bridge || shot.audioBridge || '', 180);
  const transitionDesign = transitionPerformance.normalizeTransitionDesign(
    shot.transition_design || shot.transitionDesign || shot.transition_motif || {},
    normalizedTransition,
  );
  // Ordinary adjacent shots are editorial hard cuts. A cut-on-action must be
  // explicitly authored; inferring it from the mere presence of an action
  // serializes nearly every storyboard and invents continuity requirements.
  return {
    continuity_from: previousShot ? clean(shot.continuity_from || shot.continuityFrom || `shot_${previousIndex}`, 100) : '',
    entry_frame_state: clean(shot.entry_frame_state || shot.entryFrameState || (inheritsPreviousState ? previousExit : ''), 320),
    exit_frame_state: clean(shot.exit_frame_state || shot.exitFrameState || action, 320),
    action_start: clean(shot.action_start || shot.actionStart || (inheritsPreviousState ? previousExit : ''), 240),
    action_end: clean(shot.action_end || shot.actionEnd || action, 240),
    screen_direction: clean(shot.screen_direction || shot.screenDirection || '', 80),
    eyeline: clean(shot.eyeline || shot.eyeLine || '', 120),
    camera_axis: clean(shot.camera_axis || shot.cameraAxis || '', 120),
    camera_movement: clean(shot.camera_movement || shot.cameraMovement || shot.camera || '', 160),
    object_states: shotDesign.structuredText(shot.object_states || shot.objectStates || '', 320),
    transition_type: normalizedTransition,
    transition_duration_sec: ['dissolve', 'fade'].includes(normalizedTransition)
      && !(authoredTransitionDuration > 0)
      ? transitionDurationDefault
      : numberInRange(authoredTransitionDuration, transitionDurationDefault, 0, 2),
    transition_match_anchor: clean(
      shot.transition_match_anchor || shot.transitionMatchAnchor
        || shot.match_anchor || shot.matchAnchor || '',
      180,
    ),
    transition_design: transitionDesign,
    transition_source: transitionSource || 'recommended',
    transition_recommendation: recommendation,
    boundary_mode: recommendation.boundary_mode,
    requires_previous_frame: inheritsPreviousState,
    // V2.0 的连续关系来自分镜显式写入的开放式链接，不再由行业、动作词或场景模板猜测。
    temporal_continuity_links: temporalLinks,
    transition_reason: clean(
      shot.transition_reason || shot.transitionReason
        || (!explicitTransition ? recommendation.reason : ''),
      240,
    ),
    audio_bridge: audioBridge,
    audio_bridge_duration_sec: numberInRange(
      shot.audio_bridge_duration_sec ?? shot.audioBridgeDurationSec,
      audioBridge ? 0.35 : 0,
      0,
      1.5,
    ),
    same_scene_as_previous: sameScene,
  };
}

function withContinuityContracts(shots = []) {
  let previous = null;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const continuity = continuityContract(shot, previous, index);
    const next = { ...shot, ...continuity, continuity };
    previous = next;
    return next;
  });
}

function continuityPrompt(shot = {}, previousShot = null) {
  const contract = shot.continuity && typeof shot.continuity === 'object'
    ? shot.continuity
    : continuityContract(shot, previousShot);
  return [
    `Continuity from: ${contract.continuity_from || 'none'}`,
    `Entry frame state: ${contract.entry_frame_state || 'follow the supplied keyframe exactly'}`,
    `Exit frame state: ${contract.exit_frame_state || 'end on the requested action'}`,
    `Action start/end: ${contract.action_start || ''} -> ${contract.action_end || ''}`,
    `Screen direction: ${contract.screen_direction || 'preserve established direction'}`,
    `Eyeline: ${contract.eyeline || 'preserve established eyeline'}`,
    `Camera axis: ${contract.camera_axis || 'preserve established spatial axis'}`,
    `Camera movement: ${contract.camera_movement || 'natural movement required by this shot only'}`,
    `Object state lock: ${contract.object_states || 'preserve all visible product and prop states'}`,
    `Transition: ${contract.transition_type || 'hard_cut'}; ${contract.transition_reason || ''}`,
    `Transition duration: ${Number(contract.transition_duration_sec || 0).toFixed(2)} seconds`,
    `Transition match anchor: ${contract.transition_match_anchor || 'none specified'}`,
    `Transition boundary design: ${transitionPerformance.transitionDesignPrompt(contract.transition_design || {}, contract.transition_type)}`,
    `Boundary mode: ${contract.boundary_mode || 'same_scene_continuity'}`,
    `Requires previous frame: ${contract.requires_previous_frame === true ? 'yes' : 'no'}`,
    `Audio bridge: ${contract.audio_bridge || 'none specified'}; lead ${Number(contract.audio_bridge_duration_sec || 0).toFixed(2)} seconds`,
  ].join('\n');
}

module.exports = {
  TRANSITION_TYPES,
  continuityContract,
  continuityPrompt,
  normalizeTransitionType,
  recommendTransition,
  withContinuityContracts,
};
