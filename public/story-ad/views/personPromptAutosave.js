import { setButtonBusy, toast } from '../components/ui.js?v=20260831-production-v325';
import { bindTextAutosave } from '../components/textAutosave.js?v=20260831-production-v325';

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
  form.querySelectorAll('[name="generation_type"], [name="quality"], [name="resolution"]').forEach(select => {
    select.addEventListener('change', async () => {
      const status = form.querySelector('[data-autosave-state]');
      try {
        if (status) status.textContent = '正在保存…';
        const saved = await onSavePerson?.(item, {
          generation_prompt: input.value,
          generation_settings: {
            ...(item.profile?.generation_settings || {}),
            generation_type: form.elements.generation_type.value,
            quality: form.elements.quality.value,
            resolution: form.elements.resolution.value,
            count: 1,
          },
        });
        if (!saved) throw new Error('人物生成设置保存失败');
        if (status) status.textContent = '已自动保存';
      } catch (error) {
        if (status) status.textContent = '保存失败';
        toast(error.message || '人物生成设置保存失败', 'danger');
      }
    });
  });
  form.querySelector('[data-generate-person]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    setButtonBusy(button, true, '正在准备…');
    try {
      await controller.flush();
      const generated = await onGenerate?.(item, group, button) === true;
      if (generated) close?.({ flush: false });
      else setButtonBusy(button, false);
    } catch { setButtonBusy(button, false); }
  });
  return controller;
}
