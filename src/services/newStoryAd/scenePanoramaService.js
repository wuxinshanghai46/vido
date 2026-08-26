const crypto = require('crypto');
const storage = require('./storageService');
const mediaAdapter = require('./mediaAdapter');
const modelGateway = require('./modelGateway');
const cancellation = require('./cancellationContext');
const sceneAssets = require('./sceneAssetService');
const projection = require('./panoramaProjectionService');
const sceneCheckpointProjection = require('./sceneCheckpointProjectionService');
const { sceneProjectionRows } = require('./taskViewService');
const pipelineModels = require('../pipelineModelService');
const modelCapabilities = require('../modelCapabilityService');
const scenePromptConfirmation = require('./scenePromptConfirmationService');

const PANORAMA_CONTRACT_VERSION = 1;
const CHECKPOINT_OUTPUT_KIND = 'scene_panorama_checkpoints';
const PANORAMA_STAGE = 'new_story_ad.scene_panorama';
const PANORAMA_QA_STAGE = 'new_story_ad.scene_panorama_qa';

function clean(value, max = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parseJson(value = '') {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return {};
}

function numberScore(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

function panoramaRows(scene = {}) {
  scene = scene || {};
  const worldAssets = scene.scene_world_assets && typeof scene.scene_world_assets === 'object'
    ? scene.scene_world_assets
    : {};
  return list(worldAssets.panoramas || scene.panoramas || scene.panorama_images);
}

function authoritativePanorama(scene = {}, expectedSourceFingerprint = '') {
  scene = scene || {};
  const currentSource = sourceView(scene);
  const currentFingerprint = expectedSourceFingerprint
    || (currentSource ? sourceFingerprint(scene, currentSource) : '');
  return panoramaRows(scene).find(item => item?.status === 'active_verified'
    && item?.qa?.pass === true
    && currentFingerprint
    && item?.source_fingerprint === currentFingerprint
    && Number(item?.source_scene_revision || 0) + 1 === Number(scene?.scene_revision || 0)) || null;
}

function sourceView(scene = {}) {
  const views = list(scene.view_images);
  return views.find(view => clean(view.key || view.view, 60) === 'master')
    || views.find(view => clean(view.image_url || view.url, 1200))
    || (scene.image_url || scene.url ? { key: 'master', image_url: scene.image_url || scene.url } : null);
}

function sourceFingerprint(scene = {}, source = {}) {
  const contract = scene.scene_contract && typeof scene.scene_contract === 'object'
    ? scene.scene_contract
    : {};
  const semanticContractFingerprint = clean(contract.reference_fingerprint, 100) || fingerprint({
    schema_version: contract.schema_version,
    scene_id: contract.scene_id,
    scene_revision: contract.scene_revision,
    requested_layout: contract.requested_layout,
    requested_material_light: contract.requested_material_light,
    requested_interaction: contract.requested_interaction,
    requested_style: contract.requested_style,
    requested_negative: contract.requested_negative,
    requested_surface_topology: contract.requested_surface_topology,
    requested_material_contract: contract.requested_material_contract,
    requested_interaction_contract: contract.requested_interaction_contract,
    anchors: contract.anchors,
    zones: contract.zones,
    geometry_facts: contract.geometry_facts,
    materials: contract.materials,
    lighting: contract.lighting,
    cameras: contract.cameras,
    status: contract.status,
  });
  return fingerprint({
    contract_version: PANORAMA_CONTRACT_VERSION,
    scene_id: clean(scene.scene_id || scene.id, 120),
    source_key: clean(source.key || source.view, 60),
    source_url: clean(source.image_url || source.url, 1200),
    source_sha256: clean(source.file_sha256 || source.sha256, 80),
    layout_summary: clean(scene.layout_summary, 1200),
    material_summary: clean(scene.material_summary, 1200),
    interaction_summary: clean(scene.interaction_summary, 1000),
    style_summary: clean(scene.style_summary, 800),
    scene_contract_hash: semanticContractFingerprint,
  });
}

function storedAssets(taskId) {
  const outputs = storage.listOutputs(taskId);
  const invalidation = storage.getManifest(taskId)?.invalidated?.scene_assets || null;
  const projected = sceneCheckpointProjection.projectSceneAssets(sceneProjectionRows(outputs, invalidation));
  return sceneAssets.normalizeSceneAssets(projected);
}

function findScene(taskId, sceneId) {
  const assets = storedAssets(taskId);
  const scene = assets.find(item => clean(item.scene_id || item.id, 120) === clean(sceneId, 120));
  if (!scene) {
    const error = new Error('当前场景资产不存在，请先完成场景生成');
    error.code = 'SCENE_ASSET_NOT_FOUND';
    error.status = 404;
    error.retryable = false;
    throw error;
  }
  return { assets, scene };
}

function checkpointPayload(taskId) {
  const stored = storage.getOutput(taskId, CHECKPOINT_OUTPUT_KIND);
  return stored && typeof stored === 'object' ? stored : { schema_version: 1, scenes: {} };
}

function saveCheckpoint(taskId, sceneId, patch = {}) {
  const payload = checkpointPayload(taskId);
  const prior = payload.scenes?.[sceneId] || {};
  const next = { ...prior, ...patch, scene_id: sceneId, updated_at: new Date().toISOString() };
  storage.saveOutput(taskId, CHECKPOINT_OUTPUT_KIND, {
    schema_version: 1,
    scenes: { ...(payload.scenes || {}), [sceneId]: next },
    updated_at: next.updated_at,
  });
  return next;
}

function updateProgress(taskId, patch = {}) {
  const task = storage.getTask(taskId);
  if (!task) return null;
  const previous = task.generation_progress?.stage === 'scene_panorama' ? task.generation_progress : {};
  const next = {
    schema_version: 1,
    stage: 'scene_panorama',
    generation_id: clean(patch.generation_id || previous.generation_id || task.active_generation_id, 120),
    scene_id: clean(patch.scene_id || previous.scene_id, 120),
    phase: clean(patch.phase || previous.phase || 'preparing', 60),
    status: clean(patch.status || previous.status || 'running', 60),
    progress: Math.max(0, Math.min(100, Number(patch.progress ?? previous.progress ?? 0) || 0)),
    message: clean(patch.message || previous.message, 260),
    paid_stage: clean(patch.paid_stage || previous.paid_stage, 100),
    model_call_plan: patch.model_call_plan || previous.model_call_plan || { panorama_generation: 1, panorama_qa: 1, local_projection: 0, depth: 0, spatial_reconstruction: 0 },
    started_at: previous.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(patch.finished_at ? { finished_at: patch.finished_at } : {}),
  };
  storage.updateTask(taskId, { generation_progress: next });
  return next;
}

function generationPrompt(scene = {}, source = {}, options = {}) {
  return [
    'Create one seamless 360-degree equirectangular panorama for the exact same scene shown in the reference image.',
    'Output contract: a single 2:1 latitude-longitude panorama, full 360 horizontal coverage, continuous left/right wraparound seam, level horizon, stable verticals and physically coherent geometry.',
    'The supplied image is the authoritative forward view. Preserve its architecture, layout, fixed objects, material family, light direction, weather/time state and visual identity. Extend only the unseen surroundings needed to complete the same world.',
    'Do not turn this into a collage, contact sheet, fisheye, tiny planet, cubemap, multi-panel layout, floor plan or a different location. Do not add text, labels, borders, people, products or brand marks unless already present in the authoritative source.',
    `Scene name: ${clean(scene.name, 160)}`,
    scene.layout_summary ? `Layout authority: ${clean(scene.layout_summary, 1000)}` : '',
    scene.material_summary ? `Material authority: ${clean(scene.material_summary, 800)}` : '',
    scene.interaction_summary ? `Fixed interaction anchors: ${clean(scene.interaction_summary, 700)}` : '',
    scene.style_summary ? `Visual state: ${clean(scene.style_summary, 600)}` : '',
    options.route_brief ? `Areas that must remain navigationally legible: ${clean(options.route_brief, 800)}` : '',
    `Source view role: ${clean(source.key || 'master', 60)}`,
  ].filter(Boolean).join('\n');
}

async function reviewPanorama({ taskId, scene, source, panorama, derivedViews, gateway = modelGateway } = {}) {
  const imageUrls = [source.image_url || source.url, panorama.image_url, derivedViews?.[0]?.image_url, derivedViews?.[2]?.image_url]
    .map(mediaAdapter.absolutePublicImageUrl)
    .filter(Boolean);
  const result = await gateway.generateVision({
    taskId,
    stage: PANORAMA_QA_STAGE,
    systemPrompt: [
      'You are a strict 360 scene continuity inspector for general-purpose visual production.',
      'Image 1 is the authoritative source view, image 2 is the complete equirectangular panorama, and remaining images are deterministic perspective projections from that panorama.',
      'Evaluate only supplied scene facts. Never inject assumptions from a named industry, room type, geography or business category.',
      'Reject a different location, broken wraparound geometry, duplicated dominant structures, impossible doors/walls, incompatible materials or failure to preserve the authoritative source view.',
      'Return JSON only. All reason strings must be concise Simplified Chinese.',
    ].join('\n'),
    userPrompt: 'Scene evidence: ' + JSON.stringify({
      name: clean(scene.name, 160),
      layout: clean(scene.layout_summary, 1000),
      materials: clean(scene.material_summary, 800),
      fixed_anchors: clean(scene.interaction_summary, 700),
    }).slice(0, 5000)
      + '\nReturn pass boolean and required numeric scores from 0 to 1: source_fidelity_score, geometry_consistency_score, wraparound_consistency_score, projection_consistency_score. Also return mismatch_reasons string array. pass=true requires every score >= 0.70.',
    imageUrls,
    maxTokens: 1800,
    timeoutMs: 90000,
    maxCandidates: 1,
    stageBudgetMs: 90000,
  });
  const parsed = parseJson(result.text);
  const qa = {
    source_fidelity_score: numberScore(parsed.source_fidelity_score),
    geometry_consistency_score: numberScore(parsed.geometry_consistency_score),
    wraparound_consistency_score: numberScore(parsed.wraparound_consistency_score),
    projection_consistency_score: numberScore(parsed.projection_consistency_score),
    mismatch_reasons: list(parsed.mismatch_reasons).slice(0, 12).map(value => clean(value, 260)),
    vision_model: clean(result.used_model, 160),
    checked_at: new Date().toISOString(),
  };
  const required = [qa.source_fidelity_score, qa.geometry_consistency_score, qa.wraparound_consistency_score, qa.projection_consistency_score];
  const schemaValid = required.every(value => value > 0);
  if (!schemaValid) {
    const error = new Error('全景视觉质检缺少必需评分，候选图未发布为权威场景');
    error.code = 'PANORAMA_QA_SCHEMA_INVALID';
    error.retryable = true;
    throw error;
  }
  qa.pass = parsed.pass === true && required.every(value => value >= 0.70);
  return qa;
}

function modelCallPlan(overrides = {}) {
  return {
    panorama_generation: Math.max(0, Number(overrides.panorama_generation ?? 1) || 0),
    panorama_qa: Math.max(0, Number(overrides.panorama_qa ?? 1) || 0),
    local_projection: 0,
    depth: 0,
    spatial_reconstruction: 0,
    mode: 'panorama_3dof',
  };
}

function panoramaModelRoutePlan() {
  const required = pipelineModels.NEW_STORY_AD_PANORAMA_REQUIRED_CAPABILITIES || [];
  const configured = pipelineModels.pickAllEnabledWithDefault(PANORAMA_STAGE);
  const models = configured.map(model => modelCapabilities.modelCapabilityReport(model, required));
  return {
    required_capabilities: required,
    configured_model_count: configured.length,
    supported_model_count: models.filter(model => model.supported).length,
    models,
  };
}

function planForScene(taskId, sceneId) {
  const { scene } = findScene(taskId, sceneId);
  const source = sourceView(scene);
  if (!source || !clean(source.image_url || source.url, 1200)) {
    const error = new Error('当前场景没有可作为 360 扩展依据的主视图');
    error.code = 'PANORAMA_SOURCE_VIEW_REQUIRED';
    error.status = 422;
    error.retryable = false;
    throw error;
  }
  const sourceKey = sourceFingerprint(scene, source);
  const checkpoint = checkpointPayload(taskId).scenes?.[sceneId] || {};
  const existing = authoritativePanorama(scene, sourceKey);
  const sameSource = checkpoint.source_fingerprint === sourceKey;
  const blockedStatus = sameSource && ['provider_submitting', 'provider_submitted', 'qa_running'].includes(checkpoint.status)
    ? checkpoint.status
    : '';
  const routePlan = panoramaModelRoutePlan();
  const operation = existing
    ? 'reuse'
    : blockedStatus
      ? 'billing_review_required'
      : sameSource && checkpoint.status === 'qa_failed' && checkpoint.generated?.image_url
        ? 'reverify'
        : (routePlan.supported_model_count ? 'generate' : 'model_capability_required');
  const calls = operation === 'reuse' || operation === 'billing_review_required' || operation === 'model_capability_required'
    ? modelCallPlan({ panorama_generation: 0, panorama_qa: 0 })
    : operation === 'reverify'
      ? modelCallPlan({ panorama_generation: 0, panorama_qa: 1 })
      : modelCallPlan();
  const basis = {
    contract_version: PANORAMA_CONTRACT_VERSION,
    task_id: clean(taskId, 120),
    scene_id: clean(sceneId, 120),
    source_fingerprint: sourceKey,
    source_scene_revision: Number(scene.scene_revision || 1) || 1,
    operation,
    model_call_plan: calls,
  };
  return {
    ...basis,
    plan_fingerprint: fingerprint(basis),
    blocked: !!blockedStatus || operation === 'model_capability_required',
    blocking_status: blockedStatus || (operation === 'model_capability_required' ? 'model_capability_required' : ''),
    model_route_plan: routePlan,
    paid_call_count: calls.panorama_generation + calls.panorama_qa,
    existing_panorama_id: clean(existing?.id, 160),
    checkpoint_updated_at: clean(checkpoint.updated_at, 80),
    pricing_status: 'provider_billing_not_configured',
  };
}

function planForTask(taskId) {
  const assets = storedAssets(taskId);
  const scenes = [];
  const unavailable = [];
  for (const scene of assets) {
    const sceneId = clean(scene.scene_id || scene.id, 120);
    if (!sceneId) continue;
    try {
      scenes.push(planForScene(taskId, sceneId));
    } catch (error) {
      unavailable.push({ scene_id: sceneId, error_code: error?.code || 'PANORAMA_PLAN_FAILED' });
    }
  }
  const basis = {
    contract_version: PANORAMA_CONTRACT_VERSION,
    task_id: clean(taskId, 120),
    scene_plans: scenes.map(plan => ({
      scene_id: plan.scene_id,
      plan_fingerprint: plan.plan_fingerprint,
      operation: plan.operation,
    })),
  };
  const totalModelCallPlan = scenes.reduce((total, plan) => ({
    panorama_generation: total.panorama_generation + Number(plan.model_call_plan?.panorama_generation || 0),
    panorama_qa: total.panorama_qa + Number(plan.model_call_plan?.panorama_qa || 0),
    local_projection: 0,
    depth: 0,
    spatial_reconstruction: 0,
    mode: 'panorama_3dof',
  }), modelCallPlan({ panorama_generation: 0, panorama_qa: 0 }));
  return {
    ...basis,
    plan_fingerprint: fingerprint(basis),
    scenes,
    unavailable,
    scene_count: scenes.length,
    blocked_count: scenes.filter(plan => plan.blocked).length,
    model_call_plan: totalModelCallPlan,
    paid_call_count: totalModelCallPlan.panorama_generation + totalModelCallPlan.panorama_qa,
    pricing_status: 'provider_billing_not_configured',
  };
}

function assertConfirmedTaskPlan(body = {}, expected = {}) {
  const confirmed = body.cost_confirmation === true
    && clean(body.plan_fingerprint, 200) === clean(expected.plan_fingerprint, 200);
  if (confirmed) return expected;
  const error = new Error('开始统一生成360全景前必须读取并确认服务端最新批量调用计划');
  error.code = 'PANORAMA_BATCH_COST_CONFIRMATION_REQUIRED';
  error.status = 400;
  error.retryable = false;
  error.current_plan = expected;
  throw error;
}

async function generateTaskPanoramas(taskId, body = {}, runOptions = {}, deps = {}) {
  const expected = planForTask(taskId);
  scenePromptConfirmation.assertAllConfirmed(taskId, expected.scenes.map(scene => scene.scene_id), body);
  assertConfirmedTaskPlan(body, expected);
  const results = [];
  const failures = [];
  for (let index = 0; index < expected.scenes.length; index += 1) {
    const plan = expected.scenes[index];
    if (plan.blocked) {
      failures.push({ scene_id: plan.scene_id, error_code: 'PANORAMA_BILLING_REVIEW_REQUIRED', billing_review_required: true });
      continue;
    }
    try {
      results.push(await generateScenePanorama(taskId, plan.scene_id, {
        ...body,
        plan_fingerprint: plan.plan_fingerprint,
        cost_confirmation: true,
      }, {
        ...runOptions,
        generationId: `${clean(runOptions.generationId || body.generation_id || `panorama-batch-${Date.now()}`, 90)}:${index + 1}`,
      }, deps));
    } catch (error) {
      failures.push({
        scene_id: plan.scene_id,
        error_code: error?.code || 'PANORAMA_GENERATION_FAILED',
        billing_state: error?.billingState || error?.billing_state || '',
        billing_review_required: error?.billing_review_required === true,
      });
    }
  }
  return {
    status: failures.length ? 'partial_failed' : 'completed',
    scene_count: expected.scenes.length,
    completed_count: results.length,
    failed_count: failures.length,
    results,
    failures,
    unavailable: expected.unavailable,
    model_call_plan: expected.model_call_plan,
  };
}

function assertConfirmedPlan(body = {}, expected = {}) {
  const confirmed = body.cost_confirmation === true
    && clean(body.plan_fingerprint, 200) === clean(expected.plan_fingerprint, 200);
  if (confirmed) return expected;
  const error = new Error('开始 360 场景前必须读取并确认服务端最新调用计划；计划变化时不会继续调用模型');
  error.code = 'PANORAMA_COST_CONFIRMATION_REQUIRED';
  error.status = 400;
  error.retryable = false;
  error.current_plan = expected;
  throw error;
}

async function generateScenePanorama(taskId, sceneId, body = {}, runOptions = {}, deps = {}) {
  scenePromptConfirmation.assertConfirmed(taskId, sceneId, body);
  const { assets, scene } = findScene(taskId, sceneId);
  const source = sourceView(scene);
  if (!source || !clean(source.image_url || source.url, 1200)) {
    const error = new Error('当前场景没有可作为360扩展依据的主视图');
    error.code = 'PANORAMA_SOURCE_VIEW_REQUIRED';
    error.retryable = false;
    throw error;
  }
  const sourceKey = sourceFingerprint(scene, source);
  const currentPlan = planForScene(taskId, sceneId);
  if (body.plan_fingerprint && body.plan_fingerprint !== currentPlan.plan_fingerprint) {
    const error = new Error('全景调用计划已变化，请重新查看并确认最新计划');
    error.code = 'PANORAMA_PLAN_STALE';
    error.status = 409;
    error.retryable = false;
    error.current_plan = currentPlan;
    throw error;
  }
  if (currentPlan.blocked) {
    const capabilityMissing = currentPlan.blocking_status === 'model_capability_required';
    const error = new Error(capabilityMissing
      ? '模型调用管理尚未配置同时支持原图保真、2:1经纬全景和环形接缝一致性的全景模型，已在付费调用前停止'
      : '上次全景调用仍处于供应商提交或 QA 未决状态，已阻止重复付费；请先完成计费状态核对');
    error.code = capabilityMissing ? 'PANORAMA_MODEL_CAPABILITY_REQUIRED' : 'PANORAMA_BILLING_REVIEW_REQUIRED';
    error.status = 409;
    error.retryable = false;
    error.billing_review_required = true;
    throw error;
  }
  const existing = authoritativePanorama(scene, sourceKey);
  if (existing?.source_fingerprint === sourceKey && body.force !== true) {
    return { reused: true, scene_id: sceneId, panorama: existing, scene_asset: scene, model_call_plan: currentPlan.model_call_plan, attempted_model_calls: { panorama_generation: 0, panorama_qa: 0, total: 0 } };
  }
  const generationId = clean(runOptions.generationId || body.generation_id || `panorama-${Date.now()}`, 120);
  const priorCheckpoint = checkpointPayload(taskId).scenes?.[sceneId] || {};
  if (priorCheckpoint.source_fingerprint === sourceKey
    && ['provider_submitting', 'provider_submitted', 'qa_running'].includes(priorCheckpoint.status)) {
    const error = new Error('上次全景调用已提交但结果或计费状态尚未确认，已阻止重复付费；请管理员核对供应商任务后恢复');
    error.code = 'PANORAMA_BILLING_REVIEW_REQUIRED';
    error.retryable = false;
    error.billing_review_required = true;
    throw error;
  }
  const plan = currentPlan.model_call_plan;
  const attemptedCalls = { panorama_generation: 0, panorama_qa: 0, total: 0 };
  updateProgress(taskId, { generation_id: generationId, scene_id: sceneId, phase: 'preparing', status: 'running', progress: 5, message: '正在锁定场景主视图与360生成合同', model_call_plan: plan });
  let checkpoint = saveCheckpoint(taskId, sceneId, {
    generation_id: generationId,
    source_fingerprint: sourceKey,
    source_scene_revision: scene.scene_revision,
    status: 'prepared',
    model_call_plan: plan,
  });
  cancellation.throwIfCancelled(taskId);

  const generator = deps.imageGenerator || mediaAdapter.generateImage;
  let generated = checkpoint.source_fingerprint === sourceKey ? checkpoint.generated : null;
  if (!generated?.image_url) {
    updateProgress(taskId, { generation_id: generationId, scene_id: sceneId, phase: 'generation', status: 'running', progress: 18, message: '正在生成无缝2:1全景', paid_stage: PANORAMA_STAGE });
    const requestId = fingerprint({ taskId, sceneId, sourceKey, contract: PANORAMA_CONTRACT_VERSION }).slice(0, 48);
    attemptedCalls.panorama_generation += 1;
    attemptedCalls.total += 1;
    try { generated = await generator({
      taskId,
      stage: PANORAMA_STAGE,
      prompt: generationPrompt(scene, source, body),
      auditSafePrompt: generationPrompt(scene, source, body),
      filename: `scene_panorama_candidate_${taskId}_${sceneId}_${Date.now()}`,
      aspectRatio: '2:1',
      resolution: '2K',
      referenceImages: [source.image_url || source.url],
      requireReferences: true,
      inputFidelity: 'high',
      singleAttempt: true,
      clientRequestId: requestId,
      generationId,
      onSubmitting: event => {
        checkpoint = saveCheckpoint(taskId, sceneId, { status: 'provider_submitting', provider_submission: event || {} });
      },
      onSubmitted: event => {
        checkpoint = saveCheckpoint(taskId, sceneId, { status: 'provider_submitted', provider_submission: event || {} });
      },
    }); } catch (error) {
      const billing = clean(error?.billingState || error?.billing_state, 40);
      const submission = clean(error?.providerSubmissionState || error?.provider_submission_state, 60);
      checkpoint = saveCheckpoint(taskId, sceneId, {
        status: billing === 'not_billed' || submission === 'submission_rejected' ? 'provider_rejected' : 'provider_submitted',
        error_code: clean(error?.code || 'PANORAMA_PROVIDER_FAILED', 120),
        billing_state: billing,
        provider_submission_state: submission,
      });
      throw error;
    }
    checkpoint = saveCheckpoint(taskId, sceneId, { status: 'provider_completed', generated });
  }
  cancellation.throwIfCancelled(taskId);

  const candidateRevision = Math.max(1, Number(scene.scene_revision || 1) + 1);
  updateProgress(taskId, { generation_id: generationId, scene_id: sceneId, phase: 'projection', status: 'running', progress: 52, message: '正在本地修复环形接缝并派生镜头视角', paid_stage: '' });
  let normalized;
  try {
    normalized = checkpoint.normalized?.image_url
      ? checkpoint.normalized
      : await (deps.normalizeEquirectangular || projection.normalizeEquirectangular)(generated, { taskId, sceneId, revision: candidateRevision });
  } catch (error) {
    checkpoint = saveCheckpoint(taskId, sceneId, { status: 'candidate_invalid',
      error_code: clean(error?.code || 'PANORAMA_CANDIDATE_INVALID', 120), billing_state: 'confirmed' });
    throw error;
  }
  const derivedViews = list(checkpoint.derived_views).length
    ? checkpoint.derived_views
    : await (deps.deriveCardinalViews || projection.deriveCardinalViews)(normalized);
  checkpoint = saveCheckpoint(taskId, sceneId, { status: 'projected', normalized, derived_views: derivedViews });
  cancellation.throwIfCancelled(taskId);

  updateProgress(taskId, { generation_id: generationId, scene_id: sceneId, phase: 'qa', status: 'running', progress: 72, message: '正在检查原图保真、空间结构和360环形一致性', paid_stage: PANORAMA_QA_STAGE });
  checkpoint = saveCheckpoint(taskId, sceneId, { status: 'qa_running' });
  attemptedCalls.panorama_qa += 1;
  attemptedCalls.total += 1;
  const visualQa = await (deps.reviewPanorama || reviewPanorama)({ taskId, scene, source, panorama: normalized, derivedViews, gateway: deps.gateway || modelGateway });
  const qa = {
    ...visualQa,
    aspect_ratio_pass: normalized.width === normalized.height * 2,
    seam_error: Number(normalized.seam_error),
    seam_pass: Number(normalized.seam_error) <= 0.025,
    source_fingerprint: sourceKey,
    panorama_sha256: normalized.sha256,
    contract_version: PANORAMA_CONTRACT_VERSION,
  };
  qa.pass = qa.pass === true && qa.aspect_ratio_pass && qa.seam_pass;
  checkpoint = saveCheckpoint(taskId, sceneId, { status: qa.pass ? 'qa_passed' : 'qa_failed', qa });
  if (!qa.pass) {
    const error = new Error(`全景候选未通过质量门禁：${qa.mismatch_reasons?.join('；') || '接缝、结构或原图保真不足'}`);
    error.code = 'PANORAMA_QA_FAILED';
    error.retryable = true;
    error.qa = qa;
    throw error;
  }
  cancellation.throwIfCancelled(taskId);

  const panorama = {
    id: `${clean(scene.scene_id || scene.id, 100)}:panorama:${normalized.sha256.slice(0, 12)}`,
    kind: 'equirectangular_panorama',
    status: 'active_verified',
    projection: 'equirectangular',
    image_url: normalized.image_url,
    url: normalized.image_url,
    filename: normalized.filename,
    width: normalized.width,
    height: normalized.height,
    aspect_ratio: '2:1',
    sha256: normalized.sha256,
    source_fingerprint: sourceKey,
    source_scene_revision: Number(scene.scene_revision || 1) || 1,
    source_view_key: clean(source.key || source.view || 'master', 60),
    provider_used: clean(generated.provider_used, 200),
    generation_id: generationId,
    contract_version: PANORAMA_CONTRACT_VERSION,
    qa,
    derived_views: derivedViews,
    created_at: new Date().toISOString(),
  };
  const nextScene = {
    ...scene,
    scene_revision: candidateRevision,
    scene_world_assets: {
      ...(scene.scene_world_assets || {}),
      schema_version: 1,
      panorama_url: panorama.image_url,
      panoramas: [panorama],
      authority_mode: 'panorama_3dof',
    },
  };
  const nextAssets = assets.map(item => clean(item.scene_id || item.id, 120) === clean(sceneId, 120) ? nextScene : item);
  sceneAssets.saveSceneAssetsToTask(taskId, nextAssets);
  saveCheckpoint(taskId, sceneId, { status: 'published', panorama, published_scene_revision: candidateRevision });
  const finishedAt = new Date().toISOString();
  updateProgress(taskId, { generation_id: generationId, scene_id: sceneId, phase: 'complete', status: 'completed', progress: 100, message: '360场景已成为镜头与走位的权威空间资产', paid_stage: '', finished_at: finishedAt });
  return { reused: false, scene_id: sceneId, panorama, scene_asset: nextScene, model_call_plan: plan, attempted_model_calls: attemptedCalls };
}

module.exports = {
  PANORAMA_CONTRACT_VERSION,
  CHECKPOINT_OUTPUT_KIND,
  PANORAMA_STAGE,
  PANORAMA_QA_STAGE,
  panoramaRows,
  authoritativePanorama,
  sourceView,
  sourceFingerprint,
  panoramaModelRoutePlan,
  modelCallPlan,
  planForScene,
  planForTask,
  assertConfirmedPlan,
  assertConfirmedTaskPlan,
  reviewPanorama,
  generateScenePanorama,
  generateTaskPanoramas,
};
