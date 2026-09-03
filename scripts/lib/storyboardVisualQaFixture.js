'use strict';
const storage = require('../../src/services/newStoryAd/storageService');
const visual = require('../../src/services/newStoryAd/storyboardVisualQaService');
function verified(taskId) {
  return { pass: true, status: 'verified', policy_version: visual.POLICY_VERSION,
    identity_fingerprint: visual.identityFingerprint(storage.getOutput(taskId, 'context') || storage.getTask(taskId)?.request || {}) };
}
const service = { review: async ({ taskId }) => verified(taskId) };
module.exports = { verified, service };
