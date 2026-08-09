'use strict';

const storySceneCoverage = require('./storySceneCoverageService');
const contentSkill = require('./contentSkillService');

function requiredBeatShape() {
  return {
    id: '稳定且唯一的节拍ID',
    phase: 'opening/development/turning_point/resolution/transition',
    era: '来自输入的时代或时期',
    time_anchor: '明确时间位置',
    location: '具体物理地点；同一地点必须使用稳定名称',
    production_state: '该节拍可见环境状态；语义不变时保持稳定表述',
    production_relation: {
      era: 'same/continuous/changed/unknown',
      time: 'same/continuous/changed/unknown',
      location: 'same/continuous/changed/unknown',
      environment: 'same/continuous/changed/unknown',
    },
    summary: '可见剧情动作',
    cause: '本节拍发生原因',
    consequence: '本节拍造成后果',
  };
}

function invariantBlock() {
  return [
    'story_seed 必须是对象，plot_beats 必须是对象数组；禁止把 story_seed 或 plot_beats 写成字符串数组。',
    '同一时代、同一物理地点、连续时间和相同制作环境必须标 same/continuous；同义改写、几分钟推进、人物进出、情绪或动作变化都不是制作变化。',
    '只有时代、物理地点、昼夜/季节/主光、固定陈设、材质或可行动区域实质改变时，才标 changed 并填写 scene_change_reason。',
    '不得为了增加场景数量把同一空间改名，也不得把不同物理空间合并；不确定时写 unknown，禁止猜测。',
    'production_requirements 与 scene_change_reason 是可选补充；必须优先保证每个 beat 的 id、phase、era、time_anchor、location、production_state、production_relation、summary、cause、consequence 全部完整。',
    '模型只陈述剧情与制作事实；production_scene_key、scene_id、transition_type、covered_beat_ids 和最终场景数量全部由平台确定性编译。',
  ].join('\n');
}

function developmentSystemPrompt(ctx = {}) {
  return [
    '你是平台级纯剧情事实深化 agent，只输出一个 JSON 对象，且只能包含 story_seed。禁止广告、品牌、卖点和购买引导。',
    '先识别用户输入中的题材、人物目标、关系或状态、核心事件和结局方向，再补足必要的前因、触发、发展、关键变化、代价、后果与回收；不得套用预设故事案例。',
    invariantBlock(),
    storySceneCoverage.promptBlock(ctx),
    contentSkill.promptBlock('narrative_story'),
    `输出外形必须为 ${JSON.stringify({ story_seed: { logline: '完整故事梗概', plot_beats: [requiredBeatShape()] } })}`,
    '输出前逐个检查 plot_beats：任何一个 beat 缺少 summary、cause 或 consequence 都不得结束响应。',
  ].join('\n');
}

function developmentUserPayload(ctx = {}, partialPayload = {}, minimumBeats = 0) {
  return {
    brief: ctx.brief || '',
    creative_direction: ctx.creative_direction || {},
    target_duration: ctx.target_duration || 30,
    shot_count: ctx.shot_count || 0,
    minimum_plot_beats: minimumBeats,
    plot_beat_count_contract: {
      minimum: minimumBeats,
      instruction: `返回前必须逐项计数，plot_beats 不得少于 ${minimumBeats} 个`,
    },
    cast: (partialPayload.cast_profiles || []).map(item => ({ id: item.id, name: item.name, role: item.role })),
    required_output: { story_seed: { logline: '完整故事梗概', plot_beats: [requiredBeatShape()] } },
  };
}

function repairSystemPrompt(ctx = {}) {
  return [
    '你是剧情事实定向修复 agent。只修复给定候选中缺失、不确定或合同不合格的字段；不得改变题材、人物、因果、结局和已合格事实。',
    '只输出一个 JSON 对象且只能包含 story_seed_patch；禁止重写整份 story_seed。',
    invariantBlock(),
    storySceneCoverage.promptBlock(ctx),
    contentSkill.promptBlock('narrative_story'),
    '最终只输出 {"story_seed_patch":{"fields":{},"plot_beats_upsert":[]}}。',
    'plot_beats_upsert 必须完整覆盖 repair_scope.target_beat_ids，并追加恰好 repair_scope.append_count 个新 beat。新增 beat 的 id 必须与 existing_beat_ids 及本补丁内其他 id 都不重复。',
    '不得回传其他已合格 beat。每个新增或替换 beat 必须符合 required_output_schema 的完整字段，禁止使用 text 或 description 代替。',
  ].join('\n');
}

