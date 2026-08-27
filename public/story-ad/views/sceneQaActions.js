import { setButtonBusy, toast } from '../components/ui.js?v=20260827-production-v238e';
import { confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260827-production-v238e';

export function bindSceneQaActions({ host, context, controllerFor, cardFor }) {
  const repairBody = (scene, button) => {
    const sceneId = String(scene.id || scene.scene_id || '');
    const card = button?.closest('[data-scene-card]') || cardFor(sceneId);
    const promptState = scene.prompt_state || {};
    return {
      scene_id: sceneId, space_id: sceneId, name: scene.name,
      prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
      quality: card?.querySelector('[data-scene-quality]')?.value || 'standard',
      resolution: card?.querySelector('[data-scene-resolution]')?.value || '2K',
      aspect_ratio: context.bundle?.brief?.output_ratio || context.bundle?.project?.request?.output_ratio || '16:9',
    };
  };
  host.querySelectorAll('[data-reverify-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = String(button.dataset.reverifyScene || '');
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    try {
      setButtonBusy(button, true, '正在再次验证…', { elapsed: true });
      const result = await context.store.runStage(`scene-assets/${encodeURIComponent(sceneId)}/verify`);
      const updated = result.scene_asset || {};
      if (updated.scene_contract?.full_space_lock === true || updated.qa?.full_space_lock === true) toast('一致性 QA 已通过，图片已锁定；图片调用 0 次。', 'success');
      else toast(updated.repair_plan?.message || '再次验证完成，仍有未通过项；图片调用 0 次。', 'warning');
      await context.refreshShell();
    } catch (error) { toast(error.message || '再次验证失败', 'error'); } finally { setButtonBusy(button, false); }
  }));
  host.querySelectorAll('[data-repair-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = String(button.dataset.repairScene || '');
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    setButtonBusy(button, true, '正在准备修复…');
    try {
      await (await controllerFor(sceneId))?.flush();
      const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId, authorizeReviews: true });
      if (!confirmation.accepted) return;
      const result = await context.store.runStage(`scene-assets/${encodeURIComponent(sceneId)}/repair`, repairBody(scene, button));
      if (result.accepted === false) throw new Error(result.message || '修复任务未被接受');
      toast(scene.repair_plan?.action === 'rebuild_atlas' ? '空间母图与布局重建任务已提交。' : '失败视图修复任务已提交。', 'success');
      await context.refreshShell();
    } catch (error) { toast(error.message || '场景修复失败', 'error'); } finally { setButtonBusy(button, false); }
  }));
}
