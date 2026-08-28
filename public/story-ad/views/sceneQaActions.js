import { setButtonBusy, toast } from '../components/ui.js?v=20260828-production-v246';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260828-production-v246';

export async function submitSceneFix({ context, controllerFor, cardFor, scene, button, refresh = true, billingAuthorized = false }) {
  const sceneId = String(scene.id || scene.scene_id || '');
  const card = button?.closest('[data-scene-card]') || cardFor(sceneId);
  const promptState = scene.prompt_state || {};
  setButtonBusy(button, true, '正在定位并修复…', { elapsed: true });
  if (!billingAuthorized) {
    const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId });
    if (!confirmation.accepted) return { accepted: false, cancelled: true };
    await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', sceneId, reviewBatch: confirmation.reviewBatch });
  }
  context.store.beginStageSubmission?.('scene_asset', 1, '正在提交场景修复，成功资产会继续保留。');
  await (await controllerFor(sceneId))?.flush();
  const result = await context.store.runStage(`scene-assets/${encodeURIComponent(sceneId)}/fix`, {
    scene_id: sceneId, space_id: sceneId, name: scene.name,
    prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
    quality: card?.querySelector('[data-scene-quality]')?.value || 'standard',
    resolution: card?.querySelector('[data-scene-resolution]')?.value || '2K',
    aspect_ratio: context.bundle?.brief?.output_ratio || context.bundle?.project?.request?.output_ratio || '16:9',
    request_key: `scene-fix:${sceneId}:${scene.scene_revision || scene.revision || 1}:${scene.repair_plan?.version || 1}:${scene.repair_plan?.action || 'unknown'}`,
  });
  if (result.accepted === false) throw new Error(result.message || '修复任务未被接受');
  if (refresh) await context.refreshShell();
  return result;
}

export function bindSceneQaActions({ host, context, controllerFor, cardFor }) {
  host.querySelectorAll('[data-fix-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = String(button.dataset.fixScene || '');
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    try {
      const result = await submitSceneFix({ context, controllerFor, cardFor, scene, button });
      if (result?.cancelled) return;
      toast('修复任务已提交：系统会自动定位、修复并复核。', 'success');
    } catch (error) { toast(error.message || '修复未通过项失败', 'error'); } finally { setButtonBusy(button, false); }
  }));
}
