import { request } from '../api.js?v=20260829-production-v260';
import { escapeHtml } from '../components/ui.js?v=20260829-production-v260';

const PROVIDER_INITIALS = Object.freeze({
  deyunai: 'DY',
  apismile: 'AS',
  'webang-maas': 'WB',
  smscrw: 'SZ',
});

export function generationProviderInitials(model = {}) {
  const providerId = String(model.provider_id || String(model.route || '').split('/')[0] || '').trim().toLowerCase();
  return PROVIDER_INITIALS[providerId]
    || providerId.split(/[^a-z0-9]+/i).filter(Boolean).map(part => part[0]).join('').slice(0, 3).toUpperCase()
    || 'AI';
}

export function generationModelDisplayName(model = {}) {
  const modelId = String(model.model_id || String(model.route || '').split('/').slice(1).join('/') || '').trim().toLowerCase();
  if (/nano[-_ ]?banana[-_ ]?pro/.test(modelId)) return 'Nano Banana Pro';
  if (/nano[-_ ]?banana/.test(modelId) || modelId === 'gemini-2.5-flash-image') return 'Nano Banana';
  if (/^gpt[-_ ]?image[-_ ]?2$/.test(modelId)) return 'GPT Image 2';
  if (/^gpt[-_ ]?image[-_ ]?1$/.test(modelId)) return 'GPT Image 1';
  if (/^qwen[-_ ]?image[-_ ]?edit/.test(modelId)) return 'Qwen Image Edit';
  if (/^qwen[-_ ]?image/.test(modelId)) return 'Qwen Image';
  const source = String(model.model_name || model.model_id || 'Image').trim();
  return source
    .replace(/\s*[·|｜].*$/u, '')
    .replace(/\s*[（(][^）)]*(?:平台|聚合|兼容|海外|alias|别名|Deyun|ApiSmile|SMSCRW|MaaS|OpenAI)[^）)]*[）)]/giu, '')
    .replace(/\?{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim() || 'Image';
}

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
        ${models.length ? models.map(model => `<option value="${escapeHtml(model.route)}" ${model.route === selected ? 'selected' : ''} ${model.available ? '' : 'disabled'}>${escapeHtml(generationModelDisplayName(model))} · ${escapeHtml(generationProviderInitials(model))}${model.available ? '' : '（暂不可用）'}</option>`).join('') : '<option value="">暂无可用模型</option>'}
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
