const storage = require('../src/services/newStoryAd/storageService');

function main() {
  const active = storage.listTasks({ limit: 1000 })
    .filter(task => task.active_generation_id)
    .map(task => ({
      id: task.id,
      stage: task.active_stage || task.stage || '',
    }));
  console.log(JSON.stringify({ active_count: active.length, active }));
  if (active.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main };
