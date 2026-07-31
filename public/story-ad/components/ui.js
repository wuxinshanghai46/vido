/** 转义用户或模型返回文本。 */
export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

/** 格式化日期，不制造示例时间。 */
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

/** 返回任务状态的中文标签。 */
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

const GENERATION_STAGE_LABELS = {
  subject_assets: '人物与动物资产',
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
  subject_assets: '项资产', scene_asset: '张场景图', blueprint: '个步骤', storyboard: '个分镜',
  keyframes: '张关键帧', video: '个视频片段', media: '个视频片段', tts: '段配音', compose: '个步骤', full: '个步骤',
};

/** 把后端权威进度整理成所有 V6 页面共用的用户可读状态。 */
export function generationProgressView(bundle = {}) {
  const project = bundle.project || {};
  const progress = bundle.generation?.progress || project.generation_progress || {};
  const status = String(progress.status || project.status || '').toLowerCase();
  const active = Boolean(project.active_generation_id) || ['queued', 'running', 'processing'].includes(status);
  const failed = ['failed', 'blocked'].includes(status) || Boolean(project.error && !active);
  if (!active && !failed) return null;
  const stage = String(progress.stage || project.active_stage || project.stage || 'full').toLowerCase();
  const total = Math.max(1, Number(progress.target_total || progress.total || 1) || 1);
  const completed = Math.max(0, Math.min(total, Number(progress.completed ?? progress.processed ?? 0) || 0));
  const percent = Math.max(0, Math.min(100, Number.isFinite(Number(progress.percent))
    ? Math.round(Number(progress.percent))
    : Math.round((completed / total) * 100)));
  const activeIndexes = Array.isArray(progress.active_indexes)
    ? progress.active_indexes.map(value => Math.round(Number(value) || 0)).filter(value => value > 0).slice(0, 8)
    : [];
  const currentIndex = Math.max(0, Math.round(Number(progress.current_index) || 0));
  const stageLabel = GENERATION_STAGE_LABELS[stage] || '当前任务';
  const unitLabel = GENERATION_UNIT_LABELS[stage] || '项';
  let liveText = '';
  if (activeIndexes.length) liveText = `正在生成第 ${activeIndexes.join('、')} 镜`;
  else if (currentIndex && ['storyboard', 'keyframes', 'video', 'media'].includes(stage)) liveText = `正在生成第 ${currentIndex} 镜`;
  else liveText = progress.phase ? String(progress.phase).replaceAll('_', ' ') : '正在处理';
  return {
    active, failed, stage, stageLabel, unitLabel, total, completed, percent, liveText,
    message: String(progress.message || project.error || `${stageLabel}正在处理中，请保持页面打开。`),
    generationId: String(project.active_generation_id || progress.generation_id || ''),
  };
}

/** 输出跨页面保持可见的生成进度；失败状态也保留明确处理信息。 */
export function generationProgressPanel(bundle = {}) {
  const view = generationProgressView(bundle);
  if (!view) return '';
  return `<section class="project-generation-progress ${view.failed ? 'is-failed' : ''}" role="status" aria-live="polite">
    <div class="project-progress-head"><div><b>${escapeHtml(view.failed ? `${view.stageLabel}需要处理` : `正在生成${view.stageLabel}`)}</b><span>已完成 ${view.completed}/${view.total} ${escapeHtml(view.unitLabel)} · ${escapeHtml(view.liveText)}</span></div><strong>${view.percent}%</strong></div>
    <div class="project-progress-track" aria-hidden="true"><i style="width:${view.percent}%"></i></div>
    <div class="project-progress-foot"><small>${escapeHtml(view.message)}</small>${view.active ? `<button class="btn small danger" type="button" data-cancel-generation data-generation-id="${escapeHtml(view.generationId)}">停止生成</button>` : ''}</div>
  </section>`;
}

/** 显示短时反馈。 */
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

/** 切换按钮忙碌状态。 */
export function setButtonBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.previousText = button.textContent;
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.previousText || button.textContent;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/** 输出没有伪造内容的统一空状态。 */
export function emptyState({ title, body, action = '', actionId = '' }) {
  return `<div class="empty-state">
    <div class="empty-icon" aria-hidden="true">＋</div>
    <b>${escapeHtml(title)}</b>
    <p>${escapeHtml(body)}</p>
    ${action ? `<button class="btn" type="button" ${actionId ? `data-empty-action="${escapeHtml(actionId)}"` : ''}>${escapeHtml(action)}</button>` : ''}
  </div>`;
}

/** 输出真实媒体缩略图或语义占位。 */
export function mediaPreview(item = {}, options = {}) {
  const imageUrl = item.thumbnail_url || item.image_url || item.imageUrl || '';
  const videoUrl = item.video_url || item.videoUrl || '';
  const url = imageUrl || videoUrl || item.media_url || item.url || '';
  const label = options.label || item.name || item.title || '媒体';
  const videoLike = !imageUrl && (Boolean(videoUrl)
    || ['video', 'clip', 'final'].includes(String(item.type || item.kind || '').toLowerCase())
    || /\.(?:mp4|webm|mov)(?:\?|$)/i.test(url));
  if (url && videoLike) {
    return `<video class="media" src="${escapeHtml(url)}" preload="none" ${options.controls ? 'controls' : 'muted'} playsinline aria-label="${escapeHtml(label)}"></video>`;
  }
  if (url) return `<img class="media" src="${escapeHtml(url)}${url.includes('?') ? '&' : '?'}thumb=${options.width || 480}" loading="lazy" alt="${escapeHtml(label)}">`;
  return `<div class="media-placeholder" aria-label="${escapeHtml(label)}"><span>${escapeHtml(options.symbol || '素材')}</span></div>`;
}
