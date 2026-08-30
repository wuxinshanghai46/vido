const crypto = require('crypto');
const storage = require('../newStoryAd/storageService');

const DIRECTOR_SCENE_SCHEMA_VERSION = 1;
const OUTPUT_KIND = 'director_scene_states';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function text(value, max = 180) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function number(value, fallback = 0, min = -100, max = 100) {
  const parsed = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}
function vector(value, fallback = [0, 0, 0], min = -100, max = 100) {
  const row = Array.isArray(value) ? value : fallback;
  return [0, 1, 2].map(index => Number(number(row[index], fallback[index] || 0, min, max).toFixed(4)));
}
function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sourceContract(world = {}) {
  return {
    world_id: text(world.id, 120),
    world_revision: Math.max(1, number(world.revision, 1, 1, 1000000)),
    source_revision: Math.max(0, number(world.source_asset?.source_revision, 0, 0, 1000000)),
    zones: list(world.zones).map(zone => ({ id: text(zone.id, 120), bounds: zone.bounds || {} })),
    cameras: list(world.cameras).map(camera => ({ id: text(camera.id, 120), pose: camera.pose || {} })),
    source_image: text(world.source_asset?.image_url, 1000),
    layout_image: text(world.source_asset?.layout_image_url, 1000),
    scene_planning_fingerprint: text(world.scene_planning_fingerprint, 160),
    assignment_revision: Math.max(0, number(world.scene_assignment_revision, 0, 0, 1000000)),
  };
}

function defaultEntities(bundle = {}, world = {}, manifest = {}) {
  const subjectMatrix = list(manifest.subject_world_matrix).length ? list(manifest.subject_world_matrix) : list(manifest.character_world_matrix);
  const cellsByCharacter = new Map(subjectMatrix.map(row => [String(row.character_id || row.subject_id), row]));
  const people = list(bundle.assets?.people).filter(person => {
    const id = text(person.subject_id || person.profile?.id || person.id, 120);
    const cell = list(cellsByCharacter.get(id)?.cells).find(item => String(item.world_id) === String(world.id));
    return cell?.presence !== 'excluded';
  }).map((person, index) => {
    const id = text(person.subject_id || person.profile?.id || person.id || `person-${index + 1}`, 120);
    const cell = list(cellsByCharacter.get(id)?.cells).find(item => String(item.world_id) === String(world.id));
    const point = Array.isArray(cell?.blocking_position) ? cell.blocking_position : [];
    return ({
    entity_id: id,
    entity_revision: Math.max(1, number(person.revision || person.person_revision, 1, 1, 1000000)),
    kind: 'person', gender: text(person.gender || person.profile?.gender, 24).toLowerCase(),
    label: text(person.name || person.profile?.displayName || `人物 ${index + 1}`, 120),
    image_url: text(person.image_url || person.referenceImageUrl || person.dossier_sheet?.image_url, 1000),
    position: point.length >= 2 ? [Number(((point[0] - .5) * 12).toFixed(3)), 0, Number(((point[1] - .5) * 8).toFixed(3))] : [0, 0, 0],
    coordinate_planned: point.length >= 2,
    rotation: [0, 0, 0], scale: [1, 1, 1], pose_id: 'neutral_stand', visible: point.length >= 2,
  }); });
  const animals = list(bundle.assets?.animals).filter(animal => {
    const id = text(animal.subject_id || animal.id || animal.asset_id, 120);
    const cell = list(cellsByCharacter.get(id)?.cells).find(item => String(item.world_id) === String(world.id));
    return cell?.presence !== 'excluded';
  }).map((animal, index) => {
    const id = text(animal.subject_id || animal.id || animal.asset_id || `animal-${index + 1}`, 120);
    const row = cellsByCharacter.get(id) || {};
    const cell = list(row.cells).find(item => String(item.world_id) === String(world.id));
    const point = Array.isArray(cell?.blocking_position) ? cell.blocking_position : [];
    return {
      entity_id: id, entity_revision: Math.max(1, number(animal.revision, 1, 1, 1000000)),
      kind: 'animal', species: text(row.species || animal.profile?.species || animal.role || animal.name, 80),
      label: text(animal.name || `动物 ${index + 1}`, 120), image_url: text(animal.image_url, 1000),
      position: point.length >= 2 ? [Number(((point[0] - .5) * 12).toFixed(3)), 0, Number(((point[1] - .5) * 8).toFixed(3))] : [0, 0, 0],
      coordinate_planned: point.length >= 2,
      rotation: [0, 0, 0], scale: [.8, .8, .8], pose_id: 'neutral', visible: point.length >= 2,
    };
  });
  const products = list(bundle.assets?.products).slice(0, 12).map((product, index) => ({
    entity_id: text(product.id || product.asset_id || `product-${index + 1}`, 120),
    entity_revision: Math.max(1, number(product.revision, 1, 1, 1000000)),
    kind: 'product', label: text(product.name || `商品 ${index + 1}`, 120),
    image_url: text(product.image_url || product.url, 1000),
    position: [Number(((index + 1) * 1.2).toFixed(3)), 0.45, -1.2],
    rotation: [0, 0, 0], scale: [0.7, 0.7, 0.7], pose_id: '', visible: true,
  }));
  return [...people, ...animals, ...products].slice(0, 60);
}

