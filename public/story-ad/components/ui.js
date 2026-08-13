

export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

export function formatDate(value = '') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function statusView(project = {}) {
  const status = String(project.status || '').toLowerCase();
  const stage = String(project.stage || '').toLowerCase();
  if (project.error || ['failed', 'blocked'].includes(status)) return { label: '需要处理', tone: 'danger' };
  if (project.final_video_url || ['done', 'completed', 'succeeded'].includes(status)) return { label: '已完成', tone: 'success' };
  if (project.active_generation_id || ['running', 'queued', 'processing'].includes(status)) return { label: '生成中', tone: 'info' };
  const labels = {
    brief: '目标与材料',
    assets: '资产准备',
    plot: '剧情确认',
    storyboard: '分镜确认',
    shot: '镜头制作',
    final: '成片处理',
  };
  return { label: labels[project.workspace] || (stage === 'draft' ? '需求编辑' : '继续制作'), tone: 'neutral' };
}

export function formatElapsedText(milliseconds = 0) {
  const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
  return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, '0')}秒`;
}

export function elapsedMilliseconds(startedAt = '', finishedAt = '', nowMs = Date.now()) {
  const started = Date.parse(String(startedAt || ''));
  if (!Number.isFinite(started)) return null;
  const finished = Date.parse(String(finishedAt || ''));
  const ended = Number.isFinite(finished) ? finished : Number(nowMs || Date.now());
  return Math.max(0, ended - started);
}

export function elapsedTimeTag({ startedAt = '', finishedAt = '', active = false } = {}) {
  const elapsed = elapsedMilliseconds(startedAt, active ? '' : finishedAt);
  if (elapsed == null) return '';
  const prefix = active ? '已耗时' : '本次耗时';
  return `<em class="elapsed-time" data-elapsed-started-at="${escapeHtml(startedAt)}" data-elapsed-finished-at="${escapeHtml(active ? '' : finishedAt)}" data-elapsed-prefix="${prefix}">${prefix} ${formatElapsedText(elapsed)}</em>`;
}

export function refreshElapsedLabels(scope = document, nowMs = Date.now()) {
  scope.querySelectorAll?.('[data-elapsed-started-at]').forEach(element => {
    const elapsed = elapsedMilliseconds(element.dataset.elapsedStartedAt, element.dataset.elapsedFinishedAt, nowMs);
    if (elapsed == null) return;
    element.textContent = `${element.dataset.elapsedPrefix || '已耗时'} ${formatElapsedText(elapsed)}`;
  });
  scope.querySelectorAll?.('[data-busy-started-at]').forEach(button => {
    const elapsed = Math.max(0, Number(nowMs || Date.now()) - Number(button.dataset.busyStartedAt || nowMs));
    button.textContent = `${button.dataset.busyLabel || '处理中…'} · 已耗时 ${formatElapsedText(elapsed)}`;
  });
}

const GENERATION_STAGE_LABELS = {
  subject_assets: '人物与动物资产',
  visual_assets: '人物与场景视觉资产',
  person_provider_sync: '人物 ID 与 Seedance 同步',
  product_asset: '商品资产',
  prop_asset: '人物随身道具',
  scene_config: '人物与场景方案',
  scene_asset: '场景视图',
  blueprint: '剧情蓝图',
  storyboard: '文字分镜',
  keyframes: '关键帧',
  video: '视频片段',
  media: '视频片段',
  tts: '配音',
  compose: '最终成片',
  full: '剧情广告',
};

const GENERATION_UNIT_LABELS = {
  subject_assets: '项资产', visual_assets: '个本批目标', person_provider_sync: '个人物', product_asset: '项商品', prop_asset: '项道具', scene_asset: '张场景图', blueprint: '个步骤', storyboard: '个分镜',
  keyframes: '张关键帧', video: '个视频片段', media: '个视频片段', tts: '段配音', compose: '个步骤', full: '个步骤',
};

export function publicGenerationMessage(value = '', options = {}) {
  const text = String(value || '').trim();
  if (!text) return options.fallback || '';
  if (/计费|billing/i.test(text)) return '生成已暂停，成功资产已保留；计费状态核对完成前不会重复提交。';
  if (/审核|audit|content.?policy|safety/i.test(text)) return '当前内容未通过生成规则检查，请调整素材或描述后再试。';
  if (/供应商|provider|model|模型|http\s*5\d\d|support|支持编号|task.?id|request.?id|sk-[a-z0-9]/i.test(text)) return '本次生成未完成，成功资产已保留。请稍后从缺失项继续。';
  return text.replace(/(?:支持编号|任务编号|请求编号|task.?id|request.?id)\s*[:：]\s*[\w-]+/gi, '').trim()
    || options.fallback || '本次生成未完成，成功资产已保留。';
}

export function generationProgressView(bundle = {}) {
  const project = bundle.project || {};
  const progress = bundle.generation?.progress || project.generation_progress || {};
  const status = String(progress.status || project.status || '').toLowerCase();
  const active = Boolean(project.active_generation_id) || ['queued', 'running', 'processing'].includes(status);
  const failed = ['failed', 'blocked'].includes(status) || Boolean(project.error && !active);
  if (!active && !failed) return null;
  const stage = String(progress.stage || project.active_stage || project.stage || 'full').toLowerCase();
  const total = Math.max(1, Math.floor(Number(progress.target_total || progress.total || 1) || 1));
  const completed = Math.floor(Math.max(0, Math.min(total, Number(progress.completed ?? progress.processed ?? 0) || 0)));
  const percent = Math.max(0, Math.min(100, Number.isFinite(Number(progress.percent))
    ? Math.round(Number(progress.percent))
    : Math.round((completed / total) * 100)));
  const activeIndexes = Array.isArray(progress.active_indexes)
    ? progress.active_indexes.map(value => Math.round(Number(value) || 0)).filter(value => value > 0).slice(0, 8)
    : [];
  const currentIndex = Math.max(0, Math.round(Number(progress.current_index) || 0));
  const stageLabel = GENERATION_STAGE_LABELS[stage] || '当前任务';
  const unitLabel = GENERATION_UNIT_LABELS[stage] || '项';
  const startedAt = String(progress.started_at || project.generation_started_at || project.generation_queued_at || '');
  const finishedAt = String(progress.finished_at || project.generation_finished_at || project.updated_at || '');
  const failureCode = String(progress.error_code || project.error_code || '').toUpperCase();
  const failureText = String(progress.message || project.error || '');
  const billingUnknown = progress.billing_state === 'unknown' || /billing(?:_| )state[^\n]*unknown|计费状态[^\n]*未知/i.test(failureText);
  let failureTitle = stage === 'scene_config' ? `${stageLabel}更新失败` : `${stageLabel}生成失败`;
  if (failureCode === 'PROVIDER_CONTENT_AUDIT') failureTitle = `${stageLabel}内容审核未通过`;
  else if (progress.phase === 'review_failed' || /(?:QUALITY|QA|REVIEW).*FAILED/.test(failureCode)) failureTitle = `${stageLabel}质量审核未通过`;
  else if (billingUnknown) failureTitle = `${stageLabel}生成中断（计费待核对）`;
  else if (/TIMEOUT|NETWORK|IMAGE_ATTEMPTS_EXHAUSTED/.test(failureCode) || /upstream connect error|connection termination|reset before headers/i.test(failureText)) failureTitle = `${stageLabel}生成中断（模型连接失败）`;
  const actionableFailureMessage = failureCode === 'SUBJECT_REUSE_ASSET_MISSING'
    ? '部分未选择的人物或动物还没有可复用四视图。请使用“生成全部缺失人物 / 动物”，系统会在提交前显示本批主体数量。'
    : '';
  let liveText = '';
  if (failed && stage === 'scene_config') liveText = '资产已保留，请更新方案';
  else if (failed) liveText = billingUnknown ? '已保留成功资产，核对计费前不会重复调用' : '已保留成功资产，可从缺失项继续';
  else if (activeIndexes.length) liveText = `正在生成第 ${activeIndexes.join('、')} 镜`;
  else if (currentIndex && ['storyboard', 'keyframes', 'video', 'media'].includes(stage)) liveText = `正在生成第 ${currentIndex} 镜`;
  else liveText = progress.phase ? String(progress.phase).replaceAll('_', ' ') : '正在处理';
  return {
    active, failed, stage, stageLabel, unitLabel, total, completed, percent, liveText, failureTitle,
    lanes: progress.lanes && typeof progress.lanes === 'object' ? progress.lanes : null,
    message: failed && stage === 'scene_config'
      ? '方案更新失败，资产已保留。'
      : (actionableFailureMessage || publicGenerationMessage(progress.message || project.error, { fallback: `${stageLabel}正在处理中，请保持页面打开。` })),
    generationId: String(project.active_generation_id || progress.generation_id || ''),
    startedAt,
    finishedAt,
  };
}

export function generationProgressPanel(bundle = {}, currentView = '') {
  const view = generationProgressView(bundle);
  if (!view) return '';
  const ready=bundle.navigation?.asset_plan_eligibility?.eligible === true;
  const recovery=view.stage === 'visual_assets' && currentView !== 'assets'
    ? `<button class="btn small" data-view="assets">前往资产中心${ready ? '继续缺失图片' : '更新人物与场景方案'}</button>`:'';
  const laneRows = view.lanes ? `<div class="generation-lanes">${[
    ['subjects', '人物 / 动物'], ['scenes', '场景'],
  ].map(([key, label]) => {
    const lane = view.lanes[key] || {};
    const total = Math.max(0, Math.floor(Number(lane.total || 0)));
    const completed = Math.floor(Math.max(0, Math.min(total || 1, Number(lane.completed || 0))));
    const status = lane.required === false ? '不需要' : (lane.status === 'completed' ? '已完成' : (lane.status === 'failed' ? '需处理' : `${Math.floor(completed)}/${total}`));
    return `<div><span><b>${label}</b><small>${escapeHtml(publicGenerationMessage(lane.message || ''))}</small></span><strong>${escapeHtml(status)}</strong></div>`;
  }).join('')}</div>` : '';
  if (view.failed) {
    const retained = laneRows || recovery
      ? `<details class="project-progress-details"><summary>查看已保留内容</summary>${laneRows}${recovery ? `<div class="project-progress-foot">${recovery}</div>` : ''}</details>`
      : '';
    return `<section class="project-generation-progress is-failed is-terminal" role="alert">
      <div class="project-progress-head"><div><b>${escapeHtml(view.failureTitle)}</b><span>${escapeHtml(view.liveText)}</span></div><span class="status-tag is-danger">已停止</span></div>
      ${retained}
    </section>`;
  }
  return `<section class="project-generation-progress ${view.failed ? 'is-failed' : ''}" role="status" aria-live="polite">
    <div class="project-progress-head"><div><b>${escapeHtml(view.failed ? `${view.stageLabel}需要处理` : `正在生成${view.stageLabel}`)}</b><span>已完成 ${view.completed}/${view.total} ${escapeHtml(view.unitLabel)} · ${escapeHtml(view.liveText)}</span></div><span class="project-progress-stats">${elapsedTimeTag({ startedAt: view.startedAt, finishedAt: view.finishedAt, active: view.active })}<strong>${view.percent}%</strong></span></div>
    <div class="project-progress-track" aria-hidden="true"><i style="width:${view.percent}%"></i></div>${laneRows}
    <div class="project-progress-foot"><small>${escapeHtml(view.message)}</small>${view.active ? `<button class="btn small danger" type="button" data-cancel-generation data-generation-id="${escapeHtml(view.generationId)}">停止生成</button>` : ''}</div>
  </section>`;
}

export function toast(message, tone = 'info') {
  const host = document.querySelector('#storyAdToast');
  if (!host || !message) return;
  const item = document.createElement('div');
  item.className = `toast is-${tone}`;
  item.textContent = message;
  host.appendChild(item);
  requestAnimationFrame(() => item.classList.add('show'));
  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 180);
  }, 3200);
}

export function setButtonBusy(button, busy, label = '处理中…', options = {}) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.previousText) button.dataset.previousText = button.textContent;
    if (options.elapsed === true) {
      button.dataset.busyStartedAt = String(Date.now());
      button.dataset.busyLabel = label;
      button.textContent = `${label} · 已耗时 ${formatElapsedText(0)}`;
    } else {
      button.textContent = label;
    }
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.previousText || button.textContent;
    delete button.dataset.previousText;
    delete button.dataset.busyStartedAt;
    delete button.dataset.busyLabel;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function emptyState({ title, body, action = '', actionId = '' }) {
  return `<div class="empty-state">
    <div class="empty-icon" aria-hidden="true">＋</div>
    <b>${escapeHtml(title)}</b>
    <p>${escapeHtml(body)}</p>
    ${action ? `<button class="btn" type="button" ${actionId ? `data-empty-action="${escapeHtml(actionId)}"` : ''}>${escapeHtml(action)}</button>` : ''}
  </div>`;
}

export function mediaPreview(item = {}, options = {}) {
  const sourceImageUrl = item.image_url || item.imageUrl || '';
  const imageUrl = item.thumbnail_url || sourceImageUrl;
  const videoUrl = item.video_url || item.videoUrl || '';
  const url = videoUrl || imageUrl || item.media_url || item.url || '';
  const label = options.label || item.name || item.title || '媒体';
  const videoLike = Boolean(videoUrl)
    || ['video', 'clip', 'final'].includes(String(item.type || item.kind || '').toLowerCase())
    || /\.(?:mp4|webm|mov)(?:\?|$)/i.test(url);
  if (url && videoLike) {
    return `<video class="media" src="${escapeHtml(url)}" ${imageUrl ? `poster="${escapeHtml(imageUrl)}"` : ''} preload="metadata" ${options.controls ? 'controls' : 'muted data-hover-video-preview tabindex="0"'} playsinline aria-label="${escapeHtml(label)}"></video>`;
  }
  if (url) {
    const previewUrl = `${url}${url.includes('?') ? '&' : '?'}thumb=${options.width || 480}`;
    const image = `<img class="media" src="${escapeHtml(previewUrl)}" loading="lazy" alt="${escapeHtml(label)}">`;
    if (options.zoomable === true) {
      return `<button class="media-zoom-trigger" type="button" data-media-zoom-url="${escapeHtml(sourceImageUrl || url)}" data-media-preview-url="${escapeHtml(previewUrl)}" data-media-zoom-label="${escapeHtml(label)}" data-media-zoom-group="${escapeHtml(options.zoomGroup || 'media')}">${image}<span aria-hidden="true">⌕</span></button>`;
    }
    return image;
  }
  return `<div class="media-placeholder" aria-label="${escapeHtml(label)}"><span>${escapeHtml(options.symbol || '素材')}</span></div>`;
}

export function bindHoverVideoPreviews(scope = document) {
  const cleanups = [];
  scope.querySelectorAll('video[data-hover-video-preview]').forEach(video => {
    if (video.dataset.hoverPreviewBound === 'true') return;
    video.dataset.hoverPreviewBound = 'true';
    video.muted = true;
    video.loop = true;
    const play = () => video.play().catch(() => {});
    const stop = () => {
      video.pause();
      try { video.currentTime = 0; } catch {}
    };
    video.addEventListener('pointerenter', play);
    video.addEventListener('focus', play);
    video.addEventListener('pointerleave', stop);
    video.addEventListener('blur', stop);
    cleanups.push(() => {
      stop();
      video.removeEventListener('pointerenter', play);
      video.removeEventListener('focus', play);
      video.removeEventListener('pointerleave', stop);
      video.removeEventListener('blur', stop);
      delete video.dataset.hoverPreviewBound;
    });
  });
  return () => cleanups.forEach(cleanup => cleanup());
}

export function uniqueLightboxEntries(nodes = [], group = 'media') {
  return [...nodes]
    .filter(node => (node.dataset?.mediaZoomGroup || 'media') === group)
    .map(node => ({ url: node.dataset?.mediaZoomUrl || '', previewUrl: node.dataset?.mediaPreviewUrl || node.dataset?.mediaZoomUrl || '', label: node.dataset?.mediaZoomLabel || '图片' }))
    .filter((item, itemIndex, rows) => item.url && rows.findIndex(candidate => candidate.url === item.url) === itemIndex);
}

export function nextLightboxIndex(index = 0, direction = 1, total = 0) {
  const count = Math.max(0, Number(total) || 0);
  return count ? (Number(index || 0) + Number(direction || 0) + count) % count : 0;
}

export function preloadLightboxUrl(url = '', createImage = () => new Image()) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('图片地址为空'));
    const candidate = createImage();
    candidate.onload = () => resolve(url);
    candidate.onerror = () => reject(new Error('图片加载失败'));
    candidate.src = url;
  });
}

export function lightboxPanDelta(pointerDelta = 0, scale = 1) {
  const zoom = Math.max(1, Number(scale) || 1);
  return (Number(pointerDelta) || 0) * Math.min(3, 1 + (zoom - 1) * 0.35);
}

export function bindMediaLightbox(scope = document) {
  if (!scope || scope.dataset?.mediaLightboxBound === 'true') return;
  if (scope.dataset) scope.dataset.mediaLightboxBound = 'true';
  scope.addEventListener('click', event => {
    const trigger = event.target.closest?.('[data-media-zoom-url]');
    if (!trigger || !scope.contains(trigger)) return;
    event.preventDefault();
    event.stopPropagation();
    const group = trigger.dataset.mediaZoomGroup || 'media';
    const entries = uniqueLightboxEntries(scope.querySelectorAll('[data-media-zoom-url]'), group);
    let index = Math.max(0, entries.findIndex(item => item.url === (trigger.dataset.mediaZoomUrl || '')));
    if (!entries.length) return;
    document.querySelector('[data-media-lightbox]')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'media-lightbox';
    overlay.dataset.mediaLightbox = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `<button class="media-lightbox-close" type="button" aria-label="关闭大图">×</button><button class="media-lightbox-nav is-prev" type="button" aria-label="上一张">‹</button><figure><img data-media-lock="true" alt=""><figcaption><span></span><b></b><div class="media-lightbox-tools" aria-label="图片缩放工具"><button type="button" data-media-zoom-out aria-label="缩小">−</button><output data-media-zoom-level>100%</output><button type="button" data-media-zoom-in aria-label="放大">＋</button><button type="button" data-media-zoom-reset>适应屏幕</button><small data-media-pixel-size></small></div></figcaption><div class="media-lightbox-strip" role="list" aria-label="同组图片"></div></figure><button class="media-lightbox-nav is-next" type="button" aria-label="下一张">›</button>`;
    const image = overlay.querySelector('img');
    const caption = overlay.querySelector('figcaption span');
    const counter = overlay.querySelector('figcaption b');
    const strip = overlay.querySelector('.media-lightbox-strip');
    const zoomLevel = overlay.querySelector('[data-media-zoom-level]');
    const pixelSize = overlay.querySelector('[data-media-pixel-size]');
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let drag = null;
    const applyTransform = () => {
      image.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`;
      image.classList.toggle('is-zoomed', scale > 1.001);
      zoomLevel.textContent = `${Math.round(scale * 100)}%`;
    };
    const resetTransform = () => { scale = 1; translateX = 0; translateY = 0; applyTransform(); };
    const setScale = (next, anchorX = 0, anchorY = 0) => {
      const prior = scale;
      scale = Math.max(1, Math.min(8, Number(next) || 1));
      if (prior !== scale && anchorX && anchorY) {
        const rect = image.getBoundingClientRect();
        const offsetX = anchorX - (rect.left + rect.width / 2);
        const offsetY = anchorY - (rect.top + rect.height / 2);
        translateX -= offsetX * (scale / prior - 1);
        translateY -= offsetY * (scale / prior - 1);
      }
      if (scale === 1) { translateX = 0; translateY = 0; }
      applyTransform();
    };
    strip.innerHTML = entries.map((entry, entryIndex) => `<button type="button" role="listitem" data-lightbox-index="${entryIndex}" aria-label="查看${escapeHtml(entry.label)}"><img src="${escapeHtml(entry.previewUrl)}" alt=""></button>`).join('');
    let renderToken = 0;
    const prefetch = entry => {
      if (!entry?.url || entry.url === entry.previewUrl) return;
      const preload = new Image();
      preload.src = entry.url;
    };
    const render = () => {
      const current = entries[index];
      const requestedIndex = index;
      const token = ++renderToken;
      const previewUrl = current.previewUrl || current.url;
      resetTransform();
      pixelSize.textContent = '';
      strip.querySelectorAll('[data-lightbox-index]').forEach(button => button.classList.toggle('active', Number(button.dataset.lightboxIndex) === requestedIndex));
      overlay.querySelectorAll('.media-lightbox-nav').forEach(button => { button.hidden = entries.length < 2; });
      overlay.classList.add('is-loading', 'is-switching');
      overlay.setAttribute('aria-busy', 'true');
      overlay.dataset.pendingMediaUrl = previewUrl;
      void (async () => {
        let displayedUrl = '';
        try {
          displayedUrl = await preloadLightboxUrl(previewUrl);
        } catch {
          if (!current.url || current.url === previewUrl) throw new Error('图片加载失败');
          displayedUrl = await preloadLightboxUrl(current.url);
        }
        if (token !== renderToken) return;
        image.onload = () => { pixelSize.textContent = image.naturalWidth && image.naturalHeight ? `${image.naturalWidth} × ${image.naturalHeight}px` : ''; };
        image.removeAttribute('src');
        image.alt = current.label;
        image.src = displayedUrl;
        if (image.complete) image.onload();
        caption.textContent = current.label;
        counter.textContent = `${requestedIndex + 1} / ${entries.length}`;
        overlay.dataset.currentMediaUrl = displayedUrl;
        delete overlay.dataset.pendingMediaUrl;
        overlay.classList.remove('is-switching');
        if (current.url && current.url !== displayedUrl) {
          overlay.dataset.pendingMediaUrl = current.url;
          try {
            const originalUrl = await preloadLightboxUrl(current.url);
            if (token !== renderToken) return;
            image.removeAttribute('src');
            image.src = originalUrl;
            if (image.complete) image.onload();
            overlay.dataset.currentMediaUrl = originalUrl;
          } catch {
            if (token === renderToken) caption.textContent = `${current.label}（正在显示清晰预览，原图暂未加载）`;
          }
        }
        if (token !== renderToken) return;
        delete overlay.dataset.pendingMediaUrl;
        overlay.classList.remove('is-loading', 'is-switching');
        overlay.removeAttribute('aria-busy');
        if (entries.length > 1) {
          prefetch(entries[nextLightboxIndex(requestedIndex, -1, entries.length)]);
          prefetch(entries[nextLightboxIndex(requestedIndex, 1, entries.length)]);
        }
      })().catch(() => {
        if (token !== renderToken) return;
        caption.textContent = `${current.label}（图片加载失败）`;
        delete overlay.dataset.pendingMediaUrl;
        overlay.classList.remove('is-loading', 'is-switching');
        overlay.removeAttribute('aria-busy');
      });
    };
    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
    const move = direction => { index = nextLightboxIndex(index, direction, entries.length); render(); };
    const onKey = keyEvent => {
      if (keyEvent.key === 'Escape') close();
      else if (keyEvent.key === 'ArrowLeft') move(-1);
      else if (keyEvent.key === 'ArrowRight') move(1);
    };
    overlay.addEventListener('click', clickEvent => { if (clickEvent.target === overlay) close(); });
    overlay.querySelector('.media-lightbox-close').addEventListener('click', close);
    overlay.querySelector('.is-prev').addEventListener('click', () => move(-1));
    overlay.querySelector('.is-next').addEventListener('click', () => move(1));
    overlay.querySelector('[data-media-zoom-in]').addEventListener('click', () => setScale(scale * 1.25));
    overlay.querySelector('[data-media-zoom-out]').addEventListener('click', () => setScale(scale / 1.25));
    overlay.querySelector('[data-media-zoom-reset]').addEventListener('click', resetTransform);
    image.addEventListener('dblclick', event => { event.preventDefault(); setScale(scale > 1 ? 1 : 2, event.clientX, event.clientY); });
    image.addEventListener('wheel', event => {
      event.preventDefault();
      setScale(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    }, { passive: false });
    image.addEventListener('pointerdown', event => {
      if (scale <= 1) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tx: translateX, ty: translateY };
      image.setPointerCapture?.(event.pointerId);
    });
    image.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      event.preventDefault();
      translateX = drag.tx + lightboxPanDelta(event.clientX - drag.x, scale);
      translateY = drag.ty + lightboxPanDelta(event.clientY - drag.y, scale);
      applyTransform();
    });
    image.addEventListener('pointerup', () => { drag = null; });
    image.addEventListener('pointercancel', () => { drag = null; });
    strip.addEventListener('click', stripEvent => {
      const button = stripEvent.target.closest?.('[data-lightbox-index]');
      if (!button) return;
      index = Number(button.dataset.lightboxIndex) || 0;
      render();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    render();
  });
}
