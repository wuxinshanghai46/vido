import { bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260829-production-v275';
import { setButtonBusy, toast } from '../components/ui.js?v=20260829-production-v275';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260829-production-v275';
import { renderSceneProductionCard, scenePromptPreviewMarkup, scenePromptPreviewState, startInitialScenePlan } from './scenePromptPreview.js?v=20260829-production-v276';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260829-production-v275';
import { buildSceneBatchActionPlan } from './sceneBatchActionPlan.js?v=20260829-production-v275';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260829-production-v275';
import { normalizeSceneDossier } from './sceneDossierCard.js?v=20260829-production-v276';

export function latestSceneTargetProgress(progress = {}, sceneId = '', generationId = '') {
  const rows = Object.values(progress).filter(item => String(item?.stage || '') === 'scene_asset'
    && String(item?.scene_id || item?.scope_id || '') === String(sceneId))
    .sort((a, b) => (Date.parse(b?.updated_at || b?.started_at || '') || 0) - (Date.parse(a?.updated_at || a?.started_at || '') || 0));
  return rows.find(item => generationId && item?.generation_id === generationId) || rows[0] || null;
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const eligibility = bundle?.navigation?.asset_plan_eligibility || {};
  const sceneEligibility = eligibility.scene || eligibility;
  const scenePlanReady = sceneEligibility.eligible === true;
  const scenes = Array.isArray(bundle.assets?.scenes) ? bundle.assets.scenes : [];
  const persistedScenePlanReady = scenes.length > 0;
  const workflow = bundle.scene_workflow || {};
  const generationActive = !!bundle?.project?.active_generation_id
  const activeTargets = bundle?.project?.active_target_generations && typeof bundle.project.active_target_generations === 'object'
    ? Object.values(bundle.project.active_target_generations) : [];
  const generationProgress = bundle?.project?.generation_progress || {};
  const batchTarget = activeTargets.find(item => String(item?.stage || '') === 'scene_asset'
    && String(item?.target_id || item?.scope_id || '') === 'scene-batch');
  const batchActive = Boolean(batchTarget || (generationActive && String(generationProgress.mode || '') === 'scene_batch'));
  const sceneIsActive = sceneId => activeTargets.some(item => {
    const status = String(item?.status || '').toLowerCase();
    return String(item?.stage || '') === 'scene_asset'
      && String(item?.target_id || item?.scope_id || '') === String(sceneId)
      && (!status || ['queued', 'running', 'processing', 'verifying'].includes(status));
  }) || ['queued', 'running', 'processing', 'verifying'].includes(String(
    targetProgress[`scene_asset:${sceneId}`]?.status || '',
  ).toLowerCase());
  const targetProgress = bundle?.project?.target_generation_progress && typeof bundle.project.target_generation_progress === 'object'
    ? bundle.project.target_generation_progress : {};
  const sceneActiveTarget = sceneId => activeTargets.find(item => String(item?.stage || '') === 'scene_asset'
    && String(item?.target_id || item?.scope_id || '') === String(sceneId));
  const sceneProgress = sceneId => {
    const activeTarget = sceneActiveTarget(sceneId);
    const activeKey = activeTarget ? `${activeTarget.stage}:${sceneId}` : '';
    return (activeKey ? targetProgress[activeKey] : null)
      || latestSceneTargetProgress(targetProgress, sceneId, bundle?.project?.active_generation_id)
      || null;
  };
  const sceneActionPlan = buildSceneBatchActionPlan(scenes, activeTargets);
  const imageSummary = scenes.map(normalizeSceneDossier)
    .reduce((sum, dossier) => [sum[0] + dossier.completed, sum[1] + dossier.total], [0, 0]);
  const unifiedActionManaged = batchActive || sceneActionPlan.count > 0;
  const modelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.scene_asset', { label: 'Image' });
  const canConfirm = workflow.visuals_complete === true && scenes.length > 0;
  const canAcceptCurrent = workflow.can_accept_current === true && !generationActive;
  const onlyReverify = sceneActionPlan.count > 0 && sceneActionPlan.ready.every(item => item.action?.billable === false);
  const preview = scenePromptPreviewState(bundle, scenePlanReady || persistedScenePlanReady, generationActive);

  host.innerHTML = `<section class="view-head scene-view-head"><div><h1>场景</h1><p>默认查看场景画面，需要时可切换到提示词核对。</p></div>${canConfirm ? '<div class="scene-view-actions"><button class="btn primary compact" data-confirm-scenes>确认场景，进入线稿</button></div>' : (canAcceptCurrent ? '<div class="scene-view-actions"><button class="btn primary compact" data-accept-current-scenes>使用当前图片继续</button></div>' : '')}</section>
    ${scenePlanReady || persistedScenePlanReady ? '' : scenePlanBlockedView(sceneEligibility, generationActive, { automatic: preview.autoInitialize || generationActive })}
    ${!scenePlanReady && !persistedScenePlanReady ? scenePromptPreviewMarkup(preview, (scene, index) => renderSceneProductionCard(scene, index, { provisional: true })) : ''}
    ${persistedScenePlanReady ? `<section class="scene-production"><header><div><h2>场景提示词与画面</h2><p>提示词修改后自动保存；已有或生成中的画面默认展示，需要时可切回提示词。</p></div><div class="scene-view-actions"><span>Image ${imageSummary[0]}/${imageSummary[1]}</span>${sceneActionPlan.count ? `${modelPicker.html}<button class="btn primary compact" data-run-scene-actions>${onlyReverify ? '重新审核场景' : '继续完成场景'}（${sceneActionPlan.count}）</button>` : ''}</div></header><div class="scene-production-grid">${scenes.map((scene, index) => { const sceneId = scene.id || scene.scene_id; return renderSceneProductionCard(scene, index, { generationActive: sceneIsActive(sceneId), batchManaged: unifiedActionManaged, progress: sceneProgress(sceneId) }); }).join('')}</div></section>` : ''}`;

  context.selectedSceneImageModel = bindGenerationModelPicker(host, modelPicker);

  bindScenePlanUpdate(host, context);
  bindMediaLightbox(host);
  const cleanupSceneCards = (await import('./sceneCardInteractions.js?v=20260829-production-v275')).bindSceneCards(host, context);
  if (preview.autoInitialize) startInitialScenePlan(bundle, store);
  if (scenes.length && (workflow.generated_count || 0) > 0) bindSceneWorldWorkspace(host, bundle, store);
  host.querySelector('[data-confirm-scenes]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在确认…');
    try {
      await store.updateRequest({ scene_setup_confirmed: true }, { skipRefresh: true });
      const refreshed = await store.refreshSections('summary,assets,story,shots');
      if (refreshed?.navigation?.steps?.storyboard?.enabled === false) throw new Error(refreshed.navigation.steps.storyboard.blocker || '线稿与分镜步骤尚未解锁');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
    } catch (error) {
      toast(error.message || '确认场景失败', 'error');
      setButtonBusy(button, false);
    }
  });
  host.querySelector('[data-accept-current-scenes]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在继续…');
    try {
      const result = await store.acceptCurrentScenes();
      if (Number(result?.model_call_count || 0) !== 0) throw new Error('当前图片接受操作不应产生模型调用');
      const refreshed = result.bundle;
      if (refreshed?.navigation?.steps?.storyboard?.enabled === false) throw new Error(refreshed.navigation.steps.storyboard.blocker || '线稿与分镜步骤尚未解锁');
      context.navigate(`/story-ad/projects/${encodeURIComponent(bundle.project.id)}?view=storyboard`);
    } catch (error) {
      toast(error.message || '无法使用当前图片继续', 'error');
      setButtonBusy(button, false);
    }
  });
  return cleanupSceneCards;
}
