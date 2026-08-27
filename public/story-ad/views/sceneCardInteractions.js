import { setButtonBusy, toast } from '../components/ui.js?v=20260827-production-v233i';
import { confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260827-production-v233i';
import { sceneNeedsGeneration } from './sceneDossierCard.js?v=20260827-production-v233i';

export function bindSceneCards(host, context) {
  const editorControllers = new Map(); const editorPromises = new Map();
  const taskId = String(context.bundle?.project?.id || '');
  const tabKey = sceneId => `vido:scene-detail-tab:${taskId}:${sceneId}`;
  const rememberTab = (key, value) => { try { globalThis.sessionStorage?.setItem(key, value); } catch {} };
  const recalledTab = key => { try { return globalThis.sessionStorage?.getItem(key) || ''; } catch { return ''; } };
  const switchTab = (card, selected, remember = true) => {
    card.querySelectorAll('[data-scene-detail-tab]').forEach(tab => tab.classList.toggle('is-active', tab.dataset.sceneDetailTab === selected));
    card.querySelectorAll('[data-scene-detail-pane]').forEach(pane => { pane.hidden = pane.dataset.sceneDetailPane !== selected; });
    if (remember) rememberTab(tabKey(card.dataset.sceneId || ''), selected);
  };
  host.querySelectorAll('[data-scene-card]').forEach(card => {
    switchTab(card, recalledTab(tabKey(card.dataset.sceneId || '')) || card.dataset.defaultSceneTab || 'prompt', false);
    const promise = import('./scenePromptEditor.js?v=20260827-production-v233i').then(module => {
      const controller = module.bindScenePromptEditor(card, context);
      if (controller) editorControllers.set(card.dataset.sceneId || '', controller);
      return controller;
    });
    editorPromises.set(card.dataset.sceneId || '', promise);
  });
  const controllerFor = async sceneId => editorControllers.get(sceneId) || await editorPromises.get(sceneId);
  const cardFor = sceneId => [...host.querySelectorAll('[data-scene-card]')]
    .find(card => String(card.dataset.sceneId || '') === String(sceneId)) || null;
  host.querySelectorAll('[data-scene-detail-tab]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-scene-card]'); if (!card) return;
    if (button.dataset.sceneDetailTab !== 'prompt') { try { await (await controllerFor(card.dataset.sceneId || ''))?.flush(); } catch { return; } }
    switchTab(card, button.dataset.sceneDetailTab);
  }));
  const submitScene = async (scene, button) => {
    const sceneId = String(scene.id || scene.scene_id || '');
    const card = button?.closest('[data-scene-card]') || cardFor(sceneId);
    setButtonBusy(button, true, '正在生成…');
    const promptState = scene.prompt_state || {};
    const result = await context.store.runStage('scene-assets', {
      space_id: sceneId, scene_id: sceneId, name: scene.name,
      prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || '',
    });
    if (!result.accepted) throw new Error(result.message || '生成未被接受');
    if (card) switchTab(card, 'images');
    return result;
  };
  host.querySelectorAll('[data-generate-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = button.dataset.generateScene;
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    try { await (await controllerFor(sceneId))?.flush(); } catch { return; }
    const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId,
      title: `生成${scene.name || '场景'}`, message: '根据自动保存的最新提示词生成场景画面，将调用图片模型并产生费用。', confirmText: '确认生成' });
    if (!confirmation.accepted) return;
    try {
      await submitScene(scene, button);
      toast('任务已提交'); await context.refreshShell();
    } catch (error) { toast(error.message || '生成场景失败', 'error'); setButtonBusy(button, false); }
  }));
  host.querySelector('[data-generate-all-scenes]')?.addEventListener('click', async event => {
    const batchButton = event.currentTarget;
    const activeTargets = context.bundle?.project?.active_target_generations && typeof context.bundle.project.active_target_generations === 'object'
      ? Object.values(context.bundle.project.active_target_generations) : [];
    const isActive = sceneId => activeTargets.some(item => item?.stage === 'scene_asset'
      && String(item?.target_id || '') === String(sceneId)
      && ['queued', 'running'].includes(String(item?.status || '')));
    const targets = (context.bundle.assets?.scenes || []).filter(scene => sceneNeedsGeneration(scene)
      && !isActive(scene.id || scene.scene_id));
    if (!targets.length) return toast('没有需要生成的场景');
    try {
      await Promise.all(targets.map(async scene => {
        const sceneId = String(scene.id || scene.scene_id || '');
        await (await controllerFor(sceneId))?.flush();
      }));
    } catch { return; }
    const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes',
      title: `生成全部缺失场景（${targets.length}）`, message: `将根据各场景自动保存的最新提示词，同时提交 ${targets.length} 个独立场景任务，并产生图片模型费用。`, confirmText: '确认全部生成' });
    if (!confirmation.accepted) return;
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
  return () => editorControllers.forEach(controller => controller.destroy?.());
}
