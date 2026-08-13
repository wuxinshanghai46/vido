import { escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260814-sr9-v15';

export function assetCardMedia(item = {}, group = '') {
  if (group === 'scenes') return renderSceneCoverCard(item);
  if (group === 'people') {
    const portrait = item.native_masters?.face?.image_url ? item.native_masters.face
      : (item.identity_views || []).find(view => ['face_front', 'front', 'portrait'].includes(String(view.key || view.id || '').toLowerCase()))
      || (item.body_views || item.view_images || []).find(view => ['front', 'body_front'].includes(String(view.key || view.id || '').toLowerCase()))
      || (item.dossier_sheet?.image_url ? item.dossier_sheet : {});
    return mediaPreview(portrait, {
      label: `${item.name || '人物'}单人物标准人像`, width: 720,
      symbol: portrait?.image_url ? '人物标准人像' : '人物人像待补齐',
      zoomable: Boolean(portrait?.image_url), zoomGroup: 'asset-people-portraits',
    });
  }
  const labels = { animals: '动物', products: '商品 / 展示主体', logos: 'LOGO' };
  return mediaPreview(item, { label: item.name, width: 720, symbol: labels[group] || '资产', zoomable: true, zoomGroup: `asset-${group}` });
}

export function sceneNeedsGeneration(item = {}) {
  const hasAnyMedia = Boolean(item.layout?.image_url
    || item.scene_master?.image_url
    || (Array.isArray(item.view_images) && item.view_images.some(view => view?.image_url))
    || (Array.isArray(item.cameras) && item.cameras.some(camera => camera?.image_url)));
  const repairKeys = Array.isArray(item.repair_plan?.view_keys) ? item.repair_plan.view_keys.filter(Boolean) : [];
  return !hasAnyMedia || (item.repair_plan?.action === 'regenerate_failed_views' && repairKeys.length > 0);
}

export const SCENE_VIEW_ORDER = Object.freeze(['master', 'reverse', 'interaction', 'detail', 'layout']);
export const SCENE_VIEW_LABELS = Object.freeze({
  master: '主视总览', reverse: '反向空间', interaction: '互动区域', detail: '材质细节', layout: '俯视布局',
});

function list(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value || '').trim(); }

export function normalizeSceneDossier(item = {}) {
  const rows = list(item.view_images);
  const keyOf = row => text(row?.key || row?.view_id || row?.id).toLowerCase();
  const find = (...keys) => rows.find(row => keys.includes(keyOf(row)));
  const reservedKinds = new Set(['reverse', 'interaction', 'detail', 'layout']);
  const masterFallback = rows.find(row => row?.image_url && !reservedKinds.has(keyOf(row)));
  const candidates = {
    master: item.scene_master?.image_url ? item.scene_master : (find('master', 'atlas') || masterFallback || null),
    reverse: find('reverse') || null,
    interaction: find('interaction') || null,
    detail: find('detail') || null,
    layout: item.layout?.image_url ? item.layout : (find('layout') || null),
  };
  const usedUrls = new Set();
  const views = Object.fromEntries(SCENE_VIEW_ORDER.map(key => {
    const candidate = candidates[key];
    const url = text(candidate?.image_url);
    if (!url || usedUrls.has(url)) return [key, null];
    usedUrls.add(url);
    return [key, candidate];
  }));
  const completed = SCENE_VIEW_ORDER.filter(key => views[key]?.image_url).length;
  const failed = new Set(list(item.failed_view_keys).map(key => text(key).toLowerCase()));
  const viewStatuses = Object.fromEntries(SCENE_VIEW_ORDER.map(key => {
    if (views[key]?.image_url) return [key, { state: 'complete' }];
    const source = item.view_statuses?.[key] || {};
    const declared = text(source.state).toLowerCase().replaceAll('_', '-');
    return [key, { ...source, state: declared || (failed.has(key) ? 'failed' : 'missing') }];
  }));
  const qa = item.qa || {};
  const conflict = qa.full_space_lock === false || qa.cross_view_pass === false || qa.spatial_pass === false;
  const state = conflict ? 'conflict' : (completed === SCENE_VIEW_ORDER.length && qa.full_space_lock === true ? 'locked' : (completed ? 'partial' : 'missing'));
  return { views, completed, total: SCENE_VIEW_ORDER.length, failed, viewStatuses, state };
}

function statusText(state = '', completed = 0) {
  return ({ locked: '已通过并锁定', partial: completed > 0 ? '基础场景已保存，增强待续' : '部分完成', conflict: '一致性异常', missing: '尚未生成' })[state] || '状态待确认';
}

