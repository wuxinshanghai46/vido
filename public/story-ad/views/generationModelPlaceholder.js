import { escapeHtml } from '../components/ui.js?v=20260902-production-v396';

export function generationModelPickerPlaceholder(taskId, stage, options = {}) {
  const label = options.label || '图片模型';
  return {
    taskId, stage, selected: '', pending: true,
    html: `<label class="generation-model-picker is-loading" data-generation-model-picker="${escapeHtml(stage)}">
      <span>${escapeHtml(label)}</span><select aria-label="${escapeHtml(label)}" disabled><option>正在载入…</option></select>
    </label>`,
  };
}
