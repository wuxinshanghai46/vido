#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file)
  .replace(/^import[^;]+;\s*$/gm, '')
  .replace(/export\s+(?=(?:async\s+)?function|const|let|var|class)/g, '');

function acceptedScene() {
  return {
    id: 'scene-a', name: '已确认场景', accepted_current_visuals: true,
    scene_master: { image_url: '/master.png' },
    layout: { image_url: '/layout.png' },
    view_images: ['reverse', 'interaction', 'detail'].map(key => ({ key, image_url: `/${key}.png` })),
    qa: { full_space_lock: false, qa_unavailable: true, failure_summary: '审核服务不可用' },
    repair_plan: { action: 'reverify', count: 0 },
  };
}

function verifyStoryboardModuleMounts() {
  assert.doesNotThrow(() => vm.runInNewContext(executable('public/story-ad/views/storyboardView.js'), {}),
    '人物场景分镜模块加载时不得访问尚不存在的镜头 card');
  const source = read('public/story-ad/views/storyboardView.js');
  const binding = source.match(/host\.querySelectorAll\('\[data-sketch-shot\]'\)\.forEach\(card => \{[\s\S]+?\n  \}\);/)?.[0] || '';
  assert.match(binding, /data-save-shot-voice/, '声音保存事件必须绑定在每个镜头 card 的作用域内');
}

function verifyAcceptedProjection() {
  const projection = require('../src/services/storyAdWorkspace/sceneWorkflowProjectionService');
  const scene = acceptedScene();
  delete scene.accepted_current_visuals;
  const outputs = { scene_assets: [scene] };
  const acceptance = require('../src/services/newStoryAd/sceneVisualAcceptanceService');
  outputs.scene_visual_acceptance = {
    status: 'accepted', mode: 'explicit_user_acceptance',
    scene_fingerprint: acceptance.fingerprint(outputs.scene_assets),
  };
  const state = projection.projectBundleState(outputs.scene_assets, { scene_setup_confirmed: true }, outputs).scene_workflow;
  assert.equal(state.visuals_accepted, true);
  assert.equal(state.can_accept_current, false, '接受成功后不得继续展示重复接受入口');
  assert.equal(state.confirmed, true);

  const bundleSource = read('src/services/storyAdWorkspace/projectBundleService.js');
  assert.match(bundleSource, /accepted_current_visuals:\s*true/, '有效接受态必须投影到每个场景展示对象');
}

function verifyAcceptedSceneUi() {
  const dossierSandbox = {
    escapeHtml: value => String(value ?? ''),
    mediaPreview: (_item, options = {}) => `<img alt="${options.label || ''}">`,
    setButtonBusy() {}, toast() {},
    sceneRuntimeFailureMarkup: () => '<div>历史运行失败</div>',
    publicSceneQaReason: value => String(value || ''),
    sceneQaFailureDetails: () => ({ labels: ['一致性'], reasons: ['审核服务不可用'] }),
    sceneQaPublicState: () => ({ kind: 'service_unavailable', title: '审核暂不可用，图片已保留', message: '可重新审核' }),
    sceneQaRows: () => [{ label: '一致性', pass: false, reasons: ['审核服务不可用'] }],
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneDossierCard.js')}\nglobalThis.__api={normalizeSceneDossier,renderSceneCoverCard,renderSceneDossierCard};`, dossierSandbox);
  const scene = acceptedScene();
  const cover = dossierSandbox.__api.renderSceneCoverCard(scene);
  assert.match(cover, /已使用当前图片继续/);
  assert.doesNotMatch(cover, /审核暂不可用|审核服务不可用|可重新审核|历史运行失败/);
  const dossier = dossierSandbox.__api.renderSceneDossierCard(scene);
  assert.match(dossier, /当前图片已由用户确认继续使用/);
  assert.doesNotMatch(dossier, /审核暂不可用|审核服务不可用|可重新审核/);

  const promptSandbox = {
    elapsedTimeTag: () => '', escapeHtml: value => String(value ?? ''), toast() {},
    normalizeSceneDossier: dossierSandbox.__api.normalizeSceneDossier,
    renderSceneCoverCard: dossierSandbox.__api.renderSceneCoverCard,
    sceneNeedsGeneration: () => false,
    sceneGenerationSettingsMarkup: () => '<select></select>',
  };
  vm.runInNewContext(`${executable('public/story-ad/views/scenePromptPreview.js')}\nglobalThis.__api={scenePendingAction,renderSceneProductionCard};`, promptSandbox);
  assert.equal(promptSandbox.__api.scenePendingAction(scene), null, '接受态不得再进入重新审核批次');
  const card = promptSandbox.__api.renderSceneProductionCard(scene, 0);
  assert.doesNotMatch(card, /重新审核|scene-card-generate|<footer>/);

  const page = read('public/story-ad/views/sceneWorldPage.js');
  const render = page.match(/host\.innerHTML\s*=\s*`[\s\S]+?`;\s*\n/)?.[0] || '';
  assert.match(render, /scene-production[\s\S]+?scene-view-actions[\s\S]+?\$\{completionAction\}/,
    '使用当前图片继续必须位于场景生产标题右侧操作区');
  assert.doesNotMatch(render.match(/<section class="view-head scene-view-head">[\s\S]+?<\/section>/)?.[0] || '', /completionAction|data-accept-current-scenes/,
    '页面大标题旁不得再放接受按钮');
}

verifyStoryboardModuleMounts();
verifyAcceptedProjection();
verifyAcceptedSceneUi();
console.log(JSON.stringify({
  passed: true,
  storyboard_module_mount: 'ok',
  duplicate_accept_action: 'hidden',
  accepted_qa_warnings: 'hidden',
  accepted_reverify_action: 'hidden',
  acceptance_button_area: 'scene-production-actions',
}));
