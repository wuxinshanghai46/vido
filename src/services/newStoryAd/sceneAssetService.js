const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');
const { assertContextConsistent, cleanText } = require('./contextBuilder');
const sceneSpace = require('./sceneSpaceContractService');
const cancellation = require('./cancellationContext');
const sceneViewStrategy = require('./sceneViewStrategyService');
const shotDesign = require('./shotDesignService');
const sceneCheckpoint = require('./sceneGenerationCheckpointService');
const sceneBinding = require('./sceneBindingService');
const visualRealismPolicy = require('./visualRealismPolicyService');
const sceneAtlas = require('./sceneAtlasService');
const blueprintQuality = require('./blueprintQualityService'), sceneStructuredContract = require('./sceneStructuredContractService');
const scenePromptConfirmation = require('./scenePromptConfirmationService');
const visualAssetProgress = require('./visualAssetProgressService');
const productAssetResolver = require('./productAssetResolverService');
const sceneGenerationPolicy = require('./sceneGenerationPolicyService'), knowledgeRuntime = require('./knowledgePolicyRuntimeService');
const sceneSpecProjection = require('./sceneSpecProjectionService');
const sceneLayerContract = require('./sceneLayerContractService');
const sceneCheckpointProjection = require('./sceneCheckpointProjectionService');
const sceneCurrentAuthority = require('./sceneCurrentAuthorityService');
const sceneFailureDiagnostics = require('./sceneFailureDiagnosticsService');
const worldSetting = require('./worldSettingContractService');
const sceneVisualPrompts = require('./sceneVisualPromptService');
const sceneAssetFix = require('./sceneAssetFixService');
const sceneViewCompleteness = require('./sceneViewCompletenessService');
const sceneRepairPlans = require('./sceneRepairPlanService');
const sceneAssetFiles = require('./sceneAssetFileIntegrityService');
const targetProgress = require('./targetGenerationProgressService');
const sceneBatchLiveProgress = require('./sceneBatchLiveProgressService').create({ storage, targetProgress,
  normalizeViewKeys: value => normalizeRepairViewKeys(value), viewLabel: value => sceneViewLabel(value) });
const { buildSceneSheetPrompt, buildLayoutAcquisitionPrompt, legacyScenePromptFingerprintText, localizeSceneViews, relinkContractViews, localizeSceneAssets, buildDerivedViewPrompt, buildSceneAuditSafePrompt } = sceneVisualPrompts;

const SCENE_VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];
const REQUIRED_SCENE_VIEW_KEYS = ['layout', ...SCENE_VIEW_KEYS];
const SCENE_GENERATION_ORDER = ['master', 'layout', 'reverse', 'interaction', 'detail'];
const SCENE_REPAIR_PLAN_VERSION = 6;
const SCENE_GENERATION_CONTRACT_VERSION = 7;
const LAYOUT_APPEARANCE_ROLE = 'master_derived_near_vertical_topdown';
const SCENE_IMAGE_STAGE_BY_VIEW = Object.freeze({
  atlas: 'new_story_ad.scene_extension_atlas',
  master: 'new_story_ad.scene_extension_master',
  layout: 'new_story_ad.scene_extension_layout',
  reverse: 'new_story_ad.scene_extension_reverse',
  interaction: 'new_story_ad.scene_extension_interaction',
  detail: 'new_story_ad.scene_extension_detail',
});
const SCENE_IMAGE_EXTRA_ATTEMPTS = Math.max(0, Math.min(3, Number(process.env.NEW_STORY_AD_SCENE_IMAGE_EXTRA_ATTEMPTS || 2) || 0));
const SCENE_IMAGE_MAX_ATTEMPTS = 1 + SCENE_IMAGE_EXTRA_ATTEMPTS;
const SCENE_IMAGE_RETRY_DELAY_MS = Math.max(0, Math.min(5000, Number(process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS || 1200) || 0));
const SCENE_IMAGE_CIRCUIT_COOLDOWN_MS = Math.max(5000, Math.min(300000, Number(process.env.NEW_STORY_AD_SCENE_IMAGE_CIRCUIT_COOLDOWN_MS || 60000) || 60000));
const imageCircuit = { consecutiveTransientFailures: 0, openUntil: 0 };
function isTransientImageError(error) {
  if (error?.billingState === 'unknown' || error?.billing_state === 'unknown') return false;
  if (['PROVIDER_RIGHTS_AUDIT', 'PROVIDER_CONTENT_AUDIT', 'PROVIDER_5XX_AMBIGUOUS'].includes(String(error?.code || ''))) return false;
  return /(?:timeout|timed out|econnreset|econnrefused|socket hang up|connection termination|reset before headers|upstream connect error|\b429\b|rate.?limit|unkxxxo004ifr|temporar(?:y|ily))/i
    .test(String(error?.message || error || ''));
}

function sceneGenerationBudget(existing = null, forceSingleAttempt = false) {
  if (forceSingleAttempt) return { maxExtra: 0, usedExtra: 0, reasons: [] };
  return existing || { maxExtra: SCENE_IMAGE_EXTRA_ATTEMPTS, usedExtra: 0, reasons: [] };
}

function reserveExtraAttempt(budget, reason = '') {
  if (!budget || budget.usedExtra >= budget.maxExtra) return false;
  budget.usedExtra += 1;
  if (reason) budget.reasons.push(reason);
  return true;
}

function remainingExtraAttempts(budget) {
  return Math.max(0, Number(budget?.maxExtra || 0) - Number(budget?.usedExtra || 0));
}

function resetSceneImageCircuit() {
  imageCircuit.consecutiveTransientFailures = 0;
  imageCircuit.openUntil = 0;
}

function sceneViewLabel(key = '') {
  return {
    master: '主视角',
    reverse: '反向/侧向',
    interaction: '互动位',
    detail: '材质细节',
    layout: '俯视布局',
    atlas: '2×2 空间母图',
  }[key] || key || '场景视角';
}

function sceneImageStage(key = '') {
  return SCENE_IMAGE_STAGE_BY_VIEW[String(key || '').trim()] || 'new_story_ad.scene_asset';
}

function normalizeSceneView(view = {}, index = 0) {
  const key = cleanText(view.key || view.view || SCENE_VIEW_KEYS[index] || `view_${index + 1}`, 40);
  const url = cleanText(view.url || view.image_url || view.imageUrl || view.file_url || '', 1000);
  return {
    key,
    label: cleanText(view.label || sceneViewLabel(key), 80),
    url,
    image_url: cleanText(view.image_url || url, 1000),
    source_url: cleanText(view.source_url || view.sourceUrl || '', 1600),
    filename: cleanText(view.filename || '', 160),
    provider_used: cleanText(view.provider_used || '', 160),
    camera_id: cleanText(view.camera_id || 'camera_' + key, 100),
    source_kind: cleanText(view.source_kind || '', 60),
    source_role: cleanText(view.source_role || '', 80),
    derived_locally: view.derived_locally === true,
    parent_asset_id: cleanText(view.parent_asset_id || '', 120),
    parent_sha256: cleanText(view.parent_sha256 || '', 64),
    file_sha256: cleanText(view.file_sha256 || '', 64),
    crop: view.crop && typeof view.crop === 'object'
      ? {
        x: Number(view.crop.x) || 0,
        y: Number(view.crop.y) || 0,
        width: Number(view.crop.width) || 0,
        height: Number(view.crop.height) || 0,
        role: cleanText(view.crop.role || '', 80),
      }
      : null,
  };
}

function normalizeSceneAsset(asset = {}, index = 0) {
  if (!asset || typeof asset !== 'object') return null;
  const normalizedViews = Array.isArray(asset.view_images)
    ? asset.view_images.map(normalizeSceneView).filter(view => view.url || view.image_url).slice(0, 8)
    : [];
  const partitionedViews = sceneAssetFiles.partitionViews(normalizedViews);
  const viewImages = partitionedViews.available.map(item => item.view);
  const missingFileViewKeys = partitionedViews.missing
    .map(item => cleanText(item.view.key || item.view.view || `view_${item.index + 1}`, 40))
    .filter(Boolean);
  const storedPrimary = cleanText(asset.image_url || asset.url || '', 1000);
  const primaryState = sceneAssetFiles.inspect(storedPrimary);
  const primary = cleanText((primaryState.available ? storedPrimary : '') || viewImages[0]?.url || viewImages[0]?.image_url || '', 1000);
  const missingLocalMedia = (primaryState.local && !primaryState.available) || missingFileViewKeys.length > 0;
  if (!primary && !viewImages.length && !asset.layout_summary && !asset.material_summary && !missingLocalMedia) return null;
  const normalizedContract = asset.scene_contract && typeof asset.scene_contract === 'object'
    ? sceneSpace.normalizeContract(asset.scene_contract, {
      sceneId: asset.scene_id || asset.id,
      revision: asset.scene_revision || 1,
      views: viewImages,
    })
    : null;
  const normalizedForPlan = {
    ...asset,
    view_images: viewImages,
    scene_contract: normalizedContract,
  };
  const storedRepairPlan = asset.repair_plan && typeof asset.repair_plan === 'object'
    && Number(asset.repair_plan.version || 0) >= SCENE_REPAIR_PLAN_VERSION
    ? asset.repair_plan
    : null;
  const repairPlan = sceneGenerationUpgradeRequired(normalizedForPlan)
    ? fullSceneUpgradePlan()
    : (normalizedContract
      ? buildSceneRepairPlan(normalizedForPlan)
      : (storedRepairPlan || buildSceneRepairPlan(normalizedForPlan)));
  return {
    id: cleanText(asset.id || asset.scene_id || `scene_${index + 1}`, 120),
    scene_id: cleanText(asset.scene_id || asset.id || `scene_${index + 1}`, 120),
    space_id: cleanText(asset.space_id || asset.spaceId || asset.scene_id || asset.id || `scene_${index + 1}`, 120),
    name: cleanText(asset.name || `任务场景 ${index + 1}`, 120),
    source: cleanText(asset.source || 'new_story_ad_scene_asset', 120),
    lock_strength: cleanText(asset.lock_strength || asset.lockStrength || 'standard', 40),
    layout_summary: cleanText(asset.layout_summary || asset.layoutSummary || asset.description || '', 1000),
    material_summary: cleanText(asset.material_summary || asset.materialSummary || '', 1000),
    interaction_summary: cleanText(asset.interaction_summary || asset.interactionSummary || '', 800),
    style_summary: cleanText(asset.style_summary || asset.styleSummary || '', 800),
    negative: cleanText(asset.negative || asset.negative_prompt || '', 800),
    surface_topology: shotDesign.normalizeSurfaceTopology(asset.surface_topology || asset.surfaceTopology),
    material_contract: asset.material_contract && typeof asset.material_contract === 'object' ? asset.material_contract : null,
    material_reference_available: asset.material_reference_available === true || asset.materialReferenceAvailable === true,
    image_url: primary,
    url: primary,
    view_images: viewImages,
    view_count: Number(asset.view_count || viewImages.length || (primary ? 1 : 0)) || 0,
    view_strategy: cleanText(asset.view_strategy || asset.viewStrategy || 'image_derived', 40),
    view_acquisition: asset.view_acquisition && typeof asset.view_acquisition === 'object' ? asset.view_acquisition : null,
    scene_world_assets: asset.scene_world_assets && typeof asset.scene_world_assets === 'object'
      ? asset.scene_world_assets
      : (asset.sceneWorldAssets && typeof asset.sceneWorldAssets === 'object' ? asset.sceneWorldAssets : null),
    space_asset_contract: asset.space_asset_contract && typeof asset.space_asset_contract === 'object'
      ? asset.space_asset_contract
      : null,
    generation_contract_version: sceneGenerationContractVersion(asset),
    scene_revision: Math.max(1, Number(asset.scene_revision || asset.sceneRevision || 1) || 1),
    scene_contract: normalizedContract,
    cross_view_qa: normalizedContract?.cross_view_qa || asset.cross_view_qa || null,
    requirement_qa: normalizedContract?.requirement_qa || asset.requirement_qa || null,
    photographic_realism_qa: normalizedContract?.photographic_realism_qa || asset.photographic_realism_qa || null,
    camera_design_qa: normalizedContract?.camera_design_qa || asset.camera_design_qa || null,
    layout_contract: normalizedContract?.layout_contract || asset.layout_contract || null,
    spatial_coverage_qa: normalizedContract?.spatial_coverage_qa || asset.spatial_coverage_qa || null,
    verification: normalizedContract?.verification
      || (asset.verification && typeof asset.verification === 'object' ? asset.verification : null),
    partial_checkpoint: asset.partial_checkpoint === true,
    checkpoint_status: cleanText(asset.checkpoint_status || '', 40),
    checkpoint_error_code: cleanText(asset.checkpoint_error_code || '', 120),
    completed_view_keys: Array.isArray(asset.completed_view_keys) ? asset.completed_view_keys.map(value => cleanText(value, 40)).filter(Boolean) : [],
    failed_view_keys: Array.isArray(asset.failed_view_keys) ? asset.failed_view_keys.map(value => cleanText(value, 40)).filter(Boolean) : [],
    missing_file_view_keys: missingFileViewKeys,
    view_statuses: asset.view_statuses && typeof asset.view_statuses === 'object'
      ? Object.fromEntries(Object.entries(asset.view_statuses).map(([key, value]) => [
          cleanText(key, 40),
          value && typeof value === 'object' ? { ...value } : value,
        ]))
      : {},
    billing_review_required: asset.billing_review_required === true,
    provider_used: cleanText(asset.provider_used || '', 240),
    prompt: cleanText(asset.prompt || '', 6000),
    repair_plan: missingFileViewKeys.length
      ? buildSceneRepairPlan({ ...normalizedForPlan, failed_view_keys: [...new Set([...(asset.failed_view_keys || []), ...missingFileViewKeys])] })
      : repairPlan,
    repair_history: Array.isArray(asset.repair_history) ? asset.repair_history.slice(-8) : [],
    scene_layer: asset.scene_layer && typeof asset.scene_layer === 'object' ? asset.scene_layer : null,
    scene_authority_fingerprint: cleanText(asset.scene_authority_fingerprint || asset.sceneAuthorityFingerprint || '', 100),
    created_at: asset.created_at || new Date().toISOString(),
  };
}

