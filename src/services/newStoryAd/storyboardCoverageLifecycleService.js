'use strict';

const productionLimits = require('./productionLimitsService');
const { storyboardCoveragePlan } = require('./storyboardTableService');

function expectedPlan(blueprint = {}, context = {}) {
  return storyboardCoveragePlan(blueprint, {
    ...context,
    expected_storyboard_count: productionLimits.requiredStoryboardShotCount(
      context.target_duration,
      Math.max(Number(context.shot_count || 0), Number(blueprint.beats?.length || 0)),
    ),
  });
}

function cacheCurrent(meta = {}, storedPlan = null, expected = {}) {
  return meta.source === 'user_edit'
    || (storedPlan?.contract_version === expected.contract_version
      && storedPlan?.coverage_hash === expected.coverage_hash);
}

function metadata(plan = {}, fallback = {}) {
  const current = plan?.contract_version ? plan : fallback;
  return {
    coverage_contract_version: current.contract_version || '',
    coverage_hash: current.coverage_hash || '',
  };
}

function checkpointWriter({ storage, stageProgress, taskId, blueprint, blueprintRevision, blueprintFingerprint, expectedPlan, expectedTotal, generationId, startedAt }) {
  return async ({ phase = 'running', shots = [], completed_indexes = [], expected_total = 0, coverage_plan = null } = {}) => {
    storage.saveOutput(taskId, 'storyboard_checkpoint', {
      schema_version: 1, status: 'running', phase,
      blueprint_revision: blueprintRevision,
      blueprint_fingerprint: blueprintFingerprint,
      expected_total: Number(expected_total || blueprint.beats?.length || 0),
      completed_count: completed_indexes.length || shots.length,
      completed_indexes, shots, coverage_plan: coverage_plan || expectedPlan,
      updated_at: new Date().toISOString(),
    });
    const processed = Math.min(Number(expected_total || expectedTotal), completed_indexes.length || shots.length);
    const targetTotal = Math.max(1, Number(expected_total || expectedTotal));
    const reviewPhase = phase === 'reviewing' || /^rewrite_/.test(phase);
    const percent = reviewPhase ? (phase === 'reviewing' ? 84 : (phase.startsWith('rewrite_1') ? 90 : 94)) : Math.min(80, Math.round((processed / targetTotal) * 80));
    const progress = stageProgress.update(taskId, {
      stage: 'storyboard', phase, completed: processed, total: targetTotal, processed,
      currentIndex: Math.min(targetTotal, processed + 1), percent, generationId, startedAt,
      message: reviewPhase ? '分镜初稿已生成，正在执行结构与商业一致性审核' : `已生成 ${processed}/${targetTotal} 个分镜`,
    });
    storage.updateTask(taskId, { generation_progress: { ...progress, target_total: targetTotal } });
  };
}

module.exports = { expectedPlan, cacheCurrent, metadata, checkpointWriter };
