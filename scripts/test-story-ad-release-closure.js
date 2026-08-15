'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  RUNTIME_DIRECTORIES,
  collectStoryAdReleaseFiles,
  dependencyClosure,
  isRuntimeReleaseFile,
  packageTestFiles,
} = require('./lib/storyAdReleaseFiles');

const root = path.resolve(__dirname, '..');
const manifest = require('../public/story-ad/release-manifest.json');
const runtimeManifest = require('../config/story-ad-runtime-manifest.json');

function walk(directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(absolute, entry.name);
    return entry.isDirectory()
      ? walk(path.relative(root, target))
      : [path.relative(root, target).replace(/\\/g, '/')];
  });
}

function main() {
  const files = collectStoryAdReleaseFiles({ root, releaseManifest: manifest });
  const selected = new Set(files);
  const runtimeSelected = new Set((runtimeManifest.files || []).map(item => item.path));
  assert(files.length > 100, `剧情广告发布集合异常偏小：${files.length}`);
  assert(selected.has('scripts/migrate-new-story-ad-systemic-state.js'), '发布闭包必须包含切流时调用的系统迁移入口');
  assert(selected.has('.gitattributes'), '服务器发布回归依赖的换行契约必须进入发布闭包');
  assert(selected.has('scripts/audit-new-story-ad-systemic-state.js'), '发布闭包必须包含迁移后审计入口');
  assert(selected.has('scripts/test-story-ad-workspace-v6-ui-regressions.js'), '发布闭包必须包含候选 UI 定向回归');
  assert(selected.has('scripts/test-story-ad-platform-narrative-release-v111.js'), '发布闭包必须包含候选剧情定向回归');
  assert(selected.has('scripts/migrate-story-ad-person-demographics-v63.js'), '发布闭包必须包含历史人物人口属性零模型迁移入口');
  assert(selected.has('scripts/test-story-ad-history-edit-entry-final-dom-v63.js'), '发布闭包必须包含历史步骤编辑入口最终 DOM 回归');
  assert(selected.has('scripts/test-story-ad-product-entry-taxonomy-v64.js'), '发布闭包必须包含广告商品入口分类交互回归');
  assert(selected.has('scripts/test-story-ad-visual-checkpoint-plan-stability-v65.js'), '发布闭包必须包含视觉checkpoint与计划指纹稳定性回归');
  assert(selected.has('scripts/test-story-ad-visual-generation-lineage-v65.js'), '发布闭包必须包含视觉生成血缘与计费同步回归');
  assert(selected.has('scripts/test-story-ad-candidate-systemic-readiness-v66.js'), '发布闭包必须包含candidate-only系统门禁防假绿回归');
  assert(selected.has('scripts/test-story-ad-person-asset-interactions-v68.js'), '发布闭包必须包含人物checkpoint图集与灯箱交互回归');
  assert(selected.has('scripts/test-story-ad-recovery-status-hierarchy-v70.js'), '发布闭包必须包含人物恢复状态层级与档案大版回归');
  assert(selected.has('scripts/test-story-ad-recovery-card-visual-v72.js'), '发布闭包必须包含人物恢复专业状态面板回归');
  assert(selected.has('scripts/test-story-ad-recovery-action-computed-style-v73.js'), '发布闭包必须包含恢复动作最终计算样式回归');
  assert(selected.has('scripts/test-story-ad-recovery-metric-layout-v74.js'), '发布闭包必须包含恢复指标真实几何布局回归');
  assert(selected.has('scripts/test-story-ad-billing-recovery-next-step-v75.js'), '发布闭包必须包含计费恢复下一步回归');
  assert(selected.has('scripts/test-story-ad-billing-review-state-machine-v75.js'), '发布闭包必须包含计费核账状态机回归');
  assert(selected.has('scripts/test-story-ad-billing-recovery-atomic-v75.js'), '发布闭包必须包含原子授权与25+4恢复回归');
  assert(selected.has('scripts/test-story-ad-submission-billing-classification-v75.js'), '发布闭包必须包含供应商提交计费分类回归');
  assert(selected.has('scripts/test-story-ad-accessory-slot-contract-v75.js'), '发布闭包必须包含配饰槽位证据回归');
  assert(selected.has('scripts/test-story-ad-asset-url-readiness-v75.js'), '发布闭包必须包含资产URL就绪性回归');
  assert(selected.has('scripts/test-story-ad-billing-recovery-routes-v76.js'), '发布闭包必须包含核账路由权限、方法与顺序回归');
  assert(selected.has('scripts/test-story-ad-asset-center-mount-dependencies-v77.js'), '发布闭包必须包含资产中心mount真实依赖注入回归');
  assert(selected.has('scripts/test-story-ad-desired-unit-reconciliation-v78.js'), '发布闭包必须包含编译器目标单元与历史恢复计划收敛回归');
  assert(selected.has('scripts/test-story-ad-desired-unit-obsolescence-v78.js'), '发布闭包必须包含目标单元废止、原子回滚与25+3恢复行为回归');
  assert(selected.has('scripts/reconcile-story-ad-desired-visual-units-v78.js'), '发布闭包必须包含默认dry-run的目标单元恢复CLI');
  assert(selected.has('public/story-ad/views/assetCenterStageView.js'), '发布闭包必须包含资产阶段按需运行模块');
  assert(selected.has('public/story-ad/views/subjectRecoveryPreflightAction.js'), '发布闭包必须包含人物恢复安全预检点击模块');
  assert(selected.has('src/services/newStoryAd/negativeConstraintContractService.js'), '发布闭包必须包含结构化人物禁止项合同服务');
  assert(selected.has('src/services/newStoryAd/subjectRecoveryPreflightService.js'), '发布闭包必须包含人物缺图安全预检与零模型血缘处理服务');
  assert(selected.has('src/services/newStoryAd/subjectProfileAuthorityProofService.js'), '发布闭包必须包含人物三方权威与派生富化证明服务');
  assert(selected.has('scripts/test-story-ad-single-stage-primary-action-v79.js'), '发布闭包必须包含恢复阶段单主操作回归');
  assert(selected.has('scripts/test-story-ad-recovery-plan-action-final-dom-v79.js'), '发布闭包必须包含恢复与人物方案门禁最终DOM回归');
  assert(selected.has('scripts/test-story-ad-partial-checkpoint-negative-rebase-v79.js'), '发布闭包必须包含25项复用与negative单调放宽回归');
  assert(selected.has('scripts/test-story-ad-negative-constraint-semantics-v81.js'), '发布闭包必须包含禁止项语义等价、放宽与冲突回归');
  assert(selected.has('scripts/test-story-ad-negative-constraint-production-v81.js'), '发布闭包必须包含生产四人物禁止项合同回归');
  assert(selected.has('scripts/test-story-ad-subject-recovery-preflight-v81.js'), '发布闭包必须包含恢复预检并发、原子与零模型回归');
  assert(selected.has('scripts/test-story-ad-three-way-authority-proof-v84.js'), '发布闭包必须包含三方权威、派生富化与拒绝路径回归');
  assert(selected.has('scripts/test-story-ad-three-way-authority-proof-independent-v84.js'), '发布闭包必须包含独立三方权威与未证明字段拒绝回归');
  assert(selected.has('scripts/test-story-ad-three-way-authority-rebase-independent-v84.js'), '发布闭包必须包含独立三方权威原子rebase与25项复用回归');
  assert(selected.has('scripts/resolve-story-ad-visual-billing-review-v75.js'), '发布闭包必须包含默认dry-run核账CLI');
  assert(selected.has('scripts/audit-story-ad-visual-generation-lineage-v65.js'), '发布闭包必须包含生产视觉生成只读审计入口');
  assert(selected.has('scripts/audit-story-ad-checkpoint-billing-correlation-v65.js'), '发布闭包必须包含checkpoint与model_call计费关联只读审计');
  assert(selected.has('scripts/repair-story-ad-visual-generation-lineage-v65.js'), '发布闭包必须包含默认dry-run的视觉血缘安全恢复入口');
  assert(selected.has('scripts/test-story-ad-person-plan-demographics-v63.js'), '发布闭包必须包含人物人口属性标准化回归');
  assert(selected.has('scripts/test-story-ad-person-demographics-migration-v63.js'), '发布闭包必须包含历史人物人口属性迁移回归');
  assert(selected.has('scripts/check-story-ad-workspace-v6-boundaries.js'), '发布闭包必须包含候选边界检查');
  assert(selected.has('src/services/newStoryAd/systemicMigrationService.js'), '发布闭包必须包含系统迁移依赖');
  files.forEach(file => assert(fs.existsSync(path.join(root, file)), `发布文件不存在：${file}`));
  (manifest.files || []).forEach(entry => assert(selected.has(entry.path), `静态发布清单未进入发布集合：${entry.path}`));
  for (const directory of RUNTIME_DIRECTORIES) {
    for (const file of walk(directory).filter(value => /\.(?:js|json)$/i.test(value) && isRuntimeReleaseFile(value))) {
      assert(selected.has(file), `剧情广告运行时模块漏发：${file}`);
    }
  }
  [
    'src/outputs/platform_tasks.json',
    'public/dashboard-clean-demo.htm',
    'public/dashboard-clean-demo.html',
    'public/recovery-backups/example.js',
    'src/routes/recovery-backups/example.js',
    'public/js/new-story-ad-legacy-ui.js',
  ].forEach(file => {
    assert(!selected.has(file), `发布集合不得包含本地数据、演示页或恢复备份：${file}`);
    assert(!runtimeSelected.has(file), `运行时清单不得包含本地数据、演示页或恢复备份：${file}`);
  });
  assert(isRuntimeReleaseFile('src/server.js'), '真实运行模块必须保留');
  assert(isRuntimeReleaseFile('public/story-ad/index.html'), '剧情广告静态入口必须保留');
  assert(!isRuntimeReleaseFile('public/js/new-story-ad-legacy-ui.js'), '已停用旧剧情广告客户端不得进入生产运行闭包');
  assert(!selected.has('public/js/new-story-ad-legacy-ui.js'), '410 旧客户端源码不得被打入不可变制品');
  const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8');
  assert(attributes.includes('*.htm text eol=lf'), 'Windows fresh clone 必须固定 .htm 为 LF，避免运行清单哈希漂移');
  packageTestFiles(root).forEach(file => assert(selected.has(file), `生产回归脚本漏发：${file}`));
  packageTestFiles(root, ['story-ad:systemic:test']).forEach(file => {
    assert(selected.has(file), `系统性整改回归脚本漏发：${file}`);
  });
  files.filter(file => file !== 'config/story-ad-runtime-manifest.json').forEach(file => {
    assert(runtimeSelected.has(file), `运行时哈希清单漏发：${file}`);
  });
  const closed = dependencyClosure(root, files);
  const missingDependencies = [...closed].filter(file => !selected.has(file));
  assert.deepStrictEqual(missingDependencies, [], `本地依赖闭包漏发：${missingDependencies.slice(0, 12).join(', ')}`);
  [
    'public/index.html',
    'public/js/dashboard-workbench.js',
    'src/routes/dashboard.js',
    'src/services/newStoryAd/knowledgePolicyCompilerService.js',
    'src/services/seeds/generation_runtime_policy.js',
    'scripts/test-new-story-ad-knowledge-policy-performance.js',
    'scripts/test-story-ad-release-closure.js',
    'config/workflows-builtin/product-ad-copy.json',
    'src/services/pipelineModelService.js',
    'src/services/newStoryAd/contentSkillService.js',
    'src/services/newStoryAd/briefAuthorityService.js',
    'src/services/newStoryAd/assetPlanCheckpointLineageService.js',
    'src/services/newStoryAd/assetPlanSectionRecoveryContractService.js',
    'scripts/audit-story-ad-model-management.js',
    'scripts/migrate-story-ad-v120-checkpoints.js',
    'scripts/test-story-ad-v120-checkpoint-migration-v121.js',
  ].forEach(file => assert(selected.has(file), `本轮知识运行时文件漏发：${file}`));
  assert.equal(runtimeManifest.schema_version, 3, 'runtime manifest schema must include source identity v3');
  assert.match(String(runtimeManifest.source_revision || ''), /^[a-f0-9]{40}$/, 'runtime manifest source revision is required');
  assert.match(String(runtimeManifest.source_tree || ''), /^[a-f0-9]{40}$/, 'runtime manifest source tree is required');
  assert.equal(runtimeManifest.remote_sync_verified, true, 'runtime manifest must prove source remote sync');
  assert.match(String(runtimeManifest.artifact_id || ''), /^[a-f0-9]{64}$/, 'runtime artifact identity is required');
  assert.match(String(runtimeManifest.source_snapshot_hash || ''), /^[a-f0-9]{64}$/, 'source snapshot identity is required');
  assert.match(String(runtimeManifest.lockfile_sha256 || ''), /^[a-f0-9]{64}$/, 'lockfile identity is required');
  const deploySource = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-release.js'), 'utf8');
  assert(deploySource.includes("require('./lib/storyAdReleaseFiles')"), '部署脚本必须使用统一发布集合');
  assert(deploySource.includes("process.env.ComSpec || 'cmd.exe'"), 'Windows 发布前回归必须通过命令解释器启动 npm，避免 spawnSync npm.cmd EINVAL');
  assert(deploySource.includes('result.error?.stack'), '发布前回归启动失败必须保留底层进程错误');
  assert(!deploySource.includes('const extraFiles = ['), '部署脚本不得保留第二份手工文件清单');
  assert(deploySource.indexOf('runLocalReleaseRegression();') < deploySource.indexOf("client.on('ready'"), '完整回归必须发生在连接生产并发布之前');
  assert(deploySource.includes("mv ${quote(`${stagingDir}/public/story-ad`)}"), '剧情广告静态目录必须整体切换');
  assert(deploySource.indexOf("pm2 reload vido") < deploySource.indexOf("npm run story-ad:knowledge-policy:test"), '发布后必须先 reload 再执行快速生产验收');
  assert(deploySource.includes('productionReleaseAfterReload.runtime_hash !== localRuntimeHash'), '发布后必须核对进程运行时哈希');
  assert(deploySource.includes('VIDO_DEPLOY_UPLOAD_CONCURRENCY'), '多文件发布必须使用有上限的并发上传，避免串行上传耗尽部署时限');
  assert(deploySource.includes('uploadedFiles !== files.length'), '发布前必须核对暂存上传文件总数');
  const immutableDeploySource = fs.readFileSync(path.join(root, 'scripts/deploy-story-ad-immutable-release.js'), 'utf8');
  assert(immutableDeploySource.includes('migrate-story-ad-v120-checkpoints.js --apply'), 'immutable cutover must run deterministic v120 checkpoint migration');
  assert(immutableDeploySource.includes('migrate-story-ad-v120-checkpoints.js --rollback'), 'immutable rollback must restore migrated checkpoint lineage');
  assert(immutableDeploySource.indexOf('const migration = await migrateReleaseState();')
    > immutableDeploySource.indexOf('const drained = await releaseReadiness(previousTarget);'), 'checkpoint migration must occur only after drain verification');
  assert(immutableDeploySource.indexOf('const migration = await migrateReleaseState();')
    < immutableDeploySource.indexOf('/opt/vido/.current-next'), 'checkpoint migration must finish before current symlink cutover');
  assert(immutableDeploySource.includes('UNSUPPORTED_RELEASE_MIGRATION'), 'unknown source bundles must fail closed instead of mixing versions');
  assert(immutableDeploySource.includes("releaseMigrationMode = 'same_contract_runtime_compatible'"), 'same-contract releases must remain deployable after v126/v129');
  assert(immutableDeploySource.indexOf("previousBuildId === '20260809-platform-cinematic-layers-v120'") < immutableDeploySource.indexOf("previousContractVersion === release.contract_version"), 'v120 deterministic migration must run before generic same-contract compatibility');
  const buildSource = fs.readFileSync(path.join(root, 'scripts/build-story-ad-release.js'), 'utf8');
  assert(buildSource.includes('禁止复用已发布 build_id') && buildSource.includes('RUNTIME_MANIFEST_PATH'), '构建必须禁止同 build_id 覆盖不同运行时代码');
  console.log(JSON.stringify({ passed: true, release_files: files.length, runtime_directories: RUNTIME_DIRECTORIES.length, package_test_files: packageTestFiles(root).length }));
}

main();
