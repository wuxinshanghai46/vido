import { renderSceneWorldWorkspace, bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260826-production-v230n';
import { escapeHtml, setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v230n';
import { confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260826-production-v230n';
import { renderSceneCoverCard, sceneNeedsGeneration } from './sceneDossierCard.js?v=20260826-production-v230n';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260826-production-v230n';

function scenePrompt(scene = {}) {
  return String(scene.generation_prompt || scene.prompt || scene.description || '').trim();
}

function sceneImageCount(scene = {}) { return [scene.layout?.image_url, ...(scene.view_images || []), ...(scene.cameras || []).map(camera => camera?.image_url)].filter(Boolean).length; }

function renderSceneCard(scene = {}, index = 0) {
  const prompt = scenePrompt(scene);
  const imageCount = sceneImageCount(scene);
  const needsGeneration = sceneNeedsGeneration(scene);
  const sceneId = escapeHtml(scene.id || scene.scene_id || `scene-${index + 1}`);
  return `<article class="scene-production-card" data-scene-card>
    <header><div><small>场景 ${index + 1}</small><h3>${escapeHtml(scene.name || `场景 ${index + 1}`)}</h3></div><span class="status-tag ${needsGeneration ? 'is-neutral' : 'is-ready'}">${needsGeneration ? '待生成画面' : `已生成 ${imageCount} 张`}</span></header>
    <nav class="scene-production-tabs">
      <button class="is-active" data-scene-detail-tab="prompt">提示词</button>
      <button data-scene-detail-tab="images">场景画面 ${imageCount ? `(${imageCount})` : ''}</button>
    </nav>
    <section class="scene-production-pane" data-scene-detail-pane="prompt"><pre>${escapeHtml(prompt || '场景提示词尚未生成。')}</pre></section>
    <section class="scene-production-pane" data-scene-detail-pane="images" hidden>${renderSceneCoverCard(scene)}</section>
    <footer><span>${needsGeneration ? '确认提示词后生成画面' : '画面已就绪，可继续核对'}</span>${needsGeneration ? `<button class="btn primary compact" data-generate-scene="${sceneId}">生成该场景</button>` : ''}</footer>
  </article>`;
}

function bindSceneCards(host, context) {
  host.querySelectorAll('[data-scene-detail-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-scene-card]');
      if (!card) return;
      card.querySelectorAll('[data-scene-detail-tab]').forEach(tab => tab.classList.toggle('is-active', tab === button));
      card.querySelectorAll('[data-scene-detail-pane]').forEach(pane => {
        pane.hidden = pane.dataset.sceneDetailPane !== button.dataset.sceneDetailTab;
      });
    });
  });

  host.querySelectorAll('[data-generate-scene]').forEach(button => {
    button.addEventListener('click', async () => {
      const sceneId = button.dataset.generateScene;
      const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
      if (!scene) return toast('未找到对应场景', 'error');
      const confirmation = await confirmBillingAwareAction({
        bundle: context.bundle,
        lane: 'scenes',
        sceneId,
        title: `生成${scene.name || '场景'}`,
        message: '根据已确认提示词生成场景画面，将调用图片模型并产生费用。',
        confirmText: '确认生成',
      });
      if (!confirmation.accepted) return;
      setButtonBusy(button, true, '正在生成…');
      try {
        const result = await context.store.runStage('scene-assets', { space_id: sceneId, scene_id: sceneId, name: scene.name });
        if (!result.accepted) throw new Error(result.message || '生成未被接受');
        toast('任务已提交');
        await context.refreshShell();
      } catch (error) {
        toast(error.message || '生成场景失败', 'error');
        setButtonBusy(button, false);
      }
    });
  });
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const eligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const sceneEligibility = eligibility.scene || eligibility;
  const scenePlanReady = sceneEligibility.eligible === true;
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  const workflow = bundle.scene_workflow || {};
  const generationActive = !!bundle?.project?.active_generation_id
  const canConfirm = workflow.visuals_complete === true && scenes.length > 0

  host.innerHTML = `<section class="view-head scene-view-head"><div><h1>场景</h1><p>先查看提示词，再生成并核对场景画面。</p></div><div class="scene-view-actions"><span>${scenes.length} 个场景</span>${canConfirm ? '<button class="btn primary compact" data-confirm-scenes>确认场景，进入线稿</button>' : ''}</div></section>
    ${scenePlanReady ? '' : scenePlanBlockedView(sceneEligibility, generationActive)}
    ${scenePlanReady && scenes.length ? `<section class="scene-production"><header><div><h2>场景提示词与画面</h2><p>逐个核对提示词和生成结果；未生成画面不能进入线稿。</p></div><span>${workflow.generated_count || 0}/${scenes.length} 已生成</span></header><div class="scene-production-grid">${scenes.map(renderSceneCard).join('')}</div></section>` : ''}
    ${scenes.length && (workflow.generated_count || 0) > 0 ? `<details class="scene-advanced-details"><summary>查看空间、机位与人物关系</summary>${renderSceneWorldWorkspace(bundle)}</details>` : ''}`;

  bindScenePlanUpdate(host, context);
  bindSceneCards(host, context);
  if (scenes.length && (workflow.generated_count || 0) > 0) bindSceneWorldWorkspace(host, bundle, store);
  host.querySelector('[data-confirm-scenes]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在确认…');
    try {
      await store.updateRequest({ scene_setup_confirmed: true }, { skipRefresh: true });
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
    } catch (error) {
      toast(error.message || '确认场景失败', 'error');
      setButtonBusy(button, false);
    }
  });
}
