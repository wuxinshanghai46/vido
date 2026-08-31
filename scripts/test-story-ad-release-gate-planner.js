'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const planner = require('./lib/storyAdReleaseGatePlanner');
const recovery = require('./lib/immutableDeployRecovery');
const releaseGateRunner = fs.readFileSync(path.join(__dirname, 'run-story-ad-release-gates.js'), 'utf8');
assert.match(releaseGateRunner, /os\.hostname\(\)[\s\S]*LAPTOP-LDFOL0GT[\s\S]*targetedHome/u,
  '发布门禁执行器必须在家庭电脑自动启用定向门禁，不能依赖调用者手工传参');

function plan(files, options = {}) {
  return planner.createPlan({
    root: process.cwd(),
    baseRevision: 'a'.repeat(40),
    targetRevision: 'b'.repeat(40),
    sourceTree: options.sourceTree || 'c'.repeat(40),
    files,
    reliable: options.reliable,
    fullPlatform: options.fullPlatform,
  });
}

assert.equal(plan(['public/story-ad/views/briefView.js']).profile, 'ui');
assert.deepEqual(plan(['public/story-ad/views/briefView.js']).gates.map(row => row.id), ['workspace_ui', 'release_core']);
const workspaceUiGate = plan(['public/story-ad/views/briefView.js']).gates.find(row => row.id === 'workspace_ui');
assert.match(workspaceUiGate.command, /test-story-ad-scene-qa-actions-v238\.js/);
assert.match(workspaceUiGate.command, /test-story-ad-scene-submit-feedback-v273\.js/);
assert.match(workspaceUiGate.command, /test-story-ad-page-load-lifecycle-v253\.js/);
assert.deepEqual(plan([
  'scripts/test-story-ad-generation-one-click-v237.js',
  'scripts/test-story-ad-scene-submit-feedback-v273.js',
  'scripts/test-story-ad-page-load-lifecycle-v253.js',
  'scripts/test-story-ad-prompt-autosave-navigation-v232.js',
]).gates.map(row => row.id), ['workspace_ui', 'release_core'], '场景页交互与加载生命周期测试必须保持在家庭电脑 UI 影响域');
assert.match(workspaceUiGate.command, /test-story-ad-scene-qa-layout-v252\.js/);
assert.equal(plan(['scripts/test-story-ad-scene-card-v66.js']).profile, 'ui');
assert.equal(plan(['scripts/test-story-ad-historical-asset-actions-v61.js']).profile, 'ui');
assert.deepEqual(plan(['scripts/test-story-ad-historical-asset-actions-v61.js']).gates.map(row => row.id), ['workspace_ui', 'release_core']);
assert.equal(plan(['src/services/storyAdWorkspace/authoritativeReferenceProjectionService.js']).profile, 'reference');
assert(plan(['src/services/storyAdWorkspace/authoritativeReferenceProjectionService.js']).gates.some(row => row.id === 'reference'));
assert.equal(plan(['src/services/newStoryAd/assetPlanService.js']).profile, 'asset_plan');
assert.equal(plan(['src/routes/assets.js', 'scripts/test-story-ad-character-library-v183.js']).profile, 'ui');
assert.deepEqual(
  planner.createPlan({
    root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    files: ['src/routes/assets.js', 'scripts/test-story-ad-character-library-v183.js'], reliable: true, targetedHome: true,
  }).gates.map(row => row.id),
  ['workspace_ui', 'release_core'],
  '家庭电脑的角色库只读投影和交互测试必须走工作台 UI 定向门禁，不得误触资产方案生成或完整回归',
);
assert.deepEqual(
  planner.createPlan({
    root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40), reliable: true, targetedHome: true,
    files: [
      'src/services/newStoryAd/sceneDomainContractService.js',
      'src/services/newStoryAd/storyboardSubjectQaService.js',
      'src/services/storyAdWorkspace/storyboardSketchService.js',
      'src/services/storyAdWorkspace/storyboardImageConfirmationGateService.js',
      'src/services/storyAdWorkspace/storyboardPromptOverrideService.js',
      'src/services/storyAdWorkspace/storyboardPromptAssistService.js',
      'src/services/storyAdWorkspace/storyboardSketchTargetService.js',
      'src/services/storyAdWorkspace/storyboardAsyncLaunchService.js',
      'scripts/test-story-ad-universal-scene-domain-v311.js',
      'scripts/test-story-ad-storyboard-prompt-assist-v313.js',
      'scripts/test-story-ad-narrative-scene-sequence-v314.js',
      'public/story-ad/views/storyboardView.js',
      'public/story-ad/views/storyboardPromptEditorDialog.js',
    ],
  }).gates.map(row => row.id),
  ['story_content', 'workspace_ui', 'release_core'],
  '家庭电脑的全行业分镜合同、人数质检与提示词编辑只能触发本任务影响域门禁',
);
assert.equal(plan(['src/services/newStoryAd/referenceVideoUploadService.js']).profile, 'upload_media');
const sceneRecoveryPlan = planner.createPlan({
  root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
  files: [
    'src/services/newStoryAd/sceneCheckpointProjectionService.js',
    'src/services/newStoryAd/sceneAssetFixService.js',
    'src/services/newStoryAd/sceneSpaceContractService.js',
    'src/services/newStoryAd/taskViewService.js',
    'src/services/storyAdWorkspace/sceneAssetRuntimeProjectionService.js',
    'src/services/storyAdWorkspace/sceneQaProjectionService.js',
    'scripts/inspect-prod-story-ad-scene-recovery.js',
    'scripts/test-story-ad-scene-qa-actions-v238.js',
    'scripts/test-story-ad-scene-recovery-v239.js',
    'scripts/test-visual-asset-recovery-v50.js',
  ],
  reliable: true, targetedHome: true,
});
assert.equal(sceneRecoveryPlan.unknown_files.length, 0, '场景修复、QA证据和诊断投影必须归入定向门禁，不能误触家庭电脑完整回归');
assert.deepEqual(sceneRecoveryPlan.gates.map(row => row.id), ['upload_media', 'workspace_ui', 'release_core']);
assert.equal(plan(['src/services/newStoryAd/blueprintQualityService.js']).profile, 'story_content');
assert.equal(plan(['scripts/migrate-story-ad-public-media-models-v262.js']).profile, 'systemic');
assert.equal(plan(['scripts/test-story-ad-public-image-model-catalog-v261.js']).profile, 'systemic');
assert.deepEqual(plan(['src/services/newStoryAd/blueprintQualityService.js']).gates.map(row => row.id), ['story_content', 'workspace_ui', 'release_core']);
assert.equal(plan(['src/services/newStoryAd/storyboardTableService.js', 'src/services/newStoryAd/referenceDetachService.js']).profile, 'reference_story_content');
assert.deepEqual(
  plan(['src/services/newStoryAd/storyboardTableService.js', 'src/services/newStoryAd/referenceDetachService.js']).gates.map(row => row.id),
  ['reference', 'story_content', 'workspace_ui', 'release_core'],
);
assert.equal(plan(['src/services/newStoryAd/blueprintService.js', 'src/services/newStoryAd/assetPlanService.js']).profile, 'story_content_asset_plan');
assert.deepEqual(
  plan(['src/services/newStoryAd/blueprintService.js', 'src/services/newStoryAd/assetPlanService.js']).gates.map(row => row.id),
  ['story_content', 'asset_plan', 'workspace_ui', 'release_core'],
);
assert.equal(plan(['src/services/storyAdWorkspace/briefProjectionService.js']).profile, 'ui');
assert.equal(plan(['src/services/newStoryAd/briefDialogueHistoryService.js', 'scripts/test-story-ad-dialogue-cast-blueprint-v151.js']).profile, 'ui');
assert.equal(plan(['src/services/newStoryAd/contextBuilder.js']).profile, 'asset_plan');
const personPromptPlan = planner.createPlan({
  root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
  files: [
    'src/services/newStoryAd/assistSubjectProfileService.js',
    'src/services/newStoryAd/assistedPersonSpecService.js',
    'src/services/newStoryAd/independentPersonPlanService.js',
    'src/services/newStoryAd/personIdentityContractService.js',
    'src/services/newStoryAd/subjectProfileTextService.js',
    'src/services/storyAdWorkspace/personLookProjectionService.js',
    'scripts/test-story-ad-person-prompt-separation-v226.js',
    'src/services/newStoryAd/blueprintCharacterProjectionService.js',
  ],
  reliable: true, targetedHome: true,
});
assert.equal(personPromptPlan.profile, 'story_content_asset_plan');
assert.deepEqual(personPromptPlan.gates.map(row => row.id), ['story_content', 'asset_plan', 'workspace_ui', 'release_core'],
  '人物外貌/表演分离属于内容、人物资产方案和工作台定向门禁，不得回退全平台或跨版本回归');
