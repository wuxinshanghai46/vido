#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const FRONTEND_ROOT = path.join(ROOT, 'public', 'story-ad');
const INITIAL_FILES = [
  'public/story-ad/app.js',
  'public/story-ad/api.js',
  'public/story-ad/store/projectStore.js',
  'public/story-ad/components/ui.js',
];
const SOURCE_FILES = [
  ...walk(FRONTEND_ROOT),
  path.join(ROOT, 'src/routes/storyAdWorkspace.js'),
  ...walk(path.join(ROOT, 'src/services/storyAdWorkspace')),
];
const FORBIDDEN_DEMO_TERMS = [
  '保时捷',
  '赛车手',
  '女赛车手',
  '山路篇',
  '湿润山路',
  '林间停车区',
  '领航员',
  '边牧',
  '42daab0d',
];

/** 递归列出需要检查的源文件。 */
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const value = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(value) : [value];
  }).filter(file => /\.(?:js|css|html)$/.test(file));
}

/** 读取 UTF-8 源文件。 */
function read(file) {
  return fs.readFileSync(file, 'utf8');
}

/** 返回仓库相对路径。 */
function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

/** 执行示例数据、代码体量、独立入口与按需加载硬门禁。 */
function main() {
  SOURCE_FILES.forEach(file => {
    const content = read(file);
    const lineCount = content.replace(/\r?\n$/, '').split(/\r?\n/).length;
    assert(lineCount <= 600, `${relative(file)} 超过 600 行，必须拆分`);
    if (file.startsWith(FRONTEND_ROOT) && file.endsWith('.js')) {
      assert(!/\b(?:alert|confirm|prompt)\s*\(/.test(content), `${relative(file)} 不得使用浏览器原生弹窗`);
    }
    FORBIDDEN_DEMO_TERMS.forEach(term => {
      assert(!content.includes(term), `${relative(file)} 命中原型示例内容：${term}`);
    });
  });

  const app = read(path.join(ROOT, 'public/story-ad/app.js'));
  assert(app.includes("import('./views/"), '项目视图必须使用动态导入');
  assert(!app.includes('new-story-ad-legacy-ui'), '新模块不得加载旧剧情广告大文件');
  assert(!app.includes('digital-human'), '新模块不得依赖数字人页面');
  assert(app.includes('route.isNew && store.state.bundle'), '进入新建页必须清理上一项目数据');
  assert(app.includes('store.clearProject()'), '新建页必须调用统一跨任务清理');
  assert(app.includes('data-workbench'), '任务中心和项目页必须提供返回工作台入口');
  assert(app.includes("location.href = '/dashboard'"), '返回工作台必须指向平台工作台');
  assert(app.includes('window.vidoTheme?.normalize'), '剧情广告必须复用平台主题规范化逻辑');
  assert(app.includes('window.vidoTheme?.set'), '剧情广告主题切换必须同步平台主题');
  assert(!app.includes("localStorage.setItem('vido-theme', resolved)"), '不得用暗亮别名覆盖平台主题键');
  const page = read(path.join(ROOT, 'public/story-ad/index.html'));
  assert(!page.includes('/js/new-story-ad/'), '独立入口不得同步加载旧剧情广告脚本');
  assert(page.includes('type="module"'), '独立入口必须使用模块化脚本');
  assert(page.includes('/js/vido-theme.js'), '独立入口必须加载平台共享主题脚本');
  assert(page.includes('/js/media-delivery.js?v=20260729-platform-media-v5'), '独立入口必须加载平台媒体交付脚本');
  const styles = read(path.join(ROOT, 'public/story-ad/styles.css'));
  assert(styles.includes(':root[data-theme="light-mist"]'), '亮色样式必须识别平台 light-mist 主题');
  const dialog = read(path.join(ROOT, 'public/story-ad/components/dialog.js'));
  assert(dialog.includes('role="dialog"'), '确认与输入提示必须使用可访问的平台弹窗');
  const assetCenter = read(path.join(ROOT, 'public/story-ad/views/assetCenterView.js'));
  assert(assetCenter.includes('subjectGenerationPayload'), '资产中心必须从 Project Bundle 构造完整主体生成请求');
  assert(assetCenter.includes('subject_targets'), '资产详情必须支持逐人物或逐动物生成');
  assert(assetCenter.includes('dossier_sheet'), '人物详情必须优先显示完整人物档案图');
  const workspaceStyles = read(path.join(ROOT, 'public/story-ad/workspace.css'));
  assert(/\.asset-card[\s\S]{0,900}object-fit:\s*contain/.test(workspaceStyles), '人物资产卡必须完整显示纵向全身图');
  assert(/\.drawer-media-grid[\s\S]{0,500}object-fit:\s*contain/.test(workspaceStyles), '详情四视图不得使用 cover 裁掉人物');

  // 体积门禁按仓库权威 LF 内容计量，避免 Windows core.autocrlf 把同一份源码
  // 因 CRLF 多计一次回车而误判超限。这里仍按未压缩源码字节严格计数。
  const sourceBytes = file => Buffer.byteLength(read(file).replace(/\r\n/g, '\n'), 'utf8');
  const initialBytes = INITIAL_FILES.reduce((sum, file) => sum + sourceBytes(path.join(ROOT, file)), 0);
  const allJsFiles = walk(FRONTEND_ROOT).filter(file => file.endsWith('.js'));
  const lazyJsFiles = allJsFiles.filter(file => /(?:directorStudioView|vendor[\\/])/.test(file));
  const assetEditorLazyJsFiles = allJsFiles.filter(file => /(?:assetCenterAssist|assetCenterPlanningDetails|assetCenterBillingReviewDialog)/.test(file));
  const planMigrationLazyJsFiles = allJsFiles.filter(file => /assetCenterPlan(?:MigrationAction|ReleaseStatus)/.test(file));
  const personFormLazyJsFiles = allJsFiles.filter(file => /assetCenterPersonForm/.test(file));
  const personEvolutionLazyJsFiles = allJsFiles.filter(file => /assetCenterPersonEvolution/.test(file));
  const featureLazyJsFiles = allJsFiles.filter(file => /(?:referenceUnderstandingView|workflowDirectorNodes)/.test(file));
  const recognitionLazyJsFiles = allJsFiles.filter(file => /briefNarrativeRecognition/.test(file));
  const briefLazyJsFiles = allJsFiles.filter(file => /(?:briefTextContract|briefContentModeMigration|briefSettingsSummary|briefWorldSettings)/.test(file));
  const briefMaterialsLazyJsFiles = allJsFiles.filter(file => /briefMaterials/.test(file));
  const briefAdvancedLazyJsFiles = allJsFiles.filter(file => /briefAdvancedConfig/.test(file));
  const panoramaLazyJsFiles = allJsFiles.filter(file => /(?:panoramaViewer|panoramaGeneration)/.test(file));
  const sceneWorldLazyJsFiles = allJsFiles.filter(file => /sceneWorld(?:View|Page)/.test(file));
  const dossierLazyJsFiles = allJsFiles.filter(file => /sceneDossier(?:Card|Export)/.test(file));
  const mediaLazyJsFiles = allJsFiles.filter(file => /(?:finalView|mediaCatalogStore|finalMediaPagination)/.test(file));
  const lightboxLazyJsFiles = allJsFiles.filter(file => /mediaLightbox/.test(file));
  const checkpointRecoveryLazyJsFiles = allJsFiles.filter(file => /assetCheckpointRecovery/.test(file));
  const assetStageLazyJsFiles = allJsFiles.filter(file => /assetCenterStageView/.test(file));
  const recoveryPreflightLazyJsFiles = allJsFiles.filter(file => /subjectRecoveryPreflightAction/.test(file));
  const dialogueFlowJsFiles = allJsFiles.filter(file => /(?:dialogue-demo|briefDialoguePanel|briefDialogueRuntime|briefFormPayload|projectBundleStore)/.test(file));
  const dialogueGuidanceLazyJsFiles = allJsFiles.filter(file => /briefGuidedResume/.test(file));
  const dialogueSupportLazyJsFiles = allJsFiles.filter(file => /(?:briefExplicitSettings|briefReferenceQuestion)/.test(file));
  const dialogueSpecificationLazyJsFiles = allJsFiles.filter(file => /briefSpecificationQuestion/.test(file));
  const referenceDialogueStateJsFiles = allJsFiles.filter(file => /briefReferenceDialogueState/.test(file));
  const plotEditorJsFiles = allJsFiles.filter(file => /plotBeatEditor/.test(file));
  const coreJsFiles = allJsFiles.filter(file => !lazyJsFiles.includes(file) && !assetEditorLazyJsFiles.includes(file) && !planMigrationLazyJsFiles.includes(file) && !personFormLazyJsFiles.includes(file) && !personEvolutionLazyJsFiles.includes(file) && !featureLazyJsFiles.includes(file) && !recognitionLazyJsFiles.includes(file) && !briefLazyJsFiles.includes(file) && !briefMaterialsLazyJsFiles.includes(file) && !briefAdvancedLazyJsFiles.includes(file) && !panoramaLazyJsFiles.includes(file) && !sceneWorldLazyJsFiles.includes(file) && !dossierLazyJsFiles.includes(file) && !mediaLazyJsFiles.includes(file) && !lightboxLazyJsFiles.includes(file) && !checkpointRecoveryLazyJsFiles.includes(file) && !assetStageLazyJsFiles.includes(file) && !recoveryPreflightLazyJsFiles.includes(file) && !dialogueFlowJsFiles.includes(file) && !dialogueGuidanceLazyJsFiles.includes(file) && !dialogueSupportLazyJsFiles.includes(file) && !dialogueSpecificationLazyJsFiles.includes(file) && !referenceDialogueStateJsFiles.includes(file) && !plotEditorJsFiles.includes(file));
  const coreJsBytes = coreJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const lazyJsBytes = lazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const assetEditorLazyJsBytes = assetEditorLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const planMigrationLazyJsBytes = planMigrationLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const personFormLazyJsBytes = personFormLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const personEvolutionLazyJsBytes = personEvolutionLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const featureLazyJsBytes = featureLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const recognitionLazyJsBytes = recognitionLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const briefLazyJsBytes = briefLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const briefMaterialsLazyJsBytes = briefMaterialsLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const briefAdvancedLazyJsBytes = briefAdvancedLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const panoramaLazyJsBytes = panoramaLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const sceneWorldLazyJsBytes = sceneWorldLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const dossierLazyJsBytes = dossierLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const mediaLazyJsBytes = mediaLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const lightboxLazyJsBytes = lightboxLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const checkpointRecoveryLazyJsBytes = checkpointRecoveryLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const assetStageLazyJsBytes = assetStageLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const recoveryPreflightLazyJsBytes = recoveryPreflightLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const dialogueFlowJsBytes = dialogueFlowJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const dialogueGuidanceLazyJsBytes = dialogueGuidanceLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const dialogueSupportLazyJsBytes = dialogueSupportLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const dialogueSpecificationLazyJsBytes = dialogueSpecificationLazyJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const referenceDialogueStateJsBytes = referenceDialogueStateJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const plotEditorJsBytes = plotEditorJsFiles.reduce((sum, file) => sum + sourceBytes(file), 0);
  const gzipBytes = files => files.reduce((sum, file) => sum + zlib.gzipSync(Buffer.from(read(file).replace(/\r\n/g, '\n'))).length, 0);
  const coreJsGzip = gzipBytes(coreJsFiles);
  const lazyJsGzip = gzipBytes(lazyJsFiles);
  const assetEditorLazyJsGzip = gzipBytes(assetEditorLazyJsFiles);
  const planMigrationLazyJsGzip = gzipBytes(planMigrationLazyJsFiles);
  const personFormLazyJsGzip = gzipBytes(personFormLazyJsFiles);
  const personEvolutionLazyJsGzip = gzipBytes(personEvolutionLazyJsFiles);
  const featureLazyJsGzip = gzipBytes(featureLazyJsFiles);
  const recognitionLazyJsGzip = gzipBytes(recognitionLazyJsFiles);
  const briefLazyJsGzip = gzipBytes(briefLazyJsFiles);
  const briefMaterialsLazyJsGzip = gzipBytes(briefMaterialsLazyJsFiles);
  const briefAdvancedLazyJsGzip = gzipBytes(briefAdvancedLazyJsFiles);
  const panoramaLazyJsGzip = gzipBytes(panoramaLazyJsFiles);
  const sceneWorldLazyJsGzip = gzipBytes(sceneWorldLazyJsFiles);
  const dossierLazyJsGzip = gzipBytes(dossierLazyJsFiles);
  const mediaLazyJsGzip = gzipBytes(mediaLazyJsFiles);
  const lightboxLazyJsGzip = gzipBytes(lightboxLazyJsFiles);
  const checkpointRecoveryLazyJsGzip = gzipBytes(checkpointRecoveryLazyJsFiles);
  const assetStageLazyJsGzip = gzipBytes(assetStageLazyJsFiles);
  const recoveryPreflightLazyJsGzip = gzipBytes(recoveryPreflightLazyJsFiles);
  const dialogueFlowJsGzip = gzipBytes(dialogueFlowJsFiles);
  const dialogueGuidanceLazyJsGzip = gzipBytes(dialogueGuidanceLazyJsFiles);
  const dialogueSupportLazyJsGzip = gzipBytes(dialogueSupportLazyJsFiles);
  const dialogueSpecificationLazyJsGzip = gzipBytes(dialogueSpecificationLazyJsFiles);
  const referenceDialogueStateJsGzip = gzipBytes(referenceDialogueStateJsFiles);
  const plotEditorJsGzip = gzipBytes(plotEditorJsFiles);
  assert(initialBytes <= 100 * 1024, `任务中心初始 JS ${initialBytes} bytes 超过 100 KiB`);
  // Rich asset/scene/storyboard editors are lazy-loaded after entering a project.
  // Keep the initial 100 KiB gate strict; the total source budget includes the
  // on-demand line-sketch batch workflow, HD dossier gallery, scene shooting
  // details, reusable product-reference controls and atomic lightbox switching.
  // Initial loading stays strict. SceneWorld's WebGL studio, capability matrix
  // and transition inspector are lazy-loaded only after entering Asset Center.
  // V2 adds stable character assignment, explicit 360/3D readiness contracts
  // and hover video previews; the initial 100 KiB gate remains unchanged.
  assert(coreJsBytes <= 330 * 1024, `核心按需模块 JS ${coreJsBytes} bytes 超过 330 KiB`);
  assert(coreJsGzip <= 105 * 1024, `核心按需模块 gzip ${coreJsGzip} bytes 超过 105 KiB`);
  assert(dialogueFlowJsBytes <= 32 * 1024, `对话立项与分区加载模块 ${dialogueFlowJsBytes} bytes 超过 32 KiB`);
  // Guided slot state stays in the initial dialogue module; explicit parsing
  // and reference actions are separately lazy-loaded and capped below.
  assert(dialogueFlowJsGzip <= 12 * 1024, `对话立项与分区加载模块 gzip ${dialogueFlowJsGzip} bytes 超过 12 KiB`);
  assert(dialogueGuidanceLazyJsBytes <= 4 * 1024, `已有项目恢复问询模块 ${dialogueGuidanceLazyJsBytes} bytes 超过 4 KiB`);
  assert(dialogueGuidanceLazyJsGzip <= 2 * 1024, `已有项目恢复问询模块 gzip ${dialogueGuidanceLazyJsGzip} bytes 超过 2 KiB`);
  assert(dialogueSupportLazyJsBytes <= 8 * 1024, `对话按需识别与参考入口 ${dialogueSupportLazyJsBytes} bytes 超过 8 KiB`);
  assert(dialogueSupportLazyJsGzip <= 3 * 1024, `对话按需识别与参考入口 gzip ${dialogueSupportLazyJsGzip} bytes 超过 3 KiB`);
  assert(dialogueSpecificationLazyJsBytes <= 3 * 1024, `成片规格确认按需模块 ${dialogueSpecificationLazyJsBytes} bytes 超过 3 KiB`);
  assert(dialogueSpecificationLazyJsGzip <= 2 * 1024, `成片规格确认按需模块 gzip ${dialogueSpecificationLazyJsGzip} bytes 超过 2 KiB`);
  assert(referenceDialogueStateJsBytes <= 8 * 1024, `参考分析对话状态模块 ${referenceDialogueStateJsBytes} bytes 超过 8 KiB`);
  assert(referenceDialogueStateJsGzip <= 3 * 1024, `参考分析对话状态模块 gzip ${referenceDialogueStateJsGzip} bytes 超过 3 KiB`);
  assert(plotEditorJsBytes <= 12 * 1024, `剧情逐段编辑模块 ${plotEditorJsBytes} bytes 超过 12 KiB`);
  assert(plotEditorJsGzip <= 4 * 1024, `剧情逐段编辑模块 gzip ${plotEditorJsGzip} bytes 超过 4 KiB`);
  assert(featureLazyJsBytes <= 60 * 1024, `参考理解与画布导演功能模块 ${featureLazyJsBytes} bytes 超过 60 KiB`);
  assert(featureLazyJsGzip <= 16 * 1024, `参考理解与画布导演功能模块 gzip ${featureLazyJsGzip} bytes 超过 16 KiB`);
  assert(recognitionLazyJsBytes <= 4 * 1024, `目标页识别预览模块 ${recognitionLazyJsBytes} bytes 超过 4 KiB`);
  assert(recognitionLazyJsGzip <= 2 * 1024, `目标页识别预览模块 gzip ${recognitionLazyJsGzip} bytes 超过 2 KiB`);
  assert(briefLazyJsBytes <= 10 * 1024, `目标页按需辅助模块 ${briefLazyJsBytes} bytes 超过 10 KiB`);
  assert(briefLazyJsGzip <= 4 * 1024, `目标页按需辅助模块 gzip ${briefLazyJsGzip} bytes 超过 4 KiB`);
  assert(briefMaterialsLazyJsBytes <= 3 * 1024, `目标页参考材料模块 ${briefMaterialsLazyJsBytes} bytes 超过 3 KiB`);
  assert(briefMaterialsLazyJsGzip <= 2 * 1024, `目标页参考材料模块 gzip ${briefMaterialsLazyJsGzip} bytes 超过 2 KiB`);
  assert(briefAdvancedLazyJsBytes <= 3 * 1024, `目标页高级配置模块 ${briefAdvancedLazyJsBytes} bytes 超过 3 KiB`);
  assert(briefAdvancedLazyJsGzip <= 2 * 1024, `目标页高级配置模块 gzip ${briefAdvancedLazyJsGzip} bytes 超过 2 KiB`);
  assert(panoramaLazyJsBytes <= 20 * 1024, `360全景按需模块 ${panoramaLazyJsBytes} bytes 超过 20 KiB`);
  assert(panoramaLazyJsGzip <= 8 * 1024, `360全景按需模块 gzip ${panoramaLazyJsGzip} bytes 超过 8 KiB`);
  assert(sceneWorldLazyJsBytes <= 50 * 1024, `场景世界按需模块 ${sceneWorldLazyJsBytes} bytes 超过 50 KiB`);
  assert(sceneWorldLazyJsGzip <= 15 * 1024, `场景世界按需模块 gzip ${sceneWorldLazyJsGzip} bytes 超过 15 KiB`);
  assert(dossierLazyJsBytes <= 24 * 1024, `场景档案按需模块 ${dossierLazyJsBytes} bytes 超过 24 KiB`);
  assert(dossierLazyJsGzip <= 9 * 1024, `场景档案按需模块 gzip ${dossierLazyJsGzip} bytes 超过 9 KiB`);
  assert(mediaLazyJsBytes <= 16 * 1024, `最终成片与媒体分页按需模块 ${mediaLazyJsBytes} bytes 超过 16 KiB`);
  assert(mediaLazyJsGzip <= 6 * 1024, `最终成片与媒体分页按需模块 gzip ${mediaLazyJsGzip} bytes 超过 6 KiB`);
  assert(lightboxLazyJsBytes <= 11 * 1024, `通用大图查看器按需模块 ${lightboxLazyJsBytes} bytes 超过 11 KiB`);
  assert(lightboxLazyJsGzip <= 4 * 1024, `通用大图查看器按需模块 gzip ${lightboxLazyJsGzip} bytes 超过 4 KiB`);
  assert(checkpointRecoveryLazyJsBytes <= 2 * 1024, `资产恢复提示按需模块 ${checkpointRecoveryLazyJsBytes} bytes 超过 2 KiB`);
  assert(checkpointRecoveryLazyJsGzip <= 1 * 1024, `资产恢复提示按需模块 gzip ${checkpointRecoveryLazyJsGzip} bytes 超过 1 KiB`);
  assert(assetStageLazyJsBytes <= 2 * 1024, `资产阶段视图按需模块 ${assetStageLazyJsBytes} bytes 超过 2 KiB`);
  assert(assetStageLazyJsGzip <= 1 * 1024, `资产阶段视图按需模块 gzip ${assetStageLazyJsGzip} bytes 超过 1 KiB`);
  assert(recoveryPreflightLazyJsBytes <= 2 * 1024, `人物恢复安全预检按需模块 ${recoveryPreflightLazyJsBytes} bytes 超过 2 KiB`);
  assert(recoveryPreflightLazyJsGzip <= 1 * 1024, `人物恢复安全预检按需模块 gzip ${recoveryPreflightLazyJsGzip} bytes 超过 1 KiB`);
  assert(lazyJsBytes <= 780 * 1024, `3D导演台懒加载 JS ${lazyJsBytes} bytes 超过 780 KiB`);
  assert(lazyJsGzip <= 200 * 1024, `3D导演台懒加载 gzip ${lazyJsGzip} bytes 超过 200 KiB`);

  assert(assetEditorLazyJsBytes <= 40 * 1024, `asset editor lazy modules ${assetEditorLazyJsBytes} bytes exceed 40 KiB`);
  assert(assetEditorLazyJsGzip <= 12 * 1024, `asset editor lazy modules gzip ${assetEditorLazyJsGzip} bytes exceed 12 KiB`);
  assert(planMigrationLazyJsBytes <= 4 * 1024, `方案迁移点击模块 ${planMigrationLazyJsBytes} bytes 超过 4 KiB`);
  assert(planMigrationLazyJsGzip <= 2 * 1024, `方案迁移点击模块 gzip ${planMigrationLazyJsGzip} bytes 超过 2 KiB`);
  assert(personFormLazyJsBytes <= 4 * 1024, `person form lazy module ${personFormLazyJsBytes} bytes exceeds 4 KiB`);
  assert(personFormLazyJsGzip <= 2 * 1024, `person form lazy module gzip ${personFormLazyJsGzip} bytes exceeds 2 KiB`);
  assert(personEvolutionLazyJsBytes <= 8 * 1024, `person evolution lazy module ${personEvolutionLazyJsBytes} bytes exceeds 8 KiB`);
  assert(personEvolutionLazyJsGzip <= 3 * 1024, `person evolution lazy module gzip ${personEvolutionLazyJsGzip} bytes exceeds 3 KiB`);

  const workflow = read(path.join(ROOT, 'public/story-ad/views/workflowView.js'));
  assert(workflow.includes("addEventListener('pointermove'"), '画布必须支持指针平移');
  assert(workflow.includes("addEventListener('wheel'"), '画布必须支持滚轮缩放');
  assert(workflow.includes('data-node-panel'), '画布节点必须支持详情面板');
  assert(workflow.includes('nodeElements.forEach'), '画布节点必须绑定独立拖拽事件');
  assert(workflow.includes('screenDx / zoom') && workflow.includes('screenDy / zoom'), '节点拖拽坐标必须按当前缩放反算');
  assert(workflow.includes('suppressNodeClickUntil'), '节点拖拽与点击详情必须使用移动阈值隔离');
  assert(workflow.includes('renderGeometry()'), '节点移动必须实时刷新节点、连线、分组和小地图');
  assert(workflow.includes("miniMap.addEventListener('pointerdown'"), '小地图必须支持点击与拖动导航');
  assert(workflow.includes("method: 'DELETE'"), '画布必须提供恢复自动布局操作');
  assert(workflow.includes('layout_revision'), '画布保存必须携带独立布局版本');
  const workflowStyles = read(path.join(ROOT, 'public/story-ad/workflow.css'));
  assert(workflowStyles.includes('.graph-node.is-dragging'), '节点拖动必须提供明确视觉反馈');
  const graphLayoutService = read(path.join(ROOT, 'src/services/storyAdWorkspace/graphLayoutService.js'));
  assert(graphLayoutService.includes('GRAPH_LAYOUT_REVISION_CONFLICT'), '画布布局必须阻止旧版本并发覆盖');
  assert(graphLayoutService.includes("OUTPUT_KIND = 'workspace_graph_layout'"), '画布布局必须与剧情内容独立持久化');
  const workspaceRoutes = read(path.join(ROOT, 'src/routes/storyAdWorkspace.js'));
  assert(workspaceRoutes.includes("router.get('/projects/:taskId/graph-layout'"), '画布布局必须提供独立读取接口');
  assert(workspaceRoutes.includes("router.put('/projects/:taskId/graph-layout'"), '画布布局必须提供独立保存接口');
  assert(workspaceRoutes.includes("router.delete('/projects/:taskId/graph-layout'"), '画布布局必须提供恢复自动布局接口');
  assert(workspaceRoutes.includes('graphLayouts.mergeGraph'), '图谱读取必须合并已保存布局');
  const store = read(path.join(ROOT, 'public/story-ad/store/projectStore.js'));
  assert(store.includes('bindReferenceAnalysis(analysis)'), '参考分析必须显式绑定当前任务');
  assert(store.includes('referenceAnalysisId'), '参考轮询必须锁定明确分析 ID');
  assert(store.includes('function clearProject()'), '状态仓库必须提供跨任务清理');

  console.log(`story-ad workspace v6 boundaries: passed; initial_js=${initialBytes}; core_js=${coreJsBytes}; core_gzip=${coreJsGzip}; lightbox_lazy_js=${lightboxLazyJsBytes}; lightbox_lazy_gzip=${lightboxLazyJsGzip}; feature_lazy_js=${featureLazyJsBytes}; feature_lazy_gzip=${featureLazyJsGzip}; panorama_lazy_js=${panoramaLazyJsBytes}; panorama_lazy_gzip=${panoramaLazyJsGzip}; scene_world_lazy_js=${sceneWorldLazyJsBytes}; scene_world_lazy_gzip=${sceneWorldLazyJsGzip}; dossier_lazy_js=${dossierLazyJsBytes}; dossier_lazy_gzip=${dossierLazyJsGzip}; lazy_3d_js=${lazyJsBytes}; lazy_3d_gzip=${lazyJsGzip}`);
}

main();
