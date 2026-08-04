const express = require('express');
const { v4: uuidv4 } = require('uuid');
const storyAd = require('../services/newStoryAd');
const projectBundles = require('../services/storyAdWorkspace/projectBundleService');
const graphProjection = require('../services/storyAdWorkspace/graphProjectionService');
const graphLayouts = require('../services/storyAdWorkspace/graphLayoutService');
const storyboardSketches = require('../services/storyAdWorkspace/storyboardSketchService');
const sceneWorlds = require('../services/storyAdWorkspace/sceneWorldService');
const directorScenes = require('../services/storyAdWorkspace/directorSceneService');
const referenceUnderstandingConfirmations = require('../services/storyAdWorkspace/referenceUnderstandingConfirmationService');
const referenceVideoAnalyses = require('../services/newStoryAd/referenceVideoAnalysisService');
const referenceUnderstandingEdits = require('../services/newStoryAd/referenceUnderstandingEditService');
const videoCore = require('../services/videoGenerationCore');

const router = express.Router();

/** 读取认证中间件写入的当前用户。 */
function currentUser(req) {
  return req.user || req.auth || {};
}

/** 捕获独立工作区异常并复用平台中文错误格式。 */
function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      const requestId = uuidv4();
      const publicError = videoCore.chineseError.ensureChineseError(error);
      console.error(`[story-ad-workspace] request failed request_id=${requestId} code=${publicError.code || error.code || 'INTERNAL_ERROR'}:`, String(error.message || error));
      res.status(publicError.status || error.status || 500).json({
        success: false,
        code: publicError.code || error.code || 'INTERNAL_ERROR',
        error: String(publicError.message || error.message || '请求失败'),
        request_id: requestId,
        retryable: publicError.retryable === true,
        ...(Number.isInteger(error.current_layout_revision)
          ? { current_layout_revision: error.current_layout_revision }
          : {}),
        ...(Number.isInteger(error.current_world_revision)
          ? { current_world_revision: error.current_world_revision }
          : {}),
        ...(Number.isInteger(error.current_director_revision)
          ? { current_director_revision: error.current_director_revision }
          : {}),
        ...(Number.isInteger(error.current_content_revision)
          ? { current_content_revision: error.current_content_revision }
          : {}),
        ...(Number.isInteger(error.current_edit_revision)
          ? { current_edit_revision: error.current_edit_revision }
          : {}),
        ...(Array.isArray(error.failures) ? { failures: error.failures } : {}),
      });
    }
  };
}

/** 校验当前用户可以访问目标剧情广告任务。 */
function projectForRequest(req) {
  return storyAd.assertTaskOwner(req.params.taskId, currentUser(req));
}

function attachSceneWorldProjection(taskId, bundle) {
  if (!bundle?.assets) return bundle;
  const projection = sceneWorlds.resolve(taskId, bundle);
  bundle.scene_worlds = projection.worlds;
  bundle.production_manifest = projection.manifest;
  return bundle;
}

/** 每次从真实项目重新投影图谱，再叠加独立保存的用户布局。 */
function graphForRequest(req, options = {}) {
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, {
    sections: 'summary,reference,assets,story,shots,media',
    user: currentUser(req),
  });
  const sceneProjection = sceneWorlds.resolve(req.params.taskId, bundle);
  bundle.scene_worlds = sceneProjection.worlds;
  bundle.production_manifest = sceneProjection.manifest;
  bundle.director_scenes = directorScenes.listProjected(
    req.params.taskId,
    bundle,
    sceneProjection.worlds,
    sceneProjection.manifest,
  );
  const graph = graphProjection.projectGraph(bundle);
  const allowedNodeIds = new Set((graph.nodes || []).map(item => item.id));
  if (options.withLayout === false) return { graph, allowedNodeIds };
  const layout = graphLayouts.getLayout(req.params.taskId, { allowedNodeIds });
  return { graph: graphLayouts.mergeGraph(graph, layout), allowedNodeIds, layout };
}

router.get('/projects', asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const result = projectBundles.listProjects({
    limit: req.query.limit || 50,
    page: req.query.page || 1,
    status: req.query.status || '',
    userId: isAdmin && String(req.query.all || '') === '1' ? '' : (user.id || user.userId || ''),
  });
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.json({ success: true, ...result });
}));

router.post('/projects', asyncRoute(async (req, res) => {
  const body = { ...(req.body || {}) };
  delete body.task_id;
  delete body.taskId;
  const created = storyAd.createTask(body, currentUser(req));
  res.status(201).json({
    success: true,
    project: projectBundles.projectSummary(storyAd.taskSummary(created.task)),
    task: created.task,
    context: created.context,
  });
}));

router.get('/projects/:taskId/bundle', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const bundle = attachSceneWorldProjection(req.params.taskId, projectBundles.buildProjectBundle(req.params.taskId, {
    sections: req.query.sections || '',
    user: currentUser(req),
  }));
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, bundle });
}));

