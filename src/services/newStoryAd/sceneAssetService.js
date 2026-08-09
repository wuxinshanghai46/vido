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
const generationSpecCompletion = require('./generationSpecCompletionService');
const visualAssetProgress = require('./visualAssetProgressService');
const productAssetResolver = require('./productAssetResolverService');
const sceneGenerationPolicy = require('./sceneGenerationPolicyService'), knowledgeRuntime = require('./knowledgePolicyRuntimeService');
const sceneSpecProjection = require('./sceneSpecProjectionService');
const sceneLayerContract = require('./sceneLayerContractService');

const SCENE_VIEW_KEYS = ['master', 'reverse', 'interaction', 'detail'];
const REQUIRED_SCENE_VIEW_KEYS = ['layout', ...SCENE_VIEW_KEYS];
const SCENE_GENERATION_ORDER = ['master', 'layout', 'reverse', 'interaction', 'detail'];
const SCENE_REPAIR_PLAN_VERSION = 5;
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

function sceneGenerationBudget(existing = null) {
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
  const viewImages = Array.isArray(asset.view_images)
    ? asset.view_images.map(normalizeSceneView).filter(view => view.url || view.image_url).slice(0, 8)
    : [];
  const primary = cleanText(asset.image_url || asset.url || viewImages[0]?.url || viewImages[0]?.image_url || '', 1000);
  if (!primary && !viewImages.length && !asset.layout_summary && !asset.material_summary) return null;
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
    billing_review_required: asset.billing_review_required === true,
    provider_used: cleanText(asset.provider_used || '', 240),
    prompt: cleanText(asset.prompt || '', 6000),
    repair_plan: repairPlan,
    repair_history: Array.isArray(asset.repair_history) ? asset.repair_history.slice(-8) : [],
    scene_layer: asset.scene_layer && typeof asset.scene_layer === 'object' ? asset.scene_layer : null,
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
  const previous = task.generation_progress?.stage === 'scene_asset'
    ? task.generation_progress
    : {};
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
    scene_id: cleanText(update.sceneId || update.scene_id || previous.scene_id || '', 120),
    generation_id: task.active_generation_id || previous.generation_id || '',
    mode: update.mode || previous.mode || 'generate',
    phase,
    status: terminal ? 'completed' : (phase === 'verification' ? 'verifying' : (failed ? 'failed' : 'running')),
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

function normalizeRepairViewKeys(input = []) {
  const source = Array.isArray(input) ? input : [];
  return SCENE_GENERATION_ORDER.filter(key => source.includes(key));
}

function buildSceneRepairPlan(asset = {}) {
  // Keep every caller on the same generation-contract boundary. Public bundle
  // normalization already applies this gate, but routes and future callers may
  // invoke the planner directly with a stored legacy asset.
  const hasDeclaredGenerationContract = Object.prototype.hasOwnProperty.call(asset, 'generation_contract_version')
    || Object.prototype.hasOwnProperty.call(asset.view_acquisition || {}, 'generation_contract_version');
  const looksLikeStoredGeneratedAsset = Boolean(asset.id || asset.scene_id)
    && (Boolean(asset.image_url) || (Array.isArray(asset.view_images) && asset.view_images.length > 0));
  if ((hasDeclaredGenerationContract || looksLikeStoredGeneratedAsset) && sceneGenerationUpgradeRequired(asset)) {
    return fullSceneUpgradePlan();
  }
  const contract = asset.scene_contract && typeof asset.scene_contract === 'object'
    ? asset.scene_contract
    : asset;
  const verificationState = cleanText(contract.verification?.state || asset.verification?.state || '', 40);
  // Paid regeneration requires concrete visible evidence for every issue. This
  // also protects old stored contracts and direct callers that bypass the
  // scene-contract normalizer.
  const issues = (Array.isArray(contract.view_issues) ? contract.view_issues : [])
    .filter(issue => cleanText(issue?.evidence || issue?.visual_evidence || '', 300));
  const reasons = issues.map(issue => cleanText(issue.reason || issue.code, 300)).filter(Boolean).slice(0, 8);
  if (contract.full_space_lock === true
    && Number(contract.schema_version || 0) >= 6
    && contract.camera_design_qa?.pass === true) {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'none', view_keys: [], view_labels: [], count: 0, reasons: [], message: '完整空间已经锁定，无需修复。' };
  }
  if (contract.qa_unavailable === true || verificationState === 'unavailable') {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons, message: '图片无需重新生成，请稍后再次验证。' };
  }
  if (!issues.length) {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons: [], message: '审核未提供逐图证据，禁止付费重生，请先再次验证。' };
  }
  const rootCodes = new Set(['ROOT_SCENE_IDENTITY_INVALID', 'ROOT_GEOMETRY_INVALID', 'ROOT_MATERIAL_IDENTITY_INVALID']);
  // A normal issue may target the master only. Expanding it to every dependent
  // view is allowed exclusively for an explicit ROOT failure.
  const rootFailure = issues.some(issue => rootCodes.has(issue.code));
  const keys = new Set(rootFailure
    ? SCENE_GENERATION_ORDER
    : issues.flatMap(issue => Array.isArray(issue.view_keys) ? issue.view_keys : []));
  const viewKeys = SCENE_GENERATION_ORDER.filter(key => keys.has(key));
  if (!viewKeys.length) {
    return { version: SCENE_REPAIR_PLAN_VERSION, action: 'reverify', view_keys: [], view_labels: [], count: 0, reasons, message: '审核证据未定位到具体视图，禁止付费重生，请先再次验证。' };
  }
  const atlasStrategy = cleanText(
    asset.view_strategy
    || asset.view_acquisition?.selected
    || asset.space_asset_contract?.strategy
    || '',
    40,
  ) === 'atlas_2x2';
  if (atlasStrategy && viewKeys.some(key => key !== 'layout')) {
    return {
      version: SCENE_REPAIR_PLAN_VERSION,
      action: 'rebuild_atlas',
      view_keys: [...SCENE_GENERATION_ORDER],
      view_labels: SCENE_GENERATION_ORDER.map(sceneViewLabel),
      count: 2,
      provider_image_call_count: 2,
      reasons: reasons.slice(0, 6),
      issue_codes: [...new Set(issues.map(issue => issue.code))],
      message: '透视视图来自同一张 2×2 空间母图，不能单独重做某一格；系统将重建整张母图并重新生成俯视布局，共 2 次图片调用。',
    };
  }
  return {
    version: SCENE_REPAIR_PLAN_VERSION,
    action: 'regenerate_failed_views',
    view_keys: viewKeys,
    view_labels: viewKeys.map(sceneViewLabel),
    count: viewKeys.length,
    reasons: reasons.slice(0, 6),
    issue_codes: [...new Set(issues.map(issue => issue.code))],
    message: `系统将只重做有逐图证据的 ${viewKeys.length} 张：${viewKeys.map(sceneViewLabel).join('、')}。`,
  };
}

