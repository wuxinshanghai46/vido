'use strict';

const storage = require('./storageService');
const { assertContextConsistent } = require('./contextBuilder');
const contentSkill = require('./contentSkillService');
const storyFlowSketchGate = require('../storyAdWorkspace/storyFlowSketchGateService');
const { assertSceneModeAssets, normalizeScenePlan, resolveSceneMode } = require('./sceneBindingService');
const scenePlanningAuthority = require('./scenePlanningAuthorityService');

/** 在任何模型调用前先验证前四步权威，避免无效任务产生费用。 */
function assertUpstreamReady(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  contentSkill.assertSelected(ctx);
  const storedSceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const scenePlan = normalizeScenePlan(storage.getOutput(taskId, 'scene_config') || {});
  const sceneAssets = scenePlanningAuthority.enrichSceneAssets(
    Array.isArray(storedSceneAssets) ? storedSceneAssets : [],
    scenePlan,
    ctx,
    storage.getOutput(taskId, 'scene_world_overrides') || {},
  );
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
