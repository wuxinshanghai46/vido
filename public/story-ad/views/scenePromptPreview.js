import { escapeHtml, toast } from '../components/ui.js?v=20260827-production-v234b';
import { renderSceneCoverCard, sceneNeedsGeneration } from './sceneDossierCard.js?v=20260827-production-v234b';

const submitted = new Set();

export function renderSceneProductionCard(scene = {}, index = 0, options = {}) {
  const prompt = String(scene.generation_prompt || scene.prompt || scene.description || '').trim();
  const imageCount = [scene.layout?.image_url, ...(scene.view_images || []), ...(scene.cameras || []).map(camera => camera?.image_url)].filter(Boolean).length;
  const provisional = options.provisional === true || scene.provisional === true;
  const needsGeneration = !provisional && sceneNeedsGeneration(scene);
  const sceneId = escapeHtml(scene.id || scene.scene_id || `scene-${index + 1}`);
  const promptState = scene.prompt_state || {};
  const generationStarted = !provisional && Boolean(imageCount || options.generationActive
    || ['queued', 'running', 'processing', 'generating'].includes(String(scene.status || scene.generation_status || '').toLowerCase()));
  const preferredTab = generationStarted ? 'images' : 'prompt';
  const promptPane = provisional
    ? `<pre>${escapeHtml(prompt || '场景提示词尚未生成。')}</pre>`
    : `<textarea data-scene-prompt-editor="${sceneId}" maxlength="12000">${escapeHtml(prompt || '')}</textarea><div class="scene-prompt-editor-actions"><small>修改后自动保存；生成时只使用已保存的最新版本。</small><span data-autosave-state="saved">已自动保存</span></div>`;
  return `<article class="scene-production-card" data-scene-card data-scene-id="${sceneId}" data-prompt-version-id="${escapeHtml(promptState.prompt_version_id || '')}" data-default-scene-tab="${preferredTab}">
    <header><div><small>场景 ${index + 1}</small><h3>${escapeHtml(scene.name || `场景 ${index + 1}`)}</h3></div><span class="status-tag ${needsGeneration || provisional ? 'is-neutral' : 'is-ready'}">${provisional ? '提示词预览' : (needsGeneration ? '待生成画面' : `已生成 ${imageCount} 张`)}</span></header>
    <nav class="scene-production-tabs"><button class="${preferredTab === 'prompt' ? 'is-active' : ''}" data-scene-detail-tab="prompt">提示词</button><button class="${preferredTab === 'images' ? 'is-active' : ''}" data-scene-detail-tab="images">场景画面 ${imageCount ? `(${imageCount})` : ''}</button></nav>
    <section class="scene-production-pane" data-scene-detail-pane="prompt" ${preferredTab === 'prompt' ? '' : 'hidden'}>${promptPane}</section>
    <section class="scene-production-pane" data-scene-detail-pane="images" ${preferredTab === 'images' ? '' : 'hidden'}>${renderSceneCoverCard(scene)}</section>
    <footer><span>${provisional ? '正式规划完成后可生成画面' : (options.generationActive ? '该场景正在生成，其他场景仍可继续提交' : (needsGeneration ? '编辑会自动保存，可直接生成场景画面' : '画面已就绪，可按需重新生成'))}</span>${!provisional ? `<button class="btn primary compact" data-generate-scene="${sceneId}" ${options.generationActive ? 'disabled' : ''}>${options.generationActive ? '正在生成…' : (needsGeneration ? '生成该场景' : '重新生成')}</button>` : ''}</footer>
  </article>`;
}

export function scenePromptPreviewState(bundle = {}, scenePlanReady = false, generationActive = false) {
  const workflow = bundle.scene_workflow || {};
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  const previewScenes = Array.isArray(workflow.preview_scenes) ? workflow.preview_scenes : [];
  const failed = ['failed', 'blocked'].includes(String(bundle.project?.status || '').toLowerCase());
  return {
    previewScenes,
    displayedCount: scenes.length || Number(workflow.estimated_count || previewScenes.length || 0),
    autoInitialize: workflow.initialization_required === true && !scenePlanReady && !generationActive && !failed,
  };
}

export function scenePromptPreviewMarkup(state = {}, renderCard = () => '') {
  if (!state.previewScenes?.length) return '';
  return `<section class="scene-production is-preview"><header><div><h2>场景数量与提示词预览</h2><p>每个场景都有独立提示词；正式规划完成后会自动替换，不会修改人物资产。</p></div><span>预计 ${state.displayedCount} 个</span></header><div class="scene-production-grid">${state.previewScenes.map((scene, index) => renderCard(scene, index)).join('')}</div></section>`;
}

export function startInitialScenePlan(bundle = {}, store = {}) {
  const id = String(bundle.project?.id || '');
  if (!id || submitted.has(id)) return;
  submitted.add(id);
  store.runStage('scene-plan', { request_key: `scene-plan-auto:${id}:${bundle.revisions?.content || 1}` })
    .then(() => toast('正式场景提示词正在生成，页面会自动更新。', 'success'))
    .catch(error => { submitted.delete(id); toast(error.message || '场景提示词生成失败', 'error'); });
}
