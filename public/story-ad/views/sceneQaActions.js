import { setButtonBusy, toast } from '../components/ui.js?v=20260829-production-v274';
import { authorizeBillingReviews, confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260829-production-v274';

export function sceneActionErrorMessage(error = {}) {
  const raw = String(error?.message || error || '').trim();
  const code = String(error?.code || error?.data?.code || '').toUpperCase();
  if (code === 'GENERATION_ACTIVE_PLAN_REQUIRED'
    || /Active Plan|active_plan|person_plan_stale|scene_plan_stale|bundle_mismatch/i.test(raw)) {
    return '当前项目的生成版本正在同步，或已有任务正在处理。请等待当前操作结束并刷新页面后再试；本次没有提交新的模型调用。';
  }
  if (/SCENE_(?:VISUAL_)?QA|VISION_QA|视觉模型全部失败|PROVIDER_RESPONSE_INVALID|RATE_LIMIT|(?:smscrw|webang-maas|zhipu|deyunai)\//i.test(`${code} ${raw}`)) {
    return '场景图片已保留，但审核服务暂时没有完成。可以稍后重新审核；重新审核不会重新生成图片。';
  }
  return raw || '当前场景操作没有完成，请稍后重试。';
}

export async function submitSceneFix({ context, controllerFor, cardFor, scene, button, refresh = true, billingAuthorized = false, promptFlushed = false }) {
  const sceneId = String(scene.id || scene.scene_id || '');
  const card = button?.closest('[data-scene-card]') || cardFor(sceneId);
  const promptState = scene.prompt_state || {};
  const qaOnly = String(scene.repair_plan?.action || '') === 'reverify';
  const imageModel = qaOnly ? '' : context.selectedSceneImageModel?.();
  if (!qaOnly && !imageModel) throw new Error('请先选择本次场景生成模型');
  setButtonBusy(button, true, qaOnly ? '正在重新审核…' : '正在定位并修复…', { elapsed: true });
  if (!billingAuthorized && !qaOnly) {
    const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId });
    if (!confirmation.accepted) return { accepted: false, cancelled: true };
    await authorizeBillingReviews({ bundle: context.bundle, lane: 'scenes', sceneId, reviewBatch: confirmation.reviewBatch });
  }
  context.store.beginStageSubmission?.(qaOnly ? 'scene_qa' : 'scene_asset', 1, qaOnly
    ? '正在提交当前场景重新审核；已有图片全部保留，图片调用 0。'
    : '正在提交当前场景修复，成功资产会继续保留。');
  if (!promptFlushed) await (await controllerFor(sceneId))?.flush();
  const result = await context.store.runStage(`scene-assets/${encodeURIComponent(sceneId)}/fix`, {
    scene_id: sceneId, space_id: sceneId, name: scene.name,
    prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
    quality: card?.querySelector('[data-scene-quality]')?.value || 'standard',
    resolution: card?.querySelector('[data-scene-resolution]')?.value || '2K',
    aspect_ratio: context.bundle?.brief?.output_ratio || context.bundle?.project?.request?.output_ratio || '16:9',
    ...(imageModel ? { image_model: imageModel } : {}),
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
      toast(scene.repair_plan?.action === 'reverify'
        ? '当前场景已提交重新审核：已有图片全部保留，图片调用 0。'
        : '修复任务已提交：系统会自动定位、修复并复核。', 'success');
    } catch (error) { toast(sceneActionErrorMessage(error), 'error'); } finally { setButtonBusy(button, false); }
  }));
}
