#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const tempParent = path.join(root, '.tmp');
fs.mkdirSync(tempParent, { recursive: true });
const outputDir = fs.mkdtempSync(path.join(tempParent, 'new-story-ad-panorama-'));
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.DB_READ_PRIMARY = '0';
process.env.DB_DUAL_WRITE = '0';
process.env.DB_JSON_FALLBACK = '1';
process.env.NEW_STORY_AD_MOCK_IMAGE = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';

const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const storage = require('../src/services/newStoryAd/storageService');
const panoramaProjection = require('../src/services/newStoryAd/panoramaProjectionService');
const scenePanorama = require('../src/services/newStoryAd/scenePanoramaService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const sceneWorlds = require('../src/services/storyAdWorkspace/sceneWorldService');
const projectBundles = require('../src/services/storyAdWorkspace/projectBundleService');
const shotReferencePacks = require('../src/services/newStoryAd/shotReferencePackService');
const storyAd = require('../src/services/newStoryAd/storyAdService');
const jobService = require('../src/services/newStoryAd/jobService');

const TASK_ID = 'panorama-contract-regression';
const JOB_TASK_ID = 'panorama-job-concurrency-regression';
const BATCH_TASK_ID = 'panorama-batch-regression';
const SCENE_ID = 'neutral-scene';
const FORBIDDEN_INDUSTRY_SENTINELS = [
  'STEEL_FACTORY_ONLY_TOKEN',
  'CLINIC_ONLY_TOKEN',
  'RETAIL_ONLY_TOKEN',
  'HOME_ONLY_TOKEN',
  'PARK_ONLY_TOKEN',
];

function longitudeColour(x, width) {
  const ratio = x / width;
  if (ratio < 0.125 || ratio >= 0.875) return [35, 75, 225]; // 180/-180: blue
  if (ratio < 0.375) return [235, 205, 25]; // -90: yellow
  if (ratio < 0.625) return [225, 45, 40]; // 0: red
  return [35, 195, 70]; // 90: green
}

async function createSyntheticGrid(filename, width = 512, height = 256, options = {}) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = longitudeColour(x, width);
      const grid = (x % 32 === 0 || y % 32 === 0) ? 0.62 : 1;
      const offset = (y * width + x) * 3;
      pixels[offset] = Math.round(base[0] * grid);
      pixels[offset + 1] = Math.round(base[1] * grid);
      pixels[offset + 2] = Math.round(base[2] * grid);
    }
  }
  // A valid equirectangular source already has a continuous cyclic boundary.
  // The local pipeline may measure this boundary but must never manufacture it.
  for (let y = 0; y < height; y += 1) {
    const left = y * width * 3;
    const right = (y * width + width - 1) * 3;
    pixels[left] = 35;
    pixels[left + 1] = 75;
    pixels[left + 2] = 225;
    pixels[right] = options.brokenSeam ? 220 : 35;
    pixels[right + 1] = options.brokenSeam ? 25 : 75;
    pixels[right + 2] = options.brokenSeam ? 190 : 225;
  }
  fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
  const filePath = path.join(mediaAdapter.ASSET_DIR, filename);
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(filePath);
  return {
    filePath,
    filename,
    image_url: mediaAdapter.publicAssetUrl(filename),
    url: mediaAdapter.publicAssetUrl(filename),
    provider_used: 'mock/panorama-grid',
  };
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function centreColour(filePath) {
  const metadata = await sharp(filePath).metadata();
  const size = 80;
  const stats = await sharp(filePath).extract({
    left: Math.floor((metadata.width - size) / 2),
    top: Math.floor((metadata.height - size) / 2),
    width: size,
    height: size,
  }).stats();
  return stats.channels.slice(0, 3).map(channel => channel.mean);
}

function assertDirectionColour(key, colour) {
  const [red, green, blue] = colour;
  if (key === 'panorama_front') {
    assert(red > green + 90 && red > blue + 90, `front must face the red 0-degree sector: ${colour}`);
  } else if (key === 'panorama_right') {
    assert(green > red + 80 && green > blue + 80, `right must face the green 90-degree sector: ${colour}`);
  } else if (key === 'panorama_back') {
    assert(blue > red + 80 && blue > green + 80, `back must face the blue 180-degree seam sector: ${colour}`);
  } else if (key === 'panorama_left') {
    assert(red > 150 && green > 140 && blue < 100, `left must face the yellow -90-degree sector: ${colour}`);
  }
}

