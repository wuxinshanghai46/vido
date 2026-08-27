'use strict';

function create(deps = {}) {
  const {
    storage, scenePromptConfirmation, assertContextConsistent, normalizeSceneAssets,
    buildSceneRepairPlan, reverifySceneAsset, generateSceneAsset, repairSceneAsset,
  } = deps;

  return async function fixSceneAsset(taskId, sceneId, body = {}, runOptions = {}) {
    const task = storage.getTask(taskId);
    if (!task) throw new Error('没有找到对应项目。');
    scenePromptConfirmation.assertCurrentPrompt(taskId, sceneId, body);
    const context = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
    const currentAssets = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || context.scene_assets || []);
    let current = currentAssets.find(item => String(item.scene_id || item.id) === String(sceneId || ''));
    if (!current) {
      const error = new Error('要修复的场景不存在');
      error.code = 'SCENE_ASSET_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    let plan = buildSceneRepairPlan(current);
    let diagnosis = null;
    if (plan.action === 'reverify') {
      diagnosis = await reverifySceneAsset(taskId, sceneId);
      current = diagnosis.scene_asset;
      plan = current.repair_plan || buildSceneRepairPlan(current);
      if (plan.action === 'none') {
        return { ...diagnosis, fix_status: 'verified_without_image_repair', provider_image_call_count: 0 };
      }
      if (plan.action === 'reverify') {
        const error = new Error(current.scene_contract?.qa_error
          || '视觉检查服务仍未返回可定位的逐图证据，已停止图片调用；请查看供应商错误后再处理。');
        error.code = 'SCENE_QA_EVIDENCE_UNAVAILABLE';
        error.status = 422;
        error.retryable = true;
        error.scene_asset = current;
        error.repair_plan = plan;
        error.provider_image_call_count = 0;
        throw error;
      }
    }
    if (plan.action === 'regenerate_full_scene') {
      return generateSceneAsset(taskId, {
        ...body,
        scene_id: current.scene_id || current.id,
        space_id: current.space_id || current.scene_id || current.id,
        name: current.name,
        scene_spec: body.scene_spec || body.sceneSpec || current.scene_spec || {
          layoutText: current.layout_summary || '', materialLightText: current.material_summary || '',
          interactionText: current.interaction_summary || '', negativeText: current.negative || '',
          surfaceTopology: current.surface_topology || {},
        },
      }, { ...runOptions, fullRebuild: true });
    }
    const result = await repairSceneAsset(taskId, sceneId, body, runOptions);
    return { ...result, fix_status: diagnosis ? 'diagnosed_repaired_and_verified' : 'repaired_and_verified' };
  };
}

module.exports = { create };
