export function createSceneCardEditorRuntime(host, context) {
  const editorControllers = new Map(); const editorPromises = new Map();
  host.addEventListener('change', ({ target }) => {
    if (!target.matches('[data-scene-quality]')) return;
    target.closest('[data-scene-card]').querySelector('[data-scene-resolution]').value = target.value === 'low' ? '720P' : '2K';
  });
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
    const promise = import('./scenePromptEditor.js?v=20260901-production-v378').then(module => {
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
  return { cardFor, controllerFor, switchTab, destroy: () => editorControllers.forEach(controller => controller.destroy?.()) };
}
