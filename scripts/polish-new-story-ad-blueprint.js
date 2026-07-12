require('dotenv').config();

const storage = require('../src/services/newStoryAd/storageService');
const { polishBlueprint, assessBlueprintQuality } = require('../src/services/newStoryAd/blueprintQualityService');

async function main() {
  const taskId = String(process.argv[2] || '').trim();
  if (!taskId) throw new Error('用法: node scripts/polish-new-story-ad-blueprint.js <taskId>');
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`剧情广告任务不存在: ${taskId}`);
  const blueprint = storage.getOutput(taskId, 'blueprint');
  if (!blueprint?.beats?.length) throw new Error('当前任务没有可精修的剧本蓝图');
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const indexes = blueprint.beats.map(beat => Number(beat.beat_index || 0));
  const result = await polishBlueprint(context, blueprint, { taskId, force: true });
  const nextIndexes = result.blueprint.beats.map(beat => Number(beat.beat_index || 0));
  if (JSON.stringify(indexes) !== JSON.stringify(nextIndexes)) throw new Error('精修前后镜头结构不一致，已停止写入');
  result.blueprint.model_meta = {
    ...(blueprint.model_meta || {}),
    polished: true,
    polish_model: result.model_meta?.used_model || '',
    quality_before: result.before,
    quality_after: result.after,
    polished_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, 'blueprint', result.blueprint);
  storage.saveStage(taskId, 'blueprint', {
    status: 'done',
    output_summary: `${result.blueprint.beats.length} 个精品剧情镜头`,
    diagnostics: result.blueprint.model_meta,
  });
  console.log(JSON.stringify({
    task_id: taskId,
    beat_count: result.blueprint.beats.length,
    quality_before: result.before,
    quality_after: assessBlueprintQuality(result.blueprint),
    used_model: result.model_meta?.used_model || '',
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
