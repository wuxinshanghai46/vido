import { escapeHtml } from '../components/ui.js?v=20260805-brief-settings-inline-v27';

function compactText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '尚未填写';
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function briefSettingsSummary(bundle = {}) {
  const brief = bundle.brief || {};
  return `<span class="brief-settings-values" data-brief-settings-values>
    <span class="brief-settings-goal"><small>广告目标</small><strong>${escapeHtml(compactText(brief.text, 150))}</strong></span>
    <span class="brief-settings-meta"><em>${escapeHtml(compactText(brief.product_subject || '未指定商品 / 主题', 48))}</em><em>${Number(brief.target_duration || 30) || 30} 秒</em><em>${escapeHtml(brief.output_ratio || '9:16')}</em><em>${escapeHtml(brief.video_resolution || '1080p')}</em></span>
  </span>`;
}
