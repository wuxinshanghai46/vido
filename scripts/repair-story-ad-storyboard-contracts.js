const storage = require('../src/services/newStoryAd/storageService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const { normalizeKeyframeNotes } = require('../src/services/newStoryAd/storyboardTableService');
const { localReview } = require('../src/services/newStoryAd/qualityReviewService');
const { bindShotsToScenes } = require('../src/services/newStoryAd/sceneBindingService');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '') : '';
}

async function main() {
  const taskId = arg('--task');
  const apply = process.argv.includes('--apply');
  if (!taskId) throw new Error('缺少 --task <任务ID>');
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.active_generation_id) throw new Error('任务正在生成，禁止修复');
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = storage.getOutput(taskId, 'storyboard_table') || [];
  const storyboardImages = storage.getOutput(taskId, 'storyboard_images') || [];
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || context.scene_assets || [];
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const reviewContext = {
    ...context,
    scene_assets: sceneAssets,
    characters: Array.isArray(context.characters) && context.characters.length
      ? context.characters
      : (Array.isArray(blueprint.characters) ? blueprint.characters : []),
  };
  const callsBefore = storage.getTaskBundle(taskId, { diagnostics: true }).model_calls.length;
  const storyboardImagesBefore = storage.canonicalFingerprint(storyboardImages);
  const repaired = bindShotsToScenes(
    shots.map(shot => ({ ...shot, keyframe_notes: normalizeKeyframeNotes(shot, context) })),
    sceneAssets,
  );
  const changedIndexes = repaired
    .map((shot, index) => shot.keyframe_notes !== shots[index]?.keyframe_notes ? Number(shot.shot_index || shot.index || index + 1) : 0)
    .filter(Boolean);
  const review = localReview({ ...reviewContext, expected_storyboard_count: shots.length }, repaired);
  const audit = {
    task_id: taskId,
    apply,
    changed_indexes: changedIndexes,
    shot_count: shots.length,
    storyboard_image_count: storyboardImages.length,
    blocking_issues: review.blocking_issues || [],
    rewrite_issues: review.rewrite_issues || [],
    model_calls_before: callsBefore,
  };
  if (!apply) return console.log(JSON.stringify(audit, null, 2));
  if (!shots.length) throw new Error('没有可修复的文字分镜');
  if (review.blocking_issues?.length || review.rewrite_issues?.length) {
    throw new Error(`修复后的分镜仍未通过审核：${[...(review.blocking_issues || []), ...(review.rewrite_issues || [])].join('；')}`);
  }
  storage.saveOutput(taskId, 'storyboard_table', repaired);
  storage.saveOutput(taskId, 'quality_review', review);
  storage.saveOutput(taskId, 'storyboard_meta', {
    ...(storage.getOutput(taskId, 'storyboard_meta') || {}),
    status: 'ready',
    contract_repaired_at: new Date().toISOString(),
  });
  const contracts = await storyAd.buildKeyframeContractStage(taskId);
  const finishedAt = new Date().toISOString();
  storage.saveStage(taskId, 'storyboard', {
    status: 'done',
    output_summary: `${repaired.length} 个镜头的关键帧三段合同已修复`,
    diagnostics: { repair: 'structured_keyframe_notes', changed_indexes: changedIndexes, model_call_count: 0 },
  });
  storage.updateTask(taskId, {
    status: 'done',
    stage: 'keyframe_contract_ready',
    active_stage: '',
    active_generation_id: '',
    error: '',
    error_code: '',
    support_id: '',
    retryable: false,
    generation_finished_at: finishedAt,
    generation_progress: {
      ...(task.generation_progress || {}),
      stage: 'storyboard',
      status: 'done',
      phase: 'contract_repaired',
      completed: repaired.length,
      total: repaired.length,
      target_total: repaired.length,
      processed: repaired.length,
      current_index: repaired.length,
      percent: 100,
      generation_id: '',
      error_code: '',
      support_id: '',
      message: `文字分镜与 ${contracts.length} 个关键帧合同已修复并保存。`,
      finished_at: finishedAt,
      updated_at: finishedAt,
    },
  });
  const callsAfter = storage.getTaskBundle(taskId, { diagnostics: true }).model_calls.length;
  const storyboardImagesAfter = storage.canonicalFingerprint(storage.getOutput(taskId, 'storyboard_images') || []);
  if (callsAfter !== callsBefore) throw new Error(`模型调用数发生变化：${callsBefore} -> ${callsAfter}`);
  if (storyboardImagesAfter !== storyboardImagesBefore) throw new Error('现有人物场景分镜图在合同修复中发生变化');
  console.log(JSON.stringify({
    ...audit,
    applied: true,
    keyframe_contracts: contracts.length,
    model_calls_after: callsAfter,
    storyboard_images_preserved: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
