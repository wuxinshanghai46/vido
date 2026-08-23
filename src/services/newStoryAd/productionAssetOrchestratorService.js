const productionGraph = require('./productionGraphService');
const dossierComposites = require('./dossierCompositeService');
const pipelineModels = require('../pipelineModelService');
const tokenTracker = require('../tokenTracker');
const visualAssetOrchestration = require('./visualAssetOrchestrationService');
const visualAssetProgress = require('./visualAssetProgressService');
const personAssetLifecycle = require('./personAssetLifecycleService');
const sceneAssetService = require('./sceneAssetService');
const scenePanoramaService = require('./scenePanoramaService');
const propAssetService = require('./propAssetService');
const videoAdapter = require('./videoAdapter');
const personPlanGeneration = require('../../routes/newStoryAd/personPlanGenerationRoute');

function imagePriceUsd(modelId = '') {
  const normalized = String(modelId || '').trim().toLowerCase();
  const rows = Object.entries(tokenTracker.IMAGE_PRICING || {}).sort((a, b) => b[0].length - a[0].length);
  const match = rows.find(([key]) => normalized === key.toLowerCase()
    || normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized));
  return match ? Number(match[1] || 0) : NaN;
}

function productionImagePricePlan() {
  const stages = [
    'new_story_ad.person_dossier_atlas', 'new_story_ad.person_dossier_expression',
    'new_story_ad.person_dossier_action', 'new_story_ad.person_dossier_native_master',
    'new_story_ad.person_dossier_wearable_accessory', 'new_story_ad.person_dossier_wardrobe_detail',
    'new_story_ad.prop_dossier_atlas', 'new_story_ad.scene_extension_atlas',
    'new_story_ad.scene_extension_master', 'new_story_ad.scene_extension_layout',
    'new_story_ad.scene_extension_reverse', 'new_story_ad.scene_extension_interaction',
    'new_story_ad.scene_extension_detail', 'new_story_ad.scene_panorama',
  ];
  const routes = stages.flatMap(stage => pipelineModels.pickAllEnabledWithDefault(stage).map(item => ({
    stage, provider: String(item.provider || item.provider_id || ''), model: String(item.model || item.model_id || ''),
  })));
  const priced = routes.map(item => ({ ...item, unit_price_usd: imagePriceUsd(item.model) }));
  const unknown = priced.filter(item => !Number.isFinite(item.unit_price_usd) || item.unit_price_usd <= 0);
  return { unknown, maximum_unit_usd: priced.length && !unknown.length ? Math.max(...priced.map(item => item.unit_price_usd)) : NaN };
}

