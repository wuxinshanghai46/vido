import { request } from '../api.js?v=20260831-production-v346';
import { escapeHtml, mediaPreview, toast } from '../components/ui.js?v=20260831-production-v346';
import { list, worldById } from './sceneWorldData.js?v=20260831-production-v346';
import { runPanoramaGeneration } from './panoramaGeneration.js?v=20260831-production-v346';
import { capabilityChips } from './sceneWorldCapabilities.js?v=20260831-production-v346';
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
      ${world.source_asset?.image_url ? mediaPreview(world.source_asset, { label: `${world.name}场景原图`, width: 720, zoomWidth: 1600, zoomable: true, zoomGroup: 'scene-world-cards' }) : '<div class="scene-world-card-placeholder"></div>'}
      <div class="scene-world-card-title"><span>${escapeHtml(world.capabilities?.world_mode || 'scene_world')}</span><b>${escapeHtml(world.name)}</b></div>
    </div>
    <div class="scene-world-card-body">
      <p>${escapeHtml(world.story_purpose || world.description || '等待补充当前场景的剧情作用')}</p>
      <div class="scene-place-lineage"><b>地点血缘：${escapeHtml(lineage.place_lineage_id || lineage.place_id || '独立地点')}</b><span>${escapeHtml([lineage.era, lineage.continuity_type, lineage.access_route].filter(Boolean).join(' · '))}</span>${lineage.preserved_anchors?.length ? `<small>保留：${escapeHtml(lineage.preserved_anchors.join('、'))}</small>` : ''}${lineage.rebuilt_elements?.length ? `<small>重建：${escapeHtml(lineage.rebuilt_elements.join('、'))}</small>` : ''}${lineage.forbidden_elements?.length ? `<small>禁止：${escapeHtml(lineage.forbidden_elements.join('、'))}</small>` : ''}</div>
      <div class="scene-world-capabilities">${capabilityChips(world)}</div>
      <small>${world.zones?.length || 0} 个区域 · ${world.observation_nodes?.length || 0} 个观察点 · ${world.cameras?.length || 0} 个机位 · ${escapeHtml({ photo_views: '多视角图片', panorama_360: '3DoF原地环视', spatial_3d: '6DoF可移动空间', structure_proxy: '结构代理' }[world.experience?.current_mode] || '待建立空间')} · 版本 ${world.revision || 1}</small>
      <span class="scene-panorama-status is-${escapeHtml(panoramaStatus)}" data-panorama-status="${escapeHtml(world.id)}">${panoramaReady ? '全景已就绪 · 3DoF' : '尚未生成360全景 · 可按需单独生成'}</span>
      <span class="scene-panorama-status">当前选择：${escapeHtml(selectedExperience)}</span>
    </div>
    <div class="scene-world-card-actions">
      <button class="btn small primary" type="button" data-enter-scene-world="${escapeHtml(world.id)}">进入场景</button>
      <button class="btn small" type="button" data-edit-scene-world="${escapeHtml(world.id)}">编辑场景设定</button>
      <button class="btn small" type="button" data-plan-scene-experience="${escapeHtml(world.id)}">选择360 / 3D模式</button>
      ${panoramaReady ? '' : `<button class="btn small" type="button" data-generate-panorama="${escapeHtml(world.id)}">生成360全景</button>`}
      <span class="status-tag ${panoramaReady ? 'is-ready' : 'is-neutral'}">${panoramaReady ? '360°全景已纳入制作图谱' : '普通场景默认不额外扣费生成360°'}</span>
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

