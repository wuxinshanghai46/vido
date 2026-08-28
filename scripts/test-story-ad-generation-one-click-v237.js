'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/^export\s+\{.*$/gm, '').replace(/\bexport\s+/g, '');

async function billingContract() {
  let reviews = [];
  let confirmCalls = 0;
  const sandbox = {
    request: async () => ({ support_id: 'support-1', reviews }),
    confirmDialog: async () => { confirmCalls += 1; return true; },
  };
  vm.runInNewContext(`${executable('public/story-ad/views/assetCenterBillingReviewDialog.js')}\nglobalThis.__confirm=confirmBillingAwareAction;`, sandbox);
  const bundle = { project: { id: 'task-one-click' } };
  const ordinary = await sandbox.__confirm({ bundle, lane: 'scenes', sceneId: 'scene-1' });
  assert.equal(ordinary.accepted, true);
  assert.equal(confirmCalls, 0, '普通生成不得弹二次确认');
  reviews = [{ review_key: 'review-1', kind: 'scene', lane: 'scenes', scene_id: 'scene-1', unit: 'master' }];
  const risky = await sandbox.__confirm({ bundle, lane: 'scenes', sceneId: 'scene-1' });
  assert.equal(risky.accepted, true);
  assert.equal(confirmCalls, 1, '计费未知恢复必须取得明确的重复计费风险确认');
}