const sceneGenerationContractVersion = sceneGenerationPolicy.contractVersion;
const sceneGenerationUpgradeRequired = asset => sceneGenerationPolicy.upgradeRequired(asset, SCENE_GENERATION_CONTRACT_VERSION);
const fullSceneUpgradePlan = () => sceneGenerationPolicy.fullUpgradePlan({
  version: SCENE_REPAIR_PLAN_VERSION,
  viewKeys: SCENE_GENERATION_ORDER,
  viewLabels: SCENE_GENERATION_ORDER.map(sceneViewLabel),
});
const sceneMaterialReferenceImages = productAssetResolver.sceneMaterialReferenceImages;

function updateSceneGenerationProgress(taskId, update = {}) {
  const task = storage.getTask(taskId);
  if (!task) return null;
  if (task.generation_progress?.stage === 'visual_assets') {
    const keys = normalizeRepairViewKeys(update.viewKeys || []);
    const current = task.generation_progress.lanes?.scenes?.current_view_progress || {};
    const processed = update.viewStatus === 'succeeded'
      ? Math.min(keys.length || Number(current.total || 1), Number(current.completed || 0) + 1)
      : Number(current.completed || 0);
    return visualAssetProgress.updateSceneUnit(taskId, {
      scene_id: update.sceneId || update.scene_id || '',
      target_total: keys.length || Number(current.total || 1),
      processed,
      status: update.viewStatus === 'failed' ? 'failed' : 'running',
      message: update.phase === 'verification' ? '正在验证场景空间一致性' : '',
    });
  }
  const executionGenerationId = cleanText(update.generationId || cancellation.current()?.generationId || '', 100);
  const activeTargets = task.active_target_generations && typeof task.active_target_generations === 'object'
    ? task.active_target_generations : {};
  const activeSceneBatch = activeTargets['scene_asset:scene-batch'];
  if (activeSceneBatch
    && String(activeSceneBatch.generation_id || '') === executionGenerationId) {
    return sceneBatchLiveProgress.update(taskId, task, executionGenerationId, update);
  }
  const activeTargetEntry = Object.entries(activeTargets).find(([, value]) => String(value?.generation_id || '') === executionGenerationId);
  const sceneLanes = Object.entries(task.target_generation_progress || {})
    .filter(([key]) => key.startsWith('scene_asset:'));
  const generationLane = sceneLanes.find(([, value]) => executionGenerationId
    && String(value?.generation_id || '') === executionGenerationId);
  const soleDirectLane = sceneLanes.length === 1 ? sceneLanes[0] : null;
  const inferredSceneId = cleanText(
    update.sceneId || update.scene_id || activeTargetEntry?.[1]?.target_id
      || generationLane?.[1]?.scene_id || soleDirectLane?.[1]?.scene_id || '',
    120,
  );
  const laneKey = targetProgress.key('scene_asset', inferredSceneId);
  const previous = generationLane?.[1] || task.target_generation_progress?.[laneKey]
    || (task.generation_progress?.stage === 'scene_asset' ? task.generation_progress : {});
  const keys = normalizeRepairViewKeys(update.viewKeys?.length ? update.viewKeys : previous.view_keys);
  const initialStates = Array.isArray(update.initialViewStates) ? update.initialViewStates : [];
  const priorStates = new Map([
    ...(previous.view_states || []).map(item => [item.key, item]),
    ...initialStates.map(item => [item.key, item]),
  ]);
  const now = new Date().toISOString();
  const viewStates = keys.map(key => {
    const current = priorStates.get(key) || { key, label: sceneViewLabel(key), status: 'queued' };
    return key === update.viewKey
      ? {
          ...current,
          status: update.viewStatus || current.status,
          error: cleanText(update.error || '', 240),
          attempt: Math.max(1, Number(update.attempt || current.attempt || 1) || 1),
          max_attempts: Math.max(1, Number(update.maxAttempts || current.max_attempts || SCENE_IMAGE_MAX_ATTEMPTS) || SCENE_IMAGE_MAX_ATTEMPTS),
          retrying: update.retrying === true,
          ...(update.viewStatus === 'succeeded' ? {
            error_code: '', provider_id: '', model_id: '', http_status: '', provider_reason: '', provider_error_code: '',
            platform_request_id: '', provider_request_id: '', provider_task_id: '', provider_submission_state: '', billing_state: '',
          } : (update.diagnostics || {})),
          updated_at: now,
        }
      : current;
  });
  const processed = viewStates.filter(item => ['succeeded', 'failed'].includes(item.status)).length;
  const succeeded = viewStates.filter(item => item.status === 'succeeded').length;
  const failed = viewStates.filter(item => item.status === 'failed').length;
  const phase = update.phase || previous.phase || 'preparing';
  const terminal = phase === 'complete';
  const progress = {
    schema_version: 1,
    stage: 'scene_asset',
    scene_id: inferredSceneId || cleanText(previous.scene_id || '', 120),
    generation_id: executionGenerationId || previous.generation_id || '',
    mode: update.mode || previous.mode || 'generate',
    phase,
    // A failed view is an intermediate, resumable unit state while later views
    // and provider fallbacks may still be running. Only the orchestration owner
    // may publish a terminal generation failure.
    status: terminal ? 'completed' : (phase === 'verification' ? 'verifying' : 'running'),
    view_keys: keys,
    target_total: keys.length,
    processed,
    succeeded,
    failed,
    active_view_keys: viewStates.filter(item => item.status === 'running').map(item => item.key),
    completed_view_keys: viewStates.filter(item => item.status === 'succeeded').map(item => item.key),
    view_states: viewStates,
    verification_state: cleanText(update.verificationState || previous.verification_state || '', 40),
    started_at: previous.started_at || task.generation_started_at || task.generation_queued_at || now,
    updated_at: now,
    ...(terminal ? { finished_at: now } : {}),
  };
  if (progress.scene_id) {
    const patch = targetProgress.upsert(task, {
      stage: 'scene_asset', scopeId: progress.scene_id, sceneId: progress.scene_id,
      generationId: progress.generation_id, status: progress.status, progress,
    });
    storage.updateTask(taskId, patch);
    return patch.generation_progress;
  }
  storage.updateTask(taskId, { generation_progress: progress });
  return progress;
}

async function generateTrackedSceneView(taskId, key, options = {}, progress = {}, budget = sceneGenerationBudget()) {
  let attempt = 1;
  while (true) {
    updateSceneGenerationProgress(taskId, {
      ...progress,
      viewKey: key,
      viewStatus: 'running',
      phase: 'generation',
      attempt,
      maxAttempts: 1 + remainingExtraAttempts(budget),
      retrying: attempt > 1,
    });
    const absoluteAttempt = Math.max(1, Number(options.baseAttempt || 0) + attempt);
    const clientRequestId = typeof options.submissionIdFactory === 'function'
      ? options.submissionIdFactory(absoluteAttempt)
      : cleanText(options.clientRequestId || '', 100);
    const attemptOptions = {
      ...options,
      clientRequestId,
      onSubmitting: typeof options.onSubmitting === 'function'
        ? event => options.onSubmitting({ ...event, attempt: absoluteAttempt, generationId: options.generationId })
        : null,
      onSubmitted: typeof options.onSubmitted === 'function'
        ? event => options.onSubmitted({ ...event, attempt: absoluteAttempt, generationId: options.generationId })
        : null,
    };
    delete attemptOptions.submissionIdFactory;
    delete attemptOptions.baseAttempt;
    try {
      if (imageCircuit.openUntil > Date.now()) {
        const error = new Error('Image2 provider is temporarily cooling down after repeated upstream failures');
        error.code = 'SCENE_IMAGE_PROVIDER_COOLDOWN';
        error.retryable = false;
        throw error;
      }
      const result = await mediaAdapter.generateImage(attemptOptions);
      imageCircuit.consecutiveTransientFailures = 0;
      imageCircuit.openUntil = 0;
      updateSceneGenerationProgress(taskId, {
        ...progress,
        viewKey: key,
        viewStatus: 'succeeded',
        phase: 'generation',
        attempt,
        maxAttempts: attempt,
      });
      return result;
    } catch (error) {
      error.generationId = cleanText(error.generationId || options.generationId || '', 100);
      error.submissionId = cleanText(error.submissionId || clientRequestId || '', 100);
      error.attempt = absoluteAttempt;
      const transient = isTransientImageError(error);
      if (transient) {
        imageCircuit.consecutiveTransientFailures += 1;
        if (imageCircuit.consecutiveTransientFailures >= 2) imageCircuit.openUntil = Date.now() + SCENE_IMAGE_CIRCUIT_COOLDOWN_MS;
      }
      const willRetry = transient && imageCircuit.openUntil <= Date.now()
        && reserveExtraAttempt(budget, `provider_retry:${key}`);
      updateSceneGenerationProgress(taskId, {
        ...progress,
        viewKey: key,
        viewStatus: willRetry ? 'running' : 'failed',
        phase: 'generation',
        error: error?.message || error,
        attempt: willRetry ? attempt + 1 : attempt,
        maxAttempts: attempt + (willRetry ? 1 : 0),
        retrying: willRetry,
        diagnostics: sceneFailureDiagnostics.project(error),
      });
      if (!willRetry) throw error;
      cancellation.throwIfCancelled(taskId);
      if (SCENE_IMAGE_RETRY_DELAY_MS > 0) {
        await new Promise(resolve => setTimeout(resolve, SCENE_IMAGE_RETRY_DELAY_MS * attempt));
      }
      cancellation.throwIfCancelled(taskId);
      attempt += 1;
    }
  }
}