function viewSlot(item, dossier, key, options = {}) {
  const view = dossier.views[key];
  const state = view?.image_url ? 'complete' : (dossier.viewStatuses[key]?.state || (dossier.failed.has(key) ? 'failed' : 'missing'));
  const copy = {
    failed: ['生成失败', '生成失败，未作为资产展示'],
    'billing-review': ['待核对', '已提交，计费与结果待核对'],
    pending: ['待继续', '尚未提交，可在核对后继续'],
    missing: ['待补齐', '没有使用其他视图冒充'],
  }[state] || ['待补齐', '没有使用其他视图冒充'];
  const label = SCENE_VIEW_LABELS[key];
  return `<figure class="scene-dossier-view is-${key} is-${state}" data-scene-view="${key}">
    <div>${view?.image_url
      ? mediaPreview(view, { label: `${item.name || '场景'} · ${label}`, width: options.width || 1200, symbol: label, zoomable: true, zoomGroup: `scene-dossier-${item.id || 'current'}` })
      : `<div class="scene-dossier-missing" role="status"><span>${copy[0]}</span><small>${escapeHtml(label)}</small></div>`}</div>
    <figcaption><b>${escapeHtml(label)}</b><span>${view?.image_url ? '真实资产已就绪' : copy[1]}</span></figcaption>
  </figure>`;
}

function evidenceRows(item = {}) {
  const rows = list(item.scene_card?.asset_groups);
  if (rows.length) return rows;
  return list(item.zones).map(zone => ({ kind: 'zone', label: zone.label || zone.name || zone.id, detail: zone.purpose || '' }));
}

function evidenceGroup(rows = [], kinds = []) {
  return rows.filter(row => kinds.includes(row.kind)).slice(0, 14);
}

function chips(rows = [], empty = '当前任务没有这类结构化证据') {
  return rows.length ? rows.map(row => {
    const label = text(row.label || row.id || '证据');
    const detail = text(row.detail);
    return `<li><b>${escapeHtml(label)}</b>${detail && detail !== label ? `<span>${escapeHtml(detail)}</span>` : ''}</li>`;
  }).join('') : `<li class="is-empty">${escapeHtml(empty)}</li>`;
}

function qaRows(item = {}) {
  const named = list(item.scene_card?.qa_checks);
  if (named.length) return named;
  const qa = item.qa || {};
  return [
    ['空间锁', qa.full_space_lock], ['需求匹配', qa.requirement_pass], ['跨视角一致性', qa.cross_view_pass],
    ['空间覆盖', qa.spatial_pass], ['机位设计', qa.camera_pass], ['摄影真实感', qa.realism_pass],
  ].filter(([, pass]) => pass !== undefined && pass !== null).map(([label, pass]) => ({ label, pass, reasons: [] }));
}

export function renderSceneCoverCard(item = {}) {
  const dossier = normalizeSceneDossier(item);
  const master = dossier.views.master;
  return `<div class="scene-cover-board is-${dossier.state}" aria-label="${escapeHtml(item.name || '场景')}场景资产摘要">
    <div class="scene-cover-visual">${master?.image_url
      ? mediaPreview(master, { label: `${item.name || '场景'} · 主视总览`, width: 960, symbol: '场景主视', zoomable: true, zoomGroup: `scene-cover-${item.id || 'current'}` })
      : '<div class="scene-dossier-missing" role="status"><span>待生成主视图</span></div>'}
      <span class="scene-cover-state">${escapeHtml(statusText(dossier.state, dossier.completed))} · ${dossier.completed}/${dossier.total}</span>
    </div>
    <div class="scene-cover-slots" aria-label="五类场景证据完整度">${SCENE_VIEW_ORDER.map(key => `<span class="is-${dossier.views[key]?.image_url ? 'complete' : dossier.viewStatuses[key]?.state || 'missing'}"><i aria-hidden="true"></i>${escapeHtml(SCENE_VIEW_LABELS[key])}</span>`).join('')}</div>
  </div>`;
}

