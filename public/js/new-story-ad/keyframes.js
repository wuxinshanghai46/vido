(() => {
  const QA_REASON_TRANSLATIONS = [
    [/drastically different space.*tunnel-like structure.*high-tech command center/i, '生成画面变成隧道式空间，与已锁定的高科技指挥中心不是同一场景'],
    [/new shield element and energy pathway.*unsupported.*contradict/i, '新增了分镜和参考场景未要求的盾牌与能量通道'],
    [/dominant materials.*rock textures.*glowing pathways.*brushed metal.*polished concrete.*frosted glass/i, '岩石墙面和发光通道偏离参考场景的拉丝金属、抛光混凝土与磨砂玻璃材质'],
    [/camera perspective and framing.*camera_detail/i, '机位与构图不符合已锁定的细节视角'],
    [/rock-textured tunnel walls/i, '出现参考场景中没有的岩石隧道墙'],
    [/energy pathway.*inconsistent.*data wall/i, '能量通道与原有数据墙元素不一致'],
    [/blue shield symbol.*deviates.*platform-focus core/i, '蓝色盾牌符号偏离平台主体视觉核心'],
    [/unexpected human subject added/i, '画面新增了未要求的人物'],
    [/subject is not in the provided scene contract or specified requirements/i, '该人物不在场景合同或分镜要求中'],
    [/presence of new human figure explicitly forbidden/i, '新增人物违反当前场景禁止项'],
    [/human subject not allowed.*contract negative clauses/i, '场景负面约束明确不允许出现人物'],
  ];

  function qaReasonToChinese(reason = '') {
    const raw = String(reason || '').trim();
    if (!raw || /[\u3400-\u9fff]/.test(raw)) return raw;
    const matched = QA_REASON_TRANSLATIONS.find(([pattern]) => pattern.test(raw));
    return matched
      ? matched[1]
      : '场景、机位、材质或禁止元素与参考图不一致（原始检查详情已保留供技术人员排查）';
  }

  function friendlyError(error = '') {
    const raw = String(error || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(第\s*\d+\s*镜场景空间一致性\s*QA\s*未通过)[：:]\s*(.*)$/i);
    if (!match) return raw;
    const translated = String(match[2] || '')
      .split(/\s*;\s*/)
      .map(qaReasonToChinese)
      .filter(Boolean)
      .filter((reason, index, all) => all.indexOf(reason) === index);
    return `${match[1]}：${translated.join('；') || '空间、机位或材质与参考场景不一致'}`;
  }

  function frameUrl(frame = {}) {
    return frame.image_url || frame.imageUrl || frame.url || '';
  }

  function thumbUrl(url = '', width = 520) {
    const raw = String(url || '').trim();
    if (!raw || /^blob:/i.test(raw) || /^data:/i.test(raw)) return raw;
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
    const stateText = frame.error && !previewUrl ? '生成失败，需重新生成' : '等待生成关键帧';
    const source = previewUrl ? thumbUrl(previewUrl, index < 2 ? 640 : 520) : '';
    const loading = index < 2 ? 'eager' : 'lazy';
    const priority = index < 2 ? ' fetchpriority="high"' : '';
    const qa = frame.qa || {};
    const qaText = frame.regeneration_error
      ? '仍显示上一版 · 新版本未通过 QA'
      : qa.status === 'not_applicable'
      ? '未启用场景空间锁'
      : (qa.pass === true
        ? `空间一致性已通过${qa.scene_consistency_score ? ` · ${Math.round(Number(qa.scene_consistency_score) * 100)}%` : ''}`
        : (frame.error ? `失败：${friendlyError(frame.error)}` : '等待空间一致性检查'));
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
    qaReasonToChinese,
    friendlyError,
    previewButtonHtml,
  };
})();