assert.equal(plan(['AGENTS.md']).profile, 'ui');
assert.equal(plan(['src/services/newStoryAd/storageService.js']).profile, 'systemic');
assert.equal(plan(['src/services/voicePackEnrollmentService.js']).profile, 'systemic');
assert.equal(plan(['src/routes/workbench.js']).profile, 'systemic');
assert.equal(plan(['public/js/digital-human.js']).profile, 'ui');
assert.deepEqual(
  planner.createPlan({
    root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    files: ['src/services/voicePackEnrollmentService.js', 'src/routes/workbench.js', 'public/js/digital-human.js'],
    reliable: true, targetedHome: true,
  }).gates.map(row => row.id),
  ['systemic', 'workspace_ui', 'release_core'],
  '按账号自动注册音色必须执行系统性、UI 与发布门禁，但家庭电脑不得触发跨版本完整回归',
);
assert.equal(plan(['src/services/newStoryAd/unclassifiedAuthority.js']).profile, 'systemic');
const scenePromptConfirmationPlan = planner.createPlan({
  root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
  files: [
    'src/routes/newStoryAd.js',
    'src/services/newStoryAd/scenePromptConfirmationService.js',
    'src/services/newStoryAd/sceneAssetService.js',
    'src/services/newStoryAd/scenePanoramaService.js',
    'src/services/storyAdWorkspace/projectBundleService.js',
    'scripts/helpers/current-scene-prompt-fixture.js',
    'scripts/test-story-ad-scene-prompt-confirmation-v231.js',
    'scripts/test-story-ad-scene-config-release-rebase-v130.js',
    'scripts/test-new-story-ad-panorama.js',
  ],
  reliable: true, targetedHome: true,
});
assert.deepEqual(scenePromptConfirmationPlan.unknown_files, [],
  '场景提示词确认、图片、修复、全景与队列测试必须全部归入明确影响域');
