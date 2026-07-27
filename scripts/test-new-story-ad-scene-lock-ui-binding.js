const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');
const qualityReview = require('../src/services/newStoryAd/qualityReviewService');

function fullAsset() {
  return {
    scene_id: 'scene-v3',
    name: '完整空间场景',
    generation_contract_version: 7,
    view_images: [
      { key: 'master', url: '/master.png' },
      { key: 'reverse', url: '/reverse.png' },
      { key: 'interaction', url: '/interaction.png' },
      { key: 'detail', url: '/detail.png' },
      { key: 'layout', label: '俯视布局', url: '/layout.png' },
    ],
    scene_contract: {
      schema_version: 6,
      status: 'verified',
      requirement_qa: {
        pass: true,
        layout_match_score: 0.96,
        material_light_match_score: 0.95,
        interaction_match_score: 0.94,
        surface_topology_match_score: 0.97,
        negative_compliance_score: 0.98,
      },
      photographic_realism_qa: {
        pass: true,
        photographic_realism_score: 0.93,
        physical_material_score: 0.92,
        natural_variation_score: 0.9,
        optical_capture_score: 0.91,
        real_photo_evidence: ['natural lens falloff', 'localized material and use variation'],
        synthetic_signals: [],
        mismatch_reasons: [],
      },
      camera_design_qa: {
        pass: true,
        role_definition_score: 0.94,
        requirement_mapping_score: 0.93,
        direction_evidence_score: 0.91,
        parameter_completeness_score: 0.96,
        layout_mapping_score: 0.9,
        mismatch_reasons: [],
      },
      cross_view_qa: {
        pass: true,
        scene_consistency_score: 0.95,
        geometry_consistency_score: 0.94,
        material_consistency_score: 0.96,
      },
      spatial_coverage_qa: {
        pass: true,
        layout_topology_score: 0.94,
        camera_diversity_score: 0.91,
        reverse_coverage_score: 0.92,
        interaction_zone_score: 0.95,
        mismatch_reasons: [],
      },
      layout_contract: { status: 'available', required: true, reference_image_url: '/layout.png' },
      anchors: [{ id: 'wall', label: '主墙', required: true }],
      zones: [{ id: 'interaction_zone', label: '互动区' }],
      cameras: [
        ['master', '主视角', '建立空间关系', '广角全景', '24-28mm wide', 'eye_level', '入口朝互动区', 20, 2, null, [0.12, 0.82], [0.55, 0.45], ['layout'], '入口、互动区与主要锚点同框'],
        ['reverse', '反向/侧向', '验证背向空间', '广角全景', '28-35mm wide', 'eye_level', '互动区反看入口', 130, 1, 110, [0.82, 0.25], [0.42, 0.58], ['layout'], '前后景互换并出现主视角未见边界'],
        ['interaction', '互动位', '验证人物动作区', '中广景', '35mm normal-wide', 'chest_level', '沿动线朝操作面', 75, 0, null, [0.32, 0.68], [0.58, 0.48], ['interaction'], '动作净空、操作面和进出路线同框'],
        ['detail', '材质细节', '验证关键材质', '近景特写', '50-85mm detail', 'surface_level', '朝关键接触面', 70, -12, null, [0.5, 0.55], [0.57, 0.5], ['material_light', 'surface_topology'], '纹理尺度、粗糙度与接触阴影清晰'],
      ].map(([view_id, label, role, framing, lens_class, height_class, orientation, azimuth, pitch, delta, position, look_at, requirement_refs, evidence]) => ({
        id: `camera_${view_id}`,
        view_id,
        label,
        role,
        framing,
        lens_class,
        height_class,
        orientation,
        estimated_azimuth_degrees: azimuth,
        estimated_pitch_degrees: pitch,
        azimuth_delta_from_master_degrees: delta,
        normalized_position: position,
        look_at,
        position_confidence: 0.9,
        target_description: role,
        allowed_zone_ids: ['interaction_zone'],
        requirement_refs,
        visible_evidence: evidence,
        pass: true,
        mismatch_reasons: [],
      })),
    },
  };
}