export function renderSceneDossierCard(item = {}) {
  const dossier = normalizeSceneDossier(item);
  const spec = item.scene_spec || {};
  const rows = evidenceRows(item);
  const structures = evidenceGroup(rows, ['anchor', 'geometry', 'zone']);
  const props = evidenceGroup(rows, ['prop']);
  const materials = evidenceGroup(rows, ['material', 'surface']);
  const lighting = evidenceGroup(rows, ['lighting']);
  const qa = qaRows(item);
  const titleId = `scene-dossier-title-${text(item.id || 'current').replace(/[^a-z0-9_-]/ig, '-')}`;
  return `<section class="scene-dossier is-${dossier.state}" data-scene-dossier="${escapeHtml(item.id || '')}" aria-labelledby="${escapeHtml(titleId)}">
    <header class="scene-dossier-head"><div><small>完整场景档案卡 · 版本 ${escapeHtml(item.revision || 1)}</small><h2 id="${escapeHtml(titleId)}">${escapeHtml(item.name || '未命名场景')}</h2><p>${escapeHtml(item.story_purpose || item.description || '当前场景尚未填写剧情用途')}</p></div><div><span class="scene-dossier-status">${escapeHtml(statusText(dossier.state, dossier.completed))} · ${dossier.completed}/${dossier.total}</span><button class="btn small" type="button" data-export-scene-dossier>导出高清 PNG</button></div></header>
    <div class="scene-dossier-hero">${viewSlot(item, dossier, 'master', { width: 1800 })}</div>
    <div class="scene-dossier-evidence-grid">${['reverse', 'interaction', 'detail'].map(key => viewSlot(item, dossier, key, { width: 960 })).join('')}</div>
    <div class="scene-dossier-lower"><div class="scene-dossier-layout">${viewSlot(item, dossier, 'layout', { width: 1400 })}</div><div class="scene-dossier-contract"><h3>场景视觉合同</h3><dl><div><dt>空间布局</dt><dd>${escapeHtml(spec.layout || spec.layoutText || '待补齐')}</dd></div><div><dt>材质与表面</dt><dd>${escapeHtml(spec.materials || spec.materialLightText || '待补齐')}</dd></div><div><dt>天气 / 时间 / 灯光</dt><dd>${escapeHtml([spec.weather, spec.time, spec.light].filter(Boolean).join(' · ') || '待补齐')}</dd></div><div><dt>互动与路线</dt><dd>${escapeHtml(spec.interaction || spec.interactionText || '待补齐')}</dd></div><div class="is-negative"><dt>禁止出现</dt><dd>${escapeHtml(spec.negative || spec.negativeText || '没有额外禁止项')}</dd></div></dl></div></div>
    <div class="scene-dossier-assets"><section><h3>固定空间与结构</h3><ul>${chips(structures)}</ul></section><section><h3>道具与摆放</h3><ul>${chips(props, '当前场景没有结构化道具摆放')}</ul></section><section><h3>材质与表面证据</h3><ul>${chips(materials)}</ul></section><section><h3>灯光证据</h3><ul>${chips(lighting, '灯光信息保留在上方视觉合同')}</ul></section></div>
    <div class="scene-dossier-footer"><section><h3>一致性 QA</h3><div class="scene-dossier-qa">${qa.length ? qa.map(row => `<span class="is-${row.pass === true ? 'pass' : (row.pass === false ? 'fail' : 'unknown')}"><i aria-hidden="true"></i>${escapeHtml(row.label)}：${row.pass === true ? '通过' : (row.pass === false ? '未通过' : '待确认')}</span>`).join('') : '<span class="is-unknown">尚无正式 QA 结论</span>'}</div></section><section><h3>生产引用</h3><p>${item.shot_refs?.length ? `用于 ${item.shot_refs.length} 个镜头：${escapeHtml(item.shot_refs.slice(0, 8).join('、'))}` : '尚未被分镜引用'} · 知识规则 ${escapeHtml(item.knowledge_policy?.rule_ids?.join('、') || '沿用任务快照')}</p><div class="scene-dossier-palette"><b>图片提取色</b><span>导出时从主视原图确定性取样，不伪造色彩合同。</span><div data-scene-dossier-palette aria-label="主视图颜色取样"></div></div></section></div>
    <p class="scene-dossier-boundary">3D、360°、机位和路线继续使用页面下方“场景世界”，本档案卡只读取已有资产。</p>
  </section>`;
}

export function bindSceneDossierCard(scope, item = {}) {
  const button = scope?.querySelector?.('[data-export-scene-dossier]');
  if (!button) return;
  button.addEventListener('click', async () => {
    try {
      setButtonBusy(button, true, '正在本地合成…', { elapsed: true });
      const exporter = await import('./sceneDossierExport.js?v=20260814-sr9-v15');
      const result = await exporter.exportSceneDossierPng(item);
      const palette = scope.querySelector('[data-scene-dossier-palette]');
      if (palette && result.palette?.length) palette.innerHTML = result.palette.map(color => `<i style="--scene-swatch:${escapeHtml(color)}" title="${escapeHtml(color)}"></i>`).join('');
      toast(`场景档案已导出：${result.width}×${result.height}，模型调用 0。`, 'success');
    } catch (error) {
      toast(error.message || '场景档案导出失败。', 'danger');
    } finally {
      setButtonBusy(button, false);
    }
  });
}