assert.deepEqual(scenePromptConfirmationPlan.gates.map(row => row.id),
  ['systemic', 'asset_plan', 'upload_media', 'workspace_ui', 'release_core'],
  '家庭电脑必须只执行场景确认直接涉及的系统安全、资产方案、媒体、工作台和发布核心门禁');
assert.equal(
  plan(['scripts/test-new-story-ad-visual-asset-failure-recovery.js']).profile,
  'upload_media',
  'the visual asset failure recovery test belongs to the upload/media gate instead of unknown full scope',
);
assert.equal(
  plan(['scripts/test-story-ad-storyboard-prompt-editor-ui-v314.js']).profile,
  'ui',
  '分镜提示词编辑器回归属于工作台 UI，不得触发剧情生成门禁',
);
assert.equal(plan(['src/services/storyAdWorkspace/storyboardPromptAssistService.js']).profile, 'ui',
  '只返回用户草稿的分镜提示词助手属于工作台编辑器，不得触发媒体或完整剧情生成门禁');
assert.equal(plan(['scripts/test-story-ad-storyboard-prompt-assist-v313.js']).profile, 'ui');
assert(plan(['src/services/newStoryAd/unclassifiedAuthority.js']).gates.some(row => row.id === 'systemic'),
  '新剧情广告运行文件必须执行systemic结构与权威门禁');
