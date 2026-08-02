const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-scene-atlas-v7');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';
process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneCheckpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
const sceneAtlas = require('../src/services/newStoryAd/sceneAtlasService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const contextBuilder = require('../src/services/newStoryAd/contextBuilder');

const sceneSpec = {
  layoutText: 'One complete physical space with readable boundaries, one entrance, fixed anchors and an unobstructed circulation route.',
  materialLightText: 'Continuous task-specific finishes with realistic scale, stable colour identity and one coherent natural lighting direction.',
  interactionText: 'Keep a visible empty interaction zone beside the main anchor and preserve a usable route to and from the entrance.',
  negativeText: 'No people, no text, no logos, no unrelated objects, no sample boards and no redesign between camera positions.',
  surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'regional' },
};

function contextFor(brief = 'Create one reusable physical space identity.') {
  return {
    brief,
    product_subject: 'current task subject',
    scene_spec: sceneSpec,
  };
}

function seedTask(taskId, spaces, mode = spaces.length > 1 ? 'multi' : 'single') {
  const context = contextFor(spaces.map(space => space.description).join(' / '));
  storage.createTask({ id: taskId, title: taskId, request: context });
  storage.saveOutput(taskId, 'context', context);
  storage.saveOutput(taskId, 'scene_config', {
    scene_mode: mode,
    spaces: spaces.map(space => ({
      ...space,
      scene_spec: { ...sceneSpec, layoutText: space.description },
    })),
  });
}

function verifiedContract(options = {}) {
  return {
    schema_version: 6,
    status: 'verified',
    full_space_lock: true,
    space_lock_status: 'complete',
    verification: { state: 'verified', reasons: [] },
    cross_view_qa: {
      pass: true,
      scene_consistency_score: 0.97,
      geometry_consistency_score: 0.96,
      material_consistency_score: 0.97,
      mismatch_reasons: [],
    },
    requirement_qa: {
      pass: true,
      layout_match_score: 0.96,
      material_light_match_score: 0.96,
      interaction_match_score: 0.95,
      surface_topology_match_score: 0.96,
      negative_compliance_score: 0.98,
      mismatch_reasons: [],
    },
    photographic_realism_qa: {
      pass: true,
      photographic_realism_score: 0.93,
      physical_material_score: 0.92,
      natural_variation_score: 0.9,
      optical_capture_score: 0.91,
      real_photo_evidence: ['natural optical falloff', 'localized physical variation'],
      synthetic_signals: [],
      mismatch_reasons: [],
    },
    camera_design_qa: {
      pass: true,
      role_definition_score: 0.95,
      requirement_mapping_score: 0.94,
      direction_evidence_score: 0.92,
      parameter_completeness_score: 0.96,
      layout_mapping_score: 0.91,
      mismatch_reasons: [],
    },
    spatial_coverage_qa: {
      pass: true,
      coverage_score: 0.96,
      layout_topology_score: 0.96,
      camera_diversity_score: 0.95,
      reverse_coverage_score: 0.95,
      interaction_zone_score: 0.95,
      reasons: [],
    },
    layout_contract: {
      required: true,
      status: 'available',
      reference_image_url: options.views?.find(view => view.key === 'layout')?.url || '',
    },
    view_issues: [],
    cameras: (options.views || []).filter(view => view.key !== 'layout').map((view, index) => ({
      view_id: view.key,
      label: view.label || view.key,
      reference_image_url: view.url,
      role: { master: '建立空间关系', reverse: '验证背向空间', interaction: '验证动作区', detail: '验证关键材质' }[view.key],
      framing: view.key === 'detail' ? '近景特写' : (view.key === 'interaction' ? '中广景' : '广角全景'),
      lens_class: view.key === 'detail' ? '50-85mm detail' : '24-35mm wide',
      height_class: view.key === 'detail' ? 'surface_level' : 'eye_level',
      orientation: `${view.key} camera direction`,
      estimated_azimuth_degrees: [20, 130, 75, 70][index],
      estimated_pitch_degrees: [2, 1, 0, -12][index],
      azimuth_delta_from_master_degrees: view.key === 'reverse' ? 110 : null,
      normalized_position: [[0.12, 0.82], [0.82, 0.25], [0.32, 0.68], [0.5, 0.55]][index],
      look_at: [[0.55, 0.45], [0.42, 0.58], [0.58, 0.48], [0.57, 0.5]][index],
      position_confidence: 0.9,
      target_description: `${view.key} target`,
      allowed_zone_ids: ['zone_action'],
      requirement_refs: view.key === 'master' || view.key === 'reverse'
        ? ['layout']
        : (view.key === 'interaction' ? ['interaction'] : ['material_light', 'surface_topology']),
      visible_evidence: `${view.key} visible camera evidence`,
      pass: true,
      mismatch_reasons: [],
    })),
  };
}

