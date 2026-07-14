(() => {
  if (window.VidoMediaDelivery) return;

  const IMAGE_ROUTE = /^(?:\/api\/(?:assets\/file|portrait\/image|comic\/(?:image|tasks\/[^/]+\/(?:pages|panels|images))|drama\/tasks\/[^/]+\/image|ai-cap\/file|story\/character-image|i2v\/images|avatar\/(?:images|preset-img)|workflow\/effects\/assets|new-story-ad\/assets)|\/public\/(?:jimeng-assets|workflow-assets|dh-assets)\/)/i;
  const PUBLIC_MEDIA_ROUTE = /^(?:\/api\/(?:assets\/file|portrait\/image|comic\/image|drama\/tasks\/[^/]+\/image|ai-cap\/file|story\/character-image|i2v\/images|new-story-ad\/assets)|\/public\/(?:jimeng-assets|workflow-assets|dh-assets)\/)/i;
  const processedVideos = new WeakSet();
  const warmed = new Set();

  function localUrl(value = '') {
    const raw = String(value || '').trim();
    if (!raw || /^(?:data|blob):/i.test(raw)) return null;
    try {
      const url = new URL(raw, location.origin);
      return url.origin === location.origin ? url : null;
    } catch {
      return null;
    }
  }

  function stableCacheUrl(value = '') {
    const parsed = localUrl(value);
    if (!parsed) return String(value || '').trim();
    if (PUBLIC_MEDIA_ROUTE.test(parsed.pathname)) parsed.searchParams.delete('token');
    return parsed.pathname + parsed.search + parsed.hash;
  }

  function stableOriginalUrl(value = '') {
    const parsed = localUrl(stableCacheUrl(value));
    if (!parsed) return String(value || '').trim();
    parsed.searchParams.delete('thumb');
    parsed.searchParams.delete('w');
    parsed.searchParams.delete('width');
    parsed.searchParams.delete('preview');
    parsed.searchParams.delete('format');
    parsed.searchParams.delete('fm');
    parsed.searchParams.delete('quality');
    parsed.searchParams.delete('q');
    return parsed.pathname + parsed.search + parsed.hash;
  }

  function supportsPreview(value = '') {
    const parsed = localUrl(value);
    return !!parsed && IMAGE_ROUTE.test(parsed.pathname) && !/\.svg(?:$|[?#])/i.test(parsed.pathname);
  }

  function bucketWidth(value = 640) {
    const width = Math.max(120, Math.min(2560, Math.ceil(Number(value) || 640)));
    return [240, 320, 480, 640, 960, 1280, 1600, 1920, 2560].find(size => size >= width) || 2560;
  }

  function previewUrl(value = '', width = 640, format = 'webp') {
    const original = stableOriginalUrl(value);
    if (!supportsPreview(original)) return original;
    const parsed = new URL(original, location.origin);
    parsed.searchParams.set('thumb', String(bucketWidth(width)));
    parsed.searchParams.set('format', format || 'webp');
    return parsed.pathname + parsed.search + parsed.hash;
  }

  function displayWidth(img) {
    if (img.dataset.mediaWidth) return bucketWidth(img.dataset.mediaWidth);
    if (img.classList.contains('dh-image-modal-img') || img.closest?.('[role="dialog"],.dh-image-modal,.modal')) return 1280;
    const cssWidth = Math.max(img.clientWidth || 0, Number.parseFloat(getComputedStyle(img).width) || 0);
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    return bucketWidth(cssWidth ? cssWidth * density : 640);
  }

  function processImage(img) {
    if (!(img instanceof HTMLImageElement)) return;
    const current = img.getAttribute('src') || '';
    const original = img.dataset.mediaOriginal || stableOriginalUrl(current);
    if (!original || !supportsPreview(original)) {
      if (!img.hasAttribute('decoding')) img.decoding = 'async';
      return;
    }
    img.dataset.mediaOriginal = original;
    const width = displayWidth(img);
    const next = previewUrl(original, width);
    if (!img.hasAttribute('loading') && !img.hasAttribute('fetchpriority')) img.loading = 'lazy';
    img.decoding = 'async';
    if (!img.hasAttribute('srcset')) {
      img.srcset = [320, 640, 960, 1280].map(size => `${previewUrl(original, size)} ${size}w`).join(', ');
      img.sizes = img.getAttribute('sizes') || '(max-width: 720px) 100vw, 960px';
    }
    if (current !== next && !current.includes(`thumb=${width}`)) img.src = next;
  }

  let videoObserver = null;
  function ensureVideoObserver() {
    if (videoObserver || !('IntersectionObserver' in window)) return videoObserver;
    videoObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const video = entry.target;
        video.preload = 'metadata';
        videoObserver.unobserve(video);
      });
    }, { rootMargin: '320px' });
    return videoObserver;
  }

  function processVideo(video) {
    if (!(video instanceof HTMLVideoElement) || processedVideos.has(video)) return;
    processedVideos.add(video);
    video.playsInline = true;
    if (video.autoplay || video.hasAttribute('data-media-eager')) {
      video.preload = video.preload || 'metadata';
      return;
    }
    video.preload = 'none';
    ensureVideoObserver()?.observe(video);
  }

  function processNode(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('img')) processImage(node);
    if (node.matches('video')) processVideo(node);
    node.querySelectorAll?.('img').forEach(processImage);
    node.querySelectorAll?.('video').forEach(processVideo);
  }

  function warm(value = '', width = 1280) {
    const url = previewUrl(value, width);
    if (!url || !supportsPreview(url) || warmed.has(url)) return;
    warmed.add(url);
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  }

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(processNode);
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) processImage(record.target);
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  document.addEventListener('DOMContentLoaded', () => processNode(document.body), { once: true });
  document.addEventListener('pointerover', event => {
    const target = event.target?.closest?.('img,[data-nsa-frame-preview],[data-nsa-scene-preview],[data-preview]');
    const img = target?.matches?.('img') ? target : target?.querySelector?.('img');
    if (img?.dataset.mediaOriginal) warm(img.dataset.mediaOriginal, 1280);
  }, { passive: true });

  window.VidoMediaDelivery = { stableCacheUrl, stableOriginalUrl, supportsPreview, previewUrl, processImage, processVideo, warm };
})();