router.get('/projects/:taskId/graph', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const { graph } = graphForRequest(req);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, graph });
}));

router.get('/projects/:taskId/graph-layout', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const { allowedNodeIds } = graphForRequest(req, { withLayout: false });
  const layout = graphLayouts.getLayout(req.params.taskId, { allowedNodeIds });
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, task_id: req.params.taskId, layout });
}));

router.put('/projects/:taskId/graph-layout', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const { allowedNodeIds } = graphForRequest(req, { withLayout: false });
  const result = graphLayouts.saveLayout(req.params.taskId, req.body || {}, {
    allowedNodeIds,
    user: currentUser(req),
  });
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.delete('/projects/:taskId/graph-layout', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const { allowedNodeIds } = graphForRequest(req, { withLayout: false });
  const result = graphLayouts.resetLayout(req.params.taskId, req.body || {}, {
    allowedNodeIds,
    user: currentUser(req),
  });
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.get('/projects/:taskId/scene-worlds', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, {
    sections: 'summary,assets,shots',
    user: currentUser(req),
  });
  const result = sceneWorlds.resolve(req.params.taskId, bundle);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.put('/projects/:taskId/scene-worlds/:worldId', asyncRoute(async (req, res) => {
  const task = projectForRequest(req);
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, {
    sections: 'summary,assets,shots',
    user: currentUser(req),
  });
  const current = sceneWorlds.resolve(req.params.taskId, bundle).worlds
    .find(world => String(world.id) === String(req.params.worldId));
  if (!current) {
    const error = new Error('没有找到对应场景世界');
    error.status = 404;
    error.code = 'SCENE_WORLD_NOT_FOUND';
    throw error;
  }
  const saved = sceneWorlds.saveWorld(req.params.taskId, current.id, req.body || {}, {
    expected_revision: req.body?.expected_revision,
    content_revision: Number(task.content_revision || 1) || 1,
  });
  const nextBundle = projectBundles.buildProjectBundle(req.params.taskId, {
    sections: 'summary,assets,shots',
    user: currentUser(req),
  });
  const result = sceneWorlds.resolve(req.params.taskId, nextBundle);
  res.json({ success: true, task_id: req.params.taskId, world: result.worlds.find(world => world.id === current.id) || saved, manifest: result.manifest });
}));

router.put('/projects/:taskId/scene-world-assignments', asyncRoute(async (req, res) => {
  const task = projectForRequest(req);
  const saved = sceneWorlds.saveAssignments(req.params.taskId, req.body?.assignments || [], {
    expected_revision: req.body?.expected_revision,
    content_revision: Number(task.content_revision || 1) || 1,
  });
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, {
    sections: 'summary,assets,shots',
    user: currentUser(req),
  });
  const result = sceneWorlds.resolve(req.params.taskId, bundle);
  res.json({ success: true, task_id: req.params.taskId, ...saved, manifest: result.manifest });
}));

router.post('/projects/:taskId/reference-understanding/confirm', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const raw = storyAd.publicTaskBundle(req.params.taskId);
  const context = raw?.context || raw?.outputs?.context || raw?.task?.request || {};
  const reference_understanding_confirmation = referenceUnderstandingConfirmations.confirm(
    req.params.taskId,
    context,
    req.body || {},
    { user: currentUser(req) },
  );
  res.json({ success: true, task_id: req.params.taskId, reference_understanding_confirmation });
}));

router.put('/projects/:taskId/reference-understanding', asyncRoute(async (req, res) => {
  const task = projectForRequest(req);
  const user = currentUser(req);
  const raw = storyAd.publicTaskBundle(req.params.taskId);
  const context = raw?.context || raw?.outputs?.context || raw?.task?.request || {};
  const analysisId = String(context.reference_video_analysis?.analysis_id || '').trim();
  const requestedAnalysisId = String(req.body?.analysis_id || req.body?.analysisId || '').trim();
  if (!analysisId || requestedAnalysisId !== analysisId) {
    const error = new Error('当前参考内容已经变化，请刷新后再修改');
    error.code = 'REFERENCE_UNDERSTANDING_ANALYSIS_CONFLICT';
    error.status = 409;
    error.retryable = false;
    throw error;
  }
  const baseReference = referenceVideoAnalyses.taskRecord(referenceVideoAnalyses.get(analysisId, user));
  const edited = referenceUnderstandingEdits.createOverride(
    baseReference,
    context.reference_understanding_override,
    req.body || {},
    { user },
  );
  const updated = storyAd.updateTaskRequest(req.params.taskId, {
    reference_video_analysis: edited.reference,
    reference_understanding_override: edited.override,
    base_content_revision: req.body?.base_content_revision ?? req.body?.baseContentRevision ?? task.content_revision,
  }, user, { referenceUnderstandingEdit: true });
  res.json({
    success: true,
    task_id: req.params.taskId,
    reference_video_analysis: updated.context.reference_video_analysis,
    edit_revision: edited.edit_revision,
    changed_fields: edited.changed_fields,
    content_revision: updated.content_revision,
    invalidated_outputs: updated.invalidated_outputs,
    model_call_count: 0,
  });
}));

