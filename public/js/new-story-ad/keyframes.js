(() => {
  function frameUrl(frame = {}) {
    return frame.image_url || frame.imageUrl || frame.url || '';
  }

  function completedCount(keyframes = []) {
    return (Array.isArray(keyframes) ? keyframes : []).filter(frame => frame && (frameUrl(frame) || frame.error)).length;
  }

  function frameTitle(shot = {}, index = 0) {
    return shot.title || `第 ${index + 1} 镜`;
  }

  function previewButtonHtml({ frame = {}, shot = {}, index = 0, previewUrl = '', escapeHtml } = {}) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    const title = frameTitle(shot, index);
    return `<button type="button" class="dh-nsa-frame-preview ${previewUrl ? '' : 'pending'}" ${previewUrl ? `data-nsa-frame-preview="${index}" title="点击查看第 ${index + 1} 镜大图"` : 'disabled'}>
      ${previewUrl ? `<img src="${esc(previewUrl)}" alt="${esc(title)}" loading="lazy" decoding="async">` : `<span>${String(index + 1).padStart(2, '0')}</span>`}
      <b>${String(index + 1).padStart(2, '0')} · ${esc(title)}</b>
      <small>${previewUrl ? '点击查看大图' : '等待生成关键帧'}</small>
    </button>`;
  }

  window.NewStoryAdKeyframes = {
    frameUrl,
    completedCount,
    frameTitle,
    previewButtonHtml,
  };
})();
