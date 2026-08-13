import * as THREE from '../vendor/three.module.min.js?v=20260813-ui-v248';
import { request, uploadAsset } from '../api.js?v=20260813-ui-v248';
import { escapeHtml, toast } from '../components/ui.js?v=20260813-ui-v248';

const VERSION = '20260803-photoreal-director-v8';

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function addStyle() {
  if (document.querySelector('[data-director-studio-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = `/story-ad/director-studio.css?v=${VERSION}`; link.dataset.directorStudioStyle = 'true';
  document.head.appendChild(link);
}
function copyState(value) { return JSON.parse(JSON.stringify(value)); }
function entityColor(kind = '') {
  return ({ person: 0x5de0bd, product: 0xf6b94a, animal: 0xb69cff, vehicle: 0x52a8ff, object: 0x9eaec0 }[kind] || 0x9eaec0);
}
function field(label, name, value, options = {}) {
  const step = options.step || '0.1';
  return `<label><span>${escapeHtml(label)}</span><input type="number" name="${name}" value="${number(value)}" step="${step}" min="${options.min ?? -100}" max="${options.max ?? 100}"></label>`;
}
function inspectorHtml(selection) {
  if (!selection) return '<div class="director-empty"><b>选择空间对象</b><p>点击左侧列表或画布中的人物、商品、道具和机位进行编辑。</p></div>';
  const row = selection.row;
  if (selection.type === 'camera') return `<div class="director-inspector-form" data-director-inspector="camera">
    <h3>${escapeHtml(row.label || row.camera_id)}</h3>
    <input type="hidden" name="target_id" value="${escapeHtml(row.camera_id)}">
    <div class="director-field-grid">${field('位置 X', 'px', row.position?.[0])}${field('位置 Y', 'py', row.position?.[1])}${field('位置 Z', 'pz', row.position?.[2])}${field('目标 X', 'tx', row.look_at?.[0])}${field('目标 Y', 'ty', row.look_at?.[1])}${field('目标 Z', 'tz', row.look_at?.[2])}${field('焦距 mm', 'focal', row.focal_length, { min: 8, max: 300, step: 1 })}${field('FOV', 'fov', row.fov, { min: 10, max: 120, step: 1 })}</div>
    <button class="btn" type="button" data-preview-director-camera>切换到该机位</button><button class="btn" type="button" data-add-path-point>记录相机轨迹点</button>
  </div>`;
  return `<div class="director-inspector-form" data-director-inspector="entity">
    <h3>${escapeHtml(row.label || row.entity_id)}</h3><small>${escapeHtml(row.kind || 'object')} · 引用版本 ${row.entity_revision || 1}</small>
    <input type="hidden" name="target_id" value="${escapeHtml(row.entity_id)}">
    <div class="director-field-grid">${field('位置 X', 'px', row.position?.[0])}${field('位置 Y', 'py', row.position?.[1])}${field('位置 Z', 'pz', row.position?.[2])}${field('旋转 Y', 'ry', row.rotation?.[1], { min: -360, max: 360, step: 1 })}${field('缩放', 'scale', row.scale?.[0], { min: .05, max: 20 })}</div>
    <label><span>姿态</span><select name="pose"><option value="neutral_stand">自然站立</option><option value="natural_walk">自然行走</option><option value="sit_or_rise">坐下 / 起身</option><option value="reach_and_hold">伸手与持握</option><option value="present_product">展示商品</option><option value="custom">自定义动作</option></select></label>
    <button class="btn" type="button" data-add-path-point>记录实体轨迹点</button>
  </div>`;
}

export async function openDirectorStudio({ taskId, world }) {
  addStyle();
  const response = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/scene-worlds/${encodeURIComponent(world.id)}/director`);
  const state = copyState(response.director_scene || {});
  const overlay = document.createElement('div');
  overlay.className = 'director-studio';
  overlay.innerHTML = `<section><header><div><small>DirectorScene · 通用空间导演台 · 版本 <span data-director-revision>${state.revision || 1}</span></small><h2>${escapeHtml(world.name)}</h2><p>人物、商品和机位只引用当前权威资产版本；拖动画布对象不会修改人物或场景正文，也不会调用生成模型。</p></div><div><button class="btn" type="button" data-export-director>导出当前机位截图</button><button class="btn primary" type="button" data-save-director>保存导演状态</button><button type="button" data-close-director aria-label="关闭">×</button></div></header>
    <div class="director-layout"><aside><h3>空间对象</h3><div class="director-object-list">${list(state.entities).map(item => `<button type="button" data-director-entity="${escapeHtml(item.entity_id)}"><i style="--entity-color:#${entityColor(item.kind).toString(16).padStart(6, '0')}"></i><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.kind)} · r${item.entity_revision || 1}</small></span></button>`).join('') || '<small>当前场景没有可编辑实体</small>'}</div><h3>机位</h3><div class="director-camera-list">${list(state.cameras).map(item => `<button type="button" data-director-camera="${escapeHtml(item.camera_id)}"><span><b>${escapeHtml(item.label)}</b><small>${Math.round(item.focal_length || 35)}mm · FOV ${Math.round(item.fov || 52)}°</small></span></button>`).join('')}</div><h3>轨迹</h3><div data-director-path-summary>${list(state.paths).length} 条轨迹</div></aside>
    <main><div class="director-viewport" data-director-viewport></div><div class="director-help">左键选择并拖动实体 · 右键旋转观察 · 滚轮缩放 · 机位和轨迹均会进入逐镜参考包</div></main>
    <aside class="director-inspector" data-director-inspector-host>${inspectorHtml(null)}</aside></div>
    <footer><span data-director-status>${state.compatibility_status === 'stale_source' ? '上游场景已更新，保存后将重建当前导演版本' : '当前导演状态与场景版本一致'}</span><span>${list(state.snapshots).length} 张导演截图 · ${list(state.paths).reduce((sum, path) => sum + list(path.points).length, 0)} 个轨迹点</span></footer></section>`;
  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  const host = overlay.querySelector('[data-director-viewport]');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071116);
  const viewCamera = new THREE.PerspectiveCamera(48, 1, .1, 500);
  viewCamera.position.set(7.5, 6.2, 8.5); viewCamera.lookAt(0, 0.8, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xe8f5ff, 0x25333b, 2.3));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.5); keyLight.position.set(4, 8, 5); keyLight.castShadow = true; scene.add(keyLight);
  scene.add(new THREE.GridHelper(24, 24, 0x3e6570, 0x18313a));

  list(world.zones).forEach(zone => {
    const bounds = zone.bounds || {};
    const geometry = new THREE.BoxGeometry(number(bounds.width, 2.8), .04, number(bounds.depth, 2.25));
    const material = new THREE.MeshStandardMaterial({ color: 0x174b46, transparent: true, opacity: .28 });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(number(bounds.x), .01, number(bounds.z)); scene.add(mesh);
  });
  if (world.source_asset?.layout_image_url) {
    new THREE.TextureLoader().load(world.source_asset.layout_image_url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: .28, depthWrite: false }));
      plane.rotation.x = -Math.PI / 2; plane.position.y = .025; scene.add(plane);
    }, undefined, () => {});
  }

  const entityMeshes = new Map();
  const cameraMeshes = new Map();
  const pathObjects = [];
  let selected = null;
  let orbit = { yaw: .72, pitch: .58, distance: 12, target: new THREE.Vector3(0, .8, 0) };
  let pointer = null;
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  const entityGeometry = item => item.kind === 'person'
    ? new THREE.CapsuleGeometry(.32, 1.15, 6, 12)
    : (item.kind === 'product' ? new THREE.BoxGeometry(.8, .8, .8) : new THREE.SphereGeometry(.5, 18, 12));
  const syncEntityMesh = (item, mesh) => {
    mesh.position.fromArray(item.position || [0, 0, 0]);
    if (item.kind === 'person') mesh.position.y = Math.max(.9, mesh.position.y || 0) + .05;
    mesh.rotation.set(...(item.rotation || [0, 0, 0]).map(value => THREE.MathUtils.degToRad(value)));
    mesh.scale.fromArray(item.scale || [1, 1, 1]); mesh.visible = item.visible !== false;
  };
  list(state.entities).forEach(item => {
    const mesh = new THREE.Mesh(entityGeometry(item), new THREE.MeshStandardMaterial({ color: entityColor(item.kind), roughness: .58, metalness: item.kind === 'product' ? .18 : 0 }));
    mesh.castShadow = true; mesh.userData = { type: 'entity', id: item.entity_id }; syncEntityMesh(item, mesh); scene.add(mesh); entityMeshes.set(item.entity_id, mesh);
  });
  list(state.cameras).forEach(item => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(.48, .32, .62), new THREE.MeshStandardMaterial({ color: 0x52a8ff }));
    const lens = new THREE.Mesh(new THREE.ConeGeometry(.18, .5, 12), new THREE.MeshStandardMaterial({ color: 0x91caff }));
    lens.rotation.x = -Math.PI / 2; lens.position.z = -.48; group.add(body, lens); group.position.fromArray(item.position); group.userData = { type: 'camera', id: item.camera_id };
    group.traverse(child => { child.userData = group.userData; }); scene.add(group); cameraMeshes.set(item.camera_id, group);
  });

  const rebuildPaths = () => {
    pathObjects.splice(0).forEach(object => { scene.remove(object); object.geometry?.dispose?.(); object.material?.dispose?.(); });
    list(state.paths).forEach(path => {
      const points = list(path.points).map(point => new THREE.Vector3(...point.position));
      if (points.length < 2) return;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: path.kind === 'camera' ? 0x52a8ff : 0xb69cff }));
      scene.add(line); pathObjects.push(line);
    });
    overlay.querySelector('[data-director-path-summary]').textContent = `${list(state.paths).length} 条轨迹 · ${list(state.paths).reduce((sum, path) => sum + list(path.points).length, 0)} 个点`;
  };
  rebuildPaths();

  const updateOrbitCamera = () => {
    const cp = Math.cos(orbit.pitch);
    viewCamera.position.set(orbit.target.x + Math.cos(orbit.yaw) * cp * orbit.distance, orbit.target.y + Math.sin(orbit.pitch) * orbit.distance, orbit.target.z + Math.sin(orbit.yaw) * cp * orbit.distance);
    viewCamera.lookAt(orbit.target);
  };
  const applyDirectorCamera = row => {
    viewCamera.position.fromArray(row.position); viewCamera.fov = row.fov || 52; viewCamera.updateProjectionMatrix(); viewCamera.lookAt(new THREE.Vector3(...row.look_at));
  };
  updateOrbitCamera();
  const resize = () => {
    const width = Math.max(320, host.clientWidth); const height = Math.max(320, host.clientHeight);
    renderer.setSize(width, height, false); viewCamera.aspect = width / height; viewCamera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  let animationFrame = 0;
  const render = () => { animationFrame = requestAnimationFrame(render); renderer.render(scene, viewCamera); };
  render();

  const inspectorHost = overlay.querySelector('[data-director-inspector-host]');
  const renderInspector = () => {
    inspectorHost.innerHTML = inspectorHtml(selected);
    if (selected?.type === 'entity') inspectorHost.querySelector('[name="pose"]').value = selected.row.pose_id || 'neutral_stand';
    inspectorHost.querySelectorAll('input,select').forEach(input => input.addEventListener('input', () => {
      if (!selected) return;
      const form = inspectorHost.querySelector('[data-director-inspector]');
      const values = Object.fromEntries([...form.querySelectorAll('input,select')].map(field => [field.name, field.value]));
      if (selected.type === 'entity') {
        selected.row.position = [number(values.px), number(values.py), number(values.pz)]; selected.row.rotation[1] = number(values.ry);
        const scale = Math.max(.05, number(values.scale, 1)); selected.row.scale = [scale, scale, scale]; selected.row.pose_id = values.pose || '';
        syncEntityMesh(selected.row, entityMeshes.get(selected.row.entity_id));
      } else {
        selected.row.position = [number(values.px), number(values.py), number(values.pz)]; selected.row.look_at = [number(values.tx), number(values.ty), number(values.tz)];
        selected.row.focal_length = Math.max(8, number(values.focal, 35)); selected.row.fov = Math.max(10, Math.min(120, number(values.fov, 52)));
        cameraMeshes.get(selected.row.camera_id)?.position.fromArray(selected.row.position);
      }
    }));
    inspectorHost.querySelector('[data-preview-director-camera]')?.addEventListener('click', () => applyDirectorCamera(selected.row));
    inspectorHost.querySelector('[data-add-path-point]')?.addEventListener('click', () => {
      const id = selected.type === 'camera' ? selected.row.camera_id : selected.row.entity_id;
      const kind = selected.type === 'camera' ? 'camera' : (selected.row.kind === 'vehicle' ? 'vehicle' : 'actor');
      let path = list(state.paths).find(item => item.entity_id === id && item.kind === kind);
      if (!path) { path = { path_id: `path:${id}`, kind, entity_id: id, duration_sec: 3, easing: 'ease_in_out', points: [] }; state.paths.push(path); }
      path.points.push({ position: [...selected.row.position], time_sec: Number((path.points.length * Math.max(.5, path.duration_sec / 3)).toFixed(2)) });
      rebuildPaths(); toast('已记录轨迹点，移动对象后可继续添加。', 'success');
    });
  };
  const select = (type, id) => {
    selected = type === 'entity'
      ? { type, row: state.entities.find(item => item.entity_id === id) }
      : { type, row: state.cameras.find(item => item.camera_id === id) };
    overlay.querySelectorAll('[data-director-entity],[data-director-camera]').forEach(button => button.classList.toggle('active', button.dataset.directorEntity === id || button.dataset.directorCamera === id));
    renderInspector();
  };
  overlay.querySelectorAll('[data-director-entity]').forEach(button => button.addEventListener('click', () => select('entity', button.dataset.directorEntity)));
  overlay.querySelectorAll('[data-director-camera]').forEach(button => button.addEventListener('click', () => select('camera', button.dataset.directorCamera)));

  const normalizedPointer = event => {
    const rect = renderer.domElement.getBoundingClientRect(); mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };
  renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
  renderer.domElement.addEventListener('pointerdown', event => {
    normalizedPointer(event); raycaster.setFromCamera(mouse, viewCamera);
    const hit = raycaster.intersectObjects([...entityMeshes.values(), ...cameraMeshes.values()], true)[0];
    if (hit?.object?.userData?.id) select(hit.object.userData.type, hit.object.userData.id);
    pointer = { button: event.button, x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch, dragging: Boolean(hit && event.button === 0) };
    renderer.domElement.setPointerCapture?.(event.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (!pointer) return;
    if (pointer.dragging && selected?.type === 'entity') {
      normalizedPointer(event); raycaster.setFromCamera(mouse, viewCamera); const target = new THREE.Vector3(); raycaster.ray.intersectPlane(ground, target);
      if (target) { selected.row.position[0] = Number(target.x.toFixed(3)); selected.row.position[2] = Number(target.z.toFixed(3)); syncEntityMesh(selected.row, entityMeshes.get(selected.row.entity_id)); renderInspector(); }
    } else if (pointer.button === 2 || event.buttons === 2) {
      orbit.yaw = pointer.yaw - (event.clientX - pointer.x) * .008; orbit.pitch = Math.max(.12, Math.min(1.35, pointer.pitch + (event.clientY - pointer.y) * .006)); updateOrbitCamera();
    }
  });
  renderer.domElement.addEventListener('pointerup', () => { pointer = null; });
  renderer.domElement.addEventListener('wheel', event => { event.preventDefault(); orbit.distance = Math.max(3, Math.min(40, orbit.distance * (event.deltaY > 0 ? 1.1 : .9))); updateOrbitCamera(); }, { passive: false });

  const save = async () => {
    const button = overlay.querySelector('[data-save-director]'); button.disabled = true;
    try {
      const saved = await request(`/api/story-ad/projects/${encodeURIComponent(taskId)}/scene-worlds/${encodeURIComponent(world.id)}/director`, { method: 'PUT', body: { expected_revision: state.revision, entities: state.entities, cameras: state.cameras, paths: state.paths, snapshots: state.snapshots } });
      Object.assign(state, copyState(saved.director_scene)); overlay.querySelector('[data-director-revision]').textContent = state.revision; overlay.querySelector('[data-director-status]').textContent = '导演状态已保存并绑定当前场景版本'; toast('导演状态已保存。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { button.disabled = false; }
  };
  overlay.querySelector('[data-save-director]').addEventListener('click', save);
  overlay.querySelector('[data-export-director]').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try {
      renderer.render(scene, viewCamera);
      const blob = await new Promise(resolve => renderer.domElement.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('导演截图导出失败');
      const file = new File([blob], `director_${world.id}_${Date.now()}.png`, { type: 'image/png' });
      const uploaded = await uploadAsset(file, 'director_snapshot');
      const bytes = await blob.arrayBuffer(); const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
      const cameraId = selected?.type === 'camera' ? selected.row.camera_id : state.cameras[0]?.camera_id || '';
      state.snapshots.push({ snapshot_id: `snapshot:${Date.now()}`, camera_id: cameraId, label: `导演截图 ${state.snapshots.length + 1}`, image_url: uploaded.image_url || uploaded.url || uploaded.asset?.image_url, sha256, created_at: new Date().toISOString() });
      await save(); toast('当前机位截图已导出并进入逐镜参考资产。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { button.disabled = false; }
  });

  const close = () => {
    cancelAnimationFrame(animationFrame); observer.disconnect(); renderer.dispose(); scene.traverse(object => { object.geometry?.dispose?.(); object.material?.dispose?.(); }); overlay.remove(); document.body.classList.remove('modal-open');
  };
  overlay.querySelector('[data-close-director]').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
}
