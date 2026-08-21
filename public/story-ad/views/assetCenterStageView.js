import { personPlanBlockedView } from './assetCenterPlanReleaseStatus.js?v=20260822-reference-dialogue-dedup-v133';
export function assetPlanStageView({ assetPlanReady = false, recoveryActive = false, eligibility = {}, generationActive = false, missingSubjectCount = 0, counts = {} } = {}) {
  if (recoveryActive) return '';
  if (!assetPlanReady) return personPlanBlockedView(eligibility, generationActive);
  const off = generationActive ? 'disabled' : '';
  const action = missingSubjectCount ? `<button class="btn primary" type="button" data-generate-missing-subjects data-history-safe ${off}>${generationActive ? '当前生成任务进行中' : '确认并生成全部缺失人物图片'}</button>` : `<button class="btn primary" type="button" data-confirm-assets data-history-safe ${off}>人物资产已齐全，进入场景世界</button>`;
  return `<section class="card asset-visual-next-step"><div><span class="status-tag is-success">文字方案已建立 · 图片未生成</span><h2>生成真实人物图片</h2><p>进入资产中心不会自动生成图片。确认后才调用图片模型；${Number(counts.people || 0)} 个人物、${Number(counts.animals || 0)} 个动物、${Number(counts.scenes || 0)} 个场景。</p></div><div class="asset-visual-next-actions">${action}</div></section>`;
}
