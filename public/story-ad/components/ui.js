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
  const url = item.thumbnail_url || item.image_url || item.imageUrl || item.video_url || item.videoUrl || item.url || '';
  const label = options.label || item.name || item.title || '媒体';
  if (url && /\.(?:mp4|webm|mov)(?:\?|$)/i.test(url)) {
    return `<video class="media" src="${escapeHtml(url)}" preload="metadata" muted playsinline aria-label="${escapeHtml(label)}"></video>`;
  }
  if (url) return `<img class="media" src="${escapeHtml(url)}${url.includes('?') ? '&' : '?'}thumb=${options.width || 480}" loading="lazy" alt="${escapeHtml(label)}">`;
  return `<div class="media-placeholder" aria-label="${escapeHtml(label)}"><span>${escapeHtml(options.symbol || '素材')}</span></div>`;
}
