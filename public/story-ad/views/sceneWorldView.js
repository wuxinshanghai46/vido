import { request } from '../api.js?v=20260827-production-v233g';
import { escapeHtml, mediaPreview, toast } from '../components/ui.js?v=20260827-production-v233g';
import { promptDialog } from '../components/dialog.js?v=20260827-production-v233g';
import { list, worldById } from './sceneWorldData.js?v=20260827-production-v233g';
const CAPABILITY_LABELS = {
  supports_photo_views: '真实图片视角',
  supports_panorama: '360原地环视（3DoF）',
  supports_structure_map: '结构 / 路线',
  supports_3d_proxy: '可旋转结构代理',
  supports_spatial_model: '可移动空间（6DoF）',
  supports_navigation: '6DoF空间导航',
  supports_camera_orbit: '环绕机位',
  supports_character_blocking: '人物站位',
  supports_motion_path: '行动路线',
  supports_transition_portal: '跨场景入口',
  supports_state_variants: '状态变化',
};
function photoNodes(world = {}) {
  const seen = new Set();
  const panoramaRows = [
    ...list(world.panorama_assets),
    ...list(world.source_asset?.panoramas),
    ...list(world.scene_world_assets?.panoramas),
    ...(world.source_asset?.panorama_url ? [{ image_url: world.source_asset.panorama_url }] : []),
    ...(world.panorama_url ? [{ image_url: world.panorama_url }] : []),
  ].map((item, index) => typeof item === 'string'
    ? { image_url: item, id: `${world.id}:panorama:${index + 1}` }
    : { ...item, image_url: item.image_url || item.url, id: item.id || `${world.id}:panorama:${index + 1}` });
  const candidates = [
    ...list(world.observation_nodes),
    ...panoramaRows.map((item, index) => ({ ...item, name: item.name || `360观察点 ${index + 1}`, projection: item.projection || 'equirectangular', is_panorama: true })),
    ...(world.source_asset?.image_url ? [{ id: `${world.id}:source:master`, name: '主视角', view_key: 'master', image_url: world.source_asset.image_url }] : []),
    ...(world.source_asset?.layout_image_url ? [{ id: `${world.id}:source:layout`, name: '俯视布局', view_key: 'layout', image_url: world.source_asset.layout_image_url }] : []),
  ];
  return candidates.map(node => {
    const projection = String(node.projection || node.view_key || node.source_role || '');
    return {
      ...node,
      is_panorama: !/cubemap|cube_face/i.test(projection)
        && (node.is_panorama === true || /panorama|equirect|360/i.test(projection)),
    };
  }).filter(node => {
    const url = String(node?.image_url || '').trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
function capabilityChips(world = {}) {
  return Object.entries(CAPABILITY_LABELS)
    .filter(([key]) => world.capabilities?.[key] === true)
    .map(([, label]) => `<span>${escapeHtml(label)}</span>`)
    .join('');
}
function manifestSummary(bundle = {}) {
  const manifest = bundle.production_manifest || { counts: {} };
  const counts = manifest.counts || {};
  return `<div class="scene-world-summary-grid">
    <article><span>人物</span><b>${Number(counts.people || 0)}</b><small>继续使用完整人物档案与穿戴版本</small></article>
    <article><span>场景世界</span><b>${Number(counts.worlds || 0)}</b><small>按用户内容动态启用空间能力</small></article>
    <article><span>动态机位</span><b>${Number(counts.cameras || 0)}</b><small>真实图片切换与机位浏览</small></article>
    <article><span>场景衔接</span><b>${Number(counts.transitions || 0)}</b><small>只在 scene_id 变化时建立</small></article>
  </div>`;
}

function worldCards(bundle = {}) {
  const worlds = list(bundle.scene_worlds);
  if (!worlds.length) return '<div class="scene-world-empty">尚未建立场景世界。请先点击“建立场景规划”。</div>';
  return `<div class="scene-world-card-grid">${worlds.map(world => {
    const panoramaReady = photoNodes(world).some(node => node.is_panorama);
    const panoramaStatus = panoramaReady ? 'ready' : String(world.experience?.panorama_status || world.experience?.status || 'not_started');
    const selectedExperience = {
      photo_views: '多视角图片', panorama_360: '360原地环视（3DoF）', director_3d: '3D导演预演', spatial_3d: '真实6DoF空间',
    }[world.experience?.requested_mode || world.experience?.current_mode] || '尚未选择空间模式';
    const lineage = world.place_lineage || {};
    return `<article class="scene-world-card" data-scene-world-card="${escapeHtml(world.id)}">
    <div class="scene-world-card-visual">
      ${world.source_asset?.image_url ? mediaPreview(world.source_asset, { label: `${world.name}场景原图`, width: 720, zoomable: true, zoomGroup: 'scene-world-cards' }) : '<div class="scene-world-card-placeholder"></div>'}
      <div class="scene-world-card-title"><span>${escapeHtml(world.capabilities?.world_mode || 'scene_world')}</span><b>${escapeHtml(world.name)}</b></div>
    </div>
    <div class="scene-world-card-body">
      <p>${escapeHtml(world.story_purpose || world.description || '等待补充当前场景的剧情作用')}</p>
      <div class="scene-place-lineage"><b>地点血缘：${escapeHtml(lineage.place_lineage_id || lineage.place_id || '独立地点')}</b><span>${escapeHtml([lineage.era, lineage.continuity_type, lineage.access_route].filter(Boolean).join(' · '))}</span>${lineage.preserved_anchors?.length ? `<small>保留：${escapeHtml(lineage.preserved_anchors.join('、'))}</small>` : ''}${lineage.rebuilt_elements?.length ? `<small>重建：${escapeHtml(lineage.rebuilt_elements.join('、'))}</small>` : ''}${lineage.forbidden_elements?.length ? `<small>禁止：${escapeHtml(lineage.forbidden_elements.join('、'))}</small>` : ''}</div>
      <div class="scene-world-capabilities">${capabilityChips(world)}</div>
      <small>${world.zones?.length || 0} 个区域 · ${world.observation_nodes?.length || 0} 个观察点 · ${world.cameras?.length || 0} 个机位 · ${escapeHtml({ photo_views: '多视角图片', panorama_360: '3DoF原地环视', spatial_3d: '6DoF可移动空间', structure_proxy: '结构代理' }[world.experience?.current_mode] || '待建立空间')} · 版本 ${world.revision || 1}</small>
      <span class="scene-panorama-status is-${escapeHtml(panoramaStatus)}" data-panorama-status="${escapeHtml(world.id)}">${panoramaReady ? '全景已就绪 · 3DoF' : '尚未生成360全景'}</span>
      <span class="scene-panorama-status">当前选择：${escapeHtml(selectedExperience)}</span>
    </div>
    <div class="scene-world-card-actions">
      <button class="btn small primary" type="button" data-enter-scene-world="${escapeHtml(world.id)}">进入场景</button>
      <button class="btn small" type="button" data-edit-scene-world="${escapeHtml(world.id)}">编辑场景设定</button>
      <button class="btn small" type="button" data-plan-scene-experience="${escapeHtml(world.id)}">选择360 / 3D模式</button><button class="btn small" type="button" data-enter-scene-world="${escapeHtml(world.id)}">打开3D导演预演（免供应商）</button>
      <span class="status-tag ${panoramaReady ? 'is-ready' : 'is-neutral'}">${panoramaReady ? '360°全景已纳入制作图谱' : '返回资产中心统一补齐360°全景'}</span>
      <button class="btn small" type="button" data-scene-world-tab-target="matrix">人物×场景</button>
      <button class="btn small" type="button" data-scene-world-tab-target="transitions">查看衔接</button>
    </div>
  </article>`;
  }).join('')}</div>`;
}

function characterWorldMatrix(bundle = {}) {
  const worlds = list(bundle.scene_worlds);
  const rows = list(bundle.production_manifest?.character_world_matrix);
  if (!rows.length) return '<div class="scene-world-empty">当前任务没有人物；场景世界仍可作为无人产品或环境广告使用。</div>';
  const statusLabel = cell => ({ confirmed: cell.shot_count ? `已绑定 ${cell.shot_count} 镜` : '确认出场', suggested: '建议出场', excluded: '不出场', unassigned: '待确认' }[cell.presence] || '待确认');
  return `<div class="character-world-matrix-actions"><p>可直接确认每个人物在哪些场景出场；人物档案换版本后仍按稳定人物 ID 保留分配。</p><button class="btn primary" type="button" data-save-world-assignments>保存人物分配</button></div><div class="character-world-matrix-wrap"><table class="character-world-matrix">
    <thead><tr><th>人物</th>${worlds.map(world => `<th>${escapeHtml(world.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr><th><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.wardrobe || '沿用人物档案穿戴版本')}</small></th>${worlds.map(world => {
      const cell = list(row.cells).find(item => item.world_id === world.id) || {};
      return `<td class="is-${escapeHtml(cell.presence || 'unassigned')}"><b>${escapeHtml(statusLabel(cell))}</b><small>${escapeHtml(cell.reason || '尚未确认人物与场景关系')}</small><select data-world-assignment data-character-id="${escapeHtml(row.character_id)}" data-world-id="${escapeHtml(world.id)}" aria-label="${escapeHtml(`${row.name}在${world.name}的出场状态`)}"><option value="confirmed" ${['confirmed', 'suggested'].includes(cell.presence) ? 'selected' : ''}>出场</option><option value="excluded" ${cell.presence === 'excluded' ? 'selected' : ''}>不出场</option><option value="unassigned" ${cell.presence === 'unassigned' ? 'selected' : ''}>待确认</option></select><div class="world-assignment-grid"><input data-world-assignment-order type="number" min="0" value="${Number(cell.appearance_order || 0)}" placeholder="出场顺序"><input data-world-assignment-look value="${escapeHtml(cell.look_id || '')}" placeholder="造型 ID"><input data-world-assignment-age value="${escapeHtml(cell.age_state_id || '')}" placeholder="年龄状态 ID"><input data-world-assignment-camera value="${escapeHtml(cell.camera_id || '')}" placeholder="机位 ID"><input data-world-assignment-entry value="${escapeHtml(cell.entry_direction || '')}" placeholder="入场方向"><input data-world-assignment-exit value="${escapeHtml(cell.exit_direction || '')}" placeholder="离场方向"></div><input data-world-assignment-role value="${escapeHtml(cell.role || '')}" placeholder="角色与关键动作"><input data-world-assignment-blocking value="${escapeHtml(cell.blocking || '')}" placeholder="站位与调度"></td>`;
    }).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

function transitionCards(bundle = {}) {
  const transitions = list(bundle.production_manifest?.transitions);
  if (!transitions.length) return '<div class="scene-world-empty">当前为单场景任务，或尚未建立跨场景衔接。</div>';
  return `<div class="scene-transition-list">${transitions.map((edge, index) => {
    const from = worldById(bundle, edge.from_world_id);
    const to = worldById(bundle, edge.to_world_id);
    return `<article>
      <span>${String(index + 1).padStart(2, '0')}</span>
      <div><b>${escapeHtml(from?.name || edge.from_world_id)} → ${escapeHtml(to?.name || edge.to_world_id)}</b><p>${escapeHtml(edge.reason || '等待根据相邻镜头确定具体转场')}</p><small>${escapeHtml([edge.visual_bridge, edge.audio_bridge].filter(Boolean).join(' · ') || '视觉锚点与声音桥待补充')}</small></div>
      <button class="btn small" type="button" data-enter-scene-world="${escapeHtml(edge.from_world_id)}">从来源场景查看</button>
    </article>`;
  }).join('')}</div>`;
}

export function renderSceneWorldWorkspace(bundle = {}) {
  const counts = bundle.production_manifest?.counts || {};
  const ready = Number(counts.worlds || 0);
  const planned = Number(counts.planned_scenes || bundle.assets?.scenes?.length || 0);
  if (!ready) return `<section class="scene-world-locked" data-scene-world-locked><div><span>第 3 步 · 场景世界</span><h2>尚未建立场景文字方案</h2><p>请先返回目标与材料建立人物和场景规划；此处不会要求先生成付费图片。</p></div><span class="status-tag is-neutral">等待文字规划</span></section>`;
  const visualReady = list(bundle.scene_worlds).filter(world => world.visual_authority_ready).length;
  const partial = visualReady < planned ? `<div class="scene-world-partial">${planned} 个文字场景均已进入预分配；其中 ${visualReady} 个已有视觉资产。请先确认出场、造型、机位与地点关系，再按场景单独生成。</div>` : '';
  return `<section class="scene-world-workspace" data-scene-world-workspace>
    <header>
      <div><small>SCENEWORLD · 通用场景生产</small><h2>生产清单与场景世界</h2><p>人物档案保持独立；这里负责人物与场景分配、动态观察点、机位以及跨场景衔接。</p></div>
      <div><button class="btn" type="button" data-scene-world-tab-target="matrix">人物×场景</button><button class="btn" type="button" data-scene-world-tab-target="transitions">场景衔接</button></div>
    </header>
    ${partial}<div class="scene-world-tabs">
      <button class="active" type="button" data-scene-world-tab="overview">生产清单</button>
      <button type="button" data-scene-world-tab="worlds">场景世界</button>
      <button type="button" data-scene-world-tab="matrix">人物×场景</button>
      <button type="button" data-scene-world-tab="transitions">场景衔接</button>
    </div>
    <div data-scene-world-pane="overview">${manifestSummary(bundle)}${worldCards(bundle)}</div>
    <div data-scene-world-pane="worlds" hidden>${worldCards(bundle)}</div>
    <div data-scene-world-pane="matrix" hidden>${characterWorldMatrix(bundle)}</div>
    <div data-scene-world-pane="transitions" hidden>${transitionCards(bundle)}</div>
  </section>`;
}

function initNativeSceneWorldViewer({ overlay, bundle, world }) {
  const host = overlay.querySelector('[data-scene-world-canvas]');
  host.innerHTML = '<canvas class="scene-world-native-canvas" aria-label="可旋转场景模型"></canvas>';
  host.dataset.viewerEngine = 'native-canvas';
  const canvas = host.querySelector('canvas');
  const context = canvas.getContext('2d');
  const colors = ['#1cc8a0', '#50a9ff', '#a883ff', '#e8b55d', '#ff7f73'];
  const state = { yaw: -0.62, pitch: 0.62, zoom: 34, centerX: 0, centerZ: 0, mode: 'model', dragging: false, x: 0, y: 0 };
  const matrixRows = list(bundle.production_manifest?.character_world_matrix);
  const zones = list(world.zones).length ? list(world.zones) : [{ id: `${world.id}_main`, name: world.name, bounds: { x: 0, z: 0, width: 4, depth: 3 } }];

  const project = (point, width, height) => {
    const x = Number(point.x || 0) - state.centerX;
    const z = Number(point.z || 0) - state.centerZ;
    const y = Number(point.y || 0);
    const rx = x * Math.cos(state.yaw) - z * Math.sin(state.yaw);
    const rz = x * Math.sin(state.yaw) + z * Math.cos(state.yaw);
    const sy = y * Math.cos(state.pitch) - rz * Math.sin(state.pitch);
    return { x: width / 2 + rx * state.zoom, y: height * 0.58 - sy * state.zoom, depth: rz };
  };
  const polygon = (points, fill, stroke = '#ffffff28') => {
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.stroke();
  };
  const draw = () => {
    host.dataset.viewerMode = state.mode;
    host.dataset.viewerYaw = state.yaw.toFixed(3);
    host.dataset.viewerPitch = state.pitch.toFixed(3);
    const width = Math.max(320, host.clientWidth);
    const height = Math.max(320, host.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#07191f');
    gradient.addColorStop(1, '#041015');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#1d4a4f88';
    context.lineWidth = 1;
    for (let line = -8; line <= 8; line += 1) {
      const a = project({ x: line, y: 0, z: -8 }, width, height);
      const b = project({ x: line, y: 0, z: 8 }, width, height);
      const c = project({ x: -8, y: 0, z: line }, width, height);
      const d = project({ x: 8, y: 0, z: line }, width, height);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
      context.beginPath(); context.moveTo(c.x, c.y); context.lineTo(d.x, d.y); context.stroke();
    }
    zones.map((zone, index) => {
      const bounds = zone.bounds || {};
      const cx = Number(bounds.x || 0);
      const cz = Number(bounds.z || 0);
      const halfW = Math.max(0.7, Number(bounds.width || 3) / 2);
      const halfD = Math.max(0.7, Number(bounds.depth || 2.4) / 2);
      const boxHeight = 0.28 + (index % 3) * 0.12;
      const bottom = [
        { x: cx - halfW, y: 0, z: cz - halfD }, { x: cx + halfW, y: 0, z: cz - halfD },
        { x: cx + halfW, y: 0, z: cz + halfD }, { x: cx - halfW, y: 0, z: cz + halfD },
      ];
      const top = bottom.map(point => ({ ...point, y: boxHeight }));
      return { zone, index, bottom: bottom.map(point => project(point, width, height)), top: top.map(point => project(point, width, height)), depth: project({ x: cx, y: 0, z: cz }, width, height).depth };
    }).sort((a, b) => a.depth - b.depth).forEach(item => {
      const color = colors[item.index % colors.length];
      polygon([item.bottom[1], item.bottom[2], item.top[2], item.top[1]], `${color}45`);
      polygon([item.bottom[2], item.bottom[3], item.top[3], item.top[2]], `${color}2f`);
      polygon(item.top, `${color}9a`, `${color}dd`);
      const label = item.top.reduce((acc, point) => ({ x: acc.x + point.x / 4, y: acc.y + point.y / 4 }), { x: 0, y: 0 });
      context.fillStyle = '#f3ffff'; context.font = '600 12px system-ui'; context.textAlign = 'center';
      context.fillText(item.zone.name || `区域 ${item.index + 1}`, label.x, label.y - 8);
    });
    if (state.mode === 'blocking') {
      matrixRows.forEach((row, index) => {
        const cell = list(row.cells).find(item => item.world_id === world.id);
        if (cell?.presence !== 'confirmed') return;
        const position = project({ x: (index - (matrixRows.length - 1) / 2) * 0.85, y: 0.75, z: 0 }, width, height);
        context.fillStyle = '#ffd49b'; context.beginPath(); context.arc(position.x, position.y - 14, 7, 0, Math.PI * 2); context.fill();
        context.strokeStyle = '#fff1d5'; context.lineWidth = 5; context.beginPath(); context.moveTo(position.x, position.y - 5); context.lineTo(position.x, position.y + 23); context.stroke();
        context.fillStyle = '#ffffff'; context.font = '11px system-ui'; context.fillText(row.name || `人物 ${index + 1}`, position.x, position.y + 40);
      });
    }
    if (state.mode === 'camera' || state.mode === 'model') {
      list(world.cameras).forEach((cameraNode, index) => {
        const pose = list(cameraNode.pose?.position);
        const marker = project({ x: Number(pose[0]) || Math.cos(index) * 3.5, y: Number(pose[1]) || 1.4, z: Number(pose[2]) || Math.sin(index) * 3.5 }, width, height);
        context.fillStyle = '#f8fbff'; context.fillRect(marker.x - 8, marker.y - 6, 16, 12);
        context.fillStyle = '#61e7c2aa'; context.beginPath(); context.moveTo(marker.x, marker.y); context.lineTo(marker.x - 20, marker.y + 34); context.lineTo(marker.x + 20, marker.y + 34); context.closePath(); context.fill();
      });
    }
    context.fillStyle = '#8aabb2'; context.font = '11px system-ui'; context.textAlign = 'left';
    context.fillText('NATIVE 3D PROXY · 实时旋转预览', 18, 26);
  };
  const reset = () => { Object.assign(state, { yaw: -0.62, pitch: 0.62, zoom: 34, centerX: 0, centerZ: 0 }); draw(); };
  const pointerDown = event => { state.dragging = true; state.x = event.clientX; state.y = event.clientY; canvas.setPointerCapture?.(event.pointerId); };
  const pointerMove = event => {
    if (!state.dragging) return;
    state.yaw += (event.clientX - state.x) * 0.009;
    state.pitch = Math.max(0.18, Math.min(1.2, state.pitch + (event.clientY - state.y) * 0.005));
    state.x = event.clientX; state.y = event.clientY; draw();
  };
  const pointerUp = () => { state.dragging = false; };
  const wheel = event => { event.preventDefault(); state.zoom = Math.max(18, Math.min(68, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1))); draw(); };
  const bindings = [];
  const bind = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    if (target) bindings.push(() => target.removeEventListener(type, handler, options));
  };
  bind(canvas, 'pointerdown', pointerDown);
  bind(canvas, 'pointermove', pointerMove);
  bind(canvas, 'pointerup', pointerUp);
  bind(canvas, 'pointercancel', pointerUp);
  bind(canvas, 'wheel', wheel, { passive: false });
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(host);
  bind(overlay.querySelector('[data-reset-world-view]'), 'click', reset);
  overlay.querySelectorAll('[data-focus-zone]').forEach(button => bind(button, 'click', () => {
    const zone = zones.find(item => String(item.id) === String(button.dataset.focusZone));
    if (!zone) return;
    state.centerX = Number(zone.bounds?.x || 0); state.centerZ = Number(zone.bounds?.z || 0); state.zoom = 48; draw();
  }));
  overlay.querySelectorAll('[data-focus-camera]').forEach(button => bind(button, 'click', () => {
    const cameraNode = list(world.cameras).find(item => item.id === button.dataset.focusCamera);
    const pose = list(cameraNode?.pose?.position);
    if (!cameraNode) return;
    state.centerX = Number(pose[0]) || 0; state.centerZ = Number(pose[2]) || 0; state.mode = 'camera'; state.zoom = 48; draw();
  }));
  const setMode = mode => {
    state.mode = mode;
    if (state.mode === 'structure') { state.pitch = 1.18; state.zoom = 32; }
    else if (state.mode === 'blocking') { state.pitch = 0.72; state.zoom = 40; }
    else if (state.mode === 'camera') { state.pitch = 0.5; state.zoom = 38; }
    else reset();
    draw();
  };
  reset();
  return { reset, setMode, dispose() {
    resizeObserver.disconnect();
    bindings.forEach(dispose => dispose());
    host.replaceChildren();
  } };
}

function initSceneWorldViewer({ overlay, bundle, world }) {
  const host = overlay.querySelector('[data-scene-world-canvas]');
  const help = overlay.querySelector('[data-scene-world-help]');
  const nodes = photoNodes(world);
  const layoutNode = nodes.find(node => String(node.view_key || '').toLowerCase() === 'layout');
  const primaryNode = nodes.find(node => String(node.view_key || '').toLowerCase() === 'master')
    || nodes.find(node => !node.is_panorama && String(node.view_key || '').toLowerCase() !== 'layout')
    || null;
  const interactionNode = nodes.find(node => String(node.view_key || '').toLowerCase() === 'interaction') || primaryNode;
  const panoramaNode = nodes.find(node => node.is_panorama);
  let currentNode = primaryNode;
  let viewer = null;
  let activation = 0;
  const clearViewer = () => {
    activation += 1;
    viewer?.dispose?.();
    viewer = null;
    host.replaceChildren();
    delete host.dataset.viewerEngine;
  };
  const activateModeButton = mode => overlay.querySelectorAll('[data-world-mode]').forEach(button => button.classList.toggle('active', button.dataset.worldMode === mode));
  const thumbUrl = url => window.VidoMediaDelivery?.previewUrl?.(url, 320, 'webp') || url;
  const showPhoto = (node, mode = 'model') => {
    if (!node?.image_url) return showNative('structure');
    if (node.is_panorama) return showPanorama(node);
    clearViewer();
    activateModeButton(mode);
    currentNode = node;
    host.innerHTML = `<div class="scene-world-photo-viewer"><div class="scene-world-photo-stage">
      <img alt="${escapeHtml(world.name)}真实场景视图" data-media-original="${escapeHtml(node.image_url)}">
      <div class="scene-world-photo-status"><b>${escapeHtml(node.name || '真实场景视图')}</b><small>${Math.max(1, nodes.indexOf(node) + 1)} / ${nodes.length} · 平面参考图</small></div>
      <div class="scene-world-photo-error" data-photo-error hidden>当前图片无法加载，请重试或检查场景资产。</div>
    </div><div class="scene-world-photo-strip">${nodes.map((item, index) => `<button type="button" data-photo-node="${escapeHtml(item.id)}" class="${item.id === node.id ? 'active' : ''}" title="${escapeHtml(item.name || `视角 ${index + 1}`)}"><img src="${escapeHtml(thumbUrl(item.image_url))}" loading="lazy" decoding="async" alt=""><span>${escapeHtml(item.name || `视角 ${index + 1}`)}${item.is_panorama ? '<small>3DoF</small>' : ''}</span></button>`).join('')}</div></div>`;
    const image = host.querySelector('.scene-world-photo-stage>img');
    const error = host.querySelector('[data-photo-error]');
    image.addEventListener('load', () => { image.hidden = false; error.hidden = true; }, { once: true });
    image.addEventListener('error', () => { image.hidden = true; error.hidden = false; }, { once: true });
    image.src = node.image_url;
    window.VidoMediaDelivery?.processImage?.(image);
    host.querySelectorAll('[data-photo-node]').forEach(button => button.addEventListener('click', () => showPhoto(nodes.find(item => String(item.id) === String(button.dataset.photoNode)))));
    host.dataset.viewerEngine = 'real-photo';
    host.dataset.activePhotoNode = String(node.id || '');
    if (help) help.textContent = '平面参考图 · 点击下方视角切换；360观察点会单独加载球形查看器';
  };
  const showPanorama = async node => {
    if (!node?.image_url) return;
    clearViewer();
    const requestToken = activation;
    activateModeButton('panorama');
    host.innerHTML = '<div class="scene-world-canvas-loading">正在按需加载3DoF球形全景查看器…</div>';
    if (help) help.textContent = '3DoF原地环视：可改变观看方向与FOV，不支持摄像机前后左右位移';
    try {
      const module = await import('./panoramaViewer.js?v=20260827-production-v233g');
      if (requestToken !== activation) return;
      host.replaceChildren();
      viewer = module.mountPanoramaViewer({ host, source: node.image_url, label: node.name || world.name });
      currentNode = node;
      host.dataset.activePhotoNode = String(node.id || '');
    } catch (error) {
      if (requestToken !== activation) return;
      host.innerHTML = `<div class="scene-world-canvas-error"><div><b>全景查看器没有加载完成</b><span>${escapeHtml(error.message || '请稍后重试')}</span></div></div>`;
      host.dataset.viewerEngine = 'panorama-load-failed';
    }
  };
  const showNative = mode => {
    clearViewer();
    activateModeButton(mode);
    viewer = initNativeSceneWorldViewer({ overlay, bundle, world });
    viewer.setMode(mode);
    if (help) help.textContent = mode === 'blocking'
      ? '结构代理站位 · 仅用于编排方向，不代表6DoF深度、碰撞与真实遮挡'
      : (mode === 'camera' ? '机位结构代理 · 拖动旋转，滚轮缩放' : '场景结构 / 路线代理 · 仅在本模式下初始化Canvas');
  };
  const showSpatialNotice = () => {
    clearViewer();
    activateModeButton('spatial');
    host.dataset.viewerEngine = 'spatial-6dof-handoff';
    host.innerHTML = '<div class="scene-world-mode-notice"><b>6DoF可移动空间</b><p>前后左右移动、人物路径和遮挡需使用深度 / 几何空间资产，不会用平面全景或结构代理冒充。</p><button class="btn" type="button" data-spatial-director-handoff>打开6DoF导演台</button></div>';
    host.querySelector('[data-spatial-director-handoff]')?.addEventListener('click', () => overlay.querySelector('[data-open-director-studio]')?.click());
    if (help) help.textContent = '6DoF仅在空间模型及深度 / 几何证据就绪后可用';
  };
  const showInitialNotice = () => {
    clearViewer();
    activateModeButton('model');
    host.dataset.viewerEngine = 'scene-mode-not-selected';
    host.innerHTML = `<div class="scene-world-mode-notice"><b>${panoramaNode ? '全景观察点已就绪' : '尚无可显示的平面场景图'}</b><p>${panoramaNode ? '点击上方“360原地环视（3DoF）”后才会按需加载球形查看器。' : '可选择“结构 / 路线”查看轻量代理，或先生成360全景。'}</p></div>`;
    if (help) help.textContent = '只在选择对应模式后加载查看器，避免无效的首次绘制';
  };
  const showMode = mode => {
    activateModeButton(mode);
    if (mode === 'panorama') return panoramaNode ? showPanorama(panoramaNode) : showPhoto(primaryNode);
    if (mode === 'spatial') return showSpatialNotice();
    if (mode === 'structure') return layoutNode ? showPhoto(layoutNode, 'structure') : showNative('structure');
    if (mode === 'blocking') return interactionNode ? showPhoto(interactionNode, 'blocking') : showNative('blocking');
    if (mode === 'camera') return currentNode && !currentNode.is_panorama ? showPhoto(currentNode, 'camera') : showNative('camera');
    return primaryNode ? showPhoto(primaryNode) : showInitialNotice();
  };

  overlay.querySelectorAll('[data-focus-observation]').forEach(button => button.addEventListener('click', () => {
    const node = nodes.find(item => String(item.id) === String(button.dataset.focusObservation));
    if (node) showPhoto(node);
  }));
  overlay.querySelectorAll('[data-focus-camera]').forEach(button => button.addEventListener('click', () => {
    const cameraNode = list(world.cameras).find(item => String(item.id) === String(button.dataset.focusCamera));
    const node = nodes.find(item => String(item.camera_id) === String(button.dataset.focusCamera))
      || nodes.find(item => item.image_url && item.image_url === cameraNode?.image_url);
    if (node) showPhoto(node);
  }));
  overlay.querySelectorAll('[data-world-mode]').forEach(button => button.addEventListener('click', () => showMode(button.dataset.worldMode)));
  overlay.querySelector('[data-reset-world-view]')?.addEventListener('click', () => viewer?.reset?.());
  if (primaryNode) showPhoto(primaryNode); else showInitialNotice();

  return () => {
    clearViewer();
  };
}

async function openSceneWorldStudio(bundle, world) {
  const realPhotoNodes = photoNodes(world);
  const hasRealPhotos = realPhotoNodes.length > 0;
  const overlay = document.createElement('div');
  overlay.className = 'scene-world-studio';
  overlay.innerHTML = `<section>
    <header><div><small>${escapeHtml(world.capabilities?.world_mode || 'scene_world')} · 版本 ${world.revision || 1}</small><h2>${escapeHtml(world.name)}</h2><p>${escapeHtml(world.story_purpose || world.description || '场景世界交互预演')}</p></div><button type="button" data-close-scene-world aria-label="关闭">×</button></header>
    <nav class="scene-world-view-modes">
      <button class="active" type="button" data-world-mode="model">${hasRealPhotos ? '真实图片' : '场景结构'}</button>
      <button type="button" data-world-mode="panorama" ${realPhotoNodes.some(node => node.is_panorama) ? '' : 'disabled title="当前没有已验收的2:1等距柱状全景"'}>360原地环视（3DoF）</button>
      <button type="button" data-world-mode="spatial" ${world.capabilities?.supports_spatial_model ? '' : 'disabled title="当前没有深度、几何或空间模型"'}>可移动空间（6DoF）</button>
      <button type="button" data-world-mode="structure">结构 / 路线</button>
      <button type="button" data-world-mode="blocking">人物站位</button>
      <button type="button" data-world-mode="camera">机位与镜头</button><button type="button" data-open-director-studio>3D导演预演</button>
    </nav>
    <div class="scene-world-studio-layout">
      <aside><h3>真实图片视角</h3><div class="scene-world-observation-list">${realPhotoNodes.length ? realPhotoNodes.map((node, index) => `<button type="button" data-focus-observation="${escapeHtml(node.id)}"><b>${escapeHtml(node.name || `视角 ${index + 1}`)}</b><small>${escapeHtml(node.view_key === 'layout' ? '俯视布局与路线参考' : node.is_panorama ? '可360度环视的全景观察点' : '现有真实场景图片')}</small></button>`).join('') : '<small>当前场景还没有真实图片。</small>'}</div><h3>空间区域</h3><div class="scene-world-zone-list">${list(world.zones).map(zone => `<button type="button" data-focus-zone="${escapeHtml(zone.id)}"><b>${escapeHtml(zone.name)}</b><small>${escapeHtml(zone.purpose || '场景区域')}</small></button>`).join('')}</div><h3>场景入口</h3><div class="scene-world-portal-list">${list(world.portals).length ? list(world.portals).map(portal => `<button type="button" data-open-world="${escapeHtml(portal.to_world_id)}">${escapeHtml(portal.label)}</button>`).join('') : '<small>当前没有跨场景入口</small>'}</div></aside>
      <main><div class="scene-world-canvas" data-scene-world-canvas><div class="scene-world-canvas-loading">${hasRealPhotos ? '正在载入现有场景图片…' : '结构代理将在选择后按需建立…'}</div></div><div class="scene-world-canvas-help" data-scene-world-help>${hasRealPhotos ? '点击左侧观察点或右侧机位切换参考图' : '选择结构 / 路线后才初始化可旋转代理'}</div></main>
      <aside class="scene-world-inspector"><h3>动态机位</h3><div>${list(world.cameras).length ? list(world.cameras).map(camera => `<button type="button" data-focus-camera="${escapeHtml(camera.id)}"><b>${escapeHtml(camera.name)}</b><small>${escapeHtml([camera.framing, camera.lens, camera.movement].filter(Boolean).join(' · ') || '机位参数待完善')}</small></button>`).join('') : '<small>尚未生成机位；可以先查看场景代理模型。</small>'}</div><details open><summary>当前能力</summary><div class="scene-world-capabilities">${capabilityChips(world)}</div></details><button class="btn" type="button" data-reset-world-view>重置视角</button></aside>
    </div>
  </section>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  let disposeViewer = () => {};
  const close = () => {
    disposeViewer();
    overlay.remove();
    document.body.classList.remove('modal-open');
  };
  overlay.querySelector('[data-close-scene-world]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

  disposeViewer = initSceneWorldViewer({ overlay, bundle, world });
  overlay.querySelector('[data-open-director-studio]')?.addEventListener('click', async () => {
    try {
      const module = await import('./directorStudioView.js?v=20260827-production-v233g');
      await module.openDirectorStudio({ taskId: bundle.project.id, world });
    } catch (error) { toast(error.message || '导演台加载失败', 'danger'); }
  });

  overlay.querySelectorAll('[data-open-world]').forEach(button => button.addEventListener('click', () => {
    const next = worldById(bundle, button.dataset.openWorld);
    if (!next) return toast('目标场景尚未建立', 'warning');
    close();
    openSceneWorldStudio(bundle, next);
  }));
}

export function bindSceneWorldWorkspace(host, bundle = {}, store = null) {
  const root = host.querySelector('[data-scene-world-workspace]');
  if (!root) return;
  const activate = name => {
    root.querySelectorAll('[data-scene-world-tab]').forEach(button => button.classList.toggle('active', button.dataset.sceneWorldTab === name));
    root.querySelectorAll('[data-scene-world-pane]').forEach(pane => { pane.hidden = pane.dataset.sceneWorldPane !== name; });
  };
  root.querySelectorAll('[data-scene-world-tab]').forEach(button => button.addEventListener('click', () => activate(button.dataset.sceneWorldTab)));
  root.querySelectorAll('[data-scene-world-tab-target]').forEach(button => button.addEventListener('click', () => activate(button.dataset.sceneWorldTabTarget)));
  root.querySelectorAll('[data-enter-scene-world]').forEach(button => button.addEventListener('click', () => {
    const world = worldById(bundle, button.dataset.enterSceneWorld);
    if (world) openSceneWorldStudio(bundle, world);
  }));
  root.querySelectorAll('[data-plan-scene-experience]').forEach(button => button.addEventListener('click', () => {
    const world = worldById(bundle, button.dataset.planSceneExperience);
    if (world) openSceneExperiencePlanner(bundle, world);
  }));
  root.querySelector('[data-save-world-assignments]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const assignments = [...root.querySelectorAll('[data-world-assignment]')].map(select => ({
      character_id: select.dataset.characterId,
      world_id: select.dataset.worldId,
      presence: select.value,
      role: select.closest('td')?.querySelector('[data-world-assignment-role]')?.value || '',
      look_id: select.closest('td')?.querySelector('[data-world-assignment-look]')?.value || '',
      age_state_id: select.closest('td')?.querySelector('[data-world-assignment-age]')?.value || '',
      appearance_order: Number(select.closest('td')?.querySelector('[data-world-assignment-order]')?.value || 0),
      camera_id: select.closest('td')?.querySelector('[data-world-assignment-camera]')?.value || '',
      entry_direction: select.closest('td')?.querySelector('[data-world-assignment-entry]')?.value || '',
      exit_direction: select.closest('td')?.querySelector('[data-world-assignment-exit]')?.value || '',
      blocking: select.closest('td')?.querySelector('[data-world-assignment-blocking]')?.value || '',
    }));
    button.disabled = true;
    try {
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(bundle.project.id)}/scene-world-assignments`, {
        method: 'PUT',
        body: { assignments, expected_revision: bundle.production_manifest?.assignment_revision || 1 },
      });
      bundle.production_manifest = result.manifest || bundle.production_manifest;
      toast('人物与场景分配已保存。后续人物图片换版本不会清空该关系。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { button.disabled = false; }
  });
}

function openSceneExperiencePlanner(bundle, world) {
  const current = world.experience || {};
  const overlay = document.createElement('div');
  overlay.className = 'scene-experience-planner';
  overlay.innerHTML = `<form><header><div><small>场景空间能力</small><h2>${escapeHtml(world.name)}</h2><p>按当前故事选择空间体验；结构化3D导演预演可立即使用，真实6DoF需要额外空间模型。</p></div><button type="button" data-close>×</button></header><div class="scene-experience-form"><label><span>目标体验</span><select name="requested_mode"><option value="photo_views">多视角图片</option><option value="panorama_360">360原地环视（3DoF）</option><option value="director_3d">3D导演预演（结构化）</option><option value="spatial_3d">真实可移动空间（6DoF，需供应商）</option></select></label><label><span>场景来源</span><select name="source_mode"><option value="existing_assets">沿用现有图片</option><option value="ai_concept">AI概念空间</option><option value="real_capture">真实场地拍摄/扫描</option></select></label><label><span>观察点数量</span><input name="observation_point_target" type="number" min="1" max="30" value="${Number(current.observation_point_target || 1)}"></label><label class="full"><span>进入路线和希望查看的区域</span><textarea name="route_brief" rows="4" placeholder="说明希望查看的区域、镜头方向，以及是否需要摄像机或人物真实位移。">${escapeHtml(current.route_brief || '')}</textarea></label><div class="scene-experience-warning"><b>能力边界</b><p>3D导演预演使用可旋转结构、区域、人物站位和镜头路线，不调用图像模型；3DoF只能原地转向；真实6DoF还需要深度、几何、碰撞与遮挡验证，当前未配置重建供应商。</p></div></div><footer><button class="btn" type="button" data-ai-assist-experience>AI 完善规划</button><button class="btn" type="button" data-close>取消</button><button class="btn primary" type="submit">保存空间规划</button></footer></form>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');
  const form = overlay.querySelector('form');
  form.elements.requested_mode.value = current.requested_mode || current.current_mode || 'photo_views';
  form.elements.source_mode.value = current.source_mode || 'existing_assets';
  const close = () => { overlay.remove(); document.body.classList.remove('modal-open'); };
  overlay.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', close));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  form.querySelector('[data-ai-assist-experience]')?.addEventListener('click', async event => {
    const instruction = await promptDialog('AI 完善360 / 3D规划', {
      inputLabel: '你希望观众怎么看这个场景',
      placeholder: '例如：先从门口看全景，再跟随人物走到柜台，最后环绕展示核心区域',
      multiline: true, rows: 4, maxLength: 800, confirmText: '完善规划',
    });
    if (!instruction) return;
    const button = event.currentTarget;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'AI 正在完善…';
    try {
      const data = await request('/api/new-story-ad/assist', { method: 'POST', timeoutMs: 120000, body: {
        task_id: bundle.project.id,
        mode: 'scene_experience',
        brief: bundle.brief?.text || '',
        content_mode: bundle.brief?.content_mode || bundle.project?.request?.content_mode,
        target_scene: world,
        scene_experience: {
          requested_mode: form.elements.requested_mode.value,
          source_mode: form.elements.source_mode.value,
          observation_point_target: Number(form.elements.observation_point_target.value) || 1,
          route_brief: form.elements.route_brief.value.trim(),
        },
        user_instruction: instruction,
      } });
      const plan = data.experience_plan || {};
      if (plan.requested_mode) form.elements.requested_mode.value = plan.requested_mode;
      if (plan.source_mode) form.elements.source_mode.value = plan.source_mode;
      if (plan.observation_point_target) form.elements.observation_point_target.value = plan.observation_point_target;
      if (plan.route_brief) form.elements.route_brief.value = plan.route_brief;
      toast('AI 已结合当前故事、场景区域和能力边界完善规划，请确认后保存。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { button.disabled = false; button.textContent = oldText; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const requestedMode = form.elements.requested_mode.value;
      const result = await saveSceneWorld(bundle.project.id, world, { experience: {
        ...current,
        requested_mode: requestedMode,
        source_mode: form.elements.source_mode.value,
        observation_point_target: Math.max(1, Math.min(30, Number(form.elements.observation_point_target.value) || 1)),
        route_brief: form.elements.route_brief.value.trim(),
        status: requestedMode === current.current_mode ? current.status || 'base_ready' : 'planned',
      } });
      if (result.world) Object.assign(world, result.world);
      if (result.manifest) bundle.production_manifest = result.manifest;
      toast(requestedMode === 'director_3d' ? '3D导演预演规划已保存，正在打开结构化3D工作台。' : '空间规划已保存。需要新增全景或真实6DoF素材时，系统会按该规划生成或接收上传素材。', 'success');
      close();
      if (requestedMode === 'director_3d') openSceneWorldStudio(bundle, world);
    } catch (error) { toast(error.message, 'danger'); submit.disabled = false; }
  });
}

export async function saveSceneWorld(taskId, world, patch = {}) {
  return request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/scene-worlds/${encodeURIComponent(world.id)}`, {
    method: 'PUT',
    body: { ...patch, expected_revision: world.revision || 1 },
  });
}