function buildSceneSheetPrompt({ ctx = {}, sceneConfig = {}, body = {}, outputRole = 'master', knowledgePolicy = {} } = {}) {
  const subject = cleanText(ctx.product_subject || sceneConfig.advertised_subject || body.product_subject || '', 240);
  const sceneSpec = body.scene_spec || body.sceneSpec || ctx.scene_spec || {};
  const custom = cleanText(body.description || body.scene_description || body.prompt || '', 1200);
  const layout = cleanText(sceneSpec.layoutText || sceneSpec.layout_text || sceneSpec.layout || '', 800);
  const materialLight = cleanText(sceneSpec.materialLightText || sceneSpec.material_light_text || sceneSpec.material || sceneSpec.light || '', 800);
  const structuredScene = sceneStructuredContract.compileSpatialAsset(sceneSpec, ctx, body);
  const style = cleanText(ctx.controlled_production?.style_control?.notes || '', 420);
  const negative = cleanText(sceneSpec.negativeText || sceneSpec.negative_text || ctx.controlled_production?.negative_control?.text || body.negative || '', 800);
  const repairFeedback = cleanText(body.repair_feedback || body.repairFeedback || '', 1200);
  const materialReferences = sceneMaterialReferenceImages(ctx, body);
  const surfaceTopology = shotDesign.reconcileSceneSurfaceTopology(
    sceneSpec.surfaceTopology || sceneSpec.surface_topology,
    [layout, materialLight, negative, sceneSpec.surfaceTopology?.notes, sceneSpec.surface_topology?.notes],
  );
  const surfaceTopologyPrompt = surfaceTopology ? shotDesign.surfacePrompt(surfaceTopology, 'environment') : '';
  const materialContract = shotDesign.normalizeMaterialContract(sceneSpec.materialContract || sceneSpec.material_contract, {
    sourceText: materialLight,
    topology: surfaceTopology,
    referenceAvailable: materialReferences.length > 0,
  });
  const materialIdentityContract = [
    `Compiled material contract: ${JSON.stringify(materialContract)}.`,
    'Keep every task-provided proprietary or trade finish name as content authority; never substitute a nearby generic material.',
    'Material identity and surface topology are independent. Prove identity through task-supported observable cues, while obeying the compiled generation_scope and seam policy.',
    'Multiple finish terms do not authorize bands, swatches or catalogue panels unless the contract explicitly uses task_mapped_regions.',
    materialReferences.length
      ? 'The attached task reference image is appearance evidence for material colour, grain, reflectance and micro-relief only. It must not replace scene geometry or be copied as a sample board.'
      : 'No authoritative material sample image is attached. Translate proprietary or trade finish names only through the observable physical cues explicitly written in the task; do not invent segmentation to make an unfamiliar name visible.',
    repairFeedback
      ? 'The correction feedback has higher authority than appearance inherited from previous images. Preserve valid geometry, but replace any rejected appearance instead of imitating it.'
      : '',
  ].filter(Boolean).join(' ');
  const occupancyContract = 'Occupancy contract: capture the task-defined location before cast or action blocking, with every circulation path and interaction zone clear. Furnish the frame only with explicitly defined fixed structures, fixtures and spatial anchors.';
  const photographicRealism = [
    outputRole === 'layout'
      ? 'Visual medium lock: this must be a photoreal spatial-survey image of the task-appropriate physical environment, whether enclosed, semi-open or outdoor. Materials and lighting must remain physically believable, but camera coverage has priority over commercial-photo composition.'
      : 'Visual medium lock: this must be a real on-location photograph of the task-appropriate physical environment, whether enclosed, semi-open or outdoor, captured with a full-frame camera; it must not resemble an architectural visualization, material catalogue render, CGI concept image or virtual showroom.',
    outputRole === 'layout'
      ? 'Use near-orthographic projection with minimal perspective convergence, no visible horizon and no dominant vertical wall face. Keep geometry coherent and material scale realistic.'
      : 'Use plausible lens behaviour, slight optical imperfection, natural exposure roll-off, restrained sensor detail and coherent constructed geometry. Avoid sterile perfection and perfectly mirrored staging.',
    surfaceTopology?.mode === 'continuous' || surfaceTopology?.seam_policy === 'hidden'
      ? 'Use real-world material scale while preserving one optically uninterrupted primary plane: show subtle scratches, dust and uneven reflections as continuous micro-variation, but show no joint, gap, groove, recess or full-span tonal boundary on that surface.'
      : surfaceTopology?.primary_surface_count === 1
        ? 'Use real-world material scale on exactly one prominent task-material plane. Construction detail may exist within that plane only when task-supported, but must not create projecting returns, repeated bays, niches, columns, secondary display walls or duplicated material planes.'
      : 'Use real-world material scale: visible panel seams, joints, bevels, contact shadows, subtle scratches, fingerprints, dust, uneven reflections and construction details where appropriate.',
    'Lighting must be believable: real fixture placement, soft falloff, mixed practical/ambient light, grounded shadows, no impossible glow, no floating highlights, no overly dramatic bloom.',
    outputRole === 'layout'
      ? 'Use a near-vertical spatial-survey camera over the same location. Preserve the final materials, furniture, openings and lighting identity from the master while making the complete footprint readable. For an enclosed space, remove the ceiling and use low cutaway wall boundaries when necessary; for an open site, use a near-vertical aerial survey.'
      : 'Composition should feel like a still from a real commercial shoot: natural framing, usable negative space, practical foreground/background depth, not a perfect symmetric AI-generated set.',
    visualRealismPolicy.sceneRealismPrompt(),
  ].join('\n');
  const photographicEvidenceContract = 'Photographic evidence contract: use plausible optical behaviour, grounded contact shadows, physically consistent reflections, natural local variation, realistic wear and coherent constructed geometry throughout the frame.';
  const outputInstruction = outputRole === 'layout'
    ? [
      'Create one PHOTOREALISTIC NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT derived from the supplied master photograph of the same physical location.',
      'Use an 82 to 90 degree downward camera with near-orthographic perspective. Show the complete usable footprint and every scene boundary or task-defined edge in one frame, together with openings, fixed structures, anchor furniture, circulation and interaction zones.',
      'For an enclosed space, remove the ceiling and let wall tops appear only as low cutaway perimeter boundaries; do not let vertical wall faces dominate. For a semi-open or outdoor site, show the full task-defined site boundary from a near-vertical aerial camera.',
      'Preserve the master photograph’s final material identity, colour palette, lighting logic, furniture design and construction details. This is a photoreal spatial survey, not a labelled CAD plan, schematic diagram or unrelated redesigned location.',
      'Prioritize complete topology and relative positions. Any eye-level view, mild high-angle commercial shot, frontal wall crop, missing perimeter or master reframe is invalid.',
    ]
    : outputRole === 'contract'
      ? ['Use the following task-specific scene contract as the content authority for the requested spatial asset.']
    : [
      'Create one photorealistic MASTER REFERENCE VIEW for a reusable commercial video scene.',
      'Use a wide eye-level or slightly elevated three-quarter establishing composition derived from the locked spatial blueprint, clearly showing the usable ground/base, task-appropriate boundaries or edges, access points and anchor relations without looking top-down.',
      ];
  const outputCardinalityInstruction = outputRole === 'contract'
    ? 'This is an unoccupied scene content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain clean and physically coherent.'
    : 'This is an unoccupied scene asset captured as exactly one continuous, clean camera view.';
  return [
    ...outputInstruction,
    outputCardinalityInstruction,
    photographicRealism,
    outputRole === 'layout'
      ? 'Show the entire spatial footprint and all scene boundaries in one near-vertical overhead survey; do not use an eye-level, frontal or mild high-angle commercial-camera composition.'
      : outputRole === 'contract'
        ? 'Across all requested perspectives, make the complete spatial layout, fixed structures, access points and usable action zone physically legible without idealizing the place into a stock-photo set.'
      : 'Use a wide establishing composition that clearly defines the whole spatial layout and the relative position of fixed structures and movable anchors.',
    subject ? `Advertised subject: ${subject}` : '',
    custom ? `User scene requirement: ${custom}` : '',
    layout ? `Scene layout requirement: ${layout}` : '',
    materialLight ? `Scene material and lighting requirement: ${materialLight}` : '',
    structuredScene.has_evidence ? `Empty spatial-use contract (zones and routes only; never render the actors or actions that will use them later):\n${JSON.stringify(structuredScene)}` : '',
    surfaceTopologyPrompt ? `Task-specific surface construction contract:\n${surfaceTopologyPrompt}` : '',
    `Task-specific material identity contract:\n${materialIdentityContract}`,
    style ? `Visual style direction: ${style}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    occupancyContract,
    photographicEvidenceContract,
    negative ? 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.' : '',
    repairFeedback ? `Mandatory correction from the previous rejected attempt: ${repairFeedback}. Create a fresh role-correct image and do not reproduce the rejected composition.` : '',
    outputRole === 'layout'
      ? 'Final look target: a clean photoreal near-vertical top-down spatial survey of the same finished location, with the complete footprint and perimeter visible and free of readable typography, identifying marks or technical annotation.'
      : 'Final look target: real camera photography, authentic commercial location, natural commercial lighting, realistic materials, coherent spatial geometry and consistent perspective.',
  ].filter(Boolean).join('\n\n');
}

function buildLayoutAcquisitionPrompt({ ctx = {}, body = {}, knowledgePolicy = {} } = {}) {
  const requested = sceneRequest(ctx, body);
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  return [
    'Create one PHOTOREALISTIC NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT of the exact task-appropriate physical location in the supplied master, whether enclosed, semi-open or outdoor.',
    'Camera contract: relocate to an 82 to 90 degree downward camera with near-orthographic perspective. Do not preserve the master crop, eye-level height, frontal wall angle, azimuth or foreground/background arrangement.',
    'Framing pass criteria: the complete usable ground/base footprint and every scene boundary or task-defined edge must fit inside the frame; access points, fixed structures, anchor objects, circulation route and empty action zone must be readable together. For enclosed locations, remove the ceiling and show walls only as low cutaway perimeter boundaries. A visible horizon, dominant vertical wall face, frontal elevation, mild high-angle commercial shot, close crop, missing perimeter or master reframe is invalid.',
    'The master reference controls scene identity, material appearance, colours, object design and lighting logic only. It is not the target camera composition. Preserve relative positions without redesigning the location.',
    'Material identity and surface topology are independent constraints: preserve both without turning materials into sample bands, panels or unrelated region boundaries.',
    requested.layout ? `Spatial topology to reveal: ${requested.layout}` : '',
    requested.material_light ? `Appearance identity to preserve from the master: ${requested.material_light}` : '',
    requested.interaction ? 'Reserve and visibly locate the task-required empty action/interaction zone and its access route. Do not import any camera height, lens, tracking, close-up, wall-facing or cinematic movement instruction from the commercial shot description.' : '', requested.structured_scene_contract?.has_evidence ? `Map every declared empty interaction zone, circulation route and fixed prop placement into the same footprint: ${JSON.stringify(requested.structured_scene_contract)}` : '',
    topology ? `Surface construction identity to preserve: ${topology}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    requested.negative ? 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.' : '',
    'Output one unoccupied photoreal spatial-survey image with physically coherent geometry, near-parallel vertical projection and realistic task materials. Keep the frame clean, free of readable typography, identifying marks, technical annotations and multi-panel presentation.',
  ].filter(Boolean).join('\n\n').slice(0, 3600);
}

