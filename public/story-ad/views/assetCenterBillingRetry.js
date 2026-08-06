import { request } from '../api.js?v=20260806-character-asset-kb-v44';
import { confirmDialog } from '../components/dialog.js?v=20260806-character-asset-kb-v44';
import { setButtonBusy, toast } from '../components/ui.js?v=20260806-character-asset-kb-v44';

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
      ? '上次配饰图片已提交给供应商，但供应商没有返回可查询任务 ID，无法确认是否计费。继续后，该配饰可能再次计费；已有 6 项人物核心资产会复用，只补配饰、宠物和缺失场景。此授权仅允许使用一次，若再次出现计费未知会重新锁定。'
      : `将同步生成${summary}。人物与场景分别保存进度；任一分支失败不会删除另一分支已完成的资产，再次提交只会继续缺失项。`;
    if (!await confirmDialog(confirmation, {
      title: billingReviewRequired ? '接受可能重复计费并继续' : '确认同步生成人物与场景',
      confirmText: billingReviewRequired ? '我接受风险，继续缺失项' : '开始同步生成',
    })) return;
    try {
      setButtonBusy(button, true, '正在提交同步生成…', { elapsed: true });
      if (billingReviewRequired) {
        if (!billingReviewSupportId) throw new Error('缺少本次失败支持编号，请刷新页面后重试。');
        await request(`/api/new-story-ad/tasks/${encodeURIComponent(bundle.project.id)}/visual-assets/retry-authorization`, {
          method: 'POST',
          body: { support_id: billingReviewSupportId, accept_duplicate_charge_risk: true },
        });
      }
      await store.runStage('visual-assets', {
        ...subjectPayload,
        generate_subjects: missingSubjectCount > 0,
        scene_targets: sceneTargets,
      });
      toast('人物与场景已进入同一个同步生成任务，可分别查看两条进度。', 'success');
    } catch (error) { toast(error.message, 'danger'); } finally { setButtonBusy(button, false); }
  });
}
