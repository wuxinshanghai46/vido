import { escapeHtml } from '../components/ui.js?v=20260826-production-v230f';

export const BRIEF_MATERIALS = [
  ['reference', '参考视频', '上传视频或粘贴公开链接，系统会识别可见人物、场景、动作与广告主体'],
  ['product', '商品 / 服务主体参考', '上传商品或服务主体图片；视频未清楚展示时用于确认广告主体'],
];

export function renderBriefMaterialRows(bundle, isNew) {
  const reference = bundle?.reference || {};
  const assets = bundle?.assets || {};
  const ready = {
    reference: !!(reference.analysis_id || reference.filename || reference.url),
    product: !!assets.products?.some(item => item.image_url
      || item.dossier_sheet?.image_url
      || (Array.isArray(item.view_images) && item.view_images.some(view => view.image_url))),
  };
  return BRIEF_MATERIALS.map(([id, label, hint]) => `
    <div class="material-row ${ready[id] ? 'is-ready' : ''}" data-material-row="${id}">
      <span><b>${escapeHtml(label)}</b><small>${ready[id] ? (id === 'reference' ? '已用于本次识别，可在左侧查看理解报告' : '已作为当前项目的补充材料') : escapeHtml(hint)}</small></span>
      <span class="material-actions">
        ${id === 'reference' ? '<button class="btn" type="button" data-reference-link>粘贴链接</button>' : ''}
        <button class="btn" type="button" data-material-upload="${id}">${isNew ? '创建并添加' : (ready[id] ? '更换' : '添加')}</button>
        ${id === 'reference' && ready[id] && !reference.client_pending ? '<button class="material-remove" type="button" data-reference-remove aria-label="移除参考视频" title="移除参考视频">×</button>' : ''}
      </span>
    </div>`).join('');
}
