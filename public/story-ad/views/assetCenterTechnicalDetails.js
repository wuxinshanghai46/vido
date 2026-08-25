import { escapeHtml } from '../components/ui.js?v=20260825-production-v223';
export function personPlanTechnicalDetails({ migration=false, failed=false, isAdmin=false, diagnostics={} }={}) {
  if(!isAdmin)return '';
  const copy=migration?'系统会复用兼容方案并生成缺失的人物图片，不重复修改已确认的人物设定。':'系统会根据已确认剧情和现有人物资产补全详细人物方案，并继续生成缺失的人物图片。';
  const safe=failed?'<p class="asset-plan-failure"><b>人物方案暂未完成。</b> 已保存的人物身份和现有资产不会丢失；缺少的是待生成的人物图片，不是系统找不到同一个人物。请稍后从这里重新生成。</p>':'';
  const raw=diagnostics||{}, detail=failed?`<b>${escapeHtml(raw.error_code||'生成失败')}</b><p>${escapeHtml(raw.error||'暂无错误说明')}</p>${raw.support_id?`<small>支持编号：${escapeHtml(raw.support_id)}</small>`:''}`:'';
  return `<details class="asset-plan-admin-diagnostics"><summary>技术详情（仅超管）</summary><div><p>${copy}</p>${safe}${detail}</div></details>`;
}
