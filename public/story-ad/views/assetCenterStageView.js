import { personPlanBlockedView } from './assetCenterPlanReleaseStatus.js?v=20260823-independent-person-plan-v198';
export function assetPlanStageView({ assetPlanReady = false, recoveryActive = false, eligibility = {}, generationActive = false, missingSubjectCount = 0, counts = {}, project = {}, isAdmin = false } = {}) {
  if (recoveryActive) return '';
  if (!assetPlanReady) return personPlanBlockedView(eligibility, generationActive, {
    isAdmin, diagnostics: project.technical_diagnostics || null,
  });
  const generationDisabled = generationActive ? 'disabled' : '';
  const action = missingSubjectCount ? `<button class="btn primary" type="button" data-generate-missing-subjects data-history-safe ${generationDisabled}>${generationActive ? '正在生成人物方案…' : '生成人物方案'}</button>` : '<button class="btn primary" type="button" data-confirm-assets data-history-safe>确认人物资产，进入场景世界</button>';
  return `<section class="card asset-visual-next-step"><div><h2>${missingSubjectCount ? '生成人物方案' : '人物方案已完成'}</h2><p>${missingSubjectCount ? `系统将先并行补齐每个人物的完整方案，再同时生成当前缺失的 ${Number(missingSubjectCount)} 个人物图片；完整进度显示在页面顶部。` : `${Number(counts.people || 0)} 个人物与 ${Number(counts.animals || 0)} 个动物资产已经齐全。`}</p></div><div class="asset-visual-next-actions">${action}</div></section>`;
}
