import { escapeHtml } from '../components/ui.js?v=20260829-production-v262';

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
      billingState: text(status.billing_state), submissionState: text(status.submission_state),
    };
  }).filter(Boolean);
  if (!failures.length) return '';
  return `<div class="scene-cover-runtime-failure" role="alert">${failures.map(failure => `<div><b>${escapeHtml(failure.label)}：${failure.state === 'billing-review' ? '计费待核对' : (failure.state === 'pending' ? '尚未提交' : '图片生成没有完成')}</b><span>${failure.state === 'billing-review' ? '图片结果与计费状态正在核对；核对完成前不会自动重复提交。' : (failure.state === 'pending' ? '该图片尚未提交，可以稍后继续。' : '其他已成功图片继续保留；只需补齐这一张。')}</span></div>`).join('')}</div>`;
}
