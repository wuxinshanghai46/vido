import { renderBriefMaterialRows } from './briefMaterials.js?v=20260831-production-v324';

function hasMaterials(bundle) {
  const reference = bundle?.reference || {};
  const products = bundle?.assets?.products || [];
  return !!(reference.analysis_id || reference.filename || reference.url || products.some(item => item.image_url
    || item.dossier_sheet?.image_url || item.view_images?.some(view => view.image_url)));
}

export function renderAdvancedReferenceControls(bundle, isNew) {
  const enabled = hasMaterials(bundle);
  return `<label class="field advanced-reference-choice"><span>是否使用参考材料</span>
    <select class="select" data-reference-material-choice><option value="" ${enabled ? '' : 'selected'}>请选择</option><option value="yes" ${enabled ? 'selected' : ''}>是，添加参考材料</option><option value="no">否，暂不使用</option></select>
    <small>只有选择“是”才显示上传入口；参考材料用于辅助理解，不会替你选择广告或剧情。</small></label>
    <div class="material-list" data-reference-material-fields ${enabled ? '' : 'hidden'}>${renderBriefMaterialRows(bundle, isNew)}</div>`;
}

export function bindAdvancedReferenceControls(host) {
  host.querySelector('[data-reference-material-choice]')?.addEventListener('change', event => {
    const fields = host.querySelector('[data-reference-material-fields]');
    if (fields) fields.hidden = event.currentTarget.value !== 'yes';
  });
}