function legacyScenePromptFingerprintText(scenePrompt = '', layoutPrompt = '', negative = '') {
  const currentCardinality = 'This is an unoccupied scene content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain clean and physically coherent.';
  const legacyCardinality = 'This is an EMPTY SCENE content contract for a spatial asset. The outer acquisition instruction controls whether the result is a single view or a multi-panel atlas. Every requested perspective must remain unoccupied, unlabeled and physically coherent.';
  const currentOccupancy = 'Occupancy contract: capture the task-defined location before cast or action blocking, with every circulation path and interaction zone clear. Furnish the frame only with explicitly defined fixed structures, fixtures and spatial anchors.';
  const legacyOccupancy = 'Hard negative requirements: Absolutely empty scene only. No people, no human figure, no actor, no model, no presenter, no customer, no staff. No back view, no side profile, no face, no head, no hair, no body, no arms, no hands, no legs, no silhouette, no reflection of a person. Do not use human scale figures or mannequins as spatial references; use furniture, product plinths, counters, empty walking space or neutral props instead.';
  const currentEvidence = 'Photographic evidence contract: use plausible optical behaviour, grounded contact shadows, physically consistent reflections, natural local variation, realistic wear and coherent constructed geometry throughout the frame.';
  const legacyEvidence = 'Strict anti-AI / anti-render negatives: No CGI render look, no Unreal/Octane/3D render look, no plastic texture, no waxy surface, no over-smoothed material, no fantasy environment. No generic luxury template, no repeated procedural texture, no melted details, no impossible reflections, no glowing seams, no excessive contrast, no heavy HDR, no fake bokeh. No decorative text, no poster layout, no floating objects, no warped geometry, no inconsistent physical material cues across one authored finish.';
  const currentScope = 'Task-defined scope boundary: include only the location, structures, materials, fixtures and action zones explicitly defined above; exact exclusions remain enforced by local requirement QA.';
  const currentLayoutOutput = 'Output one unoccupied photoreal spatial-survey image with physically coherent geometry, near-parallel vertical projection and realistic task materials. Keep the frame clean, free of readable typography, identifying marks, technical annotations and multi-panel presentation.';
  const legacyLayoutOutput = 'Output one unoccupied photoreal spatial-survey image with physically coherent geometry, near-parallel vertical projection and realistic task materials. No person, text, labels, watermark, logo, collage, split screen, CAD linework, dimension marks or schematic annotation.';
  const legacyNegative = cleanText(negative || '', 800);
  const legacyLayoutNegative = cleanText(negative || '', 1000);
  return {
    scenePrompt: String(scenePrompt || '')
      .replace(currentCardinality, legacyCardinality)
      .replace(currentOccupancy, legacyOccupancy)
      .replace(currentEvidence, legacyEvidence)
      .replace(
        currentScope,
        legacyNegative ? `Additional negative requirements: ${legacyNegative}` : '',
      ),
    layoutPrompt: String(layoutPrompt || '')
      .replace(
        currentScope,
        legacyLayoutNegative
          ? `Task prohibitions that remain applicable to visible content: ${legacyLayoutNegative}`
          : '',
      )
      .replace(currentLayoutOutput, legacyLayoutOutput),
  };
}