function seedTask(source) {
  storage.createTask({
    id: TASK_ID,
    title: 'Panorama target-contract regression',
    brief: 'NEUTRAL_CURRENT_SCENE_TOKEN',
    request: { brief: 'NEUTRAL_CURRENT_SCENE_TOKEN' },
    content_revision: 1,
    status: 'draft',
  });
  storage.saveOutput(TASK_ID, 'context', { brief: 'NEUTRAL_CURRENT_SCENE_TOKEN' });
  sceneAssets.saveSceneAssetsToTask(TASK_ID, [{
    id: SCENE_ID,
    scene_id: SCENE_ID,
    space_id: SCENE_ID,
    name: 'Neutral reusable location',
    layout_summary: 'NEUTRAL_CURRENT_SCENE_TOKEN with one entrance, stable boundaries and one fixed central anchor.',
    material_summary: 'CURRENT_MATERIAL_TOKEN with coherent natural light.',
    interaction_summary: 'CURRENT_INTERACTION_TOKEN beside the central anchor.',
    image_url: source.image_url,
    view_images: [{ key: 'master', image_url: source.image_url, url: source.image_url }],
    scene_revision: 1,
  }]);
}

function appendScene(scene) {
  const current = sceneAssets.normalizeSceneAssets(storage.getOutput(TASK_ID, 'scene_assets') || []);
  sceneAssets.saveSceneAssetsToTask(TASK_ID, [
    ...current.filter(item => item.scene_id !== scene.scene_id),
    scene,
  ]);
}

function neutralScene(sceneId, source, extra = {}) {
  return {
    id: sceneId,
    scene_id: sceneId,
    space_id: sceneId,
    name: 'Neutral reusable location',
    layout_summary: 'NEUTRAL_CURRENT_SCENE_TOKEN with one entrance, stable boundaries and one fixed central anchor.',
    material_summary: 'CURRENT_MATERIAL_TOKEN with coherent natural light.',
    interaction_summary: 'CURRENT_INTERACTION_TOKEN beside the central anchor.',
    image_url: source.image_url,
    view_images: [{ key: 'master', image_url: source.image_url, url: source.image_url }],
    scene_revision: 1,
    ...extra,
  };
}

async function testProviderCandidateValidation(validCandidate, brokenCandidate, invalidRatioCandidate) {
  await assert.rejects(
    () => panoramaProjection.normalizeEquirectangular(invalidRatioCandidate, {
      taskId: TASK_ID, sceneId: 'invalid-ratio', revision: 1,
    }),
    error => error?.code === 'PANORAMA_PROVIDER_ASPECT_RATIO_INVALID'
      && error?.actual_width === 480 && error?.actual_height === 320,
    'a 3:2 provider result must be rejected instead of cropped or stretched into a fake panorama',
  );

  const brokenBefore = fileSha256(brokenCandidate.filePath);
  const broken = await panoramaProjection.normalizeEquirectangular(brokenCandidate, {
    taskId: TASK_ID, sceneId: 'broken-seam', revision: 1,
  });
  assert(broken.seam_error > 0.1,
    `a deliberately discontinuous 2:1 provider result must retain a high measured seam error: ${broken.seam_error}`);
  assert.equal(fileSha256(brokenCandidate.filePath), brokenBefore,
    'local validation must not rewrite the provider candidate to hide its seam defect');

  const valid = await panoramaProjection.normalizeEquirectangular(validCandidate, {
    taskId: TASK_ID, sceneId: 'valid-seam', revision: 1,
  });
  assert(valid.seam_error <= 0.025,
    `only an actually seamless provider fixture may pass the local seam gate: ${valid.seam_error}`);
  return { broken, valid };
}

