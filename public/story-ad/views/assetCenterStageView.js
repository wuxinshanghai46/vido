export function assetPlanStageView({ generationActive = false, counts = {}, productionGraph = null } = {}) {
  const ready = productionGraph?.validation?.status === 'ready';
  const action = ready
    ? '<button class="btn primary" type="button" data-confirm-assets data-history-safe>确认制作资产，进入场景世界</button>'
    : `<button class="btn primary" type="button" data-generate-production-assets data-history-safe ${generationActive ? 'disabled' : ''}>${generationActive ? '正在生成全部制作资产…' : '生成全部制作资产'}</button>`;
  return `<section class="card asset-visual-next-step"><div><h2>${ready ? '全部制作资产已完成' : '一键生成完整制作资产'}</h2><p>${ready ? `${Number(counts.people || 0)} 个人物、${Number(counts.scenes || 0)} 个场景及逐镜执行合同已进入同一制作图谱。` : '系统会从已确认剧情一次补齐完整人物、穿搭配饰、随身物、动作表情、场景母图、360°全景、机位与逐镜绑定；页面顶部显示统一进度，失败时只补缺失单元。'}</p></div><div class="asset-visual-next-actions">${action}</div></section>`;
}
