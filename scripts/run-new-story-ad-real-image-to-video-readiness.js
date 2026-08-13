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
if (verifyExistingOnly && !/^\d{14}$/.test(verifyExistingRunId)) throw new Error('REAL_IMAGE_VERIFY_RUN_ID_INVALID');
if (!verifyExistingOnly && !process.argv.includes('--confirm-paid')) throw new Error('REAL_IMAGE_PAID_CONFIRMATION_REQUIRED');
const budgetRmb = Number(argument('budget-rmb', '0'));
if ((!verifyExistingOnly && !(budgetRmb > 0)) || budgetRmb > 10) throw new Error('REAL_IMAGE_BUDGET_MUST_BE_BETWEEN_0_AND_10_RMB');
const reservePerImageRmb = 2;
const maxImageSubmissions = Math.max(1, Math.min(3, Number(argument('max-image-submissions', '3')) || 3));
if (maxImageSubmissions !== 3) throw new Error('REAL_IMAGE_MATRIX_REQUIRES_EXACTLY_THREE_SINGLE_ATTEMPT_SUBMISSIONS');

const auditBase = path.resolve(process.cwd(), 'outputs', 'audits', verifyExistingOnly ? 'golden-real-image-readiness-recheck' : 'golden-real-image-readiness');
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
process.env.NEW_STORY_AD_V3_PAID_VIDEO_ENABLED = '0';
process.env.NEW_STORY_AD_TEXT_MAX_CANDIDATES = '1';
const settingsSource = path.join(process.cwd(), 'outputs', 'settings.json');
if (fs.existsSync(settingsSource)) fs.copyFileSync(settingsSource, path.join(temporaryOutput, 'settings.json'));
const pipelineSource = path.join(process.cwd(), 'outputs', 'pipeline_model_config.json');
if (fs.existsSync(pipelineSource)) fs.copyFileSync(pipelineSource, path.join(temporaryOutput, 'pipeline_model_config.json'));

const audit = {
  schema_version: 1,
  status: 'running',
  evidence_class: verifyExistingOnly ? 'no_fee_existing_real_image_video_preflight_recheck' : 'real_image_to_video_readiness_hybrid',
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
videoAdapter.generateSceneBlockVideos = async () => {
  audit.video_provider_calls_started += 1;
  persist();
  throw Object.assign(new Error('REAL_IMAGE_RUN_VIDEO_CALL_FORBIDDEN'), { code: 'REAL_IMAGE_RUN_VIDEO_CALL_FORBIDDEN' });
};
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
      provider_used: 'deyunai/gpt-image-2', image_url: mediaAdapter.publicAssetUrl(filename),
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
  for (const project of contracts.readRegistry().projects) {
    const image = await realImage(project);
    const seeded = seedReadinessTask(project, image);
    const plan = service.buildVideoPreflightPlan(seeded.taskId, {
      mode: 'economy', visual_only: true,
      video_provider: 'deyunai',
      video_model: 'doubao-seedance-2-0-260128',
    });
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
      readiness_evidence_scope: 'real provider image transport and decoding; deterministic current-contract fixtures for remaining asset views and preflight gates; no visual-quality acceptance claim',
    });
    assert(entry.video_disabled_blocker_present, 'paid video hard-disable blocker missing');
    assert(entry.video_price_known, 'exact video route price must be known');
    assert(!entry.blockers.includes('VIDEO_COST_PRICE_UNKNOWN'), 'known exact video route must not carry an unknown-price blocker');
    assert(entry.video_preflight_fingerprint_present, 'video preflight was not compiled');
    assert.strictEqual(audit.video_provider_calls_started, 0, 'video provider must not be called');
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
  fs.rmSync(temporaryOutput, { recursive: true, force: true });
});
