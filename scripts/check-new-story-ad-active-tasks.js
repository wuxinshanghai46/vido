const storage = require('../src/services/newStoryAd/storageService');

function main() {
  const active = storage.listTasks({ limit: 1000 })
    .filter(task => task.active_generation_id)
    .map(task => ({
      id: task.id,
      stage: task.active_stage || task.stage || '',
    }));
  const unknownBilling = (storage.readDb().model_calls || [])
    .filter(call => String(call.billing_state || '').toLowerCase() === 'unknown'
      && ['submitted', 'accepted', 'polling', 'running'].includes(String(call.provider_submission_state || '').toLowerCase()))
    .map(call => ({ id: call.id, task_id: call.task_id, stage: call.stage, provider_task_id: call.provider_task_id || '' }));
  console.log(JSON.stringify({
    active_count: active.length,
    active,
    unknown_billing_count: unknownBilling.length,
    unknown_billing: unknownBilling.slice(0, 50),
  }));
  if (active.length || unknownBilling.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main };