function initNativeSceneWorldViewer({ overlay, bundle, world, authority }) {
  const host = overlay.querySelector('[data-scene-world-canvas]');
  host.innerHTML = '<canvas class="scene-world-native-canvas" aria-label="可旋转场景模型"></canvas>';
  host.dataset.viewerEngine = 'native-canvas';
  const canvas = host.querySelector('canvas');
  const context = canvas.getContext('2d');
  const colors = ['#1cc8a0', '#50a9ff', '#a883ff', '#e8b55d', '#ff7f73'];
  const state = { yaw: -0.62, pitch: 0.62, zoom: 34, centerX: 0, centerZ: 0, mode: 'model', dragging: false, x: 0, y: 0 };
  const matrixRows = list(bundle.production_manifest?.subject_world_matrix).length
    ? list(bundle.production_manifest.subject_world_matrix)
    : list(bundle.production_manifest?.character_world_matrix);
  const cameraRows = authority.sceneCameraRows(bundle, world);
  const zones = list(world.zones).length ? list(world.zones) : [{ id: `${world.id}_main`, name: world.name, bounds: { x: 0, z: 0, width: 4, depth: 3 } }];
  const nativePhotoNodes = photoNodes(world);
  const textureNode = nativePhotoNodes.find(node => String(node.view_key || '').toLowerCase() === 'layout')
    || nativePhotoNodes.find(node => String(node.view_key || '').toLowerCase() === 'master')
    || nativePhotoNodes[0]
    || null;
  const sceneTexture = textureNode?.image_url ? new Image() : null;
  let textureReady = false;

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
    if (sceneTexture && textureReady) {
      const floorA = project({ x: -6, y: 0.015, z: -4 }, width, height);
      const floorB = project({ x: 6, y: 0.015, z: -4 }, width, height);
      const floorD = project({ x: -6, y: 0.015, z: 4 }, width, height);
      context.save();
      context.globalAlpha = textureNode?.view_key === 'layout' ? 0.8 : 0.48;
      context.imageSmoothingEnabled = true;
      context.transform(
        (floorB.x - floorA.x) / sceneTexture.naturalWidth,
        (floorB.y - floorA.y) / sceneTexture.naturalWidth,
        (floorD.x - floorA.x) / sceneTexture.naturalHeight,
        (floorD.y - floorA.y) / sceneTexture.naturalHeight,
        floorA.x,
        floorA.y,
      );
      context.drawImage(sceneTexture, 0, 0);
      context.restore();
    }
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
      context.fillStyle = '#f3ffff'; context.font = '600 13px Inter, "PingFang SC", "Microsoft YaHei", sans-serif'; context.textAlign = 'center';
      context.fillText(item.zone.name || `区域 ${item.index + 1}`, label.x, label.y - 8);
    });
    if (['model', 'blocking', 'camera'].includes(state.mode)) {
      matrixRows.forEach((row, index) => {
        const cell = list(row.cells).find(item => item.world_id === world.id);
        const savedPosition = authority.normalizedLayoutPoint(cell?.blocking_position || cell?.position_on_layout || cell?.position);
        if (!['confirmed', 'suggested'].includes(cell?.presence) || !savedPosition) return;
        const route = [cell?.entry_point, ...list(cell?.route_points), cell?.blocking_position, cell?.exit_point]
          .map(authority.normalizedLayoutPoint).filter(Boolean);
        if (route.length > 1) {
          context.beginPath();
          route.forEach((point, routeIndex) => {
            const projected = project({ x: (point.x - .5) * 12, y: .06, z: (point.y - .5) * 8 }, width, height);
            if (routeIndex) context.lineTo(projected.x, projected.y); else context.moveTo(projected.x, projected.y);
          });
          context.strokeStyle = row.kind === 'animal' ? '#f1b86a' : '#ffd166'; context.lineWidth = 2; context.setLineDash([7, 5]); context.stroke(); context.setLineDash([]);
        }
        const position = project({ x: (savedPosition.x - 0.5) * 12, y: 0.75, z: (savedPosition.y - 0.5) * 8 }, width, height);
        const gender = String(row.gender || list(bundle.assets?.people).find(person => String(person.subject_id || person.profile?.id || person.id) === String(row.character_id))?.profile?.gender || '').toLowerCase();
        const color = row.kind === 'animal' ? '#f1b86a' : (/female|woman|女/.test(gender) ? '#ff83b3' : (/male|man|男/.test(gender) ? '#44d7a8' : '#9aa9b6'));
        if (row.kind === 'animal') {
          context.fillStyle = color; context.font = '24px "Segoe UI Emoji", sans-serif'; context.fillText(/猫|cat/i.test(row.species) ? '🐱' : (/狗|犬|dog/i.test(row.species) ? '🐶' : (/鸟|bird/i.test(row.species) ? '🐦' : '🐾')), position.x, position.y + 6);
        } else {
          context.fillStyle = color; context.beginPath(); context.arc(position.x, position.y - 14, 7, 0, Math.PI * 2); context.fill();
          context.strokeStyle = color; context.lineWidth = 7; context.beginPath(); context.moveTo(position.x, position.y - 4); context.lineTo(position.x, position.y + 20); context.stroke();
          context.lineWidth = 4; context.beginPath(); context.moveTo(position.x, position.y + 2); context.lineTo(position.x - 9, position.y + 10); context.moveTo(position.x, position.y + 2); context.lineTo(position.x + 9, position.y + 10); context.stroke();
        }
        context.fillStyle = '#ffffff'; context.font = '600 12px Inter, "PingFang SC", "Microsoft YaHei", sans-serif'; context.textAlign = 'center'; context.fillText(row.name || `主体 ${index + 1}`, position.x, position.y + 40);
      });
    }
    if (state.mode === 'camera' || state.mode === 'model') {
      cameraRows.forEach(cameraNode => {
        if (!cameraNode.position) return;
        const marker = project({ x: (cameraNode.position.x - 0.5) * 12, y: 1.4, z: (cameraNode.position.y - 0.5) * 8 }, width, height);
        context.fillStyle = '#61e7c2'; context.fillRect(marker.x - 10, marker.y - 5, 18, 13);
        context.beginPath(); context.arc(marker.x - 5, marker.y - 9, 5, 0, Math.PI * 2); context.arc(marker.x + 5, marker.y - 9, 5, 0, Math.PI * 2); context.fill();
        context.beginPath(); context.moveTo(marker.x + 8, marker.y - 2); context.lineTo(marker.x + 17, marker.y - 7); context.lineTo(marker.x + 17, marker.y + 5); context.closePath(); context.fill();
        context.strokeStyle = '#61e7c2'; context.lineWidth = 2; context.beginPath(); context.moveTo(marker.x, marker.y + 8); context.lineTo(marker.x - 8, marker.y + 22); context.moveTo(marker.x, marker.y + 8); context.lineTo(marker.x + 8, marker.y + 22); context.stroke();
        if (cameraNode.lookAt) {
          const target = project({ x: (cameraNode.lookAt.x - .5) * 12, y: .05, z: (cameraNode.lookAt.y - .5) * 8 }, width, height);
          context.strokeStyle = '#61e7c2aa'; context.setLineDash([5, 4]); context.beginPath(); context.moveTo(marker.x, marker.y); context.lineTo(target.x, target.y); context.stroke(); context.setLineDash([]);
        }
      });
    }
    context.fillStyle = '#8aabb2'; context.font = '12px Inter, "PingFang SC", "Microsoft YaHei", sans-serif'; context.textAlign = 'left';
    context.fillText(textureReady ? '场景实图参考平面 · 可旋转机位规划' : '场景结构代理 · 可旋转机位规划', 18, 26);
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
  if (sceneTexture) {
    sceneTexture.addEventListener('load', () => { textureReady = true; draw(); }, { once: true });
    sceneTexture.addEventListener('error', () => { textureReady = false; draw(); }, { once: true });
    sceneTexture.src = window.VidoMediaDelivery?.previewUrl?.(textureNode.image_url, 1280, 'webp') || textureNode.image_url;
  }
  reset();
  return { reset, setMode, dispose() {
    resizeObserver.disconnect();
    bindings.forEach(dispose => dispose());
    host.replaceChildren();
  } };
}

