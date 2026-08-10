import { bindMediaLightbox, escapeHtml, mediaPreview } from '../components/ui.js?v=20260810-brief-settings-ui-v139';
import { personDossierShowcase } from './personDossierShowcase.js?v=20260810-brief-settings-ui-v139';
import { bindSceneDossierCard, renderSceneDossierCard } from './sceneDossierCard.js?v=20260810-brief-settings-ui-v139';
import { bindPersonLookForm } from './assetCenterPersonLooks.js?v=20260810-brief-settings-ui-v139';

function knowledgePolicyTrace(item = {}) {
  const policy = item.knowledge_policy || item.knowledgePolicy || {};
  const ruleIds = Array.isArray(policy.rule_ids) ? policy.rule_ids : [];
  const generation = String(policy.generation_fingerprint || policy.prompt_policy_fingerprint || '').trim();
  const qa = String(policy.qa_fingerprint || policy.qa_policy_fingerprint || '').trim();
  if (!generation && !qa && !ruleIds.length) return '';
  const short = value => value ? `${value.slice(0, 12)}…` : '—';
  return `<details class="raw-view-details knowledge-policy-trace"><summary>本资产使用的知识规则</summary><div class="meta-list">
    <div class="meta-row"><span>匹配规则</span><b>${ruleIds.length}</b></div>
    <div class="meta-row"><span>生成规则指纹</span><b title="${escapeHtml(generation)}">${escapeHtml(short(generation))}</b></div>
    <div class="meta-row"><span>质检规则指纹</span><b title="${escapeHtml(qa)}">${escapeHtml(short(qa))}</b></div>
  </div><p class="drawer-section-note">这里只显示规则追踪信息，不加载知识库正文，也不会增加模型调用。</p></details>`;
}

export function ownedPropDetails(item = {}) {
  const rows = Array.isArray(item.owned_props) ? item.owned_props : [];
  return `<section class="drawer-owned-props"><div class="drawer-section-head"><h3>人物随身道具</h3><span>${rows.length}</span></div><p class="drawer-section-note">道具跟随当前人物保存，不再作为独立顶级资产展示。</p>
    <div class="owned-prop-list">${rows.map(prop => `<article>${mediaPreview(prop, { label: prop.name, width: 480, symbol: '道具' })}<div><b>${escapeHtml(prop.name)}</b><span>${escapeHtml(prop.status || '待生成')}</span></div><button class="btn small" type="button" data-generate-owned-prop="${escapeHtml(prop.id)}">${prop.image_url ? '重新生成' : '生成道具'}</button></article>`).join('') || '<div class="mini-empty">当前人物还没有随身道具。</div>'}</div>
    <form class="owned-prop-form" data-owned-prop-form><input name="name" placeholder="道具名称" required><input name="description" placeholder="外观、颜色、磨损和用途" required><input name="material" placeholder="材质（可选）"><input name="scale" placeholder="尺寸/比例（可选）"><input name="reference" type="file" accept="image/png,image/jpeg,image/webp"><button class="btn small primary" type="submit">上传参考并生成</button></form></section>`;
}

export function productDetails(item = {}) {
  const presentation = item.presentation || {};
  return `<section class="product-presentation-card ${presentation.scene_linked ? 'is-scene-linked' : ''}"><div><small>展示方式</small><h3>${escapeHtml(presentation.label || '展示主体')}</h3></div><p>${escapeHtml(presentation.description || item.description || '尚未填写展示说明。')}</p>
    ${presentation.scene_linked ? '<ol><li>开场：先交代空间、问题或旧方案</li><li>主体介绍：人物从展示墙 / 成品空间带入</li><li>证据：材料细节、纹理、对比、组合或拆解效果</li><li>收尾：完整成果、价值结论与品牌落版</li></ol>' : '<p>使用独立商品多视图、细节、操作和结果证明卖点。</p>'}
    ${item.linked_scene_ids?.length ? `<small>已关联场景：${item.linked_scene_ids.map(escapeHtml).join('、')}</small>` : ''}</section>`;
}

