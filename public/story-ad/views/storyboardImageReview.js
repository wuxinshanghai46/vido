import { elapsedTimeTag, escapeHtml } from '../components/ui.js?v=20260903-production-v421';

export function sketchBatchMarkup(batch = null, total = 0) {
  if (!batch || typeof batch !== 'object') return '';
  const status = String(batch.status || '');
  const active = ['queued', 'running'].includes(status);
  const count = Math.max(0, Number(batch.requested || total) || 0);
  const done = Math.max(0, Math.min(count, Number(batch.processed ?? batch.completed ?? 0) || 0));
  const passed = Math.max(0, Math.min(done, Number(batch.succeeded ?? batch.completed ?? 0) || 0));
  const failed = Math.max(0, done - passed);
  const percent = count ? Math.round((done / count) * 100) : 100;
  const indeterminate = active && (status === 'queued' || percent === 0);
  const title = status === 'failed' ? '分镜生成已停止' : (status === 'succeeded' ? '分镜生成已完成' : '正在生成分镜');
  return `<div class="sketch-batch-progress is-${escapeHtml(status)} ${indeterminate ? 'is-indeterminate' : ''}" role="${status === 'failed' ? 'alert' : 'status'}" aria-live="polite">
<div class="sketch-batch-progress-head"><b>${title}</b><span>已处理 ${done}/${count} · 通过 ${passed}/${count}${failed ? ` · ${failed} 镜未通过` : ''}</span></div>
    ${active ? `<div class="project-progress-track ${indeterminate ? 'is-indeterminate' : ''}" aria-hidden="true"><i style="width:${percent}%"></i></div>` : ''}
<small>${status === 'failed' ? '已有画面保留，继续时只补未完成镜头。' : (active ? '完成的画面会逐镜显示。' : '所有画面已保存。')} ${elapsedTimeTag({ startedAt: batch.started_at, finishedAt: batch.finished_at, active })}</small>
    ${(batch.failures || []).map(item => `<small>第 ${Number(item.shot_index)} 镜：${escapeHtml(item.message || '质检未通过')}</small>`).join('')}
</div>`;
}
