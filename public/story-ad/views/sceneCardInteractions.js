import { setButtonBusy, toast } from '../components/ui.js?v=20260830-production-v316';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260830-production-v316';
import { createSceneCardEditorRuntime } from './sceneCardEditorRuntime.js?v=20260830-production-v316';
import { buildSceneBatchActionPlan } from './sceneBatchActionPlan.js?v=20260830-production-v316';

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
    const imageModel = context.selectedSceneImageModel?.();
    if (!imageModel) throw new Error('请先选择本次场景生成模型');
    const result = await context.store.runStage('scene-assets', {
      space_id: sceneId, scene_id: sceneId, name: scene.name,
      prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
      quality, resolution, aspect_ratio: aspectRatio, count: 1, image_model: imageModel,
    });
    if (!result.accepted) throw new Error(result.message || '生成未被接受');
    if (card) switchTab(card, 'images');
    return result;
  };
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
      toast('任务已提交'); await context.refreshCurrentView();
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
    try {
      let confirmation = { accepted: true, reviewBatch: { reviews: [] } };
      if (plan.requiresBillingConfirmation) {
        confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes' });
        if (!confirmation.accepted) { setButtonBusy(batchButton, false); return; }
        await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', reviewBatch: confirmation.reviewBatch });
      }
      const actions = plan.ready.map(({ scene, sceneId, action }) => {
        const card = cardFor(sceneId);
        return {
          scene_id: sceneId,
          name: scene.name,
          action: String(scene?.repair_plan?.action || (action.kind === 'generate' ? 'generate' : 'repair')),
          image_total: action.billable === false ? 0 : Math.max(1, Number(scene?.repair_plan?.count || 5) || 5),
          prompt_version_id: card?.dataset.promptVersionId || scene.prompt_state?.prompt_version_id || '',
          quality: card?.querySelector('[data-scene-quality]')?.value || 'standard',
          resolution: card?.querySelector('[data-scene-resolution]')?.value || '2K',
          aspect_ratio: context.bundle?.brief?.output_ratio || context.bundle?.project?.request?.output_ratio || '16:9',
        };
      });
      const startedAt = new Date().toISOString();
      const targetProgress = Object.fromEntries(actions.map(action => {
        const imageTotal = Math.max(0, Number(action.image_total || 0) || 0);
        return [`scene_asset:${action.scene_id}`, {
          status: 'queued', phase: action.action === 'reverify' ? 'verification' : 'generation',
          target_total: Math.max(1, imageTotal || 1), processed: 0,
          image_target_total: imageTotal, started_at: startedAt,
        }];
      }));
      context.store.beginStageSubmission?.('scene_asset', plan.count, `正在提交 ${plan.count} 个场景的并行处理任务。`, {
        mode: 'scene_batch', batch_actions: actions, target_progress: targetProgress,
      });
      setButtonBusy(batchButton, true, '正在提交…');
      await context.refreshCurrentView();
      const imageModel = context.selectedSceneImageModel?.();
      if (!imageModel) throw new Error('请先选择本次场景生成模型');
      const result = await context.store.runStage('scene-actions', {
        actions,
        image_model: imageModel,
        request_key: `scene-batch:${context.bundle?.revisions?.content || 1}:${actions.map(item => `${item.scene_id}:${item.prompt_version_id}`).join('|')}`,
      });
      if (result.accepted === false) throw new Error(result.message || '场景并行处理任务未被接受');
      toast(`已开始并行处理 ${plan.count} 个场景`, 'success');
      await context.refreshCurrentView();
    } catch (error) {
      toast(error.message || '场景并行处理任务没有提交成功', 'error');
      setButtonBusy(batchButton, false);
      try {
        await context.store.refreshSections?.('summary,assets');
        await context.refreshCurrentView();
      } catch {}
    }
  });
  return editorRuntime.destroy;
}

export function bindSceneCompletionActions(host, context) {
  const { bundle, store } = context;
  host.querySelector('[data-accept-current-scenes]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在继续…');
    try {
      const result = await store.acceptCurrentScenes();
      const storyboard = result.bundle?.navigation?.steps?.storyboard;
      if (storyboard?.enabled === false) throw new Error(storyboard.blocker || '分镜尚未解锁');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
    } catch (error) {
      toast(error.message || '无法使用当前图片继续', 'error');
      setButtonBusy(button, false);
    }
  });
}