async function writeAtlas(filePath, seed) {
  const colours = [
    { r: 30 + seed, g: 80, b: 120 },
    { r: 80, g: 40 + seed, b: 130 },
    { r: 70, g: 120, b: 40 + seed },
    { r: 130, g: 70, b: 30 + seed },
  ];
  const tiles = await Promise.all(colours.map(colour => sharp({
    create: { width: 1024, height: 576, channels: 3, background: colour },
  }).png().toBuffer()));
  await sharp({
    create: { width: 2048, height: 1152, channels: 3, background: { r: 5, g: 7, b: 11 } },
  }).composite([
    { input: tiles[0], left: 0, top: 0 },
    { input: tiles[1], left: 1024, top: 0 },
    { input: tiles[2], left: 0, top: 576 },
    { input: tiles[3], left: 1024, top: 576 },
  ]).png().toFile(filePath);
}

async function writeLayout(filePath, seed) {
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 3,
      background: { r: 180 - seed, g: 190, b: 200 },
    },
  }).png().toFile(filePath);
}

async function main() {
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  const originalValidateLayout = sceneSpace.validateLayoutAcquisition;
  const originalSplitAtlas = sceneAtlas.splitSceneAtlas;
  const calls = [];

  mediaAdapter.generateImage = async options => {
    calls.push(options);
    if (typeof options.onSubmitting === 'function') {
      await options.onSubmitting({
        clientRequestId: options.clientRequestId,
        providerSubmissionState: 'submitted_unknown',
      });
    }
    if (typeof options.onSubmitted === 'function') {
      await options.onSubmitted({
        clientRequestId: options.clientRequestId,
        providerRequestId: `provider-request-${calls.length}`,
        providerSubmissionState: 'submitted',
      });
    }
    fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
    const index = calls.length;
    const isAtlas = /_atlas_/i.test(options.filename || '');
    const filename = mediaAdapter.safeFilename(options.filename || `atlas-v7-${index}`, '.png');
    const filePath = path.join(mediaAdapter.ASSET_DIR, filename);
    if (isAtlas) await writeAtlas(filePath, 10 + (index % 50));
    else await writeLayout(filePath, 10 + (index % 50));
    const url = `/api/new-story-ad/assets/${encodeURIComponent(filename)}`;
    return { url, image_url: url, filePath, filename, provider_used: 'mock/atlas-v7' };
  };
  sceneSpace.validateLayoutAcquisition = async () => ({
    pass: true,
    layout_role_score: 0.98,
    footprint_coverage_score: 0.97,
    overhead_verticality_score: 0.98,
    boundary_completeness_score: 0.97,
    scene_identity_score: 0.97,
    camera_relocation_score: 0.98,
    reasons: [],
  });
  sceneSpace.analyzeSceneViews = async options => verifiedContract(options);

  try {
    const singleTaskId = 'scene-atlas-v7-single';
    seedTask(singleTaskId, [{
      id: 'space_single',
      space_id: 'space_single',
      name: 'Single Space',
      description: 'A single modern studio with a north entrance and a fixed centre display.',
    }]);
    const singleStart = calls.length;
    const single = await sceneAssets.generateSceneAsset(singleTaskId, {
      space_id: 'space_single',
      generation_id: 'generation-scene-atlas-v7-single',
    });
    const singleCalls = calls.slice(singleStart);
    assert.equal(singleCalls.length, 2, '单场景必须只有母图和布局两次图片调用');
    assert.match(singleCalls[0].prompt, /canonical 2-by-2 perspective atlas/i);
    assert.doesNotMatch(singleCalls[0].prompt, /exactly one continuous camera view/i);
    assert.doesNotMatch(singleCalls[0].prompt, /no multi-panel composition/i);
    assert.doesNotMatch(singleCalls[0].prompt, /no split screen/i);
    assert.match(singleCalls[0].prompt, /naturally occurring local variation/i);
    assert.match(singleCalls[0].prompt, /do not interpret clean, smooth, uniform or uncluttered as sterile perfection/i);
    assert.deepEqual(
      singleCalls[1].referenceImages,
      [singleCalls[0] && `/api/new-story-ad/assets/${encodeURIComponent(singleCalls[0].filename ? mediaAdapter.safeFilename(singleCalls[0].filename, '.png') : '')}`],
      '图集模式的布局只能引用一个权威母图，不能再附加由同一母图裁切出的冗余主视角',
    );
    assert.match(singleCalls[1].prompt, /Reference image 1 is the canonical 2-by-2 perspective atlas/i);
    assert.doesNotMatch(singleCalls[1].prompt, /Reference image 2|master reference controls appearance/i);
    assert.equal(singleCalls[0].generationId, 'generation-scene-atlas-v7-single');
    assert.equal(singleCalls[1].generationId, 'generation-scene-atlas-v7-single');
    assert.ok(singleCalls.every(call => /^scene_[a-f0-9]{10}_[a-f0-9]{10}_r1_(?:atlas|layout)_a1_[a-f0-9]{8}$/.test(call.clientRequestId)),
      '每次图片调用必须携带可追踪且有边界的提交编号');
    assert.equal(single.scene_asset.view_strategy, 'atlas_2x2');
    assert.equal(single.scene_asset.generation_contract_version, 7);
    assert.deepEqual(single.scene_asset.view_images.map(view => view.key), ['master', 'reverse', 'interaction', 'detail', 'layout']);
    assert.equal(single.scene_asset.space_asset_contract.schema_version, 7);
    assert.equal(single.scene_asset.space_asset_contract.space_id, 'space_single');
    assert.equal(single.scene_asset.space_asset_contract.provider_image_call_count, 2);
    assert.equal(single.scene_asset.space_asset_contract.local_crop_count, 4);
    const contextRoundTrip = contextBuilder.normalizeSceneAssets([single.scene_asset])[0];
    assert.equal(contextRoundTrip.view_strategy, 'atlas_2x2');
    assert.equal(contextRoundTrip.generation_contract_version, 7);
    assert.equal(contextRoundTrip.space_asset_contract.canonical_source.sha256, single.scene_asset.space_asset_contract.canonical_source.sha256);
    assert.equal(contextRoundTrip.view_images[0].parent_sha256, single.scene_asset.view_images[0].parent_sha256);
    assert.equal(contextRoundTrip.photographic_realism_qa?.pass, single.scene_asset.photographic_realism_qa?.pass);
    const cropViews = single.scene_asset.view_images.filter(view => view.key !== 'layout');
    assert.equal(new Set(cropViews.map(view => view.parent_sha256)).size, 1, '四个透视视角必须来自同一母图哈希');
    assert.ok(cropViews.every(view => view.derived_locally === true && view.file_sha256));
    for (const view of cropViews) {
      const filePath = mediaAdapter.assetPathFromName(decodeURIComponent(view.url.split('/').pop()));
      const metadata = await sharp(filePath).metadata();
      assert.deepEqual([metadata.width, metadata.height], [1024, 576], `${view.key} 裁切尺寸必须稳定`);
    }
    const singleCheckpoint = storage.getOutput(singleTaskId, sceneCheckpoint.outputKind('space_single'));
    assert.equal(singleCheckpoint.status, 'published');
    assert.ok(sceneCheckpoint.checkpointView(singleCheckpoint, 'atlas'));
    assert.equal(singleCheckpoint.views.atlas.generation_id, 'generation-scene-atlas-v7-single');
    assert.equal(singleCheckpoint.views.layout.generation_id, 'generation-scene-atlas-v7-single');
    assert.match(singleCheckpoint.views.layout.submission_id, /^scene_[a-z0-9_]+$/);
    assert.match(singleCheckpoint.views.layout.provider_request_id, /^provider-request-/);

    const failedTaskId = 'scene-atlas-v7-tracking-failure';
    seedTask(failedTaskId, [{
      id: 'space_tracking_failure',
      space_id: 'space_tracking_failure',
      name: 'Tracking Failure Space',
      description: 'A generic empty production location used only for failure tracking.',
    }]);
    const failedOpened = sceneCheckpoint.open({
      taskId: failedTaskId,
      sceneId: 'space_tracking_failure',
      fingerprint: 'f'.repeat(64),
      candidateRevision: 1,
      viewKeys: ['layout'],
      metadata: { generation_id: 'generation-tracking-failure' },
    });
    const failedSubmissionId = sceneCheckpoint.submissionId(failedOpened.checkpoint, 'layout', 1);
    sceneCheckpoint.markSubmitting(failedOpened.checkpoint, 'layout', {
      generationId: 'generation-tracking-failure',
      clientRequestId: failedSubmissionId,
      attempt: 1,
    });
    const ambiguousFailure = new Error('provider returned an unclassified 5xx');
    ambiguousFailure.code = 'PROVIDER_5XX_AMBIGUOUS';
    ambiguousFailure.billingState = 'unknown';
    ambiguousFailure.providerSubmissionState = 'submitted_unknown';
    ambiguousFailure.providerRequestId = 'provider-request-tracking-failure';
    ambiguousFailure.generationId = 'generation-tracking-failure';
    ambiguousFailure.submissionId = failedSubmissionId;
    ambiguousFailure.attempt = 1;
    sceneCheckpoint.markFailed(failedOpened.checkpoint, 'layout', ambiguousFailure);
    const failedCheckpoint = storage.getOutput(failedTaskId, sceneCheckpoint.outputKind('space_tracking_failure'));
    assert.equal(failedCheckpoint.views.layout.generation_id, 'generation-tracking-failure');
    assert.equal(failedCheckpoint.views.layout.submission_id, failedSubmissionId);
    assert.equal(failedCheckpoint.views.layout.billing_state, 'unknown');
    assert.throws(
      () => sceneCheckpoint.open({
        taskId: failedTaskId,
        sceneId: 'space_tracking_failure',
        fingerprint: 'f'.repeat(64),
        candidateRevision: 1,
        viewKeys: ['layout'],
      }),
      error => error?.code === 'SCENE_ASSET_BILLING_UNKNOWN'
        && error?.details?.failed_views?.[0]?.generation_id === 'generation-tracking-failure'
        && error?.details?.failed_views?.[0]?.submission_id === failedSubmissionId,
      '模糊 5xx 必须用生成编号和提交编号阻止无确认的重复付费调用',
    );

    const promptMigrationTaskId = 'scene-atlas-v7-prompt-policy-migration';
    seedTask(promptMigrationTaskId, [{
      id: 'space_prompt_policy_migration',
      space_id: 'space_prompt_policy_migration',
      name: 'Prompt Policy Migration Space',
      description: 'A generic production location with stable task geometry.',
    }]);
    const legacyFingerprint = '1'.repeat(64);
    const currentFingerprint = '2'.repeat(64);
    sceneCheckpoint.open({
      taskId: promptMigrationTaskId,
      sceneId: 'space_prompt_policy_migration',
      fingerprint: legacyFingerprint,
      candidateRevision: 1,
      viewKeys: ['atlas', 'layout'],
    });
    const migrated = sceneCheckpoint.open({
      taskId: promptMigrationTaskId,
      sceneId: 'space_prompt_policy_migration',
      fingerprint: currentFingerprint,
      compatibleFingerprints: [legacyFingerprint],
      candidateRevision: 1,
      viewKeys: ['atlas', 'layout'],
    });
    assert.equal(migrated.resumed, true);
    assert.equal(migrated.checkpoint.input_fingerprint, currentFingerprint);
    assert.equal(migrated.checkpoint.migrated_from_input_fingerprint, legacyFingerprint);
    assert.ok(migrated.checkpoint.prompt_policy_migrated_at);

    const safeScenePrompt = sceneAssets.buildSceneSheetPrompt({
      ctx: contextFor(),
      body: { scene_spec: sceneSpec },
      outputRole: 'contract',
    });
    const safeLayoutPrompt = sceneAssets.buildLayoutAcquisitionPrompt({
      ctx: contextFor(),
      body: { scene_spec: sceneSpec },
    });
    const legacyPromptText = sceneAssets.legacyScenePromptFingerprintText(
      safeScenePrompt,
      safeLayoutPrompt,
      sceneSpec.negativeText,
    );
    assert.doesNotMatch(safeScenePrompt, /Additional negative requirements: No people/i);
    assert.match(legacyPromptText.scenePrompt, /Additional negative requirements: No people/i);
    assert.match(legacyPromptText.layoutPrompt, /Task prohibitions that remain applicable/i);

    const recoveryTaskId = 'scene-atlas-v7-recovery';
    seedTask(recoveryTaskId, [{
      id: 'space_recovery',
      space_id: 'space_recovery',
      name: 'Recovery Space',
      description: 'A recovery-test gallery with one west entrance and a fixed central plinth.',
    }]);
    let failSplitOnce = true;
    sceneAtlas.splitSceneAtlas = async options => {
      if (failSplitOnce) {
        failSplitOnce = false;
        const error = new Error('simulated local crop interruption');
        error.code = 'SCENE_ATLAS_SPLIT_FAILED';
        throw error;
      }
      return originalSplitAtlas(options);
    };
    const recoveryStart = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(recoveryTaskId, {
        space_id: 'space_recovery',
        view_strategy: 'atlas_2x2',
      }),
      error => error?.code === 'SCENE_ATLAS_SPLIT_FAILED'
        && error.completed_view_keys?.includes('atlas'),
    );
    assert.equal(calls.length - recoveryStart, 1, '本地裁切失败前只能产生一次母图调用');
    const resumed = await sceneAssets.generateSceneAsset(recoveryTaskId, {
      space_id: 'space_recovery',
      view_strategy: 'atlas_2x2',
    });
    assert.equal(calls.length - recoveryStart, 2, '恢复时必须复用已付费母图，只新增布局调用');
    const recoveryCallTotal = calls.length - recoveryStart;
    assert.equal(resumed.scene_asset.view_acquisition.resumed_from_checkpoint, true);
    assert.equal(resumed.scene_asset.view_acquisition.provider_image_call_count, 2);
    sceneAtlas.splitSceneAtlas = originalSplitAtlas;

    const multiTaskId = 'scene-atlas-v7-multi';
    seedTask(multiTaskId, [
      {
        id: 'space_park',
        space_id: 'space_park',
        name: 'Park',
        description: 'An open city park lawn with a running path, tree boundary and no indoor furniture.',
      },
      {
        id: 'space_home',
        space_id: 'space_home',
        name: 'Home',
        description: 'A modern home living room with a kitchen opening, sofa anchor and no park landscape.',
      },
    ]);
    const multiStart = calls.length;
    const park = await sceneAssets.generateSceneAsset(multiTaskId, {
      space_id: 'space_park',
      view_strategy: 'atlas_2x2',
    });
    const home = await sceneAssets.generateSceneAsset(multiTaskId, {
      space_id: 'space_home',
      view_strategy: 'atlas_2x2',
    });
    const multiCalls = calls.slice(multiStart);
    assert.equal(multiCalls.length, 4, '两个独立空间必须各有母图和布局，共四次图片调用');
    assert.match(multiCalls[0].prompt, /open city park lawn/i);
    assert.doesNotMatch(multiCalls[0].prompt, /modern home living room/i);
    assert.match(multiCalls[2].prompt, /modern home living room/i);
    assert.doesNotMatch(multiCalls[2].prompt, /open city park lawn/i);
    assert.equal(park.scene_asset.space_id, 'space_park');
    assert.equal(home.scene_asset.space_id, 'space_home');
    assert.notEqual(
      park.scene_asset.space_asset_contract.canonical_source.sha256,
      home.scene_asset.space_asset_contract.canonical_source.sha256,
      '不同 space_id 必须持有不同母资产',
    );
    const storedMulti = storage.getOutput(multiTaskId, 'scene_assets');
    assert.deepEqual(storedMulti.map(asset => asset.space_id), ['space_park', 'space_home']);
    assert.ok(storage.getOutput(multiTaskId, sceneCheckpoint.outputKind('space_park')));
    assert.ok(storage.getOutput(multiTaskId, sceneCheckpoint.outputKind('space_home')));

    const atlasRepairPlan = sceneAssets.buildSceneRepairPlan({
      id: 'space_repair_plan',
      scene_id: 'space_repair_plan',
      generation_contract_version: 7,
      view_strategy: 'atlas_2x2',
      view_images: single.scene_asset.view_images,
      scene_contract: {
        ...single.scene_asset.scene_contract,
        status: 'rejected',
        full_space_lock: false,
        verification: { state: 'rejected', reasons: ['反向视图固定结构不一致'] },
        view_issues: [{
          code: 'CROSS_VIEW_GEOMETRY_MISMATCH',
          view_keys: ['reverse'],
          reason: '反向视图固定结构不一致',
          evidence: '反向视图中的入口位置与其他三个透视格不一致',
          confidence: 0.97,
        }],
      },
    });
    assert.equal(atlasRepairPlan.action, 'rebuild_atlas');
    assert.equal(atlasRepairPlan.provider_image_call_count, 2);
    assert.deepEqual(atlasRepairPlan.view_keys, ['master', 'layout', 'reverse', 'interaction', 'detail']);

    const threeTaskId = 'scene-atlas-v7-three-spaces';
    seedTask(threeTaskId, [
      {
        id: 'space_a',
        space_id: 'space_a',
        name: 'A',
        description: 'A coastal terrace with a fixed stone railing and no interior room.',
      },
      {
        id: 'space_b',
        space_id: 'space_b',
        name: 'B',
        description: 'A library reading room with fixed shelves and no coastal terrace.',
      },
      {
        id: 'space_c',
        space_id: 'space_c',
        name: 'C',
        description: 'A subway concourse with fixed columns and no library shelves.',
      },
    ]);
    const threeStart = calls.length;
    for (const spaceId of ['space_a', 'space_b', 'space_c']) {
      await sceneAssets.generateSceneAsset(threeTaskId, {
        space_id: spaceId,
        view_strategy: 'atlas_2x2',
      });
    }
    const threeCalls = calls.slice(threeStart);
    assert.equal(threeCalls.length, 6, '三个独立空间必须严格按 2N 次图片调用执行');
    assert.equal(storage.getOutput(threeTaskId, 'scene_assets').length, 3);
    assert.equal(new Set(storage.getOutput(threeTaskId, 'scene_assets')
      .map(asset => asset.space_asset_contract.canonical_source.sha256)).size, 3);

    const uiSource = fs.readFileSync(path.join(root, 'public', 'js', 'new-story-ad', 'scene-assets.js'), 'utf8');
    assert.match(uiSource, /view_strategy:\s*'atlas_2x2'/);
    assert.match(uiSource, /摄影真实性/);
    assert.match(uiSource, /V7 母图/);
    assert.match(uiSource, /atlas_2x2:\s*'2×2 空间母资产'/);

    console.log(JSON.stringify({
      status: 'PASS',
      single_scene_provider_calls: singleCalls.length,
      recovery_provider_calls_total: recoveryCallTotal,
      multi_scene_provider_calls: multiCalls.length,
      visible_views_per_space: single.scene_asset.view_images.length,
      local_crops_per_space: cropViews.length,
      covered_space_counts: [1, 2, 3],
      checkpoint_resume_without_duplicate_atlas: true,
      stable_space_id_isolation: true,
    }, null, 2));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
    sceneSpace.validateLayoutAcquisition = originalValidateLayout;
    sceneAtlas.splitSceneAtlas = originalSplitAtlas;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
