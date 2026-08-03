const storage = require('../newStoryAd/storageService');

const SCENE_WORLD_SCHEMA_VERSION = 1;

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
  const direct = clean(scene.panorama_url || worldAssets.panorama_url, 1000);
  return [...(direct ? [{ image_url: direct, projection: 'equirectangular' }] : []), ...rows];
}

/**
 * Capabilities are inferred from the requested content, never from a fixed
 * industry template. Explicit user/plan overrides always win.
 */
function inferCapabilities(scene = {}) {
  const text = worldText(scene);
  const explicit = scene.capabilities || scene.scene_spec?.capabilities || {};
  const digital = /软件|APP|应用|网页|网站|界面|UI|后台|仪表盘|数字屏幕|屏幕录制/i.test(text);
  const abstract = /抽象|粒子|液体|微观|CG|三维动画|概念空间|光效|能量|数据流/i.test(text);
  const open = /道路|街道|广场|农场|田野|景区|山地|海边|沙漠|工地|运动场|园区|航拍|户外|室外/i.test(text);
  const stage = /棚拍|摄影棚|影棚|展示台|转台|产品台|无影棚|静物台|珠宝台/i.test(text);
  const enclosed = /室内|房间|展厅|门店|商场|办公室|教室|医院|实验室|工厂|车间|仓库|厨房|餐厅|酒店|住宅|舱内|车内/i.test(text);
  const physical = !digital && !abstract;
  const photoViewCount = sceneViews(scene).length;
  const panoramaCount = panoramaAssets(scene).length;
  const inferredMapMode = digital ? 'state_graph' : (open ? 'route_map' : (enclosed ? 'structure_map' : 'stage_map'));
  const inferredWorldMode = digital ? 'digital_state' : (abstract ? 'abstract_cg' : (stage ? 'studio_stage' : (open ? 'physical_open' : 'physical_space')));
  return {
    supports_photo_views: boolOverride(explicit, 'supports_photo_views', photoViewCount > 0),
    supports_panorama: boolOverride(explicit, 'supports_panorama', panoramaCount > 0),
    supports_structure_map: boolOverride(explicit, 'supports_structure_map', physical && (enclosed || open)),
    supports_3d_proxy: boolOverride(explicit, 'supports_3d_proxy', !digital && (physical || abstract || stage)),
    supports_navigation: boolOverride(explicit, 'supports_navigation', physical && (panoramaCount > 0 || photoViewCount > 1)),
    supports_camera_orbit: boolOverride(explicit, 'supports_camera_orbit', !digital && (stage || abstract || physical)),
    supports_character_blocking: boolOverride(explicit, 'supports_character_blocking', scene.no_human !== true && !/纯产品|无人|无人物/i.test(text)),
    supports_motion_path: boolOverride(explicit, 'supports_motion_path', !stage || /移动|行走|驾驶|跟随|穿行|路线/i.test(text)),
    supports_transition_portal: boolOverride(explicit, 'supports_transition_portal', true),
    supports_state_variants: boolOverride(explicit, 'supports_state_variants', /白天|夜晚|时间|灯光|变化|前后|状态|季节/i.test(text) || digital || abstract),
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
  const views = sceneViews(scene);
  const nodeCount = Math.max(1, Math.min(12, Math.max(zones.length, cameras.length, views.length)));
  return Array.from({ length: nodeCount }, (_, index) => {
    const zone = zones[index % zones.length] || zones[0];
    const camera = cameras[index] || cameras[index % Math.max(1, cameras.length)];
    const view = views[index] || views[index % Math.max(1, views.length)];
    return {
      id: `${scene.id}:observation:${index + 1}`,
      name: clean(camera?.name || view?.label || zone?.name || `观察点 ${index + 1}`, 120),
      zone_id: clean(zone?.id, 120),
      camera_id: clean(camera?.id, 120),
      image_url: clean(view?.image_url || view?.url || camera?.image_url, 1000),
      view_key: clean(view?.key || view?.view, 40),
      projection: clean(view?.projection || view?.source_role, 80),
      is_panorama: /panorama|equirect|cubemap|cube_face|360/i.test(clean([
        view?.key,
        view?.source_kind,
        view?.source_role,
        view?.projection,
      ].join(' '), 300)),
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
  return {
    id: clean(scene.id || `scene-${index + 1}`, 120),
    schema_version: SCENE_WORLD_SCHEMA_VERSION,
    revision: Math.max(1, finite(scene.revision, 1)),
    name: clean(scene.name || `场景世界 ${index + 1}`, 120),
    description: clean(scene.description, 900),
    story_purpose: clean(scene.story_purpose, 500),
    status: clean(scene.status || 'planned', 50),
    capabilities: inferCapabilities(scene),
    zones,
    cameras,
    observation_nodes: observationNodes(scene, zones, cameras),
    source_asset: {
      image_url: clean(scene.image_url, 1000),
      layout_image_url: clean(scene.layout?.image_url || layoutView?.image_url || layoutView?.url, 1000),
      photo_view_count: views.length,
      panorama_count: panoramaAssets(scene).length,
      legacy_view_count: views.length,
      source_revision: finite(scene.revision, 0),
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

function characterWorldMatrix(bundle = {}, worlds = []) {
  const people = list(bundle.assets?.people);
  const shots = list(bundle.storyboard?.shots);
  return people.map((person, personIndex) => ({
    character_id: clean(person.subject_id || person.profile?.id || person.id || `person-${personIndex + 1}`, 120),
    name: clean(person.name || person.profile?.displayName || `人物 ${personIndex + 1}`, 120),
    wardrobe: clean(person.profile?.wardrobeText, 320),
    cells: worlds.map(world => {
      const matched = shots.filter(shot => {
        const sameWorld = clean(shot.scene_id || shot.scene_asset_id, 120) === world.id;
        const characterText = list(shot.characters).map(item => clean(item?.name || item, 120)).join(' ');
        return sameWorld && (!characterText || characterText.includes(person.name) || characterText.includes(person.profile?.displayName));
      });
      return {
        world_id: world.id,
        presence: matched.length ? 'confirmed' : 'unassigned',
        shot_count: matched.length,
        role: clean(matched.map(shot => shot.action || shot.subject_action).filter(Boolean).join('；'), 260),
      };
    }),
  }));
}

function productionManifest(bundle = {}, worlds = []) {
  const transitions = routeEdges(bundle, worlds);
  return {
    schema_version: 1,
    task_id: clean(bundle.project?.id, 120),
    content_revision: finite(bundle.revisions?.content, 1),
    counts: {
      people: list(bundle.assets?.people).length,
      animals: list(bundle.assets?.animals).length,
      products: list(bundle.assets?.products).length,
      worlds: worlds.length,
      cameras: worlds.reduce((sum, world) => sum + list(world.cameras).length, 0),
      transitions: transitions.length,
    },
    character_world_matrix: characterWorldMatrix(bundle, worlds),
    transitions,
  };
}

function resolve(taskId, bundle = {}) {
  const stored = storage.getOutput(taskId, 'scene_world_overrides') || {};
  const overrides = stored.worlds && typeof stored.worlds === 'object' ? stored.worlds : {};
  const worlds = buildSceneWorlds(bundle, overrides);
  return { worlds, manifest: productionManifest(bundle, worlds) };
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
  };
  storage.saveOutput(taskId, 'scene_world_overrides', payload, { content_revision: options.content_revision });
  return next;
}

module.exports = {
  SCENE_WORLD_SCHEMA_VERSION,
  buildSceneWorlds,
  inferCapabilities,
  productionManifest,
  resolve,
  saveWorld,
};
