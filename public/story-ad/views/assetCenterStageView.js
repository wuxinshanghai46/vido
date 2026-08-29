import { personPlanTechnicalDetails } from './assetCenterTechnicalDetails.js?v=20260829-production-v263';

export function assetPlanStageView({ generationActive = false, counts = {}, missingSubjectCount = 0, project = {}, isAdmin = false } = {}) {
  const completed = Number(missingSubjectCount || 0) === 0;
  const diagnostics = project.technical_diagnostics || {};
  const failureStage = String(diagnostics.generation_progress?.stage || project.generation_progress?.stage || '');
  const personFailure = /^(person|subject)(?:_|\b)|person_plan|person_provider_sync/i.test(failureStage);
  const failed = !completed && !generationActive && personFailure
    && Boolean(diagnostics.error_code || diagnostics.error || project.error_code || project.error);
  const action = completed
    ? '<button class="btn primary" type="button" data-confirm-assets data-history-safe>人物资产已完成，进入场景</button>'
    : `<button class="btn primary" type="button" data-generate-subject-assets data-history-safe ${generationActive ? 'disabled' : ''}>${generationActive ? '正在生成人物资产…' : '生成人物资产'}</button>`;
  return `<section class="card asset-visual-next-step"><div><h2>人物资产</h2><p>本次只生成完整人物、穿搭配饰、随身物、动作表情。场景图片和人物在场景中的站位、移动轨迹由场景模块单独生成。</p>${personPlanTechnicalDetails({ failed, isAdmin, diagnostics: { error_code: diagnostics.error_code || project.error_code, error: diagnostics.error || project.error, support_id: diagnostics.support_id || project.support_id, generation_progress: diagnostics.generation_progress || project.generation_progress } })}</div><div class="asset-visual-next-actions">${action}</div></section>`;
}
