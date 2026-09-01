import { request } from '../api.js?v=20260901-production-v355';
import { escapeHtml } from '../components/ui.js?v=20260901-production-v355';

export function generationModelDisplayName(model = {}) {
  return String(model.public_name || model.model_name || model.model_id || 'Image-2')
    .replace(/\s*[·|｜（(].*$/u, '').replace(/\?+/g, '').trim()
    || 'Image';
}

export function generationModelOptionLabel(model = {}) {
  const provider = String(model.provider_code || '').trim().toUpperCase();
  return `${generationModelDisplayName(model)}${provider ? ` · ${provider}` : ''}`;
}

function storageKey(taskId, stage) {
  return `story-ad-generation-model:${taskId}:${stage}`;
}

export async function loadGenerationModelPicker(taskId, stage, options = {}) {
  const catalog = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/generation-models?stage=${encodeURIComponent(stage)}`);
  const models = Array.isArray(catalog.models) ? catalog.models : [];
  const remembered = localStorage.getItem(storageKey(taskId, stage)) || '';
  const selected = models.find(model => model.route === remembered && model.available)?.route
    || models.find(model => model.route === catalog.default_selection && model.available)?.route || '';
  const available = models.some(model => model.available);
  const label = options.label || (catalog.media_type === 'video' ? '视频模型' : '图片模型');
  return {
    taskId,
    stage,
    mediaType: catalog.media_type,
    selected,
    selectedLabel: generationModelOptionLabel(models.find(model => model.route === selected) || {}),
    html: `<label class="generation-model-picker" data-generation-model-picker="${escapeHtml(stage)}">
      <span>${escapeHtml(label)}</span>
      <select aria-label="${escapeHtml(label)}" ${available ? '' : 'disabled'}>
        ${!selected && available ? '<option value="" selected>请选择</option>' : ''}${models.length ? models.map(model => `<option value="${escapeHtml(model.route)}" ${model.route === selected ? 'selected' : ''} ${model.available ? '' : 'disabled'}>${escapeHtml(generationModelOptionLabel(model))}${model.available ? '' : '（暂不可用）'}</option>`).join('') : '<option value="">暂无可用模型</option>'}
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
