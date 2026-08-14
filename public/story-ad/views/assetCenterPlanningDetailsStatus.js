export function personPlanBlockedView(eligibility = {}, generationActive = false) {
  const failed = (eligibility.issues || []).includes('task_current_planning_stage_failed');
  const label = failed ? '人物方案更新失败' : '人物方案需要更新';
  const button = generationActive ? '正在更新人物方案' : (failed ? '重新更新人物方案' : '更新人物方案');
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag is-danger">${label}</span><h2>${failed ? '重新建立' : '更新'}当前内容的人物方案</h2><p>本次只更新人物文字方案，不修改场景方案、场景图片和人物在场景中的站位绑定，也不会生成图片。</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" data-update-person-plan ${generationActive ? 'disabled' : ''}>${button}</button><button class="btn" type="button" disabled>文字方案确认后，再单独生成图片</button></div></section>`;
}

export function assetPlanBlockedView(eligibility = {}, generationActive = false) {
  return personPlanBlockedView(eligibility.person || eligibility, generationActive);
}
