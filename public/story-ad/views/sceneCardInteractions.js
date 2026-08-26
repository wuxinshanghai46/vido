import { setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v232b';
import { confirmBillingAwareAction } from './assetCenterBillingRetry.js?v=20260826-production-v232b';

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
    const promise = import('./scenePromptEditor.js?v=20260826-production-v232b').then(module => {
      const controller = module.bindScenePromptEditor(card, context);
      if (controller) editorControllers.set(card.dataset.sceneId || '', controller);
      return controller;
    });
    editorPromises.set(card.dataset.sceneId || '', promise);
  });
  const controllerFor = async sceneId => editorControllers.get(sceneId) || await editorPromises.get(sceneId);
  host.querySelectorAll('[data-scene-detail-tab]').forEach(button => button.addEventListener('click', async () => {
    const card = button.closest('[data-scene-card]'); if (!card) return;
    if (button.dataset.sceneDetailTab !== 'prompt') { try { await (await controllerFor(card.dataset.sceneId || ''))?.flush(); } catch { return; } }
    switchTab(card, button.dataset.sceneDetailTab);
  }));
  host.querySelectorAll('[data-generate-scene]').forEach(button => button.addEventListener('click', async () => {
    const sceneId = button.dataset.generateScene;
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    if (!scene) return toast('未找到对应场景', 'error');
    try { await (await controllerFor(sceneId))?.flush(); } catch { return; }
    const confirmation = await confirmBillingAwareAction({ bundle: context.bundle, lane: 'scenes', sceneId,
      title: `生成${scene.name || '场景'}`, message: '根据自动保存的最新提示词生成场景画面，将调用图片模型并产生费用。', confirmText: '确认生成' });
    if (!confirmation.accepted) return;
    setButtonBusy(button, true, '正在生成…');
    try {
      const card = button.closest('[data-scene-card]');
      const promptState = scene.prompt_state || scene.prompt_confirmation || {};
      const result = await context.store.runStage('scene-assets', { space_id: sceneId, scene_id: sceneId, name: scene.name,
        prompt_version_id: card?.dataset.promptVersionId || promptState.prompt_version_id || promptState.confirmation_id || '' });
      if (!result.accepted) throw new Error(result.message || '生成未被接受');
      toast('任务已提交'); if (card) switchTab(card, 'images'); await context.refreshShell();
    } catch (error) { toast(error.message || '生成场景失败', 'error'); setButtonBusy(button, false); }
  }));
  return () => editorControllers.forEach(controller => controller.destroy?.());
}
