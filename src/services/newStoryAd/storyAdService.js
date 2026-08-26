const fs = require('fs'), crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const storage = require('./storageService');
const modelGateway = require('./modelGateway'), jsonRepair = require('./jsonRepairService'), outputLanguage = require('./outputLanguageService');
const { buildContext, contextPrompt, cleanText, normalizeCharacters, assertContextConsistent, taskTitle } = require('./contextBuilder');
const sceneExperienceAssist = require('./sceneExperienceAssistService'), assistKnowledgePolicy = require('./assistKnowledgePolicyService'), blueprintLifecycle = require('./blueprintLifecycleService');
const { generateStoryboardTable, rewriteStoryboard } = require('./storyboardTableService');
const storyboardCoverageLifecycle = require('./storyboardCoverageLifecycleService');
const { reviewStoryboard } = require('./qualityReviewService'), storyboardContinuityGate = require('./storyboardContinuityGateService');
const { buildKeyframeContracts } = require('./keyframeContractService'), knowledgePolicyRuntime = require('./knowledgePolicyRuntimeService');
const { withContinuityContracts } = require('./continuityService');
const diagnostics = require('./diagnosticsService'), mediaAdapter = require('./mediaAdapter'), ttsAdapter = require('./ttsAdapter'), ttsReuse = require('./ttsReuseService'), videoAdapter = require('./videoAdapter');
const keyframeParallel = require('./keyframeParallelScheduler'), keyframeFailure = require('./keyframeFailureService');
const keyframeTarget = require('./keyframeTargetService');
const keyframeSubmissions = require('./keyframeSubmissionService');
const keyframeFrameState = require('./keyframeFrameStateService');
const keyframeContractFreshness = require('./keyframeContractFreshnessService'), storyboardArtifactState = require('./storyboardArtifactStateService');
const videoSubmissionGate = require('./videoSubmissionGateService'), videoFailureRecovery = require('./videoFailureRecoveryService'), videoPrivacyRetryPolicy = require('./videoPrivacyRetryPolicyService');
const videoEvidencePreflight = require('./videoEvidencePreflightService');
const videoCostAuthorization = require('./videoCostAuthorizationService');
const keyframePromptInvariants = require('./keyframePromptInvariantService');
const { compactKeyframePrompt } = require('./keyframePromptCompactorService');
const composeService = require('./composeService');
const { bindShotsToScenes, selectSceneAsset, assertVerifiedSceneAssets, assertSceneModeAssets, normalizeScenePlan, assertScenePlanContract, resolveSceneMode, completeSpaceLock, layoutSceneReference } = require('./sceneBindingService');
const shotReferencePacks = require('./shotReferencePackService');
const subjectReferences = require('./subjectReferenceService');
const subjectAssetBundle = require('./subjectAssetBundleService');
const sceneSpace = require('./sceneSpaceContractService'), assistSubjectProfiles = require('./assistSubjectProfileService');
const subjectContinuityPolicy = require('./subjectContinuityPolicyService'), subjectProfileText = require('./subjectProfileTextService');
const independentPersonPlan = require('./independentPersonPlanService'), worldSetting = require('./worldSettingContractService');
const revisionService = require('./revisionService'), sceneAuthority = require('./sceneAuthorityService'), personIdentity = require('./personIdentityContractService'), petIdentity = require('./petIdentityContractService');
const personAssetLifecycle = require('./personAssetLifecycleService'), productIdentity = require('./productIdentityContractService');
const personKeyframeQa = require('./personConsistencyQaService'), productKeyframeQa = require('./productConsistencyQaService');
const videoFrameQa = require('./videoFrameQaService');
const videoQualityPolicy = require('./videoQualityPolicyService');
const videoLineage = require('./videoLineageService'), videoBoundaryPolicy = require('./videoBoundaryPolicyService'), videoArtifactWorkflow = require('./videoArtifactWorkflowService'), videoArtifactCompatibility = require('./videoArtifactCompatibilityService'), videoComposeCompatibility = require('./videoComposeCompatibilityService');
const videoRepairPolicy = require('./videoRepairPolicy');
const videoPreflight = require('./videoPreflightService'), videoStatusProjection = require('./videoStatusProjectionService');
const videoAttemptLedger = require('./videoAttemptStore').createVideoAttemptStore(storage);
const sceneBlockService = require('./sceneBlockService'), videoClipStatusRecovery = require('./videoClipStatusRecoveryService');
const { buildSoundJourney } = require('./soundJourneyService');
const shotDesign = require('./shotDesignService');
const sceneAssistCompleteness = require('./sceneAssistCompletenessService'), assistScenePlan = require('./assistScenePlanService'), assistTextFormatter = require('./assistTextFormatterService'), assistCreativeDirection = require('./assistCreativeDirectionService'), storySetup = require('./storySetupService');
const storyBeatAssist = require('./storyBeatAssistService'), briefGoalAssist = require('./briefGoalAssistService'), briefGoalPrompt = require('./briefGoalPromptService'), briefDialogueAssist = require('./briefDialogueAssistService');
const productionBoard = require('./productionBoardContractService');
const productionPromptCompiler = require('./productionPromptCompilerService'), productionGraph = require('./productionGraphService');
const blueprintCharacterProjection = require('./blueprintCharacterProjectionService');
const { normalizeAssistedStoryBeat } = storyBeatAssist, visualRealismPolicy = require('./visualRealismPolicyService'), sceneAssetLifecycle = require('./sceneAssetService');
const sceneCheckpointProjection = require('./sceneCheckpointProjectionService');
const stageProgress = require('./stageProgressService'), taskProgressSave = require('./taskProgressSaveService');
const mediaResultProjection = require('./mediaResultProjectionService'), paidExecutionPolicy = require('./paidVideoExecutionPolicyService');
const { compactPublicTaskBundle } = require('./taskBundleProjection'), temporalEvidenceLifecycle = require('./temporalEvidenceLifecycleService'), videoCore = require('../videoGenerationCore');
const { createTaskViewService } = require('./taskViewService'), assetPlanPublication = require('./assetPlanPublicationService'), releaseBundle = require('../storyAdReleaseBundleService');
const { createTextStageRecovery } = require('./textStageRecoveryService');
const brandEnding = require('./brandEndingService');
const propAssets = require('./propAssetService'), propTimeline = require('./propTimelineService');
const assetPlan = require('./assetPlanService'), workflowTransition = require('./workflowTransitionContractService'), { blueprintFingerprint } = workflowTransition;
const assetPlanCheckpointLineage = require('./assetPlanCheckpointLineageService');
const productionLimits = require('./productionLimitsService');
const storySceneCoverage = require('./storySceneCoverageService');
const voicePlan = require('./voicePlanService');
const accountVoiceAssignment = require('./accountVoiceAssignmentService');
const contentSkill = require('./contentSkillService'), contentDomainArtifacts = require('./contentDomainArtifactService');
const workAggregate = require('./workAggregateService');
const { alignPersonAgeDescription, enforceAssistedPersonSpec } = require('./assistedPersonSpecService');
/** 读取剧情广告兼容灰度开关；关闭时仍允许查看历史项目，但禁止新的付费视频提交。 */
function storyAdV3RuntimePolicy(env = process.env) {
  const enabled = !['0', 'false', 'off', 'disabled'].includes(String(env.NEW_STORY_AD_V3_ENABLED ?? '1').trim().toLowerCase());
  const paidVideoEnabled = enabled && !['0', 'false', 'off', 'disabled'].includes(String(env.NEW_STORY_AD_V3_PAID_VIDEO_ENABLED ?? '1').trim().toLowerCase());
  return { version: videoCore.planner.PLAN_VERSION, enabled, paid_video_enabled: paidVideoEnabled };
}
function withAssetContracts(ctx = {}) {
  const next = { ...ctx };
  if (next.person_asset) {
    next.person_contract = next.person_contract || personIdentity.buildPersonContract(next.person_asset, next.person_spec || {}, { revision: next.revisions?.person || 1 });
    next.person_asset = { ...next.person_asset, person_contract: next.person_contract, person_revision: next.person_contract.person_revision };
  } else {
    next.person_contract = null;
  }
  next.product_contract = next.product_contract || productIdentity.buildProductContract(next, { revision: next.revisions?.product || 1 });
  return next;
}
const keyframeImageUrl = keyframeFrameState.imageUrl;
const localKeyframeAssetExists = keyframeFrameState.localAssetExists;
const isCompleteKeyframe = keyframeFrameState.isComplete;
const hasUsablePreviousKeyframe = keyframeFrameState.hasUsablePrevious;
const keyframeCompletion = keyframeFrameState.completion;
function keyframeTargetIndexes(shots = [], existing = [], options = {}) {
  return keyframeTarget.select(shots, existing, options, {
    hasImage: frame => {
      const url = keyframeImageUrl(frame);
      return !!(url && localKeyframeAssetExists(url));
    },
    isCurrent: frame => isCompleteKeyframe(frame)
      && !frame.regeneration_error
      && Number(frame.qa_policy_version || 0) >= 2
      && frame.contract_outdated !== true
      && !['pending', 'generating', 'retrying_serial', 'outdated'].includes(String(frame.current_generation_status || ''))
      && frame.qa?.pass === true,
  });
}
function keyframeStageBudgetMs(taskId, options = {}) {
  const shotList = storage.getOutput(taskId, 'storyboard_table') || [], keyframes = storage.getOutput(taskId, 'keyframes') || [];
  const targetCount = Math.max(1, keyframeTargetIndexes(shotList, keyframes, options).length || shotList.length || 1);
  return Math.min(8 * 60 * 60 * 1000, Math.max(10 * 60 * 1000, (4 + targetCount * 4) * 60 * 1000));
}
function longFormStageBudgetMs(taskId, stage = '') {
  const task = storage.getTask(taskId) || {};
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  contentSkill.assertSelected(ctx);
  return productionLimits.longFormStageBudgetMs(stage, ctx.target_duration, Math.max(ctx.shot_count || 0, (storage.getOutput(taskId, 'storyboard_table') || []).length));
}
function sceneConfigStageBudgetMs(taskId, options = {}) {
  const task = storage.getTask(taskId) || {};
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const checkpoint = storage.getOutput(taskId, 'asset_plan_draft_checkpoint') || {};
  const checkpointCurrent = assetPlanCheckpointLineage.compatibility(task, checkpoint, {
    fingerprint: assetPlan.fingerprint(task, ctx),
    contentMode: String(ctx.content_mode || ctx.product_presentation?.mode || ''),
    requireReusable: true,
  }).reusable;
  const valid = new Set(Array.isArray(checkpoint.valid_sections) ? checkpoint.valid_sections : []);
  const missing = new Set(Array.isArray(checkpoint.missing_sections) ? checkpoint.missing_sections : []);
  const narrative = String(ctx.content_mode || ctx.product_presentation?.mode || '') === 'narrative_story';
  const contractCurrent = Number(ctx.story_scene_contract_version || 0) >= storySceneCoverage.CONTRACT_VERSION;
  const forceReplan = options.replan_scene_coverage === true || options.replanSceneCoverage === true;
  const storyLocked = narrative
    && !forceReplan
    && contractCurrent
    && checkpointCurrent
    && valid.has('story_seed')
    && !missing.has('story_seed');
  const scenePending = !valid.has('scene_plan') || missing.has('scene_plan');
  const pendingPhaseCount = narrative
    ? ((storyLocked ? 0 : 1) + (scenePending ? 1 : 0) || 1)
    : 2;
  return productionLimits.sceneConfigStageBudgetMs({ pendingPhaseCount, candidateCount: 3 });
}
const isQaInfrastructureError = keyframeFailure.isQaInfrastructureError;
async function reviewWithInfrastructureRetry(reviewer, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return await reviewer(attempt);
    } catch (error) {
      lastError = error;
      if (!isQaInfrastructureError(error) || attempt >= attempts - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}
function structuredQaFeedback(sceneQa = {}, personQa = {}, productQa = {}) {
  const groups = [
    ['场景空间', [...(sceneQa.mismatch_reasons || []), ...(sceneQa.forbidden_new_elements || [])]],
    ['人物身份', [...(personQa.conflicts || []), personQa.retry_instruction || '']],
    ['产品主体', [...(productQa.conflicts || []), productQa.retry_instruction || '']],
  ];
  return groups
    .map(([label, values]) => {
      const details = values.map(value => cleanText(value, 160)).filter(Boolean).slice(0, 3);
      return details.length ? `${label}：${details.join('；')}` : '';
    })
    .filter(Boolean)
    .join('\n');
}
function isBeforeOrAtKeyframes(stage = '') {
  return !['tts', 'tts_ready', 'video', 'video_ready', 'compose', 'final_video_ready'].includes(String(stage || ''));
}
function assertTaskOwner(taskId, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) {
    const err = new Error('任务不存在');
    err.status = 404;
    err.code = 'TASK_NOT_FOUND';
    throw err;
  }
  const userId = String(user.id || user.userId || '').trim();
  const role = String(user.role || '').toLowerCase();
  const ownerId = String(task.user_id || task.request?.user_id || task.request?.userId || '').trim();
  if (role !== 'admin' && (!ownerId || ownerId !== userId)) {
    const err = new Error('无权访问该剧情广告任务');
    err.status = 403;
    err.code = 'TASK_FORBIDDEN';
    throw err;
  }
  return task;
}
function versionedBlueprint(blueprint = {}, previous = {}) {
  const fingerprint = blueprintFingerprint(blueprint);
  const previousFingerprint = previous.fingerprint || (Object.keys(previous || {}).length ? blueprintFingerprint(previous) : '');
  const changed = !previousFingerprint || fingerprint !== previousFingerprint;
  return {
    ...blueprint,
    revision: changed ? Math.max(1, Number(previous.revision || 0) + 1) : Math.max(1, Number(previous.revision || 1)),
    fingerprint,
  };
}
const taskViews = createTaskViewService({
  storage,
  cleanText,
  sceneCheckpointProjection,
  videoStatusProjection,
  videoAttemptLedger,
  sceneAssetLifecycle,
  personAssetLifecycle,
  videoClipStatusRecovery,
  videoBoundaryPolicy,
  mediaResultProjection,
  keyframeFailure,
  blueprintFingerprint,
  keyframeCompletion,
  isBeforeOrAtKeyframes,
  assetPlanPublication,
  assetPlanFingerprint: assetPlan.fingerprint,
});
function publicTaskBundle(taskId, options = {}) { return taskViews.publicTaskBundle(taskId, options); }
function taskSummary(task = {}, options = {}) { return taskViews.taskSummary(task, options); }
function listTaskSummaries({ limit = 50, page = 1, status = '', userId = '' } = {}) {
  const rows = storage.listTaskRows({ status, userId });
  const pageSize = Math.max(1, Math.min(200, Number(limit) || 50));
  const currentPage = Math.max(1, Number(page) || 1);
  return {
    total: rows.length,
    page: currentPage,
    page_size: pageSize,
    tasks: rows
      .slice((currentPage - 1) * pageSize, currentPage * pageSize)
      .map(task => taskSummary(task, { detailed: false })),
  };
}
function createTask(body = {}, user = {}) {
  const built = withAssetContracts(buildContext(body, user));
  const ctx = accountVoiceAssignment.applyAccountVoiceAssignments(built, { userId: built.user_id || user.id || user.userId }).context;
  const id = cleanText(body.task_id || body.taskId || '', 80) || uuidv4();
  const releaseIdentity = releaseBundle.identity();
  const task = storage.createTask({
    id,
    title: taskTitle(ctx),
    brief: ctx.brief,
    user_id: ctx.user_id,
    request: ctx,
    content_revision: 1,
    latest_client_edit_seq: Math.max(0, Number(body.client_edit_seq || body.clientEditSeq || 0) || 0),
    lineage_enforced: true,
    required_bundle_id: releaseIdentity.bundle_id,
    producer_bundle_id: releaseIdentity.bundle_id,
    release_epoch: releaseIdentity.bundle_id,
  });
  const snapshot = storage.saveSnapshot(id, {
    content_revision: 1,
    status: 'draft_saved',
    payload: ctx,
  });
  storage.saveOutput(id, 'context', ctx, {
    content_revision: 1,
    snapshot_id: snapshot.id,
    input_fingerprint: snapshot.input_fingerprint,
  });
  workAggregate.initializeAuthoritativeWork(id);
  storage.saveStage(id, 'created', { status: 'done', output_summary: '任务已创建' });
  return { task: storage.getTask(id), context: ctx, content_revision: 1, acknowledged_client_edit_seq: Math.max(0, Number(body.client_edit_seq || body.clientEditSeq || 0) || 0) };
}
function updateTaskRequest(taskId, body = {}, user = {}, options = {}) {
  let task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  if (task.lineage_enforced !== true) task = storage.enableLineage(taskId);
  const baseRevisionRaw = body.base_content_revision ?? body.baseContentRevision;
  const baseRevision = baseRevisionRaw === undefined || baseRevisionRaw === null || baseRevisionRaw === ''
    ? null
    : Math.max(1, Number(baseRevisionRaw) || 1);
  const currentRevision = Math.max(1, Number(task.content_revision || 1) || 1);
  if (baseRevision !== null && baseRevision !== currentRevision) {
    const error = new Error(`任务已在其他保存或窗口更新为版本 ${currentRevision}，当前版本 ${baseRevision} 不能覆盖最新内容`);
    error.code = 'CONTENT_REVISION_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.content_revision = currentRevision;
    throw error;
  }
  const previousCtx = options.previousContext && typeof options.previousContext === 'object'
    ? options.previousContext
    : (storage.getOutput(taskId, 'context') || task.request || {});
  if (body.reference_understanding_override && typeof body.reference_understanding_override === 'object' && revisionService.signature(body.reference_understanding_override) !== revisionService.signature(previousCtx.reference_understanding_override) && options.referenceUnderstandingEdit !== true) {
    const error = Object.assign(new Error('参考内容修订只能通过专用编辑接口保存'), { code: 'REFERENCE_UNDERSTANDING_OVERRIDE_FORBIDDEN', status: 403, retryable: false });
    throw error;
  }
  const workflowConfirmationOnly = workflowTransition.isWorkflowConfirmationOnly(body);
  const briefExplicit = Object.prototype.hasOwnProperty.call(body, 'brief')
    || Object.prototype.hasOwnProperty.call(body, 'content');
  const briefSourceExplicit = Object.prototype.hasOwnProperty.call(body, 'brief_source')
    || Object.prototype.hasOwnProperty.call(body, 'briefSource');
  const normalizedBody = briefExplicit && !briefSourceExplicit
    ? { ...body, brief_source: 'user' }
    : body;
  const projectNameExplicit = Object.prototype.hasOwnProperty.call(body, 'project_name')
    || Object.prototype.hasOwnProperty.call(body, 'projectName');
  const currentScene = sceneAuthority.currentState({ storage, taskId, task, normalizeScenePlan });
  const existingFinalVideo = storage.getOutput(taskId, 'final_video');
  const savingProgress = body.save_progress === true || body.saveProgress === true;
  const requestedScope = cleanText(body.change_scope || body.changeScope || '', 40).toLowerCase();
  const progressSnapshot = body.progress_snapshot || body.progressSnapshot || {};
  const explicitScenePlanInput = body.scene_plan || body.scenePlan || (savingProgress && requestedScope === 'scene'
    ? (progressSnapshot.scene_config || progressSnapshot.sceneConfig || null) : null);
  const ownerId = String(task.user_id || previousCtx.user_id || previousCtx.userId || user.id || user.userId || '').trim();
  let builtCtx = buildContext(
    { ...(previousCtx || {}), ...(normalizedBody || {}), task_id: taskId },
    { ...user, id: ownerId, userId: ownerId },
  );
  builtCtx = accountVoiceAssignment.applyAccountVoiceAssignments(builtCtx, { userId: ownerId }).context;
  // Active scene_spec is UI state; an explicit scene_plan owns only the scene domain.
  if (taskProgressSave.preservesAuthoritativeContext(body, { savingProgress, requestedScope, explicitScenePlan: explicitScenePlanInput })) builtCtx = previousCtx;
  else if (savingProgress && requestedScope === 'person') builtCtx = taskProgressSave.preserveProductDomain(previousCtx, builtCtx);
  const contentModeChanged = Boolean(String(previousCtx.content_mode || '').trim() && String(builtCtx.content_mode || '').trim() && String(previousCtx.content_mode || '').trim() !== String(builtCtx.content_mode || '').trim());
  contentSkill.applyModeTransition(previousCtx, builtCtx, body);
  // Completion flags are workflow state, not creative content. Running them
  // through the general context normalizer can manufacture unrelated domain
  // deltas and reset an already completed upstream step. Preserve the exact
  // creative context and change only the explicitly supplied confirmations.
  if (workflowConfirmationOnly) builtCtx = workflowTransition.applyWorkflowConfirmations(previousCtx, body);
  const explicitScenePlan = explicitScenePlanInput
    ? assertScenePlanContract(normalizeScenePlan(explicitScenePlanInput))
    : null;
  if (explicitScenePlan) builtCtx = {
    ...builtCtx,
    scene_mode: explicitScenePlan.scene_mode,
    scene_spec: explicitScenePlan.spaces[0]?.scene_spec || builtCtx.scene_spec,
  };
  const mediaChangeScope = body.media_change_scope || body.mediaChangeScope || '';
  builtCtx = taskProgressSave.preserveUnconfirmedMediaSettings(previousCtx, builtCtx, { savingProgress, mediaChangeScope });
  const hasActiveGeneration = !!String(task.active_generation_id || '').trim();
  const sceneChange = sceneAuthority.resolveChange({ previousCtx, builtCtx, explicitScenePlan, currentPlan: currentScene.plan, body, requestedScope });
  const changedDomains = workflowConfirmationOnly ? [] : sceneChange.changed_domains;
  sceneAuthority.assertCompletePlan({ savingProgress, requestedScope, explicitScenePlan, currentPlan: currentScene.plan, changedDomains });
  if (hasActiveGeneration && changedDomains.length) {
    const error = new Error('当前生成正在使用已锁定内容；请先取消或等待生成完成，再保存新的修改');
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    error.status = 409;
    error.retryable = false;
    error.active_generation_id = task.active_generation_id;
    throw error;
  }
  const scope = revisionService.changeScope(previousCtx, builtCtx, changedDomains);
  const keepVerifiedPerson = personAssetLifecycle.contractMatchesInput(
    previousCtx.person_contract || previousCtx.person_asset?.person_contract,
    builtCtx.person_asset,
    builtCtx.person_spec || {},
  );
  let ctx = revisionService.applyRevisions(previousCtx, builtCtx, changedDomains);
  ctx = contentSkill.applyModeTransition(previousCtx, ctx, body);
  if (changedDomains.length) {
    ctx.asset_setup_confirmed = body.asset_setup_confirmed === true || body.assetSetupConfirmed === true;
    ctx.scene_setup_confirmed = false; ctx.shot_design_confirmed = false;
  }
  if (changedDomains.includes('person') || changedDomains.includes('source')) {
    ctx.person_contract = keepVerifiedPerson
      ? personAssetLifecycle.carryContract(previousCtx.person_contract || previousCtx.person_asset?.person_contract, ctx.revisions?.person)
      : null;
  }
  if (changedDomains.includes('product') || changedDomains.includes('source')) ctx.product_contract = null;
  if (savingProgress || sceneChange.delta.changed) ctx.scene_assets = sceneAuthority.assetsForContext(currentScene.assets, sceneChange.delta);
  ctx = withAssetContracts(ctx);
  let invalidated = [];
  const patch = {
    // 历史任务没有 project_name；无关的需求/产品保存不得再次推导并改写用户看到的项目名。
    title: projectNameExplicit ? taskTitle(ctx) : task.title,
    brief: ctx.brief,
    request: ctx,
    content_revision: changedDomains.length ? currentRevision + 1 : currentRevision,
    latest_client_edit_seq: Math.max(
      Number(task.latest_client_edit_seq || 0) || 0,
      Number(body.client_edit_seq || body.clientEditSeq || 0) || 0,
    ),
    lineage_enforced: true,
    ...(changedDomains.length ? { current_snapshot_id: '' } : {}),
  };
  if (savingProgress) {
    const progressStage = cleanText(body.progress_stage || body.progressStage || task.stage || 'draft', 80) || 'draft';
    Object.assign(patch, taskProgressSave.taskPatch(task, { progressStage, hasActiveGeneration, changeScope: scope }));
    patch.saved_progress = true;
    patch.saved_progress_at = new Date().toISOString();
  }
  storage.updateTask(taskId, patch);
  if (changedDomains.length && !changedDomains.includes('source')) {
    storage.carryManifestRevision(taskId, patch.content_revision);
  }
  const sceneInvalidation = sceneAuthority.publishAndInvalidate({ storage, taskId, explicitScenePlan, delta: sceneChange.delta, changedDomains, sceneAssets: ctx.scene_assets || [], contentRevision: patch.content_revision });
  invalidated = sceneInvalidation.invalidated;
  const mediaInvalidated = taskProgressSave.mediaInvalidatedOutputs(previousCtx, ctx, {
    savingProgress,
    mediaChangeScope,
  });
  if (mediaInvalidated.includes('final_video')) Object.assign(patch, {
    status: 'working',
    stage: mediaInvalidated.includes('video_clips') ? 'keyframes_ready' : 'video_ready',
  });
  else if (invalidated.includes('final_video')) Object.assign(patch, {
    status: 'working',
    ...(/final|compose/.test(String(patch.stage || '')) ? { stage: 'draft' } : {}),
  });
  else if (!invalidated.includes('final_video') && (existingFinalVideo?.video_url || existingFinalVideo?.videoUrl)) Object.assign(patch, {
    status: 'done', stage: 'final_video_ready', saved_progress: false,
  });
  if (mediaInvalidated.length) storage.deleteOutputs(taskId, mediaInvalidated);
  invalidated = [...new Set([...invalidated, ...mediaInvalidated])];
  const updated = storage.updateTask(taskId, patch);
  const snapshot = storage.saveSnapshot(taskId, {
    content_revision: patch.content_revision,
    status: 'draft_saved',
    payload: ctx,
  });
  storage.saveOutput(taskId, 'context', ctx, {
    content_revision: patch.content_revision,
    snapshot_id: snapshot.id,
    input_fingerprint: snapshot.input_fingerprint,
  });
  if (!sceneInvalidation.preserved && explicitScenePlan && (changedDomains.includes('scene') || !changedDomains.length)) {
    storage.saveOutput(taskId, 'scene_config', explicitScenePlan);
  }
  storage.saveStage(taskId, 'saved', { status: 'done', output_summary: '任务进度已保存' });
  return {
    task: storage.getTask(taskId) || updated,
    context: ctx,
    content_revision: patch.content_revision,
    acknowledged_client_edit_seq: patch.latest_client_edit_seq,
    change_scope: scope,
    changed_domains: changedDomains,
    invalidated_outputs: invalidated,
    manifest: storage.getManifest(taskId),
  };
}
function prepareGeneration(taskId, body = {}, user = {}) {
  let task = assertTaskOwner(taskId, user);
  if (task.lineage_enforced !== true) task = storage.enableLineage(taskId);
  const targetStage = cleanText(body.target_stage || body.targetStage || 'blueprint', 60) || 'blueprint';
  const activeTargetJobs = Object.values(task.active_target_generations || {});
  const parallelSceneAssetRequest = targetStage === 'scene_asset' && activeTargetJobs.length > 0 && activeTargetJobs.every(job => String(job?.stage || '') === 'scene_asset')
    && activeTargetJobs.some(job => String(job?.generation_id || '') === String(task.active_generation_id || ''));
  if (task.active_generation_id && !parallelSceneAssetRequest) {
    const error = Object.assign(new Error('当前已有生成任务正在执行，不能同时创建另一条生成链路'), { code: 'GENERATION_ALREADY_ACTIVE', status: 409, retryable: false });
    throw error;
  }
  const currentRevision = Math.max(1, Number(task.content_revision || 1) || 1);
  const expectedRevision = Math.max(1, Number(body.expected_content_revision || body.expectedContentRevision || currentRevision) || currentRevision);
  if (expectedRevision !== currentRevision) {
    const error = new Error(`当前服务器最新内容为版本 ${currentRevision}，页面提交的版本 ${expectedRevision} 已过期`);
    error.code = 'CONTENT_REVISION_CONFLICT';
    error.status = 409;
    error.retryable = false;
    error.content_revision = currentRevision;
    throw error;
  }
  const expectedEditSeq = Math.max(0, Number(body.client_edit_seq || body.clientEditSeq || 0) || 0);
  const acknowledgedEditSeq = Math.max(0, Number(task.latest_client_edit_seq || 0) || 0);
  if (expectedEditSeq && expectedEditSeq !== acknowledgedEditSeq) {
    const error = new Error(`页面最新修改序号 ${expectedEditSeq} 尚未得到服务器确认，已停止生成`);
    error.code = 'UNSAVED_CLIENT_EDITS';
    error.status = 409;
    error.retryable = false;
    error.acknowledged_client_edit_seq = acknowledgedEditSeq;
    throw error;
  }
  let ctx = storage.getOutput(taskId, 'context') || task.request || {};
  ctx = accountVoiceAssignment.applyAndPersistContext(ctx, { userId: task.user_id || ctx.user_id || user.id || user.userId, taskId, contentRevision: currentRevision }, { storage });
  if (!String(ctx.brief || '').trim() && !assetPlan.referenceIsValid(ctx.reference_video_analysis)) {
    const error = new Error('请填写广告目标，或先完成参考视频分析');
    error.code = 'BRIEF_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  contentSkill.assertSelected(ctx);
  assertContextConsistent(ctx);
  storySetup.assertConfirmed(ctx, targetStage);
  brandEnding.assertReady(ctx);
  if (['storyboard', 'script_package', 'keyframes', 'media'].includes(targetStage)) {
    const storedScenePlan = storage.getOutput(taskId, 'scene_config');
    if (!storedScenePlan && targetStage === 'script_package') {
      const error = new Error('请先完成并保存场景配置，再生成剧本与分镜');
      error.code = 'SCENE_CONFIG_REQUIRED';
      error.status = 422;
      error.retryable = false;
      throw error;
    }
    const scenePlan = normalizeScenePlan(storedScenePlan || {});
    const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
    assertSceneModeAssets(resolveSceneMode(ctx.scene_mode, scenePlan), sceneAssets, scenePlan.spaces);
  }
  const snapshot = storage.saveSnapshot(taskId, {
    content_revision: currentRevision,
    status: 'sealed',
    payload: ctx,
  });
  storage.updateTask(taskId, {
    current_snapshot_id: snapshot.id,
    preflight_revision: currentRevision,
    preflight_snapshot_id: snapshot.id,
    preflight_target_stage: targetStage,
    preflight_at: new Date().toISOString(),
  });
  storage.saveStage(taskId, 'preflight', {
    status: 'done',
    input_summary: `内容版本 ${currentRevision}`,
    output_summary: '最新版内容、人物、场景、商品和剧情表演约束预检通过',
    diagnostics: {
      snapshot_id: snapshot.id,
      content_revision: currentRevision,
      input_fingerprint: snapshot.input_fingerprint,
      target_stage: targetStage,
      client_edit_seq: acknowledgedEditSeq,
    },
  });
  return {
    task_id: taskId,
    content_revision: currentRevision,
    acknowledged_client_edit_seq: acknowledgedEditSeq,
    snapshot_id: snapshot.id,
    input_fingerprint: snapshot.input_fingerprint,
    target_stage: targetStage,
    preflight: {
      ready: true,
      model_calls_started: 0,
      creative_direction_present: !!(
        ctx.creative_direction?.raw
        || ctx.creative_direction?.plot_direction
        || ctx.creative_direction?.actions?.length
      ),
      person_count: Number(ctx.expected_people || 0) || 0,
      scene_count: Array.isArray(ctx.scene_assets) ? ctx.scene_assets.length : 0,
      product_locked: !!(ctx.product_contract || ctx.product_subject),
    },
  };
}
async function verifyPersonContract(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  if (!ctx.person_asset) {
    const error = new Error('当前任务没有可验证的人物资产');
    error.code = 'PERSON_ASSET_REQUIRED';
    error.status = 422;
    throw error;
  }
  const verified = await subjectAssetBundle.reverifyPersonBundle({
    taskId,
    personAsset: ctx.person_asset,
    castProfiles: Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : [],
    subjectTargets: options.subject_targets || options.subjectTargets || [],
    personSpec: ctx.person_spec || {},
  });
  const next = {
    ...ctx,
    person_contract: verified.person_contract,
    person_asset: verified.person_asset,
    cast_profiles: verified.cast_profiles,
  };
  storage.saveOutput(taskId, 'context', next);
  storage.saveOutput(taskId, 'person_contract', verified.person_contract);
  storage.updateTask(taskId, { request: next, updated_at: new Date().toISOString() });
  return verified;
}
async function verifyProductContract(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const contract = await productIdentity.verifyProductContract({ taskId, ctx });
  const next = { ...ctx, product_contract: contract };
  storage.saveOutput(taskId, 'context', next);
  storage.saveOutput(taskId, 'product_contract', contract);
  storage.updateTask(taskId, { request: next });
  return { product_contract: contract };
}
function normalizeBlueprintDraft(blueprint = {}, seed = '') {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const cleanSpeech = value => cleanText(value, 700).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
  const fallbackSpoken = (beat = {}, index = 0) => {
    const proof = cleanText(beat.visual_proof || beat.evidence || beat.purpose || beat.objective || '', 42);
    const visual = cleanText(beat.visual || beat.story_visual || beat.promo_visual || beat.plot || beat.action || '', 42);
    if (proof) return `这一镜看清${proof}。`;
    if (visual) return `先看${visual}。`;
    return `继续看第 ${index + 1} 镜的关键变化。`;
  };
  return {
    ...blueprint,
    story_title: cleanText(blueprint.story_title || blueprint.title || '剧情广告剧本', 120),
    logline: cleanText(blueprint.logline || blueprint.summary || '', 500),
    characters: normalizeCharacters(Array.isArray(blueprint.characters) ? blueprint.characters : [], seed),
    beats: beats.map((beat, index) => {
      const duration = Math.max(1, Math.min(30, Number(beat.duration || beat.duration_sec || beat.seconds || 0) || 3));
      const visual = cleanText(beat.visual || beat.story_visual || beat.promo_visual || beat.plot || '', 1200);
      const action = cleanText(beat.action || beat.character_action || beat.behavior || '', 800);
      const spoken = cleanSpeech(beat.spoken_line || beat.voiceover || beat.copy || beat.dialogue || fallbackSpoken(beat, index));
      const proof = cleanText(beat.visual_proof || beat.evidence || beat.purpose || beat.objective || '', 800);
      const title = cleanText(beat.title || beat.role || `镜头 ${index + 1}`, 120);
      return {
        ...beat,
        beat_index: index + 1,
        index: index + 1,
        duration,
        duration_sec: duration,
        title,
        role: cleanText(beat.role || title || 'story', 80),
        plot: visual || action || cleanText(beat.plot || '', 1200),
        visual,
        story_visual: visual,
        action,
        spoken_line: spoken,
        voiceover: spoken,
        visual_proof: proof,
        purpose: cleanText(beat.purpose || beat.objective || proof || '', 160),
        confirmed: beat.confirmed !== false,
      };
    }).filter(beat => beat.plot || beat.visual || beat.action || beat.spoken_line || beat.visual_proof),
    edited_at: new Date().toISOString(),
    edited_by_user: true,
  };
}

function updateBlueprint(taskId, blueprint = {}, user = {}, options = {}) {
  let task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  if (task.lineage_enforced !== true) task = storage.enableLineage(taskId);
  workflowTransition.assertManualEditRevision(task, options);
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时修改剧本；请先取消或等待完成');
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    error.status = 409;
    throw error;
  }
  const previous = storage.getOutput(taskId, 'blueprint') || {};
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const normalized = versionedBlueprint(contentDomainArtifacts.tagBlueprint(ctx,
    productionBoard.normalizeBoard(normalizeBlueprintDraft({
      ...previous,
      ...(blueprint || {}),
    }, `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`), { seed: taskId })),
    previous,
  );
  const changed = blueprintFingerprint(previous) !== blueprintFingerprint(normalized);
  if (changed) {
    const nextRevision = Math.max(1, Number(task.content_revision || 1) || 1) + 1;
    storage.updateTask(taskId, { content_revision: nextRevision, current_snapshot_id: '' });
    revisionService.invalidateOutputs(storage, taskId, ['blueprint']);
    storage.carryManifestRevision(taskId, nextRevision);
    assetPlanPublication.carryForward(taskId, {
      contentRevision: nextRevision,
      reason: 'manual_blueprint_edit_preserves_upstream_plan',
    });
    const nextCtx = blueprintCharacterProjection.projectCharacters(ctx, normalized);
    storage.saveOutput(taskId, 'context', nextCtx);
    storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
    const snapshot = storage.saveSnapshot(taskId, {
      content_revision: nextRevision,
      status: 'manual_blueprint_edit',
      payload: nextCtx,
    });
    storage.saveOutput(taskId, 'blueprint', normalized, {
      content_revision: nextRevision,
      snapshot_id: snapshot.id,
      input_fingerprint: normalized.fingerprint,
    });
  } else {
    storage.saveOutput(taskId, 'blueprint', normalized);
  }
  storage.saveStage(taskId, 'blueprint', {
    status: 'done',
    output_summary: `${normalized.beats.length} script shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.updateTask(taskId, { status: 'running', stage: 'blueprint_done', error: '', error_code: '', retryable: false });
  return normalized;
}

function normalizeStoryboardShot(shot = {}, index = 0, previousShot = {}) {
  const duration = Math.max(1, Math.min(15, Number(shot.duration || shot.duration_sec || 0) || 3));
  const visual = cleanText(shot.visual || shot.visual_description || shot.content_prompt || '', 1400);
  const action = cleanText(shot.action || shot.visual_action || '', 900);
  const voiceover = cleanText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 700).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
  const title = cleanText(shot.title || `Shot ${index + 1}`, 140);
  const purpose = cleanText(shot.purpose || shot.objective || shot.role || '', 160);
  const previousVisual = cleanText(previousShot.visual || previousShot.visual_description || previousShot.content_prompt || '', 1400);
  const incomingEditedFields = shot._nsa_user_edited_fields && typeof shot._nsa_user_edited_fields === 'object'
    ? shot._nsa_user_edited_fields
    : {};
  const visualChanged = !!visual && !!previousVisual && visual !== previousVisual;
  const userVisualOverride = shot.user_visual_override === true || incomingEditedFields.visual === true || visualChanged;
  const editedFields = userVisualOverride ? { ...incomingEditedFields, visual: true } : incomingEditedFields;
  const design = shotDesign.normalizeShotDesign(shot);
  const frameStates = workflowTransition.referenceFrameStates(shot, { visual, action, cleanText });
  return {
    ...shot,
    _prompt_preview: undefined,
    index: index + 1,
    shot_index: index + 1,
    duration,
    duration_sec: duration,
    title,
    visual,
    visual_description: visual,
    content_prompt: visual,
    action,
    visual_action: action,
    voiceover,
    narration: voiceover,
    purpose,
    keyframe_notes: userVisualOverride ? [purpose, visual].filter(Boolean).join('\n') : cleanText(shot.keyframe_notes || '', 900),
    material_usage: userVisualOverride ? [purpose, visual].filter(Boolean).join('\n') : cleanText(shot.material_usage || '', 900),
    user_visual_override: userVisualOverride || undefined,
    _nsa_user_edited_fields: Object.keys(editedFields).length ? editedFields : undefined,
    scene_id: cleanText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || previousShot.scene_id || '', 120) || undefined,
    scene_asset_id: cleanText(shot.scene_asset_id || shot.sceneAssetId || shot.scene_id || shot.sceneId || previousShot.scene_asset_id || '', 120) || undefined,
    scene_name: cleanText(shot.scene_name || shot.sceneName || previousShot.scene_name || '', 120) || undefined,
    scene_view: cleanText(shot.scene_view || shot.sceneView || previousShot.scene_view || '', 40) || undefined,
    scene_zone: cleanText(shot.scene_zone || shot.sceneZone || shot.zone || previousShot.scene_zone || '', 160) || undefined,
    scene_zone_id: cleanText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : '') || previousShot.scene_zone_id || '', 100) || undefined,
    scene_zone_label_zh: cleanText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || previousShot.scene_zone_label_zh || previousShot.scene_zone || '', 160) || undefined,
    zone_ids: Array.isArray(shot.zone_ids) ? shot.zone_ids : (Array.isArray(previousShot.zone_ids) ? previousShot.zone_ids : undefined),
    anchor_ids: Array.isArray(shot.anchor_ids) ? shot.anchor_ids : (Array.isArray(previousShot.anchor_ids) ? previousShot.anchor_ids : undefined),
    transition_from: cleanText(shot.transition_from || shot.transitionFrom || previousShot.transition_from || '', 120) || undefined,
    transition_reason: cleanText(shot.transition_reason || shot.transitionReason || previousShot.transition_reason || '', 240) || undefined,
    ...frameStates,
    requires_previous_frame: shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
      || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true',
    shot_scope: design.shot_scope,
    surface_topology: design.surface_topology,
    motion_effect: design.motion_effect,
    action_contract: design.action_contract,
    edited_at: new Date().toISOString(),
  };
}

function updateStoryboardTable(taskId, shots = [], user = {}, options = {}) {
  let task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  if (task.lineage_enforced !== true) task = storage.enableLineage(taskId);
  workflowTransition.assertManualEditRevision(task, options);
  if (task.active_generation_id) {
    const error = new Error('当前生成正在执行，不能同时修改分镜；请先取消或等待完成');
    error.code = 'GENERATION_ACTIVE_EDIT_BLOCKED';
    error.status = 409;
    throw error;
  }
  const current = storage.getOutput(taskId, 'storyboard_table') || [];
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const source = Array.isArray(shots) && shots.length ? shots : current;
  const normalizedRaw = contentDomainArtifacts.tagShots(ctx, source
    .map((shot, index) => normalizeStoryboardShot(shot, index, current[index] || {}))
    .filter(shot => shot.visual || shot.action || shot.voiceover || shot.title));
  const continuityShots = withContinuityContracts(bindShotsToScenes(normalizedRaw, Array.isArray(sceneAssets) ? sceneAssets : []));
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const compiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx, blueprint, shots: continuityShots }), normalized = compiled.shots;
  const storyboardChanged = workflowTransition.storyboardFingerprint(current) !== workflowTransition.storyboardFingerprint(normalized);
  if (storyboardChanged) {
    const nextRevision = Math.max(1, Number(task.content_revision || 1) || 1) + 1;
    storage.updateTask(taskId, { content_revision: nextRevision, current_snapshot_id: '' });
    ['quality_review', 'tts_audio', 'video_scene_blocks', 'final_video']
      .forEach(kind => storage.deleteOutput(taskId, kind));
    storage.carryManifestRevision(taskId, nextRevision);
    storage.saveSnapshot(taskId, {
      content_revision: nextRevision,
      status: 'manual_storyboard_edit',
      payload: ctx,
    });
  }
  storage.saveOutput(taskId, 'storyboard_table', normalized);
  if ((storage.getOutput(taskId, 'prop_assets') || []).length) propAssets.refreshPropTimelines(taskId);
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'ready',
    source: 'user_edit',
    blueprint_revision: Number(blueprint.revision || 0),
    blueprint_fingerprint: blueprint.fingerprint || blueprintFingerprint(blueprint),
    completed_at: new Date().toISOString(),
  });
  storage.deleteOutput(taskId, 'storyboard_checkpoint');
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(normalized));
  const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [], temporal_evidence_graph: compiled.graph, knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId) };
  const contracts = buildKeyframeContracts(contractCtx, normalized);
  const artifactState = storyboardArtifactState.persistAndSnapshot(taskId, contracts, { clearDownstream: current.length !== normalized.length });
  storage.saveStage(taskId, 'storyboard', {
    status: 'done',
    output_summary: `${normalized.length} storyboard shots saved`,
    diagnostics: {
      edited_by: user.id || user.username || '',
      edited_by_user: true,
    },
  });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} keyframe contracts rebuilt` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready', error: '', error_code: '', retryable: false });
  return { shots: normalized, keyframe_contracts: contracts, ...artifactState };
}

async function generateSceneConfig(taskId, options = {}) {
  return assetPlan.generate(taskId, options);
}

async function updatePersonPlan(taskId, options = {}) {
  return independentPersonPlan.complete(taskId, options, { assistBrief });
}

async function updateScenePlan(taskId, options = {}) {
  return assetPlan.replanScene(taskId, options);
}

async function generateBlueprintStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  const ctx = storage.getOutput(taskId, 'context') || task?.request || {};
  const blueprint = await blueprintLifecycle.generateBlueprintStage(taskId, options, {
    versionedBlueprint: (value, previous) => versionedBlueprint(productionBoard.normalizeBoard({ ...value, ...contentDomainArtifacts.fields(ctx) }, { seed: taskId }), previous),
  });
  const nextCtx = blueprintCharacterProjection.projectCharacters(storage.getOutput(taskId, 'context') || ctx, blueprint);
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  return blueprint;
}

function recoverBlueprintStage(taskId) {
  const recovered = blueprintLifecycle.recoverBlueprintWithoutProvider(taskId);
  if (!recovered) return null;
  const task = storage.getTask(taskId);
  const ctx = storage.getOutput(taskId, 'context') || task?.request || {};
  const nextCtx = blueprintCharacterProjection.projectCharacters(ctx, recovered.blueprint);
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  return recovered;
}

const runTextStageWithRecovery = createTextStageRecovery(storage, cleanText);

async function generateScriptPackageStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const scenePlan = normalizeScenePlan(storage.getOutput(taskId, 'scene_config') || {});
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  assertSceneModeAssets(resolveSceneMode(ctx.scene_mode, scenePlan), sceneAssets, scenePlan.spaces);
  const blueprint = await runTextStageWithRecovery(
    taskId,
    'blueprint',
    attempt => generateBlueprintStage(taskId, { ...options, internal_attempt: attempt }),
    { maxAttempts: 2 },
  );
  const storyboard = await runTextStageWithRecovery(
    taskId,
    'storyboard',
    attempt => generateStoryboardStage(taskId, { ...options, internal_attempt: attempt }),
    { maxAttempts: 2 },
  );
  storage.saveStage(taskId, 'script_package', {
    status: 'done',
    output_summary: `剧本 ${blueprint.beats?.length || 0} 镜、分镜 ${storyboard.shots?.length || storyboard.length || 0} 镜均已生成并通过检查`,
    diagnostics: {
      content_revision: Number(storage.getTask(taskId)?.content_revision || 1) || 1,
      automatic_recovery_enabled: true,
      max_internal_attempts_per_stage: 2,
    },
  });
  return { blueprint, storyboard };
}

