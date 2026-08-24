import { request } from '../api.js?v=20260824-production-v203';
import { confirmDialog } from '../components/dialog.js?v=20260824-production-v203';
export { ensureSubjectRecoveryReady } from './subjectRecoveryPreflightAction.js?v=20260824-production-v203';

function reviewLabel(review = {}) {
  if (review.kind === 'scene') return `场景“${review.scene_id || '未命名场景'}”的${review.unit || '视图'}`;
  return `人物 / 动物的${review.unit || '图片单元'}`;
}

export async function loadBillingReviews({ bundle, lane = '', subjectId = '', sceneId = '' } = {}) {
  const taskId = bundle?.project?.id || '';
  if (!taskId) return { support_id: '', reviews: [] };
  const response = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/visual-assets/billing-reviews`);
  const reviews = (Array.isArray(response.reviews) ? response.reviews : []).filter(review => {
    if (review.authorized || (lane && review.lane !== lane)) return false;
    if (sceneId && review.kind === 'scene' && review.scene_id !== sceneId) return false;
    if (subjectId && review.kind === 'subject' && review.subject_id && review.subject_id !== subjectId) return false;
    return true;
  });
  return { support_id: response.support_id || '', reviews };
}

export async function confirmBillingAwareAction({
  bundle, lane = '', subjectId = '', sceneId = '', message = '', title = '', confirmText = '确认继续',
} = {}) {
  const reviewBatch = await loadBillingReviews({ bundle, lane, subjectId, sceneId });
  const count = reviewBatch.reviews.length;
  const labels = reviewBatch.reviews.slice(0, 3).map(reviewLabel).join('、');
  const remaining = Math.max(0, count - 3);
  const riskNotice = count
    ? `\n\n本次一次确认同时覆盖 ${count} 个计费未知单元，最多可能产生 ${count} 次重复费用。${labels ? `涉及：${labels}${remaining ? `等 ${count} 项` : ''}。` : ''}没有选中的成功图片不会重新提交。`
    : '';
  const accepted = await confirmDialog(`${message}${riskNotice}`, {
    title: count ? '一次确认全部计费风险' : title,
    confirmText: count ? `接受 ${count} 项风险并继续` : confirmText,
  });
  return { accepted, reviewBatch };
}
