const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, '.tmp', 'new-story-ad-spatial-generation-order');
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
process.env.OUTPUT_DIR = outputDir;
process.env.DB_ENABLED = '0';
process.env.NEW_STORY_AD_PUBLIC_BASE_URL = 'https://test.invalid';
process.env.NEW_STORY_AD_SCENE_IMAGE_RETRY_DELAY_MS = '1';
process.env.NEW_STORY_AD_MOCK_LLM = '1';

const storage = require('../src/services/newStoryAd/storageService');
const mediaAdapter = require('../src/services/newStoryAd/mediaAdapter');
const pipelineModels = require('../src/services/pipelineModelService');
const sceneSpace = require('../src/services/newStoryAd/sceneSpaceContractService');
const sceneCheckpoint = require('../src/services/newStoryAd/sceneGenerationCheckpointService');
const sceneAssets = require('../src/services/newStoryAd/sceneAssetService');
const generateSceneAssetWithLegacyMaintenancePath = sceneAssets.generateSceneAsset;
sceneAssets.generateSceneAsset = (taskId, body = {}, runOptions = {}) => generateSceneAssetWithLegacyMaintenancePath(
  taskId,
  { view_strategy: 'image_derived', ...body },
  { ...runOptions, maintenanceLegacyAcquisition: true },
);
const storyAdService = require('../src/services/newStoryAd/storyAdService');
const { currentAllScenePrompts } = require('./helpers/current-scene-prompt-fixture');