async function generateStoryboardStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  contentSkill.assertSelected(ctx);
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const scenePlan = normalizeScenePlan(storage.getOutput(taskId, 'scene_config') || {});
  assertSceneModeAssets(resolveSceneMode(ctx.scene_mode, scenePlan), sceneAssets, scenePlan.spaces);
  let blueprint = storage.getOutput(taskId, 'blueprint');
  if (!blueprint) blueprint = await generateBlueprintStage(taskId);
  if (!blueprint.fingerprint) {
    blueprint = versionedBlueprint(blueprint, {});
    storage.saveOutput(taskId, 'blueprint', blueprint);
  }
  const sourceFingerprint = blueprint.fingerprint;
  const sourceRevision = Number(blueprint.revision || 1);
  const generationId = cleanText(options.generation_id || options.generationId || '', 80);
  const existingMeta = storage.getOutput(taskId, 'storyboard_meta') || {};
  const existingShots = storage.getOutput(taskId, 'storyboard_table') || [];
  const existingContracts = storage.getOutput(taskId, 'keyframe_contracts') || [];
  const expectedCoveragePlan = storyboardCoverageLifecycle.expectedPlan(blueprint, ctx);
  const existingCoveragePlan = storage.getOutput(taskId, 'storyboard_coverage_plan') || null;
  const coverageCurrent = storyboardCoverageLifecycle.cacheCurrent(existingMeta, existingCoveragePlan, expectedCoveragePlan);
  if (existingMeta.status === 'ready' && existingMeta.blueprint_fingerprint === sourceFingerprint
    && coverageCurrent && existingShots.length && existingContracts.length === existingShots.length) {
    storage.saveStage(taskId, 'storyboard', { status: 'done', output_summary: `${existingShots.length} 个镜头（蓝图未变化，已复用）`, diagnostics: { cache_hit: true, blueprint_fingerprint: sourceFingerprint } });
    stageProgress.update(taskId, { stage: 'storyboard', status: 'done', phase: 'fingerprint_reused', completed: existingShots.length, total: existingShots.length, processed: existingShots.length, percent: 100, generationId, message: '蓝图指纹一致，已复用完整分镜和关键帧合同' });
    return { shots: existingShots, review: storage.getOutput(taskId, 'quality_review') || {}, keyframe_contracts: existingContracts, model_meta: { cache_hit: true } };
  }
  const startedAt = new Date().toISOString();
  const savedCheckpoint = storage.getOutput(taskId, 'storyboard_checkpoint') || null;
  const resumeShots = savedCheckpoint?.blueprint_fingerprint === sourceFingerprint && Array.isArray(savedCheckpoint.shots)
    ? savedCheckpoint.shots
    : [];
  const characterSeed = `${ctx.request_id || taskId}|${ctx.brief || ''}|${ctx.product_subject || ''}`;
  const stageCtx = {
    ...ctx,
    scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [],
    expected_storyboard_count: productionLimits.requiredStoryboardShotCount(
      ctx.target_duration,
      Math.max(Number(ctx.shot_count || 0), Number(blueprint.beats?.length || 0)),
    ),
    characters: normalizeCharacters(Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters, characterSeed),
  };
  const expectedTotal = Math.max(1, Number(stageCtx.expected_storyboard_count || blueprint.beats?.length || 1));
  storage.updateTask(taskId, { status: 'running', stage: 'storyboard' });
  const initialStoryboardProgress = stageProgress.update(taskId, { stage: 'storyboard', phase: 'preparing', completed: 0, total: expectedTotal, processed: 0, currentIndex: 1, percent: 0, generationId, startedAt, message: '正在准备已确认剧本与分镜生成合同' });
  storage.updateTask(taskId, { generation_progress: { ...initialStoryboardProgress, target_total: expectedTotal } });
  storage.saveStage(taskId, 'storyboard', { status: 'running', input_summary: `${blueprint.beats?.length || 0} beats` });
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'running',
    source: 'generated',
    blueprint_revision: sourceRevision,
    blueprint_fingerprint: sourceFingerprint,
    started_at: startedAt,
  });
  const saveCheckpoint = storyboardCoverageLifecycle.checkpointWriter({
    storage, stageProgress, taskId, blueprint, blueprintRevision: sourceRevision,
    blueprintFingerprint: sourceFingerprint, expectedPlan: expectedCoveragePlan,
    expectedTotal, generationId, startedAt,
  });
  const assertBlueprintUnchanged = () => {
    const current = storage.getOutput(taskId, 'blueprint') || {};
    const currentFingerprint = current.fingerprint || blueprintFingerprint(current);
    if (currentFingerprint === sourceFingerprint) return;
    const error = new Error('剧本在分镜生成期间发生了修改，本次结果未覆盖新剧本，请重新生成分镜');
    error.code = 'BLUEPRINT_CHANGED_DURING_STORYBOARD';
    error.retryable = true;
    throw error;
  };
  const generated = await generateStoryboardTable(stageCtx, blueprint, {
    taskId,
    resumeShots,
    onCheckpoint: saveCheckpoint,
  });
  let shots = generated.shots;
  storage.saveOutput(taskId, 'storyboard_coverage_plan', generated.coverage_plan || expectedCoveragePlan);
  await saveCheckpoint({ phase: 'reviewing', shots, completed_indexes: shots.map(shot => Number(shot.index || 0)), expected_total: shots.length });
  assertBlueprintUnchanged();
  let review = await reviewStoryboard(stageCtx, shots, { taskId });
  storage.saveReview(taskId, 'storyboard.initial', review);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const issues = [
      ...(review.blocking_issues || []),
      ...(review.rewrite_issues || []),
    ];
    if (!shots.length || !issues.length) break;
    shots = await rewriteStoryboard(stageCtx, blueprint, shots, issues, { taskId });
    await saveCheckpoint({ phase: `rewrite_${attempt}_reviewing`, shots, completed_indexes: shots.map(shot => Number(shot.index || 0)), expected_total: shots.length });
    assertBlueprintUnchanged();
    const nextReview = await reviewStoryboard(stageCtx, shots, { taskId });
    storage.saveReview(taskId, `storyboard.rewrite.${attempt}`, nextReview);
    review = nextReview;
    if (!review.blocking_issues.length && !review.rewrite_issues.length) break;
  }
  if (review.blocking_issues.length) {
    const failedCompiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx: stageCtx, blueprint, shots }); shots = contentDomainArtifacts.tagShots(ctx, failedCompiled.shots);
    storage.saveOutput(taskId, 'storyboard_table', shots);
    storage.saveOutput(taskId, 'storyboard_meta', {
      status: 'failed',
      source: 'generated',
      blueprint_revision: sourceRevision,
      blueprint_fingerprint: sourceFingerprint,
      ...storyboardCoverageLifecycle.metadata(generated.coverage_plan, expectedCoveragePlan),
      completed_at: new Date().toISOString(),
    });
    storage.deleteOutput(taskId, 'storyboard_checkpoint');
    storage.saveStage(taskId, 'storyboard', { status: 'failed', error: review.blocking_issues.join('；'), diagnostics: review });
    storage.updateTask(taskId, { status: 'failed', stage: 'storyboard_failed', error: review.blocking_issues.join('；') });
    const failedProgress = stageProgress.update(taskId, { stage: 'storyboard', status: 'failed', phase: 'review_failed', completed: shots.length, total: Math.max(1, shots.length), processed: shots.length, currentIndex: shots.length, percent: 100, generationId, startedAt, message: '分镜生成已完成，但质量审核未通过' });
    storage.updateTask(taskId, { generation_progress: { ...failedProgress, target_total: Math.max(1, shots.length) } });
    const err = new Error(`剧情广告分镜硬阻断：${review.blocking_issues.join('；')}`);
    err.review = review;
    err.partial = shots;
    throw err;
  }
  assertBlueprintUnchanged();
  const compiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx: stageCtx, blueprint, shots }); shots = contentDomainArtifacts.tagShots(ctx, compiled.shots);
  const contractCtx = { ...stageCtx, temporal_evidence_graph: compiled.graph, knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId) };
  const contracts = buildKeyframeContracts(contractCtx, shots);
  storage.saveOutput(taskId, 'storyboard_table', shots);
  if ((storage.getOutput(taskId, 'prop_assets') || []).length) propAssets.refreshPropTimelines(taskId);
  storage.saveOutput(taskId, 'storyboard_meta', {
    status: 'ready',
    source: 'generated',
    blueprint_revision: sourceRevision,
    blueprint_fingerprint: sourceFingerprint,
    ...storyboardCoverageLifecycle.metadata(generated.coverage_plan, expectedCoveragePlan),
    completed_at: new Date().toISOString(),
  });
  storage.deleteOutput(taskId, 'storyboard_checkpoint');
  storage.saveOutput(taskId, 'sound_journey', buildSoundJourney(shots));
  storage.saveOutput(taskId, 'quality_review', review);
  keyframeContractFreshness.persist(taskId, contracts);
  storage.saveStage(taskId, 'storyboard', { status: 'done', output_summary: `${shots.length} 个镜头`, diagnostics: review });
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready', diagnostics: diagnostics.summarizeTask({ task, review }) });
  const doneProgress = stageProgress.update(taskId, { stage: 'storyboard', status: 'done', phase: 'persisted', completed: shots.length, total: Math.max(1, shots.length), processed: shots.length, currentIndex: shots.length, percent: 100, generationId, startedAt, message: `分镜表与 ${contracts.length} 个关键帧合同已保存` });
  storage.updateTask(taskId, { generation_progress: { ...doneProgress, target_total: Math.max(1, shots.length) } });
  return { shots, review, keyframe_contracts: contracts, model_meta: generated.model_meta };
}

