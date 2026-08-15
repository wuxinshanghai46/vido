import { escapeHtml } from '../components/ui.js?v=20260815-asset-v71';

export function checkpointRecoverySummary(people = []) {
  const rows = people.filter(item => item.checkpoint_recovery_summary);
  const sum = key => rows.reduce((value, item) => value + Number(item.checkpoint_recovery_summary[key] || 0), 0);
  const missing = rows.flatMap(item => (item.checkpoint_recovery_summary.missing_units || []).map(unit => ({ ...unit, person_name: item.name || '人物' })));
  return { completed: sum('completed_units'), total: sum('total_units'), missing, retry_blocked: missing.some(unit => unit.retry_blocked) };
}

export function checkpointRecoveryBanner(summary = {}) {
  if (!summary.total || !summary.missing.length) return '';
  const people = [...summary.missing.reduce((map, unit) => {
    const n = unit.person_name || '人物';
    const row = map.get(n) || { name: n, units: [], reason: '' };
    row.units.push(unit.label || unit.unit || unit.key);
    row.reason ||= unit.reason;
    map.set(n, row);
    return map;
  }, new Map()).values()];
  return `<section class="card asset-checkpoint-recovery" data-checkpoint-recovery-banner role="alert"><header><div class="asset-recovery-copy"><span class="asset-recovery-state"><i></i>平台核账中</span><h3>人物图片已暂停</h3><p>剩余 ${summary.missing.length} 项待平台核对。无需操作；计费安全确认前不能再次生成。</p></div><div class="asset-recovery-metric"><h2><strong>${summary.completed}/${summary.total}</strong><span>已保留</span></h2></div><a class="btn asset-recovery-action" href="#asset-section-people">查看人物图片</a></header><div class="asset-recovery-list-head"><h3>待平台核对</h3><span>${summary.missing.length} 项</span></div><ul>${people.map(person => `<li><div><b>${escapeHtml(person.name)}</b><span>缺少：${escapeHtml(person.units.join('、'))}</span></div><em>待核对</em><p>${escapeHtml(person.reason || '平台核对中')}</p></li>`).join('')}</ul></section>`;
}
