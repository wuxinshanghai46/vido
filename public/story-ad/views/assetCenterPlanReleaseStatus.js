import { createKeyedRequestGuard as makeGuardMap, createPersonPlanRequestGuard as makePersonGuard } from './assetCenterRequestGuard.js?v=20260822-reference-failure-recovery-v148';
export const createPersonPlanRequestGuard = key => makePersonGuard(key);
export const createKeyedRequestGuard = () => makeGuardMap();

export function personPlanBlockedView(eligibility = {}, generationActive = false) {
  const failed = (eligibility.issues || []).includes('task_current_planning_stage_failed');
  const migrationOnly = eligibility.release_migration?.compatible === true && eligibility.release_migration?.migration_required === true;
  if (eligibility.visual_recovery_active === true) return '';
  const label = failed ? '人物方案更新失败' : (migrationOnly ? '方案可安全升级' : '人物方案需要更新');
  const button = generationActive ? (migrationOnly ? '正在升级方案' : '正在更新人物方案')
    : (failed ? '重新更新人物方案' : (migrationOnly ? '升级当前方案' : '更新人物方案'));
  const title = migrationOnly ? '将当前方案升级到运行版本' : `${failed ? '重新建立' : '更新'}当前内容的人物方案`;
  const description = migrationOnly
    ? '版本兼容；本次只升级合同版本，模型调用为 0，不修改现有方案。'
    : '只更新人物文字方案；不修改场景方案、场景图片和人物在场景中的站位绑定，也不会生成图片。';
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag ${migrationOnly ? 'is-info' : 'is-danger'}">${label}</span><h2>${title}</h2><p>${description}</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" data-update-person-plan data-release-migration-only="${migrationOnly}" ${generationActive ? 'disabled' : ''}>${button}</button><button class="btn" type="button" disabled>${migrationOnly ? '升级完成后即可继续' : '文字方案确认后，再单独生成图片'}</button></div></section>`;
}

export function assetPlanBlockedView(eligibility = {}, active = false) { return personPlanBlockedView(eligibility.person || eligibility, active); }
