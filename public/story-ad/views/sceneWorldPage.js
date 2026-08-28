import { bindSceneWorldWorkspace } from './sceneWorldView.js?v=20260829-production-v257b';
import { setButtonBusy, toast } from '../components/ui.js?v=20260829-production-v257b';
import { bindScenePlanUpdate, scenePlanBlockedView } from './scenePlanStatus.js?v=20260829-production-v257b';
import { renderSceneProductionCard, scenePromptPreviewMarkup, scenePromptPreviewState, startInitialScenePlan } from './scenePromptPreview.js?v=20260829-production-v257b';
import { bindMediaLightbox } from './mediaLightbox.js?v=20260829-production-v257b';
import { buildSceneBatchActionPlan } from './sceneBatchActionPlan.js?v=20260829-production-v257b';
import { bindGenerationModelPicker, loadGenerationModelPicker } from './generationModelPicker.js?v=20260829-production-v257b';

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
  const batchSceneIds = new Set(Array.isArray(generationProgress.batch_scene_ids) ? generationProgress.batch_scene_ids.map(String) : []);
  const sceneIsActive = sceneId => activeTargets.some(item => {
    const status = String(item?.status || '').toLowerCase();
    return ['scene_asset', 'scene_qa'].includes(String(item?.stage || ''))
      && String(item?.target_id || item?.scope_id || '') === String(sceneId)
      && (!status || ['queued', 'running', 'processing', 'verifying'].includes(status));
  }) || (batchActive && (!batchSceneIds.size || batchSceneIds.has(String(sceneId))));
  const targetProgress = bundle?.project?.target_generation_progress && typeof bundle.project.target_generation_progress === 'object'
    ? bundle.project.target_generation_progress : {};
  const sceneActiveTarget = sceneId => activeTargets.find(item => ['scene_asset', 'scene_qa'].includes(String(item?.stage || ''))
    && String(item?.target_id || item?.scope_id || '') === String(sceneId));
  const sceneProgress = sceneId => {
    if (batchActive && (!batchSceneIds.size || batchSceneIds.has(String(sceneId)))) return generationProgress;
    const activeTarget = sceneActiveTarget(sceneId);
    const activeKey = activeTarget ? `${activeTarget.stage}:${sceneId}` : '';
    return (activeKey ? targetProgress[activeKey] : null)
    || targetProgress[`scene_qa:${sceneId}`]
    || targetProgress[`scene_asset:${sceneId}`]
    || Object.values(targetProgress).find(item => String(item?.scene_id || item?.scope_id || '') === String(sceneId))
    || null;
  };
  const sceneActionPlan = buildSceneBatchActionPlan(scenes, activeTargets);
  const modelPicker = await loadGenerationModelPicker(bundle.project.id, 'new_story_ad.scene_asset', { label: '生成模型' });
  const canConfirm = workflow.visuals_complete === true && scenes.length > 0
  const preview = scenePromptPreviewState(bundle, scenePlanReady || persistedScenePlanReady, generationActive);

  host.innerHTML = `<section class="view-head scene-view-head"><div><h1>场景</h1><p>默认查看场景画面，需要时可切换到提示词核对。</p></div><div class="scene-view-actions"><span>${scenes.length ? '' : '预计 '}${preview.displayedCount} 个场景</span>${canConfirm ? '<button class="btn primary compact" data-confirm-scenes>确认场景，进入线稿</button>' : ''}</div></section>
    ${scenePlanReady || persistedScenePlanReady ? '' : scenePlanBlockedView(sceneEligibility, generationActive, { automatic: preview.autoInitialize || generationActive })}
    ${!scenePlanReady && !persistedScenePlanReady ? scenePromptPreviewMarkup(preview, (scene, index) => renderSceneProductionCard(scene, index, { provisional: true })) : ''}
    ${persistedScenePlanReady ? `<section class="scene-production"><header><div><h2>场景提示词与画面</h2><p>提示词修改后自动保存；已有或生成中的画面默认展示，需要时可切回提示词。</p></div><div class="scene-view-actions"><span>${workflow.generated_count || 0}/${scenes.length} 已生成</span>${sceneActionPlan.count ? `${modelPicker.html}<button class="btn primary compact" data-run-scene-actions>继续完成场景（${sceneActionPlan.count}）</button>` : ''}</div></header><div class="scene-production-grid">${scenes.map((scene, index) => { const sceneId = scene.id || scene.scene_id; return renderSceneProductionCard(scene, index, { generationActive: sceneIsActive(sceneId), progress: sceneProgress(sceneId) }); }).join('')}</div></section>` : ''}`;

  context.selectedSceneImageModel = bindGenerationModelPicker(host, modelPicker);

  bindScenePlanUpdate(host, context);
  bindMediaLightbox(host);
  const cleanupSceneCards = (await import('./sceneCardInteractions.js?v=20260829-production-v257b')).bindSceneCards(host, context);
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
  return cleanupSceneCards;
}
