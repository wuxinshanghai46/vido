import { escapeHtml } from '../components/ui.js?v=20260815-asset-v69';

export function checkpointRecoverySummary(people = []) {
  const rows = people.filter(item => item.checkpoint_recovery_summary);
  const completed = rows.reduce((sum, item) => sum + Number(item.checkpoint_recovery_summary.completed_units || 0), 0);
  const total = rows.reduce((sum, item) => sum + Number(item.checkpoint_recovery_summary.total_units || 0), 0);
  const missing = rows.flatMap(item => (item.checkpoint_recovery_summary.missing_units || []).map(unit => ({ ...unit, person_name: item.name || '人物' })));
  return { completed, total, missing, retry_blocked: missing.some(unit => unit.retry_blocked) };
}

export function checkpointRecoveryBanner(summary = {}) {
  if (!summary.total || !summary.missing.length) return '';
  return `<section class="card asset-checkpoint-recovery ${summary.retry_blocked ? 'is-blocked' : ''}" data-checkpoint-recovery-banner>
    <div><span class="status-tag ${summary.retry_blocked ? 'is-warning' : ''}">人物图片已保留 ${summary.completed}/${summary.total}</span><h2>${summary.retry_blocked ? '缺失项正在等待计费核对' : '人物图片仍有缺失项'}</h2><p>${summary.retry_blocked ? '这些单元已提交供应商，但结果或计费状态未知。为避免重复付费，系统不会自动重试。' : '成功图片已保留，只处理下列缺失项。'}</p></div>
    <ul>${summary.missing.map(unit => `<li><b>${escapeHtml(unit.person_name)} · ${escapeHtml(unit.label || unit.unit || unit.key)}</b><span>${escapeHtml(unit.reason || '未完成')}（${escapeHtml(unit.error_code || 'UNKNOWN')}）</span></li>`).join('')}</ul>
  </section>`;
}