async function testProjectionContract(candidate) {
  const normalized = await panoramaProjection.normalizeEquirectangular(candidate, {
    taskId: TASK_ID,
    sceneId: SCENE_ID,
    revision: 2,
  });
  assert.deepStrictEqual([normalized.width, normalized.height], [2048, 1024]);
  assert.equal(normalized.aspect_ratio, '2:1');
  assert.equal(normalized.projection, 'equirectangular');
  assert(normalized.seam_error <= 0.025, `a genuinely seamless cyclic source must pass: ${normalized.seam_error}`);

  const first = await panoramaProjection.deriveCardinalViews(normalized);
  const second = await panoramaProjection.deriveCardinalViews(normalized);
  assert.deepStrictEqual(first.map(view => view.key), [
    'panorama_front', 'panorama_right', 'panorama_back', 'panorama_left',
  ]);
  assert.deepStrictEqual(first.map(view => view.yaw), [0, 90, 180, -90]);
  assert.deepStrictEqual(first.map(view => view.sha256), second.map(view => view.sha256),
    'same panorama and camera parameters must produce byte-identical local projections');
  assert(first.every(view => view.derived_locally === true));
  assert(first.every(view => view.parent_sha256 === normalized.sha256));
  assert(first.every(view => view.width === 960 && view.height === 540));
  for (const view of first) {
    const colour = await centreColour(path.join(mediaAdapter.ASSET_DIR, view.filename));
    assertDirectionColour(view.key, colour);
  }
  return { normalized, views: first };
}

async function testGenerationAndReuse(candidate) {
  seedTask(candidate);
  let generationCalls = 0;
  let qaCalls = 0;
  let localProjectionRuns = 0;
  let submittedPrompt = '';
  const deps = {
    imageGenerator: async options => {
      generationCalls += 1;
      submittedPrompt = options.prompt;
      assert.equal(options.stage, 'new_story_ad.scene_panorama');
      assert.equal(options.aspectRatio, '2:1');
      assert.equal(options.singleAttempt, true);
      assert.deepStrictEqual(options.referenceImages, [candidate.image_url]);
      await options.onSubmitting?.({ clientRequestId: options.clientRequestId, providerSubmissionState: 'submitting' });
      await options.onSubmitted?.({ clientRequestId: options.clientRequestId, providerRequestId: 'mock-panorama-1', providerSubmissionState: 'submitted' });
      return candidate;
    },
    deriveCardinalViews: async panorama => {
      localProjectionRuns += 1;
      return panoramaProjection.deriveCardinalViews(panorama);
    },
    reviewPanorama: async ({ derivedViews }) => {
      qaCalls += 1;
      assert.equal(derivedViews.length, 4);
      return {
        pass: true,
        source_fidelity_score: 0.96,
        geometry_consistency_score: 0.95,
        wraparound_consistency_score: 0.97,
        projection_consistency_score: 0.98,
        mismatch_reasons: [],
        vision_model: 'mock/panorama-qa',
      };
    },
  };
  const generated = await scenePanorama.generateScenePanorama(TASK_ID, SCENE_ID, {}, {
    generationId: 'panorama-generation-contract-1',
  }, deps);
  assert.equal(generated.reused, false);
  assert.deepStrictEqual(generated.attempted_model_calls, {
    panorama_generation: 1, panorama_qa: 1, total: 2,
  });
  assert.deepStrictEqual(generated.model_call_plan, {
    panorama_generation: 1,
    panorama_qa: 1,
    local_projection: 0,
    depth: 0,
    spatial_reconstruction: 0,
    mode: 'panorama_3dof',
  });
  assert.equal(generationCalls, 1);
  assert.equal(qaCalls, 1);
  assert.equal(localProjectionRuns, 1);
  assert(submittedPrompt.includes('NEUTRAL_CURRENT_SCENE_TOKEN'));
  FORBIDDEN_INDUSTRY_SENTINELS.forEach(token => assert(!submittedPrompt.includes(token),
    `unrelated industry sentinel must never be injected: ${token}`));
  assert.equal(generated.panorama.qa.pass, true);
  assert.equal(generated.panorama.derived_views.length, 4);

  const reused = await scenePanorama.generateScenePanorama(TASK_ID, SCENE_ID, {}, {
    generationId: 'panorama-generation-contract-duplicate',
  }, deps);
  assert.equal(reused.reused, true);
  assert.deepStrictEqual(reused.attempted_model_calls, {
    panorama_generation: 0, panorama_qa: 0, total: 0,
  });
  assert.equal(generationCalls, 1, 'idempotent reuse must not submit another panorama generation');
  assert.equal(qaCalls, 1, 'idempotent reuse must not submit another panorama QA');
  assert.equal(localProjectionRuns, 1, 'idempotent reuse must not repeat local projections');
  return generated;
}

