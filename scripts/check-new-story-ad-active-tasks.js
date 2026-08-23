const storage = require('../src/services/newStoryAd/storageService');

function isUnknownBilling(call = {}) {
  return String(call.billing_state || '').toLowerCase() === 'unknown'
    && ['submitted', 'submitted_unknown', 'accepted', 'polling', 'running']
      .includes(String(call.provider_submission_state || '').toLowerCase());
}

function main() {
  const activeTasks = storage.listActiveTaskStates(1000);
  const active = activeTasks.map(task => ({
      id: task.id,
      generation_id: task.active_generation_id,
      stage: task.active_stage || task.stage || '',
    }));
  const unknownBilling = storage.listUnknownBillingStates(2000)
    .map(call => ({ id: call.id, task_id: call.task_id, stage: call.stage, provider_task_id: call.provider_task_id || '' }));
  const activeTaskIds = new Set(activeTasks.map(task => String(task.id || '')));
  const activeUnknownBilling = unknownBilling.filter(call => activeTaskIds.has(String(call.task_id || '')));
  console.log(JSON.stringify({
    active_count: active.length,
    active,
    unknown_billing_count: unknownBilling.length,
    unknown_billing: unknownBilling.slice(0, 50),
    active_unknown_billing_count: activeUnknownBilling.length,
    active_unknown_billing: activeUnknownBilling.slice(0, 50),
  }));
  if (active.length || activeUnknownBilling.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { isUnknownBilling, main };