function loadFrontend() {
  const source = fs.readFileSync(path.join(root, 'public/js/new-story-ad/scene-assets.js'), 'utf8');
  const sandbox = {
    window: {},
    document: { getElementById: () => null },
    console,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(source, sandbox, { filename: 'scene-assets.js' });
  return sandbox.window.NewStoryAdSceneAssets;
}

function loadButtonState() {
  const source = fs.readFileSync(path.join(root, 'public/js/new-story-ad/button-state.js'), 'utf8');
  const sandbox = { window: {}, document: { querySelector: () => null } };
  vm.runInNewContext(source, sandbox, { filename: 'button-state.js' });
  return sandbox.window.NewStoryAdButtonState;
}

async function main() {
  const asset = fullAsset();
  assert.equal(sceneBinding.completeSpaceLock(asset), true, 'v3 + 三道 QA + 俯视布局才是完整空间锁');
  assert.deepEqual(sceneBinding.primarySceneViews(asset).map(view => view.key), ['master', 'reverse', 'interaction', 'detail']);
  assert.equal(sceneBinding.layoutSceneReference(asset).role, 'auxiliary_spatial_lock');

  const digest = sceneBinding.sceneAssetDigest([asset])[0];
  assert.equal(digest.available_views.length, 4, '分镜可选机位不得包含 layout');
  assert.equal(digest.available_views.some(view => view.key === 'layout'), false);
  assert.equal(digest.layout_reference.available, true);
  assert.equal(digest.space_lock_status, 'complete');

  const boundLayoutRequest = sceneBinding.bindShotToScene({ scene_id: 'scene-v3', scene_view: 'layout', visual: '完整空间建立镜头' }, [asset]);
  assert.equal(boundLayoutRequest.scene_view, 'master', '商业镜头不得绑定 layout 辅助视图');
  const openViewAsset = fullAsset();
  openViewAsset.scene_id = 'scene-open-view';
  openViewAsset.view_images.splice(3, 0, { key: 'runner_follow_left', label: '跑者左后跟随位', url: '/runner-follow.png' });
  // 自定义镜位来自当前任务资产，因此应贯穿绑定、摘要与前端选项，而不是被改回固定四镜位。
  const openViewShot = sceneBinding.bindShotToScene({
    scene_id: 'scene-open-view',
    scene_view: 'runner_follow_left',
    visual: '跟随当前任务主体',
  }, [openViewAsset]);
  assert.equal(openViewShot.scene_view, 'runner_follow_left');
  assert.equal(sceneBinding.sceneAssetDigest([openViewAsset])[0].available_views.some(view => view.key === 'runner_follow_left'), true);
  const openViewReview = qualityReview.localReview({ scene_assets: [openViewAsset] }, [{
    ...openViewShot,
    title: '开放镜位',
    visual: '主体在当前任务场景中连续运动，镜位来自场景资产。',
    action: '主体沿当前任务定义的路径持续向前移动。',
    voiceover: '保持动作连续。',
    purpose: '验证开放镜位不会被旧枚举误判。',
    shot_size: 'medium',
    camera_angle: 'eye_level',
    composition: '主体与环境关系清晰。',
    subject_position: '主体位于画面中心偏左。',
    camera_movement: '稳定跟随。',
    entry_frame_state: '主体开始移动。',
    exit_frame_state: '主体完成本镜动作。',
    screen_direction: 'left_to_right',
    eyeline: 'forward',
    camera_axis: 'same_side',
    object_states: '当前任务对象状态保持。',
    transition_type: 'cut_on_action',
  }]);
  assert.equal(openViewReview.blocking_issues.some(item => item.includes('场景视角')), false);
  const lock = sceneBinding.sceneContractForShot({ scene_assets: [asset] }, boundLayoutRequest);
  assert.equal(lock.view_images.length, 4);
  assert.equal(lock.layout_reference.url, '/layout.png');
  assert.equal(lock.layout_reference.role, 'auxiliary_spatial_lock');
  assert.equal(lock.spatial_contract.schema_version, 6);
  assert.equal(lock.spatial_contract.spatial_coverage_qa.pass, true);
  assert.equal(lock.space_lock_status, 'complete');

  const certifiedExisting = fullAsset();
  certifiedExisting.scene_id = 'certified-existing-scene';
  delete certifiedExisting.generation_contract_version;
  certifiedExisting.scene_contract = {
    ...certifiedExisting.scene_contract,
    schema_version: 6,
    source_schema_version: 6,
    compatibility_status: 'current',
    full_space_lock: true,
    space_lock_status: 'complete',
  };
  assert.equal(sceneBinding.completeSceneViewEvidence(certifiedExisting), true);
  assert.equal(sceneBinding.completeSpaceLock(certifiedExisting), true, '完整五视图和三项 QA 可以证明空间锁，不应因缺少生成来源字段误判');
  assert.equal(sceneAssetService.sceneGenerationUpgradeRequired(certifiedExisting), false);
  assert.equal(sceneAssetService.buildSceneRepairPlan(certifiedExisting).action, 'none');

  const cameraLegacy = fullAsset();
  cameraLegacy.scene_id = 'camera-legacy-scene';
  cameraLegacy.scene_contract = {
    ...cameraLegacy.scene_contract,
    schema_version: 5,
    source_schema_version: 5,
    full_space_lock: true,
    space_lock_status: 'complete',
  };
  delete cameraLegacy.scene_contract.camera_design_qa;
  cameraLegacy.scene_contract.cameras = cameraLegacy.scene_contract.cameras.map(camera => ({
    id: camera.id,
    view_id: camera.view_id,
    label: camera.label,
  }));
  assert.equal(sceneBinding.completeSpaceLock(cameraLegacy), false, 'schema 5 without per-camera evidence must no longer enter keyframes');
  const normalizedCameraLegacy = sceneAssetService.normalizeSceneAssets([cameraLegacy])[0];
  assert.equal(normalizedCameraLegacy.scene_contract.space_lock_status, 'camera_review_required');
  assert.equal(normalizedCameraLegacy.repair_plan.action, 'reverify', 'missing camera evidence must use zero-image re-verification');
  assert.equal(sceneBinding.sceneVerificationState(normalizedCameraLegacy), 'camera_review_required');
  assert.throws(
    () => sceneBinding.assertVerifiedSceneAssets([normalizedCameraLegacy]),
    error => error?.code === 'SCENE_VERIFICATION_REQUIRED'
      && error.invalid_scenes[0].status === 'camera_review_required',
  );

  const duplicateEvidence = fullAsset();
  duplicateEvidence.generation_contract_version = 0;
  duplicateEvidence.view_images[4].url = duplicateEvidence.view_images[0].url;
  assert.equal(sceneBinding.completeSceneViewEvidence(duplicateEvidence), false, '五个机位不得复用同一个图片身份');
  assert.equal(sceneBinding.completeSpaceLock(duplicateEvidence), false);
  assert.equal(sceneAssetService.sceneGenerationUpgradeRequired(duplicateEvidence), true);

  const legacy = fullAsset();
  legacy.scene_id = 'legacy-scene';
  legacy.generation_contract_version = 0;
  legacy.view_images = legacy.view_images.slice(0, 4);
  legacy.scene_contract = {
    status: 'verified',
    requirement_qa: { pass: true },
    cross_view_qa: { pass: true },
  };
  assert.equal(sceneBinding.completeSpaceLock(legacy), false);
  assert.equal(sceneBinding.sceneVerificationState(legacy), 'legacy_partial');
  assert.throws(() => sceneBinding.assertVerifiedSceneAssets([legacy]), error => (
    error.code === 'SCENE_VERIFICATION_REQUIRED'
    && error.invalid_scenes[0].status === 'legacy_partial'
  ));
  const normalizedLegacy = {
    ...legacy,
    scene_contract: {
      ...legacy.scene_contract,
      schema_version: 3,
      source_schema_version: 2,
      compatibility_status: 'legacy_partial',
      spatial_coverage_qa: { pass: false, legacy: true, coverage_status: 'legacy_partial' },
    },
  };
  assert.equal(sceneBinding.sceneVerificationState(normalizedLegacy), 'legacy_partial');

  const frontend = loadFrontend();
  const park = { id: 'space_park', name: 'Park', scene_spec: { layoutText: 'park' } };
  const home = { id: 'space_home', name: 'Home', scene_spec: { layoutText: 'home' } };
  const firstPlanned = frontend.plannedGenerationTarget({
    sceneConfig: { scene_mode: 'multi', spaces: [park, home] },
    sceneAssets: [],
  });
  assert.equal(firstPlanned.targetSpaceId, 'space_park', 'first multi-scene generation must submit the first planned stable space ID');
  const nextPlanned = frontend.plannedGenerationTarget({
    sceneConfig: { scene_mode: 'multi', spaces: [park, home] },
    sceneAssets: [{ id: 'space_park', scene_id: 'space_park', space_id: 'space_park', image_url: '/park.png' }],
  }, { append: true });
  assert.equal(nextPlanned.targetSpaceId, 'space_home', 'append must submit the next missing planned stable space ID');
  const selectedPlanned = frontend.plannedGenerationTarget({
    sceneConfig: { scene_mode: 'multi', spaces: [park, home] },
    sceneAssets: [
      { id: 'space_park', scene_id: 'space_park', space_id: 'space_park', image_url: '/park.png' },
      { id: 'space_home', scene_id: 'space_home', space_id: 'space_home', image_url: '/home.png' },
    ],
    sceneSelectedIndex: 1,
  });
  assert.equal(selectedPlanned.targetSpaceId, 'space_home', 'regeneration must keep the selected space stable ID');
  const certifiedAssessment = frontend.sceneLockAssessment(certifiedExisting);
  assert.equal(certifiedAssessment.complete, true);
  assert.equal(certifiedAssessment.upgradeRequired, false);
  assert.equal(certifiedAssessment.evidenceComplete, true);
  const staleDirectResponse = {
    ...certifiedExisting,
    camera_design_qa: {
      pass: false,
      legacy: true,
      role_definition_score: null,
      requirement_mapping_score: null,
      direction_evidence_score: null,
      parameter_completeness_score: null,
      layout_mapping_score: null,
    },
    verification: { state: 'camera_review_required', message: 'stale top-level state' },
  };
  const normalizedDirectResponse = frontend.normalizeAssets([staleDirectResponse])[0];
  assert.equal(normalizedDirectResponse.camera_design_qa.pass, true, 'frontend must prefer the current scene contract over stale top-level QA');
  assert.equal(frontend.sceneLockAssessment(normalizedDirectResponse).complete, true);
  const verifyToasts = [];
  const verifyState = { taskId: 'task-direct-response', sceneAssets: [staleDirectResponse] };
  const verifyResult = await frontend.verify({
    state: verifyState,
    sceneId: staleDirectResponse.scene_id,
    api: async () => ({ scene_assets: [staleDirectResponse] }),
    normalizeBundle: () => {},
    renderAll: () => {},
    setButtonBusy: () => {},
    toast: (message, type) => verifyToasts.push({ message, type }),
    button: {},
  });
  assert.equal(verifyResult, true);
  assert.deepEqual(verifyToasts, [{ message: '需求、摄影真实性、机位设计、跨视图和空间覆盖五道验证均已通过，俯视布局已纳入空间合同', type: 'success' }]);
  const certifiedHost = { innerHTML: '' };
  frontend.render({ host: certifiedHost, state: { taskId: 'task-certified', sceneAssets: [certifiedExisting] } });
  assert(certifiedHost.innerHTML.includes('完整空间已锁定'));
  assert(!certifiedHost.innerHTML.includes('需要完整升级'));
  assert(!certifiedHost.innerHTML.includes('data-nsa-scene-upgrade='));
  assert(certifiedHost.innerHTML.includes('<details class="dh-nsa-camera-acceptance">'));
  assert(!certifiedHost.innerHTML.includes('<details class="dh-nsa-camera-acceptance" open>'));
  const cameraLegacyHost = { innerHTML: '' };
  frontend.render({ host: cameraLegacyHost, state: { taskId: 'task-camera-legacy', sceneAssets: [cameraLegacy] } });
  assert(cameraLegacyHost.innerHTML.includes('待逐机位设计复核'));
  assert(cameraLegacyHost.innerHTML.includes('待补证据'));
  assert(cameraLegacyHost.innerHTML.includes('待映射'));
  assert(cameraLegacyHost.innerHTML.includes('再次验证（不重新生成）'));
  const selectedClasses = new Set();
  const topologySelect = {
    value: 'hidden',
    dataset: {},
    matches: selector => selector.includes('select[data-nsa-scene-spec]'),
    classList: {
      toggle(name, enabled) {
        if (enabled) selectedClasses.add(name);
        else selectedClasses.delete(name);
      },
    },
  };
  frontend.syncSpecSelectionState(topologySelect);
  assert(selectedClasses.has('is-explicit-selection'));
  assert.equal(topologySelect.dataset.nsaSelectionState, 'explicit');
  topologySelect.value = 'auto';
  frontend.syncSpecSelectionState(topologySelect);
  assert(!selectedClasses.has('is-explicit-selection'));
  assert.equal(topologySelect.dataset.nsaSelectionState, 'auto');
  const storyboardClasses = new Set();
  const storyboardButton = {
    disabled: false,
    classList: {
      toggle(name, enabled) {
        if (enabled) storyboardClasses.add(name);
        else storyboardClasses.delete(name);
      },
    },
    setAttribute() {},
    removeAttribute() {},
  };
  loadButtonState().updateLocks({
    state: { taskId: 'restored-task', busy: false, shots: [] },
    getPersonSpec: () => '',
    within: selector => {
      if (selector === '#dhNsaAdText') return { value: '' };
      if (selector === '#dhNsaAdStoryboard') return storyboardButton;
      return null;
    },
  });
  assert.equal(storyboardButton.disabled, false);
  assert(storyboardClasses.has('is-next'));
  assert.equal(frontend.requiresLayoutView({ layoutText: '简单单墙场景' }), true, 'v3 新场景必须固定生成第五张空间布局');
  const progressHost = { innerHTML: '' };
  frontend.render({ host: progressHost, state: { sceneGenerationProgress: { active: true, startedAt: Date.now() } } });
  assert.match(progressHost.innerHTML, /生成任务正在提交：共 5 张/);
  assert.doesNotMatch(progressHost.innerHTML, /\/4 张|\/4</);
  const realProgressHost = { innerHTML: '' };
  frontend.render({
    host: realProgressHost,
    state: {
      sceneGenerationProgress: {
        active: true,
        mode: 'repair',
        stage: 'scene_asset',
        status: 'running',
        target_total: 4,
        succeeded: 1,
        view_states: [
          { key: 'master', label: '主视角', status: 'succeeded' },
          { key: 'reverse', label: '反向/侧向', status: 'running', attempt: 2, max_attempts: 3, retrying: true },
          { key: 'interaction', label: '互动位', status: 'running' },
          { key: 'detail', label: '材质细节', status: 'queued' },
        ],
        started_at: new Date().toISOString(),
      },
    },
  });
  assert.match(realProgressHost.innerHTML, /已完成 1\/4 张/);
  assert.match(realProgressHost.innerHTML, /正在并行修复第 2–3\/4 张：反向\/侧向、互动位/);
  assert.match(realProgressHost.innerHTML, /反向\/侧向 第 2\/3 次尝试/);
  assert.match(realProgressHost.innerHTML, />38%<\/i>\s*<\/span>/);
  assert.doesNotMatch(realProgressHost.innerHTML, /耗时估算/);
  const queuedRepairHost = { innerHTML: '' };
  frontend.render({
    host: queuedRepairHost,
    state: {
      sceneGenerationProgress: {
        active: true,
        mode: 'repair',
        target_total: 2,
        view_keys: ['reverse', 'interaction'],
        view_states: [
          { key: 'reverse', label: '反向/侧向', status: 'queued' },
          { key: 'interaction', label: '互动位', status: 'queued' },
        ],
      },
    },
  });
  assert.match(queuedRepairHost.innerHTML, /准备修复 2 张：反向\/侧向、互动位/);
  const switchingDuringGenerationHost = { innerHTML: '' };
  const parkAsset = { ...fullAsset(), id: 'space_park', scene_id: 'space_park', space_id: 'space_park', name: '城市公园草坪' };
  const homeAsset = { ...fullAsset(), id: 'space_home', scene_id: 'space_home', space_id: 'space_home', name: '现代家庭空间' };
  frontend.render({
    host: switchingDuringGenerationHost,
    state: {
      taskId: 'task-scene-switch',
      sceneConfig: {
        scene_mode: 'multi',
        spaces: [
          { id: 'space_park', name: '城市公园草坪', scene_spec: { layoutText: '公园空间' } },
          { id: 'space_home', name: '现代家庭空间', scene_spec: { layoutText: '家庭空间' } },
        ],
      },
      scenePlanSelectedIndex: 0,
      sceneAssets: [parkAsset, homeAsset],
      sceneGenerationProgress: {
        active: true,
        stage: 'scene_asset',
        status: 'running',
        scene_id: 'space_home',
        target_total: 5,
        succeeded: 1,
        view_states: [{ key: 'master', label: '主视角', status: 'succeeded' }],
        started_at: new Date().toISOString(),
      },
    },
  });
  assert(switchingDuringGenerationHost.innerHTML.includes('data-nsa-scene-plan-select="0"'), '生成时仍必须保留场景切换标签');
  assert(switchingDuringGenerationHost.innerHTML.includes('data-nsa-scene-plan-select="1"'), '生成时不得隐藏其他场景');
  assert.match(switchingDuringGenerationHost.innerHTML, /dh-nsa-scene-tab active[^>]*>\s*<button type="button" data-nsa-scene-plan-select="0"/);
  assert(switchingDuringGenerationHost.innerHTML.includes('/master.png'), '生成其他场景时应继续展示当前选中场景的历史资产');
  assert(switchingDuringGenerationHost.innerHTML.includes('现代家庭空间') && switchingDuringGenerationHost.innerHTML.includes('生成中'), '进度必须绑定生成目标场景，而不是替换整个场景面板');
  const sceneScopedFailure = {
    stage: 'scene_asset',
    status: 'failed',
    scene_id: 'space_home',
    scene_name: '现代家庭空间',
    error_code: 'SCENE_RIGHTS_PREFLIGHT_FAILED',
    support_id: 'support-home-only',
    message: '家庭场景权利预检失败',
  };
  const scopedFailureState = selectedIndex => ({
    taskId: 'task-scene-failure-scope',
    taskStatus: 'failed',
    taskStage: 'scene_asset_failed',
    taskError: sceneScopedFailure.message,
    taskErrorCode: sceneScopedFailure.error_code,
    generationProgress: sceneScopedFailure,
    sceneConfig: {
      scene_mode: 'multi',
      spaces: [
        { id: 'space_park', name: '城市公园草坪', scene_spec: { layoutText: '公园空间' } },
        { id: 'space_home', name: '现代家庭空间', scene_spec: { layoutText: '家庭空间' } },
      ],
    },
    scenePlanSelectedIndex: selectedIndex,
    sceneAssets: [parkAsset, homeAsset],
  });
  const parkFailureHost = { innerHTML: '' };
  frontend.render({ host: parkFailureHost, state: scopedFailureState(0) });
  assert(!parkFailureHost.innerHTML.includes('support-home-only'), '其他场景的失败支持编号不得显示在当前成功场景');
  assert(!parkFailureHost.innerHTML.includes('SCENE_RIGHTS_PREFLIGHT_FAILED'), '其他场景的错误码必须在切换到该场景后才显示');
  const homeFailureHost = { innerHTML: '' };
  frontend.render({ host: homeFailureHost, state: scopedFailureState(1) });
  assert(homeFailureHost.innerHTML.includes('support-home-only'), '切换到失败场景后必须显示该场景支持编号');
  assert(homeFailureHost.innerHTML.includes('SCENE_RIGHTS_PREFLIGHT_FAILED'), '切换到失败场景后必须显示该场景错误码');
  const fullAssessment = frontend.sceneLockAssessment(frontend.normalizeAssets([asset])[0]);
  assert.equal(fullAssessment.complete, true);
  assert.equal(fullAssessment.layoutAvailable, true);
  assert.equal(fullAssessment.spatialScore, 93);
  const legacyAssessment = frontend.sceneLockAssessment(frontend.normalizeAssets([legacy])[0]);
  assert.equal(legacyAssessment.complete, false);
  assert.equal(legacyAssessment.legacy, true);
  assert.equal(legacyAssessment.spatialScore, null, '旧资产空间覆盖应显示待验证，不得伪造分数');
  assert.equal(frontend.selectedSceneUpgradeRequired({ sceneAssets: [legacy] }), true);
  assert.equal(frontend.selectedSceneUpgradeRequired({ sceneAssets: [asset] }), false);
  assert.equal(frontend.resumableUpgradeProgress({
    sceneAssets: [legacy],
    generationProgress: {
      stage: 'scene_asset',
      scene_id: 'legacy-scene',
      status: 'failed',
      succeeded: 3,
    },
  }, 'legacy-scene'), true, '同一旧场景已有成功候选时必须进入检查点续跑');
  assert.equal(frontend.resumableUpgradeProgress({
    sceneAssets: [legacy],
    generationProgress: {
      stage: 'scene_asset',
      scene_id: 'another-scene',
      status: 'failed',
      succeeded: 3,
    },
  }, 'legacy-scene'), false, '其他场景的失败进度不得误触发续跑');
  assert.equal(frontend.resumableUpgradeProgress({
    sceneAssets: [legacy],
    generationProgress: {
      stage: 'scene_asset',
      scene_id: 'legacy-scene',
      status: 'failed',
      succeeded: 0,
    },
  }, 'legacy-scene'), false, '没有成功候选时应重新准备升级设定');
  assert.equal(frontend.sceneLockAssessment(frontend.normalizeAssets([normalizedLegacy])[0]).legacy, true);
  const fullHost = { innerHTML: '' };
  frontend.render({ host: fullHost, state: { taskId: 'task-v3', sceneAssets: [asset] } });
  assert(fullHost.innerHTML.includes('完整空间已锁定'));
  assert(fullHost.innerHTML.includes('需求符合度'));
  assert(fullHost.innerHTML.includes('机位设计'));
  assert(fullHost.innerHTML.includes('机位设计验收'));
  assert(fullHost.innerHTML.includes('逐机位参数、俯视定位、需求映射与可见证据'));
  assert(fullHost.innerHTML.includes('方位 20°'));
  assert(fullHost.innerHTML.includes('空间布局'));
  assert(fullHost.innerHTML.includes('跨视图一致性'));
  assert(fullHost.innerHTML.includes('空间覆盖度'));
  assert(fullHost.innerHTML.includes('俯视布局'));
  const legacyHost = { innerHTML: '' };
  frontend.render({ host: legacyHost, state: { taskId: 'task-legacy', sceneAssets: [legacy] } });
  assert(legacyHost.innerHTML.includes('需要完整升级'));
  assert(legacyHost.innerHTML.includes('旧版图片不能继续复验或局部修复'));
  assert(legacyHost.innerHTML.includes('升级当前空间（2 次图片调用）'));
  assert(legacyHost.innerHTML.includes('data-nsa-scene-upgrade='));
  assert(!legacyHost.innerHTML.includes('data-nsa-scene-verify='));
  assert(!legacyHost.innerHTML.includes('空间覆盖度 100%'));

  const unavailable = fullAsset();
  unavailable.scene_id = 'qa-unavailable-scene';
  unavailable.repair_plan = { action: 'reverify', count: 0, view_keys: [] };
  unavailable.scene_contract = {
    ...unavailable.scene_contract,
    status: 'rejected',
    qa_unavailable: true,
    verification: { state: 'unavailable', message: '视觉审核服务暂时不可用' },
    requirement_qa: {
      pass: false,
      layout_match_score: null,
      material_light_match_score: null,
      interaction_match_score: null,
      surface_topology_match_score: null,
      negative_compliance_score: null,
    },
    photographic_realism_qa: {
      pass: null,
      photographic_realism_score: null,
      physical_material_score: null,
      natural_variation_score: null,
      optical_capture_score: null,
      real_photo_evidence: [],
      synthetic_signals: [],
      mismatch_reasons: [],
    },
    camera_design_qa: {
      pass: null,
      role_definition_score: null,
      requirement_mapping_score: null,
      direction_evidence_score: null,
      parameter_completeness_score: null,
      layout_mapping_score: null,
      mismatch_reasons: [],
    },
    cross_view_qa: {
      pass: false,
      scene_consistency_score: null,
      geometry_consistency_score: null,
      material_consistency_score: null,
    },
    spatial_coverage_qa: {
      pass: false,
      layout_topology_score: null,
      camera_diversity_score: null,
      reverse_coverage_score: null,
      interaction_zone_score: null,
      coverage_status: 'unavailable',
    },
  };
  const unavailableHost = { innerHTML: '' };
  frontend.render({ host: unavailableHost, state: { taskId: 'task-unavailable', sceneAssets: [unavailable] } });
  assert.equal((unavailableHost.innerHTML.match(/<b>待验证<\/b>/g) || []).length, 5, 'unknown QA metrics must render as pending, never zero');
  assert.doesNotMatch(unavailableHost.innerHTML, />0%<\/b>/);
  assert.match(unavailableHost.innerHTML, /场景待验证/);
  assert.match(unavailableHost.innerHTML, /再次验证（不重新生成）/);
  assert.match(unavailableHost.innerHTML, /不会调用图片模型/);
  assert.doesNotMatch(unavailableHost.innerHTML, /data-nsa-scene-repair=/);
  const staleLegacyUnavailable = JSON.parse(JSON.stringify(unavailable));
  staleLegacyUnavailable.scene_contract.compatibility_status = 'legacy_partial';
  staleLegacyUnavailable.scene_contract.spatial_coverage_qa.legacy = true;
  const staleLegacyUnavailableHost = { innerHTML: '' };
  frontend.render({
    host: staleLegacyUnavailableHost,
    state: { taskId: 'task-current-reverify', sceneAssets: [staleLegacyUnavailable] },
  });
  assert.match(
    staleLegacyUnavailableHost.innerHTML,
    /再次验证（不重新生成）/,
    'a complete V7 asset with an authoritative reverify plan must keep the verification action visible even if stale browser QA fields say legacy',
  );
  assert.doesNotMatch(staleLegacyUnavailableHost.innerHTML, /旧资产仅锁定外观/);

  const rejected = fullAsset();
  rejected.scene_id = 'rejected-scene';
  rejected.repair_plan = { action: 'regenerate_failed_views', count: 2, view_keys: ['reverse', 'interaction'] };
  rejected.scene_contract = {
    ...rejected.scene_contract,
    status: 'rejected',
    verification: { state: 'rejected', message: '机位覆盖不足', reasons: ['反向和互动位重复'] },
    requirement_qa: { ...rejected.scene_contract.requirement_qa, pass: true },
    cross_view_qa: { ...rejected.scene_contract.cross_view_qa, pass: true },
    spatial_coverage_qa: {
      pass: false,
      layout_topology_score: 0.94,
      camera_diversity_score: 0.2,
      reverse_coverage_score: 0.1,
      interaction_zone_score: 0.1,
      mismatch_reasons: ['反向和互动位重复'],
    },
  };
  const rejectedHost = { innerHTML: '' };
  frontend.render({ host: rejectedHost, state: { taskId: 'task-rejected', sceneAssets: [rejected] } });
  assert(rejectedHost.innerHTML.includes('自动修复：反向/侧向、互动位（2 张）'));
  assert(rejectedHost.innerHTML.includes('系统只重做：反向/侧向、互动位'));
  assert(!rejectedHost.innerHTML.includes('请修改场景设定后重新生成当前场景'));
  const failedRepairHost = { innerHTML: '' };
  frontend.render({
    host: failedRepairHost,
    state: {
      taskId: 'task-rejected',
      taskStatus: 'failed',
      taskStage: 'scene_asset_failed',
      taskError: 'gpt-image-2 AuditSubmitIllegal; nano-banana-pro prompt: size must be between 0 and 2500',
      sceneConfig: {
        scene_mode: 'single',
        spaces: [{ id: 'rejected-scene', name: rejected.name }],
      },
      generationProgress: {
        stage: 'scene_asset',
        status: 'failed',
        scene_id: 'rejected-scene',
        error_code: 'PROVIDER_5XX_AMBIGUOUS',
        message: 'gpt-image-2 AuditSubmitIllegal; nano-banana-pro prompt: size must be between 0 and 2500',
      },
      sceneAssets: [rejected],
    },
  });
  assert(failedRepairHost.innerHTML.includes('上次修复失败，当前仍显示版本 r1'));
  assert(failedRepairHost.innerHTML.includes('没有创建新版本，旧图已安全保留'));
  const durableFailureHost = { innerHTML: '' };
  frontend.render({
    host: durableFailureHost,
    state: {
      taskId: 'task-scene-failure',
      taskStatus: 'failed',
      taskStage: 'scene_asset_failed',
      taskError: '图像供应商返回 500，俯视布局未生成 [支持编号: support-scene-1]',
      taskErrorCode: 'PROVIDER_5XX_AMBIGUOUS',
      sceneConfig: {
        scene_mode: 'multi',
        spaces: [
          { id: 'space_park', name: '城市公园草坪' },
          { id: 'space_home', name: '现代家庭空间' },
        ],
      },
      scenePlanSelectedIndex: 1,
      sceneAssets: [parkAsset, { ...homeAsset, partial_checkpoint: true, completed_view_keys: ['master'], failed_view_keys: ['layout'], view_images: [{ key: 'master', url: '/home-master.png' }] }],
      generationProgress: {
        stage: 'scene_asset',
        status: 'failed',
        scene_id: 'space_home',
        error_code: 'PROVIDER_5XX_AMBIGUOUS',
        support_id: 'support-scene-1',
        message: '图像供应商返回 500，俯视布局未生成',
        view_states: [
          { key: 'master', label: '主视角', status: 'succeeded' },
          { key: 'layout', label: '俯视布局', status: 'failed', error: 'provider 500' },
        ],
      },
    },
  });
  assert(durableFailureHost.innerHTML.includes('现代家庭空间生成失败'), '失败结果必须作为场景面板持久内容展示');
  assert(durableFailureHost.innerHTML.includes('俯视布局'), '持久失败信息必须指出失败视图');
  assert(durableFailureHost.innerHTML.includes('PROVIDER_5XX_AMBIGUOUS'));
  assert(durableFailureHost.innerHTML.includes('support-scene-1'), '支持编号不能只存在于瞬时弹窗');

  const legacyUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad-legacy-ui.js'), 'utf8');
  assert(legacyUi.includes("target.closest('[data-nsa-scene-repair]')"));
  assert(legacyUi.includes('NewStoryAdSceneAssets?.repair'));
  assert(legacyUi.includes("target.closest('[data-nsa-scene-upgrade]')"));
  assert(legacyUi.includes('upgradeAndRegenerateScene'));
  assert(legacyUi.includes('replaceExisting: true'));
  assert(legacyUi.includes('requireAi: true'));
  assert(legacyUi.includes('resumableUpgradeProgress'));
  assert(legacyUi.includes("saveCurrentTaskProgress({ silent: true, render: false })"));
  assert(legacyUi.includes('沿用上次已保存的空间设定，仅补齐未成功的视图'));
  assert(legacyUi.includes('没有提交任何图片生成'));
  assert(legacyUi.includes('syncSceneUpgradeActions'));
  assert(legacyUi.includes('button.hidden = upgradeRequired'));
  assert(legacyUi.includes('!allowUpgradeAsset && selectedSceneUpgradeRequired()'));
  assert(legacyUi.includes('options.upgradePrepared !== true && selectedSceneUpgradeRequired()'));

  const sceneService = fs.readFileSync(path.join(root, 'src/services/newStoryAd/sceneAssetService.js'), 'utf8');
  const sceneUi = fs.readFileSync(path.join(root, 'public/js/new-story-ad/scene-assets.js'), 'utf8');
  assert(!sceneService.includes('legacyNeedsLayoutHeuristic'));
  assert(!sceneService.includes('legacy_layout_trigger'));

  const css = fs.readFileSync(path.join(root, 'public/css/digital-human-wizard.css'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'public/digital-human.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const adminUi = fs.readFileSync(path.join(root, 'public/js/admin.js'), 'utf8');
  const adminRoute = fs.readFileSync(path.join(root, 'src/routes/admin.js'), 'utf8');
  assert(css.includes('.dh-nsa-scene-lock-metrics'));
  assert(css.includes('repeat(auto-fit, minmax(150px, 1fr))'));
  assert(css.includes('.dh-demo-person-source.dh-nsa-scene-source'));
  assert(css.includes('.dh-nsa-camera-acceptance[open] > summary::after'));
  assert(css.includes('.dh-toast.warning'));
  assert(css.includes('.dh-nsa-scene-view.is-layout'));
  assert(css.includes('.dh-nsa-scene-repair-error'));
  assert(css.includes('.dh-nsa-scene-actions .dh-btn[hidden]'));
  assert(css.includes('[aria-busy="true"] #dhNewStoryAdLegacyMount'));
  assert(html.includes('bootstrap.js?v=20260727-content-lineage-v33'));
  assert(html.includes('digital-human-wizard.css?v=20260727-content-lineage-v33'));
  assert(html.indexOf('bootstrap.js?v=20260727-content-lineage-v33') < html.indexOf('digital-human.js?v=20260721-unified-dialog-v20'));
  assert(html.includes('data-nsa-lazy-loader="true"'));
  assert(html.includes('data-nsa-template-ready'));
  assert(html.includes('data-nsa-story-loading="1"'));
  const bootstrap = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8');
  const generationFlow = fs.readFileSync(path.join(root, 'public/js/new-story-ad/generation-flow.js'), 'utf8');
  assert(bootstrap.includes('20260727-content-lineage-v33'));
  assert(sceneUi.includes('acknowledge_billing_unknown: true'));
  assert(!sceneUi.includes("error?.code !== 'SCENE_ASSET_BILLING_UNKNOWN'"));
  assert(!sceneUi.includes('检测到上次场景图片计费状态未知'));
  assert(legacyUi.includes('confirmAction: confirmNsaAction'));
  const taskCenterUi = fs.readFileSync(path.join(root, 'public/js/digital-human.js'), 'utf8');
  const continueHandler = taskCenterUi.slice(
    taskCenterUi.indexOf("const newStoryAdContinue = closest('[data-new-story-ad-continue]')"),
    taskCenterUi.indexOf("const luxProjectDelete = closest('[data-lux-project-delete]')"),
  );
  assert(continueHandler.includes("newStoryAdContinue.textContent = '正在打开…'"));
  assert(!continueHandler.includes('loadNewStoryAdTaskDetail'));
  const buttonState = fs.readFileSync(path.join(root, 'public/js/new-story-ad/button-state.js'), 'utf8');
  assert(buttonState.includes("storyboardBtn.classList.toggle('is-next', !storyboardBtn.disabled && !state.busy)"));
  assert(legacyUi.includes("NewStoryAdSceneAssets?.syncSpecSelectionState?.(target)"));
  assert(css.includes('.dh-nsa-scene-spec-grid select.dh-input.is-explicit-selection'));
  assert(css.includes('color-scheme: dark'));
  assert(css.includes('.dh-nsa-custom-select-option.is-selected'));
  assert(css.includes('.dh-nsa-custom-select.opens-up .dh-nsa-custom-select-menu'));
  assert(css.includes('.dh-luxgen-story.has-open-scene-select'));
  assert(sceneUi.includes('select.dh-input:not(.dh-luxgen-hidden-control):not([aria-hidden="true"])'));
  assert(sceneUi.includes("String(control.id || '').startsWith('dhNsa')"));
  assert(sceneUi.includes('new MutationObserver'));
  assert(sceneUi.includes("new-story-ad:restore-finished"));
  assert(sceneUi.includes('positionSpecSelectMenu(control)'));
  assert(legacyUi.includes('Dynamic script/storyboard/modal selects are created'));
  assert(html.includes('id="dhNsaAdProductionMode"'));
  assert(sceneUi.includes("control.dispatchEvent(new Event('change', { bubbles: true }))"));
  assert(sceneUi.includes('if (control.value === nativeOption.value)'));
  assert(generationFlow.includes('ctx.renderAll?.()'));
  assert(adminHtml.includes('20260719-story-ad-image2-only'));
  assert(adminUi.includes('_pmsCache.available_by_stage[stageId]'));
  assert(adminUi.includes('_pmsCache.available_by_stage[window._stageEditId]'));
  assert(adminRoute.includes('available_by_stage: availableByStage'));

  console.log(JSON.stringify({
    complete_space_lock: true,
    legacy_upgrade_required: true,
    commercial_views_exclude_layout: true,
    layout_contract_reaches_keyframe_lock: true,
    split_metrics_ui: true,
    rejected_scene_has_targeted_repair: true,
    real_scene_view_progress: true,
    model_management_image2_only: true,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
