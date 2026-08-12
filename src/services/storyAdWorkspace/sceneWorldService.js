const storage = require('../newStoryAd/storageService');
const sceneLineage = require('../newStoryAd/sceneLineageContractService');

const SCENE_WORLD_SCHEMA_VERSION = 2;

function clean(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boolOverride(source = {}, key, fallback) {
  if (source[key] === true) return true;
  if (source[key] === false) return false;
  return fallback;
}

function worldText(scene = {}) {
  const spec = scene.scene_spec || {};
  return [
    scene.name,
    scene.description,
    scene.story_purpose,
    spec.layout,
    spec.materials,
    spec.interaction,
    spec.negative,
  ].map(value => clean(value, 1200)).join(' ');
}

function sceneViews(scene = {}) {
  return list(scene.view_images).filter(view => clean(view?.image_url || view?.url, 1000));
}

function hasSceneVisualAuthority(scene = {}) {
  return Boolean(
    clean(scene.image_url || scene.url || scene.scene_master?.image_url || scene.layout?.image_url, 1000)
    || sceneViews(scene).length
    || list(scene.cameras).some(camera => clean(camera?.image_url || camera?.reference_image_url, 1000)),
  );
}

function validPanorama(item = {}, scene = {}) {
  const url = clean(item?.image_url || item?.url, 1000);
  const projection = clean(item?.projection || item?.kind, 100);
  const width = Number(item?.width || 0) || 0;
  const height = Number(item?.height || 0) || 0;
  const ratioValid = item?.aspect_ratio === '2:1' || (width > 0 && height > 0 && width === height * 2);
  const authorityValid = item?.status === 'active_verified' && item?.qa?.pass === true;
  const revisionValid = Number(item?.source_scene_revision || 0) + 1 === Number(scene?.scene_revision || scene?.revision || 0);
  return Boolean(url && /equirectangular|360_panorama/i.test(projection) && ratioValid && authorityValid && revisionValid);
}

function panoramaAssets(scene = {}) {
  const worldAssets = scene.scene_world_assets || scene.sceneWorldAssets || {};
  const rows = [
    ...list(scene.panorama_images),
    ...list(scene.panoramas),
    ...list(worldAssets.panoramas),
    ...sceneViews(scene).filter(view => /panorama|equirect|cubemap|cube_face|360/i.test(clean([
      view.key,
      view.source_kind,
      view.source_role,
      view.projection,
    ].join(' '), 300))),
  ];
  const unique = new Map();
  rows.filter(item => validPanorama(item, scene)).forEach(item => {
    const url = clean(item.image_url || item.url, 1000);
    if (!unique.has(url)) unique.set(url, item);
  });
  return [...unique.values()];
}

function spatialModelAssets(scene = {}) {
  const assets = scene.scene_world_assets || scene.sceneWorldAssets || {};
  return list(assets.models || assets.spatial_models || scene.spatial_models)
    .filter(item => item?.status === 'active_verified'
      && item?.qa?.pass === true
      && clean(item?.geometry_url || item?.model_url || item?.mesh_url || item?.url, 1000)
      && clean(item?.navmesh_url, 1000));
}

/**
 * Capabilities are inferred from the requested content, never from a fixed
 * industry template. Explicit user/plan overrides always win.
 */
function inferCapabilities(scene = {}) {
  const explicit = scene.capabilities || scene.scene_spec?.capabilities || {};
  const contract = scene.scene_experience_contract || scene.scene_spec?.scene_experience_contract || {};
  const representation = clean(contract.representation || explicit.representation || 'physical', 40).toLowerCase();
  const extent = clean(contract.extent || explicit.extent || 'unspecified', 40).toLowerCase();
  const views = sceneViews(scene);
  const photoViewCount = views.length;
  const panoramaCount = panoramaAssets(scene).length;
  const spatialCount = spatialModelAssets(scene).length;
  const hasLayoutView = views.some(view => /^(?:layout|blueprint|floor_plan|topdown)$/i.test(clean(view.key || view.view, 80)))
    || Boolean(scene.layout_contract || scene.scene_contract?.layout_contract);
  const inferredMapMode = representation === 'digital' ? 'state_graph'
    : extent === 'open' ? 'route_map'
      : hasLayoutView ? 'structure_map' : 'stage_map';
  const inferredWorldMode = representation === 'digital' ? 'digital_state'
    : representation === 'abstract' ? 'abstract_cg'
      : extent === 'stage' ? 'studio_stage'
        : extent === 'open' ? 'physical_open' : 'physical_space';
  const translationRequired = contract.translation_required === true || contract.camera_path_required === true;
  const blockingRequired = contract.actor_blocking_required !== false && scene.no_human !== true;
  return {
    representation,
    extent,
    supports_photo_views: boolOverride(explicit, 'supports_photo_views', photoViewCount > 0),
    supports_panorama: panoramaCount > 0 && explicit.supports_panorama !== false,
    supports_structure_map: boolOverride(explicit, 'supports_structure_map', hasLayoutView),
    supports_3d_proxy: boolOverride(explicit, 'supports_3d_proxy', representation !== 'digital'),
    supports_spatial_model: spatialCount > 0 && explicit.supports_spatial_model !== false,
    supports_rotation_navigation: panoramaCount > 0,
    supports_translation_navigation: spatialCount > 0 && translationRequired,
    supports_navigation: spatialCount > 0 && translationRequired && explicit.supports_navigation !== false,
    supports_camera_orbit: spatialCount > 0,
    supports_character_blocking: spatialCount > 0 && blockingRequired,
    supports_motion_path: spatialCount > 0 && translationRequired,
    supports_transition_portal: boolOverride(explicit, 'supports_transition_portal', true),
    supports_state_variants: boolOverride(explicit, 'supports_state_variants', representation === 'digital' || representation === 'abstract'),
    map_mode: clean(explicit.map_mode || inferredMapMode, 40),
    world_mode: clean(explicit.world_mode || inferredWorldMode, 40),
  };
}

function normalizedPoint(value, fallback = []) {
  const row = Array.isArray(value) ? value : fallback;
  if (row.length < 2) return [];
  return [Math.max(0, Math.min(1, finite(row[0], 0.5))), Math.max(0, Math.min(1, finite(row[1], 0.5)))];
}

function cameraPose(camera = {}, index = 0, total = 1) {
  const point = normalizedPoint(camera.normalized_position || camera.position_on_layout);
  const target = normalizedPoint(camera.look_at || camera.target_on_layout, [0.5, 0.5]);
  const angle = (index / Math.max(1, total)) * Math.PI * 2;
  const position = point.length
    ? [(point[0] - 0.5) * 12, 1.6, (point[1] - 0.5) * 8]
    : [Math.cos(angle) * 4.8, 1.6, Math.sin(angle) * 3.8];
  const lookAt = target.length
    ? [(target[0] - 0.5) * 12, 1.2, (target[1] - 0.5) * 8]
    : [0, 1.2, 0];
  return {
    position: position.map(value => Number(value.toFixed(3))),
    look_at: lookAt.map(value => Number(value.toFixed(3))),
    yaw: finite(camera.estimated_azimuth_degrees, finite(camera.yaw, 0)),
    pitch: finite(camera.estimated_pitch_degrees, finite(camera.pitch, -8)),
    roll: finite(camera.roll, 0),
    fov: Math.max(18, Math.min(110, finite(camera.fov, 52))),
  };
}

function normalizeZones(scene = {}) {
  const rows = list(scene.zones);
  if (!rows.length) {
    return [{
      id: `${scene.id || 'world'}:zone:main`,
      name: clean(scene.name || '主要区域', 120),
      purpose: clean(scene.story_purpose || scene.description || '当前场景的主要活动与展示区域', 360),
      bounds: { x: 0, z: 0, width: 6, depth: 4 },
    }];
  }
  const columns = Math.max(1, Math.ceil(Math.sqrt(rows.length)));
  return rows.map((zone, index) => ({
    id: clean(zone.id || zone.zone_id || `${scene.id}:zone:${index + 1}`, 120),
    name: clean(zone.label || zone.name || `区域 ${index + 1}`, 120),
    purpose: clean(zone.purpose || zone.description, 360),
    bounds: {
      x: ((index % columns) - (columns - 1) / 2) * 3.2,
      z: (Math.floor(index / columns) - (Math.ceil(rows.length / columns) - 1) / 2) * 2.7,
      width: 2.8,
      depth: 2.25,
    },
  }));
}

function normalizeCameras(scene = {}) {
  const rows = list(scene.cameras).length ? list(scene.cameras) : list(scene.camera_plan);
  return rows.map((camera, index) => ({
    id: clean(camera.id || camera.view_id || camera.camera_id || `${scene.id}:camera:${index + 1}`, 120),
    name: clean(camera.label || camera.name || camera.role || `机位 ${index + 1}`, 120),
    role: clean(camera.role || camera.intent || camera.notes, 260),
    zone_id: clean(camera.zone_id || camera.zone, 120),
    framing: clean(camera.framing, 80),
    lens: clean(camera.lens || camera.lens_class, 80),
    movement: clean(camera.movement, 220),
    pose: cameraPose(camera, index, rows.length),
    image_url: clean(camera.image_url || camera.reference_image_url, 1000),
  }));
}

function observationNodes(scene = {}, zones = [], cameras = []) {
  const panoramas = panoramaAssets(scene);
  const views = sceneViews(scene).filter(view => !panoramas.some(item => clean(item.image_url || item.url, 1000) === clean(view.image_url || view.url, 1000)));
  const sources = [...panoramas, ...views];
  const nodeCount = Math.max(1, Math.min(12, Math.max(zones.length, cameras.length, sources.length)));
  return Array.from({ length: nodeCount }, (_, index) => {
    const zone = zones[index % zones.length] || zones[0];
    const camera = cameras[index] || cameras[index % Math.max(1, cameras.length)];
    const view = sources[index] || sources[index % Math.max(1, sources.length)];
    return {
      id: `${scene.id}:observation:${index + 1}`,
      name: clean(camera?.name || view?.label || zone?.name || `观察点 ${index + 1}`, 120),
      zone_id: clean(zone?.id, 120),
      camera_id: clean(camera?.id, 120),
      image_url: clean(view?.image_url || view?.url || camera?.image_url, 1000),
      view_key: clean(view?.key || view?.view, 40),
      projection: clean(view?.projection || view?.source_role, 80),
      is_panorama: validPanorama(view, scene),
      pose: camera?.pose || cameraPose({}, index, nodeCount),
    };
  });
}

function routeEdges(bundle = {}, worlds = []) {
  const plan = bundle.asset_editor?.scene_plan || {};
  const routes = list(plan.routes || plan.scene_routes || plan.transitions);
  const ids = new Set(worlds.map(world => world.id));
  const explicit = routes.map((route, index) => ({
    id: clean(route.id || `transition:${index + 1}`, 120),
    from_world_id: clean(route.from_scene_id || route.from || route.scene_id, 120),
    to_world_id: clean(route.to_scene_id || route.to, 120),
    type: clean(route.transition_type || route.type || 'content_driven', 80),
    reason: clean(route.transition_reason || route.movement || route.reason, 300),
    visual_bridge: clean(route.visual_bridge || route.visual_anchor, 220),
    audio_bridge: clean(route.audio_bridge, 220),
  })).filter(edge => ids.has(edge.from_world_id) && ids.has(edge.to_world_id) && edge.from_world_id !== edge.to_world_id);
  if (explicit.length || worlds.length < 2) return explicit;
  return worlds.slice(0, -1).map((world, index) => ({
    id: `transition:${world.id}:${worlds[index + 1].id}`,
    from_world_id: world.id,
    to_world_id: worlds[index + 1].id,
    type: 'content_driven',
    reason: '等待根据剧情相邻镜头确定具体衔接',
    visual_bridge: '',
    audio_bridge: '',
  }));
}

function baseWorld(scene = {}, index = 0) {
  const zones = normalizeZones(scene);
  const cameras = normalizeCameras(scene);
  const views = sceneViews(scene);
  const layoutView = views.find(view => String(view.key || view.view || '').toLowerCase() === 'layout');
  const panoramaCount = panoramaAssets(scene).length;
  const spatialModelCount = spatialModelAssets(scene).length;
  const currentExperience = spatialModelCount ? 'spatial_3d' : (panoramaCount ? 'panorama_360' : (views.length ? 'photo_views' : 'structure_proxy'));
  return {
    id: clean(scene.id || `scene-${index + 1}`, 120),
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    revision: Math.max(1, finite(scene.revision, 1)),
    name: clean(scene.name || `场景世界 ${index + 1}`, 120),
    description: clean(scene.description, 900),
    story_purpose: clean(scene.story_purpose, 500),
    place_lineage: sceneLineage.normalize(scene, index),
    visual_authority_ready: hasSceneVisualAuthority(scene),
    status: clean(scene.status || 'planned', 50),
    capabilities: inferCapabilities(scene),
    zones,
    cameras,
    observation_nodes: observationNodes(scene, zones, cameras),
    source_asset: {
      image_url: clean(scene.image_url, 1000),
      layout_image_url: clean(scene.layout?.image_url || layoutView?.image_url || layoutView?.url, 1000),
      photo_view_count: views.length,
      panorama_count: panoramaCount,
      panorama_url: clean(panoramaAssets(scene)[0]?.image_url || panoramaAssets(scene)[0]?.url, 1000),
      spatial_model_count: spatialModelCount,
      legacy_view_count: views.length,
      source_revision: finite(scene.revision, 0),
    },
    experience: {
      current_mode: currentExperience,
      requested_mode: currentExperience,
      status: ['photo_views', 'structure_proxy'].includes(currentExperience) ? 'base_ready' : 'ready',
      source_mode: 'existing_assets',
      observation_point_target: panoramaCount || 1,
      route_brief: '',
      requirements: {
        panorama_360: panoramaCount ? [] : ['至少一个 2:1 等距柱状全景观察点'],
        spatial_3d: spatialModelCount ? [] : ['多观察点或扫描素材', '深度/几何空间数据', '观察点连接与漫游路线'],
      },
    },
    legacy_static_world: finite(scene.generation_contract_version || scene.scene_contract?.generation_contract_version, 0) > 0,
  };
}

function mergeWorld(base, override = {}) {
  if (!override || typeof override !== 'object') return base;
  return {
    ...base,
    ...override,
    id: base.id,
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    revision: Math.max(base.revision, finite(override.revision, base.revision)),
    capabilities: { ...base.capabilities, ...(override.capabilities || {}) },
    experience: { ...base.experience, ...(override.experience || {}) },
    zones: list(override.zones).length ? override.zones : base.zones,
    cameras: list(override.cameras).length ? override.cameras : base.cameras,
    observation_nodes: list(override.observation_nodes).length ? override.observation_nodes : base.observation_nodes,
    source_asset: base.source_asset,
  };
}

function buildSceneWorlds(bundle = {}, overrides = {}) {
  const scenes = list(bundle.assets?.scenes);
  const worlds = scenes.map((scene, index) => mergeWorld(baseWorld(scene, index), overrides?.[scene.id]));
  const transitions = routeEdges(bundle, worlds);
  return worlds.map(world => ({
    ...world,
    portals: transitions.filter(edge => edge.from_world_id === world.id).map(edge => ({
      id: `${world.id}:portal:${edge.to_world_id}`,
      to_world_id: edge.to_world_id,
      label: `通往 ${worlds.find(item => item.id === edge.to_world_id)?.name || edge.to_world_id}`,
      transition_id: edge.id,
    })),
  }));
}

function historicalStoryboard(taskId, bundle = {}, worlds = []) {
  if (!taskId || list(bundle.storyboard?.shots).length || typeof storage.listArtifacts !== 'function') return null;
  const worldIds = new Set(worlds.map(world => world.id));
  const names = list(bundle.assets?.people).flatMap(person => [person.name, person.profile?.displayName]).map(value => clean(value, 120)).filter(Boolean);
  return storage.listArtifacts(taskId, 'storyboard_table').find(artifact => {
    if (!['published', 'carried_forward'].includes(String(artifact.qa_status || ''))) return false;
    return list(artifact.payload).some(shot => {
      const sceneId = clean(shot.scene_id || shot.scene_asset_id, 120);
      const text = list(shot.characters).map(item => clean(item?.name || item, 120)).join(' ');
      return worldIds.has(sceneId) && (!text || names.some(name => text.includes(name)));
    });
  }) || null;
}

function characterWorldMatrix(bundle = {}, worlds = [], options = {}) {
  const people = list(bundle.assets?.people);
  const currentShots = list(bundle.storyboard?.shots);
  const historical = options.historical_storyboard || null;
  const shots = currentShots.length ? currentShots : list(historical?.payload);
  const shotSource = currentShots.length ? 'current_storyboard' : (shots.length ? 'published_history' : 'none');
  const manual = new Map(list(options.assignments).map(item => [`${clean(item.character_id, 120)}:${clean(item.world_id, 120)}`, item]));
  return people.map((person, personIndex) => ({
    character_id: clean(person.subject_id || person.profile?.id || person.id || `person-${personIndex + 1}`, 120),
    name: clean(person.name || person.profile?.displayName || `人物 ${personIndex + 1}`, 120),
    wardrobe: clean(person.profile?.wardrobeText, 320),
    cells: worlds.map(world => {
      const characterId = clean(person.subject_id || person.profile?.id || person.id || `person-${personIndex + 1}`, 120);
      const explicit = manual.get(`${characterId}:${world.id}`);
      const matched = shots.filter(shot => {
        const sameWorld = clean(shot.scene_id || shot.scene_asset_id, 120) === world.id;
        const characterText = list(shot.characters).map(item => clean(item?.name || item, 120)).join(' ');
        return sameWorld && (!characterText || characterText.includes(person.name) || characterText.includes(person.profile?.displayName));
      });
      const personName = clean(person.name || person.profile?.displayName, 120);
      const worldEvidence = clean([world.name, world.description, world.story_purpose].join(' '), 1500);
      const lookMatch = list(person.profile?.look_profiles).find(look => list(look.scene_ids).includes(world.id)
        || list(look.scene_names).some(name => worldEvidence.includes(clean(name, 120)))
        || (clean(look.story_state, 120) && worldEvidence.includes(clean(look.story_state, 120))));
      const plannedMatch = Boolean(personName && worldEvidence.includes(personName)) || Boolean(lookMatch);
      const defaultSuggested = plannedMatch || (people.length === 1 && worlds.length === 1);
      const explicitPresence = clean(explicit?.presence, 30);
      const presence = explicitPresence || (matched.length ? 'confirmed' : (defaultSuggested ? 'suggested' : 'unassigned'));
      return {
        world_id: world.id,
        presence,
        shot_count: matched.length,
        role: clean(explicit?.role || matched.map(shot => shot.action || shot.subject_action).filter(Boolean).join('；'), 260),
        look_id: clean(explicit?.look_id || lookMatch?.id, 100),
        age_state_id: clean(explicit?.age_state_id || lookMatch?.age_state_id || person.profile?.age_states?.[0]?.id, 100),
        story_state_id: clean(explicit?.story_state_id || lookMatch?.story_state_id, 100),
        appearance_order: Math.max(0, finite(explicit?.appearance_order, 0)),
        entry_direction: clean(explicit?.entry_direction, 80), exit_direction: clean(explicit?.exit_direction, 80),
        blocking: clean(explicit?.blocking, 260), camera_id: clean(explicit?.camera_id || world.cameras?.[0]?.id, 120),
        source: explicitPresence ? 'manual' : (matched.length ? shotSource : (plannedMatch ? 'content_plan' : (defaultSuggested ? 'single_scene_default' : 'none'))),
        reason: explicitPresence ? '用户已明确设置人物是否在该场景出场'
          : (matched.length ? `${shotSource === 'published_history' ? '来自历史已发布故事板' : '来自当前故事板'} ${matched.length} 个镜头`
            : (plannedMatch ? '根据剧情文字、人物造型和场景阶段预先建议' : (defaultSuggested ? '当前只有一个人物和一个场景，默认建议出场' : '尚未在剧情文字或人工分配中确认'))),
      };
    }),
  }));
}

function productionManifest(bundle = {}, worlds = [], options = {}) {
  const transitions = routeEdges(bundle, worlds);
  const plannedScenes = list(bundle.assets?.scenes);
  return {
    schema_version: 1,
    task_id: clean(bundle.project?.id, 120),
    content_revision: finite(bundle.revisions?.content, 1),
    counts: {
      people: list(bundle.assets?.people).length,
      animals: list(bundle.assets?.animals).length,
      products: list(bundle.assets?.products).length,
      worlds: worlds.length,
      planned_scenes: plannedScenes.length,
      pending_scenes: Math.max(0, plannedScenes.length - worlds.length),
      cameras: worlds.reduce((sum, world) => sum + list(world.cameras).length, 0),
      transitions: transitions.length,
    },
    character_world_matrix: characterWorldMatrix(bundle, worlds, options),
    transitions,
    assignment_revision: Math.max(1, finite(options.assignment_revision, 1)),
  };
}

function resolve(taskId, bundle = {}) {
  const stored = storage.getOutput(taskId, 'scene_world_overrides') || {};
  const overrides = stored.worlds && typeof stored.worlds === 'object' ? stored.worlds : {};
  const worlds = buildSceneWorlds(bundle, overrides);
  const historical = historicalStoryboard(taskId, bundle, worlds);
  return { worlds, manifest: productionManifest(bundle, worlds, {
    assignments: stored.assignments,
    assignment_revision: stored.assignment_revision,
    historical_storyboard: historical,
  }) };
}

function saveWorld(taskId, worldId, patch = {}, options = {}) {
  const stored = storage.getOutput(taskId, 'scene_world_overrides') || { schema_version: 1, worlds: {} };
  const existing = stored.worlds?.[worldId] || {};
  const expected = finite(options.expected_revision, finite(patch.expected_revision, 0));
  const current = Math.max(1, finite(existing.revision, 1));
  if (expected && expected !== current) {
    const error = new Error('场景世界已被其他修改更新，请刷新后再保存');
    error.status = 409;
    error.code = 'SCENE_WORLD_REVISION_CONFLICT';
    error.current_world_revision = current;
    throw error;
  }
  const next = {
    ...existing,
    ...patch,
    id: worldId,
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    revision: current + 1,
    updated_at: new Date().toISOString(),
  };
  delete next.expected_revision;
  const payload = {
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    worlds: { ...(stored.worlds || {}), [worldId]: next },
    assignments: list(stored.assignments),
    assignment_revision: Math.max(1, finite(stored.assignment_revision, 1)),
  };
  storage.saveOutput(taskId, 'scene_world_overrides', payload, { content_revision: options.content_revision });
  return next;
}

function saveAssignments(taskId, assignments = [], options = {}) {
  const stored = storage.getOutput(taskId, 'scene_world_overrides') || { schema_version: SCENE_WORLD_SCHEMA_VERSION, worlds: {} };
  const current = Math.max(1, finite(stored.assignment_revision, 1));
  const expected = finite(options.expected_revision, 0);
  if (expected && expected !== current) {
    const error = new Error('人物与场景分配已被其他修改更新，请刷新后再保存');
    error.status = 409;
    error.code = 'SCENE_WORLD_ASSIGNMENT_CONFLICT';
    error.current_world_revision = current;
    throw error;
  }
  const normalized = list(assignments).slice(0, 500).map(item => ({
    character_id: clean(item.character_id, 120),
    world_id: clean(item.world_id, 120),
    presence: ['confirmed', 'excluded', 'unassigned'].includes(clean(item.presence, 30)) ? clean(item.presence, 30) : 'unassigned',
    role: clean(item.role, 260),
    look_id: clean(item.look_id, 100), age_state_id: clean(item.age_state_id, 100), story_state_id: clean(item.story_state_id, 100),
    appearance_order: Math.max(0, finite(item.appearance_order, 0)), entry_direction: clean(item.entry_direction, 80), exit_direction: clean(item.exit_direction, 80),
    blocking: clean(item.blocking, 260), camera_id: clean(item.camera_id, 120),
  })).filter(item => item.character_id && item.world_id);
  const payload = {
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    worlds: stored.worlds || {},
    assignments: normalized,
    assignment_revision: current + 1,
    updated_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, 'scene_world_overrides', payload, { content_revision: options.content_revision });
  return { assignments: normalized, assignment_revision: payload.assignment_revision };
}

module.exports = {
  SCENE_WORLD_SCHEMA_VERSION,
  buildSceneWorlds,
  hasSceneVisualAuthority,
  validPanorama,
  panoramaAssets,
  inferCapabilities,
  productionManifest,
  resolve,
  saveWorld,
  saveAssignments,
  historicalStoryboard,
};
