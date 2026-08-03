import { request } from '../api.js?v=20260803-scene-world-v1';
import { escapeHtml, toast } from '../components/ui.js?v=20260803-scene-world-v1';

const CAPABILITY_LABELS = {
  supports_panorama: '360观察点',
  supports_structure_map: '结构 / 路线',
  supports_3d_proxy: '可旋转模型',
  supports_navigation: '空间导航',
  supports_camera_orbit: '环绕机位',
  supports_character_blocking: '人物站位',
  supports_motion_path: '行动路线',
  supports_transition_portal: '跨场景入口',
  supports_state_variants: '状态变化',
};

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function worldById(bundle, id) {
  return list(bundle.scene_worlds).find(world => String(world.id) === String(id));
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
    <article><span>动态机位</span><b>${Number(counts.cameras || 0)}</b><small>可进入、旋转和查看视线</small></article>
    <article><span>场景衔接</span><b>${Number(counts.transitions || 0)}</b><small>只在 scene_id 变化时建立</small></article>
  </div>`;
}

function worldCards(bundle = {}) {
  const worlds = list(bundle.scene_worlds);
  if (!worlds.length) return '<div class="scene-world-empty">尚未建立场景世界。请先点击“建立场景规划”。</div>';
  return `<div class="scene-world-card-grid">${worlds.map(world => `<article class="scene-world-card">
    <div class="scene-world-card-visual" style="${world.source_asset?.image_url ? `background-image:linear-gradient(180deg,transparent,#071418dd),url('${escapeHtml(world.source_asset.image_url)}')` : ''}">
      <span>${escapeHtml(world.capabilities?.world_mode || 'scene_world')}</span>
      <b>${escapeHtml(world.name)}</b>
    </div>
    <div class="scene-world-card-body">
      <p>${escapeHtml(world.story_purpose || world.description || '等待补充当前场景的剧情作用')}</p>
      <div class="scene-world-capabilities">${capabilityChips(world)}</div>
      <small>${world.zones?.length || 0} 个区域 · ${world.observation_nodes?.length || 0} 个观察点 · ${world.cameras?.length || 0} 个机位 · 版本 ${world.revision || 1}</small>
    </div>
    <div class="scene-world-card-actions">
      <button class="btn small primary" type="button" data-enter-scene-world="${escapeHtml(world.id)}">进入场景</button>
      <button class="btn small" type="button" data-scene-world-tab-target="matrix">人物×场景</button>
      <button class="btn small" type="button" data-scene-world-tab-target="transitions">查看衔接</button>
    </div>
  </article>`).join('')}</div>`;
}

function characterWorldMatrix(bundle = {}) {
  const worlds = list(bundle.scene_worlds);
  const rows = list(bundle.production_manifest?.character_world_matrix);
  if (!rows.length) return '<div class="scene-world-empty">当前任务没有人物；场景世界仍可作为无人产品或环境广告使用。</div>';
  return `<div class="character-world-matrix-wrap"><table class="character-world-matrix">
    <thead><tr><th>人物</th>${worlds.map(world => `<th>${escapeHtml(world.name)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => `<tr><th><b>${escapeHtml(row.name)}</b><small>${escapeHtml(row.wardrobe || '沿用人物档案穿戴版本')}</small></th>${worlds.map(world => {
      const cell = list(row.cells).find(item => item.world_id === world.id) || {};
      return `<td class="${cell.presence === 'confirmed' ? 'is-confirmed' : ''}"><b>${cell.presence === 'confirmed' ? `已绑定 ${cell.shot_count || 0} 镜` : '待分配'}</b><small>${escapeHtml(cell.role || '可在分镜规划时指定')}</small></td>`;
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
  return `<section class="scene-world-workspace" data-scene-world-workspace>
    <header>
      <div><small>SCENEWORLD · 通用场景生产</small><h2>生产清单与场景世界</h2><p>人物档案保持独立；这里负责人物与场景分配、动态观察点、机位以及跨场景衔接。</p></div>
      <div><button class="btn" type="button" data-scene-world-tab-target="matrix">人物×场景</button><button class="btn" type="button" data-scene-world-tab-target="transitions">场景衔接</button></div>
    </header>
    <div class="scene-world-tabs">
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
  const reset = () => { Object.assign(state, { yaw: -0.62, pitch: 0.62, zoom: 34, centerX: 0, centerZ: 0, mode: 'model' }); draw(); };
  const pointerDown = event => { state.dragging = true; state.x = event.clientX; state.y = event.clientY; canvas.setPointerCapture?.(event.pointerId); };
  const pointerMove = event => {
    if (!state.dragging) return;
    state.yaw += (event.clientX - state.x) * 0.009;
    state.pitch = Math.max(0.18, Math.min(1.2, state.pitch + (event.clientY - state.y) * 0.005));
    state.x = event.clientX; state.y = event.clientY; draw();
  };
  const pointerUp = () => { state.dragging = false; };
  const wheel = event => { event.preventDefault(); state.zoom = Math.max(18, Math.min(68, state.zoom * (event.deltaY > 0 ? 0.9 : 1.1))); draw(); };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('wheel', wheel, { passive: false });
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(host);
  overlay.querySelector('[data-reset-world-view]').addEventListener('click', reset);
  overlay.querySelectorAll('[data-focus-zone]').forEach(button => button.addEventListener('click', () => {
    const zone = zones.find(item => String(item.id) === String(button.dataset.focusZone));
    if (!zone) return;
    state.centerX = Number(zone.bounds?.x || 0); state.centerZ = Number(zone.bounds?.z || 0); state.zoom = 48; draw();
  }));
  overlay.querySelectorAll('[data-focus-camera]').forEach(button => button.addEventListener('click', () => {
    const cameraNode = list(world.cameras).find(item => item.id === button.dataset.focusCamera);
    const pose = list(cameraNode?.pose?.position);
    if (!cameraNode) return;
    state.centerX = Number(pose[0]) || 0; state.centerZ = Number(pose[2]) || 0; state.mode = 'camera'; state.zoom = 48; draw();
  }));
  overlay.querySelectorAll('[data-world-mode]').forEach(button => button.addEventListener('click', () => {
    overlay.querySelectorAll('[data-world-mode]').forEach(item => item.classList.toggle('active', item === button));
    state.mode = button.dataset.worldMode;
    if (state.mode === 'structure') { state.pitch = 1.18; state.zoom = 32; }
    else if (state.mode === 'blocking') { state.pitch = 0.72; state.zoom = 40; }
    else if (state.mode === 'camera') { state.pitch = 0.5; state.zoom = 38; }
    else reset();
    draw();
  }));
  reset();
  return () => {
    resizeObserver.disconnect();
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvas.removeEventListener('wheel', wheel);
  };
}

async function openSceneWorldStudio(bundle, world) {
  const overlay = document.createElement('div');
  overlay.className = 'scene-world-studio';
  overlay.innerHTML = `<section>
    <header><div><small>${escapeHtml(world.capabilities?.world_mode || 'scene_world')} · 版本 ${world.revision || 1}</small><h2>${escapeHtml(world.name)}</h2><p>${escapeHtml(world.story_purpose || world.description || '场景世界交互预演')}</p></div><button type="button" data-close-scene-world aria-label="关闭">×</button></header>
    <nav class="scene-world-view-modes">
      <button class="active" type="button" data-world-mode="model">场景模型</button>
      <button type="button" data-world-mode="structure">结构 / 路线</button>
      <button type="button" data-world-mode="blocking">人物站位</button>
      <button type="button" data-world-mode="camera">机位与镜头</button>
    </nav>
    <div class="scene-world-studio-layout">
      <aside><h3>区域与观察点</h3><div class="scene-world-zone-list">${list(world.zones).map(zone => `<button type="button" data-focus-zone="${escapeHtml(zone.id)}"><b>${escapeHtml(zone.name)}</b><small>${escapeHtml(zone.purpose || '场景区域')}</small></button>`).join('')}</div><h3>场景入口</h3><div class="scene-world-portal-list">${list(world.portals).length ? list(world.portals).map(portal => `<button type="button" data-open-world="${escapeHtml(portal.to_world_id)}">${escapeHtml(portal.label)}</button>`).join('') : '<small>当前没有跨场景入口</small>'}</div></aside>
      <main><div class="scene-world-canvas" data-scene-world-canvas><div class="scene-world-canvas-loading">正在建立可旋转场景代理…</div></div><div class="scene-world-canvas-help">拖动旋转 · 滚轮缩放 · 点击右侧机位进入视角</div></main>
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

  disposeViewer = initNativeSceneWorldViewer({ overlay, bundle, world });

  overlay.querySelectorAll('[data-open-world]').forEach(button => button.addEventListener('click', () => {
    const next = worldById(bundle, button.dataset.openWorld);
    if (!next) return toast('目标场景尚未建立', 'warning');
    close();
    openSceneWorldStudio(bundle, next);
  }));
}

export function bindSceneWorldWorkspace(host, bundle = {}) {
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
}

export async function saveSceneWorld(taskId, world, patch = {}) {
  return request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/scene-worlds/${encodeURIComponent(world.id)}`, {
    method: 'PUT',
    body: { ...patch, expected_revision: world.revision || 1 },
  });
}
