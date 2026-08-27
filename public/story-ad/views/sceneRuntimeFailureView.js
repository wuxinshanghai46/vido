import { escapeHtml } from '../components/ui.js?v=20260827-production-v239';

const VIEW_LABELS = Object.freeze({
  master: '主视总览', reverse: '反向空间', interaction: '互动区域', detail: '材质细节', layout: '俯视布局',
});
const text = value => String(value || '').trim();

export function sceneRuntimeFailureMarkup(item = {}) {
  const completed = new Set(Array.isArray(item.completed_view_keys) ? item.completed_view_keys : []);
  const failures = Object.keys(VIEW_LABELS).map(key => {
    if (completed.has(key)) return null;
    const status = item.view_statuses?.[key] || {};
    const state = text(status.state).toLowerCase().replaceAll('_', '-');
    if (!['failed', 'billing-review', 'pending'].includes(state)) return null;
    return {
      label: VIEW_LABELS[key], state,
      route: [text(status.provider_id), text(status.model_id)].filter(Boolean).join(' / '),
      httpStatus: text(status.http_status), errorCode: text(status.error_code),
      platformRequestId: text(status.platform_request_id), providerRequestId: text(status.provider_request_id),
      providerTaskId: text(status.provider_task_id), billingState: text(status.billing_state),
      submissionState: text(status.submission_state), message: text(status.message), durationMs: Number(status.duration_ms || 0) || 0,
    };
  }).filter(Boolean);
  if (!failures.length) return '';
  return `<div class="scene-cover-runtime-failure" role="alert">${failures.map(failure => `<div><b>${escapeHtml(failure.label)}：${failure.state === 'billing-review' ? '计费待核对' : (failure.state === 'pending' ? '尚未提交' : '生成失败')}</b><span>${escapeHtml([failure.route, failure.httpStatus ? `HTTP ${failure.httpStatus}` : '', failure.errorCode, failure.durationMs ? `用时 ${(failure.durationMs / 1000).toFixed(2)} 秒` : ''].filter(Boolean).join(' · ') || failure.message || '供应商未返回结构化错误')}</span>${failure.platformRequestId ? `<small>平台请求：${escapeHtml(failure.platformRequestId)}</small>` : ''}${failure.providerRequestId || failure.providerTaskId ? `<small>厂商请求：${escapeHtml(failure.providerRequestId || failure.providerTaskId)}</small>` : ''}<small>提交：${escapeHtml(failure.submissionState || '未知')} · 计费：${escapeHtml(failure.billingState || '未知')}</small></div>`).join('')}</div>`;
}
