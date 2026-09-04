import { escapeHtml } from '../components/ui.js?v=20260904-production-v443';
export function personPlanTechnicalDetails({ migration=false, failed=false, isAdmin=false, diagnostics={} }={}) {
  if(!isAdmin||!failed)return '';
  const copy=migration?'系统会复用兼容方案并生成缺失的人物图片，不重复修改已确认的人物设定。':'系统会根据已确认剧情和现有人物资产补全详细人物方案，并继续生成缺失的人物图片。';
  const raw=diagnostics||{};
  const progress=raw.generation_progress||{};
  const progressText=[progress.stage,progress.phase,progress.message].filter(Boolean).join(' · ');
  return `<section class="asset-plan-admin-diagnostics is-visible" data-admin-failure-details><header><b>具体失败原因（授权账号可见）</b><span>${escapeHtml(raw.error_code||'GENERATION_FAILED')}</span></header><p>${escapeHtml(raw.error||'服务器没有返回具体错误说明')}</p>${progressText?`<p>失败位置：${escapeHtml(progressText)}</p>`:''}${raw.support_id?`<small>支持编号：${escapeHtml(raw.support_id)}</small>`:''}<small>${copy}</small></section>`;
}