async function testQaFailurePreservesAuthority(validGenerated, brokenCandidate) {
  const sceneId = 'qa-failure-scene';
  const baseScene = neutralScene(sceneId, brokenCandidate, { scene_revision: 2 });
  const currentSourceFingerprint = scenePanorama.sourceFingerprint(baseScene, scenePanorama.sourceView(baseScene));
  const oldAuthority = {
    ...validGenerated.panorama,
    id: `${sceneId}:panorama:old-authority`,
    image_url: '/api/new-story-ad/assets/old-authority.png',
    url: '/api/new-story-ad/assets/old-authority.png',
    sha256: 'a'.repeat(64),
    source_fingerprint: currentSourceFingerprint,
    source_scene_revision: 1,
    status: 'active_verified',
    qa: { ...validGenerated.panorama.qa, pass: true },
  };
  appendScene({ ...baseScene,
    scene_world_assets: {
      schema_version: 1,
      panorama_url: oldAuthority.image_url,
      panoramas: [oldAuthority],
      authority_mode: 'panorama_3dof',
    },
  });
  await assert.rejects(
    () => scenePanorama.generateScenePanorama(TASK_ID, sceneId, { force: true }, {
      generationId: 'panorama-generation-broken-seam',
    }, {
      imageGenerator: async () => brokenCandidate,
      reviewPanorama: async () => ({
        pass: true,
        source_fidelity_score: 0.99,
        geometry_consistency_score: 0.99,
        wraparound_consistency_score: 0.99,
        projection_consistency_score: 0.99,
        mismatch_reasons: [],
      }),
    }),
    error => error?.code === 'PANORAMA_QA_FAILED'
      && error?.qa?.seam_pass === false
      && Number(error?.qa?.seam_error) > 0.1,
    'a vision pass cannot override the deterministic seam gate',
  );
  const stored = sceneAssets.normalizeSceneAssets(storage.getOutput(TASK_ID, 'scene_assets') || [])
    .find(item => item.scene_id === sceneId);
  const storedFingerprint = scenePanorama.sourceFingerprint(stored, scenePanorama.sourceView(stored));
  assert.equal(scenePanorama.authoritativePanorama(stored, storedFingerprint)?.sha256, oldAuthority.sha256,
    'a failed candidate must never replace the previously verified authority');
}

function testSourceChangeInvalidatesAuthority(generated) {
  const changed = {
    ...generated.scene_asset,
    image_url: '/api/new-story-ad/assets/changed-source-master.png',
    url: '/api/new-story-ad/assets/changed-source-master.png',
    view_images: [{
      key: 'master',
      image_url: '/api/new-story-ad/assets/changed-source-master.png',
      url: '/api/new-story-ad/assets/changed-source-master.png',
      file_sha256: 'b'.repeat(64),
    }],
    scene_revision: generated.scene_asset.scene_revision + 1,
  };
  const changedFingerprint = scenePanorama.sourceFingerprint(changed, scenePanorama.sourceView(changed));
  assert.equal(scenePanorama.authoritativePanorama(changed, changedFingerprint), null,
    'a panorama tied to an older master fingerprint must become non-authoritative as soon as the source changes');
}

async function testPaidStateBlocksDuplicate(candidate) {
  const providerSceneId = 'provider-submitted-block';
  const qaSceneId = 'qa-running-block';
  const providerScene = neutralScene(providerSceneId, candidate);
  const qaScene = neutralScene(qaSceneId, candidate);
  appendScene(providerScene);
  appendScene(qaScene);
  const providerFingerprint = scenePanorama.sourceFingerprint(providerScene, scenePanorama.sourceView(providerScene));
  const qaFingerprint = scenePanorama.sourceFingerprint(qaScene, scenePanorama.sourceView(qaScene));
  storage.saveOutput(TASK_ID, scenePanorama.CHECKPOINT_OUTPUT_KIND, {
    schema_version: 1,
    scenes: {
      [providerSceneId]: {
        scene_id: providerSceneId,
        source_fingerprint: providerFingerprint,
        status: 'provider_submitted',
        provider_submission: { provider_request_id: 'provider-paid-state-1' },
      },
      [qaSceneId]: {
        scene_id: qaSceneId,
        source_fingerprint: qaFingerprint,
        status: 'qa_running',
        generated: candidate,
      },
    },
  });
  let dependencyCalls = 0;
  const forbiddenDeps = {
    imageGenerator: async () => { dependencyCalls += 1; throw new Error('duplicate provider call'); },
    normalizeEquirectangular: async () => { dependencyCalls += 1; throw new Error('duplicate local continuation'); },
    reviewPanorama: async () => { dependencyCalls += 1; throw new Error('duplicate QA call'); },
  };
  for (const sceneId of [providerSceneId, qaSceneId]) {
    await assert.rejects(
      () => scenePanorama.generateScenePanorama(TASK_ID, sceneId, {}, {
        generationId: `duplicate-${sceneId}`,
      }, forbiddenDeps),
      error => error?.code === 'PANORAMA_BILLING_REVIEW_REQUIRED'
        && error?.billing_review_required === true
        && error?.retryable === false,
      `${sceneId} must block a duplicate paid continuation`,
    );
  }
  assert.equal(dependencyCalls, 0, 'provider_submitted and qa_running checkpoints must block before any dependency runs');
}

