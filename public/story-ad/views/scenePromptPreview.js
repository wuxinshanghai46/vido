import { elapsedTimeTag, escapeHtml, toast } from '../components/ui.js?v=20260830-production-v313';
import { normalizeSceneDossier, renderSceneCoverCard, sceneNeedsGeneration } from './sceneDossierCard.js?v=20260830-production-v313';
import { sceneGenerationSettingsMarkup } from './sceneDossierCardSettings.js?v=20260830-production-v313';

const submitted = new Set();

export function sceneProductionAction(scene = {}) {
  if (scene.accepted_current_visuals === true) return {
    kind: 'accepted', button: '', status: '', billable: false,
  };
  const plan = scene.repair_plan && typeof scene.repair_plan === 'object' ? scene.repair_plan : {};
  const action = String(plan.action || '');
  const labels = Array.isArray(plan.view_labels) ? plan.view_labels.filter(Boolean) : [];
  if (action === 'reverify') return {
    kind: 'fix', button: '重新审核（0 次图片调用）', status: '只重新审核，不重新生成图片。', billable: false,
  };
  if (action === 'regenerate_failed_views') return {
    kind: 'fix', button: `修复${labels.length ? `：${labels.join('、')}` : '失败视图'}（${Number(plan.count || labels.length || 0)} 张）`, status: `${plan.message || '仅重做有逐图证据的失败视图，其余图片保留。'} 完成后自动复核。`, billable: true,
  };
  if (action === 'rebuild_atlas') return {
    kind: 'fix', button: '修复空间母图与布局（2 次图片调用）', status: `${plan.message || '透视视图来自同一母图，需要重建母图与俯视布局。'} 完成后自动复核。`, billable: true,
  };
  if (action === 'regenerate_full_scene') return {
    kind: 'fix', button: '修复并升级当前场景', status: `${plan.message || '旧版空间合同需要完整升级，不能局部修复。'} 完成后自动复核。`, billable: true,
  };
  const needsGeneration = sceneNeedsGeneration(scene);
  return { kind: 'generate', button: needsGeneration ? '生成该场景' : '重新生成', status: needsGeneration ? '已自动保存，可生成画面' : '画面已就绪，可重新生成', billable: true };
}

export function scenePendingAction(scene = {}) {
  if (scene.accepted_current_visuals === true) return null;
  const action = String(scene.repair_plan?.action || '');
  if (['reverify', 'regenerate_failed_views', 'rebuild_atlas', 'regenerate_full_scene'].includes(action)) {
    return sceneProductionAction(scene);
  }
  return sceneNeedsGeneration(scene) ? sceneProductionAction(scene) : null;
}

export function renderSceneProductionCard(scene = {}, index = 0, options = {}) {
  const prompt = String(scene.generation_prompt || scene.prompt || scene.description || '').trim();
  const imageCount = normalizeSceneDossier(scene).completed;
  const provisional = options.provisional === true || scene.provisional === true;
  const needsGeneration = !provisional && sceneNeedsGeneration(scene);
  const productionAction = sceneProductionAction(scene);
  const sceneId = escapeHtml(scene.id || scene.scene_id || `scene-${index + 1}`);
  const promptState = scene.prompt_state || {};
  const generationStarted = !provisional && Boolean(imageCount || options.generationActive
    || ['queued', 'running', 'processing', 'generating'].includes(String(scene.status || scene.generation_status || '').toLowerCase()));
  const preferredTab = generationStarted ? 'images' : 'prompt';
  const progress = options.progress && typeof options.progress === 'object' ? options.progress : null;
  const progressTotal = Math.max(1, Number(progress?.image_target_total || progress?.target_total || progress?.total || 1) || 1);
  const progressDone = Math.max(0, Math.min(progressTotal, Number(progress?.image_processed ?? progress?.processed ?? progress?.completed ?? 0) || 0));
  const progressPercent = Math.max(0, Math.min(100, Number.isFinite(Number(progress?.percent))
    ? Math.round(Number(progress.percent)) : Math.round((progressDone / progressTotal) * 100)));
  const progressAction = (String(progress?.stage || '').toLowerCase() === 'scene_qa'
    || String(progress?.phase || '').toLowerCase() === 'verification'
    || String(progress?.current_action || '') === 'reverify')
    ? '正在审核当前场景' : (productionAction.kind === 'fix' ? '正在修复当前场景' : '正在生成当前场景');
  const currentView = escapeHtml(progress?.current_view_label || '准备中');
  const elapsed = elapsedTimeTag({ startedAt: progress?.started_at, finishedAt: progress?.finished_at, active: options.generationActive });
  const progressMarkup = options.generationActive ? `<div class="scene-card-live-progress" role="status" aria-live="polite" data-scene-progress="${sceneId}"><div><b>${escapeHtml(progressAction)}</b><span>${progressDone}/${progressTotal} · ${progressPercent}%</span></div><i aria-hidden="true"><b style="width:${progressPercent}%"></b></i><small>${currentView}${elapsed ? ` · ${elapsed}` : ''}</small></div>` : '';
  const promptPane = provisional
    ? `<pre>${escapeHtml(prompt || '待生成场景提示词。')}</pre>`
    : `<textarea data-scene-prompt-editor="${sceneId}" maxlength="12000">${escapeHtml(prompt || '')}</textarea><div class="scene-prompt-editor-actions"><small>自动保存；生成时使用最新版本。</small><span data-autosave-state="saved">已自动保存</span></div>`;
  return `<article class="scene-production-card" data-scene-card data-scene-id="${sceneId}" data-prompt-version-id="${escapeHtml(promptState.prompt_version_id || '')}" data-default-scene-tab="${preferredTab}">
    <header><div><small>场景 ${index + 1}</small><h3>${escapeHtml(scene.name || `场景 ${index + 1}`)}</h3></div><div class="scene-view-actions"><span class="status-tag ${needsGeneration || provisional ? 'is-neutral' : 'is-ready'}">${provisional ? '提示词预览' : (needsGeneration ? '待生成画面' : `已生成 ${imageCount} 张`)}</span>${imageCount ? `<button class="btn primary compact scene-card-entry" data-enter-scene-world="${sceneId}">进入场景</button>` : ''}</div></header>
    ${progressMarkup}
    <nav class="scene-production-tabs"><button class="${preferredTab === 'prompt' ? 'is-active' : ''}" data-scene-detail-tab="prompt">提示词</button><button class="${preferredTab === 'images' ? 'is-active' : ''}" data-scene-detail-tab="images">场景画面 ${imageCount ? `(${imageCount})` : ''}</button></nav>
    <section class="scene-production-pane" data-scene-detail-pane="prompt" ${preferredTab === 'prompt' ? '' : 'hidden'}>${promptPane}</section>
    <section class="scene-production-pane" data-scene-detail-pane="images" ${preferredTab === 'images' ? '' : 'hidden'}>${renderSceneCoverCard(scene)}</section>
    ${provisional || productionAction.kind === 'accepted' ? '' : `<footer><span>${options.generationActive ? '任务正在后台处理，可留在当前页面查看进度。' : productionAction.status}</span>${options.batchManaged || productionAction.kind === 'fix' ? '' : `<div class="scene-card-controls">${productionAction.billable ? sceneGenerationSettingsMarkup() : ''}<button class="btn primary compact scene-card-generate" data-${productionAction.kind}-scene="${sceneId}" ${options.generationActive ? 'disabled' : ''}>${options.generationActive ? `${escapeHtml(progressAction)}…` : escapeHtml(productionAction.button)}</button></div>`}</footer>`}
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
