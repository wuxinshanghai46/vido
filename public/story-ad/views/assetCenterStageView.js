export function assetPlanStageView({ generationActive = false, counts = {}, missingSubjectCount = 0 } = {}) {
  const completed = Number(missingSubjectCount || 0) === 0;
  const action = completed
    ? '<button class="btn primary" type="button" data-confirm-assets data-history-safe>人物资产已完成，进入场景</button>'
    : `<button class="btn primary" type="button" data-generate-subject-assets data-history-safe ${generationActive ? 'disabled' : ''}>${generationActive ? '正在生成人物资产…' : '生成人物资产'}</button>`;
  return `<section class="card asset-visual-next-step"><div><h2>人物资产</h2><p>本次只生成完整人物、穿搭配饰、随身物、动作表情。场景图片和人物在场景中的站位、移动轨迹由场景模块单独生成。</p></div><div class="asset-visual-next-actions">${action}</div></section>`;
}