function repairUserPayload(ctx = {}, minimumBeats = 0, issues = [], repairScope = {}) {
  const targetIds = Array.isArray(repairScope.target_beat_ids) ? repairScope.target_beat_ids : [];
  const appendCount = Math.max(0, Number(repairScope.append_count) || 0);
  const existingIds = Array.isArray(repairScope.existing_beat_ids) ? repairScope.existing_beat_ids : [];
  const reservedNewBeatIds = [];
  let reservedIndex = 1;
  while (reservedNewBeatIds.length < appendCount) {
    const candidate = `repair_append_${reservedIndex}`;
    reservedIndex += 1;
    if (!existingIds.includes(candidate)) reservedNewBeatIds.push(candidate);
  }
  return {
    brief: ctx.brief || '',
    validation_issues: Array.isArray(issues) ? issues : [],
    minimum_plot_beats: minimumBeats,
    repair_scope: {
      target_beat_ids: targetIds,
      allowed_scalar_fields: Array.isArray(repairScope.allowed_scalar_fields) ? repairScope.allowed_scalar_fields : [],
      append_count: appendCount,
      existing_beat_ids: existingIds,
      reserved_new_beat_ids: reservedNewBeatIds,
    },
    target_beats: Array.isArray(repairScope.target_beats) ? repairScope.target_beats : [],
    neighbor_context: Array.isArray(repairScope.neighbor_context) ? repairScope.neighbor_context : [],
    required_output_schema: storySceneCoverage.storySeedPatchOutputTemplate(),
    repair_limit: `只能修改 beat_id=${targetIds.join('|') || 'none'}；必须追加恰好 ${appendCount} 个全新 beat；禁止整份故事重新创作`,
  };
}

function compactRetrySystemPrompt(ctx = {}) {
  return [
    '你是剧情事实紧凑重试 agent。上一次响应为空、被截断或结构不合格；本次必须输出完整可解析的 JSON 对象且只能包含 story_seed。',
    '每个字符串控制在30个汉字以内，只保留完成因果链所需事实；完成最后一个花括号后立即停止。',
    invariantBlock(),
    storySceneCoverage.promptBlock(ctx),
    contentSkill.promptBlock('narrative_story'),
    `最终外形必须为 ${JSON.stringify({ story_seed: { logline: '完整故事梗概', plot_beats: [requiredBeatShape()] } })}`,
    '输出前逐个检查 plot_beats：任何一个 beat 缺少 summary、cause 或 consequence 都不得结束响应。',
  ].join('\n');
}

function shouldUseCompactRetry(baseBeats = [], repairScope = {}, minimumBeats = 0) {
  const beats = Array.isArray(baseBeats) ? baseBeats : [];
  const directedRepairAvailable = Boolean(
    (repairScope.target_beat_ids || []).length
    || Number(repairScope.append_count || 0)
    || (repairScope.allowed_scalar_fields || []).length,
  );
  const repairWouldRewriteLargeShare = Number(repairScope.append_count || 0) * 4 > Math.max(1, Number(minimumBeats) || 0);
  return !beats.length || !directedRepairAvailable || repairWouldRewriteLargeShare;
}

function compactRetryUserPayload(ctx = {}, partialPayload = {}, minimumBeats = 0, baseBeats = [], issues = []) {
  return {
    brief: ctx.brief || '',
    creative_direction: ctx.creative_direction || {},
    target_duration: ctx.target_duration || 30,
    shot_count: ctx.shot_count || 0,
    exact_plot_beat_count: minimumBeats,
    plot_beat_count_contract: {
      exact: minimumBeats,
      instruction: `返回前必须逐项计数，plot_beats 必须恰好为 ${minimumBeats} 个`,
    },
    rejected_candidate_valid_prefix: (Array.isArray(baseBeats) ? baseBeats : [])
      .filter(beat => String(beat?.id || beat?.beat_id || beat?.beatId || '').trim())
      .slice(0, 16),
    validation_issues: Array.isArray(issues) ? issues : [],
    cast: (partialPayload.cast_profiles || []).map(item => ({ id: item.id, name: item.name, role: item.role })),
    required_output: { story_seed: { logline: '完整故事梗概', plot_beats: [requiredBeatShape()] } },
    response_limit: '只输出紧凑 JSON；完成最后一个花括号后立即停止',
  };
}

module.exports = {
  requiredBeatShape,
  invariantBlock,
  developmentSystemPrompt,
  developmentUserPayload,
  repairSystemPrompt,
  repairUserPayload,
  shouldUseCompactRetry,
  compactRetrySystemPrompt,
  compactRetryUserPayload,
};