async function buildKeyframeContractStage(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  let ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [], production_graph: storage.getOutput(taskId, 'production_graph_v1') || null, knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId) };
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) throw new Error('请先生成分镜表');
  shots = bindShotsToScenes(shots, ctx.scene_assets);
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const compiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx, blueprint, shots });
  shots = compiled.shots; ctx = { ...ctx, temporal_evidence_graph: compiled.graph };
  storage.saveOutput(taskId, 'storyboard_table', shots);
  const contracts = buildKeyframeContracts(ctx, shots);
  keyframeContractFreshness.persist(taskId, contracts);
  storage.saveStage(taskId, 'keyframe_contract', { status: 'done', output_summary: `${contracts.length} 个关键帧合同` });
  storage.updateTask(taskId, { status: 'done', stage: 'keyframe_contract_ready' });
  return contracts;
}

function acceptedKeyframeContextAt(keyframes = [], index = -1) {
  if (!Array.isArray(keyframes) || !Number.isInteger(index) || index < 0) return null;
  const frame = keyframes[index] || {};
  if (!hasUsablePreviousKeyframe(frame)) return null;
  return {
    index: index + 1,
    title: frame.title || `Shot ${index + 1}`,
    image_url: keyframeImageUrl(frame),
    prompt: cleanText(frame.prompt || '', 700),
  };
}

function continuityCharacterKeys(ctx = {}, shot = {}, contract = {}) {
  const values = [
    ...(Array.isArray(shot.characters) ? shot.characters : []),
    ...(Array.isArray(contract?.cast_lock?.shot_characters) ? contract.cast_lock.shot_characters : []),
  ];
  const keys = values.map(value => cleanText(value?.id || value?.name || value?.role || value, 120).toLowerCase()).filter(Boolean);
  if (!keys.length && personIdentity.shotPersonRequired(ctx, shot, contract)) keys.push('__locked_person__');
  return [...new Set(keys)].sort();
}

function continuitySceneKey(shot = {}, contract = {}) {
  return cleanText(
    contract?.scene_lock?.scene_id
      || contract?.scene_lock?.scene_zone_id
      || shot.scene_id
      || shot.sceneId
      || shot.scene_asset_id
      || shot.sceneAssetId
      || '',
    160,
  ).toLowerCase();
}

function hasHardPreviousContinuity(shot = {}, contract = {}) {
  const lock = contract?.continuity_lock || shot.continuity || {};
  const transitionType = cleanText(lock.transition_type || shot.transition_type || '', 80).toLowerCase();
  // continuity_from/entry_frame_state are auto-populated on most storyboards,
  // so treating those fields alone as hard dependencies would serialize every
  // shot. Only transitions that visually bridge adjacent frames force an
  // immediate parent; shared scene/cast dependencies are handled separately.
  const explicitlyRequired = lock.requires_previous_frame === true || shot.requires_previous_frame === true
    || shot.requiresPreviousFrame === true;
  return explicitlyRequired || /match|cut.?on.?action|continuous|动作接续|状态接续|连续/i.test(transitionType);
}

function buildKeyframeDependencyPlan(shots = [], contracts = [], ctx = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const verifiedSceneKeys = new Set((Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [])
    .filter(completeSpaceLock)
    .map((asset, index) => cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 160).toLowerCase())
    .filter(Boolean));
  const personContract = ctx.person_contract || ctx.person_asset?.person_contract || {};
  const verifiedPersonAnchor = personContract.status === 'verified' && personContract.cross_view_qa?.pass === true;
  const castMode = cleanText(ctx.cast_mode || ctx.person_asset?.cast_mode || 'single', 40).toLowerCase();
  const verifiedCharacterKeys = new Set();
  const addCharacterKey = value => {
    const key = cleanText(value?.id || value?.actor_id || value?.name || value?.displayName || value?.role || value, 120).toLowerCase();
    if (key) verifiedCharacterKeys.add(key);
  };
  if (verifiedPersonAnchor && castMode === 'single') {
    verifiedCharacterKeys.add('__locked_person__');
    [ctx.person_asset, ctx.person_spec, ...(Array.isArray(ctx.characters) ? ctx.characters : []), ...(Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length === 1 ? ctx.cast_profiles : [])]
      .filter(Boolean).forEach(addCharacterKey);
    if (ctx.person_spec?.displayName) addCharacterKey(ctx.person_spec.displayName);
    if (ctx.person_spec?.roleName) addCharacterKey(ctx.person_spec.roleName);
  }
  const multiActorSources = [
    ...(Array.isArray(ctx.cast_profiles) ? ctx.cast_profiles : []),
    ...(Array.isArray(ctx.person_asset?.cast_assets) ? ctx.person_asset.cast_assets : []),
  ];
  multiActorSources.forEach(actor => {
    const contract = actor?.person_contract || actor?.contract || {};
    const hasReference = !!(actor?.image_url || actor?.url || actor?.reference_image_url || (Array.isArray(actor?.view_images) && actor.view_images.length));
    if (hasReference && contract.status === 'verified' && contract.cross_view_qa?.pass === true) addCharacterKey(actor);
  });
  const descriptors = list.map((shot, index) => ({
    index,
    scene: continuitySceneKey(shot || {}, contracts[index] || {}),
    characters: continuityCharacterKeys(ctx, shot || {}, contracts[index] || {}),
    hardPrevious: index > 0 && hasHardPreviousContinuity(shot || {}, contracts[index] || {}),
    anchorKeys: {
      scene: continuitySceneKey(shot || {}, contracts[index] || {}),
      characters: continuityCharacterKeys(ctx, shot || {}, contracts[index] || {}),
    },
  }));
  const dependencies = {};
  const reasons = {};
  for (let index = 0; index < descriptors.length; index += 1) {
    const current = descriptors[index];
    if (index === 0) {
      dependencies[index] = null;
      reasons[index] = 'root';
      continue;
    }
    if (current.hardPrevious) {
      dependencies[index] = index - 1;
      reasons[index] = 'temporal_continuity';
      continue;
    }
    let dependency = null;
    let reason = 'independent_with_shared_anchors';
    const metadataUnknown = !current.scene && !current.characters.length;
    const sceneAnchored = !current.scene || verifiedSceneKeys.has(current.scene);
    const personAnchored = !current.characters.length || current.characters.every(key => (
      verifiedCharacterKeys.has(key) || (castMode === 'single' && verifiedPersonAnchor)
    ));
    if (metadataUnknown) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        if (!descriptors[previous].scene && !descriptors[previous].characters.length) {
          dependency = previous;
          reason = 'continuity_metadata_unavailable';
          break;
        }
      }
    }
    if (dependency === null && (!sceneAnchored || !personAnchored)) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const candidate = descriptors[previous];
        const sameUnanchoredScene = !sceneAnchored && !!(current.scene && candidate.scene && current.scene === candidate.scene);
        const sharedUnanchoredCharacter = !personAnchored && current.characters.some(key => candidate.characters.includes(key));
        if (sameUnanchoredScene || sharedUnanchoredCharacter) {
          dependency = previous;
          reason = sameUnanchoredScene ? 'scene_anchor_unavailable' : 'person_anchor_unavailable';
          break;
        }
      }
    }
    dependencies[index] = dependency;
    reasons[index] = dependency === null ? 'independent_with_shared_anchors' : reason;
  }
  return { dependencies, reasons, descriptors, verified_anchors: { scenes: [...verifiedSceneKeys], person: verifiedPersonAnchor, characters: [...verifiedCharacterKeys] } };
}

function sceneAssetForShot(ctx = {}, shot = {}, index = 0) {
  const assets = Array.isArray(ctx.scene_assets) ? ctx.scene_assets : [];
  return selectSceneAsset(assets, shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', index);
}

function sceneAssetPrompt(asset = {}, options = {}) {
  if (!asset || typeof asset !== 'object') return '';
  const views = Array.isArray(asset.view_images) ? asset.view_images : [];
  const assetSurfaceTopology = asset.surface_topology || asset.surfaceTopology;
  const rawSurfaceContract = options.includeSurfaceContract !== false && assetSurfaceTopology
    ? shotDesign.surfacePrompt(assetSurfaceTopology, 'auto')
    : '';
  const surfaceContract = rawSurfaceContract
    ? rawSurfaceContract.split('\n').map(line => `Master environment only — ${line}`).join('\n')
    : '';
  const fullSpaceLock = completeSpaceLock(asset);
  const spatialQa = asset.scene_contract?.spatial_coverage_qa || asset.spatial_coverage_qa || {};
  const layoutReference = layoutSceneReference(asset);
  return [
    `Locked scene asset: ${cleanText(asset.name || asset.scene_id || asset.id || 'task scene', 120)}`,
    asset.lock_strength ? `Scene lock strength: ${cleanText(asset.lock_strength, 60)}` : '',
    asset.material_summary ? `Scene material lock: ${cleanText(asset.material_summary, 600)}` : '',
    asset.layout_summary ? `Scene layout lock: ${cleanText(asset.layout_summary, 600)}` : '',
    asset.style_summary ? `Scene style lock: ${cleanText(asset.style_summary, 360)}` : '',
    views.length ? `Scene reference images attached by role: ${cleanText(views.map(view => view.key || view.label || 'view').join(', '), 160)}` : '',
    `Spatial lock state: ${fullSpaceLock ? 'complete and verified' : 'incomplete; do not invent unseen space'}`,
    layoutReference?.url ? 'An auxiliary whole-space layout reference is attached when reference capacity permits. Use it for topology and zone relationships, never as the commercial camera composition.' : '',
    fullSpaceLock ? `Spatial coverage scores: layout ${Number(spatialQa.layout_topology_score || 0).toFixed(2)}, camera diversity ${Number(spatialQa.camera_diversity_score || 0).toFixed(2)}, reverse coverage ${Number(spatialQa.reverse_coverage_score || 0).toFixed(2)}, interaction zone ${Number(spatialQa.interaction_zone_score || 0).toFixed(2)}.` : '',
    asset.negative ? `Scene asset negative reference: ${cleanText(asset.negative, 360)}. In final keyframes, keep these as space-quality constraints only; do not apply "empty scene/no people" when the storyboard requires the locked actor.` : '',
    surfaceContract ? `Scene asset surface construction contract:\n${surfaceContract}` : '',
    'Keep the same scene identity, layout logic, material family, lighting direction and commercial realism across shots. Do not switch to another unrelated space.',
  ].filter(Boolean).join('\n');
}

function buildKeyframePrompt(ctx = {}, shot = {}, contract = {}, index = 0, options = {}) {
  const productionGraphShot = (ctx.production_graph?.shots || []).find(item => Number(item.index || 0) === index + 1)
    || (ctx.production_graph?.shots || [])[index] || contract.production_graph_lock || null;
  const visualContract = contract.visual_contract || {};
  const sceneLock = contract.scene_lock || null;
  const continuityLock = contract.continuity_lock || shot.continuity || {};
  const temporalEvidenceLock = contract.temporal_evidence_lock || shot.temporal_evidence || null;
  const transitionType = cleanText(continuityLock.transition_type || 'hard_cut', 40).toLowerCase();
  const inheritsPreviousState = continuityLock.requires_previous_frame === true || ['cut_on_action', 'match_cut'].includes(transitionType);
  const continuityText = [
    inheritsPreviousState && continuityLock.continuity_from ? `Continuity from: ${cleanText(continuityLock.continuity_from, 100)}` : '',
    inheritsPreviousState && continuityLock.entry_frame_state ? `Entry frame state: ${cleanText(continuityLock.entry_frame_state, 260)}` : '',
    continuityLock.exit_frame_state ? `Exit frame state: ${cleanText(continuityLock.exit_frame_state, 260)}` : '',
    inheritsPreviousState && (continuityLock.action_start || continuityLock.action_end) ? `Action start/end: ${cleanText(continuityLock.action_start, 180)} -> ${cleanText(continuityLock.action_end, 180)}` : '',
    continuityLock.screen_direction ? `Screen direction: ${cleanText(continuityLock.screen_direction, 80)}` : '',
    continuityLock.eyeline ? `Eyeline: ${cleanText(continuityLock.eyeline, 100)}` : '',
    continuityLock.camera_axis ? `Camera axis: ${cleanText(continuityLock.camera_axis, 100)}` : '',
    continuityLock.camera_movement ? `Camera movement: ${cleanText(continuityLock.camera_movement, 140)}` : '',
    continuityLock.object_states ? `Object state lock: ${cleanText(continuityLock.object_states, 260)}` : '',
    (continuityLock.transition_type || continuityLock.transition_reason)
      ? `Transition: ${cleanText(continuityLock.transition_type || 'hard_cut', 40)}; ${cleanText(continuityLock.transition_reason, 180)}`
      : '',
    continuityLock.transition_match_anchor ? `Transition match anchor that must be visibly prepared in this keyframe: ${cleanText(continuityLock.transition_match_anchor, 180)}` : '',
    continuityLock.boundary_mode ? `Boundary mode: ${cleanText(continuityLock.boundary_mode, 60)}` : '',
    continuityLock.requires_previous_frame === true ? 'Requires previous frame: yes' : '',
  ].filter(Boolean).join('\n');
  const personAsset = ctx.person_asset || {}; const personSpec = ctx.person_spec || {};
  const actorViews = Array.isArray(personAsset.view_images) ? personAsset.view_images : []; const userVisualOverride = shot.user_visual_override === true || shot._nsa_user_edited_fields?.visual === true;
  const previousFrame = options.previousFrame || null;
  const sceneAsset = options.sceneAsset || sceneAssetForShot(ctx, shot, index);
  const contractDesign = visualContract.shot_design;
  const design = contractDesign?.surface_resolution
    ? contractDesign
    : shotDesign.compileBoundShotDesign(shot, sceneLock, sceneAsset);
  const resolveNarrative = (value, max) => cleanText(
    shotDesign.resolveSurfaceNarrative(value, design.surface_resolution),
    max,
  );
  const campaignBriefText = resolveNarrative(ctx.brief, 900);
  const advertisedSubjectText = resolveNarrative(ctx.product_subject, 160);
  const visualText = resolveNarrative(shot.visual || shot.content_prompt || '', 900);
  const actionText = resolveNarrative(shot.action || shot.visual_action || '', 500);
  const dialogueText = resolveNarrative(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || '', 300);
  const compositionText = resolveNarrative(visualContract.composition, 300);
  const subjectText = resolveNarrative(visualContract.subject, 300);
  const evidenceText = resolveNarrative(visualContract.evidence, 300);
  const styleText = resolveNarrative(visualContract.style, 260);
  const surfaceDesignText = shotDesign.surfacePrompt(design.surface_topology, design.shot_scope);
  const surfaceConflictText = shotDesign.surfaceConflictPrompt(design.surface_resolution);
  const keyframeEffectText = shotDesign.keyframeExecutionPrompt(design);
  const interactionRequested = /指向|伸手|食指|点击|点按|触摸|滑动|操作|按下|拿起|握住|放置|递给|注视|凝视|point|tap|touch|swipe|operate|press|pick up|hold|place|hand over|look at|gaze/i
    .test([visualText, actionText].filter(Boolean).join(' '));
  const interactionGroundingText = interactionRequested
    ? 'Visible interaction grounding is mandatory: every pointing, touching, operating, holding or gaze action must connect to a clearly visible, physically reachable target from this shot, such as the specified product, prop, control, screen, table or interface. Align fingertip, hand and eyeline with the same target. Never point, tap or gesture into empty air. If the requested target cannot be shown coherently, use a natural grounded pose with hands resting on or holding a visible task object.'
    : '';
  const includeSceneSurfaceContract = !design.surface_topology || design.shot_scope === 'product_comparison';
  const sceneReferenceText = sceneAssetPrompt(sceneAsset, { includeSurfaceContract: includeSceneSurfaceContract });
  const sceneBindingText = sceneLock ? [
    `Shot scene binding: ${cleanText(sceneLock.scene_id || '', 120)} / ${cleanText(sceneLock.scene_name || '', 120)}`,
    sceneLock.scene_view ? `Required scene view: ${cleanText(sceneLock.scene_view, 40)}` : '',
    Array.isArray(sceneLock.anchor_ids) && sceneLock.anchor_ids.length ? `Required visible scene anchors: ${cleanText(sceneLock.anchor_ids.join(', '), 500)}` : '',
    sceneLock.scene_zone_id ? `Required scene zone ID (stable binding, do not reinterpret): ${cleanText(sceneLock.scene_zone_id, 100)}` : '',
    Array.isArray(sceneLock.zone_ids) && sceneLock.zone_ids.length ? `Required scene zone IDs: ${cleanText(sceneLock.zone_ids.join(', '), 400)}` : '',
    (sceneLock.scene_zone_label_zh || sceneLock.scene_zone) ? `Required scene zone description: ${cleanText(sceneLock.scene_zone_label_zh || sceneLock.scene_zone, 160)}` : '',
    sceneLock.transition_from ? `Transition from: ${cleanText(sceneLock.transition_from, 120)}` : '',
    sceneLock.transition_reason ? `Transition reason: ${cleanText(sceneLock.transition_reason, 240)}` : '',
    'The keyframe must be generated inside this bound task scene. Do not move the shot into another location or another industry setting.',
  ].filter(Boolean).join('\n') : '';
  const personPresence = personIdentity.shotPersonPresence(shot, contract);
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
  const productPromptContract = productIdentity.keyframePromptContract(ctx, shot, contract);
  const shotNeedsProduct = productPromptContract.proof_required;
  const personContract = ctx.person_contract || personAsset.person_contract || {};
  const productContract = ctx.product_contract || {};
  const subjectBoardReferenceText = subjectReferences.subjectBoardUrl(ctx)
    ? 'Actor/pet multi-subject reference board: treat the attached board only as an identity atlas. Render exactly the people and pets required by this shot; never copy the grid or studio background, and never add a subject merely because it appears on the board.'
    : '';
  const actorReferenceText = [
    (personSpec.wardrobeText || personContract.wardrobe?.description) ? `Actor wardrobe lock: ${cleanText(personSpec.wardrobeText || personContract.wardrobe?.description, 520)}` : '',
    (personSpec.appearanceText || personContract.identity?.face_description) ? `Actor identity and appearance lock: ${cleanText(personSpec.appearanceText || personContract.identity?.face_description, 420)}` : '',
    (personSpec.hairMakeupText || personContract.appearance?.hair_style) ? `Actor hair and makeup lock: ${cleanText(personSpec.hairMakeupText || personContract.appearance?.hair_style, 320)}` : '',
    personAsset.name ? `Actor name: ${cleanText(personSpec.displayName || personAsset.name, 120)}` : '',
    !personSpec.wardrobeText && personAsset.description ? `Actor appearance and wardrobe lock: ${cleanText(personAsset.description, 520)}` : '',
    actorViews.length ? `Actor reference images attached by role: ${cleanText(actorViews.map(v => v.key || v.label || 'view').join(', '), 160)}` : '',
  ].filter(Boolean).join('\n');
  const productReferenceText = productPromptContract.reference_text;
  const productProofText = productPromptContract.proof_text;
  const visualMedium = worldSetting.primaryVisualMedium(ctx.world_setting);
  const liveActionMedium = visualMedium === 'live_action';
  const parts = [
    `镜头制作设计（剧情字段真实生成输入）：\n${productionPromptCompiler.compileKeyframeDirection(shot, { sceneName: sceneLock?.scene_name, productionGraphShot })}`,
    worldSetting.visualMediumPrompt(visualMedium, 'storyboard keyframe'),
    liveActionMedium ? `Scene photorealism lock: ${visualRealismPolicy.compactSceneRealismPrompt()}` : '',
    liveActionMedium && shotNeedsPerson ? `Actor photorealism lock: ${visualRealismPolicy.compactPersonRealismPrompt()}` : '',
    liveActionMedium && shotNeedsPerson ? `Actor compliance lock: ${visualRealismPolicy.compactImage2CompliancePrompt()}` : '',
    `Campaign brief: ${campaignBriefText}`,
    `Advertised subject: ${advertisedSubjectText}`,
    `Shot ${index + 1}: ${cleanText(shot.title || '', 120)}`,
    userVisualOverride ? `User-edited visual override, highest priority: ${visualText}` : '',
    userVisualOverride ? 'User override mode: rebuild the keyframe from the edited visual and current style controls. Keep the current shot action when it is physically compatible with the edited visual; minimally adapt only to make the action plausible and visibly grounded.' : '',
    `Visual: ${visualText}`,
    userVisualOverride
      ? `Current shot action: ${actionText || 'use a natural, physically grounded pose that supports the edited visual'}`
      : `Action: ${actionText}`,
    interactionGroundingText,
    surfaceDesignText,
    surfaceConflictText,
    keyframeEffectText,
    `Dialogue or copy: ${dialogueText}`,
    !userVisualOverride && compositionText ? `Composition: ${compositionText}` : '',
    !userVisualOverride && subjectText ? `Subject lock: ${subjectText}` : '',
    !userVisualOverride && evidenceText ? `Commercial evidence: ${evidenceText}` : '',
    styleText ? `Style: ${styleText}` : '',
    visualContract.scene_direction && visualContract.scene_direction !== 'auto' ? `Scene direction: ${cleanText(visualContract.scene_direction, 80)}` : '',
    visualContract.custom_scene_requirement ? `Custom scene requirement: ${cleanText(visualContract.custom_scene_requirement, 240)}` : '',
    !userVisualOverride && shotNeedsProduct ? `Product visibility: required, presence ${cleanText(visualContract.product_presence || 'medium', 40)}, lock ${cleanText(visualContract.product_lock_strength || 'standard', 40)}.` : '',
    !userVisualOverride && productProofText ? `Advertised-subject visible proof requirements: ${cleanText(productProofText, 1200)}. The frame must visibly demonstrate the applicable proof; do not substitute unrelated symbols or generic decoration.` : '',
    !userVisualOverride && shotNeedsProduct && Array.isArray(visualContract.product_methods) && visualContract.product_methods.length ? `Product presentation methods: ${cleanText(visualContract.product_methods.join(', '), 240)}` : '',
    productReferenceText,
    visualContract.style_direction ? `Visual style direction: ${cleanText(visualContract.style_direction, 360)}` : '',
    visualContract.negative_requirements ? `Negative visual requirements: ${cleanText(visualContract.negative_requirements, 360)}` : '',
    Array.isArray(shot.characters) && shot.characters.length ? `Characters: ${cleanText(JSON.stringify(shot.characters), 500)}` : '',
    continuityText ? `Strict shot continuity lock:\n${continuityText}` : '',
    temporalEvidenceLock ? `剧情广告 V2.0 时序证据合同：\n${cleanText(JSON.stringify(temporalEvidenceLock), 2600)}\n只允许 intended_changes 中声明的变化；invariants 必须保持；最终画面必须能直接看见 evidence_requirements 指定的证据。` : '',
    sceneBindingText ? `Storyboard scene binding lock:\n${sceneBindingText}` : '',
    sceneReferenceText ? `Strict scene consistency lock:\n${sceneReferenceText}` : '',
    shotNeedsPerson && ctx.person_asset ? `Locked real actor/person asset: ${cleanText(personAsset.id || personAsset.actor_asset_id || personAsset.name || 'verified actor', 160)}; person revision ${Number(ctx.person_contract?.person_revision || personAsset.person_revision || 1) || 1}.` : '',
    shotNeedsPerson ? `Person QA required for this shot (${personPresence.mode}). Any visible face, body, hand, sleeve, reflection or silhouette must be verified against the locked actor reference.` : '',
    personForbidden ? 'Explicit no-human lock: no human face, body, hand, finger, arm, worn sleeve, reflection or silhouette may appear anywhere in this keyframe.' : '',
    shotNeedsPerson && actorReferenceText ? 'If the shot includes any body part, hand, sleeve, reflection or partial figure, it must belong to the same locked actor identity and the same wardrobe family from the actor reference. Do not invent a different sleeve, hand, age, body shape, hair, skin tone, outfit color or fashion style.' : '',
    shotNeedsPerson && actorReferenceText ? `Strict actor consistency lock:\n${actorReferenceText}` : '',
    shotNeedsPerson && actorReferenceText ? 'A hand-only or partial-person frame is allowed only when this storyboard explicitly requires that visible body part and it remains bound to the locked actor. A no-person shot forbids hands and sleeves too.' : '',
    shotNeedsPerson && Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length ? `Locked cast profiles: ${cleanText(JSON.stringify(ctx.cast_profiles), 1200)}` : '',
    subjectBoardReferenceText,
    propTimeline.keyframePrompt(ctx.prop_assets || [], shot),
    shotNeedsPerson && ctx.person_context?.real_person_locked ? 'Use the uploaded/authorized real-person reference as the identity and appearance lock. Preserve face identity, age impression, body proportions, wardrobe family and natural real-camera skin texture.' : '',
    petIdentity.keyframePrompt(ctx, shot),
    Array.isArray(ctx.forbidden) && ctx.forbidden.length ? `Forbidden: ${cleanText(ctx.forbidden.join('; '), 400)}` : '',
    userVisualOverride ? 'The edited visual is the only source of truth for object layout, surface type, carrier, material form and composition.' : '',
    previousFrame ? `Continuity reference from previous accepted keyframe: shot ${previousFrame.index}, title ${cleanText(previousFrame.title, 120)}, image ${previousFrame.image_url}. Match its lighting mood, material realism, framing discipline and commercial tone only where compatible with the edited visual.` : '',
    !userVisualOverride && previousFrame?.prompt ? `Previous keyframe prompt summary for continuity only: ${resolveNarrative(previousFrame.prompt, 500)}` : '',
    userVisualOverride ? `Final priority: generate only this edited visual: ${visualText}. Any composition, object layout, carrier and material form must come from this edited visual, not from cached or generated fields.` : '',
    // 通用语义忠实约束：防止模型把抽象业务词擅自转成无关行业画面。
    'Semantic fidelity rule: visualize the current task brief, advertised subject, locked scene asset and current shot action literally. Do not replace an abstract business concept with unrelated industry symbols, charts, trading screens, stock-market dashboards, generic finance UI, random data walls or abstract technology panels unless the user brief or the edited shot explicitly asks for that visual category.',
    'If the task mentions software, data, platform, token, efficiency, service or any other abstract concept, ground it in the user-described product/service usage, real objects, people, workflow, interface, environment or scene asset from this task. Never infer a different industry, business case, venue, carrier form or visual metaphor on your own.',
    worldSetting.visualMediumPrompt(visualMedium, 'final rendered frame; no poster text or watermark'), knowledgePolicyRuntime.promptBlock(contract.knowledge_policy_generation || {}),
  ];
  const prompt = compactKeyframePrompt(parts);
  return keyframePromptInvariants.assertPrompt(prompt, {
    design,
    sceneRequired: !!sceneLock,
    personRequired: shotNeedsPerson,
    personForbidden,
    actorLocked: !!ctx.person_asset,
    productRequired: shotNeedsProduct,
    productLocked: productPromptContract.identity_locked,
    userVisualOverride,
  });
}

function keyframeSubmissionPreflight(taskId, options = {}, actor = {}) {
  productionGraph.assertExecutable(taskId);
  const shots = storage.getOutput(taskId, 'storyboard_table');
  const existing = storage.getOutput(taskId, 'keyframes');
  const shotList = Array.isArray(shots) ? shots : [];
  const keyframes = Array.isArray(existing) ? existing : [];
  const targetIndexes = keyframeTargetIndexes(shotList, keyframes, options);
  return keyframeSubmissions.preflight(taskId, targetIndexes, {
    frames: keyframes,
    acknowledgeBillingUnknown: options.acknowledge_billing_unknown === true
      || options.acknowledgeBillingUnknown === true,
    acknowledgedBy: actor.id || actor.user_id || actor.userId || '',
  });
}

function previewShotPrompts(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  let ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [], production_graph: storage.getOutput(taskId, 'production_graph_v1') || null, knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId) };
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const storedStoryboard = storage.getOutput(taskId, 'storyboard_table');
  const stored = Array.isArray(storedStoryboard) && storedStoryboard.length ? storedStoryboard : (blueprint.beats || []);
  if (!Array.isArray(stored) || !stored.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  const rawIndex = Number(options.shot_index ?? options.shotIndex ?? 0);
  const index = Math.max(0, Math.min(stored.length - 1, Number.isFinite(rawIndex) ? rawIndex : 0));
  const draft = options.shot && typeof options.shot === 'object' ? options.shot : {};
  const merged = normalizeStoryboardShot({ ...stored[index], ...draft }, index, stored[index - 1] || {});
  const shots = stored.map((shot, shotIndex) => shotIndex === index ? merged : shot);
  let boundShots = bindShotsToScenes(shots, ctx.scene_assets);
  const previewCompiled = temporalEvidenceLifecycle.compileForTask({ storage, taskId, ctx, blueprint, shots: boundShots, persist: false });
  boundShots = previewCompiled.shots; ctx = { ...ctx, temporal_evidence_graph: previewCompiled.graph };
  const contracts = buildKeyframeContracts(ctx, boundShots);
  const shot = boundShots[index];
  const contract = contracts[index] || {};
  const previousShot = index > 0 ? boundShots[index - 1] : null;
  return {
    shot_index: index + 1,
    shot_design: contract.visual_contract?.shot_design || shotDesign.normalizeShotDesign(shot),
    keyframe_prompt: buildKeyframePrompt(ctx, shot, contract, index, {
      sceneAsset: sceneAssetForShot(ctx, shot, index),
      previousFrame: acceptedKeyframeContextAt(storage.getOutput(taskId, 'keyframes') || [], index - 1),
    }),
    motion_prompt: videoAdapter.clipPrompt(shot, ctx, contract, previousShot),
    media_generated: false,
  };
}