function create({ service, storage, generateAndCommitSubjectAssets, persistProviderPersonIds } = {}) {
  async function runVisualLanes({ taskId, body, job, userId }) {
    const sceneTargets = visualAssetOrchestration.normalizedSceneTargets(body);
    const subjectTotal = Math.max(0, Number(body.expected_people || 0)) + Math.max(0, Number(body.expected_animals || 0));
    const subjectsRequired = body.generate_subjects !== false && subjectTotal > 0;
    const baseContext = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
    visualAssetProgress.initialize(taskId, job.generationId, {
      subjectsRequired, subjectTotal, scenesRequired: sceneTargets.length > 0, sceneTotal: sceneTargets.length,
    });
    const subjectLane = subjectsRequired
      ? generateAndCommitSubjectAssets({ body, taskId, generationId: job.generationId, userId, deferCommit: true })
      : Promise.resolve(null);
    const sceneLane = (async () => {
      let sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseContext.scene_assets || [];
      let latestSceneSpec = null;
      const failures = [];
      for (let index = 0; index < sceneTargets.length; index += 1) {
        const target = sceneTargets[index];
        visualAssetProgress.updateLane(taskId, 'scenes', { status: 'running', completed_scenes: index, completed: index,
          current_scene_id: target.scene_id, message: `正在生成场景 ${index + 1}/${sceneTargets.length}：${target.name}` });
        try {
          const runOptions = { generationId: job.generationId, deferPublish: true, existingSceneAssets: sceneAssets };
          const result = target.repair_existing
            ? await sceneAssetService.repairSceneAsset(taskId, target.scene_id, { ...target, generation_id: job.generationId }, runOptions)
            : await sceneAssetService.generateSceneAsset(taskId, { ...target, generation_id: job.generationId }, runOptions);
          sceneAssets = result.scene_assets || sceneAssets;
          latestSceneSpec = result.scene_spec || latestSceneSpec;
          visualAssetProgress.updateLane(taskId, 'scenes', { status: index + 1 === sceneTargets.length ? 'completed' : 'running',
            completed_scenes: index + 1, completed: index + 1, percent: Math.round(((index + 1) / sceneTargets.length) * 100),
            message: `已完成场景 ${index + 1}/${sceneTargets.length}` });
        } catch (error) {
          sceneAssets = storage.getOutput(taskId, 'scene_assets') || sceneAssets;
          failures.push({ scene_id: target.scene_id, scene_name: target.name, error });
          visualAssetProgress.updateLane(taskId, 'scenes', { status: 'running', completed_scenes: index + 1, completed: index + 1,
            percent: Math.round(((index + 1) / sceneTargets.length) * 100), message: `场景 ${index + 1}/${sceneTargets.length} 已保存可用资产；失败单元已隔离，继续后续场景` });
        }
      }
      if (failures.length) {
        const primary = failures.find(item => item.error?.billingState === 'unknown' || item.error?.billing_state === 'unknown'
          || item.error?.code === 'PROVIDER_5XX_AMBIGUOUS') || failures[0];
        const error = primary.error instanceof Error ? primary.error : new Error('部分场景资产未完成');
        error.partial_scene_assets = sceneAssets; error.partial_scene_spec = latestSceneSpec;
        error.scene_failures = failures.map(item => ({ scene_id: item.scene_id, scene_name: item.scene_name,
          error_code: item.error?.code || 'SCENE_ASSET_GENERATION_FAILED', billing_state: item.error?.billingState || item.error?.billing_state || '' }));
        throw error;
      }
      return { scene_assets: sceneAssets, scene_spec: latestSceneSpec };
    })();
    const [subjects, scenes] = await Promise.allSettled([subjectLane, sceneLane]);
    visualAssetOrchestration.markRejectedLanes(taskId, subjects, scenes);
    const sceneCommit = scenes.status === 'fulfilled' ? scenes.value
      : { scene_assets: scenes.reason?.partial_scene_assets || [], scene_spec: scenes.reason?.partial_scene_spec || null };
    let subjectCommit = null;
    if (subjects.status === 'fulfilled' && subjects.value?.normalized_bundle) {
      subjectCommit = personAssetLifecycle.commitGeneratedSubjectAssets(taskId, subjects.value.normalized_bundle, body.person_spec || {},
        { change_kind: body.person_change_kind || body.change_kind || 'semantic', deferContextWrite: true });
      visualAssetProgress.updateLane(taskId, 'subjects', { status: 'completed', percent: 100, message: '人物与动物档案已保存' });
    }
    if (sceneCommit.scene_assets?.length) sceneAssetService.saveSceneAssetsToTask(taskId, sceneCommit.scene_assets, { deferContextWrite: true });
    if (subjectCommit || sceneCommit.scene_assets?.length) {
      const combined = { ...baseContext, ...(subjectCommit || {}),
        ...(sceneCommit.scene_assets?.length ? { scene_assets: sceneCommit.scene_assets } : {}),
        ...(sceneCommit.scene_spec ? { scene_spec: sceneCommit.scene_spec } : {}) };
      delete combined.invalidated_outputs; delete combined.visual_refresh;
      storage.saveOutput(taskId, 'context', combined);
      storage.updateTask(taskId, { request: combined, updated_at: new Date().toISOString() });
      if (subjectCommit?.person_contract?.status === 'verified') {
        try {
          const synced = await videoAdapter.prepareDeyunaiPersonAsset({ taskId, ctx: combined, options: {} });
          persistProviderPersonIds(userId, combined);
          storage.saveOutput(taskId, 'person_provider_sync', { status: 'completed', ...synced, generation_id: job.generationId });
        } catch (syncError) {
          storage.saveOutput(taskId, 'person_provider_sync', { status: 'failed', error_code: syncError.code || 'PERSON_PROVIDER_SYNC_FAILED',
            error: String(syncError.message || syncError).slice(0, 500), retryable: true, generation_id: job.generationId, updated_at: new Date().toISOString() });
        }
      }
    }
    const rejected = visualAssetOrchestration.rejectedResults(subjects, scenes);
    const failed = visualAssetOrchestration.primaryFailure(rejected);
    if (failed) {
      visualAssetProgress.finish(taskId, 'partial_failed');
      const error = failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason || '视觉资产生成失败'));
      throw visualAssetOrchestration.attachFailureMetadata(error, rejected, { subjectCommit, sceneCommit, subjects, scenes });
    }
    visualAssetProgress.finish(taskId, 'completed');
    return { subjects: subjectCommit, scenes: scenes.value, synchronized: true };
  }

  function plan(taskId, body = {}) {
    const task = storage.getTask(taskId) || {};
    const ctx = storage.getOutput(taskId, 'context') || task.request || {};
    const scenePlan = storage.getOutput(taskId, 'scene_config') || ctx.scene_plan || {};
    const castProfiles = Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [];
    const people = castProfiles.length;
    const animals = Array.isArray(ctx.pet_profiles) ? ctx.pet_profiles.length : 0;
    const sceneCount = Math.max(1, (scenePlan.spaces || scenePlan.scenes || []).length || Number(ctx.expected_scene_count || 0) || 1);
    const panoramaCount = body.generate_panoramas === false ? 0 : sceneCount;
    const graphDraft = productionGraph.compile(taskId, { compiled_by: 'unified_orchestrator:cost_plan' });
    const carriedProps = graphDraft.props.filter(item => item.attachment_mode === 'carried' && !item.image_url);
    const detailCalls = castProfiles.reduce((sum, profile) => sum + 4 + dossierComposites.explicitAccessoryDefinitions(profile).length, 0);
    const basis = { contract_version: productionGraph.CONTRACT_VERSION, task_id: taskId,
      content_revision: Number(task.content_revision || 1) || 1, people, animals, scene_count: sceneCount, panorama_count: panoramaCount,
      estimated_model_calls: { text_planning_max: people + 3, person_dossier_max: people * 6 + detailCalls,
        animal_dossier_max: animals, prop_assets_max: carriedProps.reduce((sum, prop) => sum + (Array.isArray(prop.states) && prop.states.length > 1 ? 2 : 1), 0),
        scene_assets_max: sceneCount * 5, panorama_image_max: panoramaCount, panorama_qa_text_max: panoramaCount },
      confirmed_cost_limit_rmb: Math.max(0, Math.min(10, Number(body.confirmed_cost_limit_rmb || 10) || 10)) };
    basis.estimated_model_calls.total_max = Object.values(basis.estimated_model_calls).reduce((sum, value) => sum + Number(value || 0), 0);
    const pricePlan = productionImagePricePlan();
    const imageCalls = basis.estimated_model_calls.person_dossier_max + basis.estimated_model_calls.animal_dossier_max
      + basis.estimated_model_calls.prop_assets_max + basis.estimated_model_calls.scene_assets_max + basis.estimated_model_calls.panorama_image_max;
    const cost = Number.isFinite(pricePlan.maximum_unit_usd)
      ? Number((imageCalls * pricePlan.maximum_unit_usd * Number(tokenTracker.getUSDtoCNY() || 7.2)).toFixed(2)) : null;
    const priced = { ...basis, estimated_paid_image_calls_max: imageCalls, estimated_visual_cost_max_rmb: cost,
      pricing_status: pricePlan.unknown.length ? 'blocked_unknown_image_price' : 'catalog_priced_hard_visual_limit',
      unpriced_routes: pricePlan.unknown.map(item => `${item.provider}/${item.model}@${item.stage}`) };
    return { ...priced, plan_fingerprint: productionGraph.fingerprint(priced) };
  }

  function assertConfirmation(body = {}, expected = {}) {
    const limit = Number(body.confirmed_cost_limit_rmb || body.confirmedCostLimitRmb || 0);
    if (expected.pricing_status === 'blocked_unknown_image_price') {
      const error = new Error('当前制作图谱包含未配置单价的图片模型，已阻止付费生成；请先在模型调用管理中补齐价格或改用已定价模型。');
      error.code = 'PRODUCTION_GRAPH_IMAGE_PRICE_UNKNOWN'; error.status = 409; error.retryable = false; error.current_plan = expected; throw error;
    }
    if (Number(expected.estimated_visual_cost_max_rmb || 0) > limit) {
      const error = new Error(`本轮视觉模型保守费用上限约 ${expected.estimated_visual_cost_max_rmb} 元，超过已授权的 ${limit || 0} 元，已在调用模型前停止。`);
      error.code = 'PRODUCTION_GRAPH_COST_LIMIT_EXCEEDED'; error.status = 409; error.retryable = false; error.current_plan = expected; throw error;
    }
    if (body.cost_confirmation === true && limit > 0 && limit <= 10
      && String(body.plan_fingerprint || '') === String(expected.plan_fingerprint || '')) return limit;
    const error = new Error('开始生成全部制作资产前，必须确认服务端最新调用计划和不超过10元的本轮费用上限。');
    error.code = 'PRODUCTION_GRAPH_COST_CONFIRMATION_REQUIRED'; error.status = 400; error.retryable = false; error.current_plan = expected; throw error;
  }

  async function run({ taskId, body, job, userId, user }) {
    let graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:cutover' });
    try {
      await service.updatePersonPlan(taskId, { generation_id: job.generationId, user, production_graph_authority: true });
      await service.generateSceneConfig(taskId, { generation_id: job.generationId, production_graph_authority: true });
      const executionPlan = plan(taskId, body);
      assertConfirmation({ ...body, plan_fingerprint: executionPlan.plan_fingerprint }, executionPlan);
      storage.saveOutput(taskId, 'production_asset_cost_plan', { ...executionPlan, confirmed_at: new Date().toISOString(),
        confirmed_cost_limit_rmb: Number(body.confirmed_cost_limit_rmb || 0), generation_id: job.generationId });
      graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:planned' });
      const personBody = personPlanGeneration.currentPersonGenerationBody({ taskId, input: body, service, storage });
      const context = storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {};
      const scenePlan = storage.getOutput(taskId, 'scene_config') || context.scene_plan || {};
      const sceneTargets = (scenePlan.spaces || scenePlan.scenes || []).map((space, index) => ({
        scene_id: String(space.id || space.space_id || space.scene_id || '').trim(), space_id: String(space.id || space.space_id || space.scene_id || '').trim(),
        name: String(space.name || `场景 ${index + 1}`).trim(), scene_spec: space.scene_spec || space.sceneSpec || {},
      })).filter(item => item.scene_id);
      const visualAssets = await runVisualLanes({ taskId, body: { ...personBody, ...body, task_id: taskId, generate_subjects: true, scene_targets: sceneTargets }, job, userId });
      graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:visual_assets' });
      const generatedProps = [];
      for (const prop of graph.props.filter(item => item.attachment_mode === 'carried' && !item.image_url)) {
        if (!prop.description) { const error = new Error(`随身物“${prop.name}”缺少可生成的完整外观、材质和用途描述。`);
          error.code = 'PRODUCTION_GRAPH_PROP_PROFILE_INCOMPLETE'; error.retryable = true; throw error; }
        generatedProps.push(await propAssetService.generatePropAsset(taskId, { ...prop, owner_id: prop.owner_character_id, generation_id: job.generationId }));
      }
      if (generatedProps.length) graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:props' });
      let panoramas = null;
      if (body.generate_panoramas !== false) {
        const panoramaPlan = scenePanoramaService.planForTask(taskId);
        panoramas = await scenePanoramaService.generateTaskPanoramas(taskId, { plan_fingerprint: panoramaPlan.plan_fingerprint,
          cost_confirmation: true, generation_id: job.generationId }, { generationId: job.generationId });
        if (panoramas.failed_count) { const error = new Error(`有 ${panoramas.failed_count} 个360场景未通过生成或质检；成功场景已保留。`);
          error.code = 'PRODUCTION_GRAPH_PANORAMA_PARTIAL_FAILED'; error.retryable = true; error.partial = panoramas; throw error; }
      }
      const storyboard = await service.generateStoryboardStage(taskId, { generation_id: job.generationId });
      graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:storyboard' });
      await service.buildKeyframeContractStage(taskId);
      graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:complete' });
      if (graph.validation.status !== 'ready') { const error = new Error(`统一制作图谱仍有 ${graph.validation.issues.length} 个合同缺项，已停止进入付费关键帧。`);
        error.code = 'PRODUCTION_GRAPH_INCOMPLETE'; error.retryable = true; error.details = graph.validation; throw error; }
      storage.saveStage(taskId, 'production_assets', { status: 'done', output_summary: `${graph.characters.length} 人物、${graph.scenes.length} 场景、${graph.shots.length} 镜头已进入唯一图谱` });
      return { production_graph: graph, visual_assets: visualAssets, prop_assets: generatedProps, panoramas, storyboard, legacy_path_blocked: true };
    } catch (error) {
      try { graph = productionGraph.publish(taskId, { compiled_by: 'unified_orchestrator:partial_failure' }); } catch {}
      error.production_graph_status = graph?.validation?.status || 'unavailable'; throw error;
    }
  }
  return { plan, assertConfirmation, run };
}

module.exports = { create, imagePriceUsd, productionImagePricePlan };
