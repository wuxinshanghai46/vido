import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260904-production-v467';

export function mediaSection(title, rows = [], className = '') {
  const items = Array.isArray(rows) ? rows.filter(item => item?.image_url) : [];
  if (!items.length) return '';
  const zoomGroup = `drawer-${String(title).replace(/[^a-z0-9\u4e00-\u9fff]+/ig, '-')}`;
  return `<section class="drawer-media-section"><div class="drawer-section-head"><h3>${escapeHtml(title)}</h3><span>${items.length}</span></div><div class="drawer-media-grid ${className}">${items.map(item => `<figure>${mediaPreview(item, { label: item.label || item.key, width: 720, symbol: item.label || '素材', zoomable: true, zoomGroup })}<figcaption>${escapeHtml(item.label || item.key || '素材')}</figcaption></figure>`).join('')}</div></section>`;
}
