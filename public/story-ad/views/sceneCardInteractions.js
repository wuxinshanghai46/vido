import { setButtonBusy, toast } from '../components/ui.js?v=20260828-production-v247';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260828-production-v247';
import { sceneNeedsGeneration } from './sceneDossierCard.js?v=20260828-production-v247';
import { scenePendingAction } from './scenePromptPreview.js?v=20260828-production-v247';
import { bindSceneQaActions, submitSceneFix } from './sceneQaActions.js?v=20260828-production-v247';
import { createSceneCardEditorRuntime } from './sceneCardEditorRuntime.js?v=20260828-production-v247';

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
  host.querySelector('[data-generate-all-scenes]')?.addEventListener('click', async event => {
    const batchButton = event.currentTarget;
    setButtonBusy(batchButton, true, '正在准备…');
    const activeTargets = context.bundle?.project?.active_target_generations && typeof context.bundle.project.active_target_generations === 'object'
      ? Object.values(context.bundle.project.active_target_generations) : [];
    const isActive = sceneId => activeTargets.some(item => item?.stage === 'scene_asset'
      && String(item?.target_id || '') === String(sceneId)
      && ['queued', 'running'].includes(String(item?.status || '')));
    const targets = (context.bundle.assets?.scenes || []).filter(scene => sceneNeedsGeneration(scene)
      && !isActive(scene.id || scene.scene_id));
    if (!targets.length) { setButtonBusy(batchButton, false); return toast('没有需要生成的场景'); }
    const generationConfirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes' });
    if (!generationConfirmation.accepted) { setButtonBusy(batchButton, false); return; }
    context.store.beginStageSubmission?.('scene_asset', targets.length, `正在提交 ${targets.length} 个场景生成任务。`);
    try {
      await Promise.all(targets.map(async scene => {
        const sceneId = String(scene.id || scene.scene_id || '');
        await (await controllerFor(sceneId))?.flush();
      }));
    } catch { setButtonBusy(batchButton, false); return; }
    await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', reviewBatch: generationConfirmation.reviewBatch });
    setButtonBusy(batchButton, true, '正在提交…');
    const results = await Promise.allSettled(targets.map(scene => {
      const sceneId = String(scene.id || scene.scene_id || '');
      const button = [...host.querySelectorAll('[data-generate-scene]')]
        .find(item => String(item.dataset.generateScene || '') === sceneId);
      return submitScene(scene, button);
    }));
    const accepted = results.filter(item => item.status === 'fulfilled').length;
    const failed = results.length - accepted;
    if (accepted) toast(`已提交 ${accepted} 个场景任务${failed ? `，${failed} 个未提交` : ''}`, failed ? 'warning' : 'success');
    else toast(results.find(item => item.status === 'rejected')?.reason?.message || '全部场景提交失败', 'error');
    await context.refreshShell();
  });
  host.querySelector('[data-fix-all-scenes]')?.addEventListener('click', async event => {
    const batchButton = event.currentTarget;
    setButtonBusy(batchButton, true, '正在提交修复…', { elapsed: true });
    const targets = (context.bundle.assets?.scenes || []).filter(scene => scenePendingAction(scene)?.kind === 'fix');
    if (!targets.length) { setButtonBusy(batchButton, false); return toast('没有需要修复的场景'); }
    const fixConfirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes' });
    if (!fixConfirmation.accepted) { setButtonBusy(batchButton, false); return; }
    await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', reviewBatch: fixConfirmation.reviewBatch });
    context.store.beginStageSubmission?.('scene_asset', targets.length, `正在提交 ${targets.length} 个场景修复任务。`);
    const results = await Promise.allSettled(targets.map(scene => {
      const sceneId = String(scene.id || scene.scene_id || '');
      const button = [...host.querySelectorAll('[data-fix-scene]')]
        .find(item => String(item.dataset.fixScene || '') === sceneId);
      return submitSceneFix({ context, controllerFor, cardFor, scene, button, refresh: false, billingAuthorized: true });
    }));
    const accepted = results.filter(item => item.status === 'fulfilled' && item.value?.accepted !== false).length;
    const failed = results.length - accepted;
    if (accepted) toast(`已提交 ${accepted} 个场景修复任务${failed ? `，${failed} 个未提交` : ''}`, failed ? 'warning' : 'success');
    else toast(results.find(item => item.status === 'rejected')?.reason?.message || '全部场景修复提交失败', 'error');
    await context.refreshShell();
  });
  return editorRuntime.destroy;
}
