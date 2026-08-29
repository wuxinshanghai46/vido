import { personPlanTechnicalDetails } from './assetCenterTechnicalDetails.js?v=20260829-production-v269';
export function personPlanBlockedView(e={}, active=false, failure={}) {
  const failed=(e.issues||[]).includes('task_current_planning_stage_failed'), migration=e.release_migration?.compatible===true&&e.release_migration?.migration_required===true;
  if (e.visual_recovery_active === true) return '';
  const title=failed?'重新生成人物方案':'生成人物方案', button=active?'正在生成人物方案…':title;
  const technical=personPlanTechnicalDetails({migration,failed,isAdmin:failure.isAdmin,diagnostics:failure.diagnostics});
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><h2>${title}</h2>${technical}</div><div class="asset-visual-next-actions"><button class="btn${active ? '' : ' primary'}" data-update-person-plan data-release-migration-only="${migration}" ${active ? 'disabled' : ''}>${button}</button></div></section>`;
}
export function assetPlanBlockedView(eligibility={}, active=false) { return personPlanBlockedView(eligibility.person || eligibility, active); }
