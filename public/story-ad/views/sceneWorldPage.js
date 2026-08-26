import { renderSceneWorldWorkspace, bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260826-production-v231a';
import { setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v231a';
import { confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260826-production-v231a';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260826-production-v231a';
import { renderSceneProductionCard, scenePromptPreviewMarkup, scenePromptPreviewState, startInitialScenePlan } from './scenePromptPreview.js?v=20260826-production-v231a';

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

  host.querySelectorAll('[data-confirm-scene-prompt]').forEach(button => {
    button.addEventListener('click', async () => {
      const sceneId = button.dataset.confirmScenePrompt;
      const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
      if (!scene) return toast('未找到对应场景', 'error');
      setButtonBusy(button, true, '正在确认…');
      try {
        await context.store.confirmScenePrompt(scene);
        toast('提示词已确认，可以生成该场景画面。', 'success');
        await context.refreshShell();
      } catch (error) {
        toast(error.message || '确认提示词失败', 'error');
        setButtonBusy(button, false);
      }
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
        const result = await context.store.runStage('scene-assets', {
          space_id: sceneId,
          scene_id: sceneId,
          name: scene.name,
          confirmation_id: scene.prompt_confirmation?.confirmation_id || '',
        });
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
  const preview = scenePromptPreviewState(bundle, scenePlanReady, generationActive);

  host.innerHTML = `<section class="view-head scene-view-head"><div><h1>场景</h1><p>默认查看场景画面，需要时可切换到提示词核对。</p></div><div class="scene-view-actions"><span>${scenes.length ? '' : '预计 '}${preview.displayedCount} 个场景</span>${canConfirm ? '<button class="btn primary compact" data-confirm-scenes>确认场景，进入线稿</button>' : ''}</div></section>
    ${scenePlanReady ? '' : scenePlanBlockedView(sceneEligibility, generationActive, { automatic: preview.autoInitialize || generationActive })}
    ${!scenePlanReady ? scenePromptPreviewMarkup(preview, (scene, index) => renderSceneProductionCard(scene, index, { provisional: true })) : ''}
    ${scenePlanReady && scenes.length ? `<section class="scene-production"><header><div><h2>场景提示词与画面</h2><p>逐个核对提示词和生成结果；未生成画面不能进入线稿。</p></div><span>${workflow.generated_count || 0}/${scenes.length} 已生成</span></header><div class="scene-production-grid">${scenes.map(renderSceneProductionCard).join('')}</div></section>` : ''}
    ${scenes.length && (workflow.generated_count || 0) > 0 ? `<details class="scene-advanced-details"><summary>查看空间、机位与人物关系</summary>${renderSceneWorldWorkspace(bundle)}</details>` : ''}`;

  bindScenePlanUpdate(host, context);
  bindSceneCards(host, context);
  if (preview.autoInitialize) startInitialScenePlan(bundle, store);
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
