import { bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260901-production-v375';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260901-production-v375';
import { renderSceneProductionCard, scenePromptPreviewMarkup, scenePromptPreviewState, startInitialScenePlan } from './scenePromptPreview.js?v=20260901-production-v375';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260901-production-v375';
import { buildSceneBatchActionPlan } from './sceneBatchActionPlan.js?v=20260901-production-v375';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260901-production-v375';
import { normalizeSceneDossier } from './sceneDossierCard.js?v=20260901-production-v375';
import { bindSceneConfirmAction } from './sceneQaPublicState.js?v=20260901-production-v375';

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

  const completionAction = canConfirm
    ? '<button class="btn primary compact" data-confirm-scenes>确认场景，进入剧情流向</button>'
    : (canAcceptCurrent ? '<button class="btn primary compact" data-accept-current-scenes>使用当前图片继续</button>' : '');
  host.innerHTML = `<section class="view-head scene-view-head"><div><h1>场景</h1><p>默认查看场景画面，需要时可切换到提示词核对。</p></div></section>
    ${scenePlanReady || persistedScenePlanReady ? '' : scenePlanBlockedView(sceneEligibility, generationActive, { automatic: preview.autoInitialize || generationActive })}
    ${!scenePlanReady && !persistedScenePlanReady ? scenePromptPreviewMarkup(preview, (scene, index) => renderSceneProductionCard(scene, index, { provisional: true })) : ''}
    ${persistedScenePlanReady ? `<section class="scene-production"><header><div><h2>场景提示词与画面</h2><p>提示词修改后自动保存；已有或生成中的画面默认展示，需要时可切回提示词。</p></div><div class="scene-view-actions"><span>Image ${imageSummary[0]}/${imageSummary[1]}</span>${sceneActionPlan.count ? `${modelPicker.html}<button class="btn primary compact" data-run-scene-actions>${onlyReverify ? '重新审核场景' : '继续完成场景'}（${sceneActionPlan.count}）</button>` : ''}${completionAction}</div></header><div class="scene-production-grid">${scenes.map((scene, index) => { const sceneId = scene.id || scene.scene_id; return renderSceneProductionCard(scene, index, { generationActive: sceneIsActive(sceneId), batchManaged: unifiedActionManaged, progress: sceneProgress(sceneId) }); }).join('')}</div></section>` : ''}`;

  context.selectedSceneImageModel = bindGenerationModelPicker(host, modelPicker);

  bindScenePlanUpdate(host, context);
  bindMediaLightbox(host);
  const sceneInteractions = await import('./sceneCardInteractions.js?v=20260901-production-v375');
  const cleanupSceneCards = sceneInteractions.bindSceneCards(host, context);
  sceneInteractions.bindSceneCompletionActions(host, context);
  bindSceneConfirmAction(host, context);
  if (preview.autoInitialize) startInitialScenePlan(bundle, store);
  if (scenes.length && (workflow.generated_count || 0) > 0) bindSceneWorldWorkspace(host, bundle, store);
  return cleanupSceneCards;
}
