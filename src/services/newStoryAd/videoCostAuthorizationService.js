const storage = require('./storageService');

function authorize(taskId, authorization = {}, details = {}) {
  storage.saveOutput(taskId, 'video_cost_authorization', {
    ...authorization,
    ...details,
    authorized_at: new Date().toISOString(),
    status: 'authorized',
  });
}

function transition(taskId, status, details = {}) {
  const current = storage.getOutput(taskId, 'video_cost_authorization') || {};
  storage.saveOutput(taskId, 'video_cost_authorization', {
    ...current,
    ...details,
    status,
    reusable: false,
    [`${status}_at`]: new Date().toISOString(),
  });
}

module.exports = { authorize, transition };
