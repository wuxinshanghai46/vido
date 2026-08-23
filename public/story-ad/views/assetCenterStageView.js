import { personPlanBlockedView } from './assetCenterPlanReleaseStatus.js?v=20260823-character-library-v184';
export function assetPlanStageView({ assetPlanReady = false, recoveryActive = false, eligibility = {}, generationActive = false, missingSubjectCount = 0, counts = {}, project = {} } = {}) {
  if (recoveryActive) return '';
  if (!assetPlanReady) return personPlanBlockedView(eligibility, generationActive, {
    message: project.error || project.generation_progress?.message || '', supportId: project.support_id || project.generation_progress?.support_id || '',
  });
  const generationDisabled = generationActive ? 'disabled' : '';
  const action = missingSubjectCount ? `<button class="btn primary" type="button" data-generate-missing-subjects data-history-safe ${generationDisabled}>${generationActive ? '正在生成人物方案…' : '生成人物方案'}</button>` : '<button class="btn primary" type="button" data-confirm-assets data-history-safe>确认人物资产，进入场景世界</button>';
  return `<section class="card asset-visual-next-step"><div><h2>${missingSubjectCount ? '生成人物方案' : '人物方案已完成'}</h2><p>${missingSubjectCount ? `系统将使用完整人物资产生成当前缺失的 ${Number(missingSubjectCount)} 个人物图片。` : `${Number(counts.people || 0)} 个人物与 ${Number(counts.animals || 0)} 个动物资产已经齐全。`}</p></div><div class="asset-visual-next-actions">${action}</div></section>`;
}
