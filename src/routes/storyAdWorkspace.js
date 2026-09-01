const express = require('express');
const { v4: uuidv4 } = require('uuid');
const storyAd = require('../services/newStoryAd');
const projectBundles = require('../services/storyAdWorkspace/projectBundleService');
const graphProjection = require('../services/storyAdWorkspace/graphProjectionService');
const graphLayouts = require('../services/storyAdWorkspace/graphLayoutService');
const storyboardSketches = require('../services/storyAdWorkspace/storyboardSketchService');
const storyboardImageConfirmation = require('../services/storyAdWorkspace/storyboardImageConfirmationGateService');
const storyboardPromptAssist = require('../services/storyAdWorkspace/storyboardPromptAssistService');
const storyboardAsyncLaunch = require('../services/storyAdWorkspace/storyboardAsyncLaunchService');
const sceneWorlds = require('../services/storyAdWorkspace/sceneWorldService');
const directorScenes = require('../services/storyAdWorkspace/directorSceneService');
const referenceUnderstandingConfirmations = require('../services/storyAdWorkspace/referenceUnderstandingConfirmationService');
const authoritativeReference = require('../services/storyAdWorkspace/authoritativeReferenceProjectionService');
const referenceVideoAnalyses = require('../services/newStoryAd/referenceVideoAnalysisService');
const referenceUnderstandingEdits = require('../services/newStoryAd/referenceUnderstandingEditService');
const videoCore = require('../services/videoGenerationCore');
const storage = require('../services/newStoryAd/storageService');
const mediaCatalog = require('../services/newStoryAd/mediaCatalogService');
const mediaModelSelection = require('../services/newStoryAd/mediaGenerationModelSelectionService');
const soundDesignAssets = require('../services/newStoryAd/soundDesignAssetService');
const audioProduction = require('../services/newStoryAd/audioProductionService');
const storyAdTimeline = require('../services/newStoryAd/storyAdTimelineService');

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
  if (options.withLayout === false) return { graph, allowedNodeIds, bundle };
  const layout = graphLayouts.getLayout(req.params.taskId, { allowedNodeIds });
  return { graph: graphLayouts.mergeGraph(graph, layout), allowedNodeIds, layout, bundle };
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
  const requestedSections = String(req.query.sections || '');
  const wantsGraph = requestedSections.split(',').map(item => item.trim()).includes('graph');
  let bundle;
  if (wantsGraph) {
    const projected = graphForRequest(req);
    bundle = projected.bundle;
    bundle.workflow_graph = projected.graph;
    bundle.loaded_sections = [...new Set([...(bundle.loaded_sections || []), 'graph'])];
  } else {
    bundle = attachSceneWorldProjection(req.params.taskId, projectBundles.buildProjectBundle(req.params.taskId, {
      sections: requestedSections,
      user: currentUser(req),
    }));
  }
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, bundle });
}));

router.get('/projects/:taskId/media', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const outputRows = storage.listOutputs(req.params.taskId);
  const outputs = Object.fromEntries(outputRows.map(row => [row.kind, row.payload]));
  const catalog = mediaCatalog.page(outputs, {
    kind: req.query.kind,
    offset: req.query.offset,
    limit: req.query.limit,
  });
  res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
  res.setHeader('Vary', 'Authorization');
  res.json({ success: true, task_id: req.params.taskId, catalog });
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
  const storedContext = raw?.context || raw?.outputs?.context || raw?.task?.request || {};
  const context = authoritativeReference.snapshot(raw?.task || {}, storedContext, undefined, { required: true }).context;
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
  if (role === 'product') patch = { product_asset: {
    ...asset,
    source: 'user_upload',
    source_type: 'user_upload',
    user_supplied: true,
    reference_only: false,
  } };
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

const rejectLegacyUserStoryFlowRoute = asyncRoute(async (req) => {
  projectForRequest(req);
  const error = new Error('用户确认剧情流向的旧入口已禁用。人物与场景绑定现在由系统在生成分镜时自动完成。');
  error.code = 'LEGACY_USER_STORY_FLOW_ROUTE_DISABLED';
  error.status = 410;
  error.retryable = false;
  throw error;
});
router.all('/projects/:taskId/story-flow', rejectLegacyUserStoryFlowRoute);
router.all('/projects/:taskId/story-flow/*', rejectLegacyUserStoryFlowRoute);

const rejectLegacyFlowSketchRoute = asyncRoute(async (req) => {
  projectForRequest(req);
  const error = new Error('旧剧情流向图片生成入口已禁用。系统会在人物场景分镜内部自动完成绑定，不生成独立流向图片。');
  error.code = 'LEGACY_STORY_FLOW_SKETCH_ROUTE_DISABLED';
  error.status = 410;
  error.retryable = false;
  throw error;
});
router.all('/projects/:taskId/flow-sketches', rejectLegacyFlowSketchRoute);
router.all('/projects/:taskId/flow-sketches/*', rejectLegacyFlowSketchRoute);

const rejectLegacySketchRoute = asyncRoute(async (req) => {
  projectForRequest(req);
  const error = new Error('旧“线稿与分镜”合并入口已禁用，请刷新页面后使用“人物场景分镜”。');
  error.code = 'LEGACY_STORYBOARD_SKETCH_ROUTE_DISABLED';
  error.status = 410;
  error.retryable = false;
  throw error;
});
router.all('/projects/:taskId/sketches', rejectLegacySketchRoute);
router.all('/projects/:taskId/sketches/*', rejectLegacySketchRoute);

router.get('/projects/:taskId/sound-design', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const production = audioProduction.current(req.params.taskId);
  res.json({ success: true, task_id: req.params.taskId, ...soundDesignAssets.compile(req.params.taskId), production: {
    speech: production.speech,
    speakers: production.speakers,
    voice_id: production.voice_id,
    voice_assignments: production.voice_assignments,
    include_voiceover: production.include_voiceover,
    has_speech: production.has_speech,
    subtitle: production.plan.subtitle !== false,
    voice_volume: production.plan.voice_volume ?? 1,
    bgm_volume: production.plan.bgm_volume ?? 0.16,
    tts_tracks: production.tts.tracks || [],
    approved: production.approved,
    approval: production.approval,
  } });
}));

