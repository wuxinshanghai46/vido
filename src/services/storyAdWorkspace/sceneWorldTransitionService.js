'use strict';

const clean = (value, max = 240) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];

function routeEdges(bundle = {}, worlds = []) {
  const plan = bundle.asset_editor?.scene_plan || {};
  const routes = list(plan.routes || plan.scene_routes || plan.transitions);
  const ids = new Set(worlds.map(world => world.id));
  const flowUnits = list(bundle.story_flow?.contract?.units || bundle.story_flow_contract?.units);
  const flowEdges = flowUnits.slice(1).map((unit, index) => {
    const previous = flowUnits[index];
    return {
      id: `story-transition:${previous?.beat_id || index + 1}:${unit?.beat_id || index + 2}`,
      from_world_id: clean(previous?.scene_id, 120), to_world_id: clean(unit?.scene_id, 120),
      type: 'story_flow_contract', reason: clean(unit?.transition_reason, 300),
      visual_bridge: clean(unit?.visual_bridge, 220), audio_bridge: clean(unit?.audio_bridge, 220),
    };
  }).filter(edge => ids.has(edge.from_world_id) && ids.has(edge.to_world_id) && edge.from_world_id !== edge.to_world_id);
  if (flowEdges.length) return flowEdges;
  const explicit = routes.map((route, index) => ({
    id: clean(route.id || `transition:${index + 1}`, 120),
    from_world_id: clean(route.from_scene_id || route.from || route.scene_id, 120),
    to_world_id: clean(route.to_scene_id || route.to, 120),
    type: clean(route.transition_type || route.type || 'content_driven', 80),
    reason: clean(route.transition_reason || route.movement || route.reason, 300),
    visual_bridge: clean(route.visual_bridge || route.visual_anchor, 220), audio_bridge: clean(route.audio_bridge, 220),
  })).filter(edge => ids.has(edge.from_world_id) && ids.has(edge.to_world_id) && edge.from_world_id !== edge.to_world_id);
  if (explicit.length || worlds.length < 2) return explicit;
  return worlds.slice(0, -1).map((world, index) => ({
    id: `transition:${world.id}:${worlds[index + 1].id}`, from_world_id: world.id,
    to_world_id: worlds[index + 1].id, type: 'content_driven',
    reason: '等待根据剧情相邻镜头确定具体衔接', visual_bridge: '', audio_bridge: '',
  }));
}

module.exports = { routeEdges };
