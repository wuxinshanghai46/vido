'use strict';

const { closeSceneSpec } = require('../newStoryAd/generationSpecCompletionService');
const { projectSceneCamera, projectShootingRules } = require('./sceneCameraProjectionService');
const semantic = require('./productionSemanticLocalizationService');

const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value = '', max = 240) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function complete(rawSpec = {}, context = {}) {
  return closeSceneSpec(rawSpec, context).scene_spec;
}

function cameras(rawCameras = [], spec = {}, space = {}, views = []) {
  const planned = list(spec.cameraPlan || spec.camera_plan || space.camera_plan);
  return (list(rawCameras).length ? list(rawCameras) : planned).slice(0, 30).map((camera, index) => {
    const plan = planned.find(item => clean(item.view_id || item.view || item.key, 100) === clean(camera.view_id || camera.view || camera.key, 100)) || planned[index] || {};
    return semantic.sceneCamera(projectSceneCamera({
      ...plan, ...camera,
      normalized_position: camera.normalized_position || camera.position_on_layout || plan.normalized_position,
      look_at: camera.look_at || camera.target_on_layout || plan.look_at,
    }, views, index), index);
  });
}

function specContract(spec = {}) {
  return {
    mode: clean(spec.mode || 'auto', 40), layoutText: clean(spec.layoutText || spec.layout_text || spec.layout || spec.spatialLayout, 800), materialLightText: clean(spec.materialLightText || spec.material_light_text || [spec.materialText || spec.materials || spec.material, spec.lightText || spec.lighting || spec.keyLightDirection].filter(Boolean).join('；'), 800), interactionText: clean(spec.interactionText || spec.interaction_text || spec.interaction || spec.actionZone, 500), negativeText: clean(spec.negativeText || spec.negative_text || spec.negative, 500),
    layout: clean(spec.layoutText || spec.layout || spec.spatialLayout, 800), materials: clean(spec.materialText || spec.materials || spec.material || spec.materialLightText || spec.material_light_text, 600),
    weather: clean(spec.weather || spec.weatherText, 200), time: clean(spec.time || spec.timeOfDay || spec.timeText, 200), light: clean(spec.lightText || spec.lighting || spec.keyLightDirection || spec.materialLightText || spec.material_light_text, 500),
    interaction: clean(spec.interactionText || spec.interaction || spec.actionZone, 500), negative: clean(spec.negativeText || spec.negative, 500),
    storyStates: list(spec.storyStates || spec.story_states), interactionAnchors: list(spec.interactionAnchors || spec.interaction_anchors), routes: list(spec.routes || spec.movement_routes), cameraPlan: list(spec.cameraPlan || spec.camera_plan),
    sceneExperienceContract: spec.sceneExperienceContract || spec.scene_experience_contract || {},
  };
}

function cameraPlan(spec = {}, space = {}) {
  const plan = list(spec.cameraPlan || spec.camera_plan || space.camera_plan);
  return plan.slice(0, 24).map((camera, index) => ({
    id: clean(camera.id || camera.camera_id || `camera_${index + 1}`, 100), view_id: clean(camera.view_id || camera.view || camera.key, 100), coordinate_source: clean(camera.coordinate_source, 80),
    label: clean(camera.label || camera.name || `机位 ${index + 1}`, 120), zone: clean(camera.zone || camera.zone_id, 120), framing: clean(camera.framing || camera.shot_size, 100), lens: clean(camera.lens || camera.lens_class || camera.focal_length, 100), height: clean(camera.height || camera.height_class, 80),
    movement: clean(camera.movement || camera.camera_movement || camera.move, 260), movement_type: clean(camera.movement_type || camera.move_type || camera.rig || camera.support, 100), route: clean(camera.route || camera.camera_path || camera.path, 260), speed: clean(camera.speed || camera.movement_speed || camera.pace, 80),
    start_state: clean(camera.start_state || camera.start, 220), end_state: clean(camera.end_state || camera.end, 220), duration: Math.max(0, Number(camera.duration || camera.duration_sec || 0) || 0),
    subject_action: clean(camera.subject_action || camera.action || camera.performance, 260), focus: clean(camera.focus || camera.focus_target || camera.focus_plan, 220), continuity: clean(camera.continuity || camera.transition || camera.axis_rule, 260), stabilization: clean(camera.stabilization || camera.stabilizer || camera.rig_note, 180), notes: clean(camera.notes || camera.purpose, 260),
    position: Array.isArray(camera.normalized_position || camera.position) ? (camera.normalized_position || camera.position).slice(0, 3).map(Number) : [],
    look_at: Array.isArray(camera.look_at || camera.lookAt) ? (camera.look_at || camera.lookAt).slice(0, 3).map(Number) : [],
    ...projectShootingRules(camera, index, plan[index - 1] || {}),
  }));
}

module.exports = { complete, cameras, specContract, cameraPlan };
