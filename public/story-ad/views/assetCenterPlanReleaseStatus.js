export function createPersonPlanRequestGuard(requestKey = '') {
  let active = false;
  return { get active() { return active; }, async run(operation) {
    if (active) return { skipped: true, request_key: requestKey };
    active = true;
    try { return await operation(requestKey); } finally { active = false; }
  } };
}

export function personPlanBlockedView(eligibility = {}, generationActive = false) {
  const failed = (eligibility.issues || []).includes('task_current_planning_stage_failed');
  const migrationOnly = eligibility.release_migration?.compatible === true && eligibility.release_migration?.migration_required === true;
  const label = failed ? '人物方案更新失败' : (migrationOnly ? '方案可安全升级' : '人物方案需要更新');
  const button = generationActive ? (migrationOnly ? '正在升级方案' : '正在更新人物方案')
    : (failed ? '重新更新人物方案' : (migrationOnly ? '升级当前方案' : '更新人物方案'));
  const title = migrationOnly ? '将当前方案升级到运行版本' : `${failed ? '重新建立' : '更新'}当前内容的人物方案`;
  const description = migrationOnly
    ? '合同、内容版本、故事覆盖和稳定 ID 均兼容；本次只升级版本，模型调用为 0，不修改现有方案。'
    : '本次只更新人物文字方案，不修改场景方案、场景图片和人物在场景中的站位绑定，也不会生成图片。';
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag ${migrationOnly ? 'is-info' : 'is-danger'}">${label}</span><h2>${title}</h2><p>${description}</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" data-update-person-plan data-release-migration-only="${migrationOnly}" ${generationActive ? 'disabled' : ''}>${button}</button><button class="btn" type="button" disabled>${migrationOnly ? '升级完成后即可继续' : '文字方案确认后，再单独生成图片'}</button></div></section>`;
}

export function assetPlanBlockedView(eligibility = {}, generationActive = false) {
  return personPlanBlockedView(eligibility.person || eligibility, generationActive);
}