function localSceneViewPath(view = {}) {
  const direct = cleanText(view.filePath || view.file_path || '', 1600);
  if (direct) {
    const resolved = path.resolve(direct);
    const root = path.resolve(mediaAdapter.ASSET_DIR);
    if (resolved.startsWith(root + path.sep) && fs.existsSync(resolved)) return resolved;
  }
  const url = cleanText(view.url || view.image_url || view.imageUrl || '', 1600);
  if (!url.startsWith('/api/new-story-ad/assets/')) return '';
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || '');
  const resolved = mediaAdapter.assetPathFromName(name);
  return resolved && fs.existsSync(resolved) ? resolved : '';
}

function sceneViewContentHash(view = {}) {
  const file = localSceneViewPath(view);
  if (!file) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function exactSceneViewDuplicate(candidate = {}, references = []) {
  if (String(process.env.NEW_STORY_AD_MOCK_IMAGE || '') === '1') return false;
  const candidateHash = sceneViewContentHash(candidate);
  if (!candidateHash) return false;
  return (Array.isArray(references) ? references : [references])
    .some(reference => sceneViewContentHash(reference) === candidateHash);
}

function assertCompleteUpgradeSceneSpec(body = {}) {
  if (body.require_complete_scene_spec !== true && body.requireCompleteSceneSpec !== true) return;
  const spec = body.scene_spec || body.sceneSpec || {};
  const minimums = {
    layoutText: 30,
    materialLightText: 30,
    interactionText: 24,
    negativeText: 24,
  };
  const missing = Object.entries(minimums)
    .filter(([key, minimum]) => {
      const text = cleanText(spec[key] || '', 1000);
      return text.length < minimum
        || /(?:由|为|和|与|的|及|以及|包括|采用|融合|形成|一面|一个|一种|位于|呈现)$/u.test(text);
    })
    .map(([key]) => key);
  if (!missing.length) return;
  const error = new Error(`新版场景空间设定不完整，已在图片调用前停止：${missing.join(', ')}`);
  error.code = 'SCENE_SPEC_INCOMPLETE';
  error.retryable = false;
  error.missing_fields = missing;
  error.details = missing.map(field => ({
    code: 'SCENE_SPEC_FIELD_MISSING',
    title: field,
    message: `场景空间设定字段 ${field} 未达到完整生成要求`,
    status: 'missing',
  }));
  throw error;
}

function assertSceneRightsPreflight(ctx = {}, body = {}) {
  // Inspect the exact current-space provider prompt. A later storyboard or
  // end-card instruction must not block an unoccupied scene that never
  // receives that content.
  const visibleTaskText = buildSceneSheetPrompt({
    ctx,
    sceneConfig: {},
    body,
    outputRole: 'contract',
  });
  const rights = blueprintQuality.assessBlueprintRights({
    story_title: 'scene asset preflight',
    logline: visibleTaskText,
    beats: [{ visual: visibleTaskText }],
  });
  if (rights.pass) return rights;
  const error = new Error(`场景生成要求未通过原创与权利预检：${rights.issues.join('；')}`);
  error.code = 'SCENE_RIGHTS_PREFLIGHT_FAILED';
  error.status = 422;
  error.retryable = false;
  error.rights_policy_version = rights.policy_version;
  error.details = { issues: rights.issues };
  error.scene_id = cleanText(body.space_id || body.spaceId || body.scene_id || body.sceneId || '', 120);
  error.scene_name = cleanText(body.name || body.scene_name || body.sceneName || '', 120);
  throw error;
}

async function generateCheckpointedSceneView(taskId, key, options = {}, progress = {}, budget, checkpoint) {
  const generationId = cleanText(options.generationId || checkpoint.metadata?.generation_id || '', 100);
  const baseAttempt = Math.max(0, Number(checkpoint.views?.[key]?.attempts || 0) || 0);
  const trackedOptions = {
    ...options,
    generationId,
    baseAttempt,
    submissionIdFactory: attempt => sceneCheckpoint.submissionId(checkpoint, key, attempt),
    onSubmitting: event => sceneCheckpoint.markSubmitting(checkpoint, key, event),
    onSubmitted: event => sceneCheckpoint.markSubmitted(checkpoint, key, event),
  };
  try {
    const generated = await generateTrackedSceneView(taskId, key, trackedOptions, progress, budget);
    sceneCheckpoint.markSucceeded(checkpoint, key, {
      key,
      label: sceneViewLabel(key),
      url: generated.url || generated.image_url,
      image_url: generated.image_url || generated.url,
      source_url: generated.source_url || '',
      filename: generated.filename || '',
      filePath: generated.filePath || generated.file_path || '',
      provider_used: generated.provider_used || '',
    }, budget);
    return generated;
  } catch (error) {
    if (error?.code === 'USER_CANCELLED' || error?.cancelled === true) {
      sceneCheckpoint.markCancelled(checkpoint, key, error, budget);
      error.partial_scene_checkpoint = true;
      error.completed_view_keys = Object.keys(checkpoint.views || {})
        .filter(viewKey => sceneCheckpoint.checkpointView(checkpoint, viewKey));
      error.cancelled_view_keys = [...(checkpoint.cancelled_view_keys || [])];
      error.scene_id = checkpoint.scene_id;
    } else {
      sceneCheckpoint.markFailed(checkpoint, key, error, budget);
      error.partial_scene_checkpoint = true;
      error.completed_view_keys = Object.keys(checkpoint.views || {})
        .filter(viewKey => sceneCheckpoint.checkpointView(checkpoint, viewKey));
      error.failed_view_keys = [key];
      error.scene_id = checkpoint.scene_id;
    }
    throw error;
  }
}

function normalizeSceneAssets(input = []) {
  const raw = Array.isArray(input) ? input : [];
  return raw.map(normalizeSceneAsset).filter(Boolean);
}

function currentSceneAssetsFromBundle(bundle = {}, modelCalls = []) {
  return sceneCurrentAuthority.currentSceneAssetsFromBundle(bundle, modelCalls, {
    normalizeSceneAssets, projectSceneAssets: sceneCheckpointProjection.projectSceneAssets,
  });
}

function currentSceneAssets(taskId) {
  return currentSceneAssetsFromBundle(storage.getTaskBundle(taskId, { diagnostics: false }), storage.listModelCalls(taskId));
}

function normalizeRepairViewKeys(input = []) {
  const source = Array.isArray(input) ? input : [];
  return SCENE_GENERATION_ORDER.filter(key => source.includes(key));
}

function buildSceneRepairPlan(asset = {}) {
  return sceneRepairPlans.build(asset, {
    cleanText, sceneViewLabel, sceneGenerationUpgradeRequired, fullSceneUpgradePlan,
    sceneRepairPlanVersion: SCENE_REPAIR_PLAN_VERSION,
    requiredSceneViewKeys: REQUIRED_SCENE_VIEW_KEYS,
    sceneGenerationOrder: SCENE_GENERATION_ORDER,
  });
}

sceneVisualPrompts.bind({ sceneMaterialReferenceImages, sceneRequest, mediaAdapter, normalizeSceneView, normalizeSceneAssets, normalizeSceneAsset });

function sceneVisionThumbnailUrl(value = '', width = 560) {
  const absolute = mediaAdapter.absolutePublicImageUrl(value);
  if (!absolute || !/\/api\/new-story-ad\/assets\//i.test(absolute)) return absolute;
  const separator = absolute.includes('?') ? '&' : '?';
  return `${absolute}${separator}w=${Math.max(240, Math.min(960, Number(width) || 560))}`;
}

function needsLayoutView() {
  // Every new scene defines its topology before cinematic views are derived.
  // JavaScript callers may still pass historical arguments; they are ignored.
  return true;
}

function sceneRequest(ctx = {}, body = {}) {
  const spec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const layout = cleanText(spec.layoutText || spec.layout_text || spec.layout || body.layout_summary || '', 1000);
  const materialLight = cleanText(spec.materialLightText || spec.material_light_text || spec.material || spec.light || body.material_summary || '', 1000);
  const interaction = cleanText(spec.interactionText || spec.interaction_text || spec.interaction || spec.camera || '', 800);
  const negative = cleanText(spec.negativeText || spec.negative_text || body.negative || ctx.controlled_production?.negative_control?.text || '', 1000);
  const surfaceTopology = shotDesign.reconcileSceneSurfaceTopology(
    spec.surfaceTopology || spec.surface_topology,
    [layout, materialLight, negative, spec.surfaceTopology?.notes, spec.surface_topology?.notes],
  );
  const materialReferenceAvailable = sceneMaterialReferenceImages(ctx, body).length > 0;
  const structuredScene = sceneStructuredContract.compile(spec, ctx, body);
  const spatialScene = sceneStructuredContract.compileSpatialAsset(spec, ctx, body);
  return {
    layout,
    material_light: materialLight,
    interaction,
    surface_topology: surfaceTopology,
    material_contract: shotDesign.normalizeMaterialContract(spec.materialContract || spec.material_contract, {
      sourceText: materialLight,
      topology: surfaceTopology,
      referenceAvailable: materialReferenceAvailable,
    }),
    interaction_contract: {
      scene_empty: true,
      required_evidence: ['empty_clearance', 'reachable_target', 'access_route'], interaction_anchors: structuredScene.interaction_anchors, movement_routes: structuredScene.routes, story_states: structuredScene.story_states, prop_placements: structuredScene.prop_placements,
    },
    structured_scene_contract: spatialScene,
    narrative_scene_contract: structuredScene,
    material_reference_available: materialReferenceAvailable,
    style: cleanText(ctx.controlled_production?.style_control?.notes || body.style_summary || '', 800),
    negative,
  };
}

function mergeSceneAssets(existing = [], asset = {}) {
  const list = normalizeSceneAssets(existing);
  const row = normalizeSceneAsset(asset, list.length);
  if (!row) return list;
  const idx = list.findIndex(item => String(item.scene_id || item.id) === String(row.scene_id || row.id));
  if (idx >= 0) list[idx] = { ...list[idx], ...row, updated_at: new Date().toISOString() };
  else list.push(row);
  return list;
}

function saveSceneAssetsToTask(taskId, sceneAssets = [], options = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const normalized = normalizeSceneAssets(sceneAssets);
  storage.saveOutput(taskId, 'scene_assets', normalized);
  const nextCtx = {
    ...ctx,
    ...(options.sceneSpec ? { scene_spec: options.sceneSpec } : {}),
    scene_assets: normalized,
  };
  if (options.deferContextWrite !== true) {
    storage.saveOutput(taskId, 'context', nextCtx);
    storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  }
  storage.saveStage(taskId, 'scene_asset', {
    status: 'done',
    output_summary: `${normalized.length} scene asset packages`,
  });
  return normalized;
}

function baseVisualArtifact(view = {}, role = 'master', lineage = {}) {
  if (!view || typeof view !== 'object') return null;
  const imageUrl = cleanText(view.image_url || view.url || '', 1000);
  if (!imageUrl) return null;
  const assetHash = cleanText(view.file_sha256 || view.sha256 || sceneViewContentHash(view), 64)
    || crypto.createHash('sha256').update(JSON.stringify({
      role,
      asset_id: view.asset_id || view.id || '',
      image_url: imageUrl,
      filename: view.filename || '',
      provider_used: view.provider_used || '',
    })).digest('hex');
  return {
    asset_id: cleanText(view.asset_id || view.id || view.filename || `${role}_${assetHash.slice(0, 16)}`, 160),
    asset_hash: assetHash,
    image_url: imageUrl,
    lineage: {
      role,
      provider_used: cleanText(view.provider_used || '', 160),
      source_url: cleanText(view.source_url || '', 1000),
      ...lineage,
    },
  };
}

function publishBaseSceneAsset({
  taskId, target, body, ctx, existing, previous, master, atlas, revision,
  checkpoint, requested, prompt, knowledgePolicy, viewStrategy, repairMode = false,
} = {}) {
  const masterArtifact = baseVisualArtifact(master, 'master', { scene_id: target.scene_id, scene_revision: revision });
  const atlasArtifact = baseVisualArtifact(atlas, 'atlas', { scene_id: target.scene_id, scene_revision: revision });
  if (!masterArtifact) return null;
  const space = target.space || {};
  const coveredBeatIds = Array.isArray(space.covered_beat_ids) && space.covered_beat_ids.length
    ? space.covered_beat_ids
    : [`scene:${target.scene_id}`];
  const core = sceneLayerContract.publishCore(taskId, {
    id: target.scene_id,
    production_scene_key: space.production_scene_key || target.scene_id,
    narrative_visit_id: space.narrative_visit_id || `visit:${target.scene_id}`,
    covered_beat_ids: coveredBeatIds,
    name: space.name || body.name || '任务场景',
    description: space.description || body.description || '',
    story_purpose: space.story_purpose || '',
    scene_spec: target.scene_spec || body.scene_spec || body.sceneSpec || {},
    topology_hash: target.scene_plan?.topology_hash || target.scene_plan?.compiler_hash || '',
    base_visual: { master: masterArtifact, atlas: atlasArtifact },
  });
  // A failed repair candidate must never replace a previously complete active
  // scene package. The new base visual remains auditable in the layer store.
  const previousCoreFingerprint = cleanText(previous?.scene_layer?.core_fingerprint || previous?.scene_authority_fingerprint || '', 100);
  const currentCoreFingerprint = cleanText(core?.core_fingerprint || '', 100);
  const legacyAuthorityMatches = !previousCoreFingerprint
    && cleanText(previous?.name || '', 120) === cleanText(space.name || body.name || '', 120)
    && cleanText(previous?.layout_summary || '', 1000) === cleanText(body.layout_summary || body.layoutSummary || target.scene_spec?.layoutText || space.description || '', 1000);
  const sameAuthority = !!currentCoreFingerprint
    && (previousCoreFingerprint === currentCoreFingerprint || legacyAuthorityMatches);
  // A targeted repair already resolved its source from the current scene
  // authority. Keep every previously saved view while the candidate is being
  // generated, including a 4/5 partial package. Replacing it with the reusable
  // master alone makes one failed repair shrink the canonical asset to 1/5.
  if (previous && (repairMode || (previous.partial_checkpoint !== true && sameAuthority))) {
    return { core, asset: previous, preserved_previous: true };
  }
  const masterView = normalizeSceneView({
    ...master,
    key: 'master',
    label: sceneViewLabel('master'),
    url: master.image_url || master.url,
    image_url: master.image_url || master.url,
  }, 0);
  const missing = SCENE_GENERATION_ORDER.filter(key => key !== 'master'
    && !sceneCheckpoint.checkpointView(checkpoint, key));
  const baseAsset = normalizeSceneAsset({
    id: target.scene_id,
    scene_id: target.scene_id,
    space_id: target.space_id,
    name: space.name || body.name || '任务场景',
    source: 'new_story_ad_scene_base_visual',
    scene_revision: revision,
    lock_strength: body.lock_strength || body.lockStrength || 'standard',
    layout_summary: body.layout_summary || body.layoutSummary || target.scene_spec?.layoutText || space.description || '',
    material_summary: body.material_summary || body.materialSummary || target.scene_spec?.materialLightText || '',
    interaction_summary: body.interaction_summary || body.interactionSummary || target.scene_spec?.interactionText || '',
    style_summary: ctx.controlled_production?.style_control?.notes || '',
    negative: body.negative || target.scene_spec?.negativeText || '',
    surface_topology: requested.surface_topology,
    material_contract: requested.material_contract,
    material_reference_available: requested.material_reference_available,
    image_url: masterView.image_url,
    view_images: [masterView],
    view_count: 1,
    view_strategy: viewStrategy || 'progressive_layers',
    generation_contract_version: SCENE_GENERATION_CONTRACT_VERSION,
    partial_checkpoint: true,
    checkpoint_status: 'base_visual_ready',
    completed_view_keys: ['master'],
    failed_view_keys: [],
    provider_used: masterView.provider_used,
    prompt,
    knowledge_policy_trace: knowledgeRuntime.trace(knowledgePolicy),
    repair_plan: {
      version: SCENE_REPAIR_PLAN_VERSION,
      action: 'regenerate_failed_views',
      view_keys: missing,
      view_labels: missing.map(sceneViewLabel),
      count: missing.length,
      reasons: ['基础主视角已保存；仅继续缺失的空间增强视图'],
      message: `基础场景已保存；后续只补 ${missing.map(sceneViewLabel).join('、') || '缺失增强项'}。`,
    },
    scene_layer: {
      contract_version: sceneLayerContract.CONTRACT_VERSION,
      core_revision: core.core_revision,
      core_fingerprint: core.core_fingerprint,
      base_visual: core.core.base_visual,
    },
    scene_authority_fingerprint: currentCoreFingerprint,
  });
  const sceneAssets = mergeSceneAssets(storage.getOutput(taskId, 'scene_assets') || [], baseAsset);
  storage.saveOutput(taskId, 'scene_assets', sceneAssets);
  const nextCtx = { ...ctx, scene_assets: sceneAssets };
  storage.saveOutput(taskId, 'context', nextCtx);
  storage.updateTask(taskId, { request: nextCtx, updated_at: new Date().toISOString() });
  storage.saveStage(taskId, 'scene_asset', {
    status: 'running',
    output_summary: '基础场景主视角已安全保存，正在生成可续跑增强视图',
    diagnostics: {
      scene_id: target.scene_id,
      base_visual_hash: masterArtifact.asset_hash,
      missing_enhancements: missing,
    },
  });
  return { core, asset: baseAsset, scene_assets: sceneAssets, preserved_previous: false };
}

function finishWithBaseScene({ taskId, target, basePublication, checkpoint, error, progressMode, progressViewKeys } = {}) {
  const billingUnknown = ['unknown', 'submitted_unknown'].includes(String(error?.billingState || error?.billing_state || '').toLowerCase());
  const stored = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || []);
  const index = stored.findIndex(item => String(item.scene_id || item.id) === String(target.scene_id));
  const completed = SCENE_GENERATION_ORDER.filter(key => !!sceneCheckpoint.checkpointView(checkpoint, key));
  const failed = [...new Set([
    ...(Array.isArray(error?.failed_view_keys) ? error.failed_view_keys : []),
    ...SCENE_GENERATION_ORDER.filter(key => key !== 'master' && !completed.includes(key)),
  ])];
  // Merge newly completed checkpoint views into any existing repair source.
  // Failed/rejected keys have no successful checkpoint URL and therefore keep
  // their previous saved asset instead of deleting already paid images.
  if (index >= 0) {
    stored[index] = normalizeSceneAsset({
      ...sceneCheckpointProjection.mergeSuccessfulCheckpointViews(stored[index], checkpoint),
      partial_checkpoint: true,
      checkpoint_status: 'enhancement_pending',
      checkpoint_error_code: error?.code || 'SCENE_ENHANCEMENT_FAILED',
      completed_view_keys: completed,
      failed_view_keys: failed,
      repair_plan: {
        version: SCENE_REPAIR_PLAN_VERSION,
        action: 'regenerate_failed_views',
        view_keys: failed,
        view_labels: failed.map(sceneViewLabel),
        count: failed.length,
        reasons: [cleanText(error?.message || '空间增强视图未完成', 300)],
        message: `基础场景可用；下次只继续 ${failed.map(sceneViewLabel).join('、')}。`,
      },
    });
    storage.saveOutput(taskId, 'scene_assets', stored);
    const task = storage.getTask(taskId) || {};
    const currentCtx = storage.getOutput(taskId, 'context') || task.request || {};
    const nextCtx = { ...currentCtx, scene_assets: stored };
    storage.saveOutput(taskId, 'context', nextCtx);
    storage.updateTask(taskId, { request: nextCtx, retryable: true });
  }
  // Persist every completed paid view before propagating cancellation or
  // billing-unknown failures. Those failures must block retries, not discard
  // already returned assets from the canonical scene record.
  if (billingUnknown || error?.code === 'USER_CANCELLED' || error?.cancelled === true) throw error;
  storage.saveStage(taskId, 'scene_asset', {
    status: 'warning',
    output_summary: basePublication?.preserved_previous
      ? '本次增强未完成，上一版已验证场景保持不变'
      : '基础场景已保存；空间增强未完成，可从缺失项继续',
    diagnostics: {
      scene_id: target.scene_id,
      base_visual_ready: true,
      completed_view_keys: completed,
      missing_view_keys: failed,
      enhancement_error_code: error?.code || 'SCENE_ENHANCEMENT_FAILED',
    },
  });
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'complete',
    sceneId: target.scene_id,
    viewKeys: progressViewKeys,
    verificationState: 'base_visual_ready',
  });
  const asset = index >= 0 ? stored[index] : basePublication?.asset;
  return {
    scene_asset: asset,
    scene_assets: stored,
    base_visual_ready: true,
    enhancement_pending: true,
    completed_view_keys: completed,
    missing_view_keys: failed,
    preserved_previous: basePublication?.preserved_previous === true,
    retryable: true,
  };
}

