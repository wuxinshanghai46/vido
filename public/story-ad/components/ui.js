

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
  production_assets: '全部制作资产', visual_assets: '人物与场景视觉资产',
  person_provider_sync: '人物 ID 与 Seedance 同步',
  product_asset: '商品资产',
  prop_asset: '人物随身道具',
  person_plan: '人物方案与人物图片',
  scene_config: '人物与场景方案',
  scene_asset: '场景视图',
  scene_qa: '场景审核',
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
  person_plan: '个人物', subject_assets: '项资产', production_assets: '个制作单元', visual_assets: '个本批目标', person_provider_sync: '个人物', product_asset: '项商品', prop_asset: '项道具', scene_asset: '张场景图', scene_qa: '个场景', blueprint: '个步骤', storyboard: '个分镜',
  keyframes: '张关键帧', video: '个视频片段', media: '个视频片段', tts: '段配音', compose: '个步骤', full: '个步骤',
};

const GENERATION_STAGE_OWNING_VIEW = Object.freeze({
  subject_assets: 'assets',
  production_assets: 'assets', visual_assets: 'assets',
  person_provider_sync: 'assets',
  product_asset: 'assets',
  prop_asset: 'assets',
  scene_config: 'brief',
  person_plan: 'assets',
  scene_plan: 'scene',
  person_sheet: 'assets',
  person_dossier: 'assets',
  scene_asset: 'scene',
  scene_qa: 'scene',
  scene_panorama: 'scene',
  blueprint: 'plot',
  script_package: 'plot',
  storyboard: 'storyboard',
  keyframe: 'final',
  keyframes: 'final',
  keyframe_contract: 'final',
  video: 'final',
  video_repair: 'final',
  media: 'final',
  tts: 'final',
  compose: 'final',
  final_video: 'final',
  full: 'final',
});

export function normalizeGenerationStage(stage = '') {
  let value = String(stage || '').trim().toLowerCase().replace(/^new_story_ad\./, '');
  let previous = '';
  while (value && value !== previous) {
    previous = value;
    value = value.replace(/_(?:queued|running|failed|done|ready|partial|cancelled)$/, '');
  }
  return value;
}

export function generationProgressOwningView(stage = '') {
  return GENERATION_STAGE_OWNING_VIEW[normalizeGenerationStage(stage)] || '';
}

export function publicGenerationMessage(value = '', options = {}) {
  const text = String(value || '').trim();
  if (!text) return options.fallback || '';
  if (/计费|billing/i.test(text)) return '生成已暂停，成功资产已保留；计费状态核对完成前不会重复提交。';
  if (/审核|audit|content.?policy|safety/i.test(text)) return '当前内容未通过生成规则检查，请调整素材或描述后再试。';
  if (/供应商|provider|model|模型|http\s*5\d\d|support|支持编号|task.?id|request.?id|sk-[a-z0-9]/i.test(text)) return '本次生成未完成，成功资产已保留。请稍后从缺失项继续。';
  return text.replace(/(?:支持编号|任务编号|请求编号|task.?id|request.?id)\s*[:：]\s*[\w-]+/gi, '').trim()
    || options.fallback || '本次生成未完成，成功资产已保留。';
}

function blueprintQualityFailureMessage(value = '') {
  const text = String(value || '');
  const opener = /多镜重复以“([^”]+)”开头/.exec(text);
  return opener
    ? `脚本初稿已经保留，但有多段使用相同开头“${opener[1]}”，系统没有让重复表达进入后续制作。`
    : '脚本初稿已经保留，但部分镜头的剧情推进或声音表达还不完整，系统没有让不完整内容进入后续制作。';
}

