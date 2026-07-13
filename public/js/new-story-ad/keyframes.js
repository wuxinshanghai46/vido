(() => {
  function frameUrl(frame = {}) {
    const raw = String(frame.image_url || frame.imageUrl || frame.url || '').trim();
    return raw;
  }

  function friendlyError(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/prompt:\s*size must be between|prompt.*(?:too long|length|limit)/i.test(raw)) return '本镜头生成约束过长，系统需要压缩提示词后重新生成。';
    if (/insufficient quota|account balance not enough|insufficient balance|balance not enough|"code"\s*:\s*(1005|1102)/i.test(raw)) return '当前图片模型通道额度不足，请补充额度或切换可用模型后重新生成。';
    if (/temporary|expired|asset.*not found|404/i.test(raw)) return '关键帧图片地址已失效，请重新生成本镜头。';
    return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
  }

  function thumbUrl(url = '', width = 520) {
    const raw = String(url || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
    // Never mutate signed provider URLs: adding thumb/w invalidates signatures.
    if (/^https?:\/\//i.test(raw)) return raw;
    if (!/^\/api\/new-story-ad\/assets\//i.test(raw)) return raw;
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
    const displayError = friendlyError(frame.error || (frame.image_url && !previewUrl ? '关键帧图片地址已失效，请重新生成本镜头。' : ''));
    const stateText = displayError ? displayError : '等待生成关键帧';
    const source = previewUrl ? thumbUrl(previewUrl, index < 2 ? 640 : 520) : '';
    const loading = index < 2 ? 'eager' : 'lazy';
    const priority = index < 2 ? ' fetchpriority="high"' : '';
    const qa = frame.qa || {};
    const qaText = qa.status === 'not_applicable'
      ? '未启用场景空间锁'
      : (qa.pass === true
        ? `空间一致性已通过${qa.scene_consistency_score ? ` · ${Math.round(Number(qa.scene_consistency_score) * 100)}%` : ''}`
        : (displayError ? `失败：${displayError}` : '等待空间一致性检查'));
    return `<button type="button" class="dh-nsa-frame-preview ${previewUrl ? '' : 'pending'}" ${previewUrl ? `data-nsa-frame-preview="${index}" data-nsa-frame-full="${esc(imageUrl || previewUrl)}" title="点击查看第 ${index + 1} 镜大图"` : 'disabled'}>
      ${source ? `<img src="${esc(source)}" alt="${esc(title)}" loading="${loading}" decoding="async"${priority} onerror="const p=this.closest('.dh-nsa-frame-preview');this.hidden=true;p?.classList.add('image-error');const s=p?.querySelector('small');if(s)s.textContent='图片地址已失效，请重新生成本镜'">` : `<span>${String(index + 1).padStart(2, '0')}</span>`}
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
    friendlyError,
    previewButtonHtml,
  };
})();
