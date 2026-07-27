const {
  normalizeCreativeDirection,
  contextConflicts,
  cleanText,
} = require('./contextBuilder');

function outputSchema() {
  return `{
  "creative_direction": {
    "raw": "给普通用户直接编辑的完整剧情与表演要求，使用自然中文分段，不要 Markdown",
    "plot_direction": "从开场、触发、变化到结果的故事走向",
    "tone": "人物或主体的情绪变化与整体基调",
    "pace": "节奏、停顿、转折和高潮安排",
    "ending": "结尾动作、结果和品牌收束；Logo 只能写后期落版预留",
    "dialogue_notes": "台词或旁白要求；无人物模式不得编写人物对白",
    "must_have": ["必须出现的已确认人物、主体、动作或信息"],
    "must_avoid": ["禁止新增人物、场景、道具、功效或未经授权内容"],
    "actions": [{
      "id": "action_1",
      "actor_id": "只能使用当前已确认人物 ID；无人物模式留空",
      "actor": "只能使用当前已确认人物姓名；无人物模式留空",
      "action": "在当前已确认场景内发生的动作",
      "target_id": "只能使用当前主体或资产 ID；不确定留空",
      "target": "当前已确认主体",
      "phase": "setup/development/turn/resolution/brand_closure",
      "expression": "人物表情；无人物模式留空",
      "dialogue": "人物台词；无人物模式留空",
      "required": true,
      "constraints": ["本动作的连续性和禁止项"]
    }]
  }
}`;
}

function systemRule() {
  return [
    '当 mode 是 creative_direction 时，只辅写剧情走向和表演要求，不得重写广告目标、人物设定、场景设定或商品事实。',
    'creative_direction 必须严格使用上下文中已确认的人物、宠物、商品和 scene_assets；禁止新增人物、地点、房间、道具、功效、价格或资质。',
    '生产模式只决定故事以真人表演、无人产品变化或服务使用过程推进，不得覆盖已确认主体模式。',
    'Logo 只能作为后期授权素材落版预留，不得要求图片或视频模型生成、变形或仿制 Logo。',
  ].join(' ');
}

function formatRaw(direction = {}) {
  const rows = [
    direction.plot_direction && `剧情走向：${direction.plot_direction}`,
    direction.tone && `情绪与表演：${direction.tone}`,
    direction.actions?.length && `关键动作：${direction.actions.map(action => [
      action.actor ? `${action.actor}` : '',
      action.action,
      action.expression ? `表情：${action.expression}` : '',
      action.dialogue ? `台词：${action.dialogue}` : '',
    ].filter(Boolean).join('，')).join('；')}`,
    direction.dialogue_notes && `台词与旁白：${direction.dialogue_notes}`,
    direction.pace && `节奏：${direction.pace}`,
    direction.ending && `结尾：${direction.ending}`,
    direction.must_have?.length && `必须出现：${direction.must_have.join('；')}`,
    direction.must_avoid?.length && `禁止出现：${direction.must_avoid.join('；')}`,
  ].filter(Boolean);
  return cleanText(rows.join('\n'), 3000);
}

function buildResponse({ parsed = {}, context = {}, mode = '', modelResult = {} } = {}) {
  const source = parsed.creative_direction || parsed.creativeDirection || parsed;
  let direction = normalizeCreativeDirection(source);
  const raw = direction.raw || formatRaw(direction);
  direction = normalizeCreativeDirection({ ...direction, raw });
  if (direction.raw.length < 20) {
    const error = new Error('AI 返回的剧情与表演要求不完整，请补充广告需求后重试');
    error.code = 'ASSIST_CREATIVE_INCOMPLETE';
    error.status = 422;
    throw error;
  }
  const conflicts = contextConflicts({ ...context, creative_direction: direction });
  if (conflicts.length) {
    const error = new Error(`AI 辅写结果与已确认资产冲突：${conflicts.join('；')}`);
    error.code = 'ASSIST_CREATIVE_CONFLICT';
    error.status = 422;
    error.conflicts = conflicts;
    throw error;
  }
  return {
    creative_direction: direction,
    text: direction.raw,
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = {
  outputSchema,
  systemRule,
  buildResponse,
};
