const { cleanText } = require('./contextBuilder');

function sceneDescriptionForSpec(sceneSpec = {}, fallback = '') {
  const rows = [
    sceneSpec?.narrativeDescription || sceneSpec?.narrative_description,
    sceneSpec?.description,
    sceneSpec?.scene_description,
    sceneSpec?.layoutText || sceneSpec?.layout_text || sceneSpec?.layout,
  ]
    .map(value => cleanText(value || '', 1200))
    .filter(Boolean)
    .filter((value, index, list) => !list.slice(0, index).some(previous => previous === value || previous.includes(value)));
  return cleanText((rows.length ? rows : [fallback]).join('\n'), 1200);
}

function ensureNarrativeDescription(target = {}) {
  if (target.submitted_scene_spec_used
    || !target.space?.description
    || target.scene_spec?.narrativeDescription
    || target.scene_spec?.narrative_description) return target;
  return {
    ...target,
    scene_spec: {
      ...target.scene_spec,
      narrativeDescription: cleanText(target.space.description, 1200),
    },
  };
}

function resolvedSceneSpec(spec = {}, requested = {}) {
  const source = spec && typeof spec === 'object' ? spec : {};
  const { surface_topology: ignoredSurfaceTopology, material_contract: ignoredMaterialContract, ...rest } = source;
  return {
    ...rest,
    surfaceTopology: requested.surface_topology,
    materialContract: requested.material_contract,
    storyStates: requested.narrative_scene_contract?.story_states || [],
    interactionAnchors: requested.narrative_scene_contract?.interaction_anchors || [],
    routes: requested.narrative_scene_contract?.routes || [],
    propPlacements: requested.narrative_scene_contract?.prop_placements || [],
  };
}

module.exports = { sceneDescriptionForSpec, ensureNarrativeDescription, resolvedSceneSpec };
