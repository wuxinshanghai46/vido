import { toast } from '../components/ui.js?v=20260901-production-v362';
import { bindTextAutosave } from '../components/textAutosave.js?v=20260901-production-v362';

export function bindScenePromptEditor(card, context) {
  const editor = card?.querySelector('[data-scene-prompt-editor]');
  if (!editor || editor.dataset.bound === 'true') return null;
  editor.dataset.bound = 'true';
  const status = card.querySelector('[data-autosave-state]');
  return bindTextAutosave({
    input: editor,
    status,
    save: async value => {
      const sceneId = editor.dataset.scenePromptEditor;
    const scene = (context.bundle.assets?.scenes || []).find(item => String(item.id || item.scene_id) === sceneId);
      if (!scene) throw new Error('未找到对应场景提示词');
      const result = await context.store.saveScenePrompt(scene, value);
      const promptState = result?.prompt_state || {};
      scene.generation_prompt = value.trim();
      scene.prompt_state = promptState;
      card.dataset.promptVersionId = promptState.prompt_version_id || '';
      return promptState;
    },
    onError: error => toast(error.message || '保存提示词失败', 'error'),
  });
}
