export function personPlanProgressMarkup(active=false, label='人物方案', startedAt=new Date().toISOString()) {
  return active?`<div class="person-plan-inline-progress is-indeterminate" data-person-plan-inline-progress role="progressbar" aria-label="${label}生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="2"><div><i style="width:2%"></i></div><small><span data-person-plan-progress-label>2% · 正在准备${label}</span> · <em class="elapsed-time" data-elapsed-started-at="${startedAt}" data-elapsed-prefix="已耗时">已耗时 0分00秒</em></small></div>`:'';
}
