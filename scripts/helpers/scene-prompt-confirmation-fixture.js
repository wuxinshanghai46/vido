'use strict';

const storage = require('../../src/services/newStoryAd/storageService');
const confirmations = require('../../src/services/newStoryAd/scenePromptConfirmationService');

function confirmScenePrompt(taskId, sceneId, actor = { id: 'contract-test-user' }) {
  const descriptor = confirmations.authoritativeDescriptor(taskId, sceneId).descriptor;
  return confirmations.confirm(taskId, sceneId, {
    confirmation_id: descriptor.confirmation_id,
  }, actor);
}

function confirmAllScenePrompts(taskId, actor = { id: 'contract-test-user' }) {
  const plan = storage.getOutput(taskId, 'scene_config');
  const spaces = Array.isArray(plan?.spaces) ? plan.spaces : [];
  return spaces.map(space => confirmScenePrompt(
    taskId,
    space.id || space.scene_id || space.space_id,
    actor,
  ));
}

module.exports = { confirmAllScenePrompts, confirmScenePrompt };
