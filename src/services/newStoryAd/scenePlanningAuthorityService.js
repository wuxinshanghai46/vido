'use strict';

const crypto = require('crypto');
const { normalizeScenePlan } = require('./sceneBindingService');
const { closeSceneSpec } = require('./generationSpecCompletionService');

const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value = '', max = 1600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const point = value => Array.isArray(value) ? value.slice(0, 3).map(Number).filter(Number.isFinite) : [];

function fingerprint(value = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function idOf(value = {}, index = 0) {
  return clean(value.scene_id || value.space_id || value.id || `scene_${index + 1}`, 120);
}

function mergeByIdentity(primary = [], secondary = [], identity) {
  const result = list(primary).map(item => ({ ...item }));
  list(secondary).forEach((item, index) => {
    const key = identity(item, index);
    const existing = result.findIndex((row, rowIndex) => identity(row, rowIndex) === key);
    if (existing >= 0) result[existing] = { ...item, ...result[existing] };
    else result.push({ ...item });
  });
  return result;
}

function normalizedCamera(camera = {}, index = 0) {
  return {
    ...camera,
    id: clean(camera.id || camera.camera_id || `camera_${index + 1}`, 120),
    view_id: clean(camera.view_id || camera.view || camera.key, 80),
    normalized_position: point(camera.normalized_position || camera.position_on_layout || camera.position),
    look_at: point(camera.look_at || camera.target_on_layout || camera.lookAt),
    coordinate_source: clean(camera.coordinate_source || 'deterministic_director_plan', 80),
  };
}

function normalizedAnchor(anchor = {}, index = 0) {
  return {
    ...anchor,
    id: clean(anchor.id || anchor.anchor_id || `anchor_${index + 1}`, 120),
    label: clean(anchor.label || anchor.name || `互动点 ${index + 1}`, 160),
    description: clean(anchor.description || anchor.purpose || anchor.contact_rules?.join('；'), 600),
    normalized_position: point(anchor.normalized_position || anchor.position_on_layout || anchor.position),
    required: anchor.required !== false,
    coordinate_source: clean(anchor.coordinate_source || 'deterministic_director_plan', 80),
  };
}

function assignmentsForScene(overrides = {}, sceneId = '') {
  return list(overrides.assignments).filter(item => clean(item.world_id, 120) === sceneId).map(item => ({
    character_id: clean(item.character_id, 120), presence: clean(item.presence, 40), role: clean(item.role, 300),
    look_id: clean(item.look_id, 120), camera_id: clean(item.camera_id, 120), blocking: clean(item.blocking, 500),
    blocking_position: point(item.blocking_position), entry_point: point(item.entry_point),
    exit_point: point(item.exit_point), route_points: list(item.route_points).map(point),
  }));
}

function planningContract(asset = {}) {
  const spec = asset.scene_spec && typeof asset.scene_spec === 'object' ? asset.scene_spec : {};
  const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
  return {
    schema_version: 1,
    scene_id: idOf(asset),
    scene_revision: Math.max(0, Number(asset.scene_revision || asset.revision || contract.scene_revision || 0) || 0),
    layout: clean(spec.layoutText || spec.layout_text || spec.layout, 1800),
    materials_and_light: clean(spec.materialLightText || spec.material_light_text, 1600),
    interaction: clean(spec.interactionText || spec.interaction_text, 1400),
    negative: clean(spec.negativeText || spec.negative_text, 1200),
    story_states: list(spec.storyStates || spec.story_states),
    interaction_anchors: list(contract.anchors).map(normalizedAnchor),
    routes: list(spec.routes || spec.movement_routes),
    cameras: list(contract.cameras).map(normalizedCamera),
    scene_experience_contract: spec.sceneExperienceContract || spec.scene_experience_contract || {},
    actor_blocking_required: asset.scene_plan_actor_blocking_required === true,
    assignment_revision: Math.max(0, Number(asset.scene_assignment_revision || 0) || 0),
    assignments: list(asset.scene_assignments),
  };
}

function enrichSceneAssets(sceneAssets = [], scenePlan = {}, context = {}, overrides = {}) {
  const plan = normalizeScenePlan(scenePlan || {});
  const plannedById = new Map(list(plan.spaces).map((space, index) => [idOf(space, index), space]));
  return list(sceneAssets).map((asset, index) => {
    const sceneId = idOf(asset, index);
    const space = plannedById.get(sceneId) || list(plan.spaces)[index] || {};
    const sourceSpec = space.scene_spec || asset.scene_spec || {};
    const sourceExperience = sourceSpec.sceneExperienceContract || sourceSpec.scene_experience_contract || {};
    const sourceInteraction = clean(sourceSpec.interactionText || sourceSpec.interaction_text, 1400);
    const actorBlockingRequired = sourceExperience.actor_blocking_required === true
      || /人物|角色|演员|模特|顾客|客户|走入|进入|触摸|接触|拿取|离开|person|actor|presenter|customer/iu.test(sourceInteraction);
    const closedSpec = closeSceneSpec(sourceSpec, {
      scene_id: sceneId,
      scene_name: space.name || asset.name || asset.scene_name || `场景 ${index + 1}`,
      content_mode: context.content_mode || '',
    }).scene_spec;
    const rawContract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const plannedCameras = list(closedSpec.cameraPlan || closedSpec.camera_plan).map(normalizedCamera);
    const rawCameras = list(rawContract.cameras).map(normalizedCamera);
    const cameras = mergeByIdentity(rawCameras, plannedCameras,
      (camera, cameraIndex) => clean(camera.view_id || camera.id || `camera_${cameraIndex + 1}`, 120)).map((camera, cameraIndex) => {
      const planned = plannedCameras.find(item => item.view_id && item.view_id === camera.view_id) || plannedCameras[cameraIndex] || {};
      const normalized = normalizedCamera(camera, cameraIndex);
      return {
        ...planned,
        ...normalized,
        normalized_position: normalized.normalized_position.length ? normalized.normalized_position : point(planned.normalized_position),
        look_at: normalized.look_at.length ? normalized.look_at : point(planned.look_at),
      };
    });
    const plannedAnchors = list(closedSpec.interactionAnchors || closedSpec.interaction_anchors).map(normalizedAnchor);
    const rawAnchors = list(rawContract.anchors).map(normalizedAnchor);
    const anchors = mergeByIdentity(rawAnchors, plannedAnchors,
      (anchor, anchorIndex) => clean(anchor.id || `anchor_${anchorIndex + 1}`, 120)).map((anchor, anchorIndex) => {
      const planned = plannedAnchors.find(item => item.id && item.id === anchor.id) || plannedAnchors[anchorIndex] || {};
      const normalized = normalizedAnchor(anchor, anchorIndex);
      return {
        ...planned,
        ...normalized,
        normalized_position: normalized.normalized_position.length ? normalized.normalized_position : point(planned.normalized_position),
      };
    });
    const sceneAssignments = assignmentsForScene(overrides, sceneId);
    const enriched = {
      ...asset,
      scene_id: sceneId,
      scene_spec: { ...closedSpec, cameraPlan: plannedCameras, interactionAnchors: plannedAnchors },
      camera_plan: plannedCameras,
      scene_contract: { ...rawContract, cameras, anchors },
      scene_assignment_revision: sceneAssignments.length ? Math.max(0, Number(overrides.assignment_revision || 0) || 0) : 0,
      scene_assignments: sceneAssignments,
      scene_plan_actor_blocking_required: actorBlockingRequired,
    };
    enriched.scene_planning_fingerprint = fingerprint(planningContract(enriched));
    return enriched;
  });
}

function contractForShot(asset = {}, shot = {}) {
  const base = planningContract(asset);
  const cameraId = clean(shot.camera_id, 120);
  const viewId = clean(shot.scene_view || shot.sceneView, 80);
  const camera = base.cameras.find(item => cameraId && item.id === cameraId)
    || base.cameras.find(item => viewId && item.view_id === viewId) || null;
  const anchorIds = new Set(list(shot.anchor_ids).map(value => clean(value, 120)));
  const anchors = anchorIds.size ? base.interaction_anchors.filter(item => anchorIds.has(item.id)) : base.interaction_anchors;
  return {
    ...base,
    selected_camera: camera,
    required_anchor_ids: [...anchorIds],
    selected_anchors: anchors,
    shot_zone_ids: list(shot.zone_ids).map(value => clean(value, 120)),
    subject_position: clean(shot.subject_position, 500),
    scene_context_role: clean(shot.scene_context_role, 120),
  };
}

module.exports = { fingerprint, idOf, planningContract, enrichSceneAssets, contractForShot };
