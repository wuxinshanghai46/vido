'use strict';

const storage = require('./storageService');

const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value = '', max = 1600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

// V301 及更早图片使用的不可变兼容口径。旧图只按生成当时已经存在的
// 字段比较；升级到 schema 2 后才启用机位、锚点、站位等完整空间血缘。
function legacyShotContractFingerprint(shot = {}, index = 0) {
  return storage.canonicalFingerprint({
    shot_id: clean(shot.shot_id || `shot_${index + 1}`, 160),
    source_beat_id: clean(shot.source_beat_id, 160),
    scene_id: clean(shot.scene_id || shot.scene_asset_id, 160),
    character_ids: list(shot.character_ids).map(value => clean(value, 160)),
    look_bindings: shot.look_bindings || {},
    visual: clean(shot.visual || shot.visual_description),
    action: clean(shot.action, 800),
    shot_size: clean(shot.shot_size, 80),
    camera_angle: clean(shot.camera_angle, 80),
    camera_movement: clean(shot.camera_movement, 120),
    lens_mm: Number(shot.lens_mm || 0) || 0,
  });
}

function shotContractFingerprint(shot = {}, index = 0) {
  return storage.canonicalFingerprint({
    shot_id: clean(shot.shot_id || `shot_${index + 1}`, 160),
    source_beat_id: clean(shot.source_beat_id, 160),
    scene_id: clean(shot.scene_id || shot.scene_asset_id, 160),
    scene_view: clean(shot.scene_view || shot.sceneView, 80),
    camera_id: clean(shot.camera_id, 160),
    zone_ids: list(shot.zone_ids).map(value => clean(value, 160)),
    anchor_ids: list(shot.anchor_ids).map(value => clean(value, 160)),
    character_ids: list(shot.character_ids).map(value => clean(value, 160)),
    characters: list(shot.characters).map(item => typeof item === 'string' ? clean(item, 240) : {
      id: clean(item?.id || item?.character_id, 160), name: clean(item?.name, 160), action: clean(item?.action, 500),
    }),
    expected_people: Math.max(0, Number(shot.expected_people || 0) || 0),
    subject_type: clean(shot.subject_type, 80),
    look_bindings: shot.look_bindings || {},
    visual: clean(shot.visual || shot.visual_description),
    action: clean(shot.action, 800),
    keyframe_notes: clean(shot.keyframe_notes, 1200),
    shot_size: clean(shot.shot_size, 80),
    camera_angle: clean(shot.camera_angle, 80),
    camera_movement: clean(shot.camera_movement, 120),
    lens_mm: Number(shot.lens_mm || 0) || 0,
    composition: clean(shot.composition, 500),
    subject_position: clean(shot.subject_position, 500),
    scene_context_role: clean(shot.scene_context_role, 120),
  });
}

module.exports = { legacyShotContractFingerprint, shotContractFingerprint };