function defaultPaths(world = {}, manifest = {}) {
  const matrix = list(manifest.subject_world_matrix).length ? list(manifest.subject_world_matrix) : list(manifest.character_world_matrix);
  return matrix.flatMap(row => {
    const cell = list(row.cells).find(item => String(item.world_id) === String(world.id));
    if (!cell || !['confirmed', 'suggested'].includes(cell.presence)) return [];
    const points = [cell.entry_point, ...list(cell.route_points), cell.blocking_position, cell.exit_point]
      .filter(point => Array.isArray(point) && point.length >= 2)
      .map((point, index) => ({ position: [Number(((point[0] - .5) * 12).toFixed(3)), .04, Number(((point[1] - .5) * 8).toFixed(3))], time_sec: index }));
    return points.length < 2 ? [] : [{
      path_id: `path:${text(row.character_id || row.subject_id, 100)}`, kind: 'actor',
      entity_id: text(row.character_id || row.subject_id, 120), duration_sec: Math.max(1, points.length - 1), easing: 'ease_in_out', points,
    }];
  });
}

function defaultCameras(world = {}) {
  const cameras = list(world.cameras).map((camera, index) => ({
    camera_id: text(camera.id || `camera-${index + 1}`, 120),
    label: text(camera.name || `机位 ${index + 1}`, 120),
    position: vector(camera.pose?.position, [4 * Math.cos(index), 2, 4 * Math.sin(index)]),
    look_at: vector(camera.pose?.look_at, [0, 1, 0]),
    rotation: [number(camera.pose?.pitch, -8, -90, 90), number(camera.pose?.yaw, 0, -360, 360), number(camera.pose?.roll, 0, -180, 180)],
    focal_length: number(String(camera.lens || '').match(/\d+(?:\.\d+)?/)?.[0], 35, 8, 300),
    fov: number(camera.pose?.fov, 52, 10, 120),
    framing: text(camera.framing, 80),
  }));
  return cameras.length ? cameras.slice(0, 30) : [{
    camera_id: `${text(world.id, 100)}:director:camera:1`, label: '导演机位 1',
    position: [4.8, 2.2, 5.8], look_at: [0, 1, 0], rotation: [-8, 0, 0],
    focal_length: 35, fov: 52, framing: '中景',
  }];
}

function normalizeEntity(entity = {}, index = 0) {
  return {
    entity_id: text(entity.entity_id || entity.id || `entity-${index + 1}`, 120),
    entity_revision: Math.max(1, number(entity.entity_revision || entity.revision, 1, 1, 1000000)),
    kind: text(entity.kind || 'object', 40), label: text(entity.label || entity.name || `实体 ${index + 1}`, 120),
    gender: text(entity.gender, 24).toLowerCase(), species: text(entity.species, 80),
    coordinate_planned: entity.coordinate_planned === true,
    image_url: text(entity.image_url || entity.url, 1000), position: vector(entity.position),
    rotation: vector(entity.rotation, [0, 0, 0], -360, 360),
    scale: vector(entity.scale, [1, 1, 1], 0.05, 20), pose_id: text(entity.pose_id, 80),
    visible: entity.visible !== false,
  };
}

function normalizeCamera(camera = {}, index = 0) {
  return {
    camera_id: text(camera.camera_id || camera.id || `camera-${index + 1}`, 120),
    label: text(camera.label || camera.name || `机位 ${index + 1}`, 120),
    position: vector(camera.position, [4.8, 2.2, 5.8]), look_at: vector(camera.look_at, [0, 1, 0]),
    rotation: vector(camera.rotation, [-8, 0, 0], -360, 360),
    focal_length: number(camera.focal_length, 35, 8, 300), fov: number(camera.fov, 52, 10, 120),
    framing: text(camera.framing, 80),
  };
}

function normalizePath(path = {}, index = 0) {
  return {
    path_id: text(path.path_id || path.id || `path-${index + 1}`, 120),
    kind: ['camera', 'actor', 'vehicle', 'object'].includes(text(path.kind, 30)) ? text(path.kind, 30) : 'actor',
    entity_id: text(path.entity_id || path.camera_id, 120),
    duration_sec: number(path.duration_sec, 3, 0.1, 120), easing: text(path.easing || 'ease_in_out', 40),
    points: list(path.points).slice(0, 80).map(point => ({
      position: vector(point.position || point), time_sec: number(point.time_sec, 0, 0, 120),
      look_at: Array.isArray(point.look_at) ? vector(point.look_at) : undefined,
    })),
  };
}

