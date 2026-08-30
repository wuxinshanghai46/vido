'use strict';

const storage = require('./storageService');
const storyboardGenerationPreflight = require('./storyboardGenerationPreflightService');
const sceneVisualAcceptance = require('./sceneVisualAcceptanceService');
const workflowTransition = require('./workflowTransitionContractService');
const { normalizeCharacters, cleanText } = require('./contextBuilder');
const { localReview } = require('./qualityReviewService');
const storyboardReviewPolicy = require('./storyboardReviewPolicyService');
const temporalEvidenceLifecycle = require('./temporalEvidenceLifecycleService');
const contentDomainArtifacts = require('./contentDomainArtifactService');
const { buildKeyframeContracts } = require('./keyframeContractService');
const knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');
const storyboardCoverageLifecycle = require('./storyboardCoverageLifecycleService');
const { buildSoundJourney } = require('./soundJourneyService');
const soundDesignAssets = require('./soundDesignAssetService');
const keyframeContractFreshness = require('./keyframeContractFreshnessService');
const stageProgress = require('./stageProgressService');
const diagnostics = require('./diagnosticsService');
const storyFlowAuthority = require('../storyAdWorkspace/storyFlowContractService');
const { bindShotsToScenes } = require('./sceneBindingService');

function fail(message, code, status = 409, extra = {}) {
  return Object.assign(new Error(message), { code, status, ...extra });
}

function recoverAtomic(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw fail('任务不存在', 'TASK_NOT_FOUND', 404);
  if (task.active_generation_id) throw fail('当前仍有生成任务执行，不能恢复分镜断点', 'GENERATION_ACTIVE_EDIT_BLOCKED');
  if (!storyFlowAuthority.inspect(taskId).ready) storyFlowAuthority.rebindSystemAuthority(taskId);
  const sceneVerificationOptions = {
    acceptance: storage.getOutput(taskId, sceneVisualAcceptance.OUTPUT_KIND) || null,
  };
  storyboardGenerationPreflight.assertUpstreamReady(taskId, { sceneVerificationOptions: () => sceneVerificationOptions });
  const { ctx, scene_assets: sceneAssets, story_flow_contract: storyFlowContract } = storyboardGenerationPreflight.assertReady(taskId, { sceneVerificationOptions: () => sceneVerificationOptions });
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const sourceFingerprint = blueprint.fingerprint || workflowTransition.blueprintFingerprint(blueprint);
  const checkpoint = storage.getOutput(taskId, 'storyboard_checkpoint') || {};
  const checkpointShots = Array.isArray(checkpoint.shots) ? checkpoint.shots : [];
  const expectedTotal = Math.max(1, Number(checkpoint.expected_total || blueprint.beats?.length || 0));
  const indexes = new Set(checkpointShots.map((shot, index) => Number(shot.index || shot.shot_index || index + 1)));
  const complete = checkpointShots.length === expectedTotal
    && indexes.size === expectedTotal
    && Array.from({ length: expectedTotal }, (_, index) => indexes.has(index + 1)).every(Boolean);
  if (checkpoint.blueprint_fingerprint !== sourceFingerprint || !complete) {
    throw fail('分镜断点与当前剧本不一致或尚未完整，不能无模型恢复', 'STORYBOARD_CHECKPOINT_NOT_RECOVERABLE');
  }
  const stageCtx = {
    ...ctx, story_flow_contract: storyFlowContract,
    scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
    expected_storyboard_count: expectedTotal,
    scene_visual_acceptance_current: true,
    characters: normalizeCharacters(
      Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters,
      `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`,
    ),
  };
  const reboundShots = bindShotsToScenes(checkpointShots, stageCtx.scene_assets);
  const review = storyboardReviewPolicy.publishableReview(localReview(stageCtx, reboundShots));
  if (review.blocking_issues.length) {
    throw fail(`分镜断点仍有硬阻断，不能自动恢复：${review.blocking_issues.join('；')}`, 'STORYBOARD_CHECKPOINT_REVIEW_BLOCKED', 409, { review });
  }
  const compiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx: stageCtx, blueprint, shots: reboundShots });
  const shots = contentDomainArtifacts.tagShots(ctx, compiled.shots);
  const contracts = buildKeyframeContracts({
    ...stageCtx,
    temporal_evidence_graph: compiled.graph,
    knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId),
  }, shots);
  if (contracts.length !== shots.length) throw fail('关键帧合同未覆盖全部镜头，不能自动恢复', 'STORYBOARD_CHECKPOINT_CONTRACT_INCOMPLETE');
  const expectedCoveragePlan = storyboardCoverageLifecycle.expectedPlan(blueprint, ctx);
  const coveragePlan = checkpoint.coverage_plan?.contract_version ? checkpoint.coverage_plan : expectedCoveragePlan;
  const recoveredAt = new Date().toISOString();
  storage.withWriteBatch(() => {
    storage.saveOutput(taskId, 'storyboard_coverage_plan', coveragePlan);
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveOutput(taskId, 'storyboard_meta', {
      status: 'ready', source: 'recovered_checkpoint',
      blueprint_revision: Number(blueprint.revision || checkpoint.blueprint_revision || 1),
      blueprint_fingerprint: sourceFingerprint,
      story_flow_contract_fingerprint: storyFlowContract.contract_fingerprint,
      ...storyboardCoverageLifecycle.metadata(coveragePlan, expectedCoveragePlan),
      completed_at: recoveredAt,
      recovery_reason: cleanText(options.reason || 'accepted_scene_policy_recovery', 120),
    });
    storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(shots));
    storage.saveOutput(taskId, soundDesignAssets.PROFILE_KIND, soundDesignAssets.compile(taskId).profiles);
    storage.saveOutput(taskId, 'quality_review', review);
    storage.saveReview(taskId, 'storyboard.recovery.local', review);
    keyframeContractFreshness.persist(taskId, contracts);
    storage.deleteOutput(taskId, 'storyboard_checkpoint');
    storage.saveStage(taskId, 'storyboard', { status: 'done', output_summary: `${shots.length} 个镜头从完整断点恢复`, diagnostics: { ...review, recovery_without_provider: true } });
    storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
    const doneProgress = stageProgress.update(taskId, {
      stage: 'storyboard', status: 'done', phase: 'checkpoint_recovered',
      completed: shots.length, total: shots.length, processed: shots.length,
      currentIndex: shots.length, percent: 100,
      message: `已从完整断点恢复 ${shots.length} 个分镜，不产生模型调用`,
    });
    storage.updateTask(taskId, {
      status: 'done', stage: 'keyframe_contract_ready', error: '', error_code: '', retryable: false,
      active_generation_id: '', active_stage: '',
      generation_progress: { ...doneProgress, target_total: shots.length },
      diagnostics: diagnostics.summarizeTask({ task, review }),
    });
  });
  return { shots, review, keyframe_contracts: contracts, recovered_at: recoveredAt, provider_calls: 0 };
}

function recover(taskId, options = {}) {
  return storage.withWriteBatch(() => recoverAtomic(taskId, options));
}

module.exports = { recover };
