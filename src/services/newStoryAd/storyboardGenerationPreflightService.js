'use strict';

const storage = require('./storageService');
const { assertContextConsistent } = require('./contextBuilder');
const contentSkill = require('./contentSkillService');
const storyFlowSketchGate = require('../storyAdWorkspace/storyFlowSketchGateService');
const { assertSceneModeAssets, normalizeScenePlan, resolveSceneMode } = require('./sceneBindingService');

/** 在任何文字分镜或图片分镜工作开始前统一验证七步流程的上游权威。 */
function assertReady(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  storyFlowSketchGate.assertReady(taskId);
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  contentSkill.assertSelected(ctx);
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const scenePlan = normalizeScenePlan(storage.getOutput(taskId, 'scene_config') || {});
  assertSceneModeAssets(resolveSceneMode(ctx.scene_mode, scenePlan), sceneAssets, scenePlan.spaces,
    typeof options.sceneVerificationOptions === 'function' ? options.sceneVerificationOptions(taskId) : {});
  return { task, ctx };
}

module.exports = { assertReady };
