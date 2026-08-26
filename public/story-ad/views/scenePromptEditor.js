import { setButtonBusy, toast } from '../components/ui.js?v=20260826-production-v231d';

export function bindScenePromptEditor(card, context) {
  const button = card?.querySelector('[data-save-scene-prompt]');
  if (!button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';
  button.addEventListener('click', async () => {
    const sceneId = button.dataset.saveScenePrompt;
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
    const editor = card.querySelector('[data-scene-prompt-editor]');
    if (!scene || !editor) return toast('未找到对应场景提示词', 'error');
    setButtonBusy(button, true, '正在保存…');
    try {
      await context.store.saveScenePrompt(scene, editor.value);
      toast('提示词已保存，请重新确认后生成画面。', 'success');
      await context.refreshShell();
    } catch (error) {
      toast(error.message || '保存提示词失败', 'error');
      setButtonBusy(button, false);
    }
  });
}