export function checkpointRecoveryView(bundle = {}) {
  const people = Array.isArray(bundle.assets?.people) ? bundle.assets.people : [];
  const rows = people.filter(item => item.checkpoint_recovery_summary);
  const completed = rows.reduce((sum, item) => sum + Number(item.checkpoint_recovery_summary.completed_units || 0), 0);
  const total = rows.reduce((sum, item) => sum + Number(item.checkpoint_recovery_summary.total_units || 0), 0);
  const missing = rows.flatMap(item => (item.checkpoint_recovery_summary.missing_units || []).map(unit => ({
    person_name: item.name || '人物', label: unit.label || unit.unit || unit.key || '缺失单元',
    reason: unit.reason || '未完成', error_code: unit.error_code || 'UNKNOWN', retry_blocked: unit.retry_blocked === true,
  })));
  return total && missing.length ? { completed, total, missing, retryBlocked: missing.some(unit => unit.retry_blocked) } : null;
}

export function generationProgressView(bundle = {}) {
  const project = bundle.project || {};
  const progress = bundle.generation?.progress || project.generation_progress || {};
  const hasActiveIdentity = Boolean(project.active_generation_id || Object.keys(project.active_target_generations || {}).length);
  const projectStatus = String(project.status || '').toLowerCase();
  const projectTerminal = !hasActiveIdentity && ['failed', 'blocked', 'done', 'completed', 'succeeded', 'cancelled'].includes(projectStatus);
  const status = String(projectTerminal ? projectStatus : (progress.status || project.status || '')).toLowerCase();
  const active = hasActiveIdentity || (!projectTerminal && ['queued', 'running', 'processing'].includes(status));
  const failed = !active && (['failed', 'blocked'].includes(status) || Boolean(project.error));
  if (!active && !failed) return null;
  const stage = normalizeGenerationStage(progress.stage || project.active_stage || project.stage || 'full') || 'full';
  const checkpointRecovery = checkpointRecoveryView(bundle);
  const total = checkpointRecovery?.total || Math.max(1, Math.floor(Number(progress.target_total || progress.total || 1) || 1));
  const processed = checkpointRecovery?.completed ?? Math.floor(Math.max(0, Math.min(total, Number(progress.processed ?? progress.completed ?? 0) || 0)));
  const failedCount = checkpointRecovery
    ? Math.max(0, checkpointRecovery.total - checkpointRecovery.completed)
    : Math.floor(Math.max(0, Math.min(processed, Number(progress.failed ?? progress.qa_failed ?? progress.units_failed ?? 0) || 0)));
  const succeededCount = checkpointRecovery?.completed
    ?? Math.floor(Math.max(0, Math.min(processed, Number.isFinite(Number(progress.succeeded))
      ? Number(progress.succeeded)
      : processed - failedCount)));
  const percent = checkpointRecovery
    ? Math.round((processed / total) * 100)
    : Math.max(0, Math.min(100, Number.isFinite(Number(progress.percent))
      ? Math.round(Number(progress.percent))
      : Math.round((processed / total) * 100)));
  const activeIndexes = Array.isArray(progress.active_indexes)
    ? progress.active_indexes.map(value => Math.round(Number(value) || 0)).filter(value => value > 0).slice(0, 8)
    : [];
  const currentIndex = Math.max(0, Math.round(Number(progress.current_index) || 0));
  const stageLabel = GENERATION_STAGE_LABELS[stage] || '当前任务';
  const unitLabel = GENERATION_UNIT_LABELS[stage] || '项';
  const progressMatchesActive = !project.active_generation_id || !progress.generation_id
    || String(project.active_generation_id) === String(progress.generation_id);
  const startedAt = String(progressMatchesActive ? (progress.started_at || '') : '');
  const finishedAt = String(progress.finished_at || '');
  const failureCode = String(progress.error_code || project.error_code || '').toUpperCase();
  const failureText = String(progress.message || project.error || '');
  const billingUnknown = checkpointRecovery?.retryBlocked === true || progress.billing_state === 'unknown' || /billing(?:_| )state[^\n]*unknown|计费状态[^\n]*未知/i.test(failureText);
  let failureTitle = stage === 'scene_config' ? `${stageLabel}更新失败` : `${stageLabel}生成失败`;
  if (failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED') failureTitle = '脚本初稿需要调整';
  else if (failureCode === 'PROVIDER_CONTENT_AUDIT') failureTitle = `${stageLabel}内容审核未通过`;
  else if (progress.phase === 'review_failed' || /(?:QUALITY|QA|REVIEW).*FAILED/.test(failureCode)) failureTitle = `${stageLabel}质量审核未通过`;
  else if (billingUnknown) failureTitle = `${stageLabel}生成中断（计费待核对）`;
  else if (/TIMEOUT|NETWORK|IMAGE_ATTEMPTS_EXHAUSTED/.test(failureCode) || /upstream connect error|connection termination|reset before headers/i.test(failureText)) failureTitle = `${stageLabel}生成中断（模型连接失败）`;
  let liveText = '';
  if (failed && stage === 'scene_config') liveText = '资产已保留，请更新方案';
  else if (failed && failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED') liveText = '脚本初稿已保存，可从当前初稿继续检查';
  else if (failed) liveText = checkpointRecovery
    ? `已保留 ${checkpointRecovery.completed}/${checkpointRecovery.total} 项人物图片；${billingUnknown ? '核对计费前不会重复调用' : '仅处理缺失项'}`
    : (billingUnknown ? '已保留成功资产，核对计费前不会重复调用' : '已保留成功资产，可从缺失项继续');
  else if (activeIndexes.length) liveText = ['person_plan', 'subject_assets', 'person_sheet', 'person_dossier'].includes(stage)
    ? `正在并行处理第 ${activeIndexes.join('、')} 个人物`
    : `正在生成第 ${activeIndexes.join('、')} 镜`;
  else if (currentIndex && ['storyboard', 'keyframes', 'video', 'media'].includes(stage)) liveText = `正在生成第 ${currentIndex} 镜`;
  else liveText = progress.phase ? String(progress.phase).replaceAll('_', ' ') : '正在处理';
  return {
    active, failed, stage, stageLabel, unitLabel, total, completed: processed, processed, succeededCount, failedCount, percent, liveText, failureTitle,
    lanes: progress.lanes && typeof progress.lanes === 'object' ? progress.lanes : null,
    message: failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED'
      ? blueprintQualityFailureMessage(failureText)
      : failed && stage === 'scene_config'
      ? '方案更新失败，资产已保留。'
      : publicGenerationMessage(progress.message || project.error, { fallback: `${stageLabel}正在处理中，请保持页面打开。` }),
    generationId: String(project.active_generation_id || progress.generation_id || ''),
    startedAt, checkpointRecovery,
    finishedAt,
  };
}

export function generationProgressPanel(bundle = {}, currentView = '') {
  const view = generationProgressView(bundle);
  if (!view) return '';
  if (currentView === 'scene' && ['scene_asset', 'scene_qa'].includes(view.stage)) return '';
  const owningView = generationProgressOwningView(view.stage);
  if (currentView && view.failed && !owningView) return '';
  if (currentView && owningView && currentView !== owningView) return '';
  if (currentView === 'assets' && view.checkpointRecovery) return '';
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
  const checkpointRows = view.checkpointRecovery ? `<div class="generation-lanes" data-checkpoint-recovery-details>${view.checkpointRecovery.missing.map(unit => `<div><span><b>${escapeHtml(unit.person_name)} · ${escapeHtml(unit.label)}</b><small>${escapeHtml(unit.reason)}</small></span><strong>${unit.retry_blocked ? '平台核账中' : '待处理'}</strong></div>`).join('')}</div>` : '';
  if (view.failed) {
    const retained = laneRows || checkpointRows || recovery
      ? `<details class="project-progress-details"><summary>查看已保留内容</summary>${checkpointRows}${laneRows}${recovery && !view.checkpointRecovery?.retryBlocked ? `<div class="project-progress-foot">${recovery}</div>` : ''}</details>`
      : '';
    const terminalCounts = view.failedCount > 0
      ? `<span>处理 ${view.processed}/${view.total}：成功 ${view.succeededCount}，失败 ${view.failedCount}</span>`
      : '';
    return `<section class="project-generation-progress is-failed is-terminal" role="alert">
      <div class="project-progress-head"><div><b>${escapeHtml(view.failureTitle)}</b><span>${escapeHtml(view.liveText)}</span>${terminalCounts}</div><span class="status-tag is-danger">已停止</span></div>
      ${retained}
    </section>`;
  }
  const outcomeCounts = view.failedCount > 0 ? ` · 成功 ${view.succeededCount}，失败 ${view.failedCount}` : '';
  return `<section class="project-generation-progress ${view.failed ? 'is-failed' : ''}" role="status" aria-live="polite">
    <div class="project-progress-head"><div><b>${escapeHtml(view.failed ? `${view.stageLabel}需要处理` : `正在生成${view.stageLabel}`)}</b><span>处理进度 ${view.processed}/${view.total} ${escapeHtml(view.unitLabel)}${outcomeCounts} · ${escapeHtml(view.liveText)}</span></div><span class="project-progress-stats">${elapsedTimeTag({ startedAt: view.startedAt, finishedAt: view.finishedAt, active: view.active })}<strong>处理进度 ${view.percent}%</strong></span></div>
    <div class="project-progress-track" aria-hidden="true"><i style="width:${view.percent}%"></i></div>${laneRows}
    <div class="project-progress-foot"><small>${escapeHtml(view.message)}</small>${view.active ? `<button class="btn small danger" type="button" data-cancel-generation data-generation-id="${escapeHtml(view.generationId)}">停止生成</button>` : ''}</div>
  </section>`;
}

export function syncInlineGenerationProgress(bundle = {}, scope = document) {
  const view = generationProgressView(bundle), allowed = ['person_plan', 'subject_assets', 'person_sheet', 'person_dossier'].includes(view?.stage || '');
  scope.querySelectorAll?.('[data-person-plan-inline-progress]').forEach(host => {
    const active = Boolean(view?.active && allowed); host.hidden = !active;
    if (!active) return;
    const percent = Math.max(2, Math.min(99, Number(view.percent || 0))); host.setAttribute('aria-valuenow', String(percent));
    const fill = host.querySelector('i'); if (fill) fill.style.width = `${percent}%`;
    const label = host.querySelector('[data-person-plan-progress-label]'); if (label) label.textContent = `${percent}% · ${view.liveText || '正在处理'}`;
  });
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
  const sourceImageUrl = item.image_url || item.imageUrl || item.cover_image_url || '';
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
    const bucketWidth = value => [240, 320, 480, 640, 960, 1280, 1600].find(size => size >= Math.max(120, Number(value) || 480)) || 1600;
    const variantUrl = (value, width) => `${value}${value.includes('?') ? '&' : '?'}thumb=${bucketWidth(width)}&format=webp`;
    const previewUrl = variantUrl(url, options.width || 480);
    const zoomUrl = options.zoomWidth ? variantUrl(sourceImageUrl || url, options.zoomWidth) : (sourceImageUrl || url);
    const loading = options.loading === 'eager' ? 'eager' : 'lazy';
    const priority = options.fetchPriority === 'high' ? ' fetchpriority="high"' : '';
    const image = `<img class="media" src="${escapeHtml(previewUrl)}" loading="${loading}" decoding="async"${priority} alt="${escapeHtml(label)}">`;
    if (options.zoomable === true) {
      return `<button class="media-zoom-trigger" type="button" data-media-zoom-url="${escapeHtml(zoomUrl)}" data-media-preview-url="${escapeHtml(previewUrl)}" data-media-zoom-label="${escapeHtml(label)}" data-media-zoom-group="${escapeHtml(options.zoomGroup || 'media')}">${image}<span aria-hidden="true">⌕</span></button>`;
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
