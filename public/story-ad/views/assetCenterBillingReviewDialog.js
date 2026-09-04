import { request } from '../api.js?v=20260904-production-v470';
import { confirmDialog } from '../components/dialog.js?v=20260904-production-v470';
export { ensureSubjectRecoveryReady } from './subjectRecoveryPreflightAction.js?v=20260904-production-v470';

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
  bundle, lane = '', subjectId = '', sceneId = '', message = '', title = '', confirmText = '',
} = {}) {
  const reviewBatch = await loadBillingReviews({ bundle, lane, subjectId, sceneId });
  if (!reviewBatch.reviews.length) return { accepted: true, reviewBatch };
  const units = reviewBatch.reviews
    .map(review => review.unit_label || review.unit || review.view_key || review.review_key || '未知单元')
    .slice(0, 6)
    .join('、');
  const accepted = await confirmDialog(
    message || `检测到 ${reviewBatch.reviews.length} 个历史图片请求的计费结果无法确认（${units}）。继续会只重试缺失项，但供应商仍可能对原请求和本次请求分别计费。`,
    {
      title: title || '确认可能重复计费',
      confirmText: confirmText || '我接受风险，继续',
      cancelText: '先不重试',
      danger: true,
    },
  );
  return { accepted, reviewBatch };
}