async function main() {
  const taskId = 'spatial-generation-order-test';
  const requiredViewKeys = ['layout', 'master', 'reverse', 'interaction', 'detail'];
  const longCheckpoint = {
    task_id: 'fd30ac4c-d54b-44c2-bab7-268fc622b5e5',
    scene_id: 'scene_1784345241398_f8b685_with_an_even_longer_spatial_identity',
    candidate_revision: 11,
    input_fingerprint: 'e3a1ae58c6a98c42cf8645558838067766075862b36e897b70f835fd21824de9',
  };
  const legacySafePart = (value, max) => String(value || '')
    .replace(/[^a-z0-9_-]/ig, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max) || 'scene';
  const legacyPersistedNames = requiredViewKeys.map(key => mediaAdapter.safeFilename([
    'scene_asset',
    legacySafePart(longCheckpoint.task_id, 32),
    legacySafePart(longCheckpoint.scene_id, 32),
    'r11',
    'candidate',
    longCheckpoint.input_fingerprint.slice(0, 12),
    key,
    'image',
  ].join('_'), '.png'));
  assert.equal(new Set(legacyPersistedNames).size, 1, '回归夹具必须复现旧版 96 字符截断碰撞');

  const candidateRows = sceneCheckpoint.assertUniqueCandidateFilenames(longCheckpoint, requiredViewKeys);
  assert.equal(new Set(candidateRows.map(row => row.persisted)).size, 5, '长任务和长场景 ID 的五个持久化文件名必须唯一');
  candidateRows.forEach(row => {
    assert.ok(row.persisted.includes(`_${row.key}_`), `持久化文件名必须保留机位键：${row.key}`);
    assert.ok(row.persisted.length <= 100, '持久化文件名必须满足媒体层长度限制');
  });

  const originalSafeFilename = mediaAdapter.safeFilename;
  mediaAdapter.safeFilename = () => 'forced-collision.png';
  try {
    assert.throws(
      () => sceneCheckpoint.assertUniqueCandidateFilenames(longCheckpoint, requiredViewKeys),
      error => error?.code === 'SCENE_CANDIDATE_FILENAME_COLLISION'
        && Array.isArray(error.filename_diagnostics),
      '运行时必须在图片调用前拒绝任何候选文件名碰撞',
    );
  } finally {
    mediaAdapter.safeFilename = originalSafeFilename;
  }

  const concurrentSource = path.join(outputDir, 'candidate-concurrency-source.svg');
  fs.writeFileSync(concurrentSource, '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#446688"/></svg>');
  const persistedCandidates = await Promise.all(candidateRows.map(row => mediaAdapter.persistImageResult({
    result: { filePath: concurrentSource },
    filename: row.requested,
  })));
  assert.equal(new Set(persistedCandidates.map(item => item.filePath)).size, 5, '五机位并发持久化不得写入同一路径');
  persistedCandidates.forEach(item => assert.ok(fs.existsSync(item.filePath)));

  const context = {
    brief: 'Lock one reusable commercial interior before storyboard generation.',
    product_subject: 'current task subject',
    world_setting: {
      profiles: [{
        id: 'world_live_action',
        era_family: 'modern_china',
        visual_medium: 'live_action',
      }],
    },
    scene_spec: {
      layoutText: 'One complete room with a main wall, entrance, sofa, table and empty interaction zone.',
      materialLightText: 'Continuous metal feature wall with warm grazing light and realistic stone floor.',
      interactionText: 'Keep a reachable action zone beside the table and an unobstructed route from the entrance.',
      negativeText: 'No people, no text, no duplicated furniture and no visible decorative panel seams.',
      surfaceTopology: {
        mode: 'continuous',
        seam_policy: 'hidden',
        finish_distribution: 'regional',
      },
    },
  };
  const seedSingleSceneTask = (id, title, sceneId) => {
    storage.createTask({ id, title, request: context });
    storage.saveOutput(id, 'context', context);
    storage.saveOutput(id, 'scene_config', {
      scene_mode: 'single',
      spaces: [{
        id: sceneId,
        name: title,
        description: context.scene_spec.layoutText,
        story_purpose: '场景生成回归',
        scene_spec: context.scene_spec,
      }],
    });
    currentAllScenePrompts(id);
  };
  assert.throws(
    () => sceneAssets.assertCompleteUpgradeSceneSpec({
      require_complete_scene_spec: true,
      scene_spec: { layoutText: '只有布局，其他字段为空' },
    }),
    error => error?.code === 'SCENE_SPEC_INCOMPLETE'
      && error.missing_fields.includes('materialLightText')
      && error.missing_fields.includes('interactionText')
      && error.missing_fields.includes('negativeText'),
    '完整升级必须在任何图片调用前拒绝缺字段空间设定',
  );
  seedSingleSceneTask(taskId, 'spatial generation order', 'locked-room');

  const calls = [];
  let activeImageCalls = 0;
  let peakImageCalls = 0;
  let transientFailuresRemaining = 0;
  let transientFilenamePattern = null;
  let transientFailureMessage = 'socket hang up ECONNRESET';
  let transientFailureCode = '';
  let transientBillingUnknown = false;
  let layoutPreflightFailuresRemaining = 0;
  let finalQaLayoutFailuresRemaining = 0;
  let finalQaUnavailableRemaining = 0;
  let exactDuplicateFiles = false;
  const originalGenerateImage = mediaAdapter.generateImage;
  const originalAnalyze = sceneSpace.analyzeSceneViews;
  const originalValidateLayout = sceneSpace.validateLayoutAcquisition;
  mediaAdapter.generateImage = async options => {
    calls.push(options);
    const callNumber = calls.length;
    activeImageCalls += 1;
    peakImageCalls = Math.max(peakImageCalls, activeImageCalls);
    await new Promise(resolve => setTimeout(resolve, 5));
    if (transientFailuresRemaining > 0 && transientFilenamePattern?.test(options.filename || '')) {
      transientFailuresRemaining -= 1;
      activeImageCalls -= 1;
      const error = new Error(transientFailureMessage);
      if (transientFailureCode) error.code = transientFailureCode;
      if (transientBillingUnknown) {
        error.billingState = 'unknown';
        error.providerSubmissionState = 'submitted_unknown';
      }
      throw error;
    }
    const url = `/mock-scene-view-${callNumber}.png`;
    let filePath = '';
    if (exactDuplicateFiles) {
      fs.mkdirSync(mediaAdapter.ASSET_DIR, { recursive: true });
      filePath = path.join(mediaAdapter.ASSET_DIR, `mock-duplicate-${callNumber}.png`);
      fs.writeFileSync(filePath, 'identical-scene-view-bytes');
    }
    activeImageCalls -= 1;
    return { url, image_url: url, filePath, provider_used: 'mock/spatial-order' };
  };
  sceneSpace.analyzeSceneViews = async options => {
    if (finalQaUnavailableRemaining > 0) {
      finalQaUnavailableRemaining -= 1;
      const error = new Error('vision service temporarily unavailable');
      error.code = 'VISION_QA_UNAVAILABLE';
      error.retryable = true;
      throw error;
    }
    const layoutRejected = finalQaLayoutFailuresRemaining > 0;
    if (layoutRejected) finalQaLayoutFailuresRemaining -= 1;
    return {
      schema_version: 6,
      status: layoutRejected ? 'rejected' : 'verified',
      full_space_lock: !layoutRejected,
      observed_summary: 'One locked location represented by five distinct spatial views.',
      verification: layoutRejected
        ? { state: 'rejected', reasons: ['第5张俯视布局只是主视图的轻微抬高重构'] }
        : { state: 'verified', reasons: [] },
      cross_view_qa: {
        pass: true,
        scene_consistency_score: 0.96,
        geometry_consistency_score: 0.95,
        material_consistency_score: 0.96,
        mismatch_reasons: [],
      },
      requirement_qa: {
        pass: true,
        layout_match_score: 0.96,
        material_light_match_score: 0.95,
        interaction_match_score: 0.94,
        surface_topology_match_score: 0.96,
        negative_compliance_score: 0.97,
        mismatch_reasons: [],
      },
      photographic_realism_qa: {
        pass: true,
        photographic_realism_score: 0.94,
        physical_material_score: 0.93,
        natural_variation_score: 0.9,
        optical_capture_score: 0.92,
        real_photo_evidence: ['natural lens falloff', 'localized physical variation'],
        synthetic_signals: [],
        mismatch_reasons: [],
      },
      camera_design_qa: {
        pass: !layoutRejected,
        role_definition_score: layoutRejected ? 0.6 : 0.94,
        requirement_mapping_score: layoutRejected ? 0.6 : 0.93,
        direction_evidence_score: layoutRejected ? 0.5 : 0.91,
        parameter_completeness_score: 0.96,
        layout_mapping_score: layoutRejected ? 0.4 : 0.9,
        mismatch_reasons: layoutRejected ? ['俯视定位不足'] : [],
      },
      spatial_coverage_qa: {
        pass: !layoutRejected,
        layout_topology_score: layoutRejected ? 0.2 : 0.95,
        camera_diversity_score: layoutRejected ? 0.4 : 0.92,
        reverse_coverage_score: 0.9,
        interaction_zone_score: 0.9,
        reasons: layoutRejected ? ['第5张俯视布局只是主视图的轻微抬高重构'] : [],
      },
      layout_contract: { required: true, status: 'available' },
      view_issues: layoutRejected ? [{
        code: 'LAYOUT_ROLE_INVALID',
        view_keys: ['layout'],
        reason: '俯视布局只是主视图的轻微抬高重构',
        evidence: '未覆盖完整可用范围',
        confidence: 0.98,
      }] : [],
      cameras: options.views.filter(view => view.key !== 'layout').map((view, index) => ({
        view_id: view.key,
        reference_image_url: view.url,
        label: view.key,
        role: `${view.key} role`,
        framing: view.key === 'detail' ? 'close detail' : 'wide',
        lens_class: view.key === 'detail' ? '50-85mm detail' : '24-35mm wide',
        height_class: view.key === 'detail' ? 'surface_level' : 'eye_level',
        orientation: `${view.key} direction`,
        estimated_azimuth_degrees: [20, 130, 75, 70][index],
        estimated_pitch_degrees: [2, 1, 0, -12][index],
        azimuth_delta_from_master_degrees: view.key === 'reverse' ? 110 : null,
        normalized_position: [[0.12, 0.82], [0.82, 0.25], [0.32, 0.68], [0.5, 0.55]][index],
        look_at: [[0.55, 0.45], [0.42, 0.58], [0.58, 0.48], [0.57, 0.5]][index],
        position_confidence: 0.9,
        target_description: `${view.key} target`,
        allowed_zone_ids: ['zone_action'],
        requirement_refs: view.key === 'interaction' ? ['interaction']
          : (view.key === 'detail' ? ['material_light'] : ['layout']),
        visible_evidence: `${view.key} visible evidence`,
        pass: !layoutRejected,
        mismatch_reasons: layoutRejected ? ['俯视定位不足'] : [],
      })),
    };
  };
  sceneSpace.validateLayoutAcquisition = async () => {
    if (layoutPreflightFailuresRemaining > 0) {
      layoutPreflightFailuresRemaining -= 1;
      return {
        pass: false,
        layout_role_score: 0.2,
        footprint_coverage_score: 0.2,
        overhead_verticality_score: 0.2,
        boundary_completeness_score: 0.2,
        estimated_downward_pitch_degrees: 45,
        visible_horizon: true,
        dominant_vertical_wall_face: true,
        complete_perimeter_visible: false,
        ceiling_removed_or_not_visible: false,
        master_like_composition: true,
        scene_identity_score: 0.95,
        camera_relocation_score: 0.2,
        reasons: ['机位仍接近主视图，没有展示完整可用范围'],
      };
    }
    return {
      pass: true,
      layout_role_score: 0.95,
      footprint_coverage_score: 0.94,
      overhead_verticality_score: 0.96,
      boundary_completeness_score: 0.95,
      estimated_downward_pitch_degrees: 88,
      visible_horizon: false,
      dominant_vertical_wall_face: false,
      complete_perimeter_visible: true,
      ceiling_removed_or_not_visible: true,
      master_like_composition: false,
      scene_identity_score: 0.96,
      camera_relocation_score: 0.93,
      reasons: [],
    };
  };

  try {
    const filenameGateTaskId = 'spatial-candidate-filename-collision-preflight-test';
    seedSingleSceneTask(filenameGateTaskId, 'candidate filename collision preflight', 'long-scene-id-that-would-collide-before-any-provider-call');
    const callsBeforeFilenameGate = calls.length;
    const safeFilenameBeforeGate = mediaAdapter.safeFilename;
    mediaAdapter.safeFilename = () => 'forced-collision.png';
    try {
      await assert.rejects(
        () => sceneAssets.generateSceneAsset(filenameGateTaskId, {
          scene_id: 'long-scene-id-that-would-collide-before-any-provider-call',
          scene_spec: context.scene_spec,
        }),
        error => error?.code === 'SCENE_CANDIDATE_FILENAME_COLLISION',
        '场景生成服务必须在任何图片供应商调用前执行最终文件名唯一性门禁',
      );
    } finally {
      mediaAdapter.safeFilename = safeFilenameBeforeGate;
    }
    assert.equal(calls.length, callsBeforeFilenameGate, '候选文件名碰撞不得产生任何图片模型调用');

    const generated = await sceneAssets.generateSceneAsset(taskId, {
      scene_id: 'locked-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    const asset = generated.scene_asset;

    assert.equal(sceneAssets.needsLayoutView({ layout: 'one simple wall' }), true);
    assert.deepEqual(sceneAssets.REQUIRED_SCENE_VIEW_KEYS, requiredViewKeys);
    assert.deepEqual(sceneAssets.SCENE_GENERATION_ORDER, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.equal(calls.length, 5, 'one generation call per required asset, with no service-level retry');
    assert.equal(peakImageCalls, 1, 'paid scene views must be submitted in authority order so one ambiguous provider failure can stop later submissions');
    assert.match(calls[0].filename, /_master_/);
    assert.deepEqual(calls[0].referenceImages || [], []);
    assert.equal(calls[0].imageModel, 'gpt-image-2');
    assert.match(calls[0].prompt, /MASTER ESTABLISHING VIEW/i);
    assert.match(calls[0].prompt, /Visual medium: photoreal live action/i);
    assert.match(calls[0].prompt, /real on-location photograph/i);
    assert.match(calls[0].prompt, /must not resemble an architectural visualization/i);
    assert.doesNotMatch(calls[0].prompt, /geometry-only spatial blueprint/i);
    assert.match(calls[0].auditSafePrompt, /root master establishing view/i);
    assert.ok(calls[0].auditSafePrompt.length <= 2200);

    assert.match(calls[1].filename, /_layout_/);
    assert.deepEqual(calls[1].referenceImages, ['/mock-scene-view-1.png']);
    assert.equal(calls[1].requireReferences, true);
    assert.equal(calls[1].inputFidelity, 'low');
    assert.equal(calls[1].imageModel, 'gpt-image-2');
    assert.match(calls[1].prompt, /NEAR-VERTICAL TOP-DOWN WHOLE-SPACE LAYOUT/i);
    assert.match(calls[1].prompt, /82 to 90 degree downward/i);
    assert.match(calls[1].prompt, /complete usable ground\/base footprint.*every scene boundary/i);
    assert.match(calls[1].prompt, /master reference controls scene identity.*not the target camera composition/i);
    assert.doesNotMatch(calls[1].prompt, /Scene interaction and camera position requirement/i);
    assert.ok(calls[1].prompt.length <= 6200, 'layout role prompt must remain compact enough for Image2 to prioritize camera acquisition');
    assert.match(calls[1].prompt, /Reference image 1 is the master establishing view/i);
    assert.match(calls[1].prompt, /same location|exact(?: physical)? location/i);
    assert.match(calls[1].prompt, /remove the ceiling.*low cutaway perimeter boundaries/i);
    assert.match(calls[1].prompt, /Material identity and surface topology are independent constraints/i);
    assert.match(calls[1].auditSafePrompt, /near-vertical top-down whole-space layout/i);

    for (const call of calls.slice(2, 4)) {
      assert.deepEqual(call.referenceImages, ['/mock-scene-view-1.png', '/mock-scene-view-2.png']);
      assert.equal(call.requireReferences, true);
      assert.equal(call.inputFidelity, 'low');
      assert.equal(call.imageModel, 'gpt-image-2');
      assert.match(call.prompt, /Reference image 1 is the master establishing view.*Reference image 2 is the master-derived near-vertical top-down spatial layout/i);
      assert.match(call.prompt, /master as the primary scene\/appearance identity/i);
      assert.match(call.prompt, /unoccupied/i);
      assert.ok(call.auditSafePrompt.length <= 2200);
    }
    assert.match(calls[2].filename, /_reverse_/);
    assert.match(calls[2].prompt, /at least about 90 degrees of azimuth change/i);
    assert.match(calls[2].prompt, /not a small reframing|near-identical composition/i);
    assert.match(calls[3].filename, /_interaction_/);
    assert.match(calls[3].prompt, /human eye\/chest height/i);
    assert.match(calls[3].prompt, /empty standing\/action clearance/i);
    assert.match(calls[4].filename, /_detail_/);
    assert.deepEqual(calls[4].referenceImages, ['/mock-scene-view-1.png']);
    assert.equal(calls[4].inputFidelity, 'high');
    assert.match(calls[4].prompt, /Reference image 1 is the master establishing view/i);
    assert.match(calls[4].prompt, /close or macro crop/i);
    assert.match(calls[4].prompt, /must not be another wide room view/i);

    assert.deepEqual(asset.view_images.map(view => view.key), ['master', 'reverse', 'interaction', 'detail', 'layout']);
    assert.equal(asset.image_url, '/mock-scene-view-1.png', 'master remains the historical primary thumbnail');
    assert.equal(asset.view_count, 5);
    assert.equal(asset.generation_contract_version, 7);
    assert.equal(asset.layout_contract.required, true);
    assert.equal(asset.view_acquisition.layout_policy, 'required_for_all_new_scenes');
    assert.equal(asset.view_acquisition.layout_appearance_role, 'master_derived_near_vertical_topdown');
    assert.equal(asset.view_acquisition.generation_contract_version, 7);
    assert.deepEqual(asset.view_acquisition.generation_order, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.deepEqual(asset.view_acquisition.reference_graph, {
      master: [],
      layout: ['master'],
      reverse: ['master', 'layout'],
      interaction: ['master', 'layout'],
      detail: ['master'],
    });
    const progress = storage.getTask(taskId).generation_progress;
    assert.equal(progress.stage, 'scene_asset');
    assert.equal(progress.scene_id, 'locked-room');
    assert.equal(progress.status, 'completed');
    assert.equal(progress.target_total, 5);
    assert.equal(progress.succeeded, 5);
    assert.deepEqual(progress.completed_view_keys, ['master', 'layout', 'reverse', 'interaction', 'detail']);
    assert.equal(storyAdService.taskSummary(storage.getTask(taskId)).generation_progress.stage, 'scene_asset', 'scene progress must reach the polling API');
    const publicSceneAsset = storyAdService.publicTaskBundle(taskId).outputs.scene_assets[0];
    assert.equal(publicSceneAsset.repair_plan.version, 5, 'the public bundle must normalize scene assets before rendering the repair action');

    const legacyUpgradeTaskId = 'spatial-legacy-v0-full-upgrade-test';
    seedSingleSceneTask(legacyUpgradeTaskId, 'legacy v0 full upgrade', 'legacy-room');
    const legacyUrls = ['/legacy-master.png', '/legacy-reverse.png', '/legacy-interaction.png', '/legacy-detail.png'];
    storage.saveOutput(legacyUpgradeTaskId, 'scene_assets', [{
      id: 'legacy-room',
      scene_id: 'legacy-room',
      scene_revision: 1,
      generation_contract_version: 0,
      image_url: legacyUrls[0],
      view_images: ['master', 'reverse', 'interaction', 'detail'].map((key, index) => ({
        key,
        url: legacyUrls[index],
        image_url: legacyUrls[index],
      })),
      view_count: 4,
      verification: { state: 'verified' },
    }]);
    const callsBeforeLegacyUpgrade = calls.length;
    const upgradedLegacy = await sceneAssets.generateSceneAsset(legacyUpgradeTaskId, {
      scene_id: 'legacy-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeLegacyUpgrade, 5, 'legacy API upgrade must generate all five v7-compatible views instead of reusing old images');
    assert.equal(upgradedLegacy.scene_asset.scene_id, 'legacy-room');
    assert.equal(upgradedLegacy.scene_asset.scene_revision, 2);
    assert.equal(upgradedLegacy.scene_asset.generation_contract_version, 7);
    assert.equal(upgradedLegacy.scene_asset.view_acquisition.generation_contract_version, 7);
    assert.equal(upgradedLegacy.scene_asset.view_count, 5);
    assert(upgradedLegacy.scene_asset.view_images.every(view => !legacyUrls.includes(view.url || view.image_url)));
    const storedLegacyUpgrade = storage.getOutput(legacyUpgradeTaskId, 'scene_assets')[0];
    assert.equal(storedLegacyUpgrade.generation_contract_version, 7, 'published storage must replace legacy data with v7 atomically');
    assert.equal(storedLegacyUpgrade.scene_revision, 2);

    const duplicateTaskId = 'spatial-exact-duplicate-gate-test';
    seedSingleSceneTask(duplicateTaskId, 'exact duplicate layout gate', 'duplicate-room');
    const callsBeforeDuplicateTask = calls.length;
    exactDuplicateFiles = true;
    const duplicateResult = await sceneAssets.generateSceneAsset(duplicateTaskId, {
      scene_id: 'duplicate-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    exactDuplicateFiles = false;
    assert.equal(calls.length - callsBeforeDuplicateTask, 3, '重复布局最多尝试两次，且不得继续生成其余派生视图');
    assert.equal(duplicateResult.base_visual_ready, true, '布局增强失败不得抹掉已经成功的基础主视角');
    assert.equal(duplicateResult.enhancement_pending, true);
    assert.equal(duplicateResult.scene_asset.view_count, 1);
    assert.equal(duplicateResult.scene_asset.view_images[0].key, 'master');
    assert.equal(duplicateResult.scene_asset.partial_checkpoint, true);
    assert.equal(storage.getTaskBundle(duplicateTaskId).stages.find(row => row.stage === 'scene_asset')?.status, 'warning');
    const duplicateCheckpoint = storage.getOutput(duplicateTaskId, 'scene_asset_checkpoint:duplicate-room');
    assert.equal(duplicateCheckpoint.status, 'partial');
    assert.equal(duplicateCheckpoint.views.master.status, 'succeeded');
    assert.equal(duplicateCheckpoint.views.layout.status, 'failed');
    assert.equal(duplicateCheckpoint.views.reverse, undefined);

    const retryTaskId = 'spatial-generation-transient-retry-test';
    seedSingleSceneTask(retryTaskId, 'transient image2 retry', 'retry-room');
    const callsBeforeRetryTask = calls.length;
    transientFailuresRemaining = 1;
    transientFilenamePattern = /_reverse_/;
    const retried = await sceneAssets.generateSceneAsset(retryTaskId, {
      scene_id: 'retry-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeRetryTask, 6, 'one network reset must retry only the failed view once');
    assert.equal(retried.scene_asset.view_count, 5);
    assert.equal(storage.getTask(retryTaskId).generation_progress.status, 'completed');

    const checkpointTaskId = 'spatial-partial-checkpoint-resume-test';
    seedSingleSceneTask(checkpointTaskId, 'partial checkpoint resume', 'checkpoint-room');
    storage.saveOutput(checkpointTaskId, 'scene_assets', [{
      id: 'checkpoint-room',
      scene_id: 'checkpoint-room',
      space_id: 'checkpoint-room',
      name: 'checkpoint room',
      scene_revision: 3,
      image_url: '/api/new-story-ad/assets/checkpoint-room-r3.png',
      view_images: [],
    }]);
    const callsBeforeCheckpoint = calls.length;
    transientFailuresRemaining = 1;
    transientFilenamePattern = /_detail(?:_|\.)/;
    transientFailureMessage = 'HTTP 500 Internal Server Error; provider review may include copyright policy';
    transientFailureCode = 'PROVIDER_5XX_AMBIGUOUS';
    transientBillingUnknown = true;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(checkpointTaskId, {
        scene_id: 'checkpoint-room',
        scene_spec: context.scene_spec,
        aspect_ratio: '16:9',
      }),
      error => error?.code === 'PROVIDER_5XX_AMBIGUOUS' && error?.partial_scene_checkpoint === true,
    );
    assert.equal(calls.length - callsBeforeCheckpoint, 5, 'a rights-ambiguous 500 must stop without an automatic paid retry');
    const partialCheckpoint = storage.getOutput(checkpointTaskId, 'scene_asset_checkpoint:checkpoint-room');
    assert.equal(partialCheckpoint.status, 'partial');
    assert.equal(partialCheckpoint.candidate_revision, 4);
    assert.deepEqual(
      Object.entries(partialCheckpoint.views).filter(([, view]) => view.status === 'succeeded').map(([key]) => key).sort(),
      ['interaction', 'layout', 'master', 'reverse'],
      'four completed paid views must remain recoverable',
    );
    transientFailuresRemaining = 0;
    transientFilenamePattern = null;
    transientFailureMessage = 'socket hang up ECONNRESET';
    transientFailureCode = '';
    transientBillingUnknown = false;
    storage.saveOutput(checkpointTaskId, 'scene_assets', [{
      id: 'checkpoint-room',
      scene_id: 'checkpoint-room',
      space_id: 'checkpoint-room',
      name: 'checkpoint room',
      scene_revision: 1,
      image_url: '/api/new-story-ad/assets/checkpoint-room-r1.png',
      view_images: [],
    }]);
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(checkpointTaskId, {
        scene_id: 'checkpoint-room',
        scene_spec: context.scene_spec,
        aspect_ratio: '16:9',
      }),
      error => error?.code === 'SCENE_ASSET_BILLING_UNKNOWN'
        && error?.details?.requires_billing_acknowledgement === true,
      'unknown billing must block a blind checkpoint resubmission before another provider call',
    );
    assert.equal(calls.length - callsBeforeCheckpoint, 5, 'billing review gate must not call the provider');
    const resumedCheckpoint = await sceneAssets.generateSceneAsset(checkpointTaskId, {
      scene_id: 'checkpoint-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
      acknowledge_billing_unknown: true,
    });
    assert.equal(calls.length - callsBeforeCheckpoint, 6, 'resume must call the provider only for the one missing view');
    assert.equal(resumedCheckpoint.scene_asset.view_count, 5);
    assert.equal(resumedCheckpoint.scene_asset.view_acquisition.resumed_from_checkpoint, true);
    assert.equal(storage.getOutput(checkpointTaskId, 'scene_asset_checkpoint:checkpoint-room').status, 'published');
    assert.equal(
      Object.keys(storyAdService.publicTaskBundle(checkpointTaskId).outputs || {})
        .some(kind => String(kind).startsWith('scene_asset_checkpoint:')),
      false,
      'private checkpoint metadata must not leak into the public task bundle',
    );

    const multiSpaceTaskId = 'multi-space-prompt-isolation-layout-resume-test';
    const mixedContext = {
      ...context,
      scene_mode: 'multi',
      scene_spec: {
        ...context.scene_spec,
        layoutText: '错误的全局混合设定：PARK_ONLY_TOKEN 与 HOME_ONLY_TOKEN 被放在同一空间。',
      },
    };
    const parkSpec = {
      layoutText: 'PARK_ONLY_TOKEN：开阔公园草坪、完整树线、稳定入口、弧形步道与长椅形成连续可导航户外空间。',
      materialLightText: '连续自然草地、浅灰步道、真实树木、统一午后侧逆光方向与合理环境反射，仅属于户外公园。',
      interactionText: '草坪中央保留完整人物与宠物互动区域，弧形步道提供无阻挡连续进出路线与摄影机路径。',
      negativeText: '禁止人物、文字水印、拼贴样板、重复树木、错误透视、空间边界断裂和不相关室内陈设。',
    };
    const homeSpec = {
      layoutText: 'HOME_ONLY_TOKEN：家庭客厅、稳定入口、相邻厨房与清晰通道形成一个完整连续的室内生活空间。',
      materialLightText: '连续木地板、真实布艺沙发、统一暖色窗光方向与合理室内辅助照明，仅属于家庭室内。',
      interactionText: '沙发前保留完整家庭互动区域，厨房通道保持畅通并提供明确连续摄影机移动路径。',
      negativeText: '禁止人物、文字水印、拼贴样板、重复家具、错误透视、空间边界断裂和不相关户外陈设。',
    };
    storage.createTask({ id: multiSpaceTaskId, title: 'multi space prompt isolation', request: mixedContext });
    storage.saveOutput(multiSpaceTaskId, 'context', mixedContext);
    storage.saveOutput(multiSpaceTaskId, 'scene_config', {
      scene_mode: 'multi',
      advertised_subject: '当前任务主体',
      spaces: [
        { id: 'park', name: '公园草坪', description: 'PARK_ONLY_TOKEN 户外草坪空间', story_purpose: '户外相遇', scene_spec: parkSpec },
        { id: 'home', name: '家庭客厅与厨房', description: 'HOME_ONLY_TOKEN 家庭室内空间', story_purpose: '家庭收束', scene_spec: homeSpec },
      ],
    });
    currentAllScenePrompts(multiSpaceTaskId);
    const callsBeforeMissingTarget = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(multiSpaceTaskId, {}),
      error => error?.code === 'SCENE_GENERATION_TARGET_REQUIRED',
      'multi-space generation must reject an ambiguous target before any paid call',
    );
    assert.equal(calls.length, callsBeforeMissingTarget);
    transientFailuresRemaining = 1;
    transientFilenamePattern = /_layout(?:_|\.)/;
    transientFailureMessage = 'HTTP 500 Internal Server Error UNKXXXO004IFR';
    transientFailureCode = 'PROVIDER_5XX_AMBIGUOUS';
    transientBillingUnknown = true;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(multiSpaceTaskId, { space_id: 'park', aspect_ratio: '16:9' }),
      error => error?.code === 'PROVIDER_5XX_AMBIGUOUS'
        && error?.scene_id === 'park'
        && error?.partial_scene_checkpoint === true,
      'master success plus layout 500 must preserve the original stable scene id',
    );
    const multiCheckpoint = storage.getOutput(multiSpaceTaskId, 'scene_asset_checkpoint:park');
    assert.equal(multiCheckpoint.scene_id, 'park');
    assert.ok(sceneCheckpoint.checkpointView(multiCheckpoint, 'master'), 'paid master must remain reusable');
    assert.equal(multiCheckpoint.views.layout.billing_state, 'unknown');
    const callsAfterMultiFailure = calls.length;
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(multiSpaceTaskId, { scene_id: 'park', aspect_ratio: '16:9' }),
      error => error?.code === 'SCENE_ASSET_BILLING_UNKNOWN',
      'layout unknown billing must not be blindly resubmitted',
    );
    assert.equal(calls.length, callsAfterMultiFailure);
    transientFailuresRemaining = 0;
    transientFilenamePattern = null;
    transientFailureMessage = 'socket hang up ECONNRESET';
    transientFailureCode = '';
    transientBillingUnknown = false;
    const resumedMulti = await sceneAssets.generateSceneAsset(multiSpaceTaskId, {
      scene_id: 'park',
      acknowledge_billing_unknown: true,
      aspect_ratio: '16:9',
    });
    const multiCalls = calls.slice(callsBeforeMissingTarget);
    assert.equal(multiCalls.length, 6, 'resume must reuse master and submit only layout plus three dependent views');
    multiCalls.forEach(call => {
      assert.match(call.prompt, /PARK_ONLY_TOKEN|公园草坪|户外草坪/);
      assert.doesNotMatch(call.prompt, /HOME_ONLY_TOKEN|家庭客厅|相邻厨房/);
    });
    assert.equal(resumedMulti.scene_asset.scene_id, 'park');
    assert.equal(resumedMulti.scene_asset.space_id, 'park');
    assert.equal(storage.getOutput(multiSpaceTaskId, 'scene_asset_checkpoint:park').status, 'published');

    const preflightTaskId = 'spatial-layout-preflight-retry-test';
    seedSingleSceneTask(preflightTaskId, 'layout preflight retry', 'preflight-room');
    const callsBeforePreflightTask = calls.length;
    layoutPreflightFailuresRemaining = 1;
    const preflightRetried = await sceneAssets.generateSceneAsset(preflightTaskId, {
      scene_id: 'preflight-room',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    const preflightCalls = calls.slice(callsBeforePreflightTask);
    assert.equal(preflightCalls.length, 6, 'a role-invalid layout must retry only the layout once before derived views');
    assert.deepEqual(preflightCalls.map(call => /_(master|layout|reverse|interaction|detail)(?:_|\.)/.exec(call.filename)?.[1]), [
      'master', 'layout', 'layout', 'reverse', 'interaction', 'detail',
    ]);
    assert.match(preflightCalls[2].prompt, /Automated layout-role validation rejected the previous candidate/i);
    assert.equal(preflightRetried.scene_asset.view_count, 5);

    const autoRepairTaskId = 'spatial-final-qa-auto-repair-test';
    seedSingleSceneTask(autoRepairTaskId, 'bounded auto repair', 'auto-repair-location');
    const callsBeforeAutoRepair = calls.length;
    finalQaLayoutFailuresRemaining = 1;
    const autoRepaired = await sceneAssets.generateSceneAsset(autoRepairTaskId, {
      scene_id: 'auto-repair-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeAutoRepair, 6, 'final QA layout rejection must auto-regenerate only layout once');
    assert.equal(autoRepaired.scene_asset.scene_revision, 2);
    assert.equal(autoRepaired.scene_asset.scene_contract.full_space_lock, true);
    assert.deepEqual(autoRepaired.scene_asset.repair_history[0].regenerated_view_keys, ['layout']);

    const boundedTaskId = 'spatial-final-qa-bounded-repair-test';
    seedSingleSceneTask(boundedTaskId, 'bounded repeated rejection', 'bounded-repair-location');
    const callsBeforeBounded = calls.length;
    finalQaLayoutFailuresRemaining = 2;
    const bounded = await sceneAssets.generateSceneAsset(boundedTaskId, {
      scene_id: 'bounded-repair-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeBounded, 6, 'automatic paid repair must stop after one targeted cycle');
    assert.equal(bounded.scene_asset.scene_revision, 2);
    assert.equal(bounded.scene_asset.scene_contract.full_space_lock, false);
    assert.deepEqual(bounded.scene_asset.repair_plan.view_keys, ['layout']);

    const unavailableTaskId = 'spatial-final-qa-unavailable-test';
    seedSingleSceneTask(unavailableTaskId, 'qa unavailable preservation', 'qa-unavailable-location');
    const callsBeforeUnavailable = calls.length;
    finalQaUnavailableRemaining = 1;
    const qaUnavailable = await sceneAssets.generateSceneAsset(unavailableTaskId, {
      scene_id: 'qa-unavailable-location',
      scene_spec: context.scene_spec,
      aspect_ratio: '16:9',
    });
    assert.equal(calls.length - callsBeforeUnavailable, 5, 'QA infrastructure failure must never trigger paid image regeneration');
    assert.equal(qaUnavailable.scene_asset.scene_contract.qa_unavailable, true);
    assert.equal(qaUnavailable.scene_asset.repair_plan.action, 'reverify');

    const genericCases = [
      { material: 'open-grain oak veneer with directional grain and soft wax sheen', forbidden: /stainless steel/i },
      { material: 'translucent borosilicate glass with crisp refraction and matte polymer', forbidden: /oak veneer/i },
      { material: 'woven acoustic fabric with readable fibre scale and anodized aluminium', forbidden: /borosilicate/i },
    ];
    for (const [index, item] of genericCases.entries()) {
      const genericPrompt = sceneAssets.buildSceneSheetPrompt({
        ctx: { brief: `generic business case ${index + 1}` },
        body: { scene_spec: { layoutText: 'one coherent reusable space', materialLightText: item.material } },
        outputRole: 'contract',
      });
      assert.ok(genericPrompt.includes(item.material), 'the current task material must remain authoritative');
      assert.match(genericPrompt, /Keep every task-provided proprietary or trade finish name as content authority/i);
      assert.match(genericPrompt, /Multiple finish terms do not authorize bands, swatches or catalogue panels/i);
      assert.doesNotMatch(genericPrompt, item.forbidden, 'a different test industry/material must never be injected');
    }
    const universalLayoutCases = [
      { layout: 'an enclosed clinic with two access points and fixed treatment anchors', forbidden: /outdoor road|construction yard/i },
      { layout: 'an outdoor road work zone with barriers, access lane and equipment anchors', forbidden: /clinic|office furniture/i },
      { layout: 'a semi-open retail courtyard with two entrances and a central display anchor', forbidden: /treatment|road work/i },
    ];
    universalLayoutCases.forEach((item, index) => {
      const rolePrompt = sceneAssets.buildLayoutAcquisitionPrompt({
        ctx: { brief: `universal location ${index + 1}` },
        body: {
          scene_spec: {
            layoutText: item.layout,
            materialLightText: 'task-specific observable material and natural practical light',
            interactionText: 'eye-level camera tracks parallel to the wall, then cuts to a close-up cinematic lens',
          },
        },
      });
      assert.ok(rolePrompt.length <= 3600);
      assert.ok(rolePrompt.includes(item.layout));
      assert.match(rolePrompt, /82 to 90 degree downward/i);
      assert.match(rolePrompt, /complete usable ground\/base footprint.*every scene boundary/i);
      assert.doesNotMatch(rolePrompt, /eye-level camera tracks parallel to the wall|close-up cinematic lens/i);
      assert.doesNotMatch(rolePrompt, item.forbidden);
    });
    const continuousTradeFinishPrompt = sceneAssets.buildSceneSheetPrompt({
      ctx: { brief: 'generic continuous-surface task' },
      body: {
        scene_spec: {
          layoutText: '一整面连续完整平直的主表面',
          materialLightText: '专有蚀刻纹理、做旧金属风格和细腻拉丝质感的装饰面板',
          negativeText: '禁止模块化拼板、竖向接缝、网格和样品展示墙',
          surfaceTopology: { mode: 'continuous', seam_policy: 'hidden', finish_distribution: 'regional' },
        },
      },
      outputRole: 'contract',
    });
    assert.match(continuousTradeFinishPrompt, /ONE monolithic uninterrupted visual plane/i);
    assert.match(continuousTradeFinishPrompt, /ZERO visible joints/i);
    assert.match(continuousTradeFinishPrompt, /one coherent dominant finish over the primary surface/i);
    assert.match(continuousTradeFinishPrompt, /No authoritative material sample image is attached/i);
    assert.doesNotMatch(continuousTradeFinishPrompt, /physically supplied as sheets, boards or panels|Keep any physically necessary task-supported joints visually recessive/i);
    assert.deepEqual(sceneAssets.sceneMaterialReferenceImages({
      product_presentation: { mode: 'material_surface' },
      product_contract: { reference_images: ['https://example.invalid/material-a.png', 'https://example.invalid/material-a.png'] },
    }), ['https://example.invalid/material-a.png']);
    assert.deepEqual(sceneAssets.sceneMaterialReferenceImages({
      product_presentation: { mode: 'standalone_product' },
      product_contract: { reference_images: ['https://example.invalid/standalone-product.png'] },
    }), [], 'standalone product packshots must not be injected as scene material references');
    const referencedMaterialPrompt = sceneAssets.buildSceneSheetPrompt({
      ctx: {
        product_presentation: { mode: 'material_surface' },
        product_contract: { reference_images: ['https://example.invalid/material-a.png'] },
      },
      body: { scene_spec: { materialLightText: 'task-defined finish' } },
      outputRole: 'contract',
    });
    assert.match(referencedMaterialPrompt, /attached task reference image is appearance evidence/i);
    const glassDetailPrompt = sceneAssets.buildSceneAuditSafePrompt({
      body: { scene_spec: { materialLightText: 'translucent architectural glass with natural refraction' } },
      viewKey: 'detail',
    });
    assert.doesNotMatch(glassDetailPrompt, /required metal finish/i, 'generic detail fallback must not hard-code a metal industry');
    assert.match(glassDetailPrompt, /task-required finish/i);
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.person_sheet'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.scene_asset'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.keyframe'), 'gpt-image-2');
    assert.equal(mediaAdapter.requiredImageModelForStage('new_story_ad.storyboard_sketch'), 'gpt-image-2');
    assert.equal(mediaAdapter.imageConfigStage('new_story_ad.person_dossier_atlas'), 'new_story_ad.person_dossier_atlas');
    assert.equal(mediaAdapter.imageConfigStage('new_story_ad.person_dossier_action'), 'new_story_ad.person_dossier_action');
    assert.equal(mediaAdapter.imageConfigStage('new_story_ad.prop_dossier_atlas'), 'new_story_ad.prop_dossier_atlas');
    assert.equal(mediaAdapter.imageConfigStage('new_story_ad.scene_asset'), 'new_story_ad.scene_asset');
    assert.equal(mediaAdapter.requiredImageModelForStage('unrelated.image'), '');
    const policyCandidates = mediaAdapter.applyImageModelPolicy('new_story_ad.keyframe', [
      { provider_id: 'deyunai', model_id: 'nano-banana-pro' },
      { provider_id: 'deyunai', model_id: 'gpt-image-2' },
      { provider_id: 'deyunai', model_id: 'nano-banana' },
    ]);
    assert.deepEqual(policyCandidates.map(item => item.model_id), ['gpt-image-2'], 'story-ad image policy must remove every Nano Banana fallback');
    const governedPrompt = mediaAdapter.rightsAwareImagePrompt('original commercial scene');
    assert.match(governedPrompt, /Originality requirement:/);
    assert.doesNotMatch(
      governedPrompt,
      /celebrity|public-figure|copyrighted|protected artwork|trademark|brand logo|watermark|bypass|evade/i,
      '平台自动附加的原创要求不得枚举国内供应商容易聚类误判的敏感词',
    );
    const supplierScenePrompt = sceneAssets.buildDerivedViewPrompt(
      sceneAssets.buildLayoutAcquisitionPrompt({
        ctx: {
          scene_spec: {
            layoutText: 'A task-defined logistics warehouse with one loading lane and complete perimeter.',
            materialLightText: 'Real concrete floor and neutral industrial lighting.',
            interactionText: 'Keep the loading route readable.',
            negativeText: '禁止人物、宠物、文字、水印和无关商品',
          },
        },
      }),
      'layout',
      { referenceOrder: ['atlas'] },
    );
    assert.match(supplierScenePrompt, /task-defined scope boundary/i);
    assert.doesNotMatch(supplierScenePrompt, /禁止人物|宠物|水印|Task prohibitions/i,
      '精确排除项保留给本地 QA，供应商提示词应使用正向任务边界，避免负面词清单聚类误判');
    assert.throws(
      () => sceneAssets.assertSceneRightsPreflight({}, {
        scene_spec: { layoutText: '照着某位导演的受保护电影画面进行一比一复刻' },
      }),
      error => error?.code === 'SCENE_RIGHTS_PREFLIGHT_FAILED'
        && error?.rights_policy_version === 'original-rights-v2',
      '供应商提示词改为正向合同后，本地原创与权利预检仍必须阻止真实违规要求',
    );
    assert.equal(mediaAdapter.isProviderRightsAuditError(new Error('copyright infringement policy')), true);
    assert.deepEqual(
      mediaAdapter.classifyImageGenerationError(new Error('HTTP 500 Internal Server Error')),
      {
        code: 'PROVIDER_5XX_AMBIGUOUS',
        retryable: false,
        terminal: true,
        message: '当前图片任务的提交或计费状态尚未确认，已停止自动切换，避免重复费用。',
      },
    );
    const strictImageStages = ['new_story_ad.person_sheet', 'new_story_ad.scene_asset', 'new_story_ad.keyframe', 'new_story_ad.storyboard_sketch'];
    strictImageStages.forEach(stageId => {
      assert.ok(pipelineModels.getStageDefaults(stageId).length > 0, `${stageId} must keep at least one Image2 default`);
      assert.ok(pipelineModels.getStageDefaults(stageId).every(item => item.model_id === 'gpt-image-2'), `${stageId} defaults must contain only Image2`);
      assert.ok(pipelineModels.listAvailableModelsForStage(stageId).every(item => item.model_id === 'gpt-image-2'), `${stageId} admin candidates must contain only Image2`);
      assert.equal(pipelineModels.validateStageModel(stageId, { provider_id: 'deyunai', model_id: 'nano-banana-pro' }).reason, 'stage_requires_gpt_image_2');
    });
    const sanitizedPipeline = pipelineModels.sanitizePipelineConfig({
      stages: {
        'new_story_ad.scene_asset': [
          { provider_id: 'deyunai', model_id: 'nano-banana-pro', enabled: true },
          { provider_id: 'deyunai', model_id: 'gpt-image-2', enabled: true },
          { provider_id: 'deyunai', model_id: 'nano-banana', enabled: true },
        ],
      },
    });
    assert.deepEqual(sanitizedPipeline.stages['new_story_ad.scene_asset'].map(item => item.model_id), ['gpt-image-2']);

    const circuitTaskId = 'spatial-image2-circuit-test';
    seedSingleSceneTask(circuitTaskId, 'image2 circuit', 'circuit-room');
    const callsBeforeCircuit = calls.length;
    transientFailuresRemaining = 2;
    transientFilenamePattern = /_master_/;
    transientFailureMessage = 'socket hang up ECONNRESET';
    transientFailureCode = 'ECONNRESET';
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(circuitTaskId, { scene_id: 'circuit-room', scene_spec: context.scene_spec }),
      /ECONNRESET/,
    );
    assert.equal(calls.length - callsBeforeCircuit, 2, 'two consecutive network failures must stop after one shared-budget retry');
    const cooldownTaskId = 'spatial-image2-cooldown-test';
    seedSingleSceneTask(cooldownTaskId, 'image2 cooldown', 'cooldown-room');
    await assert.rejects(
      () => sceneAssets.generateSceneAsset(cooldownTaskId, { scene_id: 'cooldown-room', scene_spec: context.scene_spec }),
      error => error?.code === 'SCENE_IMAGE_PROVIDER_COOLDOWN',
    );
    assert.equal(calls.length - callsBeforeCircuit, 2, 'open circuit must reject without another paid provider call');
    sceneAssets._resetSceneImageCircuit();
    transientFailuresRemaining = 0;
    transientFilenamePattern = null;
    transientFailureMessage = 'socket hang up ECONNRESET';
    transientFailureCode = '';

    assert(calls.every(call => /no people/i.test(call.prompt)), '每一张场景图片提示词都必须明确禁止随机人物');
    console.log(JSON.stringify({
      success: true,
      generation_order: asset.view_acquisition.generation_order,
      stored_view_order: asset.view_images.map(view => view.key),
      generation_calls: calls.length,
      peak_parallel_image_calls: peakImageCalls,
      real_progress_views: progress.succeeded,
      generic_material_cases: genericCases.length,
      all_views_empty_scene: calls.every(call => /no people/i.test(call.prompt)),
      empty_scene_missing_stages: calls.filter(call => !/no people/i.test(call.prompt)).map(call => call.stage),
      primary_view_backward_compatible: asset.image_url === '/mock-scene-view-1.png',
      model_management_image2_only: true,
      task_extra_attempt_budget: sceneAssets.SCENE_IMAGE_EXTRA_ATTEMPTS,
      provider_circuit_breaker: true,
      partial_checkpoint_resume: true,
      rights_ambiguous_500_stops_retry: true,
    }, null, 2));
  } finally {
    mediaAdapter.generateImage = originalGenerateImage;
    sceneSpace.analyzeSceneViews = originalAnalyze;
    sceneSpace.validateLayoutAcquisition = originalValidateLayout;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
