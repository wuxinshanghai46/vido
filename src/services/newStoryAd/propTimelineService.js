const { cleanText } = require('./contextBuilder');

function shotIndex(shot = {}, index = 0) {
  const value = Number(shot.shot_index ?? shot.index ?? shot.order - 1);
  return Number.isFinite(value) && value >= 0 ? value : index;
}

function shotText(shot = {}) {
  return [
    shot.title,
    shot.visual,
    shot.visual_description,
    shot.action,
    shot.action_start,
    shot.action_end,
    shot.prop_contact,
    shot.keyframe_notes,
  ].filter(Boolean).join(' ');
}

function explicitState(shot = {}, prop = {}) {
  const maps = [
    shot.prop_states,
    shot.propStates,
    shot.continuity_state?.props,
    shot.continuityState?.props,
  ].filter(value => value && typeof value === 'object');
  for (const map of maps) {
    const value = map[prop.id] ?? map[prop.name];
    if (value) return cleanText(typeof value === 'object' ? (value.state || value.name || value.id) : value, 120);
  }
  return '';
}

function buildTimeline(prop = {}, shots = []) {
  const states = Array.isArray(prop.states) ? prop.states : [];
  let lastState = states[0] || 'default';
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const text = shotText(shot);
    const mentioned = [prop.id, prop.name].filter(Boolean).some(value => text.includes(value));
    const state = explicitState(shot, prop) || lastState;
    if (state) lastState = state;
    return {
      shot_index: shotIndex(shot, index),
      present: mentioned || shot.props?.includes?.(prop.id) || shot.prop_ids?.includes?.(prop.id) || false,
      state,
      owner_id: cleanText(shot.prop_owner_id || shot.propOwnerId || prop.owner_id || '', 120),
      scene_id: cleanText(shot.scene_id || shot.sceneId || prop.scene_id || '', 120),
      placement: cleanText(shot.prop_placement || shot.propPlacement || prop.placement || '', 300),
      hand_contact: cleanText(shot.prop_contact || shot.propContact || prop.hand_contact || '', 300),
    };
  });
}

function attachTimelines(propAssets = [], shots = []) {
  return (Array.isArray(propAssets) ? propAssets : []).map(prop => ({
    ...prop,
    shot_timeline: buildTimeline(prop, shots),
  }));
}

function keyframePrompt(propAssets = [], shot = {}) {
  const index = shotIndex(shot, 0);
  const rows = (Array.isArray(propAssets) ? propAssets : []).map(prop => {
    const timeline = Array.isArray(prop.shot_timeline)
      ? prop.shot_timeline.find(item => Number(item.shot_index) === index)
      : null;
    if (!timeline?.present) return null;
    return {
      prop_id: prop.prop_id || prop.id,
      name: prop.name,
      material: prop.material,
      scale: prop.scale,
      quantity: prop.quantity,
      state: timeline.state,
      owner_id: timeline.owner_id,
      scene_id: timeline.scene_id,
      placement: timeline.placement,
      hand_contact: timeline.hand_contact,
    };
  }).filter(Boolean);
  if (!rows.length) return '';
  return [
    `Strict prop continuity lock for shot ${index}: ${JSON.stringify(rows)}`,
    'Render exactly these declared props with the same identity, quantity, material, scale, owner, placement, contact and state. Do not add, remove, duplicate or substitute a prop.',
  ].join('\n');
}

module.exports = {
  shotIndex,
  shotText,
  buildTimeline,
  attachTimelines,
  keyframePrompt,
};
