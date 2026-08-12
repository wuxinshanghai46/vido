export function assetPlanBlockedView(eligibility = {}, generationActive = false) {
  const issues = Array.isArray(eligibility.issues) ? eligibility.issues : [];
  const failed = issues.includes('task_current_planning_stage_failed');
  const label = failed ? '人物与场景方案更新失败' : '人物与场景方案需要更新';
  const title = failed ? '重新建立当前内容的人物与场景方案' : '更新当前内容的人物与场景方案';
  const body = failed
    ? '上次方案更新未完成。已成功的人物和场景资产都会保留；重新更新只生成文字方案，不生成图片。'
    : '项目内容或系统规则已有更新。已有的人物和场景资产都会保留；本步只更新文字方案，不生成图片。';
  const button = generationActive ? '正在更新人物与场景方案' : (failed ? '重新更新人物与场景方案' : '更新人物与场景方案');
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag is-danger">${label}</span><h2>${title}</h2><p>${body}</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" data-build-scenes ${generationActive ? 'disabled' : ''}>${button}</button><button class="btn" type="button" disabled>方案更新完成后，再逐个人物确认图片生成</button></div></section>`;
}
