import { escapeHtml } from '../components/ui.js?v=20260826-production-v230g';

export function uniqueLightboxEntries(nodes = [], group = 'media') {
  return [...nodes].filter(node => (node.dataset?.mediaZoomGroup || 'media') === group)
    .map(node => ({ url: node.dataset?.mediaZoomUrl || '', previewUrl: node.dataset?.mediaPreviewUrl || node.dataset?.mediaZoomUrl || '', label: node.dataset?.mediaZoomLabel || '图片' }))
    .filter((item, index, rows) => item.url && rows.findIndex(candidate => candidate.url === item.url) === index);
}
export function nextLightboxIndex(index = 0, direction = 1, total = 0) {
  const count = Math.max(0, Number(total) || 0);
  return count ? (Number(index || 0) + Number(direction || 0) + count) % count : 0;
}
export function preloadLightboxUrl(url = '', createImage = () => new Image()) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('图片地址为空'));
    const candidate = createImage(); candidate.onload = () => resolve(url); candidate.onerror = () => reject(new Error('图片加载失败')); candidate.src = url;
  });
}
export function lightboxPanDelta(delta = 0, scale = 1) { return (Number(delta) || 0) * Math.min(3, 1 + (Math.max(1, Number(scale) || 1) - 1) * .35); }

export function bindMediaLightbox(scope = document) {
  if (!scope || scope.dataset?.mediaLightboxBound === 'true') return;
  if (scope.dataset) scope.dataset.mediaLightboxBound = 'true';
  scope.addEventListener('click', event => {
    const trigger = event.target.closest?.('[data-media-zoom-url]');
    if (!trigger || !scope.contains(trigger)) return;
    event.preventDefault(); event.stopPropagation();
    const entries = uniqueLightboxEntries(scope.querySelectorAll('[data-media-zoom-url]'), trigger.dataset.mediaZoomGroup || 'media');
    let index = Math.max(0, entries.findIndex(item => item.url === (trigger.dataset.mediaZoomUrl || '')));
    if (!entries.length) return;
    document.querySelector('[data-media-lightbox]')?.remove();
    const overlay = document.createElement('div'); overlay.className = 'media-lightbox'; overlay.dataset.mediaLightbox = 'true';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<button class="media-lightbox-close" type="button" aria-label="关闭大图">×</button><button class="media-lightbox-nav is-prev" type="button" aria-label="上一张">‹</button><figure><img data-media-lock="true" draggable="false" alt=""><figcaption><span></span><b></b><div class="media-lightbox-tools" aria-label="图片缩放工具"><button type="button" data-media-zoom-out aria-label="缩小">−</button><output data-media-zoom-level>100%</output><button type="button" data-media-zoom-in aria-label="放大">＋</button><button type="button" data-media-zoom-reset>适应屏幕</button><small data-media-pixel-size></small></div></figcaption><div class="media-lightbox-strip" role="list" aria-label="同组图片"></div></figure><button class="media-lightbox-nav is-next" type="button" aria-label="下一张">›</button>`;
    const image = overlay.querySelector('img'), caption = overlay.querySelector('figcaption span'), counter = overlay.querySelector('figcaption b');
    const strip = overlay.querySelector('.media-lightbox-strip'), zoomLevel = overlay.querySelector('[data-media-zoom-level]'), pixelSize = overlay.querySelector('[data-media-pixel-size]');
    let scale = 1, translateX = 0, translateY = 0, drag = null, renderToken = 0;
    const apply = () => { image.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`; image.classList.toggle('is-zoomed', scale > 1.001); zoomLevel.textContent = `${Math.round(scale * 100)}%`; };
    const reset = () => { scale = 1; translateX = 0; translateY = 0; apply(); };
    const setScale = (next, x = 0, y = 0) => {
      const prior = scale; scale = Math.max(1, Math.min(8, Number(next) || 1));
      if (prior !== scale && x && y) { const rect = image.getBoundingClientRect(); translateX -= (x - rect.left - rect.width / 2) * (scale / prior - 1); translateY -= (y - rect.top - rect.height / 2) * (scale / prior - 1); }
      if (scale === 1) { translateX = 0; translateY = 0; } apply();
    };
    strip.innerHTML = entries.map((entry, i) => `<button type="button" role="listitem" data-lightbox-index="${i}" aria-label="查看${escapeHtml(entry.label)}"><img src="${escapeHtml(entry.previewUrl)}" alt=""></button>`).join('');
    const prefetch = entry => { if (entry?.url && entry.url !== entry.previewUrl) { const preload = new Image(); preload.src = entry.url; } };
    const render = () => {
      const current = entries[index], requestedIndex = index, token = ++renderToken, previewUrl = current.previewUrl || current.url; reset(); pixelSize.textContent = '';
      strip.querySelectorAll('[data-lightbox-index]').forEach(button => button.classList.toggle('active', Number(button.dataset.lightboxIndex) === requestedIndex));
      overlay.querySelectorAll('.media-lightbox-nav').forEach(button => { button.hidden = entries.length < 2; });
      overlay.classList.add('is-loading', 'is-switching'); overlay.setAttribute('aria-busy', 'true'); overlay.dataset.pendingMediaUrl = previewUrl;
      void (async () => {
        let displayedUrl = '';
        try { displayedUrl = await preloadLightboxUrl(previewUrl); } catch { if (!current.url || current.url === previewUrl) throw new Error('图片加载失败'); displayedUrl = await preloadLightboxUrl(current.url); }
        if (token !== renderToken) return;
        image.onload = () => { pixelSize.textContent = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight}px` : ''; };
        image.removeAttribute('src'); image.alt = current.label; image.src = displayedUrl; if (image.complete) image.onload();
        caption.textContent = current.label; counter.textContent = `${requestedIndex + 1} / ${entries.length}`; overlay.dataset.currentMediaUrl = displayedUrl; delete overlay.dataset.pendingMediaUrl; overlay.classList.remove('is-switching');
        if (current.url && current.url !== displayedUrl) {
          overlay.dataset.pendingMediaUrl = current.url;
          try { const originalUrl = await preloadLightboxUrl(current.url); if (token !== renderToken) return; image.removeAttribute('src'); image.src = originalUrl; if (image.complete) image.onload(); overlay.dataset.currentMediaUrl = originalUrl; }
          catch { if (token === renderToken) caption.textContent = `${current.label}（正在显示清晰预览，原图暂未加载）`; }
        }
        if (token !== renderToken) return; delete overlay.dataset.pendingMediaUrl; overlay.classList.remove('is-loading', 'is-switching'); overlay.removeAttribute('aria-busy');
        if (entries.length > 1) { prefetch(entries[nextLightboxIndex(requestedIndex, -1, entries.length)]); prefetch(entries[nextLightboxIndex(requestedIndex, 1, entries.length)]); }
      })().catch(() => { if (token !== renderToken) { return; } caption.textContent = `${current.label}（图片加载失败）`; delete overlay.dataset.pendingMediaUrl; overlay.classList.remove('is-loading', 'is-switching'); overlay.removeAttribute('aria-busy'); });
    };
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const move = direction => { index = nextLightboxIndex(index, direction, entries.length); render(); };
    const onKey = event => { if (event.key === 'Escape') close(); else if (event.key === 'ArrowLeft') move(-1); else if (event.key === 'ArrowRight') move(1); };
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.querySelector('.media-lightbox-close').addEventListener('click', close); overlay.querySelector('.is-prev').addEventListener('click', () => move(-1)); overlay.querySelector('.is-next').addEventListener('click', () => move(1));
    overlay.querySelector('[data-media-zoom-in]').addEventListener('click', () => setScale(scale * 1.25)); overlay.querySelector('[data-media-zoom-out]').addEventListener('click', () => setScale(scale / 1.25)); overlay.querySelector('[data-media-zoom-reset]').addEventListener('click', reset);
    image.addEventListener('dblclick', event => { event.preventDefault(); setScale(scale > 1 ? 1 : 2, event.clientX, event.clientY); });
    image.addEventListener('wheel', event => { event.preventDefault(); setScale(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY); }, { passive: false });
    image.addEventListener('pointerdown', event => { if (scale <= 1) return; event.preventDefault(); drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tx: translateX, ty: translateY }; image.setPointerCapture?.(event.pointerId); });
    image.addEventListener('pointermove', event => { if (!drag || drag.id !== event.pointerId) return; event.preventDefault(); translateX = drag.tx + lightboxPanDelta(event.clientX - drag.x, scale); translateY = drag.ty + lightboxPanDelta(event.clientY - drag.y, scale); apply(); });
    image.addEventListener('pointerup', () => { drag = null; }); image.addEventListener('pointercancel', () => { drag = null; });
    image.addEventListener('mousedown', event => { if (scale <= 1 || drag) return; event.preventDefault(); drag = { mouse: true, x: event.clientX, y: event.clientY, tx: translateX, ty: translateY }; });
    image.addEventListener('mousemove', event => { if (!drag?.mouse) return; event.preventDefault(); translateX = drag.tx + lightboxPanDelta(event.clientX - drag.x, scale); translateY = drag.ty + lightboxPanDelta(event.clientY - drag.y, scale); apply(); });
    image.addEventListener('mouseup', () => { if (drag?.mouse) drag = null; }); image.addEventListener('mouseleave', () => { if (drag?.mouse) drag = null; }); image.addEventListener('dragstart', event => event.preventDefault());
    strip.addEventListener('click', event => { const button = event.target.closest?.('[data-lightbox-index]'); if (button) { index = Number(button.dataset.lightboxIndex) || 0; render(); } });
    document.addEventListener('keydown', onKey); document.body.appendChild(overlay); render();
  });
}