function testWorldCapabilityBoundaries(generated) {
  const ordinary = {
    id: 'ordinary-photo',
    name: 'Ordinary photo scene',
    view_images: [{ key: 'master', image_url: '/ordinary-master.png' }],
    capabilities: { supports_panorama: true, supports_navigation: true },
  };
  const ordinaryCapabilities = sceneWorlds.inferCapabilities(ordinary);
  assert.equal(ordinaryCapabilities.supports_panorama, false, 'an explicit flag cannot turn an ordinary image into a panorama');
  assert.equal(ordinaryCapabilities.supports_rotation_navigation, false);
  assert.equal(ordinaryCapabilities.supports_translation_navigation, false);
  assert.equal(ordinaryCapabilities.supports_navigation, false);

  const panoramaWorld = sceneWorlds.buildSceneWorlds({
    assets: { scenes: [generated.scene_asset] },
  })[0];
  assert.equal(panoramaWorld.capabilities.supports_panorama, true);
  assert.equal(panoramaWorld.capabilities.supports_rotation_navigation, true);
  assert.equal(panoramaWorld.capabilities.supports_translation_navigation, false,
    'a 3DoF panorama must not claim camera translation');
  assert.equal(panoramaWorld.capabilities.supports_navigation, false,
    'a 3DoF panorama must not claim 6DoF navigation');
  assert.equal(panoramaWorld.experience.current_mode, 'panorama_360');
  assert.equal(panoramaWorld.source_asset.panorama_url, generated.panorama.image_url);
  assert(panoramaWorld.observation_nodes.some(node => node.is_panorama && node.image_url === generated.panorama.image_url));
}

function testProjectionAndShotReference(generated) {
  const bundle = projectBundles.buildProjectBundle(TASK_ID, { sections: 'all' });
  const projectedScene = bundle.assets.scenes.find(scene => scene.id === SCENE_ID);
  assert(projectedScene?.scene_world_assets, 'project projection must retain scene_world_assets');
  assert.equal(projectedScene.scene_world_assets.authority_mode, 'panorama_3dof');
  assert.equal(projectedScene.scene_world_assets.panoramas[0].sha256, generated.panorama.sha256);
  assert.equal(projectedScene.scene_world_assets.panoramas[0].derived_views.length, 4);

  const reverse = generated.panorama.derived_views.find(view => view.camera_id === 'camera_reverse');
  const pack = shotReferencePacks.compile({
    taskId: TASK_ID,
    shotIndex: 0,
    ctx: {},
    shot: { id: 'shot-reverse', scene_id: SCENE_ID, camera_id: 'camera_reverse' },
    contract: { contract_fingerprint: 'panorama-shot-contract' },
    sceneAsset: generated.scene_asset,
    sceneReference: generated.scene_asset.image_url,
    providerLimit: 4,
  });
  assert.equal(pack.panorama_sha256, generated.panorama.sha256);
  assert.equal(pack.panorama_view_sha256, reverse.sha256);
  assert.equal(pack.references[0].role, 'director_composition');
  assert.equal(pack.references[0].url, reverse.image_url,
    'the requested camera must use the matching deterministic panorama projection');
  assert(pack.references.some(reference => reference.role === 'scene_identity'
    && reference.url === generated.scene_asset.image_url),
  'the ordinary scene master must remain as the lower-priority scene identity reference');
}

