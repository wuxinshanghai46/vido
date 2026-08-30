'use strict';

const storage = require('./storageService');
const { assertContextConsistent } = require('./contextBuilder');
const contentSkill = require('./contentSkillService');
const storyFlowSketchGate = require('../storyAdWorkspace/storyFlowSketchGateService');
const { assertSceneModeAssets, normalizeScenePlan, resolveSceneMode } = require('./sceneBindingService');
const { closeSceneSpec } = require('./generationSpecCompletionService');

/** 在任何模型调用前先验证前四步权威，避免无效任务产生费用。 */
function assertUpstreamReady(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  contentSkill.assertSelected(ctx);
  const storedSceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const scenePlan = normalizeScenePlan(storage.getOutput(taskId, 'scene_config') || {});
  const plannedById = new Map(scenePlan.spaces.map(space => [String(space.id || space.scene_id || ''), space]));
  const sceneAssets = (Array.isArray(storedSceneAssets) ? storedSceneAssets : []).map((asset, index) => {
    const id = String(asset.scene_id || asset.space_id || asset.id || '');
    const space = plannedById.get(id) || scenePlan.spaces[index] || {};
    const plannedSpec = closeSceneSpec(space.scene_spec || {}, {
      scene_id: id,
      scene_name: space.name || asset.name || asset.scene_name || `场景 ${index + 1}`,
      content_mode: ctx.content_mode || '',
    }).scene_spec;
    const plannedCameras = Array.isArray(plannedSpec.cameraPlan) ? plannedSpec.cameraPlan : [];
    const contract = asset.scene_contract && typeof asset.scene_contract === 'object' ? asset.scene_contract : {};
    const sourceCameras = Array.isArray(contract.cameras) && contract.cameras.length ? contract.cameras : plannedCameras;
    const cameras = sourceCameras.map((camera, cameraIndex) => {
      const key = String(camera.view_id || camera.view || camera.key || '');
      const plan = plannedCameras.find(item => String(item.view_id || item.view || item.key || '') === key)
        || plannedCameras[cameraIndex] || {};
      return {
        ...plan,
        ...camera,
        view_id: camera.view_id || plan.view_id || '',
        normalized_position: camera.normalized_position || camera.position_on_layout || plan.normalized_position || [],
        look_at: camera.look_at || camera.target_on_layout || plan.look_at || [],
        coordinate_source: camera.coordinate_source || plan.coordinate_source || 'deterministic_director_plan',
      };
    });
    return {
      ...asset,
      scene_spec: { ...(asset.scene_spec || {}), ...plannedSpec, cameraPlan: plannedCameras },
      camera_plan: plannedCameras,
      scene_contract: { ...contract, cameras },
    };
  });
  assertSceneModeAssets(resolveSceneMode(ctx.scene_mode, scenePlan), sceneAssets, scenePlan.spaces,
    typeof options.sceneVerificationOptions === 'function' ? options.sceneVerificationOptions(taskId) : {});
  return { task, ctx, scene_assets: sceneAssets, scene_plan: scenePlan };
}

/** 前四步通过且系统人物场景绑定完成后，才允许建立 Shot List。 */
function assertReady(taskId, options = {}) {
  const upstream = assertUpstreamReady(taskId, options);
  const flow = storyFlowSketchGate.assertReady(taskId);
  return { ...upstream, story_flow_contract: flow.contract };
}

module.exports = { assertReady, assertUpstreamReady };
