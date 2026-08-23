'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const timingProjection = require('../src/services/storyAdWorkspace/projectTimingProjectionService');
const { collectStoryAdReleaseFiles } = require('./lib/storyAdReleaseFiles');

function loadBrowserModule(file, exposed, globals = {}) {
  const source = read(file)
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+/g, '');
  const sandbox = { ...globals };
  vm.runInNewContext(`${source}\nglobalThis.__tested = { ${exposed.join(', ')} };`, sandbox, { filename: file });
  return sandbox.__tested;
}

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');
const mediaPreview = item => item?.media_url || item?.image_url
  ? `<img class="media" src="${escapeHtml(item.media_url || item.image_url)}">`
  : '<div class="media-placeholder"></div>';

const projectedSemanticTiming = timingProjection.referenceTiming({
  progress: 82,
  semantic_contract_progress: {
    version: 'reference-semantic-recovery-v1', completed: 3, total: 5, score: 65,
    active_contract: 'cast', missing_contracts: ['cast', 'scenes', 'unknown_contract'],
    contracts: {
      story: { complete: true, status: 'complete', failures: [] },
      cast: { complete: false, status: 'repairing', failures: ['character_semantics_incomplete'] },
      scenes: { complete: false, status: 'missing', failures: ['scene_semantics_incomplete'] },
    },
  },
}, (value, max) => String(value || '').slice(0, max), value => (Array.isArray(value) ? value : []));
assert.equal(projectedSemanticTiming.semantic_contract_progress.completed, 3);
assert.equal(projectedSemanticTiming.semantic_contract_progress.active_contract, 'cast');
assert.deepStrictEqual(projectedSemanticTiming.semantic_contract_progress.missing_contracts, ['cast', 'scenes']);
assert.equal(projectedSemanticTiming.semantic_contract_progress.contracts.cast.failures[0], 'character_semantics_incomplete');

const assets = read('public/story-ad/views/assetCenterView.js');
const assetPlanReleaseStatus = read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const assetPlanStageStatus = read('public/story-ad/views/assetCenterStageView.js');
const projectStoreSource = read('public/story-ad/store/projectStore.js');
const personDossierShowcase = read('public/story-ad/views/personDossierShowcase.js');
const assetDossierSections = read('public/story-ad/views/assetCenterDossierSections.js');
const sceneDossierCard = read('public/story-ad/views/sceneDossierCard.js');
const sceneWorldPage = read('public/story-ad/views/sceneWorldPage.js');
const assetPlanningDetails = read('public/story-ad/views/assetCenterPlanningDetails.js');
assert.match(assetDossierSections, /reference-dossier-board/);
assert.match(assetDossierSections, /参考档案预览/);
assert.match(assetPlanningDetails, /查看原始四视图/);
assert.match(assetPlanningDetails, /form="personEditForm"/u, '人物抽屉固定操作栏必须始终提供文字保存入口');
assert.match(assetPlanningDetails, /保存人物文字设定/u);
assert.match(sceneDossierCard, /function assetCardMedia/);
assert.match(sceneDossierCard, /const portrait = item\.native_masters\?\.face\?\.image_url/, '人物主卡必须优先显示单人物标准人像');
assert.match(sceneDossierCard, /asset-people-portraits/, '人物主卡必须使用独立人像预览组，而不是完整档案拼图');
assert.match(personDossierShowcase, /完整人物档案尚未合成/);
assert.match(personDossierShowcase, /当前分类拼图不是最终整图/);