export function productEditForm(item = {}) {
  const presentation = item.presentation || {};
  const modes = [['standalone_product', '独立商品'], ['material_surface', '场景中的材料 / 表面成果'], ['scene_embedded_showcase', '场景中的展示成果'], ['service_or_digital', '服务 / 数字界面']];
  return `<details class="person-edit-panel product-edit-panel" open><summary>修改展示主体</summary><form data-product-edit><label><span>主体名称</span><input name="product_subject" value="${escapeHtml(item.name || '')}" required></label><label><span>展示方式</span><select name="mode">${modes.map(([value, label]) => `<option value="${value}" ${presentation.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>展示说明</span><textarea name="description" rows="4">${escapeHtml(presentation.description || item.description || '')}</textarea></label><p class="drawer-section-note">修改后会进入下一次剧情、场景和分镜生成。已有成片不会被静默覆盖；如影响下游内容，系统会按版本失效规则处理。</p><button class="btn primary" type="submit">保存展示主体</button></form></details>`;
}

function normalizedPoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]); const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }
  if (value && typeof value === 'object') {
    const x = Number(value.x); const y = Number(value.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  }
  return null;
}

function cameraPlanMap(item = {}, cameras = []) {
  if (!item.layout?.image_url) return '';
  const plotted = cameras.map((camera, index) => ({
    camera,
    index,
    position: normalizedPoint(camera.position || camera.camera_position),
    lookAt: normalizedPoint(camera.look_at || camera.lookAt || camera.target_position),
  })).filter(entry => entry.position);
  const routePoints = plotted.map(entry => `${Math.round(entry.position.x * 1000)},${Math.round(entry.position.y * 600)}`).join(' ');
  const overlay = plotted.map(entry => {
    const x = Math.round(entry.position.x * 1000); const y = Math.round(entry.position.y * 600);
    const tx = Math.round((entry.lookAt || entry.position).x * 1000); const ty = Math.round((entry.lookAt || entry.position).y * 600);
    const label = escapeHtml(entry.camera.label || entry.camera.id || `机位 ${entry.index + 1}`);
    return `<g class="camera-map-node"><line x1="${x}" y1="${y}" x2="${tx}" y2="${ty}"/><circle cx="${x}" cy="${y}" r="22"/><text x="${x}" y="${y + 7}" text-anchor="middle">${entry.index + 1}</text><rect x="${Math.min(820, x + 25)}" y="${Math.max(10, y - 24)}" width="150" height="34" rx="9"/><text class="camera-map-label" x="${Math.min(835, x + 40)}" y="${Math.max(32, y - 2)}">${label}</text></g>`;
  }).join('');
  return `<section class="scene-camera-map-section"><div class="drawer-section-head"><h3>机位调度与观看方向</h3><span>${plotted.length}/${cameras.length} 个机位已定位</span></div><p class="drawer-section-note">编号表示拍摄站位；紫色虚线表示整组镜头的机位调度顺序，不等同于单个镜头的实际运镜轨迹。每一段怎么拍请展开下方“动态拍摄细则”。</p><div class="scene-camera-map">
    ${mediaPreview({ image_url: item.layout.image_url }, { label: `${item.name}整体机位规划图`, width: 1800, symbol: '机位规划', zoomable: true, zoomGroup: `scene-director-${item.id || 'current'}` })}
    ${plotted.length ? `<svg viewBox="0 0 1000 600" preserveAspectRatio="none" aria-label="${escapeHtml(item.name || '场景')}机位与行走路线">${routePoints ? `<polyline class="camera-map-route" points="${routePoints}"/>` : ''}${overlay}</svg>` : '<div class="camera-map-unavailable">现有机位没有位置坐标，暂不能伪造规划点；请在下方编辑后保存。</div>'}
  </div><div class="camera-map-legend"><span><i></i>机位位置</span><span><i></i>观看方向</span><span><i></i>整组调度顺序</span></div></section>`;
}

function mergeCameraPlan(item = {}, savedCameraPlan = false) {
  const generated = Array.isArray(item.cameras) ? item.cameras : [];
  const planned = savedCameraPlan ? item.camera_plan : generated;
  return (planned || []).map((camera, index) => {
    const match = generated.find(row => String(row.id || '') === String(camera.id || '')) || generated[index] || {};
    const merged = {
      ...match,
      ...camera,
      position: Array.isArray(camera.position) && camera.position.length ? camera.position : match.position,
      look_at: Array.isArray(camera.look_at) && camera.look_at.length ? camera.look_at : match.look_at,
      image_url: camera.image_url || match.image_url,
    };
    return merged;
  });
}

export function sceneDetails(item = {}) {
  const spec = item.scene_spec || {};
  const specRows = [['空间布局', spec.layout], ['材质与表面', spec.materials], ['天气', spec.weather], ['时间', spec.time], ['主光与光线', spec.light], ['互动区域', spec.interaction]].filter(([, value]) => value);
  const qa = item.qa || {};
  const qaRows = [['空间锁', qa.full_space_lock ? '已完成' : (qa.space_lock_status || '未完成')], ['需求匹配', qa.requirement_pass], ['跨视角一致性', qa.cross_view_pass], ['空间覆盖', qa.spatial_pass], ['机位设计', qa.camera_pass], ['真实感', qa.realism_pass]].filter(([, value]) => value !== undefined && value !== null && value !== '');
  const boolText = value => value === true ? '通过' : (value === false ? '未通过' : value);
  const sceneViews = Array.isArray(item.view_images) ? item.view_images : [];
  const cameraWithImage = camera => {
    if (camera.image_url) return camera;
    const viewId = String(camera.view_id || camera.id || '').trim();
    const matched = sceneViews.find(view => [view.key, view.view_id, view.id].some(value => String(value || '').trim() === viewId));
    return matched?.image_url ? { ...camera, image_url: matched.image_url } : camera;
  };
  const savedCameraPlan = Array.isArray(item.camera_plan) && item.camera_plan.length > 0;
  const cameraPlan = mergeCameraPlan(item, savedCameraPlan);
  const cameraGallery = item.cameras?.length ? `<section class="scene-director-views"><div class="drawer-section-head"><h3>对应机位画面</h3><span>${item.cameras.length}</span></div><div class="scene-camera-list">${item.cameras.map(cameraWithImage).map((camera, index) => `<article class="scene-camera-card ${camera.image_url ? 'has-image' : 'is-missing-image'}"><div class="scene-camera-media">${camera.image_url ? mediaPreview(camera, { label: `${index + 1}. ${item.name} ${camera.label || camera.id}`, width: 960, symbol: '机位图', zoomable: true, zoomGroup: `scene-director-${item.id || 'current'}` }) : '<div class="scene-camera-missing"><span>该机位图未生成</span></div>'}</div><div class="scene-camera-copy"><header><b>${index + 1}. ${escapeHtml(camera.label || camera.id)}</b><span>${escapeHtml(camera.view_id || camera.id || '')}</span></header><p>${escapeHtml([camera.role, camera.framing, camera.lens, camera.height].filter(Boolean).join(' · ') || '参数未提供')}</p><small>${escapeHtml([camera.orientation, camera.visible_evidence].filter(Boolean).join('；') || '方向与可见证据未提供')}</small></div></article>`).join('')}</div></section>` : '';
  return `<div class="scene-detail-stack">
    ${renderSceneDossierCard(item)}
    ${(item.description || item.story_purpose) ? `<section class="drawer-profile"><h3>场景用途</h3>${item.description ? `<div><span>空间描述</span><p>${escapeHtml(item.description)}</p></div>` : ''}${item.story_purpose ? `<div><span>剧情用途</span><p>${escapeHtml(item.story_purpose)}</p></div>` : ''}</section>` : ''}
    ${cameraPlanMap(item, cameraPlan)}
    ${cameraGallery}
    ${cameraPlan.length ? `<details class="scene-camera-route scene-shooting-plan"><summary><span><b>动态拍摄路线与执行细则</b><small>${savedCameraPlan ? '已保存正式预案' : '基于已验证机位的可编辑建议'} · ${cameraPlan.length} 段</small></span><em>展开查看怎么走、怎么拍</em></summary><p class="drawer-section-note">${savedCameraPlan ? '这是当前任务已保存的场景级拍摄路线；镜头设计仍可按剧情逐镜调整。' : '历史任务只有机位合同、没有持久化运镜路线；以下内容由现有机位、景别和证据目标推导，明确标记为建议，不冒充模型已生成结果。保存后才成为正式预案。'}</p><div class="camera-route-track">${cameraPlan.map((camera, index) => `<article><i>${index + 1}</i><div><header><b>${escapeHtml(camera.route)}</b><span>${escapeHtml(camera.movement_type)} · ${escapeHtml(camera.speed)} · 约 ${camera.duration} 秒</span></header><p>${escapeHtml(camera.movement)}</p><dl><div><dt>景别 / 镜头 / 高度</dt><dd>${escapeHtml([camera.framing, camera.lens, camera.height].filter(Boolean).join(' · ') || '待在正式预案中补充')}</dd></div><div><dt>人物或商品动作</dt><dd>${escapeHtml(camera.subject_action)}</dd></div><div><dt>焦点与卖点证据</dt><dd>${escapeHtml(camera.focus || camera.visible_evidence)}</dd></div><div><dt>起止状态</dt><dd>${escapeHtml(`${camera.start_state} → ${camera.end_state}`)}</dd></div><div><dt>连续性与稳定方式</dt><dd>${escapeHtml(`${camera.continuity}；${camera.stabilization}`)}</dd></div></dl></div></article>`).join('')}</div></details>` : ''}
    ${item.layout?.image_url ? `<details class="scene-layout raw-view-details"><summary>查看无标记的空间母版 / 布局原图</summary>${mediaPreview({ image_url: item.layout.image_url }, { label: `${item.name}空间布局原图`, width: 1200, symbol: '空间布局', zoomable: true, zoomGroup: `scene-layout-original-${item.id || 'current'}` })}</details>` : ''}
    ${specRows.length ? `<section class="drawer-profile"><h3>布局、材质与光线</h3>${specRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><p>${escapeHtml(value)}</p></div>`).join('')}</section>` : ''}
    ${item.zones?.length ? `<section><div class="drawer-section-head"><h3>空间区域</h3><span>${item.zones.length}</span></div><div class="scene-zone-list">${item.zones.map(zone => `<article><b>${escapeHtml(zone.label || zone.id)}</b><span>${escapeHtml(zone.purpose || zone.id || '未提供用途')}</span></article>`).join('')}</div></section>` : ''}
    ${item.routes?.length ? `<section><div class="drawer-section-head"><h3>跨场景路线与连续性</h3><span>${item.routes.length}</span></div><div class="scene-route-list">${item.routes.map(route => `<article><b>${escapeHtml(route.from || '当前场景')} → ${escapeHtml(route.to || '当前场景')}</b><span>${escapeHtml([route.time, route.weather, route.light, route.movement].filter(Boolean).join(' · ') || '连续性说明未提供')}</span></article>`).join('')}</div></section>` : ''}
    ${qaRows.length ? `<section><div class="drawer-section-head"><h3>场景质量状态</h3></div><div class="meta-list">${qaRows.map(([label, value]) => `<div class="meta-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(boolText(value))}</b></div>`).join('')}</div>${qa.reasons?.length ? `<ul class="scene-qa-reasons">${qa.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : ''}</section>` : ''}</div>`;
}

export function sceneEditForm(item = {}) {
  const spec = item.scene_spec || {};
  const cameras = item.camera_plan?.length ? item.camera_plan : (item.cameras || []);
  const field = (name, label, value, rows = 2) => `<label><span>${label}</span><textarea name="${name}" rows="${rows}">${escapeHtml(value || '')}</textarea></label>`;
  return `<details class="person-edit-panel scene-edit-panel"><summary>修改场景与机位预案</summary><form data-scene-edit><div class="form-grid two"><label><span>场景名称</span><input name="name" value="${escapeHtml(item.name || '')}" required></label><label><span>剧情用途</span><input name="story_purpose" value="${escapeHtml(item.story_purpose || '')}"></label></div>${field('description', '空间描述', item.description, 3)}${field('layout', '空间布局', spec.layout, 3)}${field('materials', '材质、表面与光线', [spec.materials, spec.light].filter(Boolean).join('；'), 3)}${field('interaction', '互动区域 / 人物行走路线', spec.interaction, 3)}${field('negative', '禁止项', spec.negative, 2)}
    ${cameras.length ? `<fieldset class="camera-plan-editor"><legend>机位动态拍摄动作（路线、速度、焦点等完整细则见上方拍摄方案）</legend>${cameras.map((camera, index) => `<label><span>${index + 1}. ${escapeHtml(camera.label || camera.id || `机位 ${index + 1}`)}</span><textarea name="camera_movement_${index}" rows="2" placeholder="例如：从入口广角缓慢推进至展示墙，人物从画右进入">${escapeHtml(camera.movement || '')}</textarea></label>`).join('')}</fieldset>` : ''}<p class="drawer-section-note">保存场景修改会创建新内容版本；与该场景不兼容的旧场景图和下游镜头会按依赖关系失效，不会继续误用。</p><div class="assist-form-actions"><button class="btn" type="button" data-ai-assist-scene>AI 帮写场景设定</button><button class="btn primary" type="submit">保存场景与机位预案</button></div></form></details>`;
}

export function openAssetDrawer(item, group, handlers = {}, renderers = {}) {
  const { onGenerate, onVerifyProduct, onSavePerson, onAssistPerson, onSaveProduct, onSaveScene, onAssistScene, onGenerateScene, onGenerateProp, onGenerateProduct, onUploadProduct, returnFocus } = handlers;
  const { groupLabel, generatable, mediaSection, profileDetails, legacyDossierBoard, dossierDetails, personEditForm } = renderers;
  const views = Array.isArray(item.view_images) ? item.view_images : [];
  const dossier = item.dossier_sheet?.image_url ? { image_url: item.dossier_sheet.image_url } : null;
  const zones = Array.isArray(item.zones) ? item.zones : [];
  const cameras = Array.isArray(item.cameras) ? item.cameras : [];
  const sceneGenerated = group === 'scenes' && Boolean(item.layout?.image_url || views.length || cameras.some(camera => camera.image_url));
  const metadata = [['资产类型', groupLabel], ['当前状态', item.status || '未确认'], ['版本', item.revision || '—'], ['角色或用途', item.role || '—'], ['空间区域', zones.map(zone => zone.label).filter(Boolean).join('、') || '—'], ['机位', cameras.map(camera => camera.label).filter(Boolean).join('、') || '—']];
  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  const drawer = document.createElement('aside');
  drawer.className = `drawer ${group === 'people' ? 'is-person-drawer' : ''} ${group === 'scenes' ? 'is-scene-drawer' : ''}`;
  drawer.innerHTML = `<header class="drawer-head"><div><small>${escapeHtml(groupLabel)}</small><h2>${escapeHtml(item.name)}</h2></div><button class="icon-btn" type="button" data-close-drawer>×</button></header><div class="drawer-content">
    ${dossier ? personDossierShowcase(item) : (!views.length ? mediaPreview(item, { label: item.name, width: 1200, symbol: groupLabel, zoomable: true, zoomGroup: `asset-${item.id}` }) : '')}
    ${group === 'people' && !dossier && views.length ? legacyDossierBoard(item, views) : ''}
    ${group === 'scenes' ? sceneDetails(item) : ''}
    ${views.length ? (group === 'people' && !dossier ? `<details class="raw-view-details"><summary>查看原始四视图</summary>${mediaSection('原始人物视图', views, 'is-portrait-grid')}</details>` : (group === 'scenes' ? `<details class="raw-view-details"><summary>查看场景原始图集（${views.length} 张）</summary>${mediaSection('场景视角图集', views)}</details>` : mediaSection('完整视图', views, group === 'people' || group === 'animals' ? 'is-portrait-grid' : ''))) : ''}
    ${group === 'people' ? dossierDetails(item) : ''}${group === 'products' ? productDetails(item) : ''}${profileDetails(item, group)}${knowledgePolicyTrace(item)}${group === 'people' ? personEditForm(item) : ''}${group === 'products' ? productEditForm(item) : ''}${group === 'scenes' ? sceneEditForm(item) : ''}${group === 'people' ? ownedPropDetails(item) : ''}
    <div class="meta-list">${metadata.map(([label, value]) => `<div class="meta-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</div></div>
    ${group === 'people' ? `<footer class="drawer-actions person-drawer-actions"><span>先保存文字设定；生成档案是另一步，生成前仍会确认并提示模型调用。</span><div><button class="btn" type="submit" form="personEditForm">保存人物文字设定</button><button class="btn primary" type="button" data-drawer-generate>${dossier ? '按最新设定重生成人物档案' : '生成完整人物档案'}</button></div></footer>` : (generatable && !dossier ? `<footer class="drawer-actions"><span>${views.length ? '可保留旧四视图，并生成新版完整档案。' : '生成前会再次展示确认，不会自动调用模型。'}</span><button class="btn primary" type="button" data-drawer-generate>生成动物资产</button></footer>` : '')}
    ${group === 'scenes' ? `<footer class="drawer-actions"><span>${sceneGenerated ? `当前已有 ${views.length} 个视角、${cameras.length} 个机位；仅在需要建立新版本时重新生成。` : '生成空间母版、视角和机位图，过程会显示统一进度与耗时。'}</span><button class="btn ${sceneGenerated ? '' : 'primary'}" type="button" data-drawer-generate-scene>${sceneGenerated ? '重新生成场景与机位' : '生成场景与机位'}</button></footer>` : ''}
    ${group === 'products' ? `<footer class="drawer-actions product-reference-actions"><span>展示主体可以上传实物/材料参考，也可以先由 AI 生成一张参考图；后续场景和分镜会把它作为主体锁定素材。</span><div><button class="btn" type="button" data-drawer-upload-product>${item.image_url ? '更换主体图片' : '上传主体图片'}</button><button class="btn primary" type="button" data-drawer-generate-product>${item.presentation?.standalone_generation_supported ? 'AI 生成商品多视图' : 'AI 生成主体参考图'}</button></div></footer>` : ''}
    ${group === 'products' && item.image_url && item.status !== 'verified' ? '<footer class="drawer-actions"><span>关键帧使用商品图前，需要先完成外观、形状、颜色和材质一致性验证。</span><button class="btn primary" type="button" data-drawer-verify-product>验证商品素材</button></footer>' : ''}`;
  let closed = false;
  const onKeydown = event => { if (event.key === 'Escape') close(); };
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown);
    backdrop.remove();
    drawer.remove();
    returnFocus?.focus?.();
  };
  backdrop.addEventListener('click', close);
  drawer.querySelector('[data-close-drawer]').addEventListener('click', close);
  document.addEventListener('keydown', onKeydown);
  const bindSubmit = (selector, callback) => drawer.querySelector(selector)?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.submitter || event.currentTarget.querySelector('button[type="submit"]');
    const saved = await callback?.(item, Object.fromEntries(new FormData(event.currentTarget).entries()), button);
    if (saved === true) close();
  });
  drawer.querySelector('[data-drawer-generate]')?.addEventListener('click', async event => { if (await onGenerate?.(item, group, event.currentTarget) === true) close(); });
  drawer.querySelector('[data-drawer-verify-product]')?.addEventListener('click', async event => { if (await onVerifyProduct?.(item, event.currentTarget) === true) close(); });
  bindSubmit('[data-person-edit]', onSavePerson);
  bindPersonLookForm(drawer.querySelector('[data-person-edit]'));
  bindSubmit('[data-product-edit]', onSaveProduct);
  bindSubmit('[data-scene-edit]', onSaveScene);
  drawer.querySelector('[data-ai-assist-person]')?.addEventListener('click', event => onAssistPerson?.(item, drawer.querySelector('[data-person-edit]'), event.currentTarget));
  drawer.querySelector('[data-ai-assist-scene]')?.addEventListener('click', event => onAssistScene?.(item, drawer.querySelector('[data-scene-edit]'), event.currentTarget));
  drawer.querySelector('[data-drawer-generate-scene]')?.addEventListener('click', async event => { if (await onGenerateScene?.(item, event.currentTarget) === true) close(); });
  drawer.querySelector('[data-drawer-generate-product]')?.addEventListener('click', async event => { if (await onGenerateProduct?.(item, event.currentTarget) === true) close(); });
  drawer.querySelector('[data-drawer-upload-product]')?.addEventListener('click', () => { close(); onUploadProduct?.(item); });
  drawer.querySelectorAll('[data-generate-owned-prop]').forEach(button => button.addEventListener('click', async () => {
    const prop = (item.owned_props || []).find(row => String(row.id) === button.dataset.generateOwnedProp);
    if (prop) await onGenerateProp?.(item, prop, button);
  }));
  drawer.querySelector('[data-owned-prop-form]')?.addEventListener('submit', async event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await onGenerateProp?.(item, values, event.currentTarget.querySelector('button[type="submit"]'), values.reference);
  });
  document.body.append(backdrop, drawer);
  bindMediaLightbox(drawer);
  if (group === 'scenes') bindSceneDossierCard(drawer, item);
  drawer.querySelector('[data-close-drawer]')?.focus();
}