async function testKeyframeQaPanoramaReference(generated) {
  const reverse = generated.panorama.derived_views.find(view => view.camera_id === 'camera_reverse');
  assert.equal(typeof storyAd.selectedSceneReference, 'function',
    'scene keyframe QA must expose the same behavior-tested scene-reference selector used at runtime');
  const selected = storyAd.selectedSceneReference(generated.scene_asset, {
    camera_id: 'camera_reverse',
    scene_lock: { camera_id: 'camera_reverse' },
  }, { scene_id: SCENE_ID, camera_id: 'camera_reverse' });
  assert.equal(selected, mediaAdapter.absolutePublicImageUrl(reverse.image_url),
    'scene keyframe QA must compare the candidate against the requested panorama-derived camera view');
}

async function waitFor(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('timed out waiting for panorama concurrency test job');
}

async function testTwentyConcurrentJobSubmissions() {
  storage.createTask({
    id: JOB_TASK_ID,
    title: 'Panorama job concurrency regression',
    request: { brief: 'concurrency contract' },
    content_revision: 1,
    status: 'draft',
  });
  let releaseExecution;
  const executionGate = new Promise(resolve => { releaseExecution = resolve; });
  let executions = 0;
  const submissions = await Promise.all(Array.from({ length: 20 }, async () => jobService.queueStage({
    taskId: JOB_TASK_ID,
    stage: 'scene_panorama',
    expectedContentRevision: 1,
    idempotencyKey: `${JOB_TASK_ID}:scene_panorama:r1`,
    execute: async () => {
      executions += 1;
      await executionGate;
    },
  })));
  assert.equal(submissions.filter(result => result.accepted === true).length, 1,
    'exactly one of twenty same-task submissions may be accepted');
  assert.equal(submissions.filter(result => result.duplicate === true).length, 19,
    'the other nineteen same-task submissions must be returned as duplicates');
  assert.equal(new Set(submissions.map(result => result.job.id)).size, 1,
    'all duplicate responses must point to the one authoritative job');
  releaseExecution();
  await waitFor(() => ['succeeded', 'failed'].includes(jobService.getJob(JOB_TASK_ID)?.status));
  assert.equal(executions, 1, 'the accepted panorama job must execute exactly once');
  assert.equal(jobService.getJob(JOB_TASK_ID)?.status, 'succeeded');
}

async function testProjectedBatchContinuation(candidate) {
  storage.createTask({ id: BATCH_TASK_ID, title: 'Panorama batch regression', brief: 'batch', request: {}, content_revision: 1, status: 'draft' });
  storage.saveOutput(BATCH_TASK_ID, 'scene_config', {
    spaces: ['batch-scene-1', 'batch-scene-2', 'batch-scene-3'].map(id => ({ id, space_id: id, name: id })),
  });
  sceneAssets.saveSceneAssetsToTask(BATCH_TASK_ID, [neutralScene('batch-scene-1', candidate)]);
  for (const sceneId of ['batch-scene-2', 'batch-scene-3']) {
    storage.saveOutput(BATCH_TASK_ID, `scene_asset_checkpoint:${sceneId}`, {
      scene_id: sceneId,
      space_id: sceneId,
      status: 'partial',
      views: { master: { status: 'succeeded', image_url: candidate.image_url, provider_submission_state: 'completed', billing_state: 'confirmed' } },
    });
  }
  const plan = scenePanorama.planForTask(BATCH_TASK_ID);
  assert.equal(plan.scene_count, 3, 'batch planning must include checkpoint-projected scenes, not only formal scene_assets');
  let scene2Submissions = 0;
  let otherSubmissions = 0;
  const deps = {
    imageGenerator: async options => {
      if (options.filename.includes('batch-scene-2')) {
        scene2Submissions += 1;
        await options.onSubmitting?.({ clientRequestId: options.clientRequestId, providerSubmissionState: 'submitting' });
        const error = new Error('ambiguous provider 500');
        error.code = 'PROVIDER_5XX_AMBIGUOUS';
        error.billingState = 'unknown';
        throw error;
      }
      otherSubmissions += 1;
      return candidate;
    },
    reviewPanorama: async () => ({
      pass: true, source_fidelity_score: 0.98, geometry_consistency_score: 0.98,
      wraparound_consistency_score: 0.98, projection_consistency_score: 0.98, mismatch_reasons: [],
    }),
  };
  const first = await scenePanorama.generateTaskPanoramas(BATCH_TASK_ID, {
    cost_confirmation: true,
    plan_fingerprint: plan.plan_fingerprint,
  }, { generationId: 'batch-generation-1' }, deps);
  assert.equal(first.status, 'partial_failed');
  assert.equal(first.completed_count, 2, 'a single 500 must not stop later independent panorama scenes');
  assert.equal(first.failed_count, 1);
  assert.equal(scene2Submissions, 1);
  assert.equal(otherSubmissions, 2);
  const resumePlan = scenePanorama.planForTask(BATCH_TASK_ID);
  assert.equal(resumePlan.blocked_count, 1, 'the exact ambiguous panorama unit must remain frozen for billing review');
  const second = await scenePanorama.generateTaskPanoramas(BATCH_TASK_ID, {
    cost_confirmation: true,
    plan_fingerprint: resumePlan.plan_fingerprint,
  }, { generationId: 'batch-generation-2' }, deps);
  assert.equal(second.completed_count, 2, 'verified panoramas must be reused during batch resume');
  assert.equal(scene2Submissions, 1, 'batch resume must not resubmit the billing-ambiguous scene');
  assert.equal(otherSubmissions, 2, 'batch resume must not regenerate already verified scenes');
}

