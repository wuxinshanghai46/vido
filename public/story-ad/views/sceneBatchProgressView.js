import { elapsedTimeTag, escapeHtml } from '../components/ui.js?v=20260829-production-v266';

const count = value => Math.max(0, Math.floor(Number(value) || 0));

export function sceneBatchProgressMarkup(progress = {}) {
  if (progress.mode !== 'scene_batch') return '';
  const total = count(progress.image_target_total),
    processed = Math.min(total || Infinity, count(progress.image_processed)),
    percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 100,
    phase = progress.phase || 'generation',
    stopped = progress.status === 'failed' || phase === 'stopped',
    state = stopped ? '已停止' : (phase === 'verification' ? '审核中' : '生成中'),
    elapsed = elapsedTimeTag({ startedAt: progress.started_at, finishedAt: progress.finished_at, active: !stopped && !progress.finished_at }),
    position = [progress.current_scene_name, progress.current_view_label].filter(Boolean).map(escapeHtml).join(' · ');
  return `<div class="scene-batch-live-progress" aria-live="polite"><b>Image</b><span>${processed}/${total} · ${percent}%${position ? ` · ${position}` : ''} · ${state}${elapsed ? ` · ${elapsed}` : ''}</span><i aria-hidden="true"><b style="width:${percent}%"></b></i></div>`;
}