function normalizeSnapshot(snapshot = {}, index = 0, lineage = {}) {
  return {
    snapshot_id: text(snapshot.snapshot_id || snapshot.id || `snapshot-${index + 1}`, 120),
    camera_id: text(snapshot.camera_id, 120), label: text(snapshot.label || `导演截图 ${index + 1}`, 120),
    image_url: text(snapshot.image_url || snapshot.url, 1000), sha256: text(snapshot.sha256, 80),
    assignment_revision: Math.max(0, number(snapshot.assignment_revision || lineage.assignment_revision, 0, 0, 1000000)),
    scene_planning_fingerprint: text(snapshot.scene_planning_fingerprint || lineage.scene_planning_fingerprint, 160),
    created_at: text(snapshot.created_at || new Date().toISOString(), 80),
  };
}

function defaultState(bundle = {}, world = {}, manifest = {}) {
  const contract = sourceContract(world);
  return {
    schema_version: DIRECTOR_SCENE_SCHEMA_VERSION, director_scene_id: `director:${text(world.id, 100)}`,
    world_id: text(world.id, 120), world_revision: Math.max(1, number(world.revision, 1, 1, 1000000)), revision: 1,
    source_revision: Math.max(0, number(world.source_asset?.source_revision, 0, 0, 1000000)),
    assignment_revision: Math.max(0, number(manifest.assignment_revision || world.scene_assignment_revision, 0, 0, 1000000)),
    scene_planning_fingerprint: text(world.scene_planning_fingerprint, 160),
    source_contract_hash: stableHash(contract), status: 'draft', entities: defaultEntities(bundle, world, manifest),
    cameras: defaultCameras(world), paths: defaultPaths(world, manifest), snapshots: [], updated_at: '',
  };
}

function storedPayload(taskId) {
  return storage.getOutput(taskId, OUTPUT_KIND) || { schema_version: DIRECTOR_SCENE_SCHEMA_VERSION, states: {} };
}

function resolveStored(bundle = {}, world = {}, manifest = {}, stored = null) {
  const base = defaultState(bundle, world, manifest);
  if (!stored) return base;
  const currentHash = base.source_contract_hash;
  const currentEntities = new Map(list(base.entities).map(entity => [String(entity.entity_id), entity]));
  const staleEntityRefs = list(stored.entities).filter(entity => {
    const current = currentEntities.get(String(entity.entity_id));
    if (!current) return ['person', 'product'].includes(String(entity.kind || ''));
    return Number(current.entity_revision || 0) !== Number(entity.entity_revision || 0);
  }).map(entity => text(entity.entity_id, 120));
  const sourceCurrent = stored.source_contract_hash === currentHash;
  const entitiesCurrent = staleEntityRefs.length === 0;
  const storedEntities = new Map(list(stored.entities).map(entity => [String(entity.entity_id), entity]));
  const mergedEntities = [
    ...list(base.entities).map(entity => {
      const merged = { ...entity, ...(storedEntities.get(String(entity.entity_id)) || {}) };
      if (['person', 'animal'].includes(entity.kind) && entity.coordinate_planned === false) merged.visible = false;
      return merged;
    }),
    ...list(stored.entities).filter(entity => !currentEntities.has(String(entity.entity_id))),
  ];
  return {
    ...base, ...stored, world_id: base.world_id, world_revision: base.world_revision,
    entities: mergedEntities,
    paths: list(stored.paths).length ? stored.paths : base.paths,
    source_contract_hash: currentHash,
    compatibility_status: !sourceCurrent ? 'stale_source' : (entitiesCurrent ? 'current' : 'stale_entities'),
    stale_entity_refs: staleEntityRefs,
    status: sourceCurrent && entitiesCurrent ? (stored.status || 'active_verified') : 'stale_input',
  };
}

function resolve(taskId, bundle = {}, world = {}, manifest = {}) {
  return resolveStored(bundle, world, manifest, storedPayload(taskId).states?.[world.id]);
}

function projectedSummary(state = {}) {
  return {
    director_scene_id: text(state.director_scene_id, 120),
    world_id: text(state.world_id, 120),
    revision: Math.max(1, number(state.revision, 1, 1, 1000000)),
    world_revision: Math.max(1, number(state.world_revision, 1, 1, 1000000)),
    source_revision: Math.max(0, number(state.source_revision, 0, 0, 1000000)),
    status: text(state.status || 'draft', 50),
    compatibility_status: text(state.compatibility_status || 'current', 50),
    entity_refs: list(state.entities).slice(0, 60).map(entity => ({
      entity_id: text(entity.entity_id, 120),
      entity_revision: Math.max(1, number(entity.entity_revision, 1, 1, 1000000)),
      kind: text(entity.kind, 40),
    })),
    camera_count: list(state.cameras).length,
    path_count: list(state.paths).length,
    snapshot_count: list(state.snapshots).length,
    updated_at: text(state.updated_at, 80),
  };
}

