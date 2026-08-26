import { escapeHtml, toast } from '../components/ui.js?v=20260826-production-v231';
import { renderSceneCoverCard, sceneNeedsGeneration } from './sceneDossierCard.js?v=20260826-production-v231';

const submitted = new Set();

export function renderSceneProductionCard(scene = {}, index = 0, options = {}) {
  const prompt = String(scene.generation_prompt || scene.prompt || scene.description || '').trim();
  const imageCount = [scene.layout?.image_url, ...(scene.view_images || []), ...(scene.cameras || []).map(camera => camera?.image_url)].filter(Boolean).length;
  const provisional = options.provisional === true || scene.provisional === true;
  const needsGeneration = !provisional && sceneNeedsGeneration(scene);
  const promptConfirmed = scene.prompt_confirmation?.confirmed === true;
  const sceneId = escapeHtml(scene.id || scene.scene_id || `scene-${index + 1}`);
  return `<article class="scene-production-card" data-scene-card>
    <header><div><small>场景 ${index + 1}</small><h3>${escapeHtml(scene.name || `场景 ${index + 1}`)}</h3></div><span class="status-tag ${needsGeneration || provisional ? 'is-neutral' : 'is-ready'}">${provisional ? '提示词预览' : (needsGeneration ? '待生成画面' : `已生成 ${imageCount} 张`)}</span></header>
    <nav class="scene-production-tabs"><button class="is-active" data-scene-detail-tab="prompt">提示词</button><button data-scene-detail-tab="images">场景画面 ${imageCount ? `(${imageCount})` : ''}</button></nav>
    <section class="scene-production-pane" data-scene-detail-pane="prompt"><pre>${escapeHtml(prompt || '场景提示词尚未生成。')}</pre></section>
    <section class="scene-production-pane" data-scene-detail-pane="images" hidden>${renderSceneCoverCard(scene)}</section>
    <footer><span>${provisional ? '正式规划完成后可逐个生成画面' : (needsGeneration ? (promptConfirmed ? '提示词已确认，可以生成画面' : '请先确认当前提示词') : '画面已就绪，可继续核对')}</span>${needsGeneration && !promptConfirmed ? `<button class="btn primary compact" data-confirm-scene-prompt="${sceneId}">确认提示词</button>` : ''}${needsGeneration && promptConfirmed ? `<button class="btn primary compact" data-generate-scene="${sceneId}">生成该场景</button>` : ''}</footer>
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
