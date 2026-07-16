const NAV = [
  ['/video-canvas/','工作台'],['/video-canvas/editor.html','编辑器'],['/video-canvas/tasks.html','任务'],['/video-canvas/assets.html','素材'],['/video-canvas/templates.html','模板'],['/video-canvas/settings.html','设置'],
];

export function mountShell(active = '') {
  const target = document.querySelector('[data-vc-topbar]'); if (!target) return;
  target.className = 'vc-topbar';
  target.innerHTML = `<a class="vc-brand" href="/video-canvas/"><i>V</i><span>视频画布</span></a><nav class="vc-nav">${NAV.map(([url,label])=>`<a href="${url}" class="${active===label?'active':''}">${label}</a>`).join('')}</nav><span class="vc-spacer"></span><div class="vc-top-actions"><a class="vc-button" href="/dashboard"><span>返回工作台</span> ↗</a><button class="vc-button" data-theme-toggle aria-label="切换主题">◐</button></div>`;
  target.querySelector('[data-theme-toggle]').onclick = toggleTheme;
  document.documentElement.dataset.theme = localStorage.getItem('vido-theme') || document.documentElement.dataset.theme || 'light';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('vido-theme', next);
}
export function toast(message, type = '') {
  let root = document.querySelector('.vc-toast-root'); if (!root) { root=document.createElement('div'); root.className='vc-toast-root'; document.body.append(root); }
  const item=document.createElement('div'); item.className=`vc-toast ${type}`; item.textContent=message; root.append(item); setTimeout(()=>item.remove(),4200);
}
export function escapeHtml(value='') { return String(value).replace(/[&<>"']/g, char=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char])); }
export function statusLabel(status='') { return ({queued:'排队中',running:'运行中',completed:'已完成',partially_completed:'部分完成',failed:'失败',cancelled:'已取消',succeeded:'成功',reused:'已复用',blocked:'等待上游',skipped:'已跳过',active:'进行中',archived:'已归档'}[status]||status||'未知'); }
export function formatTime(value) { if(!value)return '—'; try{return new Date(value).toLocaleString('zh-CN')}catch{return value} }
export function money(value) { return `$${Number(value||0).toFixed(4)}`; }
