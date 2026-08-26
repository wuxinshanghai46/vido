import { toast } from '../components/ui.js?v=20260826-production-v233a';
import { bindTextAutosave } from '../components/textAutosave.js?v=20260826-production-v233a';

export function bindPersonPromptAutosave(drawer, item, { onSavePerson, onGenerate, group = 'people', close } = {}) {
  const form = drawer?.querySelector('[data-person-edit]');
  const input = form?.querySelector('[name="generation_prompt"]');
  if (!form || !input) return null;
  const controller = bindTextAutosave({
    input,
    status: form.querySelector('[data-autosave-state]'),
    save: async value => {
      const saved = await onSavePerson?.(item, { generation_prompt: value });
      if (!saved) throw new Error('人物提示词自动保存失败');
      return saved;
    },
    onError: error => toast(error.message || '人物提示词自动保存失败', 'danger'),
  });
  form.addEventListener('submit', event => event.preventDefault());
  form.querySelector('[data-generate-person]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    try {
      await controller.flush();
      if (await onGenerate?.(item, group, button) === true) close?.({ flush: false });
    } catch {}
  });
  return controller;
}
