(() => {
  function frameUrl(frame = {}) {
    return frame.image_url || frame.imageUrl || frame.url || '';
  }

  function thumbUrl(url = '', width = 520) {
    const raw = String(url || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
    const join = raw.includes('?') ? '&' : '?';
    return `${raw}${join}thumb=${Math.max(160, Math.min(960, Number(width) || 520))}`;
  }

  function completedCount(keyframes = []) {
    return (Array.isArray(keyframes) ? keyframes : []).filter(frame => frame && frameUrl(frame)).length;
  }

  function status(keyframes = [], shots = []) {
    const total = Math.max(
      Array.isArray(shots) ? shots.length : 0,
      Array.isArray(keyframes) ? keyframes.length : 0,
    );
    const missingIndexes = Array.from({ length: total })
      .map((_, index) => index)
      .filter(index => !frameUrl((keyframes || [])[index] || {}));
    const failed = Array.from({ length: total })
      .filter((_, index) => (keyframes || [])[index]?.error && !frameUrl((keyframes || [])[index] || {}))
      .length;
    return {
      total,
      completed: Math.max(0, total - missingIndexes.length),
      missing: missingIndexes.length,
      failed,
      missing_indexes: missingIndexes,
    };
  }

  function frameTitle(shot = {}, index = 0) {
    return shot.title || `第 ${index + 1} 镜`;
  }

  function previewButtonHtml({ frame = {}, shot = {}, index = 0, previewUrl = '', imageUrl = '', escapeHtml } = {}) {
    const esc = typeof escapeHtml === 'function' ? escapeHtml : (x => String(x || ''));
    const title = frameTitle(shot, index);
    const stateText = frame.error && !previewUrl ? '生成失败，需重新生成' : '等待生成关键帧';
    const source = previewUrl ? thumbUrl(previewUrl, index < 2 ? 640 : 520) : '';
    const loading = index < 2 ? 'eager' : 'lazy';
    const priority = index < 2 ? ' fetchpriority="high"' : '';
    const qa = frame.qa || {};
    const qaText = qa.status === 'not_applicable'
      ? '未启用场景空间锁'
      : (qa.pass === true
        ? `空间一致性已通过${qa.scene_consistency_score ? ` · ${Math.round(Number(qa.scene_consistency_score) * 100)}%` : ''}`
        : (frame.error ? `失败：${frame.error}` : '等待空间一致性检查'));
    return `<button type="button" class="dh-nsa-frame-preview ${previewUrl ? '' : 'pending'}" ${previewUrl ? `data-nsa-frame-preview="${index}" data-nsa-frame-full="${esc(imageUrl || previewUrl)}" title="点击查看第 ${index + 1} 镜大图"` : 'disabled'}>
      ${source ? `<img src="${esc(source)}" alt="${esc(title)}" loading="${loading}" decoding="async"${priority} onerror="this.closest('.dh-nsa-frame-preview')?.classList.add('image-error')">` : `<span>${String(index + 1).padStart(2, '0')}</span>`}
      <b>${String(index + 1).padStart(2, '0')} · ${esc(title)}</b>
      <small>${previewUrl ? qaText : stateText}</small>
    </button>`;
  }

  window.NewStoryAdKeyframes = {
    frameUrl,
    thumbUrl,
    completedCount,
    status,
    frameTitle,
    previewButtonHtml,
  };
})();