function testBatchUiContract() {
  const worldView = fs.readFileSync(path.join(root, 'public/story-ad/views/sceneWorldView.js'), 'utf8');
  const action = fs.readFileSync(path.join(root, 'public/story-ad/views/panoramaGeneration.js'), 'utf8');
  const unifiedStage = fs.readFileSync(path.join(root, 'public/story-ad/views/assetCenterStageView.js'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'src/routes/newStoryAd.js'), 'utf8');
  assert(!worldView.includes('data-generate-all-panoramas'));
  assert(!worldView.includes('runPanoramaBatchGeneration'));
  assert(action.includes('/scene-assets/panoramas/plan'));
  assert(action.includes('/scene-assets/panoramas'));
  assert(unifiedStage.includes('360°全景'));
  assert(unifiedStage.includes('data-generate-production-assets'));
  assert(route.includes('scenePanoramaService.generateTaskPanoramas'));
  assert(route.includes('panoramas.failed_count'));
}

async function main() {
  const candidate = await createSyntheticGrid('panorama-contract-grid.png');
  const brokenCandidate = await createSyntheticGrid('panorama-broken-seam-grid.png', 512, 256, { brokenSeam: true });
  const invalidRatioCandidate = await createSyntheticGrid('panorama-invalid-ratio-grid.png', 480, 320);
  const providerValidation = await testProviderCandidateValidation(candidate, brokenCandidate, invalidRatioCandidate);
  const projection = await testProjectionContract(candidate);
  const generated = await testGenerationAndReuse(candidate);
  await testQaFailurePreservesAuthority(generated, brokenCandidate);
  testSourceChangeInvalidatesAuthority(generated);
  await testPaidStateBlocksDuplicate(candidate);
  testWorldCapabilityBoundaries(generated);
  testProjectionAndShotReference(generated);
  await testKeyframeQaPanoramaReference(generated);
  await testTwentyConcurrentJobSubmissions();
  await testProjectedBatchContinuation(candidate);
  testBatchUiContract();
  console.log(JSON.stringify({
    success: true,
    panorama_dimensions: [projection.normalized.width, projection.normalized.height],
    seam_error: projection.normalized.seam_error,
    broken_seam_error_preserved: providerValidation.broken.seam_error,
    invalid_3_2_provider_candidate_rejected: true,
    deterministic_cardinal_views: projection.views.map(view => ({ key: view.key, yaw: view.yaw, sha256: view.sha256 })),
    planned_model_calls: 2,
    local_projection_model_calls: 0,
    idempotent_reuse_model_calls: 0,
    ordinary_photo_not_panorama: true,
    panorama_3dof_not_6dof: true,
    project_projection_preserved: true,
    panorama_shot_reference_selected: true,
    panorama_keyframe_qa_reference_selected: true,
    qa_failure_preserved_old_authority: true,
    source_change_invalidated_old_authority: true,
    provider_and_qa_paid_states_blocked: true,
    twenty_concurrent_jobs_one_accepted: true,
    projected_batch_scenes: 3,
    batch_500_continues_and_exact_unit_stays_blocked: true,
    forbidden_industry_sentinels: FORBIDDEN_INDUSTRY_SENTINELS.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  try { storage.deleteTask(TASK_ID); } catch {}
  try { storage.deleteTask(JOB_TASK_ID); } catch {}
  try { storage.deleteTask(BATCH_TASK_ID); } catch {}
  fs.rmSync(outputDir, { recursive: true, force: true });
});
