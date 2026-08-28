import { request } from '../api.js?v=20260829-production-v257';
import { escapeHtml } from '../components/ui.js?v=20260829-production-v257';

function storageKey(taskId, stage) {
  return `story-ad-generation-model:${taskId}:${stage}`;
}

export async function loadGenerationModelPicker(taskId, stage, options = {}) {
  const catalog = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/generation-models?stage=${encodeURIComponent(stage)}`);
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  const remembered = localStorage.getItem(storageKey(taskId, stage)) || '';
  const selected = models.find(model => model.route === remembered && model.available)?.route
    || models.find(model => model.available)?.route || '';
  const label = options.label || (catalog.media_type === 'video' ? '视频模型' : '图片模型');
  return {
    taskId,
    stage,
    mediaType: catalog.media_type,
    selected,
    html: `<label class="generation-model-picker" data-generation-model-picker="${escapeHtml(stage)}">
      <span>${escapeHtml(label)}</span>
      <select aria-label="${escapeHtml(label)}" ${selected ? '' : 'disabled'}>
        ${models.length ? models.map(model => `<option value="${escapeHtml(model.route)}" ${model.route === selected ? 'selected' : ''} ${model.available ? '' : 'disabled'}>${escapeHtml(model.model_name || model.model_id)} · ${escapeHtml(model.provider_name || model.provider_id)}${model.available ? '' : '（暂不可用）'}</option>`).join('') : '<option value="">暂无可用模型</option>'}
      </select>
    </label>`,
  };
}

export function bindGenerationModelPicker(host, picker) {
  const select = host.querySelector(`[data-generation-model-picker="${CSS.escape(picker.stage)}"] select`);
  select?.addEventListener('change', () => localStorage.setItem(storageKey(picker.taskId, picker.stage), select.value));
  return () => select?.value || picker.selected || '';
}

export function selectedGenerationModel(host, stage) {
  return host.querySelector(`[data-generation-model-picker="${CSS.escape(stage)}"] select`)?.value || '';
}

export function requireGenerationModel(host, stage) {
  const route = selectedGenerationModel(host, stage);
  if (!route) throw new Error('请先选择本次生成模型。');
  return route;
}