function authoritativeSceneGenerationBody(input = {}, target = {}, currentPrompt = {}) {
  const authoritativeSceneDescription = sceneSpecProjection.sceneDescriptionForSpec(
    target.scene_spec,
    target.space?.description || '',
  );
  return {
    ...input,
    scene_id: target.scene_id,
    space_id: target.space_id,
    scene_spec: target.scene_spec,
    require_complete_scene_spec: true,
    ...(target.space ? {
      name: target.space.name,
      description: authoritativeSceneDescription,
      scene_description: authoritativeSceneDescription,
    } : {}),
    // This must stay after every structural spread: it is the exact paid-provider
    // prompt authority and must never be replaced by a derived description.
    prompt: currentPrompt.generation_prompt,
    prompt_version_id: currentPrompt.prompt_version_id,
  };
}

async function generateSceneAsset(taskId, body = {}, runOptions = {}) {
  cancellation.throwIfCancelled(taskId);
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const requestedSceneId = cleanText(body.space_id || body.spaceId || body.scene_id || body.sceneId, 120);
  const currentPrompt = scenePromptConfirmation.assertCurrentPrompt(taskId, requestedSceneId, body);
  const generationId = cleanText(
    runOptions.generationId || body.generation_id || body.generationId || task.active_generation_id || '',
    100,
  );
  const baseCtx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const storedSceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  let target = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig: storedSceneConfig,
    context: baseCtx,
    body: {
      ...body,
      scene_spec: undefined,
      sceneSpec: undefined,
      allow_incomplete_scene_spec: false,
      require_complete_scene_spec: true,
    },
  });
  target = sceneSpecProjection.ensureNarrativeDescription(target);
  const ctx = { ...baseCtx, scene_spec: target.scene_spec };
  const knowledgePolicy = knowledgeRuntime.resolveTaskMany({ storage, taskId, context: ctx, selectors: [{ stage: 'scene_asset', assetType: 'scene' }] });
  const sceneConfig = target.isolated_scene_config;
  body = authoritativeSceneGenerationBody(body, target, currentPrompt);
  assertCompleteUpgradeSceneSpec(body);
  assertSceneRightsPreflight(ctx, body);
  const existing = runOptions.existingSceneAssets || storage.getOutput(taskId, 'scene_assets') || baseCtx.scene_assets || [];
  const sceneId = target.scene_id;
  const previous = normalizeSceneAssets(existing).find(item => String(item.scene_id) === String(sceneId));
  const repairViewKeys = previous ? normalizeRepairViewKeys(runOptions.repairViewKeys) : [];
  const repairMode = !!previous && repairViewKeys.length > 0;
  const previousViews = new Map((previous?.view_images || []).map((view, index) => {
    const normalized = normalizeSceneView(view, index);
    return [normalized.key, normalized];
  }));
  const repairFeedback = cleanText(runOptions.repairFeedback || '', 1200);
  const promptBody = repairFeedback ? { ...body, repair_feedback: repairFeedback } : body;
  const requested = sceneRequest(ctx, body);
  const materialReferences = sceneMaterialReferenceImages(ctx, body);
  const layoutRequired = needsLayoutView();
  const requiredViewKeys = layoutRequired ? SCENE_GENERATION_ORDER : SCENE_VIEW_KEYS;
  const viewAcquisition = sceneViewStrategy.resolveSceneViewStrategy({
    requested: body.view_strategy || body.viewStrategy || 'auto',
    requiredViews: requiredViewKeys,
    uploadedViewCount: Array.isArray(body.view_images) ? body.view_images.length : 0,
    videoAcquisitionEnabled: false,
    qualityTier: body.video_quality || body.videoQuality || ctx.video_quality,
    resolution: body.video_resolution || body.videoResolution || ctx.video_resolution,
  });
  if (!repairMode
    && runOptions.maintenanceLegacyAcquisition !== true
    && viewAcquisition.selected !== 'uploaded_views'
    && viewAcquisition.selected !== 'atlas_2x2'
    && viewAcquisition.selected !== 'image_derived') {
    viewAcquisition.fallback_reason = 'new_scene_contract_v7_requires_atlas';
    viewAcquisition.selected = 'atlas_2x2';
  }
  const atlasMode = !repairMode && viewAcquisition.selected === 'atlas_2x2';
  const progressViewKeys = repairMode ? repairViewKeys : requiredViewKeys;
  const checkpointViewKeys = atlasMode
    ? ['atlas', ...progressViewKeys]
    : progressViewKeys;
  const progressMode = repairMode ? 'repair' : 'generate';
  const visualMedium = worldSetting.primaryVisualMedium(ctx.world_setting);
  const scenePrompt = buildSceneSheetPrompt({ ctx, sceneConfig, body: promptBody, outputRole: 'contract', knowledgePolicy });
  const layoutPrompt = buildLayoutAcquisitionPrompt({ ctx, body: promptBody, knowledgePolicy });
  const prompt = buildDerivedViewPrompt(scenePrompt, 'master', {
    referenceOrder: [],
    repairFeedback,
    visualMedium,
  });
  const previousSceneRevision = Math.max(0, Number(previous?.scene_revision || 0) || 0);
  const requestedRevision = Math.max(1, previousSceneRevision + 1);
  const persistedCheckpoint = storage.getOutput(taskId, sceneCheckpoint.outputKind(sceneId));
  const checkpointPreviousRevision = (
    persistedCheckpoint
    && ['running', 'partial', 'ready_for_qa'].includes(String(persistedCheckpoint.status || ''))
    && Number(persistedCheckpoint.candidate_revision || 0) > 0
  )
    ? Math.max(0, Number(persistedCheckpoint.candidate_revision) - 1)
    : null;
  const fingerprintPayload = {
    generation_contract_version: SCENE_GENERATION_CONTRACT_VERSION, knowledge_generation_fingerprint: knowledgePolicy.generation_fingerprint,
    scene_id: sceneId,
    requested,
    scene_prompt: scenePrompt,
    layout_prompt: layoutPrompt,
    repair_view_keys: repairViewKeys,
    repair_feedback: repairFeedback,
    material_references: materialReferences,
    aspect_ratio: body.aspect_ratio || body.aspectRatio || '16:9',
    resolution: body.resolution || '2K',
    quality: body.quality || 'standard',
    // Execution model is intentionally excluded from the semantic checkpoint
    // identity so changing model after a failure resumes only missing views.
    image_model: 'gpt-image-2',
    generation_order: requiredViewKeys,
    view_strategy: viewAcquisition.selected,
    previous_revision: previousSceneRevision,
  };
  const fingerprint = sceneCheckpoint.inputFingerprint(fingerprintPayload);
  const legacyPromptFingerprintText = legacyScenePromptFingerprintText(
    scenePrompt,
    layoutPrompt,
    requested.negative,
  );
  const compatibleRevisionBases = [
    previousSceneRevision,
    ...(checkpointPreviousRevision === null ? [] : [checkpointPreviousRevision]),
  ];
  const compatibleFingerprints = [...new Set(compatibleRevisionBases.flatMap(previousRevision => ([
    sceneCheckpoint.inputFingerprint({
      ...fingerprintPayload,
      previous_revision: previousRevision,
    }),
    sceneCheckpoint.inputFingerprint({
      ...fingerprintPayload,
      previous_revision: previousRevision,
      scene_prompt: legacyPromptFingerprintText.scenePrompt,
      layout_prompt: legacyPromptFingerprintText.layoutPrompt,
    }),
  ])))].filter(value => value !== fingerprint);
  const singleAttempt = body.single_attempt === true || body.singleAttempt === true;
  const selectedImageModel = body.image_model || body.imageModel || 'auto';
  const initialBudget = sceneGenerationBudget(runOptions.generationBudget, singleAttempt);
  const openedCheckpoint = sceneCheckpoint.open({
    taskId,
    sceneId,
    fingerprint,
    candidateRevision: requestedRevision,
    viewKeys: checkpointViewKeys,
    retryBudget: initialBudget,
    acknowledgeBillingUnknown: body.acknowledge_billing_unknown === true
      || body.acknowledgeBillingUnknown === true,
    acknowledgedBy: cleanText(
      body.billing_acknowledged_by || body.billingAcknowledgedBy || baseCtx.user_id || '',
      100,
    ),
    metadata: {
      mode: progressMode,
      space_id: target.space_id,
      multi_scene: target.multi_scene,
      generation_contract_version: SCENE_GENERATION_CONTRACT_VERSION,
      reference_graph: atlasMode ? {
        atlas: [],
        master: ['atlas'],
        reverse: ['atlas'],
        interaction: ['atlas'],
        detail: ['atlas'],
        layout: ['atlas'],
      } : {
        master: [],
        layout: ['master'],
        reverse: ['master', 'layout'],
        interaction: ['master', 'layout'],
        detail: ['master'],
      },
      generation_id: generationId,
      prompt_policy_version: 'domestic-positive-contract-v2', knowledge_policy_trace: knowledgeRuntime.trace(knowledgePolicy),
    },
    compatibleFingerprints,
  });
  const checkpoint = openedCheckpoint.checkpoint;
  sceneCheckpoint.assertUniqueCandidateFilenames(checkpoint, checkpointViewKeys);
  const revision = checkpoint.candidate_revision;
  const generationBudget = sceneGenerationBudget(runOptions.generationBudget || {
    maxExtra: checkpoint.retry_budget?.max_extra,
    usedExtra: checkpoint.retry_budget?.used_extra,
    reasons: checkpoint.retry_budget?.reasons,
  }, singleAttempt);
  const selectedView = key => sceneCheckpoint.checkpointView(checkpoint, key)
    || (repairMode && !repairViewKeys.includes(key) ? previousViews.get(key) : null);
  const shouldGenerate = key => !selectedView(key);
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'preparing',
    sceneId,
    viewKeys: progressViewKeys,
    initialViewStates: sceneCheckpoint.initialViewStates(checkpoint, progressViewKeys),
  });
  let atlasBundle = null;
  let atlasResult = atlasMode ? selectedView('atlas') : null;
  if (atlasMode) {
    if (!atlasResult) {
      updateSceneGenerationProgress(taskId, {
        mode: progressMode,
        phase: 'generation',
        viewKeys: progressViewKeys,
        viewKey: 'master',
        viewStatus: 'running',
      });
      atlasResult = await generateCheckpointedSceneView(taskId, 'atlas', {
        taskId,
        stage: sceneImageStage('atlas'),
        prompt: sceneAtlas.buildSceneAtlasPrompt(scenePrompt, { repairFeedback, visualMedium }),
        filename: sceneCheckpoint.candidateFilename(checkpoint, 'atlas'),
        aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
        resolution: body.resolution || '2K',
        quality: body.quality || 'standard',
        imageModel: selectedImageModel,
        singleAttempt,
        referenceImages: materialReferences,
        requireReferences: materialReferences.length > 0,
        inputFidelity: materialReferences.length > 0 ? 'low' : undefined,
        auditSafePrompt: sceneAtlas.buildSceneAtlasPrompt(
          buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'master' }),
          { repairFeedback, visualMedium },
        ).slice(0, 2500),
      }, { mode: progressMode, viewKeys: progressViewKeys }, generationBudget, checkpoint);
    }
    const reusablePerspectiveViews = sceneAtlas.ATLAS_VIEW_KEYS
      .map(key => selectedView(key))
      .filter(Boolean);
    if (reusablePerspectiveViews.length !== sceneAtlas.ATLAS_VIEW_KEYS.length) {
      try {
        atlasBundle = await sceneAtlas.splitSceneAtlas({
          source: atlasResult,
          taskId,
          sceneId,
          revision,
        });
        atlasBundle.views.forEach(view => {
          sceneCheckpoint.markSucceeded(checkpoint, view.key, view, generationBudget);
          updateSceneGenerationProgress(taskId, {
            mode: progressMode,
            phase: 'generation',
            viewKeys: progressViewKeys,
            viewKey: view.key,
            viewStatus: 'succeeded',
          });
        });
      } catch (error) {
        sceneCheckpoint.markPartial(checkpoint, error);
        error.partial_scene_checkpoint = true;
        error.completed_view_keys = ['atlas'];
        error.failed_view_keys = [...sceneAtlas.ATLAS_VIEW_KEYS];
        error.scene_id = sceneId;
        throw error;
      }
    } else {
      const first = reusablePerspectiveViews[0];
      atlasBundle = {
        parent: {
          asset_id: first.parent_asset_id || '',
          sha256: first.parent_sha256 || '',
          url: atlasResult.url || atlasResult.image_url || '',
          image_url: atlasResult.image_url || atlasResult.url || '',
          provider_used: atlasResult.provider_used || '',
        },
        views: reusablePerspectiveViews,
      };
    }
  }
  const master = shouldGenerate('master')
    ? await generateCheckpointedSceneView(taskId, 'master', {
      taskId,
      stage: sceneImageStage('master'),
      prompt,
      filename: sceneCheckpoint.candidateFilename(checkpoint, 'master'),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      quality: body.quality || 'standard',
      imageModel: selectedImageModel,
      singleAttempt,
      referenceImages: materialReferences,
      requireReferences: materialReferences.length > 0,
      inputFidelity: materialReferences.length > 0 ? 'low' : undefined,
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'master', knowledgePolicy }),
    }, { mode: progressMode, viewKeys: progressViewKeys }, generationBudget, checkpoint)
    : selectedView('master');
  cancellation.throwIfCancelled(taskId);
  const viewImages = [normalizeSceneView({
    ...master,
    key: 'master',
    label: sceneViewLabel('master'),
    url: master.url || master.image_url,
    image_url: master.image_url || master.url,
    provider_used: master.provider_used,
  }, 0)];
  const basePublication = publishBaseSceneAsset({
    taskId,
    target,
    body,
    ctx,
    existing,
    previous,
    master: viewImages[0],
    atlas: atlasResult,
    revision,
    checkpoint,
    requested,
    prompt,
    knowledgePolicy,
    viewStrategy: viewAcquisition.selected,
    repairMode,
  });
  let layout = selectedView('layout');
  let layoutAcquisition = checkpoint.layout_acquisition || previous?.view_acquisition?.layout_preflight || null;
  let layoutFailure = null;
  if (shouldGenerate('layout')) {
    let layoutCorrection = repairFeedback;
    for (let qualityAttempt = 1; qualityAttempt <= 2; qualityAttempt += 1) {
      if (qualityAttempt > 1) {
        if (!reserveExtraAttempt(generationBudget, 'layout_quality_retry')) break;
        sceneCheckpoint.syncRetryBudget(checkpoint, generationBudget);
      }
      try {
        layout = await generateCheckpointedSceneView(taskId, 'layout', {
          taskId,
          stage: sceneImageStage('layout'),
          prompt: buildDerivedViewPrompt(layoutPrompt, 'layout', {
            referenceOrder: atlasMode ? ['atlas'] : ['master'],
            repairFeedback: layoutCorrection,
            visualMedium,
          }),
          filename: sceneCheckpoint.candidateFilename(checkpoint, 'layout'),
          aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
          resolution: body.resolution || '2K',
          quality: body.quality || 'standard',
          imageModel: selectedImageModel,
          singleAttempt,
          referenceImages: atlasMode
            ? [atlasResult.url || atlasResult.image_url]
            : [master.url || master.image_url],
          requireReferences: true,
          inputFidelity: 'low',
          auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'layout', knowledgePolicy }),
        }, { mode: progressMode, viewKeys: progressViewKeys }, generationBudget, checkpoint);
      } catch (error) {
        const billingUnknown = ['unknown', 'submitted_unknown']
          .includes(String(error?.billingState || error?.billing_state || '').toLowerCase());
        if (!billingUnknown) {
          return finishWithBaseScene({ taskId, target, basePublication, checkpoint, error, progressMode, progressViewKeys });
        }
        layoutFailure = error;
        break;
      }
      if (exactSceneViewDuplicate(layout, [master])) {
        layoutAcquisition = {
          pass: false,
          layout_role_score: 0,
          footprint_coverage_score: 0,
          overhead_verticality_score: 0,
          boundary_completeness_score: 0,
          estimated_downward_pitch_degrees: 0,
          visible_horizon: false,
          dominant_vertical_wall_face: false,
          complete_perimeter_visible: false,
          ceiling_removed_or_not_visible: false,
          master_like_composition: true,
          scene_identity_score: 1,
          camera_relocation_score: 0,
          reasons: ['俯视布局与主视角文件完全相同，没有发生相机迁移'],
          deterministic_duplicate: true,
        };
        sceneCheckpoint.setLayoutAcquisition(checkpoint, layoutAcquisition);
      } else {
        try {
          layoutAcquisition = await sceneSpace.validateLayoutAcquisition({
            taskId,
            masterUrl: sceneVisionThumbnailUrl(master.url || master.image_url),
            layoutUrl: sceneVisionThumbnailUrl(layout.url || layout.image_url),
            requested,
          });
          sceneCheckpoint.setLayoutAcquisition(checkpoint, layoutAcquisition);
        } catch (error) {
          cancellation.throwIfCancelled(taskId);
          console.warn('[new_story_ad:layout_preflight_unavailable]', {
            task_id: taskId,
            scene_id: sceneId,
            revision,
            code: error?.code || 'VISION_QA_UNAVAILABLE',
            message: String(error?.message || error || '').slice(0, 240),
          });
          layoutAcquisition = null;
          break;
        }
      }
      if (layoutAcquisition.pass) break;
      const layoutRoleError = new Error((layoutAcquisition.reasons || []).join('；') || '俯视布局没有通过角色验证');
      layoutRoleError.code = layoutAcquisition.deterministic_duplicate === true
        ? 'SCENE_VIEW_EXACT_DUPLICATE'
        : 'LAYOUT_ROLE_INVALID';
      layoutRoleError.retryable = true;
      sceneCheckpoint.markFailed(checkpoint, 'layout', layoutRoleError, generationBudget);
      if (qualityAttempt >= 2) {
        sceneCheckpoint.markPartial(checkpoint, layoutRoleError);
        layoutRoleError.partial_scene_checkpoint = true;
        layoutRoleError.completed_view_keys = ['master'];
        layoutRoleError.failed_view_keys = ['layout'];
        return finishWithBaseScene({ taskId, target, basePublication, checkpoint, error: layoutRoleError, progressMode, progressViewKeys });
      }
      layoutCorrection = [
        repairFeedback,
        'Automated layout-role validation rejected the previous candidate.',
        ...(layoutAcquisition.reasons || []),
        'Relocate to an 82-90 degree near-vertical top-down camera and reveal the complete usable footprint and every boundary; do not imitate the rejected master-like composition.',
      ].filter(Boolean).join(' ');
    }
  }
  cancellation.throwIfCancelled(taskId);
  const layoutView = normalizeSceneView({
    key: 'layout',
    label: sceneViewLabel('layout'),
    url: layout?.url || layout?.image_url || '',
    image_url: layout?.image_url || layout?.url || '',
    provider_used: layout?.provider_used || '',
  }, REQUIRED_SCENE_VIEW_KEYS.indexOf('layout'));
  cancellation.throwIfCancelled(taskId);
  const generateDerivedView = async (key, index) => {
    if (!shouldGenerate(key)) return normalizeSceneView(selectedView(key), index + 1);
    const detailView = key === 'detail';
    if (!detailView && !(layout?.url || layout?.image_url)) {
      const dependencyError = new Error(`${sceneViewLabel(key)}等待布局视图核账后继续，当前未提交供应商`);
      dependencyError.code = 'SCENE_LAYOUT_REQUIRED';
      dependencyError.billingState = 'not_submitted';
      dependencyError.providerSubmissionState = 'not_submitted';
      throw dependencyError;
    }
    const referenceImages = detailView
      ? [master.url || master.image_url]
      : [master.url || master.image_url, layout.url || layout.image_url];
    const generated = await generateCheckpointedSceneView(taskId, key, {
      taskId,
      stage: sceneImageStage(key),
      prompt: buildDerivedViewPrompt(scenePrompt, key, {
        referenceOrder: detailView ? ['master'] : ['master', 'layout'],
        repairFeedback,
        visualMedium,
      }),
      filename: sceneCheckpoint.candidateFilename(checkpoint, key),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      quality: body.quality || 'standard',
      imageModel: selectedImageModel,
      singleAttempt,
      referenceImages,
      requireReferences: true,
      // Reverse and interaction views require a real camera relocation. Detail
      // keeps high fidelity because only crop/scale should change.
      inputFidelity: detailView ? 'high' : 'low',
      auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: key, knowledgePolicy }),
    }, { mode: progressMode, viewKeys: progressViewKeys }, generationBudget, checkpoint);
    if (exactSceneViewDuplicate(generated, detailView ? [master] : [master, layout])) {
      const duplicateError = new Error(`${sceneViewLabel(key)}与其参考视图文件完全相同，没有形成独立机位或景别`);
      duplicateError.code = 'SCENE_VIEW_EXACT_DUPLICATE';
      duplicateError.retryable = true;
      sceneCheckpoint.markFailed(checkpoint, key, duplicateError, generationBudget);
      throw duplicateError;
    }
    return normalizeSceneView({
      key,
      label: sceneViewLabel(key),
      url: generated.url || generated.image_url,
      image_url: generated.image_url || generated.url,
      provider_used: generated.provider_used,
    }, index + 1);
  };
  // Submit dependent paid views in authority order. A provider-level billing
  // ambiguity opens the shared model circuit before the next unit is selected,
  // so other users and later scenes fail fast without creating more unknown
  // charges. Successful units remain independently checkpointed.
  const derivedResults = [];
  for (const [index, key] of SCENE_VIEW_KEYS.slice(1).entries()) {
    try {
      derivedResults.push({ status: 'fulfilled', value: await generateDerivedView(key, index) });
    } catch (reason) {
      derivedResults.push({ status: 'rejected', reason });
      if (singleAttempt) {
        while (derivedResults.length < SCENE_VIEW_KEYS.slice(1).length) {
          derivedResults.push({ status: 'rejected', reason });
        }
        break;
      }
    }
  }
  const derivedFailures = derivedResults
    .map((result, index) => ({ result, key: SCENE_VIEW_KEYS.slice(1)[index] }))
    .filter(item => item.result.status === 'rejected');
  if (derivedFailures.length || layoutFailure) {
    const firstDerivedFailure = derivedFailures[0]?.result?.reason;
    const firstError = layoutFailure || (firstDerivedFailure instanceof Error
      ? firstDerivedFailure
      : new Error(String(firstDerivedFailure || '场景派生视图生成失败')));
    sceneCheckpoint.markPartial(checkpoint, firstError);
    firstError.partial_scene_checkpoint = true;
    firstError.completed_view_keys = progressViewKeys.filter(key => !!sceneCheckpoint.checkpointView(checkpoint, key));
    firstError.failed_view_keys = [...new Set([...(layoutFailure ? ['layout'] : []), ...derivedFailures.map(item => item.key)])];
    return finishWithBaseScene({ taskId, target, basePublication, checkpoint, error: firstError, progressMode, progressViewKeys });
  }
  const derivedViews = derivedResults.map(result => result.value);
  cancellation.throwIfCancelled(taskId);
  viewImages.push(...derivedViews);
  viewImages.push(layoutView);
  sceneCheckpoint.markReadyForQa(checkpoint);
  const contractOptions = {
    taskId,
    sceneId,
    revision,
    views: viewImages.map(view => ({
      ...view,
      url: sceneVisionThumbnailUrl(view.url || view.image_url),
      image_url: sceneVisionThumbnailUrl(view.image_url || view.url),
    })),
    requested,
    layoutRequired,
    layoutAcquisition,
    knowledgePolicyQaBlock: knowledgeRuntime.qaBlock(knowledgePolicy),
  };
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'verification',
    viewKeys: progressViewKeys,
  });
  let sceneContract = null;
  try {
    sceneContract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    // Generated scene images are paid assets. Once all views exist, a verifier
    // failure must never discard them or make the next click regenerate them.
    // Cancellation/deadline still wins through the shared cancellation guard.
    cancellation.throwIfCancelled(taskId);
    console.warn('[new_story_ad:scene_vision_unavailable]', {
      task_id: taskId,
      scene_id: sceneId,
      revision,
      code: error?.code || 'VISION_QA_UNAVAILABLE',
      message: String(error?.message || error || '').slice(0, 300),
    });
    // Keep the five successfully generated views instead of discarding costly
    // assets because the verifier is unavailable or malformed. The package remains
    // explicitly unverified and can be rechecked later; it is never mislabeled
    // as having passed commercial visual QA.
    sceneContract = sceneSpace.buildUnverifiedContract(contractOptions, error);
  }
  const localizedViews = await localizeSceneViews(viewImages, { taskId, sceneId, revision });
  sceneContract = relinkContractViews(sceneContract, localizedViews);
  viewImages.splice(0, viewImages.length, ...localizedViews);
  const providerUsed = [...new Set(viewImages.map(v => v.provider_used).filter(Boolean))].join(', ') || master.provider_used || layout.provider_used || '';
  const repairPlan = buildSceneRepairPlan({
    scene_contract: sceneContract,
    view_images: viewImages,
    view_strategy: viewAcquisition.selected,
    space_asset_contract: atlasMode
      ? sceneAtlas.buildSpaceAssetContract({
        spaceId: target.space_id,
        sceneId,
        revision,
        atlas: atlasBundle,
        views: viewImages,
        layout: layoutView,
      })
      : null,
    view_acquisition: {
      selected: viewAcquisition.selected,
      layout_appearance_role: LAYOUT_APPEARANCE_ROLE,
    },
  });
  const repairHistory = [
    ...(Array.isArray(previous?.repair_history) ? previous.repair_history : []),
    ...(repairMode ? [{
      plan_version: SCENE_REPAIR_PLAN_VERSION,
      source_revision: previous.scene_revision || 1,
      revision,
      regenerated_view_keys: repairViewKeys,
      result: sceneContract.full_space_lock === true ? 'verified' : (sceneContract.qa_unavailable === true ? 'unavailable' : 'rejected'),
      created_at: new Date().toISOString(),
    }] : []),
    ...(runOptions.rebuildAtlas === true ? [{
      plan_version: SCENE_REPAIR_PLAN_VERSION,
      source_revision: Math.max(1, Number(runOptions.rebuildSourceRevision || previous?.scene_revision || 1) || 1),
      revision,
      regenerated_view_keys: [...SCENE_GENERATION_ORDER],
      provider_image_call_count: 2,
      result: sceneContract.full_space_lock === true ? 'verified' : (sceneContract.qa_unavailable === true ? 'unavailable' : 'rejected'),
      created_at: new Date().toISOString(),
    }] : []),
  ].slice(-8);
  const asset = normalizeSceneAsset({
    id: sceneId,
    scene_id: sceneId,
    space_id: target.space_id,
    name: target.space?.name || body.name || sceneConfig.advertised_subject || '剧情广告任务场景',
    source: 'new_story_ad_scene_sheet',
    scene_revision: revision,
    lock_strength: body.lock_strength || body.lockStrength || 'standard',
    layout_summary: body.layout_summary || body.layoutSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).layoutText || sceneConfig.business_boundary || ctx.brief || '',
    material_summary: body.material_summary || body.materialSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).materialLightText || '',
    interaction_summary: body.interaction_summary || body.interactionSummary || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).interactionText || '', structured_scene_contract: requested.structured_scene_contract,
    scene_experience_contract: (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).sceneExperienceContract
      || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).scene_experience_contract
      || {},
    style_summary: ctx.controlled_production?.style_control?.notes || '',
    negative: [
      '空场景资产，不要出现真人、背影、侧脸、手、身体局部、模特、人形剪影或人物倒影。',
      body.negative || (body.scene_spec || body.sceneSpec || ctx.scene_spec || {}).negativeText || ctx.controlled_production?.negative_control?.text || '',
    ].filter(Boolean).join('；'),
    surface_topology: requested.surface_topology,
    material_contract: requested.material_contract,
    material_reference_available: requested.material_reference_available,
    image_url: viewImages[0]?.url || '',
    view_images: viewImages.map(view => ({
      ...view,
      label: sceneViewLabel(view.key),
      provider_used: view.provider_used || providerUsed,
    })),
    view_count: viewImages.length,
    view_strategy: viewAcquisition.selected,
    generation_contract_version: SCENE_GENERATION_CONTRACT_VERSION,
    space_asset_contract: atlasMode
      ? sceneAtlas.buildSpaceAssetContract({
        spaceId: target.space_id,
        sceneId,
        revision,
        atlas: atlasBundle,
        views: viewImages,
        layout: layoutView,
      })
      : null,
    view_acquisition: {
      ...viewAcquisition,
      generation_contract_version: SCENE_GENERATION_CONTRACT_VERSION,
      layout_policy: 'required_for_all_new_scenes',
      layout_appearance_role: LAYOUT_APPEARANCE_ROLE,
      layout_preflight: layoutAcquisition,
      generation_order: atlasMode ? ['atlas', 'local_crops', 'layout'] : SCENE_GENERATION_ORDER,
      provider_image_call_count: atlasMode ? 2 : SCENE_GENERATION_ORDER.length,
      local_crop_count: atlasMode ? sceneAtlas.ATLAS_VIEW_KEYS.length : 0,
      last_generated_views: repairMode ? repairViewKeys : SCENE_GENERATION_ORDER,
      repair_mode: repairMode,
      checkpoint_schema_version: sceneCheckpoint.CHECKPOINT_SCHEMA_VERSION,
      resumed_from_checkpoint: openedCheckpoint.resumed === true,
      checkpoint_resume_count: Number(checkpoint.resume_count || 0) || 0,
      reference_graph: atlasMode ? {
        atlas: [],
        master: ['atlas'],
        reverse: ['atlas'],
        interaction: ['atlas'],
        detail: ['atlas'],
        layout: ['atlas'],
      } : {
        master: [],
        layout: ['master'],
        reverse: ['master', 'layout'],
        interaction: ['master', 'layout'],
        detail: ['master'],
      },
    },
    provider_used: providerUsed,
    prompt,
    knowledge_policy_trace: knowledgeRuntime.trace(knowledgePolicy),
    scene_contract: sceneContract,
    cross_view_qa: sceneContract.cross_view_qa,
    requirement_qa: sceneContract.requirement_qa,
    photographic_realism_qa: sceneContract.photographic_realism_qa,
    camera_design_qa: sceneContract.camera_design_qa,
    layout_contract: sceneContract.layout_contract,
    spatial_coverage_qa: sceneContract.spatial_coverage_qa,
    verification: sceneContract.verification,
    repair_plan: repairPlan,
    repair_history: repairHistory,
  });
  const enhancementCandidate = sceneLayerContract.stageEnhancement(taskId, sceneId, {
    reference_evidence: {
      strategy: viewAcquisition.selected,
      view_artifacts: viewImages.map(view => baseVisualArtifact(view, view.key, {
        scene_id: sceneId,
        scene_revision: revision,
      })).filter(Boolean),
    },
    spatial: {
      full_space_lock: sceneContract.full_space_lock === true,
      space_lock_status: sceneContract.space_lock_status,
      layout_contract: sceneContract.layout_contract,
      spatial_coverage_qa: sceneContract.spatial_coverage_qa,
    },
    visual_detail: {
      photographic_realism_qa: sceneContract.photographic_realism_qa,
      camera_design_qa: sceneContract.camera_design_qa,
      cross_view_qa: sceneContract.cross_view_qa,
    },
  }, { expected_core_fingerprint: basePublication?.core?.core_fingerprint });
  const activeEnhancement = sceneLayerContract.activateEnhancement(taskId, sceneId, {
    candidate_id: enhancementCandidate.candidate_id,
  });
  asset.scene_layer = {
    contract_version: sceneLayerContract.CONTRACT_VERSION,
    core_revision: basePublication?.core?.core_revision || 0,
    core_fingerprint: basePublication?.core?.core_fingerprint || '',
    enhancement_revision: activeEnhancement.enhancement_revision,
    enhancement_fingerprint: activeEnhancement.enhancement_fingerprint,
  };
  const sceneAssets = mergeSceneAssets(storage.getOutput(taskId, 'scene_assets') || [], asset);
  const publishOptions = {
    sceneSpec: target.multi_scene
      ? null
      : sceneSpecProjection.resolvedSceneSpec(body.scene_spec || body.sceneSpec || ctx.scene_spec || {}, requested),
  };
  if (runOptions.deferPublish !== true) saveSceneAssetsToTask(taskId, sceneAssets, publishOptions);
  const autoRepairPass = Math.max(0, Number(runOptions.autoRepairPass || 0) || 0);
  const autoRepairEligible = !repairMode
    && autoRepairPass < 1
    && sceneContract.qa_unavailable !== true
    && repairPlan.action === 'regenerate_failed_views'
    && repairPlan.view_keys.length > 0
    && repairPlan.view_keys.length <= remainingExtraAttempts(generationBudget);
  if (autoRepairEligible) {
    repairPlan.view_keys.forEach(key => reserveExtraAttempt(generationBudget, `auto_repair:${key}`));
    storage.saveStage(taskId, 'scene_asset', {
      status: 'running',
      output_summary: `自动验证发现 ${repairPlan.view_keys.length} 张视图需要修复，正在定向重做`,
    });
    return generateSceneAsset(taskId, {
      ...body,
      scene_id: sceneId,
    }, {
      generationId,
      repairViewKeys: repairPlan.view_keys,
      repairFeedback: repairPlan.reasons.join('；'),
      autoRepairPass: autoRepairPass + 1,
      generationBudget,
    });
  }
  if (sceneContract.full_space_lock !== true) {
    const verificationError = new Error(sceneContract.qa_unavailable === true
      ? '五张场景图片已保存，但视觉验证服务暂不可用；本次不会标记成功或进入下游。'
      : '五张场景图片已保存，但需求符合度、跨视图一致性或空间覆盖度未通过；本次不会标记成功或进入下游。');
    verificationError.code = sceneContract.qa_unavailable === true
      ? 'SCENE_VISUAL_QA_UNAVAILABLE'
      : 'SCENE_VISUAL_QA_REJECTED';
    verificationError.retryable = true;
    verificationError.scene_asset = asset;
    verificationError.scene_assets = sceneAssets;
    verificationError.repair_plan = repairPlan;
    if (runOptions.deferPublish !== true) sceneCheckpoint.markReviewRequired(checkpoint, asset, verificationError);
    storage.saveStage(taskId, 'scene_asset', {
      status: sceneContract.qa_unavailable === true ? 'warning' : 'review',
      output_summary: sceneContract.qa_unavailable === true
        ? '场景参考已保存，视觉验证服务暂不可用'
        : '场景参考已保存，但需求符合度、跨视图一致性或空间覆盖度尚未全部通过',
    });
    updateSceneGenerationProgress(taskId, {
      mode: progressMode,
      phase: 'verification',
      viewKeys: progressViewKeys,
      verificationState: sceneContract.verification?.state || sceneContract.status || '',
    });
    throw verificationError;
  }
  if (runOptions.deferPublish !== true) sceneCheckpoint.markPublished(checkpoint, asset);
  updateSceneGenerationProgress(taskId, {
    mode: progressMode,
    phase: 'complete',
    viewKeys: progressViewKeys,
    verificationState: sceneContract.verification?.state || sceneContract.status || '',
  });
  return {
    scene_asset: asset,
    scene_assets: sceneAssets,
    provider_used: providerUsed,
    verification_status: sceneContract.status,
    space_lock_status: sceneContract.space_lock_status,
    full_space_lock: sceneContract.full_space_lock === true,
    repair_plan: repairPlan,
    scene_spec: publishOptions.sceneSpec || null,
  };
}

