(() => {
  if (window.VidoMediaDelivery) return;

  const IMAGE_ROUTE = /^(?:\/api\/(?:assets\/file|portrait\/image|comic\/(?:image|tasks\/[^/]+\/(?:pages|panels|images))|drama\/tasks\/[^/]+\/image|ai-cap\/file|story\/character-image|i2v\/images|avatar\/(?:images|preset-img)|workflow\/effects\/assets|new-story-ad\/assets)|\/public\/(?:jimeng-assets|workflow-assets|dh-assets)\/)/i;
  const PUBLIC_MEDIA_ROUTE = /^(?:\/api\/(?:assets\/file|portrait\/image|comic\/image|drama\/tasks\/[^/]+\/image|ai-cap\/file|story\/character-image|i2v\/images|new-story-ad\/assets)|\/public\/(?:jimeng-assets|workflow-assets|dh-assets)\/)/i;
  const processedVideos = new WeakSet();
  const warmed = new Set();
  const performanceState = {
    version: 1,
    lcp_ms: 0,
    cls: 0,
    inp_ms: 0,
    long_task_count: 0,
    max_long_task_ms: 0
  };

  function performanceSnapshot() {
    const timing = window.performance;
    if (!timing?.getEntriesByType) return null;
    const navigation = timing.getEntriesByType('navigation')[0];
    const resources = timing.getEntriesByType('resource');
    const totals = {
      initial_js_bytes: 0,
      initial_css_bytes: 0,
      initial_api_bytes: 0,
      initial_image_bytes: 0,
      initial_video_bytes: 0,
      request_count: resources.length
    };
    const resourceItems = resources.map(entry => {
      const bytes = Number(entry.transferSize || entry.encodedBodySize || 0);
      let pathname = '';
      try {
        pathname = new URL(entry.name, location.origin).pathname.toLowerCase();
      } catch {
        pathname = String(entry.name || '').toLowerCase();
      }
      if (pathname.startsWith('/api/')) totals.initial_api_bytes += bytes;
      if (entry.initiatorType === 'script' || /\.m?js$/.test(pathname)) totals.initial_js_bytes += bytes;
      if (entry.initiatorType === 'css' || /\.css$/.test(pathname)) totals.initial_css_bytes += bytes;
      if (entry.initiatorType === 'img' || /\.(?:avif|gif|jpe?g|png|svg|webp)$/.test(pathname)) totals.initial_image_bytes += bytes;
      if (entry.initiatorType === 'video' || /\.(?:m3u8|mov|mp4|webm)$/.test(pathname)) totals.initial_video_bytes += bytes;
      return {
        path: pathname,
        type: entry.initiatorType || '',
        bytes,
        duration_ms: Math.round(entry.duration || 0)
      };
    });
    return {
      page: location.pathname,
      navigation_type: navigation?.type || '',
      ttfb_ms: Math.round(navigation?.responseStart || 0),
      dom_interactive_ms: Math.round(navigation?.domInteractive || 0),
      load_ms: Math.round(navigation?.loadEventEnd || 0),
      ...performanceState,
      ...totals,
      top_resources: resourceItems
        .filter(item => item.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 12),
      api_requests: resourceItems
        .filter(item => item.path.startsWith('/api/'))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 12)
    };
  }

  function publishPerformanceSnapshot() {
    const snapshot = performanceSnapshot();
    if (!snapshot) return;
    const serialized = JSON.stringify(snapshot);
    window.__VIDO_PERFORMANCE__ = serialized;
    document.documentElement?.setAttribute('data-vido-performance', serialized);
  }

  function observePerformance() {
    if (!window.performance?.getEntriesByType) return;
    const register = (type, callback, options = {}) => {
      if (!('PerformanceObserver' in window)) return;
      try {
        const observer = new PerformanceObserver(list => {
          callback(list.getEntries());
          publishPerformanceSnapshot();
        });
        observer.observe({ type, buffered: true, ...options });
      } catch {
        // Some browsers expose PerformanceObserver but not every entry type.
      }
    };
    register('largest-contentful-paint', entries => {
      const last = entries[entries.length - 1];
      if (last) performanceState.lcp_ms = Math.round(last.startTime || last.renderTime || last.loadTime || 0);
    });
    register('layout-shift', entries => {
      entries.forEach(entry => {
        if (!entry.hadRecentInput) performanceState.cls = Number((performanceState.cls + (entry.value || 0)).toFixed(4));
      });
    });
    register('event', entries => {
      entries.forEach(entry => {
        performanceState.inp_ms = Math.max(performanceState.inp_ms, Math.round(entry.duration || 0));
      });
    }, { durationThreshold: 40 });
    register('longtask', entries => {
      performanceState.long_task_count += entries.length;
      entries.forEach(entry => {
        performanceState.max_long_task_ms = Math.max(performanceState.max_long_task_ms, Math.round(entry.duration || 0));
      });
    });
    publishPerformanceSnapshot();
    addEventListener('load', () => {
      publishPerformanceSnapshot();
      setTimeout(publishPerformanceSnapshot, 2000);
    }, { once: true });
  }

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
    if (img.dataset.mediaLock === 'true') {
      img.decoding = 'async';
      return;
    }
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

  observePerformance();
  window.VidoMediaDelivery = {
    stableCacheUrl,
    stableOriginalUrl,
    supportsPreview,
    previewUrl,
    processImage,
    processVideo,
    warm,
    performanceSnapshot
  };
})();
