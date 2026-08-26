'use strict';

const storage = require('../../src/services/newStoryAd/storageService');
const promptAuthority = require('../../src/services/newStoryAd/scenePromptConfirmationService');

function currentScenePrompt(taskId, sceneId) {
  return promptAuthority.assertCurrentPrompt(taskId, sceneId);
}

function currentAllScenePrompts(taskId) {
  const plan = storage.getOutput(taskId, 'scene_config');
  const spaces = Array.isArray(plan?.spaces) ? plan.spaces : [];
  return spaces.map(space => currentScenePrompt(taskId, space.id || space.scene_id || space.space_id));
}

module.exports = { currentAllScenePrompts, currentScenePrompt };
