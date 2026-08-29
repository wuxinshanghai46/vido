import { escapeHtml } from '../components/ui.js?v=20260829-production-v276';

export function mountSceneWorldLayoutViewer({ host, bundle, world, authority, node, nodes, mode, previewUrl, photoStrip, onSelectPhoto }) {
  const people = authority.scenePeopleRows(bundle, world);
  const cameras = authority.sceneCameraRows(bundle, world);
  const positionedPeople = people.filter(person => person.position);
  const positionedCameras = cameras.filter(camera => camera.position);
  const routeMarkup = positionedPeople.map(person => {
    const points = [person.entryPoint, ...person.routePoints, person.position, person.exitPoint].filter(Boolean);
    return points.length > 1 ? `<polyline class="scene-layout-route" points="${points.map(point => `${point.x * 100},${point.y * 100}`).join(' ')}"></polyline>` : '';
  }).join('');
  const cameraMarkup = positionedCameras.map((camera, index) => `${camera.lookAt ? `<line class="scene-layout-camera-ray" x1="${camera.position.x * 100}" y1="${camera.position.y * 100}" x2="${camera.lookAt.x * 100}" y2="${camera.lookAt.y * 100}"></line>` : ''}<g class="scene-layout-camera-marker" transform="translate(${camera.position.x * 100} ${camera.position.y * 100})"><circle r="3.1"></circle><text y="-5">C${index + 1}</text></g>`).join('');
  const personMarkup = positionedPeople.map(person => `<g class="scene-layout-person-marker" transform="translate(${person.position.x * 100} ${person.position.y * 100})"><circle r="3.2"></circle><text y="-5">${escapeHtml(person.name)}</text></g>`).join('');
  const pending = [
    people.length && positionedPeople.length < people.length ? `${people.length - positionedPeople.length} 个人物站位/路线待规划` : '',
    cameras.length && positionedCameras.length < cameras.length ? `${cameras.length - positionedCameras.length} 个机位坐标待规划` : '',
  ].filter(Boolean);
  host.innerHTML = `<div class="scene-world-photo-viewer"><div class="scene-world-photo-stage scene-world-layout-stage">
    <img alt="${escapeHtml(world.name)}俯视布局实图" data-media-original="${escapeHtml(node.image_url)}">
    <svg class="scene-world-layout-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="人物、机位与路线叠加层">${routeMarkup}${cameraMarkup}${personMarkup}</svg>
    <div class="scene-world-photo-status"><b>${escapeHtml(node.name || '俯视布局')}</b><small>真实布局图 · 人物 ${positionedPeople.length}/${people.length} · 机位 ${positionedCameras.length}/${cameras.length}</small></div>
    ${pending.length ? `<div class="scene-world-layout-pending">${escapeHtml(pending.join('；'))}（不显示伪造点）</div>` : ''}
    <div class="scene-world-photo-error" data-photo-error hidden>当前布局图无法加载，请重试或检查场景资产。</div>
  </div>${photoStrip(node)}</div>`;
  const image = host.querySelector('.scene-world-photo-stage>img');
  const stage = host.querySelector('.scene-world-layout-stage');
  const overlayLayer = host.querySelector('.scene-world-layout-overlay');
  const error = host.querySelector('[data-photo-error]');
  const syncOverlay = () => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const stageRatio = stage.clientWidth / Math.max(1, stage.clientHeight);
    const imageRatio = image.naturalWidth / image.naturalHeight;
    const width = imageRatio > stageRatio ? stage.clientWidth : stage.clientHeight * imageRatio;
    const height = imageRatio > stageRatio ? stage.clientWidth / imageRatio : stage.clientHeight;
    Object.assign(overlayLayer.style, { width: `${width}px`, height: `${height}px`, left: `${(stage.clientWidth - width) / 2}px`, top: `${(stage.clientHeight - height) / 2}px` });
  };
  const resizeObserver = new ResizeObserver(syncOverlay);
  resizeObserver.observe(stage);
  image.addEventListener('load', () => { image.hidden = false; error.hidden = true; syncOverlay(); }, { once: true });
  image.addEventListener('error', () => { image.hidden = true; overlayLayer.hidden = true; error.hidden = false; }, { once: true });
  image.src = previewUrl(node.image_url, 1200);
  window.VidoMediaDelivery?.processImage?.(image);
  host.querySelectorAll('[data-photo-node]').forEach(button => button.addEventListener('click', () => onSelectPhoto(nodes.find(item => String(item.id) === String(button.dataset.photoNode)), mode)));
  host.dataset.viewerEngine = 'real-layout-overlay';
  host.dataset.activePhotoNode = String(node.id || '');
  return {
    helpText: pending.length ? `布局实图已显示；${pending.join('；')}` : '布局实图、人物站位、行动路线与机位坐标已统一显示',
    dispose: () => resizeObserver.disconnect(),
  };
}