async function repairSceneAsset(taskId, sceneId, body = {}, runOptions = {}) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  scenePromptConfirmation.assertCurrentPrompt(taskId, sceneId, body);
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assets = currentSceneAssets(taskId);
  const asset = assets.find(item => String(item.scene_id || item.id) === String(sceneId || ''));
  if (!asset) {
    const error = new Error('要修复的场景不存在');
    error.code = 'SCENE_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  if (sceneGenerationUpgradeRequired(asset)) {
    const error = new Error('当前图片来自旧版空间合同，不能继续局部修复；请完整重新生成当前场景');
    error.code = 'SCENE_FULL_REBUILD_REQUIRED';
    error.status = 409;
    throw error;
  }
  const plan = buildSceneRepairPlan(asset);
  if (plan.action === 'none') {
    const error = new Error('当前场景已经通过完整空间验证，无需重新生成');
    error.code = 'SCENE_ALREADY_VERIFIED';
    error.status = 409;
    throw error;
  }
  if (plan.action === 'reverify') {
    const error = new Error('当前修复计划缺少可定位的逐图证据，必须通过统一修复编排先完成诊断');
    error.code = 'SCENE_FIX_DIAGNOSIS_REQUIRED';
    error.status = 409;
    throw error;
  }
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {
    layoutText: asset.layout_summary || '',
    materialLightText: asset.material_summary || '',
    interactionText: asset.interaction_summary || '',
    negativeText: asset.negative || '',
    surfaceTopology: asset.surface_topology || {},
  };
  if (plan.action === 'rebuild_atlas') {
    return generateSceneAsset(taskId, {
      ...body,
      scene_id: asset.scene_id,
      space_id: asset.space_id || asset.scene_id,
      scene_spec: sceneSpec,
      name: asset.name,
      lock_strength: asset.lock_strength,
      view_strategy: 'atlas_2x2',
    }, {
      ...runOptions,
      existingSceneAssets: assets,
      repairFeedback: plan.reasons.join('；'),
      rebuildAtlas: true,
      rebuildSourceRevision: asset.scene_revision || 1,
    });
  }
  return generateSceneAsset(taskId, {
    ...body,
    scene_id: asset.scene_id,
    scene_spec: sceneSpec,
    name: asset.name,
    lock_strength: asset.lock_strength,
  }, {
    ...runOptions,
    existingSceneAssets: assets,
    repairViewKeys: plan.view_keys,
    repairFeedback: plan.reasons.join('；'),
  });
}