const briefView = read('public/story-ad/views/briefView.js');
const referenceDialogueState = read('public/story-ad/views/briefReferenceDialogueState.js');
const referenceActionStateSource = read('public/story-ad/views/briefReferenceActionState.js');
const briefFormPayload = read('public/story-ad/views/briefFormPayload.js');
const briefDialoguePanel = read('public/story-ad/views/briefDialoguePanel.js');
const briefReferenceRecovery = read('public/story-ad/views/briefReferenceRecovery.js');
const briefSettingsModal = read('public/story-ad/views/briefSettingsModal.js');
const briefMaterials = read('public/story-ad/views/briefMaterials.js');
const briefAdvancedConfig = read('public/story-ad/views/briefAdvancedConfig.js');
const briefWorldSettings = read('public/story-ad/views/briefWorldSettings.js');
const referenceProgressSource = read('public/story-ad/views/referenceProgressCard.js');
assert.doesNotMatch(briefView, /<h2>高级配置<\/h2>|<aside class="brief-side-column">/, '目标页不得保留独立高级配置侧栏');
assert.match(briefAdvancedConfig, /data-reference-material-choice/, '可选精调区必须保留参考材料选择');
assert.match(briefAdvancedConfig, /<option value="yes"/, '用户必须能明确选择使用参考材料');
assert.match(briefAdvancedConfig, /<option value="no">否，暂不使用<\/option>/, '用户必须能明确选择不使用参考材料');
assert.match(briefAdvancedConfig, /data-reference-material-fields \$\{enabled \? '' : 'hidden'\}/, '未选择使用参考材料时不得显示上传入口');
assert.match(briefAdvancedConfig, /event\.currentTarget\.value !== 'yes'/, '只有选择使用参考材料后才可展开上传入口');
assert.match(briefMaterials, /\['reference', '参考视频'/);
assert.match(briefMaterials, /\['product', '商品 \/ 服务主体参考'/);
assert.doesNotMatch(briefMaterials, /\['person', '人物 \/ 宠物'/, '人物和宠物只能在资产中心管理');
assert.doesNotMatch(briefMaterials, /\['scene', '场景 \/ 空间'/, '场景和空间只能在资产中心管理');
assert.doesNotMatch(briefMaterials, /\['logo', '品牌标识'/, '品牌标识只能在资产中心管理');
assert.doesNotMatch(briefMaterials, /\['script', '脚本 \/ 分镜'/, '脚本与分镜不得继续混在启动材料中');
assert.match(briefAdvancedConfig, /参考材料用于辅助理解/);
assert.doesNotMatch(briefView, /name="project_name"[^>]*minlength=/, '项目名称不得再设置任意最少字数');
assert.doesNotMatch(briefView, /name="brief"[^>]*(?:required|minlength=)/, '广告目标不得阻断仅参考视频的创建入口');
assert.doesNotMatch(briefView, /name="cast_mode"|name="expected_people"|name="expected_animals"/, '人物与动物数量不得提前堆在广告目标环节');
assert.doesNotMatch(briefView, /payload\.brief\.length\s*<\s*8/, '创建草稿不得复用生成前的广告目标字数门禁');
assert.match(briefView, /if \(!payload\.project_name\)/, '项目名称仍需非空，避免产生不可识别任务');
assert.doesNotMatch(briefView, /referenceAnalysisSections/, '目标与材料页不得堆叠完整参考分析');
assert.doesNotMatch(briefView, /故事结构|人物分析|动物分析|场景分析|逐镜分析/, '参考详情必须按制作环节分流');
assert.match(briefView, /<dialog class="brief-settings-modal" data-brief-settings-modal/, '对话优先流程必须把专业表单放进默认关闭的 modal');
assert.match(briefDialoguePanel, /对话内容会自动同步到这里/, '确认单必须说明对话会自动同步');
assert.match(briefDialoguePanel, /手动编辑全部设置/, '对话中必须保留专业设置 modal 入口');
assert.match(briefView, /\[15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, 600\]/, '新工作区必须提供 3、4、5、6、8、10 分钟的中长片选项');
assert.match(read('public/story-ad/views/briefSettingsSummary.js'), /return remainder \? `\$\{minutes\} 分 \$\{remainder\} 秒` : `\$\{minutes\} 分钟`/, '折叠摘要必须把 300/600 秒显示为 5/10 分钟');
assert.match(briefView, /bindBriefSettingsModal\(host\)/, '目标页必须绑定独立专业设置 modal 控制器');
assert.match(briefSettingsModal, /if \(!modal\.open\) modal\.showModal\(\)[\s\S]*modal\.querySelector\([^\n]+\)\?\.focus\(\)/, '专业设置只能通过显式入口打开并把焦点移入 modal');
assert.match(briefView, /briefSettingsModalController\.modal\?\.open[\s\S]*briefSettingsModalController\.close\(\)/, '参考状态切换后必须关闭专业设置 modal');
assert.match(briefView, /data-brief-inline-action/, '参考内容存在时，下一步主操作不得藏在折叠表单内部');
assert.match(briefView, /referenceStepVisible && bundle\.navigation\?\.steps\?\.brief\?\.completed !== true/, '已完成并进入后续步骤后不得继续显示第 1 步引导卡');
assert.match(briefView, /form="storyAdBriefForm" data-brief-submit/, '折叠区外的下一步必须提交同一份可编辑表单');
assert.match(briefView, /你可以直接修改，保存后将以你的版本为准/, '识别出的广告目标必须保持可编辑且以用户修改为准');
assert.match(briefView, /data-brief-settings-anchor>[\s\S]*data-brief-settings-modal[\s\S]*data-brief-settings-layout/, '广告目标与启动材料必须保留在稳定 modal 内');
assert.match(briefView, /referenceProgressMarkup:\s*showReferenceStepGuidance\s*\?\s*referenceProgress\(bundle\.reference\)/,
  '目标页必须把参考状态卡注入对话内部，而不是继续渲染为固定高度容器外的兄弟节点');
assert.match(briefDialoguePanel, /data-brief-conversation[^>]*>[\s\S]*data-reference-progress-host[\s\S]*<\/div>\s*<footer class="brief-composer">/,
  '分析中或失败时，参考状态卡必须位于可滚动对话区内并在输入区上方');
assert.match(referenceProgressSource, /data-reference-abandon/,
  '失败参考必须提供不使用参考继续的可见恢复动作');
assert.match(referenceProgressSource, /'重新整理内容'/,
  '恢复按钮必须使用用户可理解的简短动作名称');
assert.match(briefReferenceRecovery, /可能新增一次模型费用|可能产生一次新费用/,
  '费用风险必须在真正发起重试前的确认对话中明确说明');
assert.match(referenceProgressSource, /failedUserCopy/,
  '失败状态必须通过用户化映射展示，不能直接暴露供应商错误原文');
assert.ok(
  briefView.indexOf('data-brief-settings-anchor') < briefView.indexOf('data-reference-understanding-host'),
  '没有可用报告时，广告目标与启动材料必须保留在报告挂载点上方',
);
assert.doesNotMatch(briefView, /restoreBriefSettingsLayout|briefSettingsNode:/, '参考报告不得再搬移唯一设置表单');
assert.match(briefView, /briefSettingsModalController\.modal\?\.open[\s\S]*briefSettingsModalController\.close\(\)/, '选择或移除参考时专业设置 modal 必须安全关闭');
assert.match(briefView, /store\.subscribe\([\s\S]*referenceProgress\(nextState\.bundle\?\.reference/, '同一分析状态内的实时进度必须局部更新，不能等待整页重载');
assert.match(briefView, /store\.subscribe\([\s\S]*querySelectorAll\('\[data-brief-submit\]'\)[\s\S]*syncReferenceAction\(button, nextReference, nextMode\)/, '分析终态到达时必须按当前内容域同步刷新折叠区内外的主按钮');
assert.match(briefView, /unsubscribeProgress\(\)/, '离开目标页时必须注销进度订阅');
assert.match(briefView, /placeholder="请输入便于识别的项目名称"/);
assert.doesNotMatch(briefView, /新标门窗|全景窗剧情广告/, '项目名称提示不得暗示特定行业');
assert.match(referenceProgressSource, /elapsedTimeTag\(\{ startedAt: reference\.started_at/);
assert.match(referenceActionStateSource, /contentMode === 'commercial_subject' \? '广告脚本' : '剧情与对白'/, '第一步完成后的主操作必须按广告或剧情内容域进入对应脚本');
assert.match(briefView, /data-ai-brief>AI 帮写/, '未添加参考视频时必须提供广告目标 AI 帮写入口');
assert.match(briefFormPayload, /brief_source:\s*'user'/, '正式表单载荷必须把手填或 AI 帮写后的内容目标标记为用户权威，参考材料不得覆盖');
assert.match(assets, /assetPlanStageView/, '资产中心必须通过统一阶段视图渲染人物生成入口');
assert.match(assetPlanStageStatus, /data-generate-missing-subjects[\s\S]*生成人物方案/, '主体批量入口必须使用统一的人物方案生成动作');
assert.doesNotMatch(assetPlanStageStatus, /文字方案已建立|图片未生成|进入资产中心不会自动生成图片/, '资产中心不得继续暴露旧两步式人物方案流程');
assert.match(projectStoreSource, /terminalProgress[\s\S]*!project\.active_generation_id && \(terminalProgress \|\|/, '方案内部完成且活动任务清空时必须刷新资产页，不得被旧 running 状态卡住');
assert.match(assetPlanStageStatus, /确认人物资产，进入场景世界/, '人物图片已经齐全时，页面顶部必须提供可见的确认入口');
assert.doesNotMatch(assetPlanStageStatus, /data-confirm-assets[^>]*disabled/, '人物已经齐全时，确认入口不得被无关的后台生成任务错误禁用');
assert.match(assets, /querySelectorAll\('\[data-confirm-assets\]'\)/, '顶部人物确认入口必须绑定真实点击事件');
assert.doesNotMatch(assets, /step-completion-card[\s\S]*data-confirm-assets/, '资产列表底部不得重复放置用户难以发现的人物确认入口');
assert.match(briefView, /mode:\s*'brief_goal'/, '剧情与广告剧本帮写必须使用独立模式，不能提前生成分镜或调用视觉模型');
assert.match(briefView, /剧情和广告都会整理成正常剧本式结构；保留你写明的人物、场景、故事、商品与业务事实，不提前生成分镜/, '目标页必须解释 AI 帮写的结构与职责边界');
assert.match(briefView, /brief-config-section full/, '基础信息必须使用独立设置分区，不能继续平铺在旧表单网格');
assert.match(briefView, /brief-side-world-grid/, '世界与画面识别信息必须保留可编辑纵向网格');
assert.match(briefView, /brief-output-grid/, '时长、画幅和分辨率必须组成统一成片规格分区');
assert.match(briefWorldSettings, /具体时期 <em>根据内容同步<\/em>/, '具体时期必须明确显示将与内容识别同步');
assert.match(briefWorldSettings, /国家 \/ 地区 <em>AI 可识别<\/em>/, '国家地区必须明确提示可由 AI 识别');
assert.match(briefWorldSettings, /formOwner = settings\.formId/, '移动到右侧的字段必须通过 form owner 参与保存');
const briefStyles = read('public/story-ad/styles.css');
const workspaceStyles = read('public/story-ad/workspace.css');
assert.match(workspaceStyles, /\.brief-reference-progress-slot \.reference-progress-card\.is-recovery \{ width: min\(760px/,
  '失败恢复卡必须使用对话式紧凑宽度，不能继续铺满工作区');
assert.match(workspaceStyles, /\.material-list\[hidden\] \{ display: none; \}/, '选择不使用参考材料时，上传入口不得被 grid 样式重新显示');
assert.match(briefStyles, /\.brief-form \.field:not\(\.full\) \{ grid-template-rows: auto minmax\(48px, auto\) auto;/, '目标页字段网格必须为中文下拉框保留足够行高');
assert.match(briefStyles, /\.brief-form \.field:not\(\.full\) > \.select \{[\s\S]*height: 48px;[\s\S]*padding-block: 8px;[\s\S]*line-height: 1\.5;/, '目标页下拉框必须显式避免中文文字下缘裁切');
assert.match(briefStyles, /\.brief-config-section \{[^}]*grid-column: 1 \/ -1;/, '两个设置分区必须各自占满主表单宽度，不能被挤在同一行');
assert.match(briefStyles, /@media \(max-width: 760px\)[\s\S]*\.brief-config-grid, \.brief-output-grid \{ grid-template-columns: 1fr;/, '世界观与成片规格在窄屏必须切换为单列');
assert.match(briefView, /<select class="select" name="content_mode" required>[\s\S]*<option value="commercial_subject"[\s\S]*<option value="narrative_story"/, '目标页必须使用下拉框让用户明确选择广告或剧情');
assert.ok(briefView.indexOf('name="content_mode"') < briefView.indexOf('name="brief"'), '必须先选择广告/剧情，再填写内容目标');
assert.equal((briefView.match(/name="content_mode"/g) || []).length, 1, '页面只能有一个内容类型下拉框');
assert.equal((briefView.match(/name="product_subject"/g) || []).length, 0, '自动识别广告主体后页面不得显示产品或主题输入框');
assert.match(briefView, /广告会识别商品或服务主体；剧情不创建商品主体/);
assert.match(briefView, /<b id="brief-basic-settings-title">基础信息<\/b>/, '项目名称、内容类型和内容目标必须归入基础信息');
assert.match(briefView, /<span class="brief-config-index">02<\/span><span><b id="brief-output-settings-title">成片规格<\/b>/, '成片规格必须排在基础信息之后');
assert.match(briefView, /<dialog class="brief-settings-modal"[\s\S]*参考材料与识别信息[\s\S]*renderAdvancedReferenceControls[\s\S]*worldSettingFields/, '参考材料与识别信息必须收进同一手动设置 modal');
assert.match(briefView, /worldSettingFields\(worldProfile, escapeHtml, \{ formId: 'storyAdBriefForm' \}\)/, 'AI 识别字段必须继续关联基础信息表单');
assert.match(briefView, /content_mode: payload\.content_mode/, 'AI 帮写必须携带用户明确选择的内容类型');
assert.match(briefView, /!payload\.content_mode \|\| payload\.content_mode_source !== 'user'/, '只有用户亲自选择内容类型后才可创建或生成');
assert.match(briefView, /if \(store\.state\.bundle\?\.reference\?\.analysis_id\)/, '帮写返回前必须防止覆盖后来添加的参考视频');
assert.match(briefView, /!== targetSnapshot/, '帮写返回前必须防止覆盖用户等待期间的新编辑');
assert.doesNotMatch(briefView, />保存目标</, '旧的保存目标按钮不得继续出现');
assert.match(briefView, /const dirtyFields = new Set\(\)/, '必须记录本页真实编辑字段');
assert.match(briefView, /function safeFormPayload\(\)/, '提交前必须从 Store 重新读取识别后的权威目标');
assert.match(briefView, /if \(dirtyFields\.has\(key\)/, '只有用户本页主动编辑的字段可以覆盖识别结果');
assert.match(briefView, /const payload = safeFormPayload\(\);[\s\S]*content_mode_change_confirmed = true[\s\S]*if \(dirtyFields\.size\)[\s\S]*await store\.updateRequest\(payload, \{ refreshSections: 'summary' \}\);[\s\S]*runStage\('blueprint',\s*\{[\s\S]*idempotency_key:[\s\S]*\}\)[\s\S]*view=plot/, '目标确认必须只保存真实编辑，再按带幂等键生成剧情与对白、进入剧情室的顺序执行');
assert.match(briefView, /if \(dirtyFields\.size\)/, '刚确认参考报告且没有修改目标时不得发送会使确认失效的空保存');
assert.match(briefView, /onConfirmed:[\s\S]*proceedToPlot/, '参考理解确认后必须自动接通同一条剧情与对白流程');
const progressModule = loadBrowserModule('public/story-ad/views/referenceProgressCard.js', ['referenceProgress'], {
  escapeHtml,
  elapsedTimeTag({ active = false } = {}) { return `<span class="elapsed-time">${active ? '已耗时' : '本次耗时'} 1分05秒</span>`; },
});
const briefProgressModule = loadBrowserModule('public/story-ad/views/briefView.js', ['referenceProgress'], {
  escapeHtml,
  renderReferenceProgress: progressModule.referenceProgress,
  elapsedTimeTag({ active = false } = {}) { return `<span class="elapsed-time">${active ? '已耗时' : '本次耗时'} 1分05秒</span>`; },
  setButtonBusy() {},
  toast() {},
  confirmDialog() { return false; },
  promptDialog() { return ''; },
});
const referenceStateModule = loadBrowserModule('public/story-ad/views/briefReferenceActionState.js', ['referenceActionState', 'syncReferenceAction']);
const briefModule = { ...briefProgressModule, ...referenceStateModule };
const runningReference = briefModule.referenceProgress({
  analysis_id: 'analysis-running', status: 'running', progress: 42,
  started_at: '2026-08-01T00:00:00.000Z',
  phase: '证据帧与语音已提取', filename: 'reference.mp4',
});
assert.match(runningReference, /role="progressbar"/);
assert.match(runningReference, /aria-valuenow="42"/);
assert.match(runningReference, /width:42%/);
assert.match(runningReference, /已耗时 1分05秒/);
assert.match(runningReference, /证据帧与语音已提取/);
assert.doesNotMatch(runningReference, /故事结构|人物分析|场景分析|逐镜分析/);
const interruptedReference = briefModule.referenceProgress({
  analysis_id: 'analysis-sync-interrupted', status: 'sync_interrupted', progress: 42,
  started_at: '2026-08-01T00:00:00.000Z', sync_interrupted_at: '2026-08-01T00:01:05.000Z',
});
assert.match(interruptedReference, /状态同步暂时中断/);
assert.match(interruptedReference, /已停止本地耗时计数/);
assert.doesNotMatch(interruptedReference, /data-reference-retry/);
assert.match(briefModule.referenceProgress({ analysis_id: 'done', status: 'completed', progress: 90, analysis_valid: true }), /aria-valuenow="100"/);
const invalidCompletedProgress = briefModule.referenceProgress({
  analysis_id: 'done-invalid', status: 'completed', progress: 100, analysis_valid: false,
  phase: '深度理解报告已就绪',
});
assert.match(invalidCompletedProgress, /视频画面已保存，内容整理未通过/);
assert.match(invalidCompletedProgress, /原视频和已校验画面都已保留/);
assert.match(invalidCompletedProgress, /重新识别当前视频/);
assert.match(invalidCompletedProgress, /data-reference-retry/);
assert.match(invalidCompletedProgress, /内容整理未通过完整性检查/);
assert.doesNotMatch(invalidCompletedProgress, /role="progressbar"/);
assert.doesNotMatch(invalidCompletedProgress, /深度理解报告已就绪。请核对/);
const partialFailureProgress = briefModule.referenceProgress({
  analysis_id: 'partial-failure', status: 'failed',
  error: '备用模型访问量过大',
  evidence_batch_progress: { total: 5, completed: 4, remaining: 1, failed: 1 },
  retry_after_ms: 300000,
});
assert.match(partialFailureProgress, /已完成 4\/5 批/);
assert.match(partialFailureProgress, /剩余 1 批/);
assert.match(partialFailureProgress, /继续读取缺失镜头（4\/5 批）/);
assert.match(partialFailureProgress, /系统当前处理较忙，建议约 5 分钟后再继续/);
assert.doesNotMatch(partialFailureProgress, /备用模型|访问量过大/);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(briefModule.referenceActionState({ analysis_id: 'done', status: 'completed', analysis_valid: true }))),
  { blocked: false, label: '下一步：生成剧情与对白' },
  '有效完成态必须立即开放剧情生成',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(briefModule.referenceActionState({ analysis_id: 'running', status: 'running', analysis_valid: false }))),
  { blocked: true, label: '等待参考视频分析完成' },
  '运行态仍必须阻止提前进入剧情生成',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(briefModule.referenceActionState({ analysis_id: 'invalid', status: 'completed', analysis_valid: false }))),
  { blocked: true, label: '分析结果不完整，请重试' },
  '100% 但语义校验无效时必须显示准确原因，不能伪装为仍在运行',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(briefModule.referenceActionState({ analysis_id: 'failed', status: 'failed' }))),
  { blocked: true, label: '参考视频分析失败，请重试' },
  '失败态必须保留质量门禁并提供准确行动提示',
);
const liveActionButton = { disabled: true, textContent: '等待参考视频分析完成' };
briefModule.syncReferenceAction(liveActionButton, {
  analysis_id: 'done-live', status: 'completed', analysis_valid: true,
});
assert.deepStrictEqual(
  liveActionButton,
  { disabled: false, textContent: '下一步：生成剧情与对白' },
  '分析从运行态实时切换到有效完成态时，现有 DOM 按钮必须立即启用且同步文案',
);
briefModule.syncReferenceAction(liveActionButton, {
  analysis_id: 'replacement-running', status: 'running', analysis_valid: false,
});
assert.deepStrictEqual(
  liveActionButton,
  { disabled: true, textContent: '等待参考视频分析完成' },
  '更换新来源后，同一按钮必须重新进入等待态，禁止复用旧完成状态',
);
const failedReference = briefModule.referenceProgress({
  analysis_id: 'failed', status: 'failed',
  error: '参考视频识别结果不完整：场景位置重复',
});
assert.match(failedReference, /这次参考视频没有完整读完/);
assert.doesNotMatch(failedReference, /场景位置重复/);
assert.match(failedReference, /data-reference-retry/);
assert.match(failedReference, /重新读取镜头证据/);
assert.match(briefModule.referenceProgress({
  analysis_id: 'failed-reusable', status: 'failed', visual_evidence_reusable: true,
}), />重新整理内容<\/button>/);
const semanticFailureProgress = briefModule.referenceProgress({
  analysis_id: 'failed-semantic-contracts', status: 'failed', progress: 82, visual_evidence_reusable: true,
  evidence_batch_progress: { total: 8, completed: 8, remaining: 0, failed: 0 },
  semantic_contract_progress: {
    total: 5, completed: 4, missing_contracts: ['scenes'],
    contracts: {
      story: { complete: true }, timeline: { complete: true }, cast: { complete: true },
      scenes: { complete: false, failures: ['scene_semantics_incomplete'] }, brand_audio: { complete: true },
    },
  },
});
assert.doesNotMatch(semanticFailureProgress, /82%/);
assert.match(semanticFailureProgress, /镜头画面已完成 8\/8 批/);
assert.match(semanticFailureProgress, /内容整理已完成 4\/5 项/);
assert.match(semanticFailureProgress, /视频画面已保存，内容整理未完成/);
assert.match(semanticFailureProgress, /镜头证据<\/b><small>8\/8 批已完整保留/);
assert.match(semanticFailureProgress, /内容主线<\/b><small>已完成并保留/);
assert.match(semanticFailureProgress, /场景安排<\/b><small>待定向补齐/);
assert.match(semanticFailureProgress, /不会重新读取，只补未完成的内容整理/);
assert.doesNotMatch(semanticFailureProgress, /重新读取镜头证据/);
const completedEvidenceWithStaleFlag = briefModule.referenceProgress({
  analysis_id: 'failed-semantic-stale-flag', status: 'failed', progress: 55, visual_evidence_reusable: false,
  evidence_batch_progress: { total: 8, completed: 8, remaining: 0, failed: 0 },
  semantic_contract_progress: { total: 5, completed: 3, missing_contracts: ['cast', 'scenes'] },
});
assert.match(completedEvidenceWithStaleFlag, />重新整理内容<\/button>/);
assert.doesNotMatch(completedEvidenceWithStaleFlag, /重新读取镜头证据/);
assert.match(briefModule.referenceProgress({
  analysis_id: 'failed-semantic-reusable', status: 'failed', visual_evidence_reusable: true, semantic_result_reusable: true,
}), /复用已保留结果重新校验/);
[
  ['semantic-invalid', '参考视频识别结果不完整：场景证据重复'],
  ['coverage-invalid', '逐帧镜头证据覆盖不完整'],
  ['shot-detection-failed', '参考视频镜头边界检测失败'],
  ['provider-unavailable', '视觉分析模型当前不可用'],
  ['link-import-failed', '参考链接视频读取失败'],
].forEach(([analysisId, error]) => {
  const rendered = briefModule.referenceProgress({
    analysis_id: analysisId,
    status: 'failed',
    error,
    visual_evidence_reusable: false,
  });
  assert.match(rendered, /data-reference-retry/, `所有失败任务都必须提供重试入口：${analysisId}`);
  assert.match(rendered, /重新读取镜头证据/, `证据不可复用时必须重新识别：${analysisId}`);
  assert.doesNotMatch(rendered, new RegExp(error), `默认失败卡不得直接暴露内部错误原文：${analysisId}`);
});
['importing', 'uploaded', 'queued', 'running', 'cancelling'].forEach(status => {
  assert.doesNotMatch(
    briefModule.referenceProgress({ analysis_id: `non-failed-${status}`, status }),
    /data-reference-retry/,
    `非失败任务不得暴露重复提交入口：${status}`,
  );
});
assert.doesNotMatch(
  briefModule.referenceProgress({ analysis_id: 'valid-completed', status: 'completed', analysis_valid: true }),
  /data-reference-retry/,
  '已通过质量门的完成任务不得暴露重复付费入口',
);
assert.match(
  briefModule.referenceProgress({ analysis_id: 'cancelled-current', status: 'cancelled' }),
  /重新识别当前视频/,
  '取消后原视频仍在时必须允许用户直接重新识别',
);
const extendedConfirmationCard = briefModule.referenceProgress({
  analysis_id: 'extended-42',
  status: 'failed',
  error_code: 'REFERENCE_VIDEO_EXTENDED_ANALYSIS_CONFIRMATION_REQUIRED',
  analysis_preflight: { segment_count: 42, batch_count: 11, extra_batch_count: 1 },
});
assert.match(extendedConfirmationCard, /等待确认分批读取/);
assert.match(extendedConfirmationCard, /确认分批分析（11 批）/);
assert.match(extendedConfirmationCard, /尚未启动任何收费分析/);
assert.match(briefView, /bindBriefReferenceRecovery\(host, \{ store, context \}\)/,
  '目标页必须绑定独立参考恢复控制器，避免主视图再次超过结构上限');
assert.match(briefReferenceRecovery, /可能产生新的模型费用/, '证据不完整时必须在确认框明确提醒会重新调用视觉模型');
assert.match(briefReferenceRecovery, /extended_analysis_confirmed:\s*true[\s\S]*preflight_fingerprint:/,
  '扩展分析确认必须连同服务端预检指纹提交，不能只信任客户端片段数量');
assert.match(briefReferenceRecovery, /store\.retryReferenceAnalysis\(\{\s*acknowledge_billing_unknown:\s*billingUnknown\s*\}\)/,
  '失败卡必须复用同一分析 ID，并仅在计费未知时携带用户确认，不能更换视频或静默重复调用');
assert.match(briefReferenceRecovery, /无需更换或重新上传|不需要更换或重新上传/, '质量无效完成态必须明确告知用户保留当前视频');
assert.doesNotMatch(briefReferenceRecovery, /store\.getState\(\)/, '重试按钮不得调用 Store 未公开的 getState 接口');
assert.match(briefReferenceRecovery, /const currentReference = store\.state\.bundle\?\.reference \|\| \{\};[\s\S]*currentReference\.visual_evidence_reusable/, '重试按钮必须从 Store 公开 state 读取当前任务证据状态');
assert.match(briefReferenceRecovery, /removeEventListener\('click', handleReferenceRetry\)/, '离开页面必须注销重试事件，避免重复提交');
assert.match(briefReferenceRecovery, /referenceRetryPending \|\| button\.disabled/, '确认框打开与请求提交期间必须阻止重复点击');
assert.match(briefReferenceRecovery, /referenceRetryPending = true;[\s\S]*setButtonBusy\(button, true, '正在确认…'\)/, '防重入锁必须在打开确认框前立即生效');

const projectStore = read('public/story-ad/store/projectStore.js');
assert.match(projectStore, /let requestMutationChain = Promise\.resolve\(\);/, '内容保存必须通过单一串行队列避免同一客户端并发版本冲突');
assert.match(projectStore, /requestMutationChain\.then\(execute, execute\)/, '内容保存队列必须在前一笔结束后才读取最新版本并提交');
assert.match(projectStore, /content_mode: context\.content_mode/, '保存响应必须立即回写内容类型，不能等待后续刷新修正客户端状态');
assert.match(projectStore, /function applyMutationResult\(data = \{\}\)/, '所有写接口必须先采用服务端返回的权威版本和规范化内容');
assert.match(projectStore, /async function updateRequest[\s\S]*applyMutationResult\(data\)[\s\S]*refreshSections\('summary'\)/, '目标或完成状态保存后必须局部合并导航，不能重载大包或丢失下游草稿');
assert.match(projectStore, /async function saveBlueprint[\s\S]*applyMutationResult\(data\)[\s\S]*refreshSections\('summary'\)/, '保存剧情后必须采用服务端最新内容版本再进入下一环节');
assert.match(projectStore, /async function saveStoryboard[\s\S]*applyMutationResult\(data\)[\s\S]*refreshSections\('summary'\)/, '保存分镜后必须采用服务端最新内容版本再确认镜头设计');
assert.match(projectStore, /path === 'scene-config'[\s\S]*refreshSections\('summary,assets'\)/, '资产方案创建完成后必须刷新真实资产规划再进入资产中心');
assert.match(projectStore, /tasks\/\$\{encodeURIComponent\(taskId\)\}\/blueprint[\s\S]*timeoutMs:\s*120000/, '大项目剧情保存不得沿用普通请求的 30 秒上限');
assert.match(projectStore, /tasks\/\$\{encodeURIComponent\(taskId\)\}\/storyboard[\s\S]*timeoutMs:\s*120000/, '大项目分镜保存不得沿用普通请求的 30 秒上限');
['animal_prompts', 'animal_actions', 'shot_breakdown'].forEach(field => (
  assert.match(projectStore, new RegExp(field), `参考分析绑定必须保留 ${field}`)
));
assert.match(projectStore, /status[^\n]*=== 'uploaded'[\s\S]*\/start/, '公开链接读取完成后必须显式启动分析');
assert.match(projectStore, /state\.referenceAnalysisId !== analysisId/, '迟到的旧参考响应不得覆盖当前分析');
assert.match(projectStore, /async function addReferenceLink[\s\S]*beginReferenceReplacement\(state, set, stopReferencePolling[\s\S]*request\('\/api\/new-story-ad\/reference-video-links'/, '粘贴新链接必须先撤下旧的完成卡片，再等待后端创建记录');
assert.match(projectStore, /async function uploadReference[\s\S]*beginReferenceReplacement\(state, set, stopReferencePolling[\s\S]*uploadReferenceVideo/, '更换本地视频也必须立即显示新任务状态');
assert.match(projectStore, /if \(!replacementCurrent\(state, replacement\)\) return data\.analysis/, '迟到的新建链接响应不得抢回已经再次更换的来源');
assert.match(projectStore, /if \(!data\.task_bound\) await bindReferenceAnalysis/, '服务端已绑定的新来源不得由浏览器重复写入一次');
assert.match(projectStore, /created\.task_mutation[\s\S]*applyMutationResult\(created\.task_mutation\)/, '本地参考视频绑定后必须立即采用服务端返回的内容版本');
assert.match(projectStore, /data\.task_mutation[\s\S]*applyMutationResult\(data\.task_mutation\)/, '参考链接绑定后必须立即采用服务端返回的内容版本');
assert.doesNotMatch(projectStore, /async function retryReferenceAnalysis\(\)[\s\S]*?await bindReferenceAnalysis[\s\S]*?function referenceTaskRecord/, 'reanalysis acknowledgement must not trigger a duplicate browser binding');
assert.doesNotMatch(projectStore, /function syncReferencePolling[\s\S]*?bindReferenceAnalysis[\s\S]*?function clearProject/, 'polling must remain read-only because the server owns task projection');
assert.match(projectStore, /referenceSyncInterrupted\(currentReference, error, interruptedAt\)/, 'polling interruption must freeze elapsed time while automatic reconnect continues');
const referenceReplacementState = read('public/story-ad/store/referenceReplacementState.js');
const storyAdStyles = read('public/story-ad/styles.css');
assert.match(storyAdStyles, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.btn:not\(:disabled\):hover[\s\S]*transform: translateY\(-2px\)/, '可点击按钮必须提供明显且仅限精确指针的悬停位移');
assert.match(storyAdStyles, /\.btn\.primary:not\(:disabled\):hover[\s\S]*box-shadow: 0 10px 26px/, '主操作悬停必须提供高对比阴影和颜色反馈');
assert.match(storyAdStyles, /\.btn\[aria-busy="true"\][\s\S]*opacity: 1[\s\S]*cursor: progress/, '执行中按钮必须保持突出并明确显示进度指针');
assert.match(storyAdStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transform: none/, '明显交互动效必须尊重减少动态效果设置');
assert.match(referenceReplacementState, /client_pending_reference_\$\{token\}/, '后端返回分析 ID 前必须使用仅限内存的替换占位状态');
assert.match(referenceReplacementState, /replacement\?\.token === state\.referenceReplacementSeq/, '来源替换状态必须用单调序号阻止乱序覆盖');
assert.match(referenceReplacementState, /function beginReferenceRetry[\s\S]*phase:\s*'重新识别请求已提交，正在等待服务器受理'/, '重新识别必须立即投影 1% 受理态');
assert.match(referenceReplacementState, /function restoreReferenceRetry[\s\S]*reference:\s*previousReference/, '重新识别提交失败必须恢复旧权威状态');
assert.match(projectStore, /progress:\s*Math\.max\(0, Math\.min\(100/, '参考分析绑定必须保留真实进度');
assert.match(projectStore, /phase:\s*String\(analysis\.phase/, '参考分析绑定必须保留后端阶段说明');
assert.match(projectStore, /applyReferenceLiveState\(analysis\)/, '同一状态内的轮询进度必须立即合并到界面状态');
assert.match(projectStore, /async function hydrateReferenceFailure\(\)/, '历史失败任务必须从权威分析记录补回中文错误原因');
assert.match(projectStore, /live\.error\.message \|\| live\.error\.code/, '实时失败状态必须优先展示中文错误信息而不是内部代码');
assert.match(projectStore, /async function retryReferenceAnalysis\(\)/, '参考分析失败后必须提供同一 ID 的缓存重试能力');
assert.match(projectStore, /extended_analysis_confirmed:\s*options\.extended_analysis_confirmed === true[\s\S]*preflight_fingerprint:/,
  '同一分析 ID 的重试接口必须传递扩展费用确认和预检指纹');
assert.match(projectStore, /beginReferenceRetry\(state, set\)[\s\S]*request\(`\/api\/new-story-ad\/reference-video-analyses/, '点击重新识别后必须先显示本地受理状态，不能等待网络响应');
assert.match(projectStore, /catch \(error\)[\s\S]*restoreReferenceRetry\(state, set, previousReference, error\)/, '重新识别请求失败时必须恢复权威旧状态');
assert.match(projectStore, /reference-video-analyses\/\$\{encodeURIComponent\(analysisId\)\}\/reanalyze/, '重新识别必须调用专用接口，不能被 completed 幂等门静默吞掉');
assert.match(projectStore, /visual_evidence_reusable:\s*analysis\.visual_evidence_reusable === true/, '界面只能按后端逐帧覆盖结论决定是否复用证据');
assert.match(projectStore, /evidence_batch_progress:\s*analysis\.evidence_batch_progress/, '失败恢复必须把已完成批次投影到页面，不能误导为全部重读');
assert.match(projectStore, /refreshSections\('all'\)/, '终态分析采用后必须刷新完整工作区投影');
assert.match(projectStore, /brief_source:\s*'reference_analysis'/, '参考分析完成后必须标记广告目标来源，防止旧表单覆盖');
assert.match(projectStore, /removeReference:\s*\(\) => removeProjectReference/, '项目 Store 必须公开统一参考解绑能力');
assert.match(referenceReplacementState, /tasks\/\$\{encodeURIComponent\(taskId\)\}\/reference-video[\s\S]*method:\s*'DELETE'/, '移除符号必须调用项目级解绑接口，不能只隐藏卡片');
assert.match(referenceReplacementState, /timeoutMs:\s*120000/, '移除参考视频必须等待大体积 JSON 项目的权威提交结果，避免前端超时后重复删除');

const briefViewSource = read('public/story-ad/views/briefView.js');
assert.match(briefViewSource, /if \(assetPlanTransitioning\) return false;\s*assetPlanTransitioning = true;/, '创建方案防重复锁必须在任何异步确认之前设置');
assert.match(briefMaterials, /class="material-remove"[\s\S]*data-reference-remove[\s\S]*aria-label="移除参考视频"/, '已连接参考视频旁必须显示无文字的删除符号');
assert.match(briefViewSource, /data-reference-remove[\s\S]*store\.removeReference\(\)[\s\S]*refreshShell\(\)/, '删除符号必须完成服务端解绑并重新渲染 AI 帮写入口');

const referenceDetachService = read('src/services/newStoryAd/referenceDetachService.js');
assert.match(referenceDetachService, /brief_source === 'reference_analysis'[\s\S]*brief:\s*''/, '只清空参考分析自动填写的目标，不得误删用户手写目标');
assert.match(referenceDetachService, /filter\(item => !projected\(item\)\)/, '解绑只清理由参考投影的草稿，必须保留用户自建材料');
assert.match(referenceDetachService, /ACTIVE_STATUSES[\s\S]*referenceVideoAnalyses\.cancel/, '移除正在分析的参考时必须停止后台分析');
assert.match(referenceDetachService, /function buildReanalysisPatch[\s\S]*reference_video_analysis:\s*reference/, '重新识别必须保留当前视频绑定并撤下旧投影');
const releaseDeploySource = collectStoryAdReleaseFiles({ root }).join('\n');
assert.match(releaseDeploySource, /src\/services\/newStoryAd\/referenceDetachService\.js/, '生产发布清单必须包含重新识别使用的项目清理服务');

const newStoryAdRoute = read('src/routes/newStoryAd.js');
assert.match(newStoryAdRoute, /extendedAnalysisConfirmed:\s*req\.body\?\.extended_analysis_confirmed === true[\s\S]*preflightFingerprint:/,
  '启动与重新识别接口必须把扩展分析确认交给服务层校验');
assert.match(newStoryAdRoute, /analysis\.task_sync\?\.status !== 'synced'/, '已经由服务端同步成功的终态轮询必须保持只读');
assert.match(newStoryAdRoute, /function bindInitialReferenceTask[\s\S]*referenceVideoAnalyses\.taskRecord/, '参考来源创建后必须在接口返回前绑定当前任务');
assert.match(newStoryAdRoute, /reference-video-links[\s\S]*task_bound:\s*Boolean\(taskMutation\)/, '链接创建接口必须明确返回服务端绑定结果');
assert.match(newStoryAdRoute, /task_bound:\s*Boolean\(taskMutation\),\s*task_mutation:\s*taskMutation/, '参考来源接口必须返回完整任务变更回执，不能只返回布尔绑定状态');

const referenceAnalysisService = read('src/services/newStoryAd/referenceVideoAnalysisService.js');
assert.match(referenceAnalysisService, /task_id:\s*requestedTaskId\(body\)/, '参考分析记录必须保存所属任务 ID');
assert.match(referenceAnalysisService, /if \(record\.task_id\)[\s\S]*promise\.then[\s\S]*start\(id, \{ id: userId \}\)/, '任务绑定的链接读取完成后必须由服务端自动开始分析');
assert.match(referenceAnalysisService, /function evidenceBatchProgress\([\s\S]*remaining:[\s\S]*total - completed/, '参考分析必须公开安全的批次恢复进度，但不能公开模型原文');

const appWorkflowSource = read('public/story-ad/app.js');
const projectCenterFiltersSource = read('public/story-ad/projectCenterFilters.js');
assert.match(appWorkflowSource, /projectModeView\(project\)/, '项目列表必须读取内容类型并显示广告或剧情');
assert.match(appWorkflowSource, /commercial_subject[\s\S]*label: '广告'/, '广告任务必须显示明确的广告标识');
assert.match(appWorkflowSource, /<span>项目名称<\/span><span>任务类型<\/span>/, '项目名称和任务类型必须是两个独立列表字段');
assert.match(appWorkflowSource, /data-project-name-filter/, '任务中心必须提供任务名称查询条件');
assert.match(appWorkflowSource, /data-project-type-filter[\s\S]*narrative_story[\s\S]*commercial_subject[\s\S]*unset/, '任务类型查询必须覆盖全部、剧情、广告和未选择');
assert.match(appWorkflowSource, /data-project-stage-filter[\s\S]*stageOptions/, '任务中心必须提供默认全部且可选择现有阶段的查询条件');
assert.match(projectCenterFiltersSource, /taskName[\s\S]*taskType[\s\S]*query\.stage/, '三个查询条件必须共同生效');
assert.match(projectCenterFiltersSource, /function applyProjectVisibility[\s\S]*row\.hidden/, '输入查询时只能切换项目行显示状态，不能重建输入控件');
assert.match(appWorkflowSource, /import\('\.\/projectCenterFilters\.js/, '查询执行逻辑必须在用户操作时按需加载，不能增加首屏体积');
assert.match(storyAdStyles, /\.project-table \[hidden\]\s*\{\s*display:\s*none/, '查询隐藏行不得被表格网格 display 规则重新显示');
assert.match(appWorkflowSource, /subject_assets \?\? counts\.assets/, '人物资产步骤不得继续混用场景资产总数');
assert.match(appWorkflowSource, /scene: counts\.scenes/, '场景步骤必须使用独立场景计数');
assert.match(appWorkflowSource, /state\.enabled === false \? 'is-locked'/, '未满足前置条件的环节必须显示锁定态');
assert.match(appWorkflowSource, /aria-disabled="\$\{state\.enabled === false/, '锁定态必须提供无障碍语义');
assert.match(appWorkflowSource, /if \(step\?\.enabled === false\)[\s\S]*请先完成上一个制作环节/, '侧栏点击不得越过未完成环节');
assert.match(appWorkflowSource, /if \(!route\.isNew && routeStep\?\.enabled === false\)/, '直接输入后续页面地址时也必须执行同一门禁');
assert.match(appWorkflowSource, /state\.completed \? '✓' : number/, '完成的环节必须提供明确完成标记');

const personLookModule = loadBrowserModule(
  'public/story-ad/views/assetCenterPersonLooks.js',
  ['renderPersonLookEditors', 'renderPersonLookTiles', 'collectPersonLookValues', 'bindPersonLookForm'],
  { escapeHtml },
);
const assetDossierModule = loadBrowserModule(
  'public/story-ad/views/assetCenterDossierSections.js',
  ['mediaSection', 'legacyDossierBoard'],
  { escapeHtml, mediaPreview },
);
const assetPersonStateModule = loadBrowserModule(
  'public/story-ad/views/assetCenterPersonState.js',
  ['personAgeDisplay', 'personAssetState', 'personLookSummary', 'assertSavedPerson'],
);
const sceneDossierModule = loadBrowserModule(
  'public/story-ad/views/sceneDossierCard.js',
  ['assetCardMedia', 'sceneNeedsGeneration', 'normalizeSceneDossier', 'renderSceneDossierCard'],
  { escapeHtml, mediaPreview, setButtonBusy() {}, toast() {} },
);
const assetModule = loadBrowserModule(
  'public/story-ad/views/assetCenterView.js',
  ['assetCard', 'personAssetState', 'subjectNeedsGeneration', 'sceneNeedsGeneration', 'subjectGenerationPayload', 'profileDetails'],
  { escapeHtml, mediaPreview, ...personLookModule, ...assetDossierModule, ...assetPersonStateModule, ...sceneDossierModule, renderPersonEvolutionSummary() { return ''; }, renderPersonEvolutionEditor() { return ''; }, bindPersonEvolutionForm() {}, collectPersonEvolutionValues() { return {}; }, request() { throw new Error('UI render test must not call request'); }, confirmDialog() { return false; } },
);
const personFormModule = loadBrowserModule(
  'public/story-ad/views/assetCenterPersonForm.js',
  ['personEditForm'],
  { escapeHtml, ...personLookModule, ...assetPersonStateModule, renderPersonEvolutionEditor() { return ''; } },
);
const uiModule = loadBrowserModule(
  'public/story-ad/components/ui.js',
  ['generationProgressPanel', 'generationProgressView'],
);
const planningModule = loadBrowserModule(
  'public/story-ad/views/assetCenterPlanningDetails.js',
  ['sceneDetails'],
  {
    escapeHtml,
    mediaPreview,
    bindMediaLightbox() {},
    personDossierShowcase() { return ''; },
    renderSceneDossierCard: sceneDossierModule.renderSceneDossierCard,
    bindPersonLookForm: personLookModule.bindPersonLookForm,
  },
);
const planningStatusSource = read('public/story-ad/views/assetCenterPlanningDetailsStatus.js')
  + read('public/story-ad/views/assetCenterPlanReleaseStatus.js');
const scenePlanningStatusSource = read('public/story-ad/views/scenePlanStatus.js');
const dossierModule = loadBrowserModule(
  'public/story-ad/views/personDossierShowcase.js',
  ['personDossierShowcase'],
  { escapeHtml, mediaPreview },
);
assert.match(assets, /data-confirm-assets/);
assert.doesNotMatch(assets, /asset-missing-strip/, '空分类不能被前端猜测为合同缺失；必需项只由版本合同判定');
assert.match(assets, /先完善剧情所需的人物、动物或场景/, '纯剧情空状态不得提示商品或 LOGO');
assert.doesNotMatch(assetPlanStageStatus, /商品|场景方案/, '纯剧情人物步骤不得要求核对商品或混入场景流程');
assert.doesNotMatch(assets, /版本合同未通过|Active Plan|合同通过后/, '普通用户界面不得暴露内部版本合同术语');
assert.match(planningStatusSource, /人物方案/, '人物页必须显示独立的人物方案状态');
assert.match(scenePlanningStatusSource, /场景方案/, '场景页必须显示独立的场景方案状态');
assert.match(planningStatusSource, /已确认剧情和现有人物资产补全详细人物方案/, '人物方案必须明确使用已确认剧情和现有人物资产');
assert.match(scenePlanningStatusSource, /不修改人物身份、人物图片和人物造型/, '场景方案更新必须明确保护人物资产');
assert.match(planningStatusSource, /继续生成缺失的人物图片/, '人物方案动作必须真实串联缺失人物图片生成');
assert.match(assets, /generationActive/, '资产中心必须统一读取当前生成状态');
assert.match(planningStatusSource, /正在生成人物方案/, '人物方案运行中必须显示准确名称和进行中状态');
assert.match(scenePlanningStatusSource, /正在更新场景方案/, '场景方案运行中必须显示准确名称和进行中状态');
assert.match(planningStatusSource, /data-update-person-plan/, '人物方案必须使用独立提交入口');
assert.match(scenePlanningStatusSource, /data-update-scene-plan/, '场景方案必须使用独立提交入口');
assert.match(assets, /data-select-person \$\{generationDisabled\}/, '后台生成运行中不得继续选择或替换人物素材');
assert.doesNotMatch(planningStatusSource, /文字方案确认后，再单独生成图片|人物方案需要更新|status-tag/, '人物方案不得保留旧两步式提示或冗余状态标签');
const blockedVisualFailure = {
  project: { status: 'failed', error_code: 'GENERATION_BILLING_STATE_UNKNOWN', error: '计费状态尚未确认' },
  navigation: { asset_plan_eligibility: { eligible: false } },
  generation: { progress: { stage: 'visual_assets', status: 'failed', billing_state: 'unknown', lanes: {} } },
};
const planningFailure = uiModule.generationProgressView({
  project: { status: 'failed', stage: 'scene_config_failed', error: 'provider failed' },
  generation: { progress: { stage: 'scene_config', status: 'failed' } },
});
assert.equal(planningFailure.failureTitle, '人物与场景方案更新失败');
assert.match(planningFailure.liveText, /更新方案/);
assert.doesNotMatch(planningFailure.liveText + planningFailure.message, /从缺失项继续|场景规划/, '统一方案失败不得错误引导用户继续缺失图片');
const blueprintQualityFailure = uiModule.generationProgressView({
  project: {
    status: 'failed', stage: 'blueprint_failed', error_code: 'BLUEPRINT_POLISH_QUALITY_FAILED',
    error: '支持编号：qa-blueprint。精品剧本精修后仍未通过质量门槛：台词总信息量不足：60 秒至少约 144 个有效字，当前 116 个；台词句式重复：多镜重复以“社区”开头',
  },
  generation: { progress: { stage: 'blueprint', status: 'failed', error_code: 'BLUEPRINT_POLISH_QUALITY_FAILED' } },
});
assert.equal(blueprintQualityFailure.failureTitle, '脚本初稿需要调整');
assert.match(blueprintQualityFailure.liveText, /脚本初稿已保存/);
assert.match(blueprintQualityFailure.message, /相同开头“社区”/);
assert.doesNotMatch(blueprintQualityFailure.message, /116|144|建议至少|有效字/);
assert.doesNotMatch(blueprintQualityFailure.message, /支持编号|精品剧本精修|BLUEPRINT/,
  '蓝图失败必须展示用户可理解的具体原因，不得暴露内部阶段或支持编号');
const outsideAssetsRecovery = uiModule.generationProgressPanel(blockedVisualFailure, 'brief');
assert.equal(outsideAssetsRecovery, '', '人物资产告警不得跨步骤污染立项页');
const insideAssetsRecovery = uiModule.generationProgressPanel(blockedVisualFailure, 'assets');
assert.doesNotMatch(insideAssetsRecovery, /data-view="assets"/, '已在资产中心时不得重复显示无效跳转');
assert.doesNotMatch(assets, /付费生成已锁定/, '不得向用户暴露内部付费熔断措辞');
assert.doesNotMatch(assets, /当前没有通过本版本合同的 Active Plan/, '不得向用户暴露 Active Plan 内部术语');
assert.match(assets, /asset_setup_confirmed:\s*true/);
assert.match(assets, /view=scene/, '人物资产确认后必须进入独立场景流程');
assert.match(assetPlanStageStatus, /asset-visual-next-step/, '进入人物资产步骤后必须明确展示人物视觉生成的下一步');
assert.match(assetPlanStageStatus, /系统将使用完整人物资产生成当前缺失的/, '必须明确人物图片使用完整资产并只生成缺失项');
assert.match(assetPlanStageStatus, /data-generate-missing-subjects/, '必须提供通用的缺失人物和动物生成入口');
assert.doesNotMatch(assets, /data-show-pending-scenes/, '人物资产步骤不得继续混入待生成场景入口');
assert.match(sceneWorldPage, /data-generate-base-scene/, '独立场景步骤必须提供逐场景生成入口');
assert.equal(assetModule.sceneNeedsGeneration({ id: 'scene-missing' }), true);
assert.equal(assetModule.sceneNeedsGeneration({ id: 'scene-ready', layout: { image_url: '/scene.png' } }), false);
const legacyPerson = {
  id: 'legacy-person', kind: 'person', name: '历史人物', status: 'verified', role: '体验者',
  view_images: ['front', 'side', 'back', 'action'].map(key => ({ key, image_url: `/${key}.png` })),
};
assert.equal(assetModule.personAssetState(legacyPerson), 'legacy_views');
assert.equal(assetModule.subjectNeedsGeneration({ ...legacyPerson, kind: '' }, 'human'), true, '人物是否需生成不得依赖 item.kind');
assert.equal(assetModule.subjectNeedsGeneration({ ...legacyPerson, kind: '' }, 'pet'), false, '动物四视图仍属于已生成，不得套用人物 dossier 规则');
const legacyCard = assetModule.assetCard(legacyPerson, 'people');
assert.match(legacyCard, /历史四视图/);
assert.match(legacyCard, /生成完整人物档案/);
assert.match(legacyCard, /data-generate-asset="legacy-person"/);

const legacyDossierPerson = { ...legacyPerson, dossier_sheet: { image_url: '/legacy-dossier.png' } };
assert.equal(assetModule.personAssetState(legacyDossierPerson), 'upgrade_required', '旧档案图没有独立证据合同版本时必须进入升级队列');
assert.equal(assetModule.subjectNeedsGeneration(legacyDossierPerson, 'human'), true, '旧档案必须进入批量升级目标');
const completePerson = { ...legacyPerson, visual_asset_contract_version: 2, dossier_sheet: { image_url: '/dossier.png' } };
assert.equal(assetModule.personAssetState(completePerson), 'complete_dossier');
const generatedProfile = { displayName: '凌光', roleName: '男主角', age: '18岁', age_contract: { value: '18岁' }, appearanceText: '面容清俊', negativeText: '', look_profiles: [] };
assert.equal(assetModule.personAssetState({ ...completePerson, visual_medium: 'live_action', profile: { ...generatedProfile, visual_medium: 'live_action' }, generated_profile: generatedProfile }), 'complete_dossier');
assert.equal(assetModule.personAssetState({ ...completePerson, visual_medium: 'live_action', profile: { ...generatedProfile, age: '18~25岁', age_contract: { value: '18~25岁' }, visual_medium: 'live_action' }, generated_profile: generatedProfile }), 'profile_upgrade_required', '年龄区间更新后旧人物档案必须失效');
assert.equal(assetModule.personAssetState({ ...completePerson, visual_medium: 'live_action', profile: { ...generatedProfile, visual_medium: 'anime_2d' }, generated_profile: generatedProfile }), 'medium_upgrade_required', '项目画面形态更新后旧真人档案必须失效');
const completeCard = assetModule.assetCard(completePerson, 'people');
assert.match(completeCard, /完整档案/);
assert.match(completeCard, /重生成完整人物档案/);
assert.doesNotMatch(completeCard, /重生成高清服装与配饰档案/);
assert.match(completeCard, /data-generate-asset="legacy-person"/);
const readableProfile = { ...completePerson, profile: { displayName: '苏晚', roleName: '美学策展人', age: 'match_brief', appearanceText: '年龄约28岁，东方古典气质的现代女性' } };
const personEdit = personFormModule.personEditForm(readableProfile);
assert.match(personEdit, /name="age"/u, '人物编辑区必须提供确切年龄或区间的独立权威字段');
assert.doesNotMatch(personEdit, /value="match_brief"/u, '人物编辑区不得暴露内部年龄枚举');
assert.match(personEdit, /确切年龄或年龄区间/u);
assert.match(personEdit, /外貌与气质（年龄请填写在上方独立字段）/u);
assert.match(personEdit, /年龄约28岁/);
const personProfileDetails = assetModule.profileDetails(readableProfile, 'people');
assert.doesNotMatch(personProfileDetails, /年龄范围|match_brief/);
assert.match(personProfileDetails, /外貌与气质/);
const multiLookProfile = { ...readableProfile, profile: { ...readableProfile.profile, look_profiles: [
  { id: 'ancient', name: '古代造型', scene_names: ['竹海庭院'], wardrobeText: '淡青宋式长衫' },
  { id: 'modern', name: '现代造型', scene_names: ['金属展厅'], wardrobeText: '米白亚麻衬衫与长裤' },
] } };
const multiLookEdit = personFormModule.personEditForm(multiLookProfile);
assert.match(multiLookEdit, /2 套/);
assert.match(multiLookEdit, /古代造型/);
assert.match(multiLookEdit, /现代造型/);
assert.match(assetModule.assetCard(multiLookProfile, 'people'), /person-look-tiles/);
assert.match(assetModule.assetCard(multiLookProfile, 'people'), /古代造型/);
assert.match(assetModule.assetCard(multiLookProfile, 'people'), /现代造型/);
const collectedLooks = personLookModule.collectPersonLookValues({
  look_0_id: 'ancient', look_0_name: '古代造型', look_0_scene_ids: 'garden', look_0_wardrobeText: '淡青宋式长衫',
  look_1_id: 'modern', look_1_name: '现代造型', look_1_scene_ids: 'hall', look_1_wardrobeText: '米白亚麻衬衫与长裤',
}, multiLookProfile.profile);
assert.equal(collectedLooks.look_profiles.length, 2);
assert.equal(collectedLooks.wardrobeText, '淡青宋式长衫');
assert.equal(collectedLooks.age, 'match_brief', '年龄留空必须按服务器规范保存为按剧情分析，避免回读误报不一致');
assert.match(multiLookEdit, /适用场景 \/ 剧情状态/u);
const sameSceneAcrossEras = personFormModule.personEditForm({ ...readableProfile, profile: { ...readableProfile.profile, look_profiles: [
  { id: 'ancient-bamboo', name: '古代造型', story_state: '古代', scene_names: ['千年竹海'], wardrobeText: '古代长衫' },
  { id: 'modern-bamboo', name: '现代造型', story_state: '现代', scene_names: ['千年竹海'], wardrobeText: '现代衬衫' },
] } });
assert.match(sameSceneAcrossEras, /古代 · 千年竹海/u, '同一空间跨时代时必须显示古代剧情状态');
assert.match(sameSceneAcrossEras, /现代 · 千年竹海/u, '同一空间跨时代时必须显示现代剧情状态');
assert.doesNotThrow(() => assetPersonStateModule.assertSavedPerson({ assets: { people: [{ profile: {
  id: readableProfile.profile.id, age: 'match_brief', appearanceText: readableProfile.profile.appearanceText,
  look_profiles: collectedLooks.look_profiles,
} }] } }, readableProfile, { ...collectedLooks, age: '', appearanceText: readableProfile.profile.appearanceText }), '空年龄与服务器 match_brief 必须视为同一自动分析语义');
const dossierDetails = dossierModule.personDossierShowcase(readableProfile);
assert.doesNotMatch(dossierDetails, /match_brief/, '人物档案风格关键词不得泄漏内部年龄占位值');

const precisePayload = assetModule.subjectGenerationPayload({
  project: { id: 'precise-person-task' },
  brief: { text: '人物精确生成测试' },
  assets: {
    people: [
      { ...legacyPerson, id: 'selected-legacy', asset_id: 'selected-legacy', subject_id: 'person-selected', profile: { id: 'person-selected' } },
      { ...legacyPerson, id: 'unselected-legacy', asset_id: 'unselected-legacy', subject_id: 'person-unselected', profile: { id: 'person-unselected' } },
      { id: 'missing-person', asset_id: 'missing-person', subject_id: 'person-missing', view_images: [], profile: { id: 'person-missing' } },
    ],
    animals: [],
  },
}, { id: 'selected-legacy', asset_id: 'selected-legacy', subject_id: 'person-selected' }, 'request-1');
assert.deepEqual(Array.from(precisePayload.subject_targets, item => item.id), ['person-selected'], '单人物入口必须只提交当前主体；缺失整批由明确命名的批量入口处理');
const replannedPayload = assetModule.subjectGenerationPayload({
  project: { id: 'replanned-subject-task' }, brief: { text: '方案更新后同步人物' },
  assets: {
    people: [
      { ...legacyPerson, subject_id: 'retained-old-person', profile: { id: 'current-person' } },
      { ...legacyPerson, subject_id: 'retained-old-companion', profile: { id: 'current-companion' } },
    ],
    animals: [{ subject_id: 'retained-old-pet', profile: { id: 'current-pet' }, view_images: [] }],
  },
}, null, 'replanned-request');
assert.deepEqual(Array.from(replannedPayload.subject_targets, item => item.id), ['current-person', 'current-companion', 'current-pet'], '方案更新后批量生成必须使用本次提交的当前档案 ID，不得沿用保留资产的旧 subject_id');
const replannedSinglePayload = assetModule.subjectGenerationPayload({
  project: { id: 'replanned-single-task' }, brief: { text: '方案更新后单人同步' },
  assets: { people: [{ ...legacyPerson, subject_id: 'retained-old-person', profile: { id: 'current-person' } }], animals: [] },
}, { ...legacyPerson, subject_id: 'retained-old-person', profile: { id: 'current-person' } }, 'replanned-single-request');
assert.deepEqual(Array.from(replannedSinglePayload.subject_targets, item => item.id), ['current-person'], '方案更新后单人同步也必须与本次 cast_profiles 的 ID 一致');
const resumePayload = assetModule.subjectGenerationPayload({
  project: { id: 'resume-partial-task' }, brief: { text: '继续缺失人物' },
  assets: { people: [{ ...legacyPerson, subject_id: 'partial-person', profile: { id: 'partial-person' }, partial_checkpoint: true }], animals: [] },
}, null, 'resume-request');
assert.equal(resumePayload.resume_partial_checkpoint, true, '批量入口遇到部分成功检查点时必须进入只补缺失项模式');
assert.equal(resumePayload.regenerate_selected, false, '恢复部分检查点不得误标为重新生成并重复付费');
const sceneWorldPageSource = fs.readFileSync(path.join(__dirname, '../public/story-ad/views/sceneWorldPage.js'), 'utf8');
assert.match(sceneWorldPageSource, /request_key:\s*requestKey/, '单场景生成必须每次提交独立请求键，不得把同版本的不同场景误判为重复任务');
const newStoryAdRouteSource = fs.readFileSync(path.join(__dirname, '../src/routes/newStoryAd.js'), 'utf8');
assert.match(newStoryAdRouteSource, /body\.request_key\s*\|\|\s*body\.requestKey/, '排队幂等键必须承接界面 request_key');
assert.match(newStoryAdRouteSource, /body\.scene_id\s*\|\|\s*body\.sceneId\s*\|\|\s*body\.space_id/, '没有 request_key 时也必须把场景身份纳入幂等键');

const unverifiedProductCard = assetModule.assetCard({ id: 'product-1', name: '商品图', image_url: '/product.png', status: 'unverified' }, 'products');
assert.match(unverifiedProductCard, /data-verify-product="product-1"/);
assert.match(unverifiedProductCard, /验证商品素材/);
const verifiedProductCard = assetModule.assetCard({ id: 'product-1', name: '商品图', image_url: '/product.png', status: 'verified' }, 'products');
assert.doesNotMatch(verifiedProductCard, /data-verify-product=/);

const sceneWithCameraImage = planningModule.sceneDetails({
  name: '客厅',
  view_images: [{ key: 'cam-a', image_url: '/camera-a.png' }],
  cameras: [{ id: 'camera-a', view_id: 'cam-a', label: '低机位' }, { id: 'camera-b', view_id: 'cam-b', label: '备用机位' }],
});
assert.match(sceneWithCameraImage, /src="\/camera-a\.png"/);
assert.match(sceneWithCameraImage, /该机位图未生成/);
assert.match(sceneWithCameraImage, /scene-camera-card has-image/);
assert.match(sceneWithCameraImage, /scene-camera-card is-missing-image/);
assert.match(sceneWithCameraImage, /data-scene-dossier=/, '场景详情回归夹具必须覆盖完整场景档案渲染');

const generateFunction = assets.slice(assets.indexOf('const generate = async'), assets.indexOf("host.querySelectorAll('[data-asset-filter]"));
assert(generateFunction.indexOf('confirmBillingAwareAction') >= 0, '人物生成必须包含一次费用感知确认');
assert(generateFunction.indexOf('confirmBillingAwareAction') < generateFunction.indexOf("store.runStage('subject-assets'"), '确认必须发生在模型请求前');
const verifyProductFunction = assets.slice(assets.indexOf('const verifyProduct = async'), assets.indexOf("host.querySelectorAll('[data-asset-filter]"));
assert(verifyProductFunction.indexOf('confirmDialog') >= 0, '商品视觉验证必须包含显式费用确认');
assert(verifyProductFunction.indexOf('confirmDialog') < verifyProductFunction.indexOf('/product-verify'), '商品验证确认必须发生在视觉模型请求前');

const plot = read('public/story-ad/views/plotRoomView.js');
const plotEditor = read('public/story-ad/views/plotBeatEditor.js');
const plotUi = `${plot}\n${plotEditor}`;
assert.match(plotUi, /toFixed\(2\)/, '参考视频时间段投影到剧情室后不得显示浮点尾数噪声');
assert.match(plot, /mode:\s*'story_beat'/);
assert.match(plotUi, /AI 帮写/);
assert.match(plot, /confirmDialog\('删除后/);
assert.match(plotUi, /beat-actions/);
assert.match(plot, /story\?\.reference_draft/, '剧情室必须读取参考视频故事草稿');
assert.match(plot, /参考视频提取草稿 · 待优化/, '剧情室必须明确草稿来源和可优化状态');
assert.match(plot, /data-import-script/, '原始脚本必须在剧情室提供导入入口');
assert.match(plot, /accept="\.txt,\.md,text\/plain,text\/markdown"/, '剧情室脚本导入只接受文本格式');
assert.match(plot, /creative_direction:\s*\{ raw: text\.slice\(0, 12000\), source_name: file\.name \}/, '导入脚本必须进入剧情生成的权威请求字段');
assert.match(plot, /setButtonBusy\(button, false\)[\s\S]*button\.dataset\.previousText/, '脚本导入完成后必须恢复按钮可操作状态');
assert.match(plot, /data-open-storyboard/, '正式剧情蓝图保存后必须提供进入分镜台的入口');
assert.match(plot, /重新检查已保存初稿/, '质量审核失败后必须提供复用初稿的恢复入口，不能只显示空白蓝图');

const storyboard = read('public/story-ad/views/storyboardView.js');
assert.match(storyboard, /sketch-action-bar/);
assert.match(storyboard, /class="sketch-actions"/);
assert.doesNotMatch(storyboard, /sketch-media-actions/);
assert.match(storyboard, /shot-inline-editor/, '文字分镜必须在当前分镜台直接编辑');
assert.match(storyboard, /data-save-inline-shot/, '逐镜编辑必须有当前行保存入口');
assert.doesNotMatch(storyboard, /data-edit-shot[^\n]+context\.navigate/, '逐镜编辑不得再跳转到镜头设计页');
assert.match(storyboard, /friendlyBindings/, '绑定资产必须显示用户可理解的名称而非裸 ID');
assert.match(storyboard, /画面描述[\s\S]*景别[\s\S]*光影氛围[\s\S]*对白 \/ 旁白[\s\S]*音效[\s\S]*运镜[\s\S]*镜头提示词/,
  '完整分镜表必须集中展示逐镜制作字段');
assert.match(storyboard, /shotPromptPreview/);
assert.match(read('public/story-ad/workspace-ux.css'), /\.storyboard-complete-row/);
assert.match(storyboard, /label: '动物'/, '参考分镜中的动物绑定不得误标为人物');
assert.match(storyboard, /storyboard\?\.source === 'reference_analysis_projection'/, '分镜台必须识别参考逐镜草稿');
assert.match(storyboard, /data-save-reference-storyboard/, '参考逐镜草稿必须提供明确保存入口');
assert.match(storyboard, /机位、景别和运镜在镜头设计中继续优化/, '分镜台必须把机位优化引导到对应环节');
assert.match(storyboard, /isReferenceDraft[\s\S]*data-save-reference-storyboard[\s\S]*data-open-shot-design/, '参考逐镜与正式分镜必须分别显示保存和进入镜头设计操作');
assert.match(storyboard, /const pageSize = 20/, '长片分镜台必须分页，不能一次渲染100个文字和媒体节点');
assert.match(storyboard, /visibleShots\.map/, '分镜与线稿只能渲染当前分页');
assert.match(storyboard, /data-storyboard-page/, '长片分镜台必须提供上一页和下一页入口');
const sketchActions = storyboard.slice(storyboard.indexOf('class="sketch-actions"'), storyboard.indexOf('</div>', storyboard.indexOf('class="sketch-actions"')));
const sketchOrder = ['data-generate-sketch', 'data-upload-sketch', 'data-skip-sketch', 'data-confirm-sketch'].map(token => sketchActions.indexOf(token));
assert(sketchOrder.every(index => index >= 0), '线稿四个操作必须属于同一个 DOM 操作组');
assert.deepEqual([...sketchOrder].sort((a, b) => a - b), sketchOrder, '线稿操作的 DOM/键盘顺序必须为生成、上传、跳过、确认');

const shot = read('public/story-ad/views/shotDesignerView.js');
assert.match(shot, /const railPageSize = 20/, '长片镜头设计侧栏必须限制单次渲染数量');
assert.match(shot, /railShots\.map/, '镜头设计侧栏必须只渲染当前20镜窗口');
const shotModule = loadBrowserModule(
  'public/story-ad/views/shotDesignerView.js',
  ['shotEditableFingerprint'],
  { request() {}, emptyState() {}, escapeHtml, mediaPreview, setButtonBusy() {}, toast() {} },
);
assert.equal(
  shotModule.shotEditableFingerprint({ visual: '画面', duration_sec: 3, camera_movement: 'static' }),
  shotModule.shotEditableFingerprint({ visual_description: '画面', duration: 3, camera_movement: 'static' }),
  '镜头可编辑字段指纹必须忽略同义存储字段，避免零改动整表重算',
);
assert.match(shot, /拍摄机位/);
assert.match(shot, /平视/);
assert.match(shot, /浅景深（主体清楚）/);
assert.match(shot, /shot-readable-summary/);
assert.match(shot, /查看技术标识/);
assert.doesNotMatch(shot, /\['scene_id', '场景 ID'\]/);
assert.match(shot, /参考视频机位草稿/, '镜头设计必须显示参考视频提取的机位草稿状态');
assert.match(shot, /function missingShotDesign\(/, '镜头设计完成前必须逐镜校验必要字段');
assert.match(shot, /data-finish-shot-design/, '镜头设计必须提供明确完成操作');
assert.match(shot, /shot_design_confirmed:\s*true/, '全部镜头通过校验后必须持久化完成状态');
assert.match(shot, /const persistedShots = Array\.isArray\(saved\?\.shots\)/, '保存并继续必须校验服务端规范化后的分镜，不能继续使用保存前的旧对象');
assert.match(shot, /hasEditableChange[\s\S]*return shots;/, '镜头没有可编辑字段变化时不得重建整份分镜与关键帧合同');
assert.match(shot, /view=final/, '镜头设计完成后才能进入生成环节');

const finalView = read('public/story-ad/views/finalView.js');
assert.match(finalView, /class="final-video"[^>]*controls/);
assert.match(finalView, /下载原始成片/);
assert.match(finalView, /preload="none"/, '最终成片首屏不得默认拉取视频流');
assert.match(finalView, /poster=/, '最终成片应优先展示轻量封面');
assert.match(finalView, /<details class="card generation-section generation-details">/);
assert.doesNotMatch(finalView, /mediaPreview\(finalVideo/);

const workspaceCss = read('public/story-ad/workspace.css');
assert.match(workspaceCss, /\.drawer\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/s, '抽屉必须只滚动正文，底部操作栏不得遮挡表单');
assert.match(workspaceCss, /\.drawer-content\s*\{[^}]*overflow-y:\s*auto;/s);
const referenceProgressCss = read('public/story-ad/reference-progress.css');
const platformCss = read('public/story-ad/styles.css');
const dialogueThemeCss = read('public/story-ad/dialogue-theme.css');
const storyAdPage = read('public/story-ad/index.html');
assert.match(storyAdPage, /\/story-ad\/reference-progress\.css/, '合同级参考分析状态样式必须由页面入口加载');
assert.ok(storyAdPage.indexOf('/story-ad/dialogue-theme.css') > storyAdPage.indexOf('/story-ad/workspace.css'), '剧情广告主题交互层必须在所有工作区样式之后加载');
assert.match(platformCss, /\.btn:not\(:disabled\):hover, \.icon-btn:not\(:disabled\):hover/, '全模块普通按钮悬停不得命中禁用按钮');
assert.match(platformCss, /\.btn:disabled:not\(\[aria-busy="true"\]\):hover[^}]*background: var\(--surface-2\)/, '禁用按钮悬停时必须保持禁用外观，不能反向变成可点击态');
assert.match(dialogueThemeCss, /\.btn\.primary\{[^}]*linear-gradient[^}]*color:#fff/, '全模块主按钮默认态必须保持紫色主操作外观');
assert.match(dialogueThemeCss, /\.btn\.primary:not\(:disabled\):hover\{[^}]*linear-gradient[^}]*color:#fff/, '全模块主按钮悬停态必须是同色系增强，不能反向变暗');
assert.match(referenceProgressCss, /\.reference-contract-state\.is-missing/);
assert.match(referenceProgressCss, /var\(--amber\)/, '缺失合同必须使用平台已定义的警告主题色');
assert.doesNotMatch(referenceProgressCss, /var\(--warning\)/, '不得引用未定义的主题变量');
assert.match(workspaceCss, /\.final-video\s*\{[^}]*width:\s*auto;[^}]*max-width:\s*100%;[^}]*height:\s*auto;/s);
assert.match(workspaceCss, /\.sketch-actions\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
assert.match(workspaceCss, /\.scene-camera-media \.media[^}]*object-fit:\s*contain/s);
assert.match(workspaceCss, /\.workspace-nav\.is-locked\s*\{[^}]*cursor:\s*not-allowed/s);
assert.match(workspaceCss, /\.workspace-nav\.is-complete \.nav-number/);
assert.match(workspaceCss, /\.step-completion-card\.is-ready/);

const workflowModule = loadBrowserModule(
  'public/story-ad/views/workflowView.js',
  ['graphNode', 'structuredNodeDetail'],
  {
    escapeHtml,
    mediaPreview,
    workflowNodePortMarkup() { return ''; },
    request() { throw new Error('UI render test must not call request'); },
  },
);
Object.assign(workflowModule, loadBrowserModule(
  'public/story-ad/views/workflowInlineEditor.js',
  ['inlineNodeEditor'],
  { escapeHtml },
));
const fullBrief = '完整需求正文'.repeat(80);
const briefNode = { id: 'brief:1', type: 'brief', title: '广告目标', subtitle: '短摘要', detail: { full_text: fullBrief }, position: { x: 0, y: 0 } };
const briefCard = workflowModule.graphNode(briefNode);
assert.match(briefCard, /node-text-preview is-brief/);
assert.doesNotMatch(briefCard, /media-placeholder/);
assert.match(workflowModule.structuredNodeDetail(briefNode), new RegExp(fullBrief.slice(0, 120)));

const storyDetail = workflowModule.structuredNodeDetail({
  type: 'story', subtitle: '故事摘要', detail: { logline: '一次改变认知的体验', beats: [{ title: '开场', content: '人物进入场景' }, { title: '证明', content: '产品完成展示' }] },
});
assert.match(storyDetail, /剧情情节点/);
assert.match(storyDetail, /人物进入场景/);
const storyEditor = workflowModule.inlineNodeEditor({ type: 'story' }, {
  story: { blueprint: { story_title: '原故事', logline: '原概述', beats: [{ title: '开场', visual: '人物进入' }] } },
});
assert.match(storyEditor, /data-node-inline-editor/);
assert.match(storyEditor, /data-save-node-inline/);
assert.match(storyEditor, /人物进入/);

const shotWithSketch = workflowModule.graphNode({
  id: 'shot:1', type: 'shot', title: '推开窗户', subtitle: '人物走近窗边', media_url: '/sketch-1.png', detail: {}, position: { x: 0, y: 0 },
});
assert.match(shotWithSketch, /src="\/sketch-1\.png"/);
assert.doesNotMatch(shotWithSketch, /node-text-preview/);
assert.match(shotWithSketch, /node-media-summary/);
assert.match(shotWithSketch, /人物走近窗边/);

const workflowCss = read('public/story-ad/workflow.css');
assert.match(workflowCss, /\.node-text-preview p\s*\{[^}]*-webkit-line-clamp:\s*3/s);
assert.match(workflowCss, /\.graph-node \.node-media-summary\s*\{[^}]*-webkit-line-clamp:\s*2/s);
assert.match(workflowCss, /\.node-readable-section > p\s*\{[^}]*white-space:\s*pre-wrap/s);

const uiSource = read('public/story-ad/components/ui.js').replace(/\bexport\s+/g, '');
const sandbox = {};
vm.runInNewContext(`${uiSource}\nglobalThis.__mediaPreview = mediaPreview; globalThis.__generationProgressPanel = generationProgressPanel; globalThis.__formatElapsedText = formatElapsedText; globalThis.__elapsedMilliseconds = elapsedMilliseconds; globalThis.__setButtonBusy = setButtonBusy;`, sandbox, { filename: 'story-ad-ui-contract.js' });
assert.equal(sandbox.__formatElapsedText(65000), '1分05秒');
assert.equal(sandbox.__elapsedMilliseconds('2026-08-01T00:00:00.000Z', '2026-08-01T00:01:05.000Z'), 65000);
assert.match(sandbox.__mediaPreview({ media_url: '/api/assets/frame' }, { label: '帧' }), /<img/);
assert.match(sandbox.__mediaPreview({ media_url: '/api/media/final', type: 'final' }, { label: '成片' }), /<video/);
const hoverVideo = sandbox.__mediaPreview({ thumbnail_url: '/api/assets/poster', video_url: '/api/media/clip' }, { label: '视频浏览' });
assert.match(hoverVideo, /<video/);
assert.match(hoverVideo, /poster="\/api\/assets\/poster"/);
assert.match(hoverVideo, /data-hover-video-preview/);
const progressPanel = sandbox.__generationProgressPanel({
  project: { active_generation_id: 'gen-1', generation_started_at: '2026-08-01T00:00:00.000Z' },
  generation: { progress: { stage: 'keyframes', status: 'running', completed: 2, total: 6, active_indexes: [3, 4], percent: 33 } },
});
assert.match(progressPanel, /33%/);
assert.match(progressPanel, /已耗时 \d+分\d{2}秒/);
assert.match(progressPanel, /已完成 2\/6/);
assert.match(progressPanel, /正在生成第 3、4 镜/);
assert.match(progressPanel, /data-cancel-generation/);
const legacyFractionalVisualAssetPanel = sandbox.__generationProgressPanel({
  project: { active_generation_id: 'gen-legacy-fraction' },
  generation: { progress: { stage: 'visual_assets', status: 'running', completed: 0.2, total: 10, percent: 2 } },
});
assert.match(legacyFractionalVisualAssetPanel, /0\/10/, 'legacy fractional visual-asset progress must render as an integer count');
assert.doesNotMatch(legacyFractionalVisualAssetPanel, /0\.2/, 'fractional business target counts are not allowed in the UI');
const failedBillingPanel = sandbox.__generationProgressPanel({
  project: { status: 'failed', stage: 'visual_assets_failed', error: '计费状态未知' },
  generation: { progress: { stage: 'visual_assets', status: 'failed', billing_state: 'unknown', message: '供应商结果与计费待核对' } },
});
assert.match(failedBillingPanel, /project-progress-details/);
assert.match(failedBillingPanel, /<summary>/);
assert.doesNotMatch(failedBillingPanel, /<details[^>]*\sopen(?:\s|>)/, '失败详情刷新后必须默认折叠，不能持续挤压工作区');
const sceneFailureCard = sceneDossierModule.renderSceneDossierCard({
  id: 'scene-state-test', name: '状态测试场景',
  view_images: [{ key: 'master', image_url: '/master.png' }],
  failed_view_keys: ['interaction', 'detail'],
  view_statuses: {
    interaction: { state: 'billing_review', billing_state: 'unknown', submission_state: 'submitted_unknown' },
    detail: { state: 'pending', billing_state: 'not_submitted', submission_state: 'not_submitted' },
  },
});
assert.match(sceneFailureCard, /is-billing-review/);
assert.match(sceneFailureCard, /计费与结果待核对/);
assert.match(sceneFailureCard, /is-pending/);
assert.match(sceneFailureCard, /尚未提交，可在核对后继续/);
const busyButton = {
  dataset: {}, textContent: '生成人物', disabled: false,
  setAttribute() {}, removeAttribute() {},
};
sandbox.__setButtonBusy(busyButton, true, '正在生成…', { elapsed: true });
assert.match(busyButton.textContent, /已耗时 0分00秒/);
sandbox.__setButtonBusy(busyButton, false);
assert.equal(busyButton.textContent, '生成人物');
assert.equal(busyButton.disabled, false);

const storeSource = read('public/story-ad/store/projectStore.js');
assert.match(storeSource, /generation_progress:\s*progressTask\.generation_progress/, '轻量轮询必须把完整进度合并回 V6 bundle');
assert.match(storeSource, /progressRevision/, '轮询必须使用独立进度 revision，不能误用内容 revision');
const appSource = read('public/story-ad/app.js');
assert.match(appSource, /setInterval\(\(\) => refreshElapsedLabels\(document\), 1000\)/, '页面必须每秒刷新活动任务耗时');
assert.match(appSource, /人物 \/ 动物 \/ 商品 \/ LOGO/, '侧栏主体计数必须明确排除场景和道具');
assert.match(appSource, /已有画面的场景/, '场景图片必须使用独立计数，不能混入人物资产步骤');
assert.match(appSource, /const deletingProjectIds = new Set\(\)/, '项目中心必须维护独立删除状态，避免重复提交');
assert.match(appSource, /aria-busy="true"/, '整行删除状态必须向用户和辅助技术公开');
assert.match(appSource, /正在彻底删除/, '删除确认后整行必须立即显示清晰进度');
assert.match(appSource, /deletingProjectIds\.delete\(String\(taskId\)\)/, '删除成功或失败后必须清理等待状态');
assert.match(workspaceCss + platformCss, /project-row\.is-deleting/, '删除中的项目行必须有持久视觉状态');
[
  'public/story-ad/views/assetCenterView.js',
  'public/story-ad/views/plotRoomView.js',
  'public/story-ad/views/storyboardView.js',
  'public/story-ad/views/shotDesignerView.js',
  'public/story-ad/views/finalView.js',
].forEach(file => assert.match(read(file), /elapsed:\s*true/, `${file} 必须显示直接生成操作耗时`));
assert.match(workspaceCss, /\.elapsed-time/);
assert.match(appSource, /store\.syncProgressPolling\(\)/, '页面内切换后必须恢复当前任务的进度轮询');
assert.match(appSource, /generationProgressPanel/, '所有制作步骤必须共享同一个可见进度条');

assert.match(platformCss, /\.btn:focus-visible[^}]*outline/s, '按钮必须有清晰键盘指向效果');
assert.match(workspaceCss, /\[aria-selected="true"\]/, '可选择按钮必须有持久选中效果');

console.log('story-ad workspace v6 UI regression contracts passed');
