const knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');

function resolve({ storage, taskId = '', context = {}, person = false, scene = false } = {}) {
  if (!taskId || !storage.getTask(taskId) || (!person && !scene)) return null;
  return knowledgePolicyRuntime.resolveTaskMany({
    storage,
    taskId,
    selectors: person
      ? [{ stage: 'person_dossier', assetType: 'person' }]
      : [{ stage: 'scene_asset', assetType: 'scene' }],
    context,
  });
}

function attach(response = {}, policy = null) {
  response.knowledge_policy = knowledgePolicyRuntime.trace(policy || {});
  return response;
}

module.exports = { resolve, attach };
