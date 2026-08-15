import { escapeHtml } from '../components/ui.js?v=20260815-asset-v70';

export function checkpointRecoverySummary(people = []) {
  const rows = people.filter(item => item.checkpoint_recovery_summary);
  const sum = key => rows.reduce((value, item) => value + Number(item.checkpoint_recovery_summary[key] || 0), 0);
  const missing = rows.flatMap(item => (item.checkpoint_recovery_summary.missing_units || []).map(unit => ({ ...unit, person_name: item.name || '人物' })));
  return { completed: sum('completed_units'), total: sum('total_units'), missing, retry_blocked: missing.some(unit => unit.retry_blocked) };
}

export function checkpointRecoveryBanner(summary = {}) {
  if (!summary.total || !summary.missing.length) return '';
  const people = [...summary.missing.reduce((groups, unit) => {
    const name = unit.person_name || '人物';
    const row = groups.get(name) || { name, units: [], reason: '' };
    row.units.push(unit.label || unit.unit || unit.key || '缺失单元');
    row.reason ||= unit.reason;
    groups.set(name, row);
    return groups;
  }, new Map()).values()];
  return `<section class="card asset-checkpoint-recovery" data-checkpoint-recovery-banner role="alert"><header><div><span class="status-tag is-warning">平台核账中</span><h2>人物图片已生成 ${summary.completed}/${summary.total}</h2><p>剩余 ${summary.missing.length} 项由平台核对，无需点击；计费核对完成前不能再次生成。已生成图片可正常查看。</p></div><a class="btn" href="#asset-section-people">查看已生成图片</a></header><div class="asset-checkpoint-track"><i style="width:${Math.round(summary.completed / summary.total * 100)}%"></i></div><ul>${people.map(person => `<li><b>${escapeHtml(person.name)}</b><span>缺少：${escapeHtml(person.units.join('、'))}</span><small>${escapeHtml(person.reason || '平台正在核对')}</small></li>`).join('')}</ul></section>`;
}