router.put('/projects/:taskId/audio-plan', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const state = audioProduction.savePlan(req.params.taskId, req.body || {});
  res.json({ success: true, task_id: req.params.taskId, production: { speech: state.speech, speakers: state.speakers, voice_id: state.voice_id, voice_assignments: state.voice_assignments, include_voiceover: state.include_voiceover, subtitle: state.plan.subtitle !== false, voice_volume: state.plan.voice_volume ?? 1, bgm_volume: state.plan.bgm_volume ?? 0.16, approved: state.approved } });
}));

router.post('/projects/:taskId/audio-confirm', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const state = audioProduction.confirm(req.params.taskId, currentUser(req));
  res.json({ success: true, task_id: req.params.taskId, approved: state.approved, approval: state.approval });
}));

router.get('/projects/:taskId/timeline', asyncRoute(async (req, res) => {
  projectForRequest(req);
  res.json({ success: true, task_id: req.params.taskId, items: storyAdTimeline.get(req.params.taskId) });
}));

router.put('/projects/:taskId/timeline', asyncRoute(async (req, res) => {
  projectForRequest(req);
  res.json({ success: true, task_id: req.params.taskId, items: storyAdTimeline.save(req.params.taskId, req.body || {}) });
}));

router.post('/projects/:taskId/sound-assets', asyncRoute(async (req, res) => {
  projectForRequest(req);
  res.json({ success: true, task_id: req.params.taskId, ...soundDesignAssets.addUserAsset(req.params.taskId, req.body || {}, currentUser(req)) });
}));

router.get('/projects/:taskId/sound-library', asyncRoute(async (req, res) => {
  projectForRequest(req);
  res.json({ success: true, task_id: req.params.taskId, ...(await soundDesignAssets.searchOpenverse(req.query.q || '', { trackType: req.query.track_type || '' })) });
}));

router.post('/projects/:taskId/sound-assets/openverse', asyncRoute(async (req, res) => {
  projectForRequest(req);
  res.json({ success: true, task_id: req.params.taskId, ...(await soundDesignAssets.importOpenverseAsset(req.params.taskId, req.body || {})) });
}));

router.put('/projects/:taskId/storyboard-images', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = storyboardSketches.saveSketches(
    req.params.taskId,
    req.body?.images || [],
    currentUser(req),
  );
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.post('/projects/:taskId/storyboard-images/:shotIndex/generate', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const body = mediaModelSelection.applySelection('new_story_ad.storyboard_image', req.body || {});
  const result = await storyboardSketches.generateSketch(
    req.params.taskId,
    req.params.shotIndex,
    body,
  );
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.put('/projects/:taskId/storyboard-images/:shotIndex/prompt', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = storyboardSketches.savePromptOverride(req.params.taskId, req.params.shotIndex, req.body?.prompt_text || '', currentUser(req));
  res.json({ success: true, task_id: req.params.taskId, ...result, image_gate: storyboardImageConfirmation.inspect(req.params.taskId) });
}));

router.post('/projects/:taskId/storyboard-images/:shotIndex/prompt-assist', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = await storyboardPromptAssist.suggest(req.params.taskId, req.params.shotIndex, req.body || {});
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.post('/projects/:taskId/storyboard-images/generate-batch', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const body = mediaModelSelection.applySelection('new_story_ad.storyboard_image', req.body || {});
  const execution = storyboardSketches.generateSketchBatch(
    req.params.taskId,
    body,
  );
  if (body.async_start === true) {
    const launch = await storyboardAsyncLaunch.resolve(execution, () => storyboardSketches.getSketchBatch(req.params.taskId));
    if (launch.completed) return res.json({ success: true, task_id: req.params.taskId, ...launch.result });
    return res.status(202).json({ success: true, task_id: req.params.taskId, accepted: true, ...launch.result });
  }
  const result = await execution;
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

router.get('/projects/:taskId/storyboard-images/generate-batch', asyncRoute(async (req, res) => {
  projectForRequest(req);
  const result = storyboardSketches.getSketchBatch(req.params.taskId);
  res.json({ success: true, task_id: req.params.taskId, ...result });
}));

module.exports = router;