async function localizeSceneViews(views = [], { taskId = '', sceneId = '', revision = 1 } = {}) {
  const normalized = (Array.isArray(views) ? views : []).map(normalizeSceneView);
  return Promise.all(normalized.map(async (view, index) => {
    const sourceUrl = view.url || view.image_url || '';
    if (!/^https?:\/\//i.test(sourceUrl)) return view;
    const persisted = await mediaAdapter.persistImageResult({
      result: { image_url: sourceUrl, url: sourceUrl },
      filename: `scene_asset_${taskId || 'task'}_${sceneId || 'scene'}_r${Math.max(1, Number(revision) || 1)}_${view.key || index}_${Date.now()}_${index}`,
      thumbnailWidths: [360, 560],
    });
    return normalizeSceneView({
      ...view,
      filename: persisted.filename,
      source_url: sourceUrl,
      url: persisted.url,
      image_url: persisted.image_url,
    }, index);
  }));
}

function relinkContractViews(contract = null, views = []) {
  if (!contract || typeof contract !== 'object') return contract;
  const viewMap = new Map((views || []).map(view => [String(view.key || ''), view.url || view.image_url || '']));
  return {
    ...contract,
    cameras: Array.isArray(contract.cameras) ? contract.cameras.map(camera => ({
      ...camera,
      reference_image_url: viewMap.get(String(camera.view_id || '')) || camera.reference_image_url || '',
    })) : contract.cameras,
    layout_contract: contract.layout_contract && typeof contract.layout_contract === 'object'
      ? {
        ...contract.layout_contract,
        reference_image_url: viewMap.get('layout') || contract.layout_contract.reference_image_url || '',
      }
      : contract.layout_contract,
  };
}

async function localizeSceneAssets(sceneAssets = [], { taskId = '' } = {}) {
  const normalized = normalizeSceneAssets(sceneAssets);
  const localized = [];
  for (const asset of normalized) {
    const views = await localizeSceneViews(asset.view_images || [], {
      taskId,
      sceneId: asset.scene_id || asset.id,
      revision: asset.scene_revision || 1,
    });
    const contract = relinkContractViews(asset.scene_contract, views);
    localized.push(normalizeSceneAsset({
      ...asset,
      image_url: views[0]?.url || asset.image_url || '',
      url: views[0]?.url || asset.url || '',
      view_images: views,
      scene_contract: contract,
      cross_view_qa: contract?.cross_view_qa || asset.cross_view_qa,
    }));
  }
  return localized;
}

function buildDerivedViewPrompt(scenePrompt = '', viewKey = '', options = {}) {
  const instruction = {
    layout: 'Generate a PHOTOREALISTIC NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT of the exact physical location shown in the master reference. Move the camera to an 82 to 90 degree downward pitch with near-orthographic perspective. Fit the complete usable footprint and every perimeter or task-defined edge inside the frame, together with access points, fixed structures, anchors, circulation route and empty action zone. For an enclosed space, remove the ceiling and show walls only as low cutaway perimeter boundaries. A visible horizon, dominant vertical wall face, mild high-angle commercial view, missing boundary, master reframe or unrelated location is invalid.',
    master: 'Generate the MASTER ESTABLISHING PHOTOGRAPH from the task-specific scene contract. Use a natural eye-level or slightly elevated three-quarter wide camera, not a top-down view. Show enough usable ground/base, task-appropriate boundaries or edges, access points and anchor relations to establish scale and depth. This master is the root visual identity for every later view, so create one coherent physical location without sample staging, catalogue bands or visualization styling.',
    reverse: 'Generate a TRUE REVERSE OR SIDE VIEW of the exact same physical space, not a small reframing of the master. Move the camera to a geometrically plausible opposite or side sector with at least about 90 degrees of azimuth change from the master camera. Swap the foreground/background relationship and reveal at least one wall, opening, boundary or anchor relation that the master cannot show clearly. Do not mirror the master, reuse its near-identical composition, or keep the camera in the same frontal sector. Preserve every fixed structure, opening, anchor object, material, color, light source and relative position.',
    interaction: 'Generate a DISTINCT INTERACTION-POSITION VIEW inside the exact same physical space. Place the camera at practical human eye/chest height beside the locked interaction zone. Clearly show an empty standing/action clearance, the reachable target surface or product position, and the route into and out of that zone. This must be a usable blocking camera, not another establishing shot and not a duplicate of the master or reverse view. Preserve all blueprint coordinates and do not add any person, mannequin or human reflection.',
    detail: 'Generate a TRUE MATERIAL / CONSTRUCTION DETAIL VIEW captured inside the exact same physical space. Use a close or macro crop that makes real material scale, texture direction, surface transition, contact shadow, fixture edge or permitted assembly detail readable. It must not be another wide room view. Use only materials, finishes, seams and fixtures supported by the blueprint and master. Respect the task-specific surface topology and seam policy; do not invent visible subdivisions, joints or decorative composition.',
  }[viewKey] || 'Generate another camera view of the exact same physical location without redesigning it.';
  const fallbackOrder = options.hasMasterReference === true
    ? (options.hasLayoutReference === false ? ['master'] : ['master', 'layout'])
    : (options.hasLayoutReference === false ? [] : ['layout']);
  const referenceOrder = (Array.isArray(options.referenceOrder) ? options.referenceOrder : fallbackOrder)
    .filter(key => key === 'layout' || key === 'master' || key === 'atlas');
  const hasAtlasReference = referenceOrder.includes('atlas');
  const hasLayoutReference = referenceOrder.includes('layout');
  const hasMasterReference = referenceOrder.includes('master');
  const referenceDescriptions = referenceOrder.map((key, index) => key === 'layout'
    ? `Reference image ${index + 1} is the master-derived near-vertical top-down spatial layout.`
    : key === 'atlas'
      ? `Reference image ${index + 1} is the canonical 2-by-2 perspective atlas of this one physical space.`
      : `Reference image ${index + 1} is the master establishing view.`);
  const referenceAuthority = [
    ...referenceDescriptions,
    hasLayoutReference
      ? 'The supplied near-vertical layout is the secondary authority for whole-space geometry, openings, zones and relative coordinates.'
      : '',
    hasLayoutReference
      ? 'It must describe the same finished location as the master and must never override the master with an unrelated layout, furniture set or surface design.'
      : '',
    hasMasterReference
      ? 'The supplied master view is the canonical authority for photographic appearance, material identity, color, lighting direction and object design.'
      : '',
    hasAtlasReference
      ? 'The supplied atlas is the canonical authority for cross-perspective geometry, fixed anchors, openings, material identity and lighting direction across the whole physical space.'
      : '',
    hasLayoutReference && hasMasterReference
      ? 'Resolve ambiguity with the master as the primary scene/appearance identity and the overview as secondary spatial-coordinate evidence; never redesign either source.'
      : '',
  ].filter(Boolean).join(' ');
  return [
    instruction,
    referenceAuthority,
    viewKey === 'layout'
      ? hasMasterReference
        ? 'This is a strict camera-relocation acquisition task. The master reference controls appearance and identity only: relocate away from its crop, wall-facing sector, eye-level elevation, ceiling-heavy framing and foreground/background arrangement.'
        : 'This is a strict camera-relocation acquisition task. The atlas controls appearance, identity and spatial relations; derive one new overhead survey rather than reproducing its panel arrangement or any source camera crop.'
      : viewKey === 'reverse' || viewKey === 'interaction'
      ? 'This is a deliberate camera relocation task. Preserve scene identity, but do not reproduce the master image pixel composition, crop, camera sector or foreground/background arrangement.'
      : '',
    'Output one continuous, unoccupied photorealistic camera view with clean framing, free of readable typography, identifying marks and multi-panel presentation.',
    'Scene identity lock is strict: preserve spatial geometry, anchor relations, material family and lighting direction.',
    cleanText(options.repairFeedback || '', 1200)
      ? `Mandatory correction from the previous rejected attempt: ${cleanText(options.repairFeedback, 1200)}. Do not repeat the rejected composition.`
      : '',
    cleanText(options.repairFeedback || '', 1200)
      ? 'Correction priority: if any reference image conflicts with the textual requirement, preserve only its valid geometry and replace the rejected appearance.'
      : '',
    scenePrompt,
  ].filter(Boolean).join('\n\n');
}

function buildSceneAuditSafePrompt({ ctx = {}, body = {}, viewKey = 'master', knowledgePolicy = {} } = {}) {
  if (viewKey === 'layout') {
    return buildLayoutAcquisitionPrompt({ ctx, body, knowledgePolicy }).slice(0, 2200);
  }
  const requested = sceneRequest(ctx, body);
  const roleInstruction = {
    layout: 'Create a photoreal near-vertical top-down whole-space layout derived from the supplied master. Use an 82-90 degree downward camera, fit the complete footprint and all boundaries in frame, and reveal openings, fixed anchors, circulation and interaction zones while preserving the same finished location. For an enclosed space, remove the ceiling and show only low cutaway wall boundaries.',
    master: 'Create the root master establishing photograph from the current task scene contract. Use an eye-level or slightly elevated three-quarter wide camera and define one coherent physical location.',
    reverse: 'Create a true reverse or side camera view of the supplied scene. Relocate the camera by about 90 degrees, exchange foreground and background, and reveal a boundary or opening hidden in the master view while preserving the same space.',
    interaction: 'Create a distinct practical interaction-position camera view inside the supplied scene. Clearly reveal the empty action clearance, reachable target surface and circulation route while preserving the same space.',
    detail: 'Create a close material and construction photograph inside the supplied scene. Make the task-required finish, its supported physical cues, surface transition, fixture edge and realistic material scale clearly readable.',
  }[viewKey] || 'Create a coherent photorealistic real-location reference.';
  const topology = requested.surface_topology
    ? shotDesign.surfacePrompt(requested.surface_topology, 'environment')
    : '';
  const appearanceRule = viewKey === 'layout'
    ? 'This overview must preserve the master photograph’s final material identity, colours, lighting and furniture. It is not a neutral diagram, clay render, dollhouse or floor-plan illustration.'
    : 'The named material identity must be visibly proven by task-supported physical cues. Surface continuity must never substitute or genericize the requested material family.';
  const materialEvidenceRule = requested.material_reference_available
    ? 'Use the attached task material reference only for colour, grain, reflectance and micro-relief; never copy its sample boundaries into the scene.'
    : 'No material sample is attached. Convert trade or proprietary names only into explicitly requested observable cues, without inventing panels, bands or region boundaries.';
  return [
    roleInstruction,
    'Output one real on-location photograph with natural perspective, plausible lens behaviour, physically coherent site geometry, realistic material scale and believable practical lighting; never output a visualization or CGI showroom render.',
    appearanceRule,
    materialEvidenceRule,
    requested.layout ? `Spatial design: ${requested.layout}` : '',
    requested.material_light ? `Materials and lighting: ${requested.material_light}` : '',
    requested.structured_scene_contract?.has_evidence
      ? `Empty spatial-use contract (zones and routes only; do not render cast or performances): ${JSON.stringify(requested.structured_scene_contract)}`
      : '',
    topology ? `Surface construction: ${topology}` : '',
    requested.style ? `Visual style: ${requested.style}` : '',
    knowledgeRuntime.promptBlock(knowledgePolicy),
    'The frame is an unoccupied spatial reference containing only the designed location and its intended fixtures. Use one clean camera view free of readable typography, identifying marks and multi-panel presentation.',
  ].filter(Boolean).join('\n\n').slice(0, 2200);
}

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
  checkpoint, requested, prompt, knowledgePolicy, viewStrategy,
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
  if (previous && previous.partial_checkpoint !== true) return { core, asset: previous, preserved_previous: true };
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
  });
  const sceneAssets = mergeSceneAssets(existing, baseAsset);
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
  if (billingUnknown || error?.code === 'USER_CANCELLED' || error?.cancelled === true) throw error;
  const stored = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || []);
  const index = stored.findIndex(item => String(item.scene_id || item.id) === String(target.scene_id));
  const completed = SCENE_GENERATION_ORDER.filter(key => !!sceneCheckpoint.checkpointView(checkpoint, key));
  const failed = [...new Set([
    ...(Array.isArray(error?.failed_view_keys) ? error.failed_view_keys : []),
    ...SCENE_GENERATION_ORDER.filter(key => key !== 'master' && !completed.includes(key)),
  ])];
  if (index >= 0 && stored[index].partial_checkpoint === true) {
    stored[index] = normalizeSceneAsset({
      ...stored[index],
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

async function generateSceneAsset(taskId, body = {}, runOptions = {}) {
  cancellation.throwIfCancelled(taskId);
  const task = storage.getTask(taskId);
  if (!task) throw new Error('任务不存在');
  const generationId = cleanText(
    runOptions.generationId || body.generation_id || body.generationId || task.active_generation_id || '',
    100,
  );
  const baseCtx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const storedSceneConfig = storage.getOutput(taskId, 'scene_config') || {};
  let target = sceneBinding.resolveSceneGenerationTarget({
    sceneConfig: storedSceneConfig,
    context: baseCtx,
    body: { ...body, allow_incomplete_scene_spec: true },
  });
  target = sceneSpecProjection.ensureNarrativeDescription(target);
  const sceneCompletion = await generationSpecCompletion.completeSceneSpec({
    taskId,
    brief: baseCtx.brief || task.request?.brief || '',
    productSubject: baseCtx.product_subject || task.request?.product_subject || '',
    contentMode: baseCtx.content_mode || baseCtx.product_presentation?.mode,
    sceneId: target.scene_id,
    sceneName: target.space?.name || body.name || '',
    sceneSpec: target.scene_spec,
  });
  if (sceneCompletion.changed) {
    target.scene_spec = sceneCompletion.scene_spec;
    const targetIndex = Array.isArray(target.scene_plan?.spaces)
      ? target.scene_plan.spaces.findIndex(space => String(space.id || space.space_id || space.scene_id) === String(target.scene_id))
      : -1;
    if (targetIndex >= 0) {
      target.scene_plan.spaces[targetIndex] = {
        ...target.scene_plan.spaces[targetIndex],
        description: sceneSpecProjection.sceneDescriptionForSpec(sceneCompletion.scene_spec, target.scene_plan.spaces[targetIndex].description),
        scene_spec: sceneCompletion.scene_spec,
      };
    }
    if (runOptions.deferPublish !== true) storage.saveOutput(taskId, 'scene_config', target.scene_plan);
    const completedCtx = {
      ...baseCtx,
      scene_mode: target.scene_plan.scene_mode,
      scene_spec: target.multi_scene ? baseCtx.scene_spec : sceneCompletion.scene_spec,
      generation_input_completion: {
        ...(baseCtx.generation_input_completion || {}),
        scene: { checkpoint_kind: sceneCompletion.checkpoint_kind, scene_id: target.scene_id, updated_at: new Date().toISOString() },
      },
    };
    if (runOptions.deferPublish !== true) {
      storage.saveOutput(taskId, 'context', completedCtx);
      storage.updateTask(taskId, { request: completedCtx, updated_at: new Date().toISOString() });
    }
  }
  if (target.submitted_scene_spec_used) {
    const targetIndex = Array.isArray(target.scene_plan?.spaces)
      ? target.scene_plan.spaces.findIndex(space => String(space.id || space.space_id || space.scene_id) === String(target.scene_id))
      : -1;
    if (targetIndex >= 0) {
      target.scene_plan.spaces[targetIndex] = {
        ...target.scene_plan.spaces[targetIndex],
        description: sceneSpecProjection.sceneDescriptionForSpec(target.scene_spec, target.scene_plan.spaces[targetIndex].description),
        scene_spec: target.scene_spec,
      };
    }
    if (runOptions.deferPublish !== true) storage.saveOutput(taskId, 'scene_config', target.scene_plan);
    const editedCtx = {
      ...baseCtx,
      scene_mode: target.scene_plan.scene_mode,
      scene_spec: target.multi_scene ? baseCtx.scene_spec : target.scene_spec,
    };
    if (runOptions.deferPublish !== true) {
      storage.saveOutput(taskId, 'context', editedCtx);
      storage.updateTask(taskId, { request: editedCtx, updated_at: new Date().toISOString() });
    }
  }
  const ctx = { ...baseCtx, scene_spec: target.scene_spec };
  const knowledgePolicy = knowledgeRuntime.resolveTaskMany({ storage, taskId, context: ctx, selectors: [{ stage: 'scene_asset', assetType: 'scene' }] });
  const sceneConfig = target.isolated_scene_config;
  const authoritativeSceneDescription = sceneSpecProjection.sceneDescriptionForSpec(target.scene_spec, target.space?.description || '');
  body = {
    ...body,
    scene_id: target.scene_id,
    space_id: target.space_id,
    scene_spec: target.scene_spec,
    ...(target.space ? {
      name: target.space.name,
      description: authoritativeSceneDescription,
      scene_description: authoritativeSceneDescription,
      prompt: authoritativeSceneDescription,
    } : {}),
  };
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
  const scenePrompt = buildSceneSheetPrompt({ ctx, sceneConfig, body: promptBody, outputRole: 'contract', knowledgePolicy });
  const layoutPrompt = buildLayoutAcquisitionPrompt({ ctx, body: promptBody, knowledgePolicy });
  const prompt = buildDerivedViewPrompt(scenePrompt, 'master', {
    referenceOrder: [],
    repairFeedback,
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
  const initialBudget = sceneGenerationBudget(runOptions.generationBudget);
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
  });
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
        prompt: sceneAtlas.buildSceneAtlasPrompt(scenePrompt, { repairFeedback }),
        filename: sceneCheckpoint.candidateFilename(checkpoint, 'atlas'),
        aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
        resolution: body.resolution || '2K',
        imageModel: 'gpt-image-2',
        referenceImages: materialReferences,
        requireReferences: materialReferences.length > 0,
        inputFidelity: materialReferences.length > 0 ? 'low' : undefined,
        auditSafePrompt: sceneAtlas.buildSceneAtlasPrompt(
          buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'master' }),
          { repairFeedback },
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
      imageModel: 'gpt-image-2',
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
  });
  let layout = selectedView('layout');
  let layoutAcquisition = checkpoint.layout_acquisition || previous?.view_acquisition?.layout_preflight || null;
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
          }),
          filename: sceneCheckpoint.candidateFilename(checkpoint, 'layout'),
          aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
          resolution: body.resolution || '2K',
          imageModel: 'gpt-image-2',
          referenceImages: atlasMode
            ? [atlasResult.url || atlasResult.image_url]
            : [master.url || master.image_url],
          requireReferences: true,
          inputFidelity: 'low',
          auditSafePrompt: buildSceneAuditSafePrompt({ ctx, body: promptBody, viewKey: 'layout', knowledgePolicy }),
        }, { mode: progressMode, viewKeys: progressViewKeys }, generationBudget, checkpoint);
      } catch (error) {
        return finishWithBaseScene({ taskId, target, basePublication, checkpoint, error, progressMode, progressViewKeys });
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
    url: layout.url || layout.image_url,
    image_url: layout.image_url || layout.url,
    provider_used: layout.provider_used,
  }, REQUIRED_SCENE_VIEW_KEYS.indexOf('layout'));
  cancellation.throwIfCancelled(taskId);
  const derivedResults = await Promise.allSettled(SCENE_VIEW_KEYS.slice(1).map(async (key, index) => {
    if (!shouldGenerate(key)) return normalizeSceneView(selectedView(key), index + 1);
    const detailView = key === 'detail';
    const referenceImages = detailView
      ? [master.url || master.image_url]
      : [master.url || master.image_url, layout.url || layout.image_url];
    const generated = await generateCheckpointedSceneView(taskId, key, {
      taskId,
      stage: sceneImageStage(key),
      prompt: buildDerivedViewPrompt(scenePrompt, key, {
        referenceOrder: detailView ? ['master'] : ['master', 'layout'],
        repairFeedback,
      }),
      filename: sceneCheckpoint.candidateFilename(checkpoint, key),
      aspectRatio: body.aspect_ratio || body.aspectRatio || '16:9',
      resolution: body.resolution || '2K',
      imageModel: 'gpt-image-2',
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
  }));
  const derivedFailures = derivedResults
    .map((result, index) => ({ result, key: SCENE_VIEW_KEYS.slice(1)[index] }))
    .filter(item => item.result.status === 'rejected');
  if (derivedFailures.length) {
    const firstError = derivedFailures[0].result.reason instanceof Error
      ? derivedFailures[0].result.reason
      : new Error(String(derivedFailures[0].result.reason || '场景派生视图生成失败'));
    sceneCheckpoint.markPartial(checkpoint, firstError);
    firstError.partial_scene_checkpoint = true;
    firstError.completed_view_keys = progressViewKeys.filter(key => !!sceneCheckpoint.checkpointView(checkpoint, key));
    firstError.failed_view_keys = derivedFailures.map(item => item.key);
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
  const sceneAssets = mergeSceneAssets(existing, asset);
  const publishOptions = {
    sceneSpec: target.multi_scene
      ? null
      : sceneSpecProjection.resolvedSceneSpec(body.scene_spec || body.sceneSpec || ctx.scene_spec || {}, requested),
  };
  if (runOptions.deferPublish !== true) saveSceneAssetsToTask(taskId, sceneAssets, publishOptions);
  if (runOptions.deferPublish !== true) sceneCheckpoint.markPublished(checkpoint, asset);
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
    storage.saveStage(taskId, 'scene_asset', {
      status: sceneContract.qa_unavailable === true ? 'warning' : 'review',
      output_summary: sceneContract.qa_unavailable === true
        ? '场景参考已保存，视觉验证服务暂不可用'
        : '场景参考已保存，但需求符合度、跨视图一致性或空间覆盖度尚未全部通过',
    });
  }
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
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assets = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || []);
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
    const error = new Error('当前图片没有内容缺陷，只需点击“再次验证”，无需付费重新生成');
    error.code = 'SCENE_REVERIFY_ONLY';
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
    repairViewKeys: plan.view_keys,
    repairFeedback: plan.reasons.join('；'),
  });
}

