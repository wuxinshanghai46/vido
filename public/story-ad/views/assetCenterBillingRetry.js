import { request } from '../api.js?v=20260806-reproducible-handoff-v64';
import { confirmDialog } from '../components/dialog.js?v=20260806-reproducible-handoff-v64';
import { setButtonBusy, toast } from '../components/ui.js?v=20260806-reproducible-handoff-v64';

export function visualGenerationState(bundle, missingSubjectCount, missingSceneCount) {
  const progress = bundle.generation?.progress || {};
  const subjectLane = progress.lanes?.subjects || {};
  const billingReviewRequired = bundle.project?.error_code === 'GENERATION_BILLING_STATE_UNKNOWN'
    || progress.error_code === 'GENERATION_BILLING_STATE_UNKNOWN'
    || progress.billing_state === 'unknown'
    || subjectLane.billing_state === 'unknown';
  return {
    billingReviewRequired,
    billingReviewSupportId: bundle.generation?.progress?.support_id || '',
    visualActionLabel: billingReviewRequired
      ? '重新生成'
      : (missingSubjectCount && missingSceneCount
        ? `同时生成人物与场景（${missingSubjectCount} + ${missingSceneCount}）`
        : (missingSubjectCount ? `生成人物 / 动物（${missingSubjectCount}）` : (missingSceneCount ? `生成场景（${missingSceneCount}）` : '人物与场景视觉已齐全'))),
  };
}

function reviewLabel(review = {}) {
  if (review.kind === 'scene') return `场景“${review.scene_id || '未命名场景'}”的${review.unit || '视图'}`;
  return `人物 / 动物的${review.unit || '图片单元'}`;
}

export async function authorizeBillingReviews({ bundle, lane = '', subjectId = '', sceneId = '' } = {}) {
  const taskId = bundle?.project?.id || '';
  if (!taskId) return [];
  const response = await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/visual-assets/billing-reviews`);
  const reviews = (Array.isArray(response.reviews) ? response.reviews : []).filter(review => {
    if (review.authorized) return false;
    if (lane && review.lane !== lane) return false;
    if (sceneId && review.kind === 'scene' && review.scene_id !== sceneId) return false;
    if (subjectId && review.kind === 'subject' && review.subject_id && review.subject_id !== subjectId) return false;
    return true;
  });
  for (const review of reviews) {
    const label = reviewLabel(review);
    const accepted = await confirmDialog(
      `${label}上次已经提交给供应商，但没有取得可核对的最终计费结果。只针对这一项重试可能产生一次重复费用；其他已成功图片会继续复用，不会重新提交。`,
      { title: `逐项核对：${label}`, confirmText: '接受这一项风险并重试' },
    );
    if (!accepted) {
      const error = new Error(`已取消${label}的一次性重试授权，未提交新的模型调用。`);
      error.code = 'BILLING_REVIEW_CANCELLED';
      throw error;
    }
    await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/visual-assets/retry-authorization`, {
      method: 'POST',
      body: {
        support_id: response.support_id,
        checkpoint_key: review.review_key,
        accept_duplicate_charge_risk: true,
      },
    });
  }
  return reviews;
}

export function bindCombinedVisualGeneration({
  host, bundle, assets, store, missingSubjectCount, missingSceneCount,
  billingReviewRequired, billingReviewSupportId, subjectGenerationPayload,
  generationValidation, sceneNeedsGeneration,
}) {
  host.querySelector('[data-generate-visual-assets]')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const subjectPayload = subjectGenerationPayload(bundle, null, `${bundle.project.id}:visual:${globalThis.crypto?.randomUUID?.() || Date.now()}`);
    const sceneTargets = (assets.scenes || []).filter(sceneNeedsGeneration).map(scene => ({
      scene_id: scene.id, space_id: scene.id, name: scene.name, scene_spec: scene.scene_spec || scene.spec,
    }));
    if (missingSubjectCount) {
      const validation = generationValidation(subjectPayload);
      if (validation) { toast(validation, 'warning'); return; }
    }
    const summary = [missingSubjectCount ? `${missingSubjectCount} 个人物 / 动物` : '', missingSceneCount ? `${missingSceneCount} 个场景` : ''].filter(Boolean).join('和');
    const confirmation = billingReviewRequired
      ? '当前存在需要逐项核对的计费未知图片。继续后会分别显示每一个具体失败单元，由你逐项确认；没有确认的单元不会提交，已有成功资产会继续复用。'
      : `将同步生成${summary}。人物与场景分别保存进度；任一分支失败不会删除另一分支已完成的资产，再次提交只会继续缺失项。`;
    if (!await confirmDialog(confirmation, {
      title: billingReviewRequired ? '接受可能重复计费并继续' : '确认同步生成人物与场景',
      confirmText: billingReviewRequired ? '我接受风险，继续缺失项' : '开始同步生成',
    })) return;
    try {
      setButtonBusy(button, true, '正在提交同步生成…', { elapsed: true });
      if (billingReviewRequired) await authorizeBillingReviews({ bundle });
      await store.runStage('visual-assets', {
        ...subjectPayload,
        generate_subjects: missingSubjectCount > 0,
        scene_targets: sceneTargets,
      });
      toast('人物与场景已进入同一个同步生成任务，可分别查看两条进度。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