function keyframeUrlFromResult(result = {}) {
  if (result.image_url || result.imageUrl || result.url) return result.image_url || result.imageUrl || result.url;
  const filename = result.filename || (result.filePath ? require('path').basename(result.filePath) : '');
  return filename ? mediaAdapter.publicAssetUrl(filename) : '';
}

async function generateKeyframesStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [], production_graph: storage.getOutput(taskId, 'production_graph_v1') || null, knowledge_policy_snapshot: knowledgePolicyRuntime.pinTaskPolicy(storage, taskId) };
  assertVerifiedSceneAssets(ctx.scene_assets);
  personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  const boundShots = bindShotsToScenes(shots, ctx.scene_assets);
  if (JSON.stringify(boundShots) !== JSON.stringify(shots)) {
    shots = boundShots;
    storage.saveOutput(taskId, 'storyboard_table', shots);
  }
  const contractRefresh = keyframeContractFreshness.refresh(taskId, { ctx, shots });
  const contracts = contractRefresh.contracts;
  const existing = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const targetIndexes = keyframeTargetIndexes(shots, existing, options);
  keyframeSubmissions.preflight(taskId, targetIndexes, {
    frames: existing,
    acknowledgeBillingUnknown: options.acknowledge_billing_unknown === true
      || options.acknowledgeBillingUnknown === true,
  });
  const keyframes = existing.slice();
  const dependencyPlan = buildKeyframeDependencyPlan(shots, contracts, ctx);
  const targetIndexSet = new Set(targetIndexes);
  const completedBatchIndexes = new Set();
  const attempts = [];
  const retainedRegenerationFailures = [];
  const beforeStatus = keyframeCompletion(keyframes, shots);
  if (!targetIndexes.length) {
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: beforeStatus.fresh_pass >= beforeStatus.total ? 'done' : 'partial',
      output_summary: `${beforeStatus.fresh_pass}/${beforeStatus.total} current keyframes verified`,
      diagnostics: { attempts, keyframe_status: beforeStatus, skipped: true },
    });
    if (beforeStatus.fresh_pass >= beforeStatus.total) {
      storage.updateTask(taskId, { status: 'done', stage: 'keyframes_ready', error: '' });
    } else {
      storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '' });
    }
    return { keyframes, keyframe_contracts: contracts, attempts, keyframe_status: beforeStatus, skipped: true };
  }
  targetIndexes.forEach(index => {
    if (!keyframes[index]) return;
    keyframes[index] = {
      ...keyframes[index],
      current_generation_status: 'pending',
      current_generation_id: cleanText(options.generation_id || options.generationId || '', 80),
      latest_attempt: {
        generation_id: cleanText(options.generation_id || options.generationId || '', 80),
        status: 'pending',
        started_at: new Date().toISOString(),
      },
    };
  });
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.updateTask(taskId, { status: 'running', stage: 'keyframes' });
  storage.saveStage(taskId, 'keyframes', { status: 'running', input_summary: `${targetIndexes.length} image keyframes` });
  const progressStartedAt = new Date().toISOString();
  const configuredConcurrency = keyframeParallel.resolveConcurrency(options, targetIndexes.length);
  const pendingProgressIndexes = new Set(targetIndexes);
  const activeProgressIndexes = new Set();
  const generationProgress = {
    stage: 'keyframes', status: 'running', target_total: targetIndexes.length,
    generation_id: cleanText(options.generation_id || options.generationId || '', 80),
    processed: 0, succeeded: 0, failed: 0,
    current_index: (targetIndexes[0] ?? 0) + 1,
    target_indexes: targetIndexes.map(index => index + 1),
    configured_concurrency: configuredConcurrency,
    effective_concurrency: configuredConcurrency,
    peak_concurrency: 0,
    dependency_reasons: Object.fromEntries(targetIndexes.map(index => [String(index + 1), dependencyPlan.reasons[index] || 'unknown'])),
    active_indexes: [],
    queued_indexes: targetIndexes.map(index => index + 1),
    started_at: progressStartedAt, updated_at: progressStartedAt,
  };
  function refreshParallelProgress(fallbackIndex = targetIndexes[0] ?? 0) {
    generationProgress.active_indexes = [...activeProgressIndexes].sort((a, b) => a - b).map(index => index + 1);
    generationProgress.queued_indexes = [...pendingProgressIndexes].sort((a, b) => a - b).map(index => index + 1);
    const next = [...activeProgressIndexes, ...pendingProgressIndexes].sort((a, b) => a - b)[0];
    generationProgress.current_index = (next === undefined ? fallbackIndex : next) + 1;
    generationProgress.updated_at = new Date().toISOString();
  }
  storage.updateTask(taskId, { generation_progress: generationProgress });
  async function generateKeyframeAtIndex(i, scheduleMeta = {}) {
    const workerStartedMs = Date.now();
    pendingProgressIndexes.delete(i);
    activeProgressIndexes.add(i);
    generationProgress.peak_concurrency = Math.max(generationProgress.peak_concurrency || 0, activeProgressIndexes.size);
    generationProgress.effective_concurrency = Math.max(1, Number(scheduleMeta.concurrency) || 1);
    generationProgress.wave_number = Math.max(1, Number(scheduleMeta.wave_number) || 1);
    generationProgress.wave_kind = scheduleMeta.kind || 'sequential';
    keyframes[i] = {
      ...(keyframes[i] || {}),
      current_generation_status: 'generating',
      current_generation_id: generationProgress.generation_id,
      latest_attempt: {
        ...((keyframes[i] || {}).latest_attempt || {}),
        generation_id: generationProgress.generation_id,
        status: 'generating',
        started_at: (keyframes[i] || {}).latest_attempt?.started_at || new Date().toISOString(),
      },
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    refreshParallelProgress(i);
    storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
    const shot = shots[i] || {};
    const previousAcceptedFrame = hasUsablePreviousKeyframe(existing[i]) ? { ...existing[i] } : null;
    let currentAttemptFailed = false;
    let currentError = null;
    let retryRequired = false;
    const referenceKeyframes = Array.isArray(scheduleMeta.snapshot) ? scheduleMeta.snapshot : keyframes;
    const dependencyIndex = Number.isInteger(scheduleMeta.dependency_index) ? scheduleMeta.dependency_index : -1;
    const previousFrame = acceptedKeyframeContextAt(referenceKeyframes, dependencyIndex);
    const sceneAsset = sceneAssetForShot(ctx, shot, i);
    const basePrompt = buildKeyframePrompt(ctx, shot, contracts[i] || {}, i, { previousFrame, sceneAsset });
    const filename = `scene_new_story_ad_${taskId}_${String(i + 1).padStart(2, '0')}_${Date.now()}`;
    const shotCandidates = [];
    try {
      const sceneReference = selectedSceneReference(sceneAsset, contracts[i] || {}, shot);
      const referenceImages = keyframeReferenceImages(taskId, i, ctx, sceneReference, previousFrame, shot, contracts[i] || {}, sceneAsset);
      const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contracts[i] || {});
      const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
      const productRequired = productIdentity.shotProductProofRequired(ctx, shot, contracts[i] || {});
      const requireVisualQa = !!sceneReference || shotNeedsPerson || personForbidden || productRequired;
      const maxQaRetries = keyframeTarget.qaRetryLimit(options, requireVisualQa);
      let accepted = null;
      let qa = null;
      let feedback = '';
      for (let qaAttempt = 0; qaAttempt <= maxQaRetries; qaAttempt += 1) {
        const correction = feedback
          ? `Previous visual QA rejected the frame. Correct only the structured consistency conflicts below. Keep the current shot contract, scene contract, person contract and product contract unchanged. Do not introduce any new person, object, place, industry detail or visual symbol that is absent from those contracts.\n${cleanText(feedback, 520)}`
          : '';
        const prompt = correction
          ? compactKeyframePrompt([...basePrompt.split('\n'), correction])
          : basePrompt;
        keyframeContractFreshness.assertCurrent(taskId, i, contracts[i] || {});
        keyframeContractFreshness.recordProviderAudit(taskId, {
          generationId: generationProgress.generation_id,
          index: i,
          contract: contracts[i] || {},
          prompt,
        });
        const imageStartedMs = Date.now();
        const recoveredSubmission = qaAttempt === 0 ? keyframeSubmissions.takeRecoverable(taskId, i) : null;
        let submission = recoveredSubmission;
        let result;
        try {
          if (recoveredSubmission) {
            const recoveredUrl = recoveredSubmission.completed_urls.find(Boolean);
            result = await mediaAdapter.persistImageResult({
              result: {
                image_url: recoveredUrl,
                url: recoveredUrl,
                provider_used: [recoveredSubmission.provider_id, recoveredSubmission.model_id].filter(Boolean).join('/'),
                provider_request_id: recoveredSubmission.provider_request_id || '',
                provider_task_id: recoveredSubmission.provider_task_id || '',
                recovered_provider_result: true,
              },
              filename: filename + '_a' + (qaAttempt + 1),
              thumbnailWidths: [520, 640],
            });
          } else {
            submission = keyframeSubmissions.begin(taskId, {
              shotIndex: i,
              generationId: generationProgress.generation_id,
              qaAttempt: qaAttempt + 1,
              prompt,
              contractFingerprint: contracts[i]?.contract_fingerprint || '',
            });
            result = await mediaAdapter.generateImage({
              taskId,
              prompt,
              filename: filename + '_a' + (qaAttempt + 1),
              stage: 'new_story_ad.keyframe',
              aspectRatio: ctx.output_ratio || '9:16',
              resolution: options.resolution || '2K',
              imageModel: options.image_model || options.imageModel || 'auto',
              referenceImages,
              requireReferences: referenceImages.length > 0,
              inputFidelity: 'high',
              singleAttempt: keyframeTarget.missingImagesOnly(options),
              clientRequestId: submission.id,
              shotIndex: i,
              generationId: generationProgress.generation_id,
              onSubmitting: event => keyframeSubmissions.markSubmitting(taskId, submission.id, event),
              onSubmitted: event => keyframeSubmissions.markSubmitted(taskId, submission.id, event),
              onProgress: event => keyframeSubmissions.markProgress(taskId, submission.id, event),
              timeoutMs: Math.max(30000, Math.min(10 * 60 * 1000, Number(options.image_timeout_ms ?? options.imageTimeoutMs) || (8 * 60 * 1000))),
            });
          }
          keyframeSubmissions.markSuccess(taskId, submission.id, result);
        } catch (error) {
          if (submission) {
            if (recoveredSubmission) keyframeSubmissions.restoreRecoverable(taskId, submission.id, error);
            else keyframeSubmissions.markFailure(taskId, submission.id, error);
          }
          throw error;
        }
        keyframeContractFreshness.assertCurrent(taskId, i, contracts[i] || {});
        const imageLatencyMs = Date.now() - imageStartedMs;
        const imageUrl = keyframeUrlFromResult(result);
        if (!imageUrl) throw new Error('图片供应商没有返回可用图片地址。');
        // Use the provider URL for immediate remote QA when available, while
        // keeping the persisted VIDO URL as the production/display asset.
        const qaImageUrl = result.source_url || mediaAdapter.absolutePublicImageUrl(imageUrl);
        const qaStartedMs = Date.now();
        let sceneQa;
        let personQa;
        let productQa;
        try {
          const reviewed = await runKeyframeQaReviews({
            taskId,
            ctx,
            shot,
            contract: contracts[i] || {},
            sceneAsset,
            generatedUrl: qaImageUrl,
          });
          sceneQa = reviewed.sceneQa;
          personQa = reviewed.personQa;
          productQa = reviewed.productQa;
        } catch (error) {
          error.keyframe_candidate_generated = true;
          shotCandidates.push({
            id: `shot_${i + 1}_candidate_${qaAttempt + 1}_${Date.now()}`,
            image_url: imageUrl,
            provider_used: result.provider_used || '',
            qa: { pass: false, status: 'unavailable', error: String(error.message || error) },
            status: 'qa_unavailable',
            qa_policy_version: 2,
            contract_fingerprint: contracts[i]?.contract_fingerprint || '',
            contract_compiler_signature: contracts[i]?.contract_compiler_signature || '', knowledge_policy: contracts[i]?.knowledge_policy_trace || null,
            generation_id: generationProgress.generation_id,
            image_latency_ms: imageLatencyMs,
            qa_latency_ms: Date.now() - qaStartedMs,
            total_latency_ms: Date.now() - imageStartedMs,
            created_at: new Date().toISOString(),
          });
          attempts.push({
            index: i,
            qa_attempt: qaAttempt + 1,
            ok: false,
            provider_id: result.provider_used || '',
            image_url: imageUrl,
            image_latency_ms: imageLatencyMs,
            qa_latency_ms: Date.now() - qaStartedMs,
            total_latency_ms: Date.now() - imageStartedMs,
            error: String(error.message || error),
            error_code: error.code || 'VISION_QA_UNAVAILABLE',
            candidate_reused_for_qa_retry: true,
          });
          throw error;
        }
        const qaLatencyMs = Date.now() - qaStartedMs;
        qa = combineKeyframeQa({
          ctx,
          shot,
          contract: contracts[i] || {},
          sceneReference,
          sceneQa,
          personQa,
          productQa,
        });
        shotCandidates.push({
          id: `shot_${i + 1}_candidate_${qaAttempt + 1}_${Date.now()}`,
          image_url: imageUrl,
          provider_used: result.provider_used || '',
          qa,
          status: qa.pass ? 'accepted' : 'rejected',
          qa_policy_version: 2,
          contract_fingerprint: contracts[i]?.contract_fingerprint || '',
          contract_compiler_signature: contracts[i]?.contract_compiler_signature || '', knowledge_policy: contracts[i]?.knowledge_policy_trace || null,
          generation_id: generationProgress.generation_id,
          image_latency_ms: imageLatencyMs,
          qa_latency_ms: qaLatencyMs,
          total_latency_ms: Date.now() - imageStartedMs,
          created_at: new Date().toISOString(),
        });
        attempts.push({
          index: i,
          qa_attempt: qaAttempt + 1,
          ok: qa.pass === true,
          provider_id: result.provider_used || '',
          image_url: imageUrl,
          image_latency_ms: imageLatencyMs,
          qa_latency_ms: qaLatencyMs,
          total_latency_ms: Date.now() - imageStartedMs,
          qa,
        });
        if (qa.pass) {
          accepted = { result, imageUrl, prompt };
          break;
        }
        feedback = structuredQaFeedback(sceneQa, personQa, productQa);
      }
      if (!accepted) {
        const error = new Error('第 ' + (i + 1) + ' 镜视觉一致性 QA 未通过：' + (feedback || '画面与当前镜头合同不一致'));
        error.code = 'SCENE_CONSISTENCY_QA_FAILED';
        error.retryable = true;
        throw error;
      }
      const { result, imageUrl, prompt } = accepted;
      keyframeContractFreshness.assertCurrent(taskId, i, contracts[i] || {});
      keyframes[i] = {
        ...(keyframes[i] || {}),
        shot_index: i,
        index: i + 1,
        title: shot.title || `Shot ${i + 1}`,
        image_url: imageUrl,
        imageUrl,
        provider_used: result.provider_used || '',
        reference_mode: sceneReference ? 'strict_scene_reference' : 'new_story_ad_generated_keyframe',
        scene_reference_url: sceneReference || '',
        reference_count: referenceImages.length,
        reference_preserving: result.reference_preserving === true,
        prompt,
        qa,
        candidates: shotCandidates,
        selected_candidate_id: shotCandidates.find(candidate => candidate.image_url === imageUrl)?.id || '',
        contract: contracts[i] || null,
        error: '',
        error_code: '',
        regeneration_error: '',
        regeneration_error_code: '',
        regeneration_failed_at: '',
        current_generation_status: 'accepted',
        current_generation_id: generationProgress.generation_id,
        qa_policy_version: 2,
        contract_fingerprint: contracts[i]?.contract_fingerprint || '',
        contract_compiler_signature: contracts[i]?.contract_compiler_signature || '', knowledge_policy: contracts[i]?.knowledge_policy_trace || null,
        contract_outdated: false,
        contract_outdated_reason: '',
        accepted_revision: {
          generation_id: generationProgress.generation_id,
          accepted_at: new Date().toISOString(),
          qa_policy_version: 2,
        },
        latest_attempt: keyframeFailure.attempt({ generationId: generationProgress.generation_id, status: 'accepted', candidates: shotCandidates }),
      };
    } catch (err) {
      if (err?.code === 'STAGE_DEADLINE_EXCEEDED' || err?.code === 'USER_CANCELLED') {
        activeProgressIndexes.delete(i);
        refreshParallelProgress(i);
        storage.saveOutput(taskId, 'keyframes', keyframes);
        generationProgress.status = err.code === 'USER_CANCELLED' ? 'cancelled' : 'partial';
        storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
        throw err;
      }
      currentAttemptFailed = true;
      currentError = err;
      retryRequired = keyframeParallel.isThrottleError(err) && err.keyframe_candidate_generated !== true && scheduleMeta.throttle_retry !== true;
      // A QA outage is possible only after a candidate image exists. This
      // phase boundary prevents raw/unknown image-provider 5xx text from being
      // misclassified as a QA-only failure before the first state checkpoint.
      const qaUnavailable = err.keyframe_candidate_generated === true && isQaInfrastructureError(err);
      attempts.push({ index: i, ok: false, code: err.code || 'KEYFRAME_FAILED', error: String(err.message || err) });
      if (previousAcceptedFrame) {
        if (!retryRequired) {
          retainedRegenerationFailures.push({
            index: i,
            error: String(err.message || err),
            code: qaUnavailable ? 'VISION_QA_UNAVAILABLE' : (err.code || 'KEYFRAME_FAILED'),
          });
        }
        keyframes[i] = {
          ...previousAcceptedFrame,
          shot_index: i,
          index: i + 1,
          title: shot.title || `Shot ${i + 1}`,
          error: '',
          error_code: '',
          regeneration_error: String(err.message || err),
          regeneration_error_code: qaUnavailable ? 'VISION_QA_UNAVAILABLE' : (err.code || 'KEYFRAME_FAILED'),
          regeneration_failed_at: new Date().toISOString(),
          current_generation_status: retryRequired ? 'retrying_serial' : (qaUnavailable ? 'qa_unavailable' : 'rejected'),
          current_generation_id: generationProgress.generation_id,
          contract: contracts[i] || previousAcceptedFrame.contract || null,
          candidates: [...(Array.isArray(previousAcceptedFrame.candidates) ? previousAcceptedFrame.candidates : []), ...shotCandidates]
            .filter((candidate, candidateIndex, all) => all.findIndex(item => String(item?.id || item?.image_url || '') === String(candidate?.id || candidate?.image_url || '')) === candidateIndex)
            .slice(-8),
          latest_attempt: keyframeFailure.attempt({
            generationId: generationProgress.generation_id,
            status: retryRequired ? 'retrying_serial' : (qaUnavailable ? 'qa_unavailable' : 'rejected'),
            error: err,
            candidates: shotCandidates,
          }),
        };
      } else {
        const failedStatus = retryRequired ? 'retrying_serial' : (qaUnavailable ? 'qa_unavailable' : 'failed');
        keyframes[i] = {
          ...(keyframes[i] || {}),
          shot_index: i,
          index: i + 1,
          title: shot.title || `Shot ${i + 1}`,
          error: String(err.message || err),
          error_code: err.code || 'KEYFRAME_FAILED',
          contract: contracts[i] || null,
          candidates: shotCandidates,
          current_generation_status: failedStatus,
          current_generation_id: generationProgress.generation_id,
          latest_attempt: keyframeFailure.attempt({ generationId: generationProgress.generation_id, status: failedStatus, error: err, candidates: shotCandidates }),
        };
      }
    }
    storage.saveOutput(taskId, 'keyframes', keyframes);
    activeProgressIndexes.delete(i);
    if (retryRequired) {
      pendingProgressIndexes.add(i);
      generationProgress.effective_concurrency = 1;
      refreshParallelProgress(i);
      storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
      return { index: i, failed: true, throttled: true, retry_required: true,
        usable: hasUsablePreviousKeyframe(keyframes[i]) };
    }
    generationProgress.processed += 1;
    if (currentAttemptFailed) generationProgress.failed += 1;
    else generationProgress.succeeded += 1;
    const usable = hasUsablePreviousKeyframe(keyframes[i]);
    const stopBatch = currentAttemptFailed && keyframeFailure.shouldStopBatch(currentError);
    if (usable) completedBatchIndexes.add(i);
    refreshParallelProgress(i);
    storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
    return {
      index: i, failed: currentAttemptFailed,
      throttled: currentAttemptFailed && keyframeParallel.isThrottleError(currentError), usable,
      stop_remaining: stopBatch, stop_code: stopBatch ? String(currentError?.code || 'KEYFRAME_PROVIDER_BATCH_STOP') : '',
      stop_message: stopBatch ? '供应商返回系统性、审核或计费不确定错误；已停止本批次尚未提交的镜头，避免重复付费。' : '',
      duration_ms: Date.now() - workerStartedMs,
    };
  }
  const schedule = await keyframeParallel.runSchedule({
    indexes: targetIndexes,
    concurrency: configuredConcurrency,
    dependencyOf: index => dependencyPlan.dependencies[index],
    externalDependencyUsable: index => hasUsablePreviousKeyframe(keyframes[index]),
    snapshot: () => keyframes.map((frame, index) => {
      if (targetIndexSet.has(index) && !completedBatchIndexes.has(index)) return null;
      return frame && typeof frame === 'object' ? { ...frame } : frame;
    }),
    worker: generateKeyframeAtIndex,
  });
  const blockedResults = schedule.results.filter(result => result?.blocked === true);
  for (const result of blockedResults) {
    const index = Number(result.index);
    if (!Number.isInteger(index) || index < 0 || index >= shots.length) continue;
    pendingProgressIndexes.delete(index);
    const systemBlocked = result.system_blocked === true || result.reason === 'batch_circuit_open';
    const dependencyNumber = Number.isInteger(result.dependency) ? result.dependency + 1 : 0;
    const message = systemBlocked
      ? (result.error || '供应商级错误已触发本批次熔断；本镜头尚未提交，因此没有新增图片调用。')
      : dependencyNumber
      ? `依赖的第 ${dependencyNumber} 镜没有可用关键帧，已停止第 ${index + 1} 镜生成以避免连续性错误。`
      : `第 ${index + 1} 镜的连续性依赖无效，已停止生成。`;
    const blockedCode = systemBlocked ? 'KEYFRAME_BATCH_CIRCUIT_OPEN' : 'KEYFRAME_DEPENDENCY_BLOCKED';
    const previousAcceptedFrame = hasUsablePreviousKeyframe(existing[index]) ? { ...existing[index] } : null;
    attempts.push({ index, ok: false, code: blockedCode, error: message });
    if (previousAcceptedFrame) {
      retainedRegenerationFailures.push({ index, error: message, code: blockedCode });
      keyframes[index] = {
        ...previousAcceptedFrame,
        shot_index: index,
        index: index + 1,
        title: shots[index]?.title || `Shot ${index + 1}`,
        error: '',
        error_code: '',
        regeneration_error: message,
        regeneration_error_code: blockedCode,
        regeneration_failed_at: new Date().toISOString(),
        current_generation_status: 'blocked',
        current_generation_id: generationProgress.generation_id,
        contract: contracts[index] || previousAcceptedFrame.contract || null,
        latest_attempt: keyframeFailure.attempt({
          generationId: generationProgress.generation_id,
          status: 'blocked',
          error: Object.assign(new Error(message), { code: blockedCode }),
        }),
      };
    } else {
      keyframes[index] = {
        ...(keyframes[index] || {}),
        shot_index: index,
        index: index + 1,
        title: shots[index]?.title || `Shot ${index + 1}`,
        error: message,
        error_code: blockedCode,
        contract: contracts[index] || null,
        current_generation_status: 'blocked',
        current_generation_id: generationProgress.generation_id,
        latest_attempt: keyframeFailure.attempt({
          generationId: generationProgress.generation_id,
          status: 'blocked',
          error: Object.assign(new Error(message), { code: blockedCode }),
        }),
      };
    }
  }
  if (blockedResults.length) {
    generationProgress.processed += blockedResults.length;
    generationProgress.failed += blockedResults.length;
    generationProgress.blocked = blockedResults.length;
    storage.saveOutput(taskId, 'keyframes', keyframes);
  }
  generationProgress.configured_concurrency = schedule.configured_concurrency;
  generationProgress.effective_concurrency = schedule.effective_concurrency;
  generationProgress.wave_count = schedule.waves.length;
  generationProgress.waves = schedule.waves.map(wave => ({
    kind: wave.kind,
    indexes: wave.indexes.map(index => index + 1),
    concurrency: wave.concurrency,
    wave_size: Number(wave.wave_size || wave.indexes.length || 0),
    actual_concurrency: Number(wave.actual_concurrency || wave.indexes.length || 0),
    duration_ms: Number(wave.duration_ms || 0),
    started_at: wave.started_at || '',
    finished_at: wave.finished_at || '',
  }));
  generationProgress.wall_time_ms = Date.now() - new Date(progressStartedAt).getTime();
  const targetDependencyReasons = targetIndexes.map(index => dependencyPlan.reasons[index] || 'unknown');
  generationProgress.parallelism_lost_reason = schedule.effective_concurrency < schedule.configured_concurrency
    ? 'provider_throttle'
    : ((generationProgress.peak_concurrency || 0) < Math.min(schedule.configured_concurrency, targetIndexes.length)
      ? (targetDependencyReasons.includes('temporal_continuity')
        ? 'temporal_chain'
        : (targetDependencyReasons.includes('continuity_metadata_unavailable')
          ? 'continuity_metadata_unavailable'
          : (targetDependencyReasons.some(reason => /anchor_unavailable/.test(reason)) ? 'anchor_unavailable' : 'dependency_limited')))
      : '');
  attempts.sort((a, b) => Number(a.index || 0) - Number(b.index || 0) || Number(a.qa_attempt || 0) - Number(b.qa_attempt || 0));
  retainedRegenerationFailures.sort((a, b) => a.index - b.index);
  refreshParallelProgress(targetIndexes[targetIndexes.length - 1] ?? 0);
  storage.updateTask(taskId, { generation_progress: { ...generationProgress } });
  if (retainedRegenerationFailures.length) {
    const finalStatus = keyframeCompletion(keyframes, shots);
    const shotNumbers = retainedRegenerationFailures.map(item => item.index + 1);
    const qaUnavailableFailures = retainedRegenerationFailures.filter(item => item.code === 'VISION_QA_UNAVAILABLE');
    const rejectedFailures = retainedRegenerationFailures.filter(item => item.code !== 'VISION_QA_UNAVAILABLE');
    const message = qaUnavailableFailures.length && !rejectedFailures.length
      ? `第 ${shotNumbers.join('、')} 镜的新图已经生成，但视觉审核服务超时或返回格式异常。图片已保留，可直接重新验证，无需再次生成。`
      : `第 ${shotNumbers.join('、')} 镜的新版本未通过生成或 QA，已保留上一版可用画面。请根据具体原因调整后重试。`;
    generationProgress.status = 'failed';
    generationProgress.finished_at = new Date().toISOString();
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `${finalStatus.completed}/${finalStatus.total} image keyframes; ${retainedRegenerationFailures.length} rejected regeneration`,
      diagnostics: { attempts, keyframe_status: finalStatus, retained_regeneration_failures: retainedRegenerationFailures },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', generation_progress: { ...generationProgress } });
    const err = new Error(message);
    err.code = qaUnavailableFailures.length && !rejectedFailures.length ? 'VISION_QA_UNAVAILABLE' : 'KEYFRAME_REGENERATION_REJECTED';
    err.retryable = true;
    err.keyframes = keyframes;
    err.attempts = attempts;
    throw err;
  }
  const failed = keyframeFailure.describeBatchFailures({ targetIndexes, keyframes, shots, isComplete: isCompleteKeyframe });
  if (failed.length) {
    const err = keyframeFailure.batchError(failed, keyframes, attempts);
    const message = err.message;
    generationProgress.status = 'failed';
    generationProgress.finished_at = new Date().toISOString();
    generationProgress.failed_shots = failed.map(item => item.shot_number);
    generationProgress.error_code = 'KEYFRAME_BATCH_PARTIAL_FAILURE';
    storage.saveStage(taskId, 'keyframes', { status: 'failed', error: message, diagnostics: { attempts, failures: failed, generation_id: generationProgress.generation_id } });
    storage.updateTask(taskId, { status: 'failed', stage: 'keyframes_failed', error: message, error_code: 'KEYFRAME_BATCH_PARTIAL_FAILURE', retryable: true, generation_progress: { ...generationProgress } });
    throw err;
  }
  const finalStatus = keyframeCompletion(keyframes, shots);
  generationProgress.status = 'done';
  generationProgress.finished_at = new Date().toISOString();
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.saveStage(taskId, 'keyframes', {
    status: finalStatus.fresh_pass >= finalStatus.total ? 'done' : 'partial',
    output_summary: `${finalStatus.fresh_pass}/${finalStatus.total} current keyframes verified`,
    diagnostics: { attempts, keyframe_status: finalStatus },
  });
  storage.updateTask(taskId, finalStatus.fresh_pass >= finalStatus.total
    ? { status: 'done', stage: 'keyframes_ready', error: '', error_code: '', generation_progress: { ...generationProgress } }
    : { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', generation_progress: { ...generationProgress } });
  return { keyframes, keyframe_contracts: contracts, attempts, keyframe_status: finalStatus };
}
function selectedSceneReference(sceneAsset = {}, contract = {}, shot = {}) {
  const panoramaReference = shotReferencePacks.panoramaCameraReference(sceneAsset, shot, contract);
  if (panoramaReference?.image_url) return mediaAdapter.absolutePublicImageUrl(panoramaReference.image_url);
  const viewKey = cleanText(contract?.scene_lock?.scene_view || contract?.scene_view || 'master', 40) || 'master';
  const views = Array.isArray(sceneAsset?.view_images) ? sceneAsset.view_images : [];
  const view = views.find(item => cleanText(item?.key || item?.view || '', 40) === viewKey)
    || views.find(item => cleanText(item?.key || item?.view || '', 40) === 'master')
    || views[0];
  return mediaAdapter.absolutePublicImageUrl(view?.url || view?.image_url || sceneAsset?.image_url || '');
}
async function runKeyframeQaReviews({ taskId, ctx = {}, shot = {}, contract = {}, sceneAsset = {}, generatedUrl = '' } = {}) {
  const sceneReference = selectedSceneReference(sceneAsset, contract, shot);
  const layoutReference = completeSpaceLock(sceneAsset) ? layoutSceneReference(sceneAsset) : null;
  const reviewUrl = /^https?:\/\//i.test(String(generatedUrl || ''))
    ? String(generatedUrl)
    : mediaAdapter.absolutePublicImageUrl(generatedUrl);
  if (!reviewUrl) {
    const error = new Error('候选关键帧缺少可审核的图片地址');
    error.code = 'KEYFRAME_CANDIDATE_IMAGE_MISSING';
    error.status = 422;
    throw error;
  }
  const [sceneQa, personQa, productQa] = await Promise.all([
    sceneReference
      ? reviewWithInfrastructureRetry(attempt => sceneSpace.reviewKeyframe({
        taskId,
        sceneReferenceUrl: sceneReference,
        layoutReferenceUrl: layoutReference?.url || '',
        generatedUrl: reviewUrl,
        contract: contract?.scene_lock || sceneAsset?.scene_contract || {},
        shot, knowledgePolicyQaBlock: knowledgePolicyRuntime.qaBlock(contract.knowledge_policy_qa || {}),
        timeoutMs: attempt ? 45000 : 60000,
        maxCandidates: attempt ? 2 : 3,
        stageBudgetMs: attempt ? 90000 : 120000,
      }), 2)
      : Promise.resolve({
        pass: true,
        status: 'not_applicable',
        reason: '当前任务没有已锁定场景资产，不执行场景空间一致性比较。',
        checked_at: new Date().toISOString(),
      }),
    reviewWithInfrastructureRetry(attempt => personKeyframeQa.reviewPersonKeyframe({
      taskId,
      ctx,
      shot,
      contract,
      generatedUrl: reviewUrl,
      timeoutMs: attempt ? 45000 : 60000,
      maxCandidates: attempt ? 2 : 3,
      stageBudgetMs: attempt ? 90000 : 120000,
    }), 2),
    reviewWithInfrastructureRetry(attempt => productKeyframeQa.reviewProductKeyframe({
      taskId,
      ctx,
      shot,
      contract,
      generatedUrl: reviewUrl,
      timeoutMs: attempt ? 45000 : 60000,
      maxCandidates: attempt ? 2 : 3,
      stageBudgetMs: attempt ? 90000 : 120000,
    }), 2),
  ]);
  return { sceneReference, sceneQa, personQa, productQa };
}

function combineKeyframeQa({ ctx = {}, shot = {}, contract = {}, sceneReference = '', sceneQa = {}, personQa = {}, productQa = {} } = {}) {
  const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shot, contract);
  const personForbidden = personIdentity.shotForbidsPerson(ctx, shot);
  const productRequired = productIdentity.shotProductProofRequired(ctx, shot, contract);
  const conflicts = [
    ...(sceneQa.mismatch_reasons || []),
    ...(sceneQa.forbidden_new_elements || []),
    ...(personQa.conflicts || []),
    ...(productQa.conflicts || []),
    personQa.retry_instruction || '',
    productQa.retry_instruction || '',
  ].filter(Boolean);
  const scenePass = !sceneReference || (sceneQa.pass === true && sceneQa.status === 'passed');
  const personPass = !(shotNeedsPerson || personForbidden) || (personQa.pass === true && personQa.status === 'verified');
  const productPass = !productRequired || (productQa.pass === true && productQa.status === 'verified');
  return {
    pass: scenePass && personPass && productPass,
    status: scenePass && personPass && productPass ? 'verified' : 'rejected',
    scene: sceneQa,
    person: personQa,
    product: productQa,
    mismatch_reasons: conflicts,
    checked_at: new Date().toISOString(),
  };
}

