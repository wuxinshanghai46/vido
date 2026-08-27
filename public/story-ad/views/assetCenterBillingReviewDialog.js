import { request } from '../api.js?v=20260828-production-v239b';
export { ensureSubjectRecoveryReady } from './subjectRecoveryPreflightAction.js?v=20260828-production-v239b';

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
  bundle, lane = '', subjectId = '', sceneId = '',
} = {}) {
  const reviewBatch = await loadBillingReviews({ bundle, lane, subjectId, sceneId });
  return { accepted: true, reviewBatch };
}