function initSceneWorldViewer({ overlay, bundle, world, authority }) {
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
  const previewUrl = (url, width) => window.VidoMediaDelivery?.previewUrl?.(url, width, 'webp') || url;
  const thumbUrl = url => previewUrl(url, 320);
  const photoStrip = selected => `<div class="scene-world-photo-strip">${nodes.map((item, index) => `<button type="button" data-photo-node="${escapeHtml(item.id)}" class="${item.id === selected?.id ? 'active' : ''}" title="${escapeHtml(item.name || `视角 ${index + 1}`)}"><img src="${escapeHtml(thumbUrl(item.image_url))}" loading="lazy" decoding="async" alt=""><span>${escapeHtml(item.name || `视角 ${index + 1}`)}${item.is_panorama ? '<small>3DoF</small>' : ''}</span></button>`).join('')}</div>`;
  const bindPhotoStrip = mode => host.querySelectorAll('[data-photo-node]').forEach(button => button.addEventListener('click', () => {
    const selected = nodes.find(item => String(item.id) === String(button.dataset.photoNode));
    if (selected) showPhoto(selected, mode);
  }));
  const showPhoto = (node, mode = 'model') => {
    if (!node?.image_url) return showLayoutUnavailable(mode);
    if (node.is_panorama) return showPanorama(node);
    clearViewer();
    activateModeButton(mode);
    currentNode = node;
    host.innerHTML = `<div class="scene-world-photo-viewer"><div class="scene-world-photo-stage">
      <img alt="${escapeHtml(world.name)}真实场景视图" data-media-original="${escapeHtml(node.image_url)}">
      <div class="scene-world-photo-status"><b>${escapeHtml(node.name || '真实场景视图')}</b><small>${Math.max(1, nodes.indexOf(node) + 1)} / ${nodes.length} · 平面参考图</small></div>
      <div class="scene-world-photo-error" data-photo-error hidden>当前图片无法加载，请重试或检查场景资产。</div>
    </div>${photoStrip(node)}</div>`;
    const image = host.querySelector('.scene-world-photo-stage>img');
    const error = host.querySelector('[data-photo-error]');
    image.addEventListener('load', () => { image.hidden = false; error.hidden = true; }, { once: true });
    image.addEventListener('error', () => { image.hidden = true; error.hidden = false; }, { once: true });
    image.src = previewUrl(node.image_url, 960);
    window.VidoMediaDelivery?.processImage?.(image);
    bindPhotoStrip(mode);
    overlay.querySelectorAll('[data-focus-camera]').forEach(button => button.classList.toggle('active', String(button.dataset.focusCamera) === String(node.camera_id || '')));
    host.dataset.viewerEngine = mode === 'camera' ? 'scene-photo-camera' : 'real-photo';
    host.dataset.activePhotoNode = String(node.id || '');
    if (help) help.textContent = mode === 'camera'
      ? '机位实图在当前画布直接切换，不再打开第二个窗口；图片始终完整显示'
      : '场景实图完整显示 · 点击下方视角直接切换；不会另开大图窗口';
  };
  const showLayoutUnavailable = mode => {
    clearViewer();
    activateModeButton(mode);
    host.dataset.viewerEngine = 'layout-image-missing';
    host.innerHTML = '<div class="scene-world-mode-notice"><b>俯视布局图尚未进入当前场景</b><p>这里不会用抽象方块或推测坐标代替真实场景。已有场景图继续保留；补齐俯视布局图后，人物、机位和路线会叠加在同一张实图上。</p></div>';
    if (help) help.textContent = '缺少俯视布局实图；未显示任何伪造空间结构';
  };
  const showLayout = async (node, mode = 'structure') => {
    if (!node?.image_url) return showLayoutUnavailable(mode);
    clearViewer();
    const requestToken = activation;
    activateModeButton(mode);
    currentNode = node;
    const { mountSceneWorldLayoutViewer } = await import('./sceneWorldLayoutViewer.js?v=20260831-production-v346');
    if (requestToken !== activation) return;
    viewer = mountSceneWorldLayoutViewer({ host, bundle, world, authority, node, nodes, mode, previewUrl, photoStrip, onSelectPhoto: showPhoto });
    if (help) help.textContent = viewer.helpText;
  };
  const showPanorama = async node => {
    if (!node?.image_url) return;
    clearViewer();
    const requestToken = activation;
    activateModeButton('panorama');
    host.innerHTML = '<div class="scene-world-canvas-loading">正在按需加载3DoF球形全景查看器…</div>';
    if (help) help.textContent = '3DoF原地环视：可改变观看方向与FOV，不支持摄像机前后左右位移';
    try {
      const module = await import('./panoramaViewer.js?v=20260831-production-v346');
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
  const showNative = (mode, displayMode = mode) => {
    clearViewer();
    activateModeButton(displayMode);
    viewer = initNativeSceneWorldViewer({ overlay, bundle, world, authority });
    viewer.setMode(mode);
    if (help) help.textContent = displayMode === 'director'
      ? '场景实图参考平面 + 可旋转机位预演 · 拖动旋转，滚轮缩放；机位与站位为规划坐标，不冒充真实6DoF测量'
      : mode === 'blocking'
      ? '结构代理站位 · 仅用于编排方向，不代表6DoF深度、碰撞与真实遮挡'
      : (mode === 'camera' ? '机位结构代理 · 拖动旋转，滚轮缩放' : '场景结构 / 路线代理 · 仅在本模式下初始化Canvas');
  };
  const showSpatialNotice = () => {
    clearViewer();
    activateModeButton('spatial');
    host.dataset.viewerEngine = 'spatial-6dof-handoff';
    host.innerHTML = '<div class="scene-world-mode-notice"><b>6DoF可移动空间</b><p>前后左右移动、人物路径和遮挡需使用深度 / 几何空间资产，不会用平面全景或抽象方块冒充当前场景。</p><button class="btn" type="button" data-spatial-structure-reference>在当前窗口查看场景结构参考</button></div>';
    host.querySelector('[data-spatial-structure-reference]')?.addEventListener('click', () => showMode('structure'));
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
    if (mode === 'director') return showNative('model', 'director');
    if (mode === 'spatial') return showSpatialNotice();
    if (mode === 'structure') return showLayout(layoutNode, 'structure');
    if (mode === 'blocking') return showLayout(layoutNode, 'blocking');
    if (mode === 'camera') return currentNode && !currentNode.is_panorama ? showPhoto(currentNode, 'camera') : (primaryNode ? showPhoto(primaryNode, 'camera') : showNative('camera'));
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
    if (node) showPhoto(node, 'camera');
  }));
  overlay.querySelectorAll('[data-world-mode]').forEach(button => button.addEventListener('click', () => showMode(button.dataset.worldMode)));
  overlay.querySelector('[data-reset-world-view]')?.addEventListener('click', () => viewer?.reset?.());
  showNative('model', 'director');

  return () => {
    clearViewer();
  };
}

