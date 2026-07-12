const fs = require('fs');
const path = require('path');
const storage = require('../src/services/newStoryAd/storageService');
const service = require('../src/services/newStoryAd/storyAdService');
const jobService = require('../src/services/newStoryAd/jobService');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const taskId = String(process.argv[2] || '').trim();
  const backupPath = String(process.argv[3] || '').trim();
  if (!taskId || !backupPath) throw new Error('用法: node scripts/retry-new-story-ad-storyboard.js <taskId> <backupPath>');
  const before = storage.getTask(taskId);
  if (!before) throw new Error(`任务不存在: ${taskId}`);
  if (before.active_generation_id) throw new Error(`任务正在生成，拒绝重复启动: ${before.active_generation_id}`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify(service.publicTaskBundle(taskId), null, 2));

  const queued = jobService.queueStage({
    taskId,
    stage: 'storyboard',
    execute: () => service.generateStoryboardStage(taskId),
  });
  if (!queued.accepted) throw new Error(`任务未接受: ${JSON.stringify(queued.job || {})}`);

  const deadline = Date.now() + 12 * 60 * 1000;
  let task = storage.getTask(taskId);
  while (Date.now() < deadline) {
    await wait(1000);
    task = storage.getTask(taskId);
    if (!task?.active_generation_id && !['queued', 'running'].includes(String(task?.status || ''))) break;
  }
  if (task?.active_generation_id || ['queued', 'running'].includes(String(task?.status || ''))) {
    throw new Error('生产复测超过 12 分钟，任务仍在运行');
  }
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const review = storage.getOutput(taskId, 'quality_review') || {};
  const result = {
    task_id: taskId,
    status: task?.status,
    stage: task?.stage,
    error: task?.error || '',
    shot_count: Array.isArray(shots) ? shots.length : 0,
    expected_count: storage.getOutput(taskId, 'blueprint')?.beats?.length || 0,
    blocking_issues: review.blocking_issues || [],
    titles: Array.isArray(shots) ? shots.map(shot => shot.title || '') : [],
    backup_path: backupPath,
  };
  console.log(JSON.stringify(result, null, 2));
  if (task?.status === 'failed' || result.shot_count !== result.expected_count || result.blocking_issues.length) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