function keyframeReferenceImages(taskId = '', shotIndex = 0, ctx = {}, sceneReference = '', previousFrame = null, shot = {}, contract = {}, sceneAsset = {}) {
  return shotReferencePacks.referenceUrls(taskId, shotIndex, ctx, sceneReference, previousFrame, shot, contract, sceneAsset);
}

async function ensureStoryboardForMedia(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  let shots = storage.getOutput(taskId, 'storyboard_table');
  if (!Array.isArray(shots) || !shots.length) {
    const generated = await generateStoryboardStage(taskId);
    shots = generated.shots || [];
  }
  if (!Array.isArray(shots) || !shots.length) throw new Error('当前项目没有可用分镜表，请先生成分镜。');
  return shots;
}

async function ensureContractsForMedia(taskId, ctx, shots) {
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  return keyframeContractFreshness.inspect(taskId, { ctx: contractCtx, shots }).contracts;
}
function assertVideoInputsReady({ ctx = {}, shots = [], keyframes = [], contracts = [] } = {}) {
  assertVerifiedSceneAssets(ctx.scene_assets || []);
  const personContract = personIdentity.assertVerifiedPerson(ctx);
  productIdentity.assertVerifiedProduct(ctx);
  const failures = [...storyboardContinuityGate.reviewContinuity({ shots, contracts }).issues];
  const personRequired = personIdentity.personRequired(ctx);
  for (let index = 0; index < shots.length; index += 1) {
    const frame = keyframes[index] || {};
    const qa = frame.qa || {};
    if (!isCompleteKeyframe(frame)) {
      failures.push(`第 ${index + 1} 镜缺少可用关键帧`);
      continue;
    }
    if (frame.regeneration_error) {
      failures.push(`第 ${index + 1} 镜本轮新版本未通过，当前仅保留上一版画面`);
      continue;
    }
    if (['pending', 'generating', 'retrying_serial'].includes(String(frame.current_generation_status || ''))) {
      failures.push(`第 ${index + 1} 镜仍在生成或尚未完成本轮验收`);
      continue;
    }
    if (Number(frame.qa_policy_version || 0) < 2) {
      failures.push(`第 ${index + 1} 镜仍是旧版视觉 QA 结果，请按新规则重新生成并验证`);
      continue;
    }
    if (!keyframeContractFreshness.artifactMatchesContract(frame, contracts[index] || {})) {
      failures.push(`第 ${index + 1} 镜的画面与当前镜头合同不一致，请重新生成`);
      continue;
    }
    if (qa.pass !== true || qa.status === 'rejected') {
      failures.push(`第 ${index + 1} 镜尚未通过关键帧总 QA`);
      continue;
    }
    const shotNeedsPerson = personIdentity.shotPersonRequired(ctx, shots[index] || {}, contracts[index] || {});
    const personForbidden = personIdentity.shotForbidsPerson(ctx, shots[index] || {});
    if ((shotNeedsPerson || personForbidden) && (qa.person?.pass !== true || qa.person?.status !== 'verified')) {
      failures.push(`第 ${index + 1} 镜缺少已通过的人物一致性 QA`);
    }
    const shotNeedsProduct = productIdentity.shotProductProofRequired(ctx, shots[index] || {}, contracts[index] || {});
    if (shotNeedsProduct && (qa.product?.pass !== true || qa.product?.status !== 'verified')) {
      failures.push(`第 ${index + 1} 镜缺少已通过的产品一致性 QA`);
    }
    const frameRevision = Number(frame.contract?.cast_lock?.person_contract?.person_revision || 0);
    const currentRevision = Number(personContract?.person_revision || 0);
    if (personRequired && currentRevision > 0 && frameRevision !== currentRevision) {
      failures.push(`第 ${index + 1} 镜人物版本已过期（关键帧 v${frameRevision || 0}，当前 v${currentRevision}）`);
    }
    const contractRevision = Number(contracts[index]?.cast_lock?.person_contract?.person_revision || 0);
    if (personRequired && currentRevision > 0 && contractRevision !== currentRevision) {
      failures.push(`第 ${index + 1} 镜人物合同版本未同步`);
    }
  }
  if (failures.length) {
    const error = new Error(`视频生成前校验未通过：${failures.join('；')}。系统不会自动补图或继续合成，请先在分镜页明确处理。`);
    error.code = 'VIDEO_INPUT_QA_REQUIRED';
    error.status = 422;
    error.retryable = false;
    error.details = failures;
    throw error;
  }
  return true;
}

function resolveTtsVoiceId(options = {}, ctx = {}, existingTtsAudio = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'voice_id') || Object.prototype.hasOwnProperty.call(options, 'voiceId')) {
    return cleanText(options.voice_id ?? options.voiceId ?? '', 120);
  }
  if (Object.prototype.hasOwnProperty.call(ctx, 'voice_id') || Object.prototype.hasOwnProperty.call(ctx, 'voiceId')) {
    return cleanText(ctx.voice_id ?? ctx.voiceId ?? '', 120);
  }
  return cleanText(
    existingTtsAudio?.voice_id
      || existingTtsAudio?.voiceId
      || '',
    120,
  );
}

function silentTtsOutput(reason = 'voiceover_disabled') {
  return {
    tracks: [],
    voice_id: '',
    skipped: true,
    reason,
    provider_used: '',
    warnings: [],
  };
}

async function generateTtsStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  // “合成广告”会先执行 TTS。必须在产生配音费用之前执行与视频阶段
  // 相同的审核门禁，避免未通过的关键帧仍然消耗一次配音调用。
  videoSubmissionGate.validateBeforeProvider({ storage, taskId, validate: () => assertVideoInputsReady({ ctx, shots, keyframes, contracts }) });
  const existingTtsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  const voiceId = resolveTtsVoiceId(options, ctx, existingTtsAudio);
  const voiceAssignments = voicePlan.resolveVoiceAssignments(options, ctx, existingTtsAudio, voiceId);
  const includeVoiceover = voicePlan.voiceoverEnabled(options, ctx, voiceId, voiceAssignments);
  storage.updateTask(taskId, { status: 'running', stage: 'tts' });
  storage.saveStage(taskId, 'tts', { status: 'running', input_summary: `${shots.length} shot voice tracks` });
  if (!includeVoiceover) {
    const tts_audio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', tts_audio);
    storage.saveStage(taskId, 'tts', {
      status: 'done',
      output_summary: 'voiceover skipped by user',
      diagnostics: { skipped: true, reason: tts_audio.reason },
    });
    storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
    return { tts_audio, skipped: true };
  }
  const reusedTts = ttsReuse.reuseExistingVoiceover({ storage, taskId, ttsAudio: existingTtsAudio, shots, voiceId, voiceAssignments, force: options.force_regenerate_tts === true || options.forceRegenerateTts === true }); if (reusedTts) return reusedTts;
  const tts_audio = await ttsAdapter.generateVoiceover({
    taskId, shots, voiceId, voiceAssignments,
    userId: task.user_id || task.request?.user_id || task.request?.userId || '',
    requestBaseUrl: options.request_base_url || options.requestBaseUrl || '',
    speed: options.speed || ctx.tts_speed || 1,
    allowSilentFallback: options.allow_silent_fallback === true || options.allowSilentFallback === true,
    existingTracks: (options.force_regenerate_tts === true || options.forceRegenerateTts === true) ? [] : (existingTtsAudio?.tracks || []),
    onCheckpoint: tracks => storage.saveOutput(taskId, 'tts_audio', { tracks, voice_id: voiceId, voice_assignments: voiceAssignments, provider_used: tracks.find(track => track?.provider_used)?.provider_used || '', warnings: tracks.map(track => track?.warning).filter(Boolean), status: tracks.every(Boolean) ? 'ready' : 'running', updated_at: new Date().toISOString() }),
  });
  storage.saveOutput(taskId, 'tts_audio', tts_audio);
  storage.saveStage(taskId, 'tts', {
    status: 'done',
    output_summary: `${tts_audio.tracks.length} audio tracks`,
    diagnostics: {
      provider_used: tts_audio.provider_used || '',
      warnings: tts_audio.warnings || [],
    },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'tts_ready' });
  return { tts_audio };
}

/** 编译通用执行方案、人民币成本上限和零自动重试的视频预检。 */
function projectVideoOutputContext(storedCtx = {}, options = {}) {
  return {
    ...storedCtx,
    output_ratio: options.aspect_ratio || options.aspectRatio || storedCtx.output_ratio || '9:16',
    video_resolution: options.video_resolution || options.videoResolution || storedCtx.video_resolution || '1080p',
  };
}