async function openSceneWorldStudio(bundle, world, store = null) {
  const authority = await import('./sceneWorldAuthorityPlan.js?v=20260831-production-v346');
  const realPhotoNodes = photoNodes(world);
  const hasRealPhotos = realPhotoNodes.length > 0;
  const worlds = list(bundle.scene_worlds);
  const worldIndex = Math.max(0, worlds.findIndex(item => String(item.id) === String(world.id)));
  const panoramaReady = realPhotoNodes.some(node => node.is_panorama);
  const overlay = document.createElement('div');
  overlay.className = 'scene-world-studio';
  overlay.innerHTML = `<section>
    <header><div><small>场景 ${worldIndex + 1}/${worlds.length} · ${escapeHtml(world.capabilities?.world_mode || 'scene_world')} · 版本 ${world.revision || 1}</small><h2>${escapeHtml(world.name)}</h2><p>${escapeHtml(world.story_purpose || world.description || '场景世界交互预演')}</p></div><label class="scene-world-switcher"><span>切换场景</span><select data-scene-world-switch>${worlds.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(world.id) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><button class="btn" type="button" data-open-full-director>打开完整3D导演台</button><button type="button" data-close-scene-world aria-label="关闭">×</button></header>
    <nav class="scene-world-view-modes">
      <button type="button" data-world-mode="model">${hasRealPhotos ? '真实图片' : '场景结构'}</button>
      <button class="active" type="button" data-world-mode="director">3D机位预演（可旋转）</button>
      <button type="button" data-world-mode="panorama" ${panoramaReady ? '' : 'disabled title="需先生成并验收2:1等距柱状全景"'}>360原地环视（3DoF）</button>
      ${panoramaReady ? '' : `<button type="button" class="scene-world-generate-panorama" data-generate-panorama="${escapeHtml(world.id)}">生成360全景</button>`}
      <button type="button" data-world-mode="spatial" ${world.capabilities?.supports_spatial_model ? '' : 'disabled title="当前没有深度、几何或空间模型"'}>可移动空间（6DoF）</button>
      <button type="button" data-world-mode="structure">空间布局（场景实图）</button>
      <button type="button" data-world-mode="blocking">人物站位（场景实图）</button>
      <button type="button" data-world-mode="camera">机位切换（当前窗口）</button>
    </nav>
    <div class="scene-world-studio-layout">
      <aside><h3>真实图片视角</h3><div class="scene-world-observation-list">${realPhotoNodes.length ? realPhotoNodes.map((node, index) => `<button type="button" data-focus-observation="${escapeHtml(node.id)}"><b>${escapeHtml(node.name || `视角 ${index + 1}`)}</b><small>${escapeHtml(node.view_key === 'layout' ? '俯视布局与路线参考' : node.is_panorama ? '可360度环视的全景观察点' : '现有真实场景图片')}</small></button>`).join('') : '<small>当前场景还没有真实图片。</small>'}</div><h3>空间区域</h3><div class="scene-world-zone-list">${list(world.zones).map(zone => `<button type="button" data-focus-zone="${escapeHtml(zone.id)}"><b>${escapeHtml(zone.name)}</b><small>${escapeHtml(zone.purpose || '场景区域')}</small></button>`).join('')}</div><h3>场景入口</h3><div class="scene-world-portal-list">${list(world.portals).length ? list(world.portals).map(portal => `<button type="button" data-open-world="${escapeHtml(portal.to_world_id)}"><b>${escapeHtml(portal.label)}</b><small>${escapeHtml(portal.reason || '按剧情切换至下一场景')}</small></button>`).join('') : '<small>当前没有跨场景入口</small>'}</div></aside>
      <main><div class="scene-world-canvas" data-scene-world-canvas><div class="scene-world-canvas-loading">${hasRealPhotos ? '正在载入现有场景图片…' : '结构代理将在选择后按需建立…'}</div></div><div class="scene-world-canvas-help" data-scene-world-help>${hasRealPhotos ? '点击左侧观察点或右侧机位切换参考图' : '选择结构 / 路线后才初始化可旋转代理'}</div></main>
      <aside class="scene-world-inspector">${authority.sceneAuthorityPlan(bundle, world)}<details><summary>当前空间能力</summary><div class="scene-world-capabilities">${capabilityChips(world)}</div></details><button class="btn" type="button" data-reset-world-view>重置视角</button></aside>
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
  overlay.querySelector('[data-open-full-director]')?.addEventListener('click', async () => {
    close();
    const { openDirectorStudio } = await import('./directorStudioView.js?v=20260831-production-v346');
    await openDirectorStudio({ taskId: bundle.project.id, world });
  });
  overlay.querySelector('[data-scene-world-switch]')?.addEventListener('change', event => {
    const next = worldById(bundle, event.currentTarget.value);
    if (!next || String(next.id) === String(world.id)) return;
    close();
    openSceneWorldStudio(bundle, next, store);
  });
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });

  disposeViewer = initSceneWorldViewer({ overlay, bundle, world, authority });
  overlay.querySelectorAll('[data-open-world]').forEach(button => button.addEventListener('click', () => {
    const next = worldById(bundle, button.dataset.openWorld);
    if (!next) return toast('目标场景尚未建立', 'warning');
    close();
    openSceneWorldStudio(bundle, next, store);
  }));
  overlay.querySelectorAll('[data-generate-panorama]').forEach(button => button.addEventListener('click', () => runPanoramaGeneration({ root: overlay, bundle, store, worldId: world.id })));
}

export function bindSceneWorldWorkspace(host, bundle = {}, store = null) {
  host.querySelectorAll('[data-enter-scene-world]').forEach(button => button.addEventListener('click', () => {
    const world = worldById(bundle, button.dataset.enterSceneWorld);
    if (world) openSceneWorldStudio(bundle, world, store);
  }));
  host.querySelectorAll('[data-generate-panorama]').forEach(button => button.addEventListener('click', () => runPanoramaGeneration({ root: host, bundle, store, worldId: button.dataset.generatePanorama })));
  const root = host.querySelector('[data-scene-world-workspace]');
  if (!root) return;
  const activate = name => {
    root.querySelectorAll('[data-scene-world-tab]').forEach(button => button.classList.toggle('active', button.dataset.sceneWorldTab === name));
    root.querySelectorAll('[data-scene-world-pane]').forEach(pane => { pane.hidden = pane.dataset.sceneWorldPane !== name; });
  };
  root.querySelectorAll('[data-scene-world-tab]').forEach(button => button.addEventListener('click', () => activate(button.dataset.sceneWorldTab)));
  root.querySelectorAll('[data-scene-world-tab-target]').forEach(button => button.addEventListener('click', () => activate(button.dataset.sceneWorldTabTarget)));
  root.querySelectorAll('[data-plan-scene-experience]').forEach(button => button.addEventListener('click', async () => {
    const world = worldById(bundle, button.dataset.planSceneExperience);
    if (!world) return;
    const { openSceneExperiencePlanner } = await import('./sceneWorldExperiencePlanner.js?v=20260831-production-v346');
    openSceneExperiencePlanner({ bundle, world, onOpenDirector: () => openSceneWorldStudio(bundle, world, store) });
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
