const { cleanText } = require('./contextBuilder');

function structuredRows(value, max = 20) {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object')
    .slice(0, max)
    .map(item => Object.fromEntries(Object.entries(item).map(([key, entry]) => [
      cleanText(key, 80),
      Array.isArray(entry)
        ? entry.map(value => cleanText(typeof value === 'object' ? JSON.stringify(value) : value, 240)).filter(Boolean).slice(0, 12)
        : cleanText(typeof entry === 'object' ? JSON.stringify(entry) : entry, 400),
    ])));
}

function compile(sceneSpec = {}, ctx = {}, body = {}) {
  const sceneId = cleanText(body.space_id || body.spaceId || body.scene_id || body.sceneId || '', 120);
  const storyStates = structuredRows(
    sceneSpec.storyStates || sceneSpec.story_states || sceneSpec.stateTimeline || sceneSpec.state_timeline,
    20,
  );
  const interactionAnchors = structuredRows(
    sceneSpec.interactionAnchors || sceneSpec.interaction_anchors,
    16,
  );
  const routes = structuredRows(sceneSpec.routes || sceneSpec.movement_routes, 12);
  const declaredPlacements = structuredRows(sceneSpec.propPlacements || sceneSpec.prop_placements, 20);
  const assetPlacements = (Array.isArray(ctx.prop_assets) ? ctx.prop_assets : [])
    .filter(prop => !sceneId || !prop.scene_id || String(prop.scene_id) === sceneId)
    .map(prop => ({
      prop_id: cleanText(prop.prop_id || prop.id || '', 120),
      name: cleanText(prop.name || '', 160),
      quantity: Math.max(1, Number(prop.quantity || 1) || 1),
      placement: cleanText(prop.placement || '', 300),
      owner_id: cleanText(prop.owner_id || '', 120),
      fixed: prop.type === 'fixed_scene_object',
    }));
  const propPlacements = [...declaredPlacements, ...assetPlacements]
    .filter((item, index, list) => list.findIndex(other => (
      String(other.prop_id || other.name || JSON.stringify(other))
      === String(item.prop_id || item.name || JSON.stringify(item))
    )) === index)
    .slice(0, 24);
  return {
    story_states: storyStates,
    interaction_anchors: interactionAnchors,
    routes,
    prop_placements: propPlacements,
    has_evidence: Boolean(storyStates.length || interactionAnchors.length || routes.length || propPlacements.length),
  };
}

function finitePoint(value) {
  if (!Array.isArray(value) || value.length < 2) return [];
  const point = value.slice(0, 3).map(Number);
  return point.every(Number.isFinite) ? point : [];
}

// Environment reference images describe an empty reusable location. Story-state prose,
// cast names and performance directions remain authoritative for storyboard generation,
// but must never leak into the spatial image prompt and accidentally cast actors.
function compileSpatialAsset(sceneSpec = {}, ctx = {}, body = {}) {
  const compiled = compile(sceneSpec, ctx, body);
  const anchors = compiled.interaction_anchors.map((anchor, index) => ({
    id: cleanText(anchor.id || `anchor_${index + 1}`, 80),
    label: cleanText(anchor.label || anchor.zone || `interaction_zone_${index + 1}`, 120),
    position: finitePoint(anchor.normalized_position || anchor.position || anchor.center),
    bounds: finitePoint(anchor.normalized_size || anchor.size || anchor.extent),
  }));
  const routes = compiled.routes.map((route, index) => ({
    id: cleanText(route.id || `route_${index + 1}`, 80),
    from: cleanText(route.from_zone || route.from || '', 120),
    to: cleanText(route.to_zone || route.to || '', 120),
    path: Array.isArray(route.path)
      ? route.path.map(finitePoint).filter(point => point.length).slice(0, 12)
      : [],
  }));
  const propPlacements = compiled.prop_placements
    .filter(prop => prop.fixed === true || prop.type === 'fixed_scene_object')
    .map(prop => ({
      prop_id: cleanText(prop.prop_id || prop.id || '', 100),
      name: cleanText(prop.name || '', 120),
      placement: cleanText(prop.placement || '', 220),
      fixed: true,
    }));
  return {
    interaction_zones: anchors,
    circulation_routes: routes,
    fixed_prop_placements: propPlacements,
    interaction_anchors: anchors,
    routes,
    story_states: [],
    prop_placements: propPlacements,
    has_evidence: Boolean(anchors.length || routes.length || propPlacements.length),
  };
}

module.exports = {
  structuredRows,
  compile,
  compileSpatialAsset,
};
