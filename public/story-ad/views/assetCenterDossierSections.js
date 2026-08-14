import { escapeHtml, mediaPreview } from '../components/ui.js?v=20260814-reference-recovery-v37';

export function mediaSection(title, rows = [], className = '') {
  const items = Array.isArray(rows) ? rows.filter(item => item?.image_url) : [];
  if (!items.length) return '';
  const zoomGroup = `drawer-${String(title).replace(/[^a-z0-9\u4e00-\u9fff]+/ig, '-')}`;
  return `<section class="drawer-media-section"><div class="drawer-section-head"><h3>${escapeHtml(title)}</h3><span>${items.length}</span></div><div class="drawer-media-grid ${className}">${items.map(item => `<figure>${mediaPreview(item, { label: item.label || item.key, width: 720, symbol: item.label || '素材', zoomable: true, zoomGroup })}<figcaption>${escapeHtml(item.label || item.key || '素材')}</figcaption></figure>`).join('')}</div></section>`;
}

export function legacyDossierBoard(item = {}, views = []) {
  const profile = item.profile || {};
  const facts = [
    ['身份 / 关系', profile.roleName || item.role || '待补充'],
    ['形象、气质与年龄', profile.appearanceText || '沿用现有参考图中的人物形象'],
  ];
  const notes = [
    ['服装与配饰', profile.wardrobeText],
    ['发型与妆造', profile.hairMakeupText],
    ['一致性禁区', profile.negativeText],
  ].filter(([, value]) => value);
  return `<section class="reference-dossier-board" aria-label="${escapeHtml(item.name)}参考档案预览">
    <header><div><span>参考档案预览</span><h3>${escapeHtml(item.name)}</h3></div><p>由当前任务的历史参考图和人物设定整理，不冒充新生成档案。</p></header>
    <div class="reference-dossier-layout">
      <aside class="reference-dossier-facts">${facts.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</aside>
      <div class="reference-dossier-views">${views.slice(0, 4).map(view => `<figure>${mediaPreview(view, { label: view.label || view.key || item.name, width: 720, symbol: '人物参考', zoomable: true, zoomGroup: `legacy-${item.id || 'person'}` })}<figcaption>${escapeHtml(view.label || view.key || '人物视图')}</figcaption></figure>`).join('')}</div>
      <aside class="reference-dossier-notes">${notes.length ? notes.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('') : '<div><span>设定说明</span><p>当前任务仅保留历史四视图，可在下方生成新版完整人物档案。</p></div>'}</aside>
    </div>
  </section>`;
}