function listProjected(taskId, bundle = {}, worlds = [], manifest = {}) {
  const states = storedPayload(taskId).states || {};
  return list(worlds).slice(0, 120).map(world => projectedSummary(
    resolveStored(bundle, world, manifest, states[world.id]),
  ));
}

function save(taskId, bundle = {}, world = {}, patch = {}, options = {}) {
  const payload = storedPayload(taskId);
  const current = resolve(taskId, bundle, world, options.manifest || {});
  const expected = number(options.expected_revision ?? patch.expected_revision, 0, 0, 1000000);
  if (expected && expected !== current.revision) {
    const error = new Error('导演场景已经在其他页面更新，请刷新后再保存');
    error.status = 409; error.code = 'DIRECTOR_SCENE_REVISION_CONFLICT'; error.current_director_revision = current.revision;
    throw error;
  }
  const next = {
    ...current, schema_version: DIRECTOR_SCENE_SCHEMA_VERSION, revision: current.revision + 1,
    world_revision: Math.max(1, number(world.revision, 1, 1, 1000000)), source_contract_hash: stableHash(sourceContract(world)),
    source_revision: Math.max(0, number(world.source_asset?.source_revision, 0, 0, 1000000)),
    status: 'active_verified', compatibility_status: 'current',
    entities: list(patch.entities ?? current.entities).slice(0, 60).map(normalizeEntity),
    cameras: list(patch.cameras ?? current.cameras).slice(0, 30).map(normalizeCamera),
    paths: list(patch.paths ?? current.paths).slice(0, 80).map(normalizePath),
    assignment_revision: Math.max(0, number(options.manifest?.assignment_revision, current.assignment_revision || 0, 0, 1000000)),
    scene_planning_fingerprint: text(world.scene_planning_fingerprint || current.scene_planning_fingerprint, 160),
    snapshots: list(patch.snapshots ?? current.snapshots).slice(-30).map((snapshot, index) => normalizeSnapshot(snapshot, index, {
      assignment_revision: options.manifest?.assignment_revision || current.assignment_revision || 0,
      scene_planning_fingerprint: world.scene_planning_fingerprint || current.scene_planning_fingerprint || '',
    })),
    updated_at: new Date().toISOString(),
  };
  delete next.expected_revision;
  storage.saveOutput(taskId, OUTPUT_KIND, {
    schema_version: DIRECTOR_SCENE_SCHEMA_VERSION,
    states: { ...(payload.states || {}), [world.id]: next },
    updated_at: next.updated_at,
  }, { content_revision: options.content_revision });
  return next;
}

function activeSnapshot(taskId, worldId, options = {}) {
  const state = storedPayload(taskId).states?.[worldId];
  if (!state || state.status !== 'active_verified') return null;
  const requiredSourceRevision = Math.max(0, number(options.source_revision, 0, 0, 1000000));
  if (requiredSourceRevision && state.source_revision && requiredSourceRevision !== state.source_revision) return null;
  const expectedEntityRevisions = options.entity_revisions && typeof options.entity_revisions === 'object'
    ? options.entity_revisions
    : {};
  if (Object.keys(expectedEntityRevisions).length && list(state.entities).some(entity => {
    if (!['person', 'product'].includes(String(entity.kind || ''))) return false;
    const expected = Number(expectedEntityRevisions[entity.entity_id] || 0);
    return expected > 0 && expected !== Number(entity.entity_revision || 0);
  })) return null;
  const cameraId = text(options.camera_id, 120);
  const assignmentRevision = Math.max(0, number(options.assignment_revision, 0, 0, 1000000));
  if (assignmentRevision && Number(state.assignment_revision || 0) !== assignmentRevision) return null;
  const planningFingerprint = text(options.scene_planning_fingerprint, 160);
  if (planningFingerprint && text(state.scene_planning_fingerprint, 160) !== planningFingerprint) return null;
  const snapshots = list(state.snapshots).filter(item => text(item.image_url, 1000));
  return (cameraId ? snapshots.find(item => item.camera_id === cameraId) : null) || snapshots.at(-1) || null;
}

module.exports = {
  DIRECTOR_SCENE_SCHEMA_VERSION,
  OUTPUT_KIND,
  sourceContract,
  stableHash,
  defaultState,
  resolve,
  save,
  activeSnapshot,
  projectedSummary,
  listProjected,
};
