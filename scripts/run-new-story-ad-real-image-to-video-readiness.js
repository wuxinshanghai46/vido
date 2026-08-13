#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const paidBudget = require('./lib/goldenPaidBudget');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.find(value => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}
function stamp() { return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); }
function clean(value = '') { return String(value ?? '').trim(); }

const verifyExistingRunId = clean(argument('verify-existing-run'));
const verifyExistingOnly = Boolean(verifyExistingRunId);
const executeNarrativeVideo = process.argv.includes('--execute-narrative-video');
const publicImageUrl = clean(argument('public-image-url'));
const videoBudgetRmb = Number(argument('video-budget-rmb', '0'));
if (verifyExistingOnly && !/^\d{14}$/.test(verifyExistingRunId)) throw new Error('REAL_IMAGE_VERIFY_RUN_ID_INVALID');
if (executeNarrativeVideo && !verifyExistingOnly) throw new Error('REAL_VIDEO_EXISTING_IMAGE_RUN_REQUIRED');
if (executeNarrativeVideo && !process.argv.includes('--confirm-paid-video')) throw new Error('REAL_VIDEO_PAID_CONFIRMATION_REQUIRED');
if (executeNarrativeVideo && (!(videoBudgetRmb > 0) || videoBudgetRmb > 20.70)) throw new Error('REAL_VIDEO_BUDGET_MUST_BE_BETWEEN_0_AND_20_70_RMB');
if (executeNarrativeVideo && !/^https:\/\//i.test(publicImageUrl)) throw new Error('REAL_VIDEO_HTTPS_PUBLIC_IMAGE_URL_REQUIRED');
if (!verifyExistingOnly && !executeNarrativeVideo && !process.argv.includes('--confirm-paid')) throw new Error('REAL_IMAGE_PAID_CONFIRMATION_REQUIRED');
const budgetRmb = Number(argument('budget-rmb', '0'));
if ((!verifyExistingOnly && !(budgetRmb > 0)) || budgetRmb > 10) throw new Error('REAL_IMAGE_BUDGET_MUST_BE_BETWEEN_0_AND_10_RMB');
const reservePerImageRmb = 2;
const maxImageSubmissions = Math.max(1, Math.min(3, Number(argument('max-image-submissions', '3')) || 3));
if (maxImageSubmissions !== 3) throw new Error('REAL_IMAGE_MATRIX_REQUIRES_EXACTLY_THREE_SINGLE_ATTEMPT_SUBMISSIONS');

const auditCategory = executeNarrativeVideo
  ? 'golden-real-narrative-video'
  : (verifyExistingOnly ? 'golden-real-image-readiness-recheck' : 'golden-real-image-readiness');
const auditBase = path.resolve(process.cwd(), 'outputs', 'audits', auditCategory);
const auditRoot = path.join(auditBase, stamp());
const auditPath = path.join(auditRoot, 'audit.json');
fs.mkdirSync(auditRoot, { recursive: true });
const ledger = paidBudget.ledgerSummary({ excludeAuditPath: auditPath });
if (!verifyExistingOnly) paidBudget.assertWithinBudget({ authorizedLimitRmb: budgetRmb, priorReservedRmb: ledger.reserved_rmb, nextReserveRmb: maxImageSubmissions * reservePerImageRmb });
const budgetLock = paidBudget.acquire({ auditPath });
const temporaryOutput = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-golden-real-image-readiness-'));
process.env.OUTPUT_DIR = temporaryOutput;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';
process.env.NEW_STORY_AD_IMAGE_MAX_CANDIDATES = '1';
process.env.NEW_STORY_AD_V3_PAID_VIDEO_ENABLED = executeNarrativeVideo ? '1' : '0';
process.env.NEW_STORY_AD_VIDEO_MAX_CANDIDATES = '1';
process.env.NEW_STORY_AD_TEXT_MAX_CANDIDATES = '1';
if (executeNarrativeVideo) process.env.NEW_STORY_AD_MOCK_LLM = '1';
const settingsSource = path.join(process.cwd(), 'outputs', 'settings.json');
if (fs.existsSync(settingsSource)) fs.copyFileSync(settingsSource, path.join(temporaryOutput, 'settings.json'));
const pipelineSource = path.join(process.cwd(), 'outputs', 'pipeline_model_config.json');
if (fs.existsSync(pipelineSource)) fs.copyFileSync(pipelineSource, path.join(temporaryOutput, 'pipeline_model_config.json'));

const audit = {
  schema_version: 1,
  status: 'running',
  evidence_class: executeNarrativeVideo
    ? 'single_authorized_real_narrative_video_execution'
    : (verifyExistingOnly ? 'no_fee_existing_real_image_video_preflight_recheck' : 'real_image_to_video_readiness_hybrid'),
  started_at: new Date().toISOString(),
  budget: {
    authorized_limit_rmb: verifyExistingOnly ? null : budgetRmb,
    prior_reserved_rmb: ledger.reserved_rmb,
    conservative_reserve_per_image_submission_rmb: reservePerImageRmb,
    actual_provider_charge_rmb: null,
    actual_charge_note: '供应商未返回可核对的人民币实扣字段；保守预留不是实付金额。',
  },
  run_provider_submissions_started: 0,
  run_reserved_rmb: 0,
  conservative_reserved_rmb: ledger.reserved_rmb,
  text_model_calls_started: 0,
  video_provider_calls_started: 0,
  video_budget: executeNarrativeVideo ? {
    authorized_limit_rmb: videoBudgetRmb,
    actual_provider_charge_rmb: null,
    actual_charge_note: '供应商未返回可核对的人民币实扣字段；预检最大成本不是实扣金额。',
    automatic_retry_count: 0,
    public_image_url: publicImageUrl,
  } : null,
  projects: [],
  verify_existing_run_id: verifyExistingRunId,
};
const persist = () => paidBudget.atomicJson(auditPath, audit);
persist();

const contracts = require('../src/services/newStoryAd/goldenProjectContractService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');
const identities = require('../src/services/newStoryAd/permanentIdentityService');
const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const freshness = require('../src/services/newStoryAd/keyframeContractFreshnessService');
const modelGateway = require('../src/services/newStoryAd/modelGateway');
const videoAdapter = require('../src/services/newStoryAd/videoAdapter');

modelGateway.generateText = async () => {
  audit.text_model_calls_started += 1;
  persist();
  throw Object.assign(new Error('REAL_IMAGE_RUN_TEXT_CALL_FORBIDDEN'), { code: 'REAL_IMAGE_RUN_TEXT_CALL_FORBIDDEN' });
};
if (!executeNarrativeVideo) {
  videoAdapter.generateSceneBlockVideos = async () => {
    audit.video_provider_calls_started += 1;
    persist();
    throw Object.assign(new Error('REAL_IMAGE_RUN_VIDEO_CALL_FORBIDDEN'), { code: 'REAL_IMAGE_RUN_VIDEO_CALL_FORBIDDEN' });
  };
} else {
  const deyunaiService = require('../src/services/deyunaiService');
  const originalGenerateVideo = deyunaiService.generateVideo;
  deyunaiService.generateVideo = async (input = {}) => {
    if (audit.video_provider_calls_started >= 3) {
      const error = new Error('REAL_VIDEO_PROVIDER_CALL_LIMIT_EXCEEDED');
      error.code = 'REAL_VIDEO_PROVIDER_CALL_LIMIT_EXCEEDED';
      throw error;
    }
    audit.video_provider_calls_started += 1;
    audit.video_provider_submissions = audit.video_provider_submissions || [];
    const submission = {
      number: audit.video_provider_calls_started,
      status: 'submitting',
      model: clean(input.model),
      duration_sec: Number(input.duration || 0),
      started_at: new Date().toISOString(),
    };
    audit.video_provider_submissions.push(submission);
    persist();
    try {
      const result = await originalGenerateVideo(input);
      Object.assign(submission, {
        status: 'completed',
        provider_task_id: clean(result?.taskId),
        duration_sec: Number(result?.durationSec || input.duration || 0),
        finished_at: new Date().toISOString(),
      });
      persist();
      return result;
    } catch (error) {
      Object.assign(submission, {
        status: clean(error?.providerTaskId) ? 'failed_after_submission' : 'failed_submission_unknown',
        provider_task_id: clean(error?.providerTaskId),
        billing_state: clean(error?.billingState || error?.billing_state || (error?.providerTaskId ? 'unknown' : 'not_submitted')),
        error_code: clean(error?.code || 'ERROR'),
        error: clean(error?.message || error).slice(0, 500),
        finished_at: new Date().toISOString(),
      });
      persist();
      throw error;
    }
  };
}
const service = require('../src/services/newStoryAd');

const prompts = {
  'golden-commercial-car-v1': 'Premium live-action commercial storyboard still, an original unbranded red two-door electric sports coupe at a realistic riverside charging station, full vehicle visible, a person connects the charging cable, cinematic daylight, physically plausible reflections, no readable text, no logos, no watermark.',
  'golden-narrative-reunion-v1': 'Live-action cinematic story still: two adult old friends reunite at an old railway station on a rainy evening, one carries a raincoat and an orange short-haired cat is a distinct story character beside them, restrained emotion, realistic wet surfaces and station lighting, no readable text, no logo, no watermark.',
  'golden-comic-homecoming-v1': 'Original high-quality vertical comic storyboard panel: a teenage boy with consistent dark hair and practical travel clothes navigates a flooded paper-lantern city, discovers a lighthouse signal and chooses to help a companion, clear causal visual storytelling, coherent stylized linework and color, no readable text, no logo, no watermark.',
};

function completeSceneAsset(taskId, projectId, scene, sourcePath, index) {
  const viewKeys = ['master', 'reverse', 'interaction', 'detail', 'layout'];
  const views = viewKeys.map((key, viewIndex) => {
    const filename = mediaAdapter.safeFilename(`${taskId}-scene-${index + 1}-${key}`, '.png');
    const target = mediaAdapter.assetPathFromName(filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(sourcePath, target);
    return { key, label: key, url: mediaAdapter.publicAssetUrl(filename), image_url: mediaAdapter.publicAssetUrl(filename) };
  });
  return {
    id: scene.permanent_id,
    scene_id: scene.permanent_id,
    name: scene.name,
    scene_revision: 1,
    view_images: views,
    scene_contract: {
      schema_version: 6,
      status: 'verified',
      scene_revision: 1,
      space_lock_status: 'complete',
      requirement_qa: { pass: true, source: 'hybrid_readiness_fixture' },
      photographic_realism_qa: { pass: true, source: 'provider_image_technical_probe' },
      camera_design_qa: { pass: true, source: 'hybrid_readiness_fixture' },
      cross_view_qa: { pass: true, source: 'same_provider_image_derivatives' },
      spatial_coverage_qa: { pass: true, coverage_status: 'complete', source: 'hybrid_readiness_fixture' },
      layout_contract: { status: 'available' },
      zones: [{ id: `${projectId}-zone-${index + 1}`, label: scene.name, purpose: 'golden readiness' }],
      anchors: [{ id: `${projectId}-anchor-${index + 1}`, label: 'primary story anchor', required: true }],
      cameras: viewKeys.slice(0, 4).map(key => ({ id: `${projectId}-camera-${key}`, view_id: key, pass: true })),
    },
  };
}

function verifiedCastContract(project, imageUrl) {
  const members = (project.request.characters || []).map((character, index) => ({
    schema_version: 1,
    person_id: character.id || `person-${index + 1}`,
    person_revision: 1,
    status: 'verified',
    reference_views: { front: imageUrl, side: imageUrl, back: imageUrl, action: imageUrl },
    cross_view_qa: {
      pass: true, identity_score: 1, age_score: 1, wardrobe_score: 1,
      body_score: 1, photographic_realism_score: 1, mismatch_reasons: [],
      source: 'hybrid_readiness_fixture',
    },
  }));
  return {
    schema_version: 1,
    contract_type: 'cast_bundle',
    person_revision: 1,
    expected_people: members.length,
    status: 'verified',
    cross_view_qa: { pass: true, member_count_pass: true, source: 'hybrid_readiness_fixture' },
    member_contracts: members,
  };
}

function seedReadinessTask(project, realImage) {
  const taskId = `real-image-readiness:${project.id}:${Date.now()}`;
  const context = contextBuilder.buildContext(project.request);
  context.capability_pack = contracts.validateDefinition(project).pack;
  const scenes = identities.reconcile(taskId, 'scene', [1, 2, 3].map(index => ({
    name: `${clean(project.label)} scene ${index}`,
    type: index === 1 ? 'opening' : (index === 2 ? 'development' : 'resolution'),
    location: `space-${index}`,
  })), []).items;
  const sceneAssets = scenes.map((scene, index) => completeSceneAsset(taskId, project.id, scene, realImage.filePath, index));
  context.scene_assets = sceneAssets;
  context.scene_mode = 'multi';
  if ((project.request.characters || []).length) {
    context.person_asset = { id: `${project.id}-cast`, cast_mode: project.request.cast_mode, image_url: realImage.image_url };
    context.person_contract = verifiedCastContract(project, realImage.image_url);
    context.person_asset.person_contract = context.person_contract;
  }
  const storyboard = scenes.map((scene, index) => ({
    id: `${taskId}:shot:${index + 1}`,
    permanent_id: identities.permanentId(taskId, 'shot', `shot:${index + 1}`),
    scene_id: scene.permanent_id,
    scene_permanent_id: scene.permanent_id,
    scene_revision: 1,
    title: `${clean(project.label)} shot ${index + 1}`,
    visual: `${clean(project.request.brief)}; shot ${index + 1}`,
    action: index === 0 ? 'establish the situation' : (index === 1 ? 'complete the causal action' : 'resolve the state change'),
    camera: index === 0 ? 'slow push' : 'static',
    characters: project.request.characters || [],
    expected_people: Number(project.expected.expected_people || 0),
    duration: Math.max(3, Math.floor(Number(project.request.target_duration || 15) / 3)),
    duration_sec: Math.max(3, Math.floor(Number(project.request.target_duration || 15) / 3)),
    ...(index ? { transition_type: 'hard_cut', transition_reason: 'new causal beat and authored location change' } : {}),
  }));
  storage.createTask({
    id: taskId, title: project.label, brief: project.request.brief, user_id: 'real-image-readiness',
    status: 'working', stage: 'storyboard_ready', content_revision: 1, lineage_enforced: true, request: context,
  });
  storage.saveOutput(taskId, 'context', context);
  storage.saveOutput(taskId, 'scene_config', { scene_mode: 'multi', scenes, spaces: scenes });
  storage.saveOutput(taskId, 'scene_assets', sceneAssets);
  storage.saveOutput(taskId, 'blueprint', { title: project.label, synopsis: project.request.brief, required_facts: project.expected.required_facts });
  storage.saveOutput(taskId, 'storyboard_table', storyboard);
  const compiled = freshness.inspect(taskId, { ctx: context, shots: storyboard }).contracts;
  freshness.persist(taskId, compiled);
  storage.saveOutput(taskId, 'keyframes', storyboard.map((shot, index) => ({
    id: `${taskId}:frame:${index + 1}`,
    shot_index: index,
    shot_permanent_id: shot.permanent_id,
    image_url: realImage.image_url,
    current_generation_status: 'accepted',
    current_generation_id: `${taskId}:image-probe`,
    qa_policy_version: 2,
    contract: compiled[index],
    contract_fingerprint: compiled[index].contract_fingerprint,
    contract_compiler_signature: freshness.signatureOf(compiled[index]),
    qa: {
      pass: true, status: 'verified', source: 'provider_image_technical_probe_plus_deterministic_contract_fixture',
      person: { pass: true, status: 'verified', person_presence: (project.request.characters || []).length ? 'person' : 'none' },
      product: { pass: true, status: 'verified' },
      scene: { pass: true, status: 'verified' },
    },
  })));
  storage.saveOutput(taskId, 'tts_audio', { status: 'skipped', tracks: [], reason: 'video handled by user' });
  return { taskId, storyboard };
}

async function realImage(project) {
  if (verifyExistingOnly) {
    const sourceDir = path.resolve(process.cwd(), 'outputs', 'audits', 'golden-real-image-readiness', verifyExistingRunId, 'assets');
    const sourceRoot = path.resolve(process.cwd(), 'outputs', 'audits', 'golden-real-image-readiness');
    if (!sourceDir.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('REAL_IMAGE_VERIFY_SOURCE_OUTSIDE_LEDGER');
    const source = fs.readdirSync(sourceDir).find(name => name.startsWith(`real_image_readiness_${project.id}_`) && name.endsWith('.png'));
    if (!source) throw new Error(`REAL_IMAGE_VERIFY_ASSET_MISSING:${project.id}`);
    const filename = mediaAdapter.safeFilename(`recheck_${project.id}_${Date.now()}`, '.png');
    const target = mediaAdapter.assetPathFromName(filename);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceDir, source), target);
    const metadata = await sharp(target).metadata();
    const entry = {
      project_id: project.id, number: audit.projects.length + 1, status: 'existing_real_image_loaded',
      provider_used: 'deyunai/gpt-image-2', image_url: executeNarrativeVideo ? publicImageUrl : mediaAdapter.publicAssetUrl(filename),
      width: metadata.width, height: metadata.height, source_run_id: verifyExistingRunId,
    };
    audit.projects.push(entry);
    persist();
    return { filePath: target, image_url: entry.image_url, provider_used: entry.provider_used };
  }
  const submission = {
    project_id: project.id,
    number: audit.run_provider_submissions_started + 1,
    status: 'preparing',
    started_at: new Date().toISOString(),
  };
  const result = await mediaAdapter.generateImage({
    taskId: `real-image-readiness:${project.id}`,
    stage: 'new_story_ad.keyframe',
    prompt: prompts[project.id],
    filename: `real_image_readiness_${project.id}_${Date.now()}`,
    aspectRatio: project.request.output_ratio || '9:16',
    resolution: '1K',
    imageModel: 'deyunai/gpt-image-2',
    singleAttempt: true,
    clientRequestId: `real-image-readiness:${project.id}:${Date.now()}`,
    timeoutMs: 8 * 60 * 1000,
    onSubmitting: event => {
      paidBudget.assertWithinBudget({
        authorizedLimitRmb: budgetRmb,
        priorReservedRmb: ledger.reserved_rmb,
        runReservedRmb: audit.run_reserved_rmb,
        nextReserveRmb: reservePerImageRmb,
      });
      audit.run_provider_submissions_started += 1;
      audit.run_reserved_rmb = audit.run_provider_submissions_started * reservePerImageRmb;
      audit.conservative_reserved_rmb = ledger.reserved_rmb + audit.run_reserved_rmb;
      Object.assign(submission, { status: 'submitting', submitted_at: new Date().toISOString(), event });
      audit.projects.push(submission);
      persist();
    },
    onSubmitted: event => {
      Object.assign(submission, { status: 'submitted', provider_request_id: clean(event?.providerRequestId), provider_task_id: clean(event?.taskId) });
      persist();
    },
  });
  const metadata = await sharp(result.filePath).metadata();
  assert(metadata.width > 0 && metadata.height > 0, 'provider image is not decodable');
  Object.assign(submission, {
    status: 'image_ready', provider_used: result.provider_used, image_url: result.image_url,
    width: metadata.width, height: metadata.height, finished_at: new Date().toISOString(),
  });
  persist();
  return result;
}

(async () => {
  const projects = executeNarrativeVideo
    ? contracts.readRegistry().projects.filter(project => project.id === 'golden-narrative-reunion-v1')
    : contracts.readRegistry().projects;
  assert.strictEqual(projects.length, executeNarrativeVideo ? 1 : 3, 'golden project selection mismatch');
  for (const project of projects) {
    const image = await realImage(project);
    const seeded = seedReadinessTask(project, image);
    const executionOptions = {
      mode: 'economy', visual_only: true,
      video_provider: 'deyunai',
      video_model: 'doubao-seedance-2-0-260128',
      seedance_input_mode: 'first_frame',
      video_resolution: '720p',
      subtitle: false,
      include_voiceover: false,
    };
    const plan = service.buildVideoPreflightPlan(seeded.taskId, executionOptions);
    const entry = audit.projects.find(item => item.project_id === project.id);
    Object.assign(entry, {
      status: 'video_preflight_reached',
      task_id: seeded.taskId,
      storyboard_shots: seeded.storyboard.length,
      approved_keyframes: storage.getOutput(seeded.taskId, 'keyframes').length,
      video_preflight_status: plan.status,
      paid_video_units_planned: plan.paid_unit_count,
      video_preflight_fingerprint_present: Boolean(plan.fingerprint),
      blockers: plan.blockers.map(item => item.code),
      video_provider_route: plan.cost_plan?.price_route || '',
      video_price_known: plan.cost_plan?.price_known === true,
      video_price_catalog_version: plan.cost_plan?.price_catalog_version || '',
      video_maximum_cost_rmb: Number(plan.cost_plan?.maximum_cost_rmb || 0),
      video_disabled_blocker_present: plan.blockers.some(item => item.code === 'VIDEO_V3_PAID_DISABLED'),
      video_provider_calls_started: audit.video_provider_calls_started,
      readiness_evidence_scope: executeNarrativeVideo
        ? 'real provider image-to-video transport and composition; deterministic contract fixtures and no-fee QA harness; final visual quality requires independent frame inspection'
        : 'real provider image transport and decoding; deterministic current-contract fixtures for remaining asset views and preflight gates; no visual-quality acceptance claim',
    });
    assert(entry.video_price_known, 'exact video route price must be known');
    assert(!entry.blockers.includes('VIDEO_COST_PRICE_UNKNOWN'), 'known exact video route must not carry an unknown-price blocker');
    assert(entry.video_preflight_fingerprint_present, 'video preflight was not compiled');
    if (!executeNarrativeVideo) {
      assert(entry.video_disabled_blocker_present, 'paid video hard-disable blocker missing');
      assert.strictEqual(audit.video_provider_calls_started, 0, 'video provider must not be called');
    } else {
      assert.deepStrictEqual(entry.blockers, [], `real video preflight blocked: ${entry.blockers.join(',')}`);
      assert.strictEqual(plan.cost_plan?.price_route, 'deyunai/doubao-seedance-2-0-260128');
      assert.strictEqual(Number(plan.cost_plan?.paid_unit_count || 0), 3);
      assert.strictEqual(Number(plan.cost_plan?.automatic_paid_retry_count || 0), 0);
      assert(Number(plan.cost_plan?.maximum_cost_rmb || 0) <= videoBudgetRmb + 0.001, 'REAL_VIDEO_PREFLIGHT_COST_EXCEEDS_AUTHORIZED_LIMIT');
      Object.assign(entry, {
        status: 'video_execution_started',
        cost_plan_fingerprint: plan.cost_plan.fingerprint,
        video_preflight_fingerprint: plan.fingerprint,
        automatic_paid_retry_count: 0,
      });
      persist();
      const generated = await service.generateVideoStage(seeded.taskId, {
        ...executionOptions,
        video_preflight_fingerprint: plan.fingerprint,
        cost_plan_fingerprint: plan.cost_plan.fingerprint,
        confirmed_cost_limit_rmb: videoBudgetRmb,
        complexity_review_confirmed: true,
        generation_id: `golden-real-narrative-video:${stamp()}`,
      });
      assert.strictEqual(generated.video_clips?.filter(Boolean).length, 3, 'three provider video clips are required before composition');
      Object.assign(entry, {
        status: 'video_clips_ready',
        completed_video_clips: generated.video_clips.filter(Boolean).length,
        provider_task_ids: generated.video_clips.map(clip => clean(clip?.provider_task_id)).filter(Boolean),
      });
      persist();
      const composed = await service.composeStage(seeded.taskId, {
        generation_id: `golden-real-narrative-compose:${stamp()}`,
        include_voiceover: false,
        subtitle: false,
        bgm_asset: null,
        brand_overlay: { enabled: false },
        video_resolution: '720p',
      });
      assert(composed.final_video?.file_path && fs.existsSync(composed.final_video.file_path), 'composed final video file missing');
      Object.assign(entry, {
        status: 'final_video_ready',
        final_video: {
          filename: path.basename(composed.final_video.file_path),
          duration_sec: Number(composed.final_video.duration_sec || 0),
          clip_count: Number(composed.final_video.clip_count || generated.video_clips.length),
        },
        video_provider_calls_started: audit.video_provider_calls_started,
        qa_mode: 'deterministic_no_fee_harness_pending_independent_frame_inspection',
      });
    }
    persist();
  }
  audit.status = 'passed';
  audit.finished_at = new Date().toISOString();
  persist();
  console.log(JSON.stringify({
    passed: true,
    evidence_class: audit.evidence_class,
    projects: audit.projects.map(item => ({ project_id: item.project_id, image: `${item.width}x${item.height}`, video_preflight_status: item.video_preflight_status, blockers: item.blockers })),
    prior_reserved_rmb: ledger.reserved_rmb,
    run_reserved_rmb: audit.run_reserved_rmb,
    conservative_reserved_rmb: audit.conservative_reserved_rmb,
    video_provider_calls_started: audit.video_provider_calls_started,
    video_provider_submissions: audit.video_provider_submissions || [],
    audit_path: auditPath,
  }));
})().catch(error => {
  audit.status = 'failed';
  audit.finished_at = new Date().toISOString();
  audit.error = {
    code: clean(error.code || 'ERROR'), message: clean(error.message || error).slice(0, 1000),
    billing_state: clean(error.billingState || error.billing_state),
    provider_submission_state: clean(error.providerSubmissionState || error.provider_submission_state),
  };
  persist();
  console.error(JSON.stringify({ passed: false, ...audit.error, audit_path: auditPath }));
  process.exitCode = 1;
}).finally(() => {
  budgetLock.release();
  // Preserve generated image artifacts for visual inspection; remove task JSON and copied settings only.
  const assets = path.join(temporaryOutput, 'new-story-ad-assets');
  const preserved = path.join(auditRoot, 'assets');
  if (fs.existsSync(assets)) {
    fs.rmSync(preserved, { recursive: true, force: true });
    fs.cpSync(assets, preserved, { recursive: true });
  }
  const videos = path.join(temporaryOutput, 'new-story-ad-videos');
  const preservedVideos = path.join(auditRoot, 'videos');
  if (fs.existsSync(videos)) {
    fs.rmSync(preservedVideos, { recursive: true, force: true });
    fs.cpSync(videos, preservedVideos, { recursive: true });
  }
  fs.rmSync(temporaryOutput, { recursive: true, force: true });
});
