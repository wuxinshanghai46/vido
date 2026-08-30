'use strict';

const storage = require('../newStoryAd/storageService');

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1600) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function shotContractFingerprint(shot = {}, index = 0) {
  return storage.canonicalFingerprint({
    shot_id: clean(shot.shot_id || `shot_${index + 1}`, 160), source_beat_id: clean(shot.source_beat_id, 160),
    scene_id: clean(shot.scene_id || shot.scene_asset_id, 160),
    character_ids: list(shot.character_ids).map(value => clean(value, 160)), look_bindings: shot.look_bindings || {},
    visual: clean(shot.visual || shot.visual_description), action: clean(shot.action, 800),
    shot_size: clean(shot.shot_size, 80), camera_angle: clean(shot.camera_angle, 80),
    camera_movement: clean(shot.camera_movement, 120), lens_mm: Number(shot.lens_mm || 0) || 0,
  });
}

function inspect(taskId) {
  const task = storage.getTask(taskId);
  if (!task) return { ready: false, code: 'TASK_NOT_FOUND', reason: '项目不存在', total: 0, confirmed: 0 };
  const shots = list(storage.getOutput(taskId, 'storyboard_table'));
  const images = list(storage.getOutput(taskId, 'storyboard_images'));
  const byIndex = new Map(images.map(item => [Number(item.shot_index), item]));
  const missing = [];
  const stale = [];
  shots.forEach((shot, index) => {
    const shotIndex = Number(shot.shot_index || shot.index || index + 1) || index + 1;
    const image = byIndex.get(shotIndex);
    if (!image?.image_url) missing.push(shotIndex);
    else if (image.shot_contract_fingerprint !== shotContractFingerprint(shot, index)) stale.push(shotIndex);
  });
  const ready = shots.length > 0 && !missing.length && !stale.length;
  return {
    ready,
    code: ready ? '' : 'STORYBOARD_IMAGES_REQUIRED',
    reason: ready
      ? '全部人物场景分镜图已准备好，可以继续生成后续画面。'
      : `请先生成全部人物场景分镜图（当前有效 ${Math.max(0, shots.length - missing.length - stale.length)}/${shots.length}）。${stale.length ? ` 镜头 ${stale.join('、')} 的人物、场景、动作或机位已变化，需要重新生成。` : ''}`,
    total: shots.length,
    confirmed: Math.max(0, shots.length - missing.length - stale.length),
    missing_indexes: missing,
    unconfirmed_indexes: [],
    stale_indexes: stale,
  };
}

function assertReady(taskId) {
  const state = inspect(taskId);
  if (state.ready) return state;
  throw Object.assign(new Error(state.reason), { code: state.code, status: state.code === 'TASK_NOT_FOUND' ? 404 : 409, retryable: false, details: state });
}

module.exports = { assertReady, inspect };