async function main() {
  await billingContract();
  const sceneActions = read('public/story-ad/views/sceneCardInteractions.js');
  const scenePreview = read('public/story-ad/views/scenePromptPreview.js');
  const responsive = read('public/story-ad/workspace-ux.css');
  const personSources = read('public/story-ad/views/assetCenterPersonSources.js');
  const storyboard = read('public/story-ad/views/storyboardView.js');
  const panorama = read('public/story-ad/views/panoramaGeneration.js');
  const personAutosave = read('public/story-ad/views/personPromptAutosave.js');
  const assetCenter = read('public/story-ad/views/assetCenterView.js');
  const combinedVisual = read('public/story-ad/views/assetCenterBillingRetry.js');
  const planMigration = read('public/story-ad/views/assetCenterPlanMigrationAction.js');
  const projectStore = read('public/story-ad/store/projectStore.js');
  const workspaceCss = read('public/story-ad/workspace.css');
  const uiSandbox = { Intl, Date, URL, document: { querySelectorAll: () => [] } };
  vm.runInNewContext(`${executable('public/story-ad/components/ui.js')}\nglobalThis.__progressView=generationProgressView;globalThis.__progressPanel=generationProgressPanel;`, uiSandbox);
  const partialBundle = { project: { active_generation_id: 'generation-partial', generation_progress: {
    stage: 'scene_asset', status: 'running', target_total: 5, processed: 5, succeeded: 4, failed: 1, percent: 100,
  } } };
  const progressView = uiSandbox.__progressView(partialBundle);
  const progressPanel = uiSandbox.__progressPanel(partialBundle, 'scene');
  assert.equal(progressView.percent, 100, '处理完成必须如实保留100%，不能伪装成99%');
  assert.equal(progressView.succeededCount, 4);
  assert.equal(progressView.failedCount, 1);
  assert(progressPanel.includes('处理进度 5/5') && progressPanel.includes('成功 4，失败 1') && progressPanel.includes('处理进度 100%'), '100%必须明确是处理进度，并同时呈现成功/失败计数');
  const failedPanel = uiSandbox.__progressPanel({ project: { status: 'failed', error: '部分生成失败', generation_progress: {
    stage: 'scene_asset', status: 'failed', target_total: 5, processed: 5, succeeded: 4, failed: 1, percent: 100,
  } } }, 'scene');
  assert(failedPanel.includes('处理 5/5：成功 4，失败 1'), '任务转为终态失败后仍必须保留处理、成功和失败计数');
  const staleRunning = uiSandbox.__progressView({ project: {
    status: 'failed', stage: 'scene_asset_failed', active_generation_id: '', active_target_generations: {}, error: '部分生成失败',
    generation_progress: { stage: 'scene_asset', status: 'running', target_total: 5, processed: 5, succeeded: 4, failed: 1, percent: 100 },
  } });
  assert.equal(staleRunning.active, false, '无活动ID时旧running进度不得覆盖权威failed终态');
  assert.equal(staleRunning.failed, true);
  assert(scenePreview.includes('scene-card-controls') && scenePreview.includes('sceneGenerationSettingsMarkup()'));
  assert(!sceneActions.includes('insertAdjacentHTML'));
  const singleSceneHandler = sceneActions.slice(sceneActions.indexOf("host.querySelectorAll('[data-generate-scene]')"), sceneActions.indexOf("host.querySelector('[data-generate-all-scenes]')"));
  assert(singleSceneHandler.indexOf("setButtonBusy(button, true, '正在准备…')") < singleSceneHandler.indexOf('await (await controllerFor(sceneId))?.flush()'), '场景点击后必须先给反馈，再等待自动保存');
  const batchFixHandler = sceneActions.slice(sceneActions.indexOf("host.querySelector('[data-fix-all-scenes]')"));
  assert(batchFixHandler.indexOf('beginStageSubmission') < batchFixHandler.indexOf('Promise.allSettled'), '批量修复必须在网络提交完成前立即投影全局进度');
  assert(projectStore.includes("active_generation_id: state.bundle.project.active_generation_id || 'client-submitting'") && projectStore.includes('client_optimistic: true'), '客户端提交阶段必须同步创建可见的0%进度状态');
  assert.match(workspaceCss, /\.project-progress-head strong \{[^}]*font-size: 14px/);
  assert(responsive.includes('@media(max-width:900px)') && responsive.includes('@media(max-width:700px)'));
  assert(responsive.includes('.scene-card-controls') && responsive.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert(!/确认启动真人 AI 补全|生成完整人物档案[^\n]*confirmDialog/.test(personSources), '真人生成已由提交按钮和授权复选框明确授权，不得二次确认');
  assert(!/confirmDialog/.test(storyboard), '文字分镜与线稿生成不得二次确认');
  assert(!/confirmDialog/.test(panorama), '360生成不得二次确认');
  assert(personAutosave.indexOf("setButtonBusy(button, true, '正在准备…')") < personAutosave.indexOf('await controller.flush()'), '人物提示词必须先显示准备状态，再等待自动保存');
  const subjectGeneration = assetCenter.slice(assetCenter.indexOf('const generate = async'), assetCenter.indexOf('const generateProduct = async'));
  assert(subjectGeneration.indexOf("setButtonBusy(button, true, '正在准备…')") < subjectGeneration.indexOf('await ensureSubjectRecoveryReady'), '人物生成必须先显示准备状态，再等待恢复/计费预检');
  const combinedHandler = combinedVisual.slice(combinedVisual.indexOf("host.querySelector('[data-generate-visual-assets]')"));
  assert(combinedHandler.indexOf("setButtonBusy(button, true, '正在准备…')") < combinedHandler.indexOf('await confirmBillingAwareAction'), '同步人物场景必须先显示准备状态，再检查计费风险');
  assert(planMigration.indexOf("setButtonBusy(button,true,'正在准备…')") < planMigration.indexOf('await confirmGeneration'), '人物方案迁移必须先显示准备状态，再执行预检');
  assert(panorama.indexOf("item.textContent = '正在准备…'") < panorama.indexOf('plan = await request'), '单场景360必须先显示准备状态，再读取幂等计划');
  const batchPanorama = panorama.slice(panorama.indexOf('export async function runPanoramaBatchGeneration'));
  assert(batchPanorama.indexOf("button.textContent = '正在准备…'") < batchPanorama.indexOf('plan = await request'), '批量360必须先显示准备状态，再读取幂等计划');
  console.log(JSON.stringify({ passed: true, ordinary_generation_confirmations: 0, billing_unknown_confirmations: 1, progress: { processed: 5, succeeded: 4, failed: 1, percent: 100 }, responsive_breakpoints: [900, 700], paid_model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