async function reverifySceneAsset(taskId, sceneId) {
  const task = storage.getTask(taskId);
  if (!task) throw new Error('没有找到对应项目。');
  const ctx = assertContextConsistent(storage.getOutput(taskId, 'context') || task.request || {});
  const assets = normalizeSceneAssets(storage.getOutput(taskId, 'scene_assets') || ctx.scene_assets || []);
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
  if (views.length < 4) {
    const error = new Error('场景资产缺少完整四视图，需先重新生成当前场景');
    error.code = 'SCENE_VIEWS_INCOMPLETE';
    error.status = 422;
    throw error;
  }
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
module.exports = { SCENE_VIEW_KEYS, REQUIRED_SCENE_VIEW_KEYS, SCENE_GENERATION_ORDER, SCENE_IMAGE_STAGE_BY_VIEW, SCENE_IMAGE_MAX_ATTEMPTS, SCENE_IMAGE_EXTRA_ATTEMPTS, SCENE_GENERATION_CONTRACT_VERSION, sceneViewLabel, sceneImageStage, sceneViewContentHash, exactSceneViewDuplicate, assertCompleteUpgradeSceneSpec, assertSceneRightsPreflight, sceneMaterialReferenceImages, buildSceneSheetPrompt, sceneStructuredContract: sceneStructuredContract.compile, sceneDescriptionForSpec: sceneSpecProjection.sceneDescriptionForSpec, buildLayoutAcquisitionPrompt, legacyScenePromptFingerprintText, buildDerivedViewPrompt, buildSceneAuditSafePrompt, sceneVisionThumbnailUrl, needsLayoutView, sceneRequest, buildSceneRepairPlan, sceneGenerationUpgradeRequired, normalizeSceneAssets, localizeSceneViews, localizeSceneAssets, saveSceneAssetsToTask, generateSceneAsset, repairSceneAsset, reverifySceneAsset, _resetSceneImageCircuit: resetSceneImageCircuit };
