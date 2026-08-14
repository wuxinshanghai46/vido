function blockedView(domain, eligibility = {}, generationActive = false) {
  const isPerson = domain === 'person';
  const issues = Array.isArray(eligibility.issues) ? eligibility.issues : [];
  const failed = issues.includes('task_current_planning_stage_failed');
  const noun = isPerson ? '人物方案' : '场景方案';
  const label = failed ? `${noun}更新失败` : `${noun}需要更新`;
  const title = failed ? `重新建立当前内容的${noun}` : `更新当前内容的${noun}`;
  const body = isPerson
    ? '本次只更新人物文字方案，不修改场景方案、场景图片和人物在场景中的站位绑定，也不会生成图片。'
    : '本次只更新场景文字方案，不修改人物身份、人物图片和人物造型；已有站位绑定无法安全延续时会阻止发布，也不会生成图片。';
  const button = generationActive ? `正在更新${noun}` : (failed ? `重新更新${noun}` : `更新${noun}`);
  const action = isPerson ? 'data-update-person-plan' : 'data-update-scene-plan';
  return `<section class="card asset-visual-next-step is-blocked" role="status"><div><span class="status-tag is-danger">${label}</span><h2>${title}</h2><p>${body}</p></div><div class="asset-visual-next-actions"><button class="btn${generationActive ? '' : ' primary'}" type="button" ${action} ${generationActive ? 'disabled' : ''}>${button}</button><button class="btn" type="button" disabled>文字方案确认后，再单独生成图片</button></div></section>`;
}

export function personPlanBlockedView(eligibility = {}, generationActive = false) {
  return blockedView('person', eligibility, generationActive);
}

export function scenePlanBlockedView(eligibility = {}, generationActive = false) {
  return blockedView('scene', eligibility, generationActive);
}

export function assetPlanBlockedView(eligibility = {}, generationActive = false) {
  return personPlanBlockedView(eligibility.person || eligibility, generationActive);
}
