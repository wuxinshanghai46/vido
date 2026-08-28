import { setButtonBusy, toast } from '../components/ui.js?v=20260828-production-v253';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260828-production-v253';
import { bindSceneQaActions, submitSceneFix } from './sceneQaActions.js?v=20260828-production-v253';
import { createSceneCardEditorRuntime } from './sceneCardEditorRuntime.js?v=20260828-production-v253';
import { buildSceneBatchActionPlan } from './sceneBatchActionPlan.js?v=20260828-production-v253';

export function bindSceneCards(host, context) {
  const editorRuntime = createSceneCardEditorRuntime(host, context);
  const { controllerFor, cardFor, switchTab } = editorRuntime;
  const submitScene = async (scene, button) => {
    const sceneId = String(scene.id || scene.scene_id || '');
    const card = button?.closest('[data-scene-card]') || cardFor(sceneId);
    setButtonBusy(button, true, '正在生成…');
    const promptState = scene.prompt_state || {};
    const quality = card?.querySelector('[data-scene-quality]')?.value || 'standard';
    const resolution = card?.querySelector('[data-scene-resolution]')?.value || '2K';
    const aspectRatio = context.bundle?.brief?.output_ratio || context.bundle?.project?.request?.output_ratio || '16:9';
    const result = await context.store.runStage('scene-assets', {
      space_id: sceneId, scene_id: sceneId, name: scene.name,
      prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
      quality, resolution, aspect_ratio: aspectRatio, count: 1,
    });
    if (!result.accepted) throw new Error(result.message || '生成未被接受');
    if (card) switchTab(card, 'images');
    return result;
  };
  bindSceneQaActions({ host, context, controllerFor, cardFor });
  host.querySelectorAll('[data-generate-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = button.dataset.generateScene;
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    setButtonBusy(button, true, '正在准备…');
    try {
      const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId });
      if (!confirmation.accepted) return;
      await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', sceneId, reviewBatch: confirmation.reviewBatch });
      context.store.beginStageSubmission?.('scene_asset', 1, '正在提交场景生成任务。');
      await (await controllerFor(sceneId))?.flush();
      await submitScene(scene, button);
      toast('任务已提交'); await context.refreshShell();
    } catch (error) { toast(error.message || '生成场景失败', 'error'); setButtonBusy(button, false); }
  }));
  host.querySelector('[data-run-scene-actions]')?.addEventListener('click', async event => {
    const batchButton = event.currentTarget;
    setButtonBusy(batchButton, true, '正在准备…');
    const activeTargets = Object.values(context.bundle?.project?.active_target_generations || {});
    const plan = buildSceneBatchActionPlan(context.bundle.assets?.scenes || [], activeTargets);
    if (!plan.count) { setButtonBusy(batchButton, false); return toast('当前没有需要处理的场景'); }
    try {
      await Promise.all(plan.ready.map(async item => {
        await (await controllerFor(item.sceneId))?.flush();
      }));
    } catch { setButtonBusy(batchButton, false); return; }
    let confirmation = { accepted: true, reviewBatch: { reviews: [] } };
    if (plan.requiresBillingConfirmation) {
      confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes' });
      if (!confirmation.accepted) { setButtonBusy(batchButton, false); return; }
      await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', reviewBatch: confirmation.reviewBatch });
    }
    if (plan.generate.length) context.store.beginStageSubmission?.('scene_asset', plan.generate.length, `正在提交 ${plan.generate.length} 个场景生成任务。`);
    setButtonBusy(batchButton, true, '正在提交…');
    const results = await Promise.allSettled(plan.ready.map(item => {
      const { scene, sceneId, action } = item;
      if (action.kind === 'generate') {
        const button = [...host.querySelectorAll('[data-generate-scene]')]
          .find(candidate => String(candidate.dataset.generateScene || '') === sceneId);
        return submitScene(scene, button);
      }
      const button = [...host.querySelectorAll('[data-fix-scene]')]
        .find(candidate => String(candidate.dataset.fixScene || '') === sceneId);
      return submitSceneFix({ context, controllerFor, cardFor, scene, button, refresh: false, billingAuthorized: true, promptFlushed: true });
    }));
    const accepted = results.filter(item => item.status === 'fulfilled' && item.value?.accepted !== false).length;
    const failed = results.length - accepted;
    if (accepted) toast(`已开始处理 ${accepted} 个场景${failed ? `，${failed} 个未提交` : ''}`, failed ? 'warning' : 'success');
    else toast(results.find(item => item.status === 'rejected')?.reason?.message || '场景任务没有提交成功', 'error');
    await context.refreshShell();
  });
  return editorRuntime.destroy;
}