assert.equal(plan(['src/shared/unclassifiedAuthority.js']).profile, 'full');
assert.equal(plan(['scripts/deploy-story-ad-immutable-release.js']).profile, 'ui');
assert.equal(plan(['docs/notes.md'], { reliable: false }).profile, 'full');
assert.deepEqual(plan(['scripts/deploy-story-ad-immutable-release.js'], { fullPlatform: true }).gates.map(row => row.id), ['workspace_ui', 'release_core']);
assert.deepEqual(
  planner.createPlan({
    root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    files: ['src/services/newStoryAd/modelGateway.js'], reliable: true, targetedHome: true,
  }).gates.map(row => row.id),
  ['systemic', 'workspace_ui', 'release_core'],
  '家庭电脑的系统性相关门禁不得隐式触发跨版本完整回归',
);
assert.deepEqual(
  planner.createPlan({
    root: process.cwd(), baseRevision: 'a'.repeat(40), targetRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40),
    files: [
      'src/services/newStoryAd/blueprintService.js',
      'src/services/newStoryAd/personGenerationPromptService.js',
      'src/services/newStoryAd/personGenerationRuntimeContractService.js',
      'src/services/newStoryAd/personDossierCompiler.js',
      'src/services/newStoryAd/mediaAdapter.js',
      'src/services/storyAdWorkspace/projectBundleService.js',
      'public/story-ad/views/assetCenterPersonForm.js',
      'scripts/test-story-ad-person-prompt-v228.js',
    ], reliable: true, targetedHome: true,
  }).gates.map(row => row.id),
  ['story_content', 'asset_plan', 'upload_media', 'workspace_ui', 'release_core'],
  '家庭电脑必须按本次人物提示词影响域执行定向门禁，不能因为新文件退化为跨模块 systemic 门禁',
);
assert.equal(planner.resolveArtifactRevision(process.cwd(), 'not-an-artifact', 'not-a-revision'), '');
assert.equal(planner.releaseConfigChangeKind(
  { build_id: 'v1', contract_version: 7, node_runtime: { version: 'v22' } },
  { build_id: 'v2', contract_version: 7, node_runtime: { version: 'v22' } },
), 'build_id_only');
assert.equal(planner.releaseConfigChangeKind(
  { build_id: 'v1', contract_version: 7 },
  { build_id: 'v2', contract_version: 8 },
), 'runtime_contract');
assert.deepEqual(planner.gateIdsForProfile('release_metadata'), ['release_core']);
assert.equal(planner.scopedDomainFromPatch('src/routes/newStoryAd.js', [
  '@@ -809 +809 @@ router.post(\'/reference-video-analyses/:analysisId/start\'',
  '+  extendedAnalysisConfirmed: true,',
].join('\n')), 'reference');
assert.equal(planner.scopedDomainFromPatch('src/services/pipelineModelService.js', [
  '@@ -72,0 +73 @@',
  '+  { id: \'new_story_ad.reference_video_transcript\' },',
].join('\n')), 'reference');
assert.equal(planner.scopedDomainFromPatch('src/services/storyAdWorkspace/projectBundleService.js', [
  '@@ -17,0 +18 @@',
  "+const sceneDomainContract = require('../newStoryAd/sceneDomainContractService');",
  '@@ -557,0 +558 @@',
  '+bundle.storyboard.prompt_defaults = [];',
].join('\n')), 'story_content');
assert.equal(planner.scopedDomainFromPatch('scripts/test-story-ad-multiscene-reference-lineage-v293.js', [
  '@@ -255,0 +256 @@',
  '+const subjectQaService = { assert: async () => ({ pass: true }) };',
  '@@ -275,0 +280 @@',
  "+const customPrompt = 'only one actor';",
  "+assert.deepEqual(promptStale.stale_reasons[5], ['STORYBOARD_PROMPT_CHANGED']);",
].join('\n')), 'story_content');
assert.equal(planner.scopedDomainFromPatch('src/routes/newStoryAd.js', [
  '@@ -10 +10 @@ router.post(\'/tasks\'',
  '+  unrelatedMutation();',
].join('\n')), '');
assert.equal(planner.generatedReleaseOnlyChange('public/story-ad/app.js', [
  '@@ import',
  "-import x from './x.js?v=20260822-old';",
  "+import x from './x.js?v=20260822-new';",
].join('\n')), true);
assert.equal(planner.generatedReleaseOnlyChange('public/story-ad/app.js', [
  '@@ behavior',
  '-const enabled = false;',
  '+const enabled = true;',
].join('\n')), false);
const targetedReferencePlan = planner.createPlan({
  root: process.cwd(),
  baseRevision: 'a'.repeat(40),
  targetRevision: 'b'.repeat(40),
  sourceTree: 'f'.repeat(40),
  files: [
    'scripts/lib/storyAdReleaseGatePlanner.js',
    'scripts/deploy-story-ad-immutable-release.js',
    'scripts/test-story-ad-release-gate-planner.js',
    'config/story-ad-runtime-manifest.json',
    'public/story-ad/release-manifest.json',
    'public/story-ad/app.js',
    'scripts/test-story-ad-workspace-v6-ui-regressions.js',
    'scripts/test-story-ad-historical-asset-actions-v61.js',
    'src/routes/newStoryAd.js',
    'src/services/pipelineModelService.js',
    'src/services/newStoryAd/referenceVideoAnalysisService.js',
  ],
  patches: {
    'src/routes/newStoryAd.js': '@@ route reference-video-analyses\n+ extendedAnalysisConfirmed',
    'src/services/pipelineModelService.js': '@@ schema\n+ new_story_ad.reference_video_transcript',
    'public/story-ad/app.js': '@@ import\n-import x from \'./x.js?v=20260822-old\';\n+import x from \'./x.js?v=20260822-new\';',
  },
  targetedHome: true,
});
assert.equal(targetedReferencePlan.profile, 'upload_media');
assert.deepEqual(targetedReferencePlan.gates.map(row => row.id), ['upload_media', 'reference', 'workspace_ui', 'release_core']);
assert.deepEqual(targetedReferencePlan.targeted_planner_files.sort(), [
  'scripts/deploy-story-ad-immutable-release.js',
  'scripts/lib/storyAdReleaseGatePlanner.js',
  'scripts/test-story-ad-release-gate-planner.js',
]);

