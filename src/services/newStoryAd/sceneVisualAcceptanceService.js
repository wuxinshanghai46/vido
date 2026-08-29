'use strict';

const storageDefault = require('./storageService');

const OUTPUT_KIND = 'scene_visual_acceptance';
const REQUIRED_VIEWS = Object.freeze(['master', 'reverse', 'interaction', 'detail', 'layout']);

function text(value = '') { return String(value || '').trim(); }
function list(value) { return Array.isArray(value) ? value : []; }
function sceneId(scene = {}, index = 0) { return text(scene.scene_id || scene.id || `scene-${index + 1}`); }
function viewKey(view = {}) { return text(view.key || view.view_id || view.id).toLowerCase(); }
function viewUrl(view = {}) { return text(view.image_url || view.url); }

function requiredViewMap(scene = {}) {
  const rows = list(scene.view_images);
  const find = (...keys) => rows.find(row => keys.includes(viewKey(row)) && viewUrl(row));
  const reserved = new Set(['reverse', 'interaction', 'detail', 'layout']);
  const masterFallback = rows.find(row => viewUrl(row) && !reserved.has(viewKey(row)));
  const candidates = {
    master: viewUrl(scene.scene_master) ? scene.scene_master : (find('master', 'atlas') || masterFallback),
    reverse: find('reverse'),
    interaction: find('interaction'),
    detail: find('detail'),
    layout: viewUrl(scene.layout) ? scene.layout : find('layout'),
  };
  const used = new Set();
  return Object.fromEntries(REQUIRED_VIEWS.map(key => {
    const row = candidates[key] || {};
    const url = viewUrl(row);
    if (!url || used.has(url)) return [key, null];
    used.add(url);
    return [key, {
      image_url: url,
      asset_hash: text(row.file_sha256 || row.sha256 || row.asset_hash),
      revision: Number(row.revision || 0) || 0,
    }];
  }));
}

function plannedScenes(scenes = []) {
  return list(scenes).filter(scene => scene && scene.planned !== false && scene.reference_only !== true);
}

function fingerprint(scenes = [], storage = storageDefault) {
  return storage.canonicalFingerprint(plannedScenes(scenes).map((scene, index) => ({
    scene_id: sceneId(scene, index),
    revision: Number(scene.revision || 0) || 0,
    views: requiredViewMap(scene),
  })).sort((a, b) => a.scene_id.localeCompare(b.scene_id)));
}

function inspect(scenes = [], acceptance = null, storage = storageDefault) {
  const planned = plannedScenes(scenes);
  const missing = planned.flatMap((scene, index) => {
    const mapped = requiredViewMap(scene);
    return REQUIRED_VIEWS.filter(key => !mapped[key]).map(key => ({ scene_id: sceneId(scene, index), view_key: key }));
  });
  const currentFingerprint = fingerprint(planned, storage);
  const accepted = Boolean(acceptance
    && acceptance.status === 'accepted'
    && text(acceptance.scene_fingerprint)
    && text(acceptance.scene_fingerprint) === currentFingerprint
    && planned.length > 0
    && missing.length === 0);
  return {
    planned_count: planned.length,
    all_views_complete: planned.length > 0 && missing.length === 0,
    missing,
    scene_fingerprint: currentFingerprint,
    accepted,
    acceptance: accepted ? acceptance : null,
  };
}

function invalidateIfChanged(taskId, scenes = [], storage = storageDefault) {
  const acceptance = storage.getOutput(taskId, OUTPUT_KIND);
  if (!acceptance || acceptance.status !== 'accepted') return acceptance || null;
  const planned = plannedScenes(scenes);
  const supersededByQa = planned.length > 0 && planned.every(scene => scene?.qa?.full_space_lock === true);
  const state = inspect(planned, acceptance, storage);
  if (state.accepted && !supersededByQa) return acceptance;
  const next = {
    ...acceptance,
    status: supersededByQa ? 'superseded_by_qa' : 'invalidated',
    invalidated_at: new Date().toISOString(),
    invalidation_reason: supersededByQa ? 'qa_verified' : 'scene_assets_changed',
  };
  storage.saveOutput(taskId, OUTPUT_KIND, next);
  return next;
}

function create(deps = {}) {
  const storage = deps.storage || storageDefault;
  function acceptCurrent(taskId, actor = {}) {
    const task = storage.getTask(taskId);
    if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404, retryable: false });
    if (text(task.active_generation_id)) throw Object.assign(new Error('当前场景任务仍在运行，请等待结束后再继续。'), {
      code: 'SCENE_ACCEPTANCE_GENERATION_ACTIVE', status: 409, retryable: false,
    });
    const scenes = storage.getOutput(taskId, 'scene_assets') || task.request?.scene_assets || [];
    const state = inspect(scenes, null, storage);
    if (!state.all_views_complete) throw Object.assign(new Error('仍有场景图片缺失，不能跳过生成。请先补齐全部五类视图。'), {
      code: 'SCENE_ACCEPTANCE_IMAGES_INCOMPLETE', status: 409, retryable: false, details: { missing: state.missing },
    });
    const now = new Date().toISOString();
    const record = {
      schema_version: 1,
      status: 'accepted',
      mode: 'explicit_user_acceptance',
      scene_fingerprint: state.scene_fingerprint,
      accepted_at: now,
      accepted_by: text(actor.id || actor.user_id || actor.userId).slice(0, 120),
      scene_count: state.planned_count,
      unresolved_scene_ids: plannedScenes(scenes)
        .filter(scene => scene.qa?.full_space_lock !== true)
        .map((scene, index) => sceneId(scene, index)),
      model_call_count: 0,
    };
    storage.withWriteBatch(() => {
      storage.saveOutput(taskId, OUTPUT_KIND, record, { content_revision: task.content_revision });
      const context = storage.getOutput(taskId, 'context') || task.request || {};
      const nextContext = { ...context, scene_setup_confirmed: true };
      storage.saveOutput(taskId, 'context', nextContext, { content_revision: task.content_revision });
      storage.updateTask(taskId, { request: nextContext, updated_at: now });
    });
    return record;
  }
  return { acceptCurrent, inspect: (scenes, acceptance) => inspect(scenes, acceptance, storage) };
}

module.exports = { OUTPUT_KIND, REQUIRED_VIEWS, create, fingerprint, inspect, invalidateIfChanged, requiredViewMap };
