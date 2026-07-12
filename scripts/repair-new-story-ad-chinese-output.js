const storage = require('../src/services/newStoryAd/storageService');
const { ensureChineseOutput, assessChineseContent } = require('../src/services/newStoryAd/outputLanguageService');

function structureOf(payload, kind) {
  if (kind === 'blueprint') {
    return {
      beats: Array.isArray(payload?.beats) ? payload.beats.map(beat => Number(beat.beat_index || 0)) : [],
      segments: Array.isArray(payload?.segment_plan) ? payload.segment_plan.length : 0,
      characters: Array.isArray(payload?.characters) ? payload.characters.length : 0,
    };
  }
  return (Array.isArray(payload) ? payload : []).map(shot => ({
    index: Number(shot.index || 0),
    duration: Number(shot.duration || 0),
    scene_id: String(shot.scene_id || ''),
    scene_revision: Number(shot.scene_revision || 0),
  }));
}

async function repairKind(taskId, kind, context) {
  const payload = storage.getOutput(taskId, kind);
  if (!payload) return { kind, status: 'missing' };
  const before = assessChineseContent(payload);
  if (!before.needsRepair) return { kind, status: 'already_chinese', diagnostics: before };
  const expectedStructure = JSON.stringify(structureOf(payload, kind));
  const result = await ensureChineseOutput({ payload, kind: kind === 'storyboard_table' ? 'storyboard' : 'blueprint', taskId, context });
  const actualStructure = JSON.stringify(structureOf(result.payload, kind));
  if (actualStructure !== expectedStructure) throw new Error(`${kind} 中文化后结构校验失败，已停止写入`);
  if (kind === 'blueprint' && result.payload && typeof result.payload === 'object') {
    result.payload.model_meta = {
      ...(result.payload.model_meta || {}),
      language_repaired: true,
      language_model: result.model_meta?.used_model || '',
      language_repaired_at: new Date().toISOString(),
    };
  }
  storage.saveOutput(taskId, kind, result.payload);
  return { kind, status: 'repaired', diagnostics: result.assessment, structure_preserved: true, used_model: result.model_meta?.used_model || '' };
}

async function main() {
  const taskId = String(process.argv[2] || '').trim();
  if (!taskId) throw new Error('用法: node scripts/repair-new-story-ad-chinese-output.js <taskId>');
  const task = storage.getTask(taskId);
  if (!task) throw new Error(`剧情广告任务不存在: ${taskId}`);
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const results = [];
  results.push(await repairKind(taskId, 'blueprint', context));
  results.push(await repairKind(taskId, 'storyboard_table', context));
  console.log(JSON.stringify({ task_id: taskId, results }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
