import { escapeHtml } from '../components/ui.js?v=20260823-voice-outfit-library-v192';
export function personPlanBlockedView(e={}, active=false, failure={}) {
  const failed=(e.issues||[]).includes('task_current_planning_stage_failed'), migration=e.release_migration?.compatible===true&&e.release_migration?.migration_required===true;
  if (e.visual_recovery_active === true) return '';
  const title=failed?'重新生成人物方案':'生成人物方案', button=active?'正在生成人物方案…':title;
  const copy=migration?'系统会复用兼容方案并生成缺失的人物图片，不重复修改已确认的人物设定。':'系统会根据已确认剧情和现有人物资产补全详细人物方案，并继续生成缺失的人物图片。';
  const safeError=failed?'<p class="asset-plan-failure"><b>人物方案暂未完成。</b> 已保存的人物身份和现有资产不会丢失；缺少的是待生成的人物图片，不是系统找不到同一个人物。请稍后从这里重新生成。</p>':'';
  const diagnostics=failed&&failure.isAdmin&&failure.diagnostics?`<details class="asset-plan-admin-diagnostics"><summary>技术详情（仅超管）</summary><div><b>${escapeHtml(failure.diagnostics.error_code||'生成失败')}</b><p>${escapeHtml(failure.diagnostics.error||'暂无错误说明')}</p>${failure.diagnostics.support_id?`<small>支持编号：${escapeHtml(failure.diagnostics.support_id)}</small>`:''}</div></details>`:'';
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><h2>${title}</h2><p>${copy}</p>${safeError}${diagnostics}</div><div class="asset-visual-next-actions"><button class="btn${active ? '' : ' primary'}" data-update-person-plan data-release-migration-only="${migration}" ${active ? 'disabled' : ''}>${button}</button></div></section>`;
}
export function assetPlanBlockedView(eligibility={}, active=false) { return personPlanBlockedView(eligibility.person || eligibility, active); }
