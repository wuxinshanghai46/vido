export function personPlanProgressMarkup(active=false, label='人物方案') {
  return active?`<div class="person-plan-inline-progress" data-person-plan-inline-progress role="progressbar" aria-label="${label}生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="2"><div><i style="width:2%"></i></div><small data-person-plan-progress-label>2% · 正在准备${label}</small></div>`:'';
}