const expectedRelease = {
  release_bundle_id: 'bundle-v1', artifact_id: 'artifact-v1', source_revision: 'source-v1', source_tree: 'tree-v1', build_id: 'build-v1',
};
const healthyRecovery = {
  version: {
    build_id: 'build-v1', release_bundle_id: 'bundle-v1', runtime_hash: 'runtime-v1', process_id: 7,
    release_control: { allowed: true },
    release_bundle: { artifact_id: 'artifact-v1', source_revision: 'source-v1', source_tree: 'tree-v1', remote_sync_verified: true },
  },
  public_version: { release_bundle_id: 'bundle-v1' },
  health: { status: 'ok' }, public_health: { status: 'ok' }, sqlite_quick_check: 'ok',
  readiness: { active_count: 0, active_unknown_billing_count: 0 }, release_dir: '/opt/vido/releases/artifact-v1',
};
assert.equal(recovery.confirmRecoveredRelease(healthyRecovery, expectedRelease).recovered_receipt, true);
assert.throws(() => recovery.confirmRecoveredRelease({
  ...healthyRecovery, readiness: { active_count: 1, active_unknown_billing_count: 0 },
}, expectedRelease), error => error.code === 'ALREADY_ACTIVE_RECOVERY_FAILED' && error.issues.includes('active_tasks_exist'));
assert.throws(() => recovery.confirmRecoveredRelease({
  ...healthyRecovery, public_health: { status: 'failed' },
}, expectedRelease), error => error.issues.includes('public_health_failed'));
assert.equal(recovery.isExpectedActiveRelease({ ...healthyRecovery.version, build_id: 'other' }, expectedRelease), false);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vido-release-gate-cache-'));
let executions = 0;
const fakeExecute = async () => { executions += 1; return { duration_ms: 7 }; };

(async () => {
  try {
    const firstPlan = plan(['public/story-ad/views/briefView.js']);
    const first = await planner.runPlan(tempRoot, firstPlan, { executeGate: fakeExecute });
    assert.equal(first.cached_count, 0);
    assert.equal(executions, 2);
    const repeated = await planner.runPlan(tempRoot, firstPlan, { executeGate: fakeExecute });
    assert.equal(repeated.cached_count, 2);
    assert.equal(executions, 2, '同一源码树与同一门禁不得重复执行');
    const changedTree = plan(['public/story-ad/views/briefView.js'], { sourceTree: 'd'.repeat(40) });
    const changed = await planner.runPlan(tempRoot, changedTree, { executeGate: fakeExecute });
    assert.equal(changed.cached_count, 0);
    assert.equal(executions, 4, '源码树变化后缓存必须失效');
    const failedTree = plan(['public/story-ad/views/briefView.js'], { sourceTree: 'e'.repeat(40) });
    await assert.rejects(() => planner.runPlan(tempRoot, failedTree, {
      executeGate: async () => { throw new Error('synthetic-gate-failure'); },
    }), /synthetic-gate-failure/);
    const recoveredAfterFailure = await planner.runPlan(tempRoot, failedTree, { executeGate: fakeExecute });
    assert.equal(recoveredAfterFailure.cached_count, 0, '失败门禁不得写入成功缓存');
    assert.equal(executions, 6);
    console.log(JSON.stringify({
      passed: true,
      profiles: 7,
      story_ad_unclassified_is_impact_scoped: true,
      shared_unknown_falls_back_full: true,
      exact_tree_cache: true,
      changed_tree_invalidates: true,
      failed_gate_not_cached: true,
      non_home_full_platform_only_for_shared_or_unreliable_changes: true,
      recovered_receipt_requires_health_and_idle_state: true,
    }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
