import { request } from '../api.js?v=20260904-production-v429';
import { setButtonBusy, toast } from '../components/ui.js?v=20260904-production-v429';

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
      ? '继续生成缺失项'
      : (missingSubjectCount && missingSceneCount
        ? `同时生成人物与场景（${missingSubjectCount} + ${missingSceneCount}）`
        : (missingSubjectCount ? `生成人物 / 动物（${missingSubjectCount}）` : (missingSceneCount ? `生成场景（${missingSceneCount}）` : '人物与场景视觉已齐全'))),
  };
}

let billingReviewDialogPromise;
function billingReviewDialog() {
  billingReviewDialogPromise ||= import('./assetCenterBillingReviewDialog.js?v=20260904-production-v429');
  return billingReviewDialogPromise;
}
export async function loadBillingReviews(options = {}) {
  return (await billingReviewDialog()).loadBillingReviews(options);
}
export async function confirmBillingAwareAction(options = {}) {
  const result = await (await billingReviewDialog()).confirmBillingAwareAction(options);
  if (result.accepted && options.authorizeReviews && result.reviewBatch?.reviews?.length) {
    await authorizeBillingReviews({ ...options, reviewBatch: result.reviewBatch });
  }
  return result;
}

export function startBillingReviewPolling({ bundle, store, host, initialDelay = 4000 } = {}) {
  let cancelled = false;
  let delay = Math.max(2000, Number(initialDelay) || 4000);
  const poll = async () => {
    if (cancelled || !host?.isConnected) return;
    if (globalThis.document?.visibilityState === 'hidden') {
      globalThis.setTimeout(poll, Math.min(30000, delay * 2)); return;
    }
    try {
      const result = await loadBillingReviews({ bundle, lane: 'subjects' });
      if (result.reviews.some(review => review.billing_review_state !== 'pending')) {
        await store.refreshSections('summary,assets');
        return;
      }
      delay = Math.min(30000, Math.round(delay * 1.5));
    } catch { delay = Math.min(30000, delay * 2); }
    globalThis.setTimeout(poll, delay);
  };
  globalThis.setTimeout(poll, delay);
  return () => { cancelled = true; };
}

export function recoveryRequestKey(bundle = {}, recovery = {}, intent = 'all') {
  if (!recovery?.missing_units?.length) return `${bundle.project?.id}:${intent}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
  return `${bundle.project?.id}:subject-recovery:r${bundle.revisions?.content || 1}:${recovery.missing_units
    .map(unit => `${unit.key}@${unit.review_revision || 1}`).sort().join('|')}`.slice(0, 180);
}

export async function ensureSubjectRecoveryReady(options = {}) {
  return (await billingReviewDialog()).ensureSubjectRecoveryReady({ ...options,setButtonBusy,toast });
}

export function bindSubjectBillingRecovery({ host, bundle, store, checkpointRecovery, generate } = {}) {
  host.querySelector('[data-generate-recovery], [data-accept-billing-risk]')?.addEventListener('click', event => generate(null, '', event.currentTarget));
  if (checkpointRecovery?.billing_review_state === 'pending') startBillingReviewPolling({ bundle, store, host });
}

export async function authorizeBillingReviews({ bundle, lane = '', subjectId = '', sceneId = '', reviewBatch = null } = {}) {
  const taskId = bundle?.project?.id || '';
  if (!taskId) return [];
  const prepared = reviewBatch || await loadBillingReviews({ bundle, lane, subjectId, sceneId });
  const reviews = prepared.reviews || [];
  if (!reviews.length) return reviews;
  await request(`/api/new-story-ad/tasks/${encodeURIComponent(taskId)}/visual-assets/retry-authorizations`, {
    method: 'POST',
    body: {
      support_id: prepared.support_id,
      checkpoint_keys: reviews.map(review => review.review_key),
      expected_review_revisions: Object.fromEntries(reviews.map(review => [review.review_key, review.review_revision])),
      accept_duplicate_charge_risk: true,
    },
  });
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
      repair_existing: Boolean(scene.layout?.image_url || scene.scene_master?.image_url || scene.view_images?.some(view => view?.image_url)),
    }));
    if (missingSubjectCount) {
      const validation = generationValidation(subjectPayload);
      if (validation) { toast(validation, 'warning'); return; }
    }
    const summary = [missingSubjectCount ? `${missingSubjectCount} 个人物 / 动物` : '', missingSceneCount ? `${missingSceneCount} 个场景` : ''].filter(Boolean).join('和');
    const qualityTier = String(bundle.brief?.video_quality || bundle.project?.brief?.video_quality || 'final').toLowerCase();
    const resolution = String(bundle.brief?.video_resolution || bundle.project?.brief?.video_resolution || '').toLowerCase();
    const nativeSceneViews = ['final', 'high'].includes(qualityTier) || ['4k', '2160p'].includes(resolution);
    const sceneCostNotice = missingSceneCount
      ? (nativeSceneViews
        ? `最终质量会为每个场景分别生成主视、反向、互动、细节和布局 5 张原生图，最多产生 5 次图片模型调用；这样不会用拼图切片冒充高清。当前缺失场景最多 ${missingSceneCount * 5} 次调用。`
        : `草稿质量每个场景使用 1 张 2×2 视角图集和 1 张布局图，最多产生 2 次图片模型调用；切片保持母图原生像素，不会插值放大。当前缺失场景最多 ${missingSceneCount * 2} 次调用。`)
      : '';
    const confirmation = billingReviewRequired
      ? '当前存在计费未知图片。本次只继续缺失单元，已有成功资产会继续复用；需要接受的重复计费风险会合并在这一次确认中。'
      : `将同步生成${summary}。${missingSubjectCount ? '人物档案会把穿搭与配饰生成为独立物件图，并按实际单品类别产生对应图片模型调用。' : ''}${sceneCostNotice}人物与场景分别保存进度；任一分支失败不会删除另一分支已完成的资产，再次提交只会继续缺失项。`;
    setButtonBusy(button, true, '正在准备…');
    try {
      const confirmationResult = await confirmBillingAwareAction({
        bundle,
        message: confirmation,
        title: billingReviewRequired ? '接受可能重复计费并继续' : '确认同步生成人物与场景',
        confirmText: billingReviewRequired ? '我接受风险，继续缺失项' : '开始同步生成',
      });
      if (!confirmationResult.accepted) return;
      setButtonBusy(button, true, '正在提交同步生成…', { elapsed: true });
      if (billingReviewRequired) await authorizeBillingReviews({ bundle, reviewBatch: confirmationResult.reviewBatch });
      await store.runStage('visual-assets', {
        ...subjectPayload,
        generate_subjects: missingSubjectCount > 0,
        scene_targets: sceneTargets,
      });
      toast('人物与场景已进入同一个同步生成任务，可分别查看两条进度。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