async function reverifySceneAsset(taskId, sceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assets = currentSceneAssets(taskId);
  const index = assets.findIndex(asset => String(asset.scene_id || asset.id) === String(sceneId || ''));
  if (index < 0) {
    const error = new Error('要重新验证的场景不存在');
    error.code = 'SCENE_ASSET_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const asset = assets[index];
  if (sceneGenerationUpgradeRequired(asset)) {
    const error = new Error('当前图片来自旧版空间合同，重复验证无法升级；请完整重新生成当前场景');
    error.code = 'SCENE_FULL_REBUILD_REQUIRED';
    error.status = 409;
    throw error;
  }
  const views = (asset.view_images || []).map(view => ({
    ...view,
    url: sceneVisionThumbnailUrl(view.url || view.image_url),
    image_url: sceneVisionThumbnailUrl(view.image_url || view.url),
  }));
  const requiredKeys = asset.layout_contract?.required === true || views.some(view => view.key === 'layout')
    ? REQUIRED_SCENE_VIEW_KEYS
    : SCENE_VIEW_KEYS;
  sceneViewCompleteness.assertComplete(views, requiredKeys);
  const contractOptions = {
    taskId,
    sceneId: asset.scene_id,
    revision: asset.scene_revision || 1,
    views,
    requested: {
      layout: asset.layout_summary || '',
      material_light: asset.material_summary || '',
      interaction: asset.interaction_summary || '',
      style: asset.style_summary || '',
      negative: asset.negative || '',
      surface_topology: asset.surface_topology || {},
      material_contract: asset.material_contract || shotDesign.normalizeMaterialContract({}, {
        sourceText: asset.material_summary || '',
        topology: asset.surface_topology || {},
        referenceAvailable: asset.material_reference_available === true,
      }),
      interaction_contract: {
        scene_empty: true,
        required_evidence: ['empty_clearance', 'reachable_target', 'access_route'], interaction_anchors: asset.structured_scene_contract?.interaction_anchors || [], movement_routes: asset.structured_scene_contract?.routes || [], story_states: asset.structured_scene_contract?.story_states || [], prop_placements: asset.structured_scene_contract?.prop_placements || [],
      },
      structured_scene_contract: asset.structured_scene_contract || {}, material_reference_available: asset.material_reference_available === true,
    },
    layoutRequired: asset.layout_contract?.required === true || views.some(view => view.key === 'layout'),
  };
  let contract;
  try {
    contract = await sceneSpace.analyzeSceneViews(contractOptions);
  } catch (error) {
    cancellation.throwIfCancelled(taskId);
    console.warn('[new_story_ad:scene_reverify_unavailable]', {
      task_id: taskId,
      scene_id: asset.scene_id,
      revision: asset.scene_revision || 1,
      code: error?.code || 'VISION_QA_UNAVAILABLE',
      message: String(error?.message || error || '').slice(0, 300),
    });
    contract = sceneSpace.buildUnverifiedContract(contractOptions, error);
  }
  assets[index] = {
    ...asset,
    scene_contract: contract,
    cross_view_qa: contract.cross_view_qa,
    requirement_qa: contract.requirement_qa,
    photographic_realism_qa: contract.photographic_realism_qa,
    camera_design_qa: contract.camera_design_qa,
    layout_contract: contract.layout_contract,
    spatial_coverage_qa: contract.spatial_coverage_qa,
    verification: contract.verification,
    repair_plan: buildSceneRepairPlan({ scene_contract: contract, view_images: asset.view_images || [] }),
  };
  saveSceneAssetsToTask(taskId, assets);
  return { scene_asset: assets[index], scene_assets: assets };
}

const fixSceneAsset = sceneAssetFix.create({
  storage, scenePromptConfirmation, assertContextConsistent, normalizeSceneAssets, currentSceneAssets,
  buildSceneRepairPlan, reverifySceneAsset, generateSceneAsset, repairSceneAsset,
});

module.exports = { SCENE_VIEW_KEYS, REQUIRED_SCENE_VIEW_KEYS, SCENE_GENERATION_ORDER, SCENE_IMAGE_STAGE_BY_VIEW, SCENE_IMAGE_MAX_ATTEMPTS, SCENE_IMAGE_EXTRA_ATTEMPTS, SCENE_GENERATION_CONTRACT_VERSION, sceneViewLabel, sceneImageStage, sceneViewContentHash, exactSceneViewDuplicate, assertCompleteUpgradeSceneSpec, assertSceneRightsPreflight, sceneMaterialReferenceImages, authoritativeSceneGenerationBody, buildSceneSheetPrompt, sceneStructuredContract: sceneStructuredContract.compile, sceneDescriptionForSpec: sceneSpecProjection.sceneDescriptionForSpec, buildLayoutAcquisitionPrompt, legacyScenePromptFingerprintText, buildDerivedViewPrompt, buildSceneAuditSafePrompt, sceneFailureDiagnostics: sceneFailureDiagnostics.project, sceneVisionThumbnailUrl, needsLayoutView, sceneRequest, buildSceneRepairPlan, sceneGenerationUpgradeRequired, normalizeSceneAssets, currentSceneAssetsFromBundle, currentSceneAssets, localizeSceneViews, localizeSceneAssets, saveSceneAssetsToTask, generateSceneAsset, repairSceneAsset, reverifySceneAsset, fixSceneAsset, _resetSceneImageCircuit: resetSceneImageCircuit };