function buildVideoPreflightPlan(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new videoCore.chineseError.VideoGenerationError('TASK_NOT_FOUND', '', { status: 404 });
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const storedCtx = storage.getOutput(taskId, 'context') || task.request || {};
  // Preflight and execution must bind the same output context. Deferring the
  // requested resolution until after authorization invalidates every freshly
  // generated lineage during compose and can invite an unnecessary paid redo.
  const ctx = projectVideoOutputContext(storedCtx, options);
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [];
  const contractCtx = { ...ctx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const contracts = keyframeContractFreshness.inspect(taskId, { ctx: contractCtx, shots }).contracts;
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  const storedClips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [];
  const statuses = videoAdapter.listVideoShotStatuses(taskId, shots.length);
  const clips = videoClipStatusRecovery.recover(storedClips, statuses);
  let pinnedModel = null;
  let pinnedModelError = null;
  try {
    pinnedModel = videoAdapter.resolvePinnedVideoModel(options, clips);
  } catch (error) {
    pinnedModelError = error;
    pinnedModel = videoAdapter.videoCandidates(options, { includeCircuitOpen: true })[0] || null;
  }
  const providerRoute = pinnedModel ? `${String(pinnedModel.provider_id || '').toLowerCase()}/${String(pinnedModel.model_id || '').toLowerCase()}` : '';
  const modelRouteFor = (shot, contract) => {
    const selected = videoAdapter.expectedModelForShot(shot, contract, pinnedModel || {});
    return selected?.provider_id && selected?.model_id
      ? `${String(selected.provider_id).toLowerCase()}/${String(selected.model_id).toLowerCase()}`
      : providerRoute;
  };
  const executionPlan = videoCore.planner.compileExecutionPlan({
    shots,
    contracts,
    businessProfile: ctx.business_profile || ctx.businessProfile || ctx.ad_type || 'story_ad',
    options,
  });
  const requestedOnlyIndexes = videoSubmissionGate.normalizeOnlyIndexes(options, shots.length);
  const blueprint = storage.getOutput(taskId, 'blueprint') || {}, storyboardMeta = storage.getOutput(taskId, 'storyboard_meta') || {};
  const ttsAudio = storage.getOutput(taskId, 'tts_audio') || {}, audioTracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const providerCapabilityRegistry = videoArtifactWorkflow.capabilityRegistry({ route: providerRoute, model: pinnedModel || {}, configured: options.provider_capability_registry || options.providerCapabilityRegistry || {} });
  const baseArgs = { taskId, shots, keyframes, contracts, clips, statuses, ctx, mode: options.video_generation_mode || options.videoGenerationMode || options.mode || 'economy', providerRoute, providerId: pinnedModel?.provider_id || '', modelId: pinnedModel?.model_id || '', providerCapabilityRegistry, executionPlan, executionOptions: options, onlyIndexes: requestedOnlyIndexes };
  let plan, compatibilityReport = null, expectedLineages = [], appliedCompatibilityFingerprint = '';
  for (let pass = 0; pass < 3; pass += 1) {
    appliedCompatibilityFingerprint = compatibilityReport?.fingerprint || '';
    plan = videoPreflight.buildVideoPreflight({ ...baseArgs, compatibilityReport });
    expectedLineages = videoArtifactWorkflow.buildExpectedLineages({ shots: plan.reconciled_shots || shots, contracts, keyframes, ctx, blueprint, storyboardMeta, modelRoute: providerRoute, modelRouteFor, audioTracks, sceneBlocks: plan.scene_blocks || [], shotPlans: plan.shots || [], qaPolicyVersion: videoFrameQa.VIDEO_FRAME_QA_POLICY_VERSION, speechModeFor: (shot, contract) => videoAdapter.explicitShotSpeechMode(shot, contract), motionPromptFor: (shot, contract, index) => ((plan.shots || []).find(item => item.index === index)?.action !== 'provider_generate' && clips[index]?.motion_prompt) || videoAdapter.clipPrompt(shot, ctx, contract, index > 0 ? shots[index - 1] : null, keyframes[index] || {}, plan.repair_instructions?.[index] || '') });
    const nextReport = videoArtifactWorkflow.buildCompatibilityReport({ clips, expectedLineages, onlyIndexes: requestedOnlyIndexes });
    if (compatibilityReport?.fingerprint === nextReport.fingerprint) { compatibilityReport = nextReport; break; }
    compatibilityReport = nextReport;
  }
  plan.compatibility_report = compatibilityReport; plan.expected_lineages = expectedLineages; videoPrivacyRetryPolicy.applyPrivacyRetryBlockers({ plan, statuses, expectedLineages });
  if (!pinnedModel && pinnedModelError) {
    plan.blockers.push({
      code: pinnedModelError.code || 'VIDEO_MODEL_CONFIG_REQUIRED',
      message: cleanText(pinnedModelError.message || '指定的视频模型路由不可用，已在供应商提交前停止。', 500),
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  if (appliedCompatibilityFingerprint !== (compatibilityReport?.fingerprint || '')) { plan.blockers.push({ code: 'VIDEO_ARTIFACT_PLAN_UNSTABLE', message: '视频产物兼容方案未能稳定收敛，已在供应商提交前停止。' }); plan.status = 'blocked'; }
  const authorizedExecutionPlan = {
    ...executionPlan,
    generation_units: (plan.units || []).filter(unit => unit.paid).map(unit => {
      const firstIndex = (unit.member_indexes || [])[0] ?? 0;
      const unitModel = videoAdapter.expectedModelForShot((plan.reconciled_shots || shots)[firstIndex] || {}, contracts[firstIndex] || {}, pinnedModel || {});
      return {
      id: unit.id,
      paid: true,
      provider_id: unitModel.provider_id || pinnedModel?.provider_id || '',
      model_id: unitModel.model_id || pinnedModel?.model_id || '',
      mode: unit.continuous ? 'one_take' : 'single_shot',
      edit_shot_indexes: unit.member_indexes || [],
      duration_sec: unit.duration_sec,
      complexity_level: Math.max(0, ...(unit.member_indexes || []).map(index => videoCore.planner.complexityOf(executionPlan.edit_shots[index] || {}))),
      requires_manual_review: (unit.member_indexes || []).some(index => videoCore.planner.complexityOf(executionPlan.edit_shots[index] || {}) >= 3),
      automatic_retry_limit: 0,
    };
    }),
  };
  const costPlan = videoCore.costGuard.buildCostPlan({
    executionPlan: authorizedExecutionPlan,
    providerId: pinnedModel?.provider_id || '',
    modelId: pinnedModel?.model_id || '',
    options,
  });
  plan.authorized_execution_plan = authorizedExecutionPlan;
  plan.cost_plan = costPlan;
  plan.warnings = [];
  if (executionPlan.summary.high_risk_unit_count > 0) {
    plan.warnings.push({
      code: 'VIDEO_COMPLEXITY_REVIEW_REQUIRED',
      message: `检测到 ${executionPlan.summary.high_risk_unit_count} 个高复杂度生成单元，付费提交前必须确认动画预演和镜头拆分。`,
    });
  }
  if (plan.paid_unit_count > 0 && pinnedModel && !costPlan.price_known) {
    plan.blockers.push({
      code: 'VIDEO_COST_PRICE_UNKNOWN',
      message: '当前视频模型没有可信的人民币计费单价，已停止付费生成。请先由管理员补充价格配置。',
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  const runtimePolicy = storyAdV3RuntimePolicy();
  plan.runtime_policy = runtimePolicy;
  videoSubmissionGate.addInputBlocker(plan, () => assertVideoInputsReady({ ctx: contractCtx, shots, keyframes, contracts }));
  if (plan.paid_unit_count > 0 && !runtimePolicy.paid_video_enabled) {
    plan.blockers.push({
      code: 'VIDEO_V3_PAID_DISABLED',
      message: '剧情广告 V2.0 当前处于只读或零费用灰度状态，新的付费视频提交已暂停。',
    });
    plan.status = plan.zero_cost_action_count > 0 ? 'partial_ready' : 'blocked';
  }
  plan.paid_execution_policy = paidExecutionPolicy.publicPolicy(); plan.fingerprint = revisionService.signature({
    video_preflight_fingerprint: plan.fingerprint,
    execution_plan_fingerprint: executionPlan.fingerprint,
    cost_plan_fingerprint: costPlan.fingerprint,
    runtime_policy: runtimePolicy, paid_execution_policy: plan.paid_execution_policy,
    compatibility_fingerprint: compatibilityReport?.fingerprint || '', privacy_retry_blockers: plan.blockers.filter(item => item.code === videoPrivacyRetryPolicy.BLOCKER_CODE).map(item => item.details?.rejected_lineage_fingerprint || ''),
  });
  return plan;
}

/** 校验不可变视频方案、复杂度确认和人民币费用授权。 */
function assertVideoPreflightConfirmation(taskId, options = {}) {
  const plan = buildVideoPreflightPlan(taskId, options);
  const supplied = String(options.video_preflight_fingerprint || options.videoPreflightFingerprint || '').trim();
  if (!supplied || supplied !== plan.fingerprint) {
    const error = new Error('视频生成方案尚未确认或任务内容已变化。请先查看新的生成前优化方案；本次没有提交视频模型。');
    error.code = 'VIDEO_PREFLIGHT_CONFIRMATION_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  const zeroCostOnly = options.zero_cost_only === true || options.zeroCostOnly === true;
  if (plan.blockers.length && !zeroCostOnly) {
    const error = new Error(plan.blockers.map(item => item.message).join('；'));
    error.code = plan.blockers[0]?.code || 'VIDEO_PREFLIGHT_BLOCKED';
    error.status = 409;
    error.retryable = true;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  if (zeroCostOnly && !plan.zero_cost_action_count) {
    const error = new Error('当前没有可执行的“无需调用视频生成模型”处理，本次没有提交视频模型。');
    error.code = 'VIDEO_PREFLIGHT_NO_ZERO_COST_ACTION';
    error.status = 409;
    error.retryable = false;
    error.preflight = videoPreflight.publicVideoPreflight(plan);
    throw error;
  }
  videoSubmissionGate.assertForceScope(options, plan);
  if (!zeroCostOnly && Number(plan.paid_unit_count || 0) > 0) {
    videoCore.costGuard.assertComplexityReview(plan.authorized_execution_plan || plan.execution_plan, options);
    const authorization = videoCore.costGuard.assertCostAuthorization(plan.cost_plan, options);
    videoCostAuthorization.authorize(taskId, authorization, {
      execution_plan_fingerprint: plan.execution_plan.fingerprint, video_preflight_fingerprint: plan.fingerprint, paid_execution_policy: paidExecutionPolicy.publicPolicy(),
    });
  }
  storage.saveOutput(taskId, 'video_execution_plan', plan.execution_plan);
  storage.saveOutput(taskId, 'video_preflight', videoPreflight.publicVideoPreflight(plan));
  return plan;
}

async function generateVideoStage(taskId, options = {}) { options = paidExecutionPolicy.canonicalize(options);
  const task = storage.getTask(taskId);
  if (!task) throw new videoCore.chineseError.VideoGenerationError('TASK_NOT_FOUND', '', { status: 404 });
  productionGraph.assertExecutable(taskId);
  let ctx = { ...(storage.getOutput(taskId, 'context') || task.request || {}), production_graph: storage.getOutput(taskId, 'production_graph_v1') || null };
  const shots = await ensureStoryboardForMedia(taskId);
  const contracts = await ensureContractsForMedia(taskId, ctx, shots);
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes') : [];
  videoSubmissionGate.validateBeforeProvider({ storage, taskId, validate: () => assertVideoInputsReady({ ctx, shots, keyframes, contracts }) });
  // 视频供应商调用必须经过不可绕过的方案与人民币费用确认。
  const preflightPlan = assertVideoPreflightConfirmation(taskId, options);
  const generationMode = preflightPlan.mode;
  const zeroCostOnly = options.zero_cost_only === true || options.zeroCostOnly === true;
  const previousClips = await videoEvidencePreflight.prepareRequiredBoundaryEvidence(taskId, preflightPlan);
  const generationShots = generationMode === 'quality' ? preflightPlan.reconciled_shots : shots;
  const localMotionIndexSet = new Set(preflightPlan.local_motion_indexes || []);
  const preflightShotActions = new Map((preflightPlan.shots || []).map(item => [item.index, item]));
  let ttsAudio = storage.getOutput(taskId, 'tts_audio');
  const visualOnly = options.visual_only === true || options.visualOnly === true;
  const selectedVoiceId = resolveTtsVoiceId(options, ctx, ttsAudio);
  const voiceId = visualOnly ? '' : selectedVoiceId;
  const voiceAssignments = visualOnly ? {} : voicePlan.resolveVoiceAssignments(options, ctx, ttsAudio || {}, voiceId);
  const includeVoiceover = !visualOnly && voicePlan.voiceoverEnabled(options, ctx, voiceId, voiceAssignments);
  const persistedCtx = {
    ...projectVideoOutputContext(ctx, options),
    ...(visualOnly ? {} : { voice_id: voiceId, voice_assignments: voiceAssignments, include_voiceover: includeVoiceover }),
  };
  ctx = {
    ...persistedCtx,
    include_voiceover: visualOnly ? false : includeVoiceover,
  };
  storage.saveOutput(taskId, 'context', persistedCtx);
  const autoTtsEnabled = includeVoiceover && options.auto_tts !== false && options.autoTts !== false;
  const ttsNeedsRefresh = includeVoiceover && !ttsAdapter.voiceoverReady(ttsAudio, shots, voiceId, voiceAssignments);
  if (visualOnly) {
    ttsAudio = silentTtsOutput('visual_only_storyboard_video');
  } else if (!includeVoiceover) {
    ttsAudio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', ttsAudio);
  } else if (ttsNeedsRefresh && autoTtsEnabled) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
  }
  storage.updateTask(taskId, { status: 'running', stage: 'video', error: '', error_code: '', retryable: false });
  storage.saveStage(taskId, 'video', { status: 'running', input_summary: `${shots.length} shot videos` });
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const storyboardMeta = storage.getOutput(taskId, 'storyboard_meta') || {};
  const forceRegenerateAll = !zeroCostOnly && (options.force_regenerate_all === true || options.forceRegenerateAll === true);
  const pinnedModel = videoAdapter.resolvePinnedVideoModel(options, previousClips);
  const pinnedRoute = `${String(pinnedModel.provider_id || '').toLowerCase()}/${String(pinnedModel.model_id || '').toLowerCase()}`;
  let sceneBlocks = Array.isArray(preflightPlan.scene_blocks) && preflightPlan.scene_blocks.length ? preflightPlan.scene_blocks : sceneBlockService.buildSceneBlocks(generationShots, contracts, { ...options, preserve_existing_topology: false, continuous_quality_mode: generationMode === 'quality', scene_block_generation: generationMode === 'quality' });
  const lipSyncIndexes = generationShots.map((shot, index) => videoAdapter.explicitShotSpeechMode(shot, contracts[index] || {}) === 'on_camera_dialogue' ? index : -1).filter(index => index >= 0);
  sceneBlocks = sceneBlockService.isolateIndexes(sceneBlocks, generationShots, contracts, lipSyncIndexes);
  storage.saveOutput(taskId, 'scene_worlds', preflightPlan.execution_plan?.scene_worlds || []);
  storage.saveOutput(taskId, 'continuity_runs', preflightPlan.execution_plan?.continuity_runs || []);
  storage.saveOutput(taskId, 'generation_units', preflightPlan.execution_plan?.generation_units || []);
  storage.saveOutput(taskId, 'video_scene_blocks', sceneBlocks);
  const audioTracks = Array.isArray(ttsAudio?.tracks) ? ttsAudio.tracks : (Array.isArray(ttsAudio) ? ttsAudio : []);
  const expectedLineages = generationShots.map((shot, index) => {
    const expectedModel = videoAdapter.expectedModelForShot(shot, contracts[index] || {}, pinnedModel);
    const expectedRoute = expectedModel?.provider_id && expectedModel?.model_id
      ? `${String(expectedModel.provider_id).toLowerCase()}/${String(expectedModel.model_id).toLowerCase()}`
      : pinnedRoute;
    return videoLineage.buildShotLineage({
    shot, index, contract: contracts[index] || {}, keyframe: keyframes[index] || {}, ctx,
    blueprint, storyboardMeta, modelRoute: expectedRoute,
    speechMode: videoAdapter.explicitShotSpeechMode(shot, contracts[index] || {}),
    motionPrompt: videoAdapter.clipPrompt(shot, ctx, contracts[index] || {}, index > 0 ? generationShots[index - 1] : null, keyframes[index] || {}, preflightPlan.repair_instructions?.[index] || ''),
    audio: audioTracks[index] || {},
    sceneBlock: sceneBlockService.blockForIndex(sceneBlocks, index),
    });
  });
  let clips = previousClips.slice();
  async function reviewVideoIndexes(reviewedIndexes = [], repairAttempt = 0, { stopOnFailure = false } = {}) {
    const failures = [];
    for (const index of reviewedIndexes) {
      const clip = clips[index];
      if (!videoLineage.clipHasMediaFile(clip)) continue;
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: 'video_qa', qa_status: 'reviewing', repair_attempt: repairAttempt,
        file_path: clip.file_path || '', file_exists: !!(clip.file_path && fs.existsSync(clip.file_path)),
        video_url: clip.video_url || clip.videoUrl || '',
      }, shots.length);
      const planned = preflightShotActions.get(index) || {}, plannedAction = planned.action || '', continuityReviewOnly = plannedAction === 'review_only' && planned.review_scope === 'cross_shot';
      const transitionBridge = plannedAction === 'transition_bridge';
      const savedContractQa = plannedAction === 'review_only' && !continuityReviewOnly
        ? videoFrameQa.reconcileExistingApprovedPartialPersonQa({ qa: clip.qa || {}, keyframe: keyframes[index] || {}, contract: contracts[index] || {} })
        : null;
      const localMotionQa = plannedAction === 'local_motion'
        ? await videoFrameQa.verifyDeterministicLocalMotionClip({ taskId, clip, keyframe: keyframes[index] || {}, contract: contracts[index] || {}, index })
        : null;
      const requiresLipSync = videoAdapter.explicitShotSpeechMode(generationShots[index] || shots[index] || {}, contracts[index] || {}) === 'on_camera_dialogue';
      const lipSyncQa = requiresLipSync && clip.lip_sync_applied !== true ? { pass: false, status: 'failed', problems: ['出镜对白镜头没有经过真实音频驱动口型阶段'], failure_dimensions: ['lip_sync'], failure_labels_zh: ['逐字口型未执行'], retry_instruction: '使用 new_story_ad.lip_sync 中配置的图片+音频口型模型重新生成该镜头。' } : null;
      const qa = lipSyncQa || ((continuityReviewOnly || transitionBridge) ? clip.qa : (savedContractQa || localMotionQa || await videoFrameQa.reviewVideoClip({ taskId, clip, shot: preflightPlan.reconciled_shots[index] || shots[index] || {}, keyframe: keyframes[index] || {}, contract: contracts[index] || {}, ctx, index })));
      clips[index] = { ...clip, qa, error: qa.pass ? '' : '视频抽帧 QA 未通过', error_code: qa.pass ? '' : 'VIDEO_FRAME_QA_FAILED' };
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: qa.pass ? 'qa_passed' : 'qa_failed', qa_status: qa.pass ? 'passed' : 'failed',
        qa_problems: qa.problems || [], qa_failure_dimensions: qa.failure_dimensions || [], qa_failure_labels_zh: qa.failure_labels_zh || [],
        error: qa.pass ? '' : '视频抽帧 QA 未通过', error_code: qa.pass ? '' : 'VIDEO_FRAME_QA_FAILED', retryable: !qa.pass,
      }, shots.length);
      if (!qa.pass) {
        failures.push({ index, kind: 'frame_qa', dimensions: qa.failure_dimensions || [], labels_zh: qa.failure_labels_zh || [], problems: qa.problems || [], retry_instruction: qa.retry_instruction || '', repairable: true });
        if (stopOnFailure) {
          storage.saveOutput(taskId, 'video_clips', clips);
          return failures;
        }
      }
    }
    const crossIndexes = videoBoundaryPolicy.requiredBoundaryIndexes(clips, reviewedIndexes);
    for (const index of crossIndexes) {
      const previous = clips[index - 1];
      const current = clips[index];
      if (!previous?.qa?.pass || !current?.qa?.pass) continue;
      const planned = preflightShotActions.get(index) || {};
      const deterministicTransition = videoBoundaryPolicy.usesDeterministicTransition(planned);
      const crossQa = deterministicTransition
        ? videoBoundaryPolicy.deterministicTransitionQa(previous, current, planned.transition_override || 'dissolve')
        : await videoFrameQa.reviewCrossShot({ taskId, previous: previous.qa, current: current.qa, previousShot: generationShots[index - 1] || {}, currentShot: generationShots[index] || {}, previousLineageFingerprint: previous.lineage_fingerprint || '', currentLineageFingerprint: current.lineage_fingerprint || '', ctx, knowledgePolicyQaBlock: knowledgePolicyRuntime.qaBlock(contracts[index]?.knowledge_policy_video_qa || {}) });
      const { code: crossErrorCode, message: crossError } = videoFrameQa.crossShotFailure(crossQa, index);
      clips[index] = {
        ...current,
        ...(deterministicTransition && crossQa.pass ? { transition_override: crossQa.transition_type, transition_decision_source: crossQa.decision_source } : {}),
        cross_shot_qa: crossQa, error: crossQa.pass ? '' : crossError, error_code: crossQa.pass ? '' : crossErrorCode,
      };
      videoAdapter.updateVideoShotStatus(taskId, index, {
        lifecycle: crossQa.pass ? 'qa_passed' : 'qa_failed', cross_shot_qa_status: crossQa.pass ? 'passed' : 'failed',
        cross_shot_qa_problems: crossQa.problems || [], cross_shot_failure_dimensions: crossQa.failure_dimensions || [], cross_shot_failure_labels_zh: crossQa.failure_labels_zh || [],
        error: crossQa.pass ? '' : crossError, error_code: crossQa.pass ? '' : crossErrorCode, retryable: !crossQa.pass,
      }, shots.length);
      if (!crossQa.pass) {
        failures.push({ index, kind: 'cross_shot_qa', dimensions: crossQa.failure_dimensions || [], labels_zh: crossQa.failure_labels_zh || [], problems: crossQa.problems || [], retry_instruction: crossQa.retry_instruction || '', repairable: true });
        if (stopOnFailure) {
          storage.saveOutput(taskId, 'video_clips', clips);
          return failures;
        }
      }
    }
    storage.saveOutput(taskId, 'video_clips', clips);
    return failures;
  }
  const initialIndexes = [], pendingReviewIndexes = []; let pendingReviewFailures = [];
  const requestedOnlyIndex = options.only_index ?? options.onlyIndex;
  const requestedIndexes = Array.isArray(options.only_indexes || options.onlyIndexes)
    ? (options.only_indexes || options.onlyIndexes)
    : (requestedOnlyIndex !== null && requestedOnlyIndex !== undefined && Number.isInteger(Number(requestedOnlyIndex)) ? [Number(requestedOnlyIndex)] : []);
  const requestedIndexSet = requestedIndexes.length
    ? new Set(requestedIndexes.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < shots.length))
    : null;
  if (requestedIndexSet && !requestedIndexSet.size) {
    const error = new Error('指定的镜头序号无效，已停止生成以避免误生成全部镜头');
    error.code = 'VIDEO_SHOT_INDEX_INVALID';
    error.status = 422;
    throw error;
  }
  const forcedIndexSet = new Set((Array.isArray(options.force_regenerate_indexes || options.forceRegenerateIndexes)
    ? (options.force_regenerate_indexes || options.forceRegenerateIndexes)
    : []).map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < shots.length));
  shots.forEach((_, index) => {
    if (requestedIndexSet && !requestedIndexSet.has(index)) return;
    const planned = preflightShotActions.get(index) || {};
    if (zeroCostOnly && !['local_motion', 'review_only', 'transition_bridge', 'metadata_migration'].includes(planned.action)) return;
    if (planned.action === 'metadata_migration' && videoLineage.clipHasMediaFile(clips[index])) {
      clips[index] = videoLineage.attachLineage(clips[index], expectedLineages[index], { metadata_migrated_at: new Date().toISOString() });
      return;
    }
    if (['review_only', 'transition_bridge'].includes(planned.action)) {
      if (videoLineage.clipHasMediaFile(clips[index])) { clips[index] = videoLineage.adoptExpectedLineage(clips[index], expectedLineages[index], { lineage_adopted_at: new Date().toISOString(), adopted_before_boundary_review: true }); pendingReviewIndexes.push(index); }
      return;
    }
    if (planned.action === 'local_motion') {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    if (planned.action === 'reuse' && videoLineage.clipHasMediaFile(clips[index]) && videoLineage.qaApproved(clips[index])) {
      return;
    }
    if (planned.action === 'provider_generate' && videoLineage.clipHasMediaFile(clips[index]) && (planned.changes || []).length) {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    if (forceRegenerateAll || forcedIndexSet.has(index)) {
      initialIndexes.push(index);
      clips[index] = null;
      return;
    }
    const existingClip = clips[index] || {};
    const existingLineage = existingClip.lineage_fingerprint || existingClip.lineage?.fingerprint || '';
    const reviewExistingOnly = (options.missing_only === true || options.missingOnly === true)
      && videoLineage.clipHasMediaFile(existingClip)
      && existingLineage === expectedLineages[index].fingerprint
      && !videoLineage.qaApproved(existingClip);
    if (reviewExistingOnly) {
      pendingReviewIndexes.push(index);
      return;
    }
    const decision = videoLineage.reuseDecision(clips[index], expectedLineages[index]);
    if (decision.reusable) {
      if (decision.adopted) clips[index] = videoLineage.attachLineage(clips[index], expectedLineages[index], { lineage_adopted_at: new Date().toISOString() });
      return;
    }
    const reviewable = videoLineage.reviewableDecision(clips[index], expectedLineages[index]);
    if (reviewable.reviewable) {
      pendingReviewIndexes.push(index);
      return;
    }
    initialIndexes.push(index);
    clips[index] = null;
  });
  if (pendingReviewIndexes.length) {
    const pendingFailures = await reviewVideoIndexes(pendingReviewIndexes, 0); pendingReviewFailures = pendingFailures;
    const rejectedIndexes = new Set(pendingFailures.map(item => item.index));
    pendingReviewIndexes.forEach((index) => {
      if (!rejectedIndexes.has(index) && videoLineage.qaApproved(clips[index])) {
        clips[index] = videoLineage.adoptExpectedLineage(clips[index], expectedLineages[index], { lineage_adopted_at: new Date().toISOString(), recovered_before_regeneration: true });
        return;
      }
      if ((options.missing_only === true || options.missingOnly === true) && videoLineage.clipHasMediaFile(clips[index])) {
        return;
      }
      if (['review_only', 'transition_bridge'].includes(preflightShotActions.get(index)?.action)) return;
      initialIndexes.push(index);
      clips[index] = null;
    });
  }
  if (pendingReviewFailures.length) { initialIndexes.forEach(index => { clips[index] = previousClips[index] || clips[index] || null; }); initialIndexes.length = 0; }
  const expandedInitialIndexes = sceneBlockService.expandIndexesToBlocks(initialIndexes, sceneBlocks);
  expandedInitialIndexes.forEach(index => { clips[index] = null; });
  if (expandedInitialIndexes.length) storage.deleteOutput(taskId, 'final_video');
  // 付费视频禁止自动重试；失败后只能由用户查看新方案并再次明确确认。
  const maxRepairs = 0;
  const initialBlockIds = new Set(expandedInitialIndexes.map(index => sceneBlockService.blockForIndex(sceneBlocks, index)?.id).filter(Boolean));
  const initialVideoSeconds = sceneBlocks.filter(block => initialBlockIds.has(block.id)).reduce((sum, block) => sum + Number(block.duration_sec || 0), 0);
  const policy = {
    version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION, paid_execution_policy: paidExecutionPolicy.publicPolicy(),
    scene_block_policy_version: sceneBlockService.SCENE_BLOCK_POLICY_VERSION,
    model_route: pinnedRoute,
    max_auto_repairs: maxRepairs,
    scene_block_count: sceneBlocks.length,
    continuous_scene_block_count: sceneBlocks.filter(block => block.continuous).length,
    planned_initial_video_seconds: initialVideoSeconds,
    planned_max_auto_repair_seconds: initialVideoSeconds * maxRepairs,
    planned_max_video_seconds: initialVideoSeconds * (maxRepairs + 1),
    adopted_at: new Date().toISOString(),
  };
  storage.saveOutput(taskId, 'video_pipeline_policy', policy);
  storage.saveOutput(taskId, 'video_clips', clips);
  let targetIndexes = expandedInitialIndexes;
  let repairAttempt = 0;
  let repairInstructions = {};
  let lastGenerated = { provider_used: pinnedRoute, schedule: null };
  let qaFailures = pendingReviewFailures.slice();
  while (targetIndexes.length) {
    storage.updateTask(taskId, {
      status: 'running', stage: repairAttempt ? 'video_repair' : 'video', error: '', error_code: '', retryable: false,
      generation_progress: { ...(storage.getTask(taskId)?.generation_progress || {}), repair_attempt: repairAttempt, max_repair_attempts: maxRepairs, repair_indexes: targetIndexes.map(index => index + 1) },
    });
    targetIndexes = sceneBlockService.expandIndexesToBlocks(targetIndexes, sceneBlocks);
    const generationUnits = sceneBlocks.filter(block => block.member_indexes.some(index => targetIndexes.includes(index)));
    await videoSubmissionGate.runUnitsFailFast(generationUnits, async (unit, unitPosition, remainingUnits) => {
      const unitIndexes = unit.member_indexes.filter(index => targetIndexes.includes(index));
      const paidUnit = (preflightPlan.units || []).find(item => item.paid && (item.member_indexes || []).some(index => unitIndexes.includes(index)));
      const claimIndex = unitIndexes[0] ?? 0;
      const claimModel = videoAdapter.expectedModelForShot(generationShots[claimIndex] || {}, contracts[claimIndex] || {}, pinnedModel);
      const attemptClaims = paidUnit ? videoArtifactWorkflow.claimUnitAttempts({ ledger: videoAttemptLedger, taskId, indexes: unitIndexes, generationId: options.generation_id || options.generationId || task.active_generation_id || preflightPlan.fingerprint, lineages: expectedLineages, providerId: claimModel.provider_id, modelId: claimModel.model_id, costFingerprint: preflightPlan.cost_plan?.fingerprint || '' }) : [];
      let generationError = null;
      try {
        lastGenerated = await videoAdapter.generateSceneBlockVideos({
          taskId, shots: generationShots, keyframes, ttsAudio, contracts, ctx,
          sceneBlocks,
          options: {
            ...options,
            only_indexes: unitIndexes,
            _pinnedVideoModel: pinnedModel,
            _expectedLineages: expectedLineages,
            _repairInstructions: { ...(preflightPlan.repair_instructions || {}), ...repairInstructions }, _boundaryRepairContracts: preflightPlan.boundary_repair_contracts || {},
            _localMotionIndexes: [...localMotionIndexSet],
            _keyframeReferenceOnlyIndexes: preflightPlan.keyframe_reference_only_indexes || [], _keyframeFirstFrameOnlyIndexes: preflightPlan.keyframe_first_frame_only_indexes || [],
            _repairAttempt: repairAttempt,
          },
          existingClips: clips,
          onClip: async (clip, nextClips) => {
            storage.saveOutput(taskId, 'video_clips', nextClips);
            storage.saveStage(taskId, 'video', {
              status: 'running', input_summary: `${shots.length} shot videos`,
              output_summary: `${nextClips.filter(Boolean).length}/${shots.length} video clips`,
              diagnostics: { last_provider_used: clip.provider_used || '', repair_attempt: repairAttempt },
            });
          },
        });
        clips = lastGenerated.clips.slice();
        paidExecutionPolicy.assertBatchSucceeded(lastGenerated, clips, unitIndexes);
      } catch (error) {
        generationError = error;
        const partialClips = Array.isArray(error.partial_video_clips)
          ? error.partial_video_clips
          : storage.getOutput(taskId, 'video_clips');
        if (Array.isArray(partialClips)) clips = partialClips.slice();
      }
      const candidateReviewedIndexes = generationError && Array.isArray(generationError.completed_indexes)
        ? generationError.completed_indexes
        : unitIndexes;
      const reviewedIndexes = candidateReviewedIndexes.filter(index => videoLineage.clipHasUsableFile(clips[index]));
      const unitQaFailures = await reviewVideoIndexes(reviewedIndexes, repairAttempt, { stopOnFailure: true });
      qaFailures.push(...unitQaFailures);
      if (generationError) videoArtifactWorkflow.failUnitAttempts({ ledger: videoAttemptLedger, taskId, claims: attemptClaims, error: generationError, statusFor: index => videoAdapter.listVideoShotStatuses(taskId, shots.length)[index] || {} });
      else videoArtifactWorkflow.finishUnitAttempts({ ledger: videoAttemptLedger, taskId, claims: attemptClaims, clips, statusFor: index => videoAdapter.listVideoShotStatuses(taskId, shots.length)[index] || {} });
      if (generationError || unitQaFailures.length) {
        videoFailureRecovery.recordFailedCandidates({ storage, taskId, options, unitIndexes, clips, qaFailures: unitQaFailures });
        if (videoFailureRecovery.shouldRestoreUnitFailure({ generationError, unitIndexes, qaFailures: unitQaFailures })) videoFailureRecovery.restoreUnitFailure({ storage, videoAdapter, taskId, clips, previousClips, unitIndexes, remainingUnits, totalShots: shots.length });
        if (generationError) {
          videoCostAuthorization.transition(taskId, 'failed', { failure_code: generationError.code || 'VIDEO_PROVIDER_FAILED' });
          generationError.partial_video_clips = clips.slice();
          generationError.completed_indexes = reviewedIndexes;
          throw generationError;
        }
        return false;
      }
      return true;
    });
    if (!qaFailures.length) break;
    const plan = videoRepairPolicy.buildRepairPlan(qaFailures, { attempt: repairAttempt, maxAttempts: maxRepairs });
    const history = Array.isArray(storage.getOutput(taskId, 'video_repair_history')) ? storage.getOutput(taskId, 'video_repair_history') : [];
    history.push({
      attempt: repairAttempt, next_attempt: plan.next_attempt, max_attempts: maxRepairs,
      status: plan.can_retry ? 'retrying' : 'exhausted', indexes: plan.failures.map(item => item.index + 1),
      failures: plan.failures, policy_version: policy.version, recorded_at: new Date().toISOString(),
    });
    storage.saveOutput(taskId, 'video_repair_history', history.slice(-100));
    if (!plan.can_retry) break;
    repairAttempt = plan.next_attempt;
    targetIndexes = plan.indexes;
    repairInstructions = plan.instructions;
    storage.saveStage(taskId, 'video', {
      status: 'running', input_summary: `${shots.length} shot videos`,
      output_summary: `正在自动修复第 ${targetIndexes.map(index => index + 1).join('、')} 镜（${repairAttempt}/${maxRepairs}）`,
      diagnostics: { qa_failures: plan.failures, repair_attempt: repairAttempt, max_repair_attempts: maxRepairs },
    });
  }
  storage.saveOutput(taskId, 'video_clips', clips);
  if (qaFailures.length) {
    const mergedFailures = videoRepairPolicy.mergeFailures(qaFailures);
    storage.saveStage(taskId, 'video', { status: 'failed', output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips`, error: '视频审片未通过', diagnostics: { qa_failures: mergedFailures, repair_attempts_used: repairAttempt, max_repair_attempts: maxRepairs } });
    storage.updateTask(taskId, { status: 'failed', stage: 'video_failed', error: `部分镜头在 ${repairAttempt} 次自动修复后仍未通过视觉审核`, error_code: 'VIDEO_QA_FAILED', retryable: true });
    videoCostAuthorization.transition(taskId, 'failed', { failure_code: 'VIDEO_QA_FAILED' });
    const error = new Error('视频审片未通过：' + mergedFailures.map(item => `第 ${item.index + 1} 镜（${item.labels_zh.join('、') || '质量审核'}）`).join('；'));
    error.code = 'VIDEO_QA_FAILED'; error.retryable = true; error.video_clips = clips; error.qa_failures = mergedFailures;
    throw error;
  }
  const boundaryAudit = videoBoundaryPolicy.audit(clips, shots.length);
  const remainingUnapproved = [...new Set(shots.map((_, index) => index).filter(index => !videoLineage.qaApproved(clips[index] || {})).concat(boundaryAudit.unready_indexes))];
  if (remainingUnapproved.length) {
    storage.saveStage(taskId, 'video', {
      status: 'partial',
      output_summary: `${clips.filter(Boolean).length}/${shots.length} video clips；仍有 ${remainingUnapproved.length} 镜待处理`,
      diagnostics: { remaining_unapproved_indexes: remainingUnapproved.map(index => index + 1), policy_version: policy.version },
    });
    storage.updateTask(taskId, {
      status: 'failed', stage: 'video_failed',
      error: `仍有镜头需要生成、审核或人工处理：${remainingUnapproved.map(index => `第 ${index + 1} 镜`).join('、')}`,
      error_code: 'VIDEO_SHOTS_REMAINING', retryable: true,
    });
    return { video_clips: clips, partial: true, remaining_unapproved_indexes: remainingUnapproved };
  }
  storage.saveStage(taskId, 'video', {
    status: 'done',
    output_summary: `${clips.filter(Boolean).length} video clips`,
    diagnostics: { provider_used: lastGenerated.provider_used || pinnedRoute, schedule: lastGenerated.schedule || null, policy_version: policy.version, repair_attempts_used: repairAttempt },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'video_ready' });
  if (storage.getOutput(taskId, 'video_cost_authorization')?.status === 'authorized') videoCostAuthorization.transition(taskId, 'consumed');
  return { video_clips: clips };
}

function acceptVideoClipOverride(taskId, shotIndex, input = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const clips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips').slice() : [];
  const index = Number(shotIndex);
  const clip = clips[index];
  const hasFile = !!(clip && ((clip.file_path && fs.existsSync(clip.file_path)) || clip.video_url || clip.videoUrl));
  if (!Number.isInteger(index) || index < 0 || !shots[index] || !hasFile) {
    const error = new Error('要人工确认的镜头视频不存在或文件不可用');
    error.code = 'VIDEO_CLIP_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (!clip.lineage_fingerprint) {
    const error = new Error('该视频没有当前分镜版本来源记录，不能人工确认，请重新生成本镜视频');
    error.code = 'VIDEO_LINEAGE_REQUIRED';
    error.status = 422;
    throw error;
  }
  const manualAccept = videoQualityPolicy.manualAcceptDecision(clip);
  if (!manualAccept.allowed) {
    const error = new Error('该镜头存在身份、场景拓扑、动作承接或其他阻塞级质量问题，服务器禁止通过人工接受跳过。');
    error.code = 'VIDEO_MANUAL_ACCEPT_BLOCKED_P0';
    error.status = 409;
    error.retryable = false;
    error.details = manualAccept;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const reason = cleanText(input.reason || '用户已查看本镜视频并确认接受当前效果', 500);
  const acceptedBy = {
    id: cleanText(user.id || user.userId || '', 100),
    name: cleanText(user.name || user.username || user.nickname || '', 100),
    source: cleanText(input.source || 'story_ad_ui', 80),
  };
  const originalQa = clip.qa && typeof clip.qa === 'object' ? { ...clip.qa } : {};
  const manualAcceptance = {
    approved: true,
    accepted_at: acceptedAt,
    accepted_by: acceptedBy,
    reason,
    original_qa: originalQa,
    original_cross_shot_qa: clip.cross_shot_qa || null,
  };
  clips[index] = {
    ...clip,
    qa: {
      ...originalQa,
      pass: true,
      status: 'manual_accepted',
      manual_override: true,
      model_pass: originalQa.pass === true,
      decision_source: 'human_override',
      override_reason: reason,
      overridden_at: acceptedAt,
      overridden_by: acceptedBy,
    },
    cross_shot_qa: clip.cross_shot_qa?.pass === false
      ? { ...clip.cross_shot_qa, pass: true, status: 'manual_accepted', manual_override: true }
      : clip.cross_shot_qa,
    manual_acceptance: manualAcceptance,
    error: '',
    error_code: '',
  };
  storage.saveOutput(taskId, 'video_clips', clips);
  storage.deleteOutput(taskId, 'final_video');
  videoAdapter.updateVideoShotStatus(taskId, index, {
    lifecycle: 'qa_passed', qa_status: 'manual_accepted', manual_acceptance: manualAcceptance,
    error: '', error_code: '', retryable: false,
  }, shots.length);
  const remaining = shots.map((_, shot) => shot).filter(shot => !videoLineage.qaApproved(clips[shot] || {}));
  storage.saveStage(taskId, 'video', {
    status: remaining.length ? 'partial' : 'done',
    output_summary: remaining.length ? `人工接受第 ${index + 1} 镜；仍有 ${remaining.length} 镜待处理` : `${clips.length} video clips`,
    diagnostics: { manually_accepted_shot_index: index + 1, remaining_unapproved_indexes: remaining.map(shot => shot + 1) },
  });
  storage.updateTask(taskId, {
    status: remaining.length ? 'failed' : 'done',
    stage: remaining.length ? 'video_failed' : 'video_ready',
    error: remaining.length ? `仍有镜头待处理：${remaining.map(shot => `第 ${shot + 1} 镜`).join('、')}` : '',
    error_code: remaining.length ? 'VIDEO_SHOTS_REMAINING' : '',
    retryable: remaining.length > 0,
  });
  return { video_clip: clips[index], video_clips: clips, remaining_unapproved_indexes: remaining };
}

function finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate, options = {}) {
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const currentFingerprint = contracts[index]?.contract_fingerprint || '';
  const currentCompilerSignature = keyframeContractFreshness.signatureOf(contracts[index] || {});
  if (!currentFingerprint) {
    const error = new Error('当前镜头生成约束不存在，请先重新生成分镜合同');
    error.code = 'KEYFRAME_CONTRACT_REQUIRED';
    error.status = 422;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const generationId = cleanText(candidate.generation_id || frame.current_generation_id || '', 80);
  const manualAcceptance = options.manual_acceptance || null;
  const acceptedQa = options.qa || candidate.qa;
  const acceptedStatus = manualAcceptance ? 'manual_accepted' : 'accepted';
  const acceptedCandidate = {
    ...candidate,
    qa: acceptedQa,
    qa_policy_version: 2, contract_fingerprint: currentFingerprint,
    contract_compiler_signature: currentCompilerSignature,
    status: acceptedStatus,
    ...(manualAcceptance ? { manual_acceptance: manualAcceptance } : {}),
  };
  const candidates = (Array.isArray(frame.candidates) ? frame.candidates : []).map(item => (
    String(item.id) === String(candidate.id) ? acceptedCandidate : item
  ));
  keyframes[index] = {
    ...frame,
    candidates,
    image_url: candidate.image_url,
    imageUrl: candidate.image_url,
    qa: acceptedQa,
    qa_policy_version: 2,
    contract_fingerprint: currentFingerprint,
    contract_compiler_signature: currentCompilerSignature, contract_outdated: false,
    contract_outdated_reason: '',
    provider_used: candidate.provider_used || frame.provider_used,
    selected_candidate_id: candidate.id,
    error: '',
    error_code: '',
    regeneration_error: '',
    regeneration_error_code: '',
    regeneration_failed_at: '',
    current_generation_status: acceptedStatus,
    current_generation_id: generationId,
    manual_acceptance: manualAcceptance,
    accepted_revision: {
      generation_id: generationId,
      accepted_at: acceptedAt,
      qa_policy_version: 2,
      selected_candidate_id: candidate.id,
      decision_source: manualAcceptance ? 'human_override' : 'model_qa',
    },
    latest_attempt: { generation_id: generationId, status: acceptedStatus, selected_candidate_id: candidate.id, finished_at: acceptedAt },
  };
  storage.saveOutput(taskId, 'keyframes', keyframes);
  storage.deleteOutput(taskId, 'video_clips');
  storage.deleteOutput(taskId, 'final_video');
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const completion = keyframeCompletion(keyframes, shots);
  const allCurrent = completion.total > 0 && completion.fresh_pass === completion.total;
  storage.saveStage(taskId, 'keyframes', {
    status: allCurrent ? 'done' : 'partial',
    output_summary: `${completion.fresh_pass}/${completion.total} current keyframes verified`,
    diagnostics: {
      keyframe_status: completion,
      manually_selected_candidate: candidate.id,
      ...(manualAcceptance ? { human_override: { shot_index: index, ...manualAcceptance } } : {}),
    },
  });
  storage.updateTask(taskId, {
    status: allCurrent ? 'done' : 'failed',
    stage: allCurrent ? 'keyframes_ready' : 'keyframes_partial',
    error: allCurrent ? '' : '仍有镜头未通过当前版本视觉 QA',
    error_code: allCurrent ? '' : 'KEYFRAME_REGENERATION_REJECTED',
  });
  return { keyframe: keyframes[index], keyframes, completion };
}

function selectKeyframeCandidate(taskId, shotIndex, candidateId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  if (!frame) {
    const error = new Error('要选择候选图的镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = (Array.isArray(frame.candidates) ? frame.candidates : []).find(item => String(item.id) === String(candidateId));
  if (!candidate) {
    const error = new Error('候选关键帧不存在');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (candidate.qa?.pass !== true || candidate.status === 'rejected') {
    const error = new Error('该候选未通过场景、人物或产品一致性 QA，不能设为正式关键帧');
    error.code = 'KEYFRAME_CANDIDATE_NOT_ACCEPTABLE';
    error.status = 422;
    throw error;
  }
  if (Number(candidate.qa_policy_version || 0) < 2) {
    const error = new Error('该候选使用旧版视觉 QA，不能直接设为正式关键帧，请重新生成后再选择');
    error.code = 'KEYFRAME_CANDIDATE_QA_OUTDATED';
    error.status = 422;
    throw error;
  }
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  if (!keyframeContractFreshness.artifactMatchesContract(candidate, contracts[index] || {})) {
    const error = new Error('该候选与当前镜头信息或生成约束不一致，请重新生成本镜头');
    error.code = 'KEYFRAME_CANDIDATE_CONTRACT_OUTDATED';
    error.status = 422;
    throw error;
  }
  return finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate);
}

function acceptKeyframeCandidateOverride(taskId, shotIndex, candidateId, input = {}, user = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  if (!frame) {
    const error = new Error('要人工确认的镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = (Array.isArray(frame.candidates) ? frame.candidates : []).find(item => String(item.id) === String(candidateId));
  if (!candidate || !keyframeImageUrl(candidate) || !localKeyframeAssetExists(keyframeImageUrl(candidate))) {
    const error = new Error('候选关键帧不存在或图片文件不可用');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const currentFingerprint = cleanText(contracts[index]?.contract_fingerprint || '', 160);
  if (!currentFingerprint) {
    const error = new Error('当前镜头生成约束不存在，不能人工确认');
    error.code = 'KEYFRAME_CONTRACT_REQUIRED';
    error.status = 422;
    throw error;
  }
  const acceptedAt = new Date().toISOString();
  const reason = cleanText(input.reason || '用户确认当前画面符合创作意图', 500);
  const acceptedBy = {
    id: cleanText(user.id || user.userId || '', 100),
    name: cleanText(user.name || user.username || user.nickname || '', 100),
    source: cleanText(input.source || 'story_ad_ui', 80),
  };
  const originalQa = candidate.qa && typeof candidate.qa === 'object' ? { ...candidate.qa } : {};
  const manualAcceptance = {
    accepted_at: acceptedAt,
    accepted_by: acceptedBy,
    reason,
    original_status: cleanText(candidate.status || '', 80),
    original_qa: originalQa,
    previous_contract_fingerprint: cleanText(candidate.contract_fingerprint || '', 160),
    current_contract_fingerprint: currentFingerprint,
  };
  const qa = {
    ...originalQa,
    pass: true,
    status: 'manual_accepted',
    manual_override: true,
    model_pass: originalQa.pass === true,
    decision_source: 'human_override',
    override_reason: reason,
    overridden_at: acceptedAt,
    overridden_by: acceptedBy,
  };
  return finalizeKeyframeCandidateAcceptance(taskId, index, keyframes, frame, candidate, {
    qa,
    manual_acceptance: manualAcceptance,
  });
}

async function retryKeyframeCandidateQa(taskId, shotIndex, candidateId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const keyframes = Array.isArray(storage.getOutput(taskId, 'keyframes')) ? storage.getOutput(taskId, 'keyframes').slice() : [];
  const shots = Array.isArray(storage.getOutput(taskId, 'storyboard_table')) ? storage.getOutput(taskId, 'storyboard_table') : [];
  const contracts = Array.isArray(storage.getOutput(taskId, 'keyframe_contracts')) ? storage.getOutput(taskId, 'keyframe_contracts') : [];
  const index = Math.max(0, Number(shotIndex) || 0);
  const frame = keyframes[index];
  const shot = shots[index];
  const contract = contracts[index] || {};
  if (!frame || !shot) {
    const error = new Error('要重新验证的候选镜头不存在');
    error.code = 'KEYFRAME_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidates = Array.isArray(frame.candidates) ? frame.candidates.slice() : [];
  const candidateIndex = candidates.findIndex(item => String(item.id) === String(candidateId));
  if (candidateIndex < 0) {
    const error = new Error('要重新验证的候选关键帧不存在');
    error.code = 'KEYFRAME_CANDIDATE_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const candidate = candidates[candidateIndex];
  if (!keyframeContractFreshness.artifactMatchesContract(candidate, contract)) {
    const error = new Error('该候选与当前镜头设置不一致，不能重新验证');
    error.code = 'KEYFRAME_CANDIDATE_CONTRACT_OUTDATED';
    error.status = 422;
    throw error;
  }
  const reviewStartedAt = Date.parse(candidate.qa_review_started_at || 0) || 0;
  if (candidate.status === 'qa_reviewing' && Date.now() - reviewStartedAt < 10 * 60 * 1000) {
    const error = new Error('该候选正在重新验证，请勿重复提交');
    error.code = 'KEYFRAME_CANDIDATE_QA_IN_PROGRESS';
    error.status = 409;
    throw error;
  }

  const baseCtx = storage.getOutput(taskId, 'context') || task.request || {};
  const sceneAssets = storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const ctx = { ...baseCtx, scene_assets: Array.isArray(sceneAssets) ? sceneAssets : [] };
  const sceneAsset = sceneAssetForShot(ctx, shot, index);
  const qaHistory = Array.isArray(candidate.qa_history) ? candidate.qa_history.slice(-4) : [];
  if (candidate.qa && !['reviewing', 'unavailable'].includes(String(candidate.qa.status || ''))) {
    qaHistory.push(candidate.qa);
  }
  const reusableQa = [...qaHistory].reverse().find(item => {
    const scene = item?.scene || {};
    return ['scene_consistency_score', 'anchor_consistency_score', 'camera_match_score', 'material_match_score']
      .every(field => Number.isFinite(Number(scene[field])));
  });
  if (reusableQa) {
    const reclassifiedSceneQa = sceneSpace.normalizeKeyframeQa(reusableQa.scene || {});
    const reclassifiedQa = combineKeyframeQa({
      ctx,
      shot,
      contract,
      sceneReference: selectedSceneReference(sceneAsset, contract, shot),
      sceneQa: reclassifiedSceneQa,
      personQa: reusableQa.person || {},
      productQa: reusableQa.product || {},
    });
    if (reclassifiedQa.pass) {
      candidates[candidateIndex] = {
        ...candidate,
        qa: { ...reclassifiedQa, reused_structured_review: true, reclassified_at: new Date().toISOString() },
        qa_history: qaHistory.slice(-5),
        status: 'accepted',
        qa_policy_version: 2,
        qa_reviewed_at: new Date().toISOString(),
      };
      keyframes[index] = {
        ...frame,
        candidates,
        current_generation_status: 'accepted',
        regeneration_error: '',
        regeneration_error_code: '',
      };
      storage.saveOutput(taskId, 'keyframes', keyframes);
      const selected = selectKeyframeCandidate(taskId, index, candidate.id);
      return {
        ...selected,
        status: 'accepted',
        qa: candidates[candidateIndex].qa,
        media_generated: false,
        vision_review_reused: true,
      };
    }
  }
  const startedAt = new Date().toISOString();
  candidates[candidateIndex] = {
    ...candidate,
    qa_history: qaHistory.slice(-5),
    status: 'qa_reviewing',
    qa_review_started_at: startedAt,
    qa: { ...(candidate.qa || {}), pass: false, status: 'reviewing', error: '' },
  };
  keyframes[index] = {
    ...frame,
    candidates,
    current_generation_status: 'qa_reviewing',
    regeneration_error: '',
    regeneration_error_code: '',
  };
  storage.saveOutput(taskId, 'keyframes', keyframes);

  try {
    const reviewed = await runKeyframeQaReviews({
      taskId,
      ctx,
      shot,
      contract,
      sceneAsset,
      generatedUrl: candidate.image_url || candidate.imageUrl || '',
    });
    const qa = combineKeyframeQa({
      ctx,
      shot,
      contract,
      sceneReference: reviewed.sceneReference,
      sceneQa: reviewed.sceneQa,
      personQa: reviewed.personQa,
      productQa: reviewed.productQa,
    });
    const status = qa.pass ? 'accepted' : 'rejected';
    candidates[candidateIndex] = {
      ...candidate,
      qa,
      qa_history: qaHistory.slice(-5),
      status,
      qa_policy_version: 2,
      qa_review_started_at: startedAt,
      qa_reviewed_at: new Date().toISOString(),
    };
    keyframes[index] = {
      ...frame,
      candidates,
      current_generation_status: qa.pass ? 'accepted' : 'rejected',
      regeneration_error: qa.pass ? '' : `视觉 QA 未通过：${qa.mismatch_reasons.join('；') || '画面与当前合同不一致'}`,
      regeneration_error_code: qa.pass ? '' : 'KEYFRAME_CANDIDATE_QA_REJECTED',
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    if (qa.pass) {
      const selected = selectKeyframeCandidate(taskId, index, candidate.id);
      return { ...selected, status: 'accepted', qa, media_generated: false };
    }
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `shot ${index + 1} existing candidate QA rejected`,
      diagnostics: { candidate_id: candidate.id, qa_retry_only: true, media_generated: false, qa },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', retryable: true });
    return { status: 'rejected', qa, keyframe: keyframes[index], keyframes, media_generated: false };
  } catch (error) {
    const unavailable = isQaInfrastructureError(error);
    const qa = { pass: false, status: unavailable ? 'unavailable' : 'failed', error: String(error.message || error), checked_at: new Date().toISOString() };
    candidates[candidateIndex] = {
      ...candidate,
      qa,
      qa_history: qaHistory.slice(-5),
      status: unavailable ? 'qa_unavailable' : 'rejected',
      qa_policy_version: 2,
      qa_review_started_at: startedAt,
      qa_reviewed_at: new Date().toISOString(),
    };
    keyframes[index] = {
      ...frame,
      candidates,
      current_generation_status: unavailable ? 'qa_unavailable' : 'rejected',
      regeneration_error: String(error.message || error),
      regeneration_error_code: unavailable ? 'VISION_QA_UNAVAILABLE' : (error.code || 'KEYFRAME_CANDIDATE_QA_FAILED'),
    };
    storage.saveOutput(taskId, 'keyframes', keyframes);
    storage.saveStage(taskId, 'keyframes', {
      status: 'partial',
      output_summary: `shot ${index + 1} existing candidate QA unavailable`,
      diagnostics: { candidate_id: candidate.id, qa_retry_only: true, media_generated: false, error: qa.error, error_code: error.code || '' },
    });
    storage.updateTask(taskId, { status: 'working', stage: 'keyframes_partial', error: '', error_code: '', retryable: true });
    return { status: unavailable ? 'qa_unavailable' : 'rejected', qa, keyframe: keyframes[index], keyframes, media_generated: false, retryable: unavailable };
  }
}

function subtitleTextFromShot(shot = {}) {
  return cleanText(
    shot.voiceover || shot.narration || shot.dialogue || shot.ad_copy || shot.copy || shot.subtitle || '',
    260
  ).replace(/^(字幕|旁白|台词)\s*[：:]\s*/i, '');
}

function subtitleSegmentsFromShots(shots = [], subtitleConfig = {}) {
  const config = typeof subtitleConfig === 'string' ? { style: subtitleConfig } : (subtitleConfig || {});
  const subtitleStyle = cleanText(config.style || config.subtitleStyle || 'popup', 60);
  const fontName = cleanText(config.fontName || '', 80);
  const fontSize = Math.max(24, Math.min(120, Number(config.fontSize) || 72));
  const color = /^#[0-9a-f]{6}$/i.test(String(config.color || '')) ? String(config.color) : '';
  const outlineColor = /^#[0-9a-f]{6}$/i.test(String(config.outlineColor || '')) ? String(config.outlineColor) : '';
  let cursor = 0;
  return (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const duration = Math.max(1, Math.min(30, Number(shot.duration_sec || shot.duration || shot.seconds || 3) || 3));
    const text = subtitleTextFromShot(shot);
    const segment = text ? {
      text,
      startTime: cursor,
      endTime: cursor + duration,
      preset: 'subtitle',
      style: 'subtitle',
      subtitleStyle,
      smartEmphasis: config.smartEmphasis !== false,
      ...(fontName ? { fontName } : {}),
      fontSize,
      ...(color ? { fontcolor: color } : {}),
      ...(outlineColor ? { bordercolor: outlineColor } : {}),
      shot_index: index + 1,
    } : null;
    cursor += duration;
    return segment;
  }).filter(Boolean);
}

async function composeStage(taskId, options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  let ctx = storage.getOutput(taskId, 'context') || task.request || {};
  const shots = await ensureStoryboardForMedia(taskId);
  // Composition must never generate visual clips. Step 4 owns storyboard video
  // generation and review; step 5 only mixes optional audio/effects and joins
  // the already-approved clips.
  const storedComposeClips = Array.isArray(storage.getOutput(taskId, 'video_clips')) ? storage.getOutput(taskId, 'video_clips') : [], composeStatuses = videoAdapter.listVideoShotStatuses(taskId, shots.length), clips = videoClipStatusRecovery.recover(storedComposeClips, composeStatuses);
  const composeSceneAssets = storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || [], composeContracts = keyframeContractFreshness.inspect(taskId, { ctx: { ...ctx, scene_assets: composeSceneAssets }, shots }).contracts;
  const composeKeyframes = storage.getOutput(taskId, 'keyframes') || [], composeBlueprint = storage.getOutput(taskId, 'blueprint') || {}, composeStoryboardMeta = storage.getOutput(taskId, 'storyboard_meta') || {}, composeTts = storage.getOutput(taskId, 'tts_audio') || {}, composeAudioTracks = Array.isArray(composeTts?.tracks) ? composeTts.tracks : (Array.isArray(composeTts) ? composeTts : []);
  const composeSceneBlocks = storage.getOutput(taskId, 'video_scene_blocks') || [], composeModelRoute = String(clips.find(clip => clip?.provider_used)?.provider_used || '').toLowerCase();
  const missingLipSync = shots.map((shot, index) => videoAdapter.explicitShotSpeechMode(shot, composeContracts[index] || {}) === 'on_camera_dialogue' && clips[index]?.lip_sync_applied !== true ? index + 1 : 0).filter(Boolean);
  if (missingLipSync.length) {
    const error = new Error(`第 ${missingLipSync.join('、')} 镜包含出镜对白但未完成逐字口型同步，禁止合成成片`);
    error.code = 'COMPOSE_LIP_SYNC_REQUIRED'; error.retryable = true; throw error;
  }
  const composeExpectedLineages = videoArtifactWorkflow.buildExpectedLineages({ shots, contracts: composeContracts, keyframes: composeKeyframes, ctx, blueprint: composeBlueprint, storyboardMeta: composeStoryboardMeta, modelRoute: composeModelRoute, modelRouteFor: (_shot, _contract, index) => String(clips[index]?.provider_used || composeModelRoute).toLowerCase(), audioTracks: composeAudioTracks, sceneBlocks: composeSceneBlocks, shotPlans: clips.map((clip, index) => ({ index, input_strategy: videoArtifactCompatibility.inputStrategy(clip), boundary_repair: { fingerprint: clip?.boundary_repair_fingerprint || clip?.lineage?.boundary_repair_fingerprint || '' }, transition_override: clip?.transition_override || '' })), qaPolicyVersion: videoFrameQa.VIDEO_FRAME_QA_POLICY_VERSION, speechModeFor: (shot, contract) => videoAdapter.explicitShotSpeechMode(shot, contract), motionPromptFor: (shot, contract, index) => clips[index]?.motion_prompt || videoAdapter.clipPrompt(shot, ctx, contract, index > 0 ? shots[index - 1] : null, composeKeyframes[index] || {}, '') });
  const composeCompatibility = videoComposeCompatibility.buildReport({ clips, statuses: composeStatuses, expectedLineages: composeExpectedLineages });
  videoArtifactWorkflow.assertComposeCompatible(composeCompatibility);
  const boundaryAudit = videoBoundaryPolicy.audit(clips, shots.length); if (!boundaryAudit.ready) { const failed = boundaryAudit.failed_indexes.length > 0;
    const error = new Error(`当前版本仍有跨生成单元衔接审核${failed ? '未通过' : '未完成'}：${boundaryAudit.unready_indexes.map(index => `第 ${index}→${index + 1} 镜`).join('、')}`);
    error.code = failed ? 'COMPOSE_BOUNDARY_QA_FAILED' : 'COMPOSE_BOUNDARY_QA_INCOMPLETE'; error.retryable = true;
    throw error;
  }
  const unapproved = shots.map((_, index) => index).filter(index => (
    !videoLineage.clipHasUsableFile(clips[index]) || !videoLineage.qaApproved(clips[index]) || !clips[index]?.lineage_fingerprint
  ));
  if (unapproved.length) {
    const error = new Error(`当前版本仍有未审片或来源不匹配的镜头：${unapproved.map(index => `第 ${index + 1} 镜`).join('、')}`);
    error.code = 'COMPOSE_CLIP_LINEAGE_INVALID';
    error.retryable = true;
    throw error;
  }
  storage.deleteOutput(taskId, 'final_video');
  const composeGenerationId = cleanText(options.generation_id || options.generationId || '', 80);
  const composeStartedAt = new Date().toISOString();
  stageProgress.update(taskId, { stage: 'compose', phase: 'audio_preparing', completed: 0, total: 3, generationId: composeGenerationId, startedAt: composeStartedAt, message: '正在检查配音、音乐和字幕配置' });
  let ttsAudio = storage.getOutput(taskId, 'tts_audio') || {};
  const composeVoiceId = resolveTtsVoiceId(options, ctx, ttsAudio);
  const composeVoiceAssignments = voicePlan.resolveVoiceAssignments(options, ctx, ttsAudio, composeVoiceId);
  const includeVoiceover = voicePlan.voiceoverEnabled(options, ctx, composeVoiceId, composeVoiceAssignments);
  if (includeVoiceover && !ttsAdapter.voiceoverReady(ttsAudio, shots, composeVoiceId, composeVoiceAssignments)) {
    const generatedTts = await generateTtsStage(taskId, options);
    ttsAudio = generatedTts.tts_audio;
    ctx = storage.getOutput(taskId, 'context') || ctx;
  } else if (!includeVoiceover) {
    ttsAudio = silentTtsOutput();
    storage.saveOutput(taskId, 'tts_audio', ttsAudio);
  }
  stageProgress.update(taskId, { stage: 'compose', phase: 'audio_ready', completed: 1, total: 3, generationId: composeGenerationId, startedAt: composeStartedAt, message: '音频配置已就绪，正在准备成片时间线' });
  storage.updateTask(taskId, {
    status: 'running',
    stage: 'compose',
  });
  storage.saveStage(taskId, 'compose', { status: 'running', input_summary: `${clips.length} clips` });
  const subtitleEnabled = Object.prototype.hasOwnProperty.call(options, 'subtitle')
    ? options.subtitle !== false
    : ctx.subtitle !== false;
  const subtitleStyle = cleanText(options.subtitle_style || options.subtitleStyle || ctx.subtitle_style || ctx.subtitleStyle || 'popup', 60);
  const rawSubtitleConfig = options.subtitle_config || options.subtitleConfig || ctx.subtitle_config || ctx.subtitleConfig || {};
  const subtitleConfig = {
    ...(rawSubtitleConfig && typeof rawSubtitleConfig === 'object' ? rawSubtitleConfig : {}),
    show: subtitleEnabled,
    style: subtitleStyle,
  };
  const hasBgmAssetOption = Object.prototype.hasOwnProperty.call(options, 'bgm_asset')
    || Object.prototype.hasOwnProperty.call(options, 'bgmAsset');
  const bgmAsset = hasBgmAssetOption
    ? (options.bgm_asset ?? options.bgmAsset ?? null)
    : (ctx.bgm_asset || ctx.bgmAsset || null);
  const brandOverlay = options.brand_overlay || options.brandOverlay || ctx.brand_overlay || ctx.brandOverlay || { enabled: false };
  const composeVoiceName = Object.prototype.hasOwnProperty.call(options, 'voice_name')
    || Object.prototype.hasOwnProperty.call(options, 'voiceName')
    ? cleanText(options.voice_name ?? options.voiceName ?? '', 120)
    : cleanText(ctx.voice_name || ctx.voiceName || '', 120);
  storage.saveOutput(taskId, 'context', {
    ...ctx,
    voice_id: composeVoiceId,
    voice_name: composeVoiceName,
    include_voiceover: includeVoiceover,
    voice_volume: options.voice_volume ?? options.voiceVolume ?? ctx.voice_volume ?? ctx.voiceVolume ?? 1,
    bgm_volume: options.bgm_volume ?? options.bgmVolume ?? ctx.bgm_volume ?? ctx.bgmVolume ?? 0.16,
    bgm_profile: cleanText(options.bgm_profile || options.bgmProfile || ctx.bgm_profile || ctx.bgmProfile || 'auto', 60),
    bgm_asset: bgmAsset,
    brand_overlay: brandOverlay,
    subtitle: subtitleEnabled,
    subtitle_style: subtitleStyle,
    subtitle_config: subtitleConfig,
  });
  stageProgress.update(taskId, { stage: 'compose', phase: 'timeline_ready', completed: 2, total: 3, generationId: composeGenerationId, startedAt: composeStartedAt, message: '成片时间线已确认，正在封装最终视频' });
  const advertisedSubjectProofCoverage = productIdentity.assertProofCoverage(ctx, shots, clips);
  const final_video = await composeService.concatVideos({
    taskId,
    clips,
    ttsAudio,
    bgmAsset,
    bgmVolume: options.bgm_volume ?? options.bgmVolume ?? ctx.bgm_volume ?? ctx.bgmVolume ?? 0.16,
    voiceVolume: options.voice_volume ?? options.voiceVolume ?? ctx.voice_volume ?? ctx.voiceVolume ?? 1,
    subtitles: subtitleSegmentsFromShots(shots, subtitleConfig),
    subtitleEnabled,
    subtitleStyle,
    transitions: shots,
    brandOverlay,
    targetDurationSec: ctx.target_duration,
  });
  const finalVideoWithLineage = {
    ...final_video,
    advertised_subject_proof_coverage: advertisedSubjectProofCoverage,
    pipeline_policy_version: videoLineage.VIDEO_PIPELINE_POLICY_VERSION,
    clip_lineage_fingerprints: clips.map(clip => clip.lineage_fingerprint),
    scene_blocks: [...new Map(clips.filter(clip => clip.scene_block_id).map(clip => [clip.scene_block_id, {
      id: clip.scene_block_id,
      fingerprint: clip.scene_block_fingerprint || '',
      members: clip.scene_block_members || [],
    }])).values()],
  };
  storage.saveOutput(taskId, 'final_video', finalVideoWithLineage);
  storage.saveStage(taskId, 'compose', {
    status: 'done',
    output_summary: `final video from ${final_video.clip_count || clips.length} clips`,
    diagnostics: { provider_used: final_video.provider_used || '' },
  });
  storage.updateTask(taskId, { status: 'done', stage: 'final_video_ready' });
  stageProgress.update(taskId, { stage: 'compose', status: 'done', phase: 'persisted', completed: 3, total: 3, generationId: composeGenerationId, startedAt: composeStartedAt, message: '最终成片已完成并保存' });
  return { final_video: finalVideoWithLineage, video_clips: clips };
}

async function runFull(body = {}, user = {}) {
  const { task, context } = createTask(body, user);
  try {
    const scene_config = await generateSceneConfig(task.id);
    const blueprint = await generateBlueprintStage(task.id);
    const storyboard = await generateStoryboardStage(task.id);
    return {
      success: true,
      task_id: task.id,
      task: storage.getTask(task.id),
      context,
      scene_config,
      blueprint,
      ...storyboard,
      bundle: publicTaskBundle(task.id),
    };
  } catch (err) {
    const message = String(err.message || err);
    storage.updateTask(task.id, { status: 'failed', error: message, stage: 'failed' });
    return {
      success: false,
      task_id: task.id,
      error: message,
      review: err.review || null,
      partial: err.partial || null,
      bundle: publicTaskBundle(task.id),
    };
  }
}
function modelHealth() {
  return storage.readHealth();
}
const ASSISTED_SHOT_ENUMS = {
  shot_size: ['', 'extreme_wide', 'wide', 'full', 'medium', 'medium_close', 'close_up', 'extreme_close_up', 'macro'],
  camera_angle: ['', 'eye_level', 'high_angle', 'low_angle', 'overhead', 'dutch', 'over_shoulder', 'pov'],
  depth_of_field: ['', 'deep', 'medium', 'shallow', 'ultra_shallow'],
  transition_type: ['none', 'hard_cut', 'cut_on_action', 'match_cut', 'dissolve', 'fade'],
};
function normalizeAssistedShotSettings(input = {}, current = {}) {
  const source = input?.shot_settings || input?.shotSettings || input || {};
  const existing = current && typeof current === 'object' ? current : {};
  const textValue = (key, aliases = [], max = 500) => {
    const keys = [key, ...aliases];
    const explicit = keys.find(name => Object.prototype.hasOwnProperty.call(source, name));
    const raw = explicit ? source[explicit] : keys.map(name => existing[name]).find(value => value !== undefined && value !== null);
    return cleanText(typeof raw === 'object' ? shotDesign.structuredText(raw, max) : raw || '', max);
  };
  const enumValue = (key, fallback = '') => {
    const allowed = ASSISTED_SHOT_ENUMS[key] || [];
    const requested = cleanText(source[key] ?? existing[key] ?? fallback, 60);
    return allowed.includes(requested) ? requested : (allowed.includes(existing[key]) ? existing[key] : fallback);
  };
  // scene_view 来自当前任务的场景资产，必须保留开放 ID，不能套用固定四镜位枚举。
  const openSceneView = cleanText(source.scene_view ?? source.sceneView ?? existing.scene_view ?? '', 40);
  const design = shotDesign.normalizeShotDesign({
    shot_scope: source.shot_scope ?? source.shotScope ?? existing.shot_scope ?? existing.shotScope,
    surface_topology: source.surface_topology ?? source.surfaceTopology ?? existing.surface_topology ?? existing.surfaceTopology,
    motion_effect: source.motion_effect ?? source.motionEffect ?? existing.motion_effect ?? existing.motionEffect,
  });
  const surface = design.surface_topology || { mode: 'auto', seam_policy: 'auto', finish_distribution: 'auto', notes: '' };
  const motion = design.motion_effect || { type: 'none', source_state: '', target_state: '', timeline: '', intensity: 'medium', preserve_scene_geometry: true, reference_asset_id: '', notes: '' };
  const requestedLens = Number(source.lens_mm ?? source.lensMm ?? existing.lens_mm ?? existing.lensMm ?? 0);
  return {
    visual: textValue('visual', ['visual_description', 'content_prompt'], 1800),
    action: textValue('action', ['visual_action'], 900),
    voiceover: textValue('voiceover', ['narration', 'subtitle'], 600),
    purpose: textValue('purpose', ['objective', 'role'], 500),
    shot_scope: design.shot_scope || 'auto',
    surface_topology: surface,
    motion_effect: motion,
    scene_view: openSceneView,
    scene_zone: textValue('scene_zone', ['scene_zone_label_zh'], 180),
    shot_size: enumValue('shot_size', ''),
    camera_angle: enumValue('camera_angle', ''),
    lens_mm: requestedLens > 0 ? Math.max(1, Math.min(300, Math.round(requestedLens))) : '',
    depth_of_field: enumValue('depth_of_field', ''),
    composition: textValue('composition', [], 320),
    subject_position: textValue('subject_position', [], 180),
    camera_movement: textValue('camera_movement', [], 220),
    entry_frame_state: textValue('entry_frame_state', [], 500),
    exit_frame_state: textValue('exit_frame_state', [], 500),
    screen_direction: textValue('screen_direction', [], 160),
    eyeline: textValue('eyeline', [], 160),
    camera_axis: textValue('camera_axis', [], 160),
    object_states: textValue('object_states', [], 360),
    transition_type: enumValue('transition_type', 'none'),
    transition_reason: textValue('transition_reason', [], 280),
    ambient_sound: textValue('ambient_sound', [], 240),
    sfx: textValue('sfx', [], 240),
    music_cue: textValue('music_cue', [], 240),
    voiceover_timing: textValue('voiceover_timing', [], 280),
    audio_bridge: textValue('audio_bridge', [], 240),
  };
}

async function assistBrief(body = {}, user = {}) {
  const ctx = buildContext(body, user);
  const mode = cleanText(body.mode || body.assist_mode || 'write', 20);
  const taskId = cleanText(body.task_id || body.taskId || '', 80);
  if (briefDialogueAssist.isMode(mode)) return briefDialogueAssist.run({ body, modelGateway, taskId });
  const isStyleControl = mode === 'style_control' || mode === 'style', isNegativeControl = mode === 'negative_control' || mode === 'negative';
  const isCreativeDirection = mode === 'creative_direction' || mode === 'creative';
  const isPersonSpec = mode === 'person_spec' || mode === 'person';
  const isSceneSpec = mode === 'scene_spec' || mode === 'scene', isSceneExperience = mode === 'scene_experience' || mode === 'experience';
  const isShotSettings = mode === 'shot_settings' || mode === 'shot', isStoryBeat = mode === 'story_beat' || mode === 'beat';
  const isBriefGoal = briefGoalAssist.isMode(mode);
  if (isBriefGoal) briefGoalAssist.assertInput(body, ctx);
  const hasAssistSubjectTarget = !!(body.assist_subject_target || body.assistSubjectTarget);
  const assistSubjectTarget = isPersonSpec ? assistSubjectProfiles.resolveAssistSubjectTarget(body, ctx) : null;
  if (isPersonSpec && hasAssistSubjectTarget && !assistSubjectTarget) { const error = new Error('单人物辅助补齐目标无效；没有调用文本模型'); error.code = 'ASSIST_SUBJECT_TARGET_INVALID'; error.status = 400; throw error; }
  const assistReplaceableFields = assistSubjectTarget
    ? assistSubjectProfiles.resolveReplaceableFields(body, assistSubjectTarget)
    : [];
  if (assistSubjectTarget && !assistReplaceableFields.length) {
    const error = new Error('该人物没有可由 AI 完善的字段；没有调用文本模型');
    error.code = 'ASSIST_PERSON_PROFILE_NOTHING_TO_COMPLETE';
    error.status = 409;
    throw error;
  }
  const currentScenePlan = isSceneSpec ? normalizeScenePlan(body.scene_plan || body.scenePlan || body.scene_config || body.sceneConfig || {}) : { spaces: [] };
  const assistSceneTargetId = isSceneSpec ? cleanText(body.target_space_id || body.targetSpaceId || '', 100) : '';
  const preserveCurrentSceneFields = isSceneSpec && (body.preserve_current_scene_fields === true || body.preserveCurrentSceneFields === true);
  if (assistSceneTargetId && !currentScenePlan.spaces.some(space => space.id === assistSceneTargetId)) { const error = new Error('目标场景不在当前场景计划中；没有调用文本模型'); error.code = 'ASSIST_SCENE_TARGET_INVALID'; error.status = 400; throw error; }
  const assistPolicy = assistKnowledgePolicy.resolve({ storage, taskId, context: ctx, person: isPersonSpec, scene: isSceneSpec || isSceneExperience });
  const broadSystemPrompt = [
    isBriefGoal ? briefGoalAssist.assistantRole(ctx) : '你是剧情广告模块的广告需求整理助手。只输出 JSON 对象，不要 markdown。',
    isBriefGoal ? briefGoalAssist.taskRule(ctx) : '你的任务是把用户的一句话或零散信息整理成可直接生成商用剧情广告的需求表单。',
    '必须保持用户原始业务主体，不得编造未授权行业、人物、宠物、机器人或旧任务内容。',
    '当 mode 是 style_control 时，只补写画面风格方向，不要写剧本、分镜、卖点或执行步骤。',
    '当 mode 是 negative_control 时，只整理画面禁止项，每条都必须是明确不能出现的内容。',
    assistCreativeDirection.systemRule(),
    '当 mode 是 person_spec 时，必须先根据当前项目和该主体自身证据识别 subject_kind，不得沿用旧任务或其他主体的类型。human 必须补齐外貌体态、穿搭配饰、发型妆造和禁止项；robot 必须补齐尺寸比例、壳体结构与材质、关节驱动、传感器/面板/指示灯、挂载配件、机械动作与结构禁止项，不得要求机器人提供族裔或妆容。description、performanceText、动作、走位、触摸、驻足和“不介绍身份”只属于表演要求，绝不能复制或改写成 appearanceText。动物或人物+宠物模式还必须包含独立宠物数量、类型/品种和跨镜头识别特征。',
    '同一时代内的换装可保留为多个 look_profiles；同一姓名同时存在古代与现代、前世与今生等跨时代状态时，必须拆成独立人物档案，并分别命名为“人名（古代）”“人名（现代）”，人物数量随拆分结果增加。',
    isPersonSpec ? worldSetting.promptBlock(ctx.world_setting) : '',
    assistSubjectTarget ? 'person_spec 单人物辅助模式只能输出目标人物的一条 cast_profiles 记录，pet_profiles 必须为空；不得重写或评价其他人物与宠物。' : 'person_spec 模式还必须按精确人数输出 cast_profiles，并按精确宠物数量输出 pet_profiles。每个数组成员只能描述一个主体；禁止复制同一套外貌、服装、发型或宠物特征给不同成员。',
    `person_spec 四视图固定状态规则：${subjectContinuityPolicy.assistRuleZh()}`,
    '当 mode 是 scene_spec 时，只补齐场景空间设定字段，必须围绕当前广告需求，不得写死行业、城市、人物或旧任务场景。当存在 analysis_quality.valid=true 的参考视频合同且用户未改写广告需求时，scene_spec 必须逐字保留 source_facts.environment，并在布局或材质字段逐字保留 source_facts.product_or_service 或至少一项 source_facts.materials；不得改成书房、办公室或其它无证据空间。缺少这些证据时宁可返回失败，也不能猜场景。',
    'scene_spec 模式必须识别剧情实际发生的每个独立物理空间，并输出 scene_plan.spaces；两个地点不得合并进同一个 layoutText。',
    'scene_spec 必须原样保留用户提供的品牌名、专有材质名和工艺名，并把它们解释成当前任务明确支持的可观察颜色、纹理方向、反射、粗糙度、肌理和尺度；不得替换成通用近似材质。surfaceTopology.user_overrides 只能由前端记录用户亲自修改的高级选项，模型不得新增、猜测或改写该数组。',
    '当 mode 是 scene_experience 时，只完善当前场景的360或3D导演规划，不改写人物、场景或剧情。director_3d 是本地结构化导演预演，不等于真实6DoF；spatial_3d 必须明确需要深度、几何、可移动区域和遮挡验证。',
    visualRealismPolicy.sceneSpecRealismRuleZh(),
    '“一面墙、一整面墙、完整墙面”只表示主墙数量为 1，不等于无缝或隐藏拼缝；只有用户明确写出“连续、无缝、无接缝、隐藏拼缝”等要求时，才能输出 mode=continuous 或 seam_policy=hidden。当连续完整表面同时出现多个材质/工艺词时，默认合成为一种主导饰面语言；只有用户明确指定区域映射时才允许分区，禁止自动做成样板墙、条带或拼贴。',
    '当 mode 是 shot_settings 时，只优化当前任务的一个镜头设置；结合前后镜保证连续性，不得套用固定行业、场景、角色、墙面、商品或品牌模板。',
    'shot_settings 必须尊重用户补充和已有台词/卖点，不得编造功效、价格、资质或未经授权的画面元素；不确定的高级项使用 auto/none。',
    storyBeatAssist.systemRule(),
    briefGoalAssist.systemRule(ctx),
    isBriefGoal ? 'brief_goal 必须返回详细概述、出场人物或展示主体、主要场景、剧情段落与结尾；只到剧本层，不得提前输出分镜、镜号、机位或生成提示词。' : '如果是“write”，请补成完整广告需求；如果是“clean”，请只整理和补齐缺失字段，不改变用户核心意思。',
    isBriefGoal ? '各结构字段必须是给普通用户直接阅读的纯文本，不使用 Markdown 标题符号或字面量反斜杠换行；服务端会统一排成中文剧本格式。' : 'brief 必须是给普通用户直接阅读的纯文本：禁止 Markdown 星号/标题符号，禁止输出字面量 \\n、\\r 或 \\t。',
    isBriefGoal ? '' : 'brief 每个板块单独成段，统一使用“【广告主题】内容”“【核心故事线】内容”“【人物设定】内容”“【场景设定】内容”“【核心卖点】内容”“【画面风格】内容”等中文方括号标题；段落之间使用真实换行。',
    knowledgePolicyRuntime.promptBlock(assistPolicy || {}),
  ].join('\n');
  const systemPrompt = isBriefGoal ? briefGoalPrompt.systemPrompt(ctx, assistPolicy) : broadSystemPrompt;
  const outputSchema = isBriefGoal
    ? briefGoalAssist.outputSchema(ctx)
    : isCreativeDirection
    ? assistCreativeDirection.outputSchema()
    : isStyleControl
    ? `{
  "text": "只包含画面风格、光线、真实程度、镜头情绪和不能偏离的质感方向，80-180 字"
}`
    : isNegativeControl
      ? `{
  "text": "用分号分隔的禁止项，例如：不要出现无关人物；避免卡通质感；禁止商品变形"
}`
      : isPersonSpec
        ? assistSubjectProfiles.outputSchema()
      : isSceneExperience
        ? sceneExperienceAssist.outputSchema()
      : isSceneSpec
        ? assistScenePlan.outputSchema()
        : isStoryBeat
          ? storyBeatAssist.outputSchema()
        : isShotSettings
          ? `{
  "shot_settings": {
    "visual": "当前镜头完整画面说明",
    "action": "镜头内主体动作与变化",
    "voiceover": "保留或按明确要求微调的台词/旁白",
    "purpose": "本镜叙事或广告目的",
    "shot_scope": "开放的任务语义键；没有明确需要时写 auto，不得套行业模板",
    "surface_topology": {"mode":"开放任务语义键或 auto","seam_policy":"开放任务语义键或 auto","finish_distribution":"开放任务语义键或 auto","primary_surface_count":"明确数量或 null","secondary_surface_policy":"auto/forbidden/task_defined","notes":"当前任务证据支持的专属补充"},
    "motion_effect": {"type":"开放任务语义键或 none","source_state":"起始状态","target_state":"目标状态","timeline":"按本镜时长编写的时间轴","intensity":"low/medium/high","preserve_scene_geometry":true,"reference_asset_id":"已有素材 ID 或空","notes":"当前任务专属效果补充"},
    "scene_view": "从当前所选场景资产 available_views 中复制开放镜位 ID",
    "scene_zone": "使用当前任务已有空间区域，不编造新场景",
    "shot_size": "extreme_wide/wide/full/medium/medium_close/close_up/extreme_close_up/macro",
    "camera_angle": "eye_level/high_angle/low_angle/overhead/dutch/over_shoulder/pov",
    "lens_mm": 50,
    "depth_of_field": "deep/medium/shallow/ultra_shallow",
    "composition": "构图",
    "subject_position": "主体位置",
    "camera_movement": "镜头运动",
    "entry_frame_state": "承接上一镜的入镜状态",
    "exit_frame_state": "交给下一镜的出镜状态",
    "screen_direction": "运动方向",
    "eyeline": "人物视线或空",
    "camera_axis": "摄影轴线",
    "object_states": "商品/道具状态",
    "transition_type": "none/hard_cut/cut_on_action/match_cut/dissolve/fade",
    "transition_reason": "转场原因",
    "ambient_sound": "环境声",
    "sfx": "动作或物体音效",
    "music_cue": "音乐节点",
    "voiceover_timing": "旁白与动作时机",
    "audio_bridge": "跨镜声音桥"
  }
}`
          : `{
  "brief": "可直接放入广告需求文本框的完整纯文本；使用【标题】内容分段和真实换行；不要 Markdown；不要字面量反斜杠换行",
  "product_subject": "广告主体",
  "cast_mode": "auto/single/dual/multi/no_human/animal/human_pet",
  "shot_count": 0,
  "forbidden": ["禁止项"],
  "characters": [{"name":"角色名","role":"剧情职责","description":"简短说明"}]
}`;
  const shotAssistContext = isShotSettings ? {
    user_instruction: cleanText(body.user_instruction || body.instruction || '', 800),
    previous_shot: body.shot_assist_context?.previous_shot || body.previous_shot || null,
    current_shot: body.shot_assist_context?.current_shot || body.current_shot || body.shot || null,
    next_shot: body.shot_assist_context?.next_shot || body.next_shot || null,
    scene_assets: body.shot_assist_context?.scene_assets || body.scene_assets || [],
  } : null;
  const storyAssistContext = isStoryBeat ? storyBeatAssist.buildContext(body) : null, currentExperience = body.scene_experience || body.sceneExperience || body.experience_plan || body.experiencePlan || {};
  const userPrompt = `${contextPrompt(ctx)}
模式：${isBriefGoal ? briefGoalAssist.modePrompt(ctx) : isCreativeDirection ? 'creative_direction 剧情与表演要求辅写' : isStyleControl ? 'style_control 风格方向帮写' : isNegativeControl ? 'negative_control 禁止项帮写' : isPersonSpec ? 'person_spec 人物设定补齐' : isSceneSpec ? 'scene_spec 场景空间设定补齐' : isSceneExperience ? 'scene_experience 360/3D空间规划补齐' : isShotSettings ? 'shot_settings 当前镜头设置补齐' : isStoryBeat ? 'story_beat 当前情节点帮写' : mode === 'clean' ? 'clean 整理内容' : 'write 帮我写'}
${isPersonSpec ? `主体设定中用户已经明确选择的主体模式、数量、身份、姓名和其它事实是硬约束，必须原样保留。人类造型中帽子、眼镜、发带等发饰和首饰始终佩戴或始终不佩戴；机器人则对等锁定面板、传感器、指示灯和挂载件。${assistSubjectTarget ? `本次只完善目标人物：${JSON.stringify({ index: assistSubjectTarget.index, id: assistSubjectTarget.id, subject_kind: subjectProfileText.subjectKind(assistSubjectTarget.profile), current_profile: assistSubjectTarget.profile })}。允许生成或重写的字段只有：${assistReplaceableFields.join('、') || '无'}；必须使用该 subject_kind 的专用语义补齐；其余字段原样保留，不得返回或改写其他人物和宠物。` : '每个主体必须独立识别 subject_kind 并独立描述，不得共用一份全局模板。'}${subjectContinuityPolicy.assistRuleZh()}` : ''}
  ${isSceneSpec ? `当前用户场景设定是本次唯一内容权威：${JSON.stringify({ scene_spec: ctx.scene_spec || {}, scene_plan: currentScenePlan }).slice(0, 18000)}。${preserveCurrentSceneFields ? '所有当前非空字段必须原样保留，只允许补齐空字段；不得用模型记忆、旧任务或通用模板重写。' : '本次允许按当前需求重编译目标场景，但仍不得引用旧任务内容。'}` : ''}${assistSceneTargetId ? `本次只允许补齐场景 ${assistSceneTargetId}。必须保留全部场景的数量、顺序和稳定 ID，不得新增、删除、重命名或改写其它场景；可以只返回目标场景一条记录。` : ''}
${isSceneExperience ? `当前场景与规划：${JSON.stringify({ scene: body.target_scene || body.targetScene || {}, experience: currentExperience }).slice(0, 12000)}。用户补充：${cleanText(body.user_instruction || body.instruction || '', 1000)}。必须结合当前故事、场景用途、区域和人物行动完善，不能套用别的行业或场景。` : ''}
${isShotSettings ? `当前镜头上下文：${JSON.stringify(shotAssistContext).slice(0, 18000)}\n只返回当前镜头设置，不要重写其它镜头。已有场景 ID 和人物/商品身份必须保持不变。` : ''}
${isStoryBeat ? storyBeatAssist.contextPrompt(storyAssistContext) : ''}
输出 JSON：
${outputSchema}`;
  const internalModelStage = body._internal_model_stage === 'new_story_ad.person_plan_character'
    ? body._internal_model_stage
    : 'new_story_ad.assist';
  const result = await modelGateway.generateText({
    taskId,
    stage: internalModelStage,
    systemPrompt,
    userPrompt,
    maxTokens: 3000, structuredOutput: assistSubjectTarget ? { mode: 'json_object', name: 'person_spec' } : undefined,
    validateText: isBriefGoal ? raw => briefGoalAssist.validateRaw(raw, ctx) : (assistSubjectTarget ? raw => {
      try {
        const draft = jsonRepair.parseJson(raw, 'object');
        return assistSubjectProfiles.modelDraftQuality(
          draft,
          assistSubjectTarget,
          assistReplaceableFields,
          ctx,
        ).valid;
      } catch {
        return false;
      }
    } : null),
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  if (isCreativeDirection) return assistCreativeDirection.buildResponse({ parsed, context: ctx, mode, modelResult: result });
  if (isBriefGoal) return briefGoalAssist.buildResponse({ parsed, context: ctx, mode, modelResult: result });
  if (isStyleControl || isNegativeControl) {
    const text = cleanText(parsed.text || parsed.brief || parsed.content || '', 800);
    return {
      brief: text,
      text,
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isPersonSpec) {
    return assistKnowledgePolicy.attach(assistSubjectProfiles.buildResponse({ parsed, context: ctx, mode, modelResult: result,
      enforcePersonSpec: enforceAssistedPersonSpec, target: assistSubjectTarget, replaceableFields: assistReplaceableFields }), assistPolicy);
  }
  if (isSceneSpec) {
    return assistKnowledgePolicy.attach(assistScenePlan.buildResponse({ parsed, context: ctx, currentPlan: currentScenePlan, targetSpaceId: assistSceneTargetId,
      mode, modelResult: result, preserveCurrentFields: preserveCurrentSceneFields }), assistPolicy);
  }
  if (isSceneExperience) {
    return sceneExperienceAssist.buildResponse({ parsed, current: currentExperience, mode, modelResult: result,
      knowledgePolicy: knowledgePolicyRuntime.trace(assistPolicy || {}) });
  }
  if (isShotSettings) {
    const currentShot = shotAssistContext?.current_shot && typeof shotAssistContext.current_shot === 'object'
      ? shotAssistContext.current_shot
      : {};
    return {
      shot_settings: normalizeAssistedShotSettings(parsed, currentShot),
      mode,
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
      },
    };
  }
  if (isStoryBeat) {
    return storyBeatAssist.buildResponse(parsed, storyAssistContext, mode, result);
  }
  return {
    brief: assistTextFormatter.formatAssistedBrief(parsed.brief || parsed.content || ctx.brief, 3000),
    product_subject: cleanText(parsed.product_subject || parsed.productSubject || ctx.product_subject, 200),
    cast_mode: cleanText(parsed.cast_mode || parsed.castMode || ctx.cast_mode || 'auto', 40),
    shot_count: productionLimits.shotCount(parsed.shot_count || parsed.shotCount || ctx.shot_count),
    forbidden: Array.isArray(parsed.forbidden) ? parsed.forbidden.map(x => cleanText(x, 100)).filter(Boolean) : ctx.forbidden,
    characters: Array.isArray(parsed.characters)
      ? normalizeCharacters(parsed.characters, `${ctx.request_id || body.task_id || body.taskId || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`)
      : ctx.characters,
    model_meta: {
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
    },
  };
}

module.exports = {
  storyAdV3RuntimePolicy,
  assertTaskOwner,
  createTask,
  updateTaskRequest,
  prepareGeneration,
  commitGeneratedPersonAsset: personAssetLifecycle.commitGeneratedPersonAsset,
  updateBlueprint,
  updateStoryboardTable,
  generateSceneConfig,
  updatePersonPlan,
  updateScenePlan,
  generateBlueprintStage,
  recoverBlueprintStage,
  generateScriptPackageStage,
  runTextStageWithRecovery,
  generateStoryboardStage,
  buildKeyframeContractStage,
  generateKeyframesStage,
  resolveTtsVoiceId,
  generateTtsStage,
  projectVideoOutputContext,
  buildVideoPreflightPlan,
  assertVideoPreflightConfirmation,
  publicVideoPreflight: videoPreflight.publicVideoPreflight,
  generateVideoStage,
  acceptVideoClipOverride,
  assertVideoInputsReady,
  verifyPersonContract,
  verifyProductContract,
  selectKeyframeCandidate,
  acceptKeyframeCandidateOverride,
  retryKeyframeCandidateQa,
  composeStage,
  runFull,
  publicTaskBundle,
  compactPublicTaskBundle,
  taskSummary,
  listTaskSummaries,
  modelHealth,
  assistBrief,
  alignPersonAgeDescription,
  enforceAssistedPersonSpec,
  enforceAssistedSceneSpec: sceneAssistCompleteness.enforceAssistedSceneSpec,
  normalizeAssistedShotSettings,
  normalizeAssistedStoryBeat,
  keyframeCompletion,
  keyframeTargetIndexes,
  keyframeStageBudgetMs,
  longFormStageBudgetMs,
  sceneConfigStageBudgetMs,
  keyframeSubmissionPreflight,
  isQaInfrastructureError,
  structuredQaFeedback,
  buildKeyframeDependencyPlan,
  buildKeyframePrompt,
  keyframeReferenceImages, selectedSceneReference, runKeyframeQaReviews,
  acceptedKeyframeContextAt,
  compactKeyframePrompt,
  previewShotPrompts, isCompleteKeyframe,
  subtitleSegmentsFromShots,
};
