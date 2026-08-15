export function renderCheckpointRecoveryBanner(summary = {}, escapeHtml = value => String(value || '')) {
  if (!summary.total || !summary.missing.length) return '';
  const people = [...summary.missing.reduce((map, unit) => {
    const n = unit.person_name || '人物';
    const row = map.get(n) || { name: n, units: [], reason: '' };
    row.units.push(unit.label || unit.unit || unit.key); row.reason ||= unit.reason; map.set(n, row); return map;
  }, new Map()).values()];
  const state = summary.billing_review_state || 'pending';
  const planBlocked = summary.plan_eligible === false;
  const copy = planBlocked
    ? { badge: '先同步人物方案', title: '人物方案更新后继续缺失图片', detail: `当前方案未通过生成许可。请先更新人物方案；完成后系统会重新核对已保留图片，兼容时自动切换为“生成剩余 ${summary.missing.length} 项”。`, action: '先更新人物方案', attr: 'data-update-person-plan data-release-migration-only="false"' }
    : state === 'not_billed'
    ? { badge: '核账已完成', title: '剩余图片可以安全继续', detail: `已确认剩余 ${summary.missing.length} 项未计费，只生成缺失项。`, action: `生成剩余 ${summary.missing.length} 项`, attr: 'data-generate-recovery' }
    : (state === 'unverifiable'
      ? { badge: '核账无法确认', title: '需要你确认计费风险', detail: `继续最多 ${summary.missing.length} 次重复计费；已有图片不会重提。`, action: `接受 ${summary.missing.length} 项风险并继续`, attr: 'data-accept-billing-risk' }
      : { badge: '平台核账中', title: '人物图片已暂停', detail: `剩余 ${summary.missing.length} 项待平台核对；核账完成前不能授权或生成。`, action: '查看核账进度', attr: 'data-billing-review data-recovery-next-step' });
  const rows = people.map(person => `<li><div><b>${escapeHtml(person.name)}</b><span>缺少：${escapeHtml(person.units.join('、'))}</span></div><em>${state === 'pending' ? '待核对' : (state === 'unverifiable' ? '需确认' : '可继续')}</em><p>${escapeHtml(person.reason || '平台核对中')}</p></li>`).join('');
  return `<section class="card asset-checkpoint-recovery" data-checkpoint-recovery-banner data-review-state="${state}" data-plan-eligible="${summary.plan_eligible !== false}" data-recovery-stage="${planBlocked ? 'plan' : 'billing'}" data-recovery-count="${summary.missing.length}" role="alert"><header><div class="asset-recovery-copy"><span class="asset-recovery-state"><i></i>${copy.badge}</span><h3>${copy.title}</h3><p>${copy.detail}</p></div><div class="asset-recovery-metric"><h2><strong>${summary.completed}/${summary.total}</strong><span>已保留</span></h2></div><button class="btn asset-recovery-action" type="button" ${copy.attr}>${copy.action}</button></header><div class="asset-recovery-list-head"><h3>剩余待处理</h3><span>${summary.missing.length} 项</span></div><ul>${rows}</ul></section>`;
}
