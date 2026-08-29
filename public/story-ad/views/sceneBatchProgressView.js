import { elapsedTimeTag, escapeHtml } from '../components/ui.js?v=20260829-production-v260d';

function count(value = 0) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

export function sceneBatchProgressMarkup(progress = {}) {
  if (String(progress.mode || '') !== 'scene_batch') return '';
  const total = count(progress.image_target_total);
  const processed = Math.min(total || Number.MAX_SAFE_INTEGER, count(progress.image_processed));
  const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 100;
  const phase = String(progress.phase || 'generation');
  const stopped = String(progress.status || '') === 'failed' || phase === 'stopped';
  const state = stopped ? '已停止' : (phase === 'verification' ? '审核中' : '生成中');
  const active = !stopped && !progress.finished_at;
  const elapsed = elapsedTimeTag({ startedAt: progress.started_at, finishedAt: progress.finished_at, active });
  return `<div class="scene-batch-live-progress" role="status" aria-live="polite" data-scene-batch-progress>
    <b>Image</b><span>${processed}/${total || 0} · ${percent}% · ${escapeHtml(state)}${elapsed ? ` · ${elapsed}` : ''}</span>
    <i aria-hidden="true"><b style="width:${percent}%"></b></i>
  </div>`;
}
