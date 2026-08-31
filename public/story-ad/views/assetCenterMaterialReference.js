import { escapeHtml } from '../components/ui.js?v=20260831-production-v332';

export function productDetails(item = {}) {
  const presentation = item.presentation || {};
  const materialSurface = presentation.mode === 'material_surface' || presentation.standalone_generation_supported === false;
  const source = String(item.source || item.source_type || item.provenance?.source || '').toLowerCase();
  const neutral = materialSurface && (item.reference_only === true || source === 'new_story_ad_subject_reference_generator');
  const realSample = materialSurface && Boolean(item.image_url) && !neutral
    && (item.user_owned === true || item.ownership?.user_owned === true || /(?:^|_)(?:upload|uploaded|user_owned|user_reference)(?:_|$)/.test(source));
  const pending = materialSurface && Boolean(item.image_url) && !neutral && !realSample;
  const status = realSample ? '真实材料样片已就绪' : (pending ? '材料图片来源待确认，可以继续' : '缺少真实材料样片，但可以继续');
  const limit = realSample ? '场景和审核可依据真实样片核对材质外观。'
    : (neutral ? '中性参考图只用于构图和展示理解，不能替代真实样片，也不能证明专有纹理、型号或真实触感。'
      : (pending ? '确认图片来源前，它不能作为真实材料证据，也不能证明专有纹理。' : '系统仍可生成场景，但只能判断画面中可见的颜色、纹理和反光，不能证明专有纹理、型号或真实触感。'));
  return `<section class="product-presentation-card ${presentation.scene_linked ? 'is-scene-linked' : ''}"><div><small>展示方式</small><h3>${escapeHtml(presentation.label || '展示主体')}</h3></div><p>${escapeHtml(presentation.description || item.description || '尚未填写展示说明。')}</p>
    ${presentation.scene_linked ? '<ol><li>开场：先交代空间、问题或旧方案</li><li>主体介绍：人物从展示墙 / 成品空间带入</li><li>证据：材料细节、纹理、对比、组合或拆解效果</li><li>收尾：完整成果、价值结论与品牌落版</li></ol>' : '<p>使用独立商品多视图、细节、操作和结果证明卖点。</p>'}
    ${materialSurface ? `<div class="material-reference-notice is-${realSample ? 'ready' : 'limited'}"><b>${status}</b><p>${limit}</p></div>` : ''}
    ${item.linked_scene_ids?.length ? `<small>已关联场景：${item.linked_scene_ids.map(escapeHtml).join('、')}</small>` : ''}</section>`;
}
