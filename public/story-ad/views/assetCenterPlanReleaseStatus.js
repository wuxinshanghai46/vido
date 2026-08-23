import { escapeHtml } from '../components/ui.js?v=20260823-character-library-v187';
export { createKeyedRequestGuard, createPersonPlanRequestGuard } from './assetCenterRequestGuard.js?v=20260823-character-library-v187';
export function personPlanBlockedView(e={}, active=false, failure={}) {
  const failed=(e.issues||[]).includes('task_current_planning_stage_failed'), migration=e.release_migration?.compatible===true&&e.release_migration?.migration_required===true;
  if (e.visual_recovery_active === true) return '';
  const title=failed?'重新生成人物方案':'生成人物方案', button=active?'正在生成人物方案…':title;
  const copy=migration?'系统会复用兼容方案并生成缺失的人物图片，不重复修改已确认的人物设定。':'系统会根据已确认剧情和现有人物资产补全详细人物方案，并继续生成缺失的人物图片。';
  const error=failed&&failure.message?`<p class="asset-plan-failure"><b>上次停止在人物方案模型：</b>${escapeHtml(String(failure.message).replace(/^支持编号：[^。]+。/, ''))}<br><small>现有人物身份仍保留；当前缺少的是尚未生成的人物图片，不是系统找不到同一个人物。支持编号：${escapeHtml(failure.supportId||'—')}</small></p>`:'';
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><h2>${title}</h2><p>${copy}</p>${error}</div><div class="asset-visual-next-actions"><button class="btn${active ? '' : ' primary'}" data-update-person-plan data-release-migration-only="${migration}" ${active ? 'disabled' : ''}>${button}</button></div></section>`;
}
export function assetPlanBlockedView(eligibility={}, active=false) { return personPlanBlockedView(eligibility.person || eligibility, active); }