router.get('/projects/:taskId/scene-worlds/:worldId/director', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, { sections: 'summary,assets,shots', user: currentUser(req) });
  const projection = sceneWorlds.resolve(req.params.taskId, bundle);
  const world = projection.worlds.find(item => String(item.id) === String(req.params.worldId));
  if (!world) { const error = new Error('没有找到对应场景世界'); error.status = 404; error.code = 'SCENE_WORLD_NOT_FOUND'; throw error; }
  const director_scene = directorScenes.resolve(req.params.taskId, bundle, world, projection.manifest);
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.json({ success: true, task_id: req.params.taskId, director_scene });
}));

router.put('/projects/:taskId/scene-worlds/:worldId/director', asyncRoute(async (req, res) => {
  const task = projectForRequest(req);
  const bundle = projectBundles.buildProjectBundle(req.params.taskId, { sections: 'summary,assets,shots', user: currentUser(req) });
  const projection = sceneWorlds.resolve(req.params.taskId, bundle);
  const world = projection.worlds.find(item => String(item.id) === String(req.params.worldId));
  if (!world) { const error = new Error('没有找到对应场景世界'); error.status = 404; error.code = 'SCENE_WORLD_NOT_FOUND'; throw error; }
  const director_scene = directorScenes.save(req.params.taskId, bundle, world, req.body || {}, {
    expected_revision: req.body?.expected_revision,
    content_revision: Number(task.content_revision || 1) || 1,
    manifest: projection.manifest,
  });
  res.json({ success: true, task_id: req.params.taskId, director_scene });
}));

router.post('/projects/:taskId/materials', asyncRoute(async (req, res) => {
  const task = projectForRequest(req);
  const body = req.body || {};
  const role = String(body.role || '').trim().toLowerCase();
  const asset = body.asset && typeof body.asset === 'object' ? body.asset : null;
  if (!asset) {
    const error = new Error('没有收到可添加的材料');
    error.status = 400;
    error.code = 'MATERIAL_ASSET_REQUIRED';
    throw error;
  }
  const current = storyAd.publicTaskBundle(req.params.taskId).context || task.request || {};
  const appendUnique = (items, value) => {
    const key = String(value.id || value.asset_id || value.image_url || value.url || '');
    return [...(Array.isArray(items) ? items : []).filter(item => (
      String(item.id || item.asset_id || item.image_url || item.url || '') !== key
    )), value];
  };
  let patch = {};
  if (role === 'product') patch = { product_asset: asset };
  else if (role === 'person') patch = { person_asset: asset };
  else if (role === 'animal') patch = { pet_profiles: appendUnique(current.pet_profiles, { ...asset, source: 'upload' }) };
  else if (role === 'scene') patch = { assets: appendUnique(current.assets, { ...asset, role: 'scene_reference' }) };
  else if (role === 'prop') patch = { prop_assets: appendUnique(current.prop_assets, { ...asset, role: 'prop' }) };
  else if (role === 'logo') {
    if (body.authorized !== true) {
      const error = new Error('添加品牌标识前必须确认已取得使用授权');
      error.status = 400;
      error.code = 'BRAND_LOGO_AUTHORIZATION_REQUIRED';
      throw error;
    }
    patch = {
      brand_overlay: {
        ...(current.brand_overlay || {}),
        enabled: true,
        authorized: true,
        logo_asset: asset,
        logo_url: asset.image_url || asset.url || '',
      },
    };
  } else {
    const error = new Error('不支持的材料类型');
    error.status = 400;
    error.code = 'MATERIAL_ROLE_INVALID';
    throw error;
  }
  const updated = storyAd.updateTaskRequest(req.params.taskId, {
    ...patch,
    base_content_revision: Number(task.content_revision || 1) || 1,
    client_edit_seq: (Number(task.latest_client_edit_seq || 0) || 0) + 1,
  }, currentUser(req));
  res.json({ success: true, task_id: req.params.taskId, ...updated });
}));

router.put('/projects/:taskId/sketches', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = storyboardSketches.saveSketches(
    req.params.taskId,
    req.body?.sketches || [],
    currentUser(req),
  );
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.post('/projects/:taskId/sketches/:shotIndex/generate', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = await storyboardSketches.generateSketch(
    req.params.taskId,
    req.params.shotIndex,
    req.body || {},
  );
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.post('/projects/:taskId/sketches/generate-batch', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = await storyboardSketches.generateSketchBatch(
    req.params.taskId,
    req.body || {},
  );
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.get('/projects/:taskId/sketches/generate-batch', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = storyboardSketches.getSketchBatch(req.params.taskId);
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

module.exports = router;
