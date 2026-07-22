const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sceneBinding = require('../src/services/newStoryAd/sceneBindingService');
const sceneAssetService = require('../src/services/newStoryAd/sceneAssetService');

function fullAsset() {
  return {
    scene_id: 'scene-v3',
    name: '完整空间场景',
    generation_contract_version: 6,
    view_images: [
      { key: 'master', url: '/master.png' },
      { key: 'reverse', url: '/reverse.png' },
      { key: 'interaction', url: '/interaction.png' },
      { key: 'detail', url: '/detail.png' },
      { key: 'layout', label: '俯视布局', url: '/layout.png' },
    ],
    scene_contract: {
      schema_version: 3,
      status: 'verified',
      requirement_qa: {
        pass: true,
        layout_match_score: 0.96,
        material_light_match_score: 0.95,
        interaction_match_score: 0.94,
        surface_topology_match_score: 0.97,
        negative_compliance_score: 0.98,
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
      cameras: [{ id: 'camera_master', view_id: 'master' }],
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

function main() {
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
  const lock = sceneBinding.sceneContractForShot({ scene_assets: [asset] }, boundLayoutRequest);
  assert.equal(lock.view_images.length, 4);
  assert.equal(lock.layout_reference.url, '/layout.png');
  assert.equal(lock.layout_reference.role, 'auxiliary_spatial_lock');
  assert.equal(lock.spatial_contract.schema_version, 3);
  assert.equal(lock.spatial_contract.spatial_coverage_qa.pass, true);
  assert.equal(lock.space_lock_status, 'complete');

  const certifiedExisting = fullAsset();
  certifiedExisting.scene_id = 'certified-existing-scene';
  delete certifiedExisting.generation_contract_version;
  certifiedExisting.scene_contract = {
    ...certifiedExisting.scene_contract,
    schema_version: 4,
    source_schema_version: 4,
    compatibility_status: 'current',
    full_space_lock: true,
    space_lock_status: 'complete',
  };
  assert.equal(sceneBinding.completeSceneViewEvidence(certifiedExisting), true);
  assert.equal(sceneBinding.completeSpaceLock(certifiedExisting), true, '完整五视图和三项 QA 可以证明空间锁，不应因缺少生成来源字段误判');
  assert.equal(sceneAssetService.sceneGenerationUpgradeRequired(certifiedExisting), false);
  assert.equal(sceneAssetService.buildSceneRepairPlan(certifiedExisting).action, 'none');

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
  const certifiedAssessment = frontend.sceneLockAssessment(certifiedExisting);
  assert.equal(certifiedAssessment.complete, true);
  assert.equal(certifiedAssessment.upgradeRequired, false);
  assert.equal(certifiedAssessment.evidenceComplete, true);
  const certifiedHost = { innerHTML: '' };
  frontend.render({ host: certifiedHost, state: { taskId: 'task-certified', sceneAssets: [certifiedExisting] } });
  assert(certifiedHost.innerHTML.includes('完整空间已锁定'));
  assert(!certifiedHost.innerHTML.includes('需要完整升级'));
  assert(!certifiedHost.innerHTML.includes('data-nsa-scene-upgrade='));
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
  assert(fullHost.innerHTML.includes('跨视图一致性'));
  assert(fullHost.innerHTML.includes('空间覆盖度'));
  assert(fullHost.innerHTML.includes('俯视布局'));
  const legacyHost = { innerHTML: '' };
  frontend.render({ host: legacyHost, state: { taskId: 'task-legacy', sceneAssets: [legacy] } });
  assert(legacyHost.innerHTML.includes('需要完整升级'));
  assert(legacyHost.innerHTML.includes('旧版图片不能继续复验或局部修复'));
  assert(legacyHost.innerHTML.includes('重新补齐并重建当前场景（5 张）'));
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
  assert.equal((unavailableHost.innerHTML.match(/<b>待验证<\/b>/g) || []).length, 3, 'unknown QA metrics must render as pending, never zero');
  assert.doesNotMatch(unavailableHost.innerHTML, />0%<\/b>/);
  assert.match(unavailableHost.innerHTML, /场景待验证/);
  assert.match(unavailableHost.innerHTML, /再次验证（不重新生成）/);
  assert.match(unavailableHost.innerHTML, /不会调用图片模型/);
  assert.doesNotMatch(unavailableHost.innerHTML, /data-nsa-scene-repair=/);

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
      sceneAssets: [rejected],
    },
  });
  assert(failedRepairHost.innerHTML.includes('上次修复失败，当前仍显示版本 r1'));
  assert(failedRepairHost.innerHTML.includes('没有创建新版本，旧图已安全保留'));

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
  assert(css.includes('.dh-nsa-scene-view.is-layout'));
  assert(css.includes('.dh-nsa-scene-repair-error'));
  assert(css.includes('.dh-nsa-scene-actions .dh-btn[hidden]'));
  assert(css.includes('[aria-busy="true"] #dhNewStoryAdLegacyMount'));
  assert(html.includes('bootstrap.js?v=20260722-boundary-closure-v1'));
  assert(html.includes('digital-human-wizard.css?v=20260722-boundary-closure-v1'));
  assert(html.indexOf('bootstrap.js?v=20260722-boundary-closure-v1') < html.indexOf('digital-human.js?v=20260721-unified-dialog-v20'));
  assert(html.includes('data-nsa-lazy-loader="true"'));
  assert(html.includes('data-nsa-template-ready'));
  assert(html.includes('data-nsa-story-loading="1"'));
  const bootstrap = fs.readFileSync(path.join(root, 'public/js/new-story-ad/bootstrap.js'), 'utf8');
  const generationFlow = fs.readFileSync(path.join(root, 'public/js/new-story-ad/generation-flow.js'), 'utf8');
  assert(bootstrap.includes('20260722-boundary-closure-v1'));
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

main();
