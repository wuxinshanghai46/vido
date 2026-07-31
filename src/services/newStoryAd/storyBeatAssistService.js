const { cleanText } = require('./contextBuilder');

function normalizeAssistedStoryBeat(input = {}, current = {}) {
  const source = input?.story_beat || input?.storyBeat || input?.beat || input || {};
  const currentDuration = Number(current.duration || current.duration_sec || 3) || 3;
  const requestedDuration = Number(source.duration || source.duration_sec || currentDuration) || currentDuration;
  return {
    title: cleanText(source.title || current.title || current.role || '未命名情节点', 120),
    visual: cleanText(source.visual || source.plot || current.visual || current.plot || '', 1200),
    action: cleanText(source.action || current.action || '', 600),
    spoken_line: cleanText(source.spoken_line || source.voiceover || current.spoken_line || current.voiceover || '', 600),
    visual_proof: cleanText(source.visual_proof || source.purpose || current.visual_proof || current.purpose || '', 600),
    duration: Math.max(1, Math.min(30, requestedDuration)),
  };
}

function systemRule() {
  return '当 mode 是 story_beat 时，只帮写用户当前选中的一个情节点。保持已有剧情因果、人物身份、商品事实、场景边界和相邻情节点连续性；不得新增未经需求支持的功效、价格、品牌承诺或主体。';
}

function outputSchema() {
  return `{
  "story_beat": {
    "title": "简洁、可由用户继续修改的情节点名称",
    "visual": "本段实际可拍摄的画面与剧情变化",
    "action": "人物、动物或商品的明确动作",
    "spoken_line": "本段旁白或台词；不需要时为空字符串",
    "visual_proof": "画面如何证明本段广告信息；不得编造功效",
    "duration": 3
  }
}`;
}

function buildContext(body = {}) {
  return {
    current_blueprint: body.story_assist_context?.current_blueprint || body.current_blueprint || null,
    previous_beat: body.story_assist_context?.previous_beat || body.previous_beat || null,
    current_beat: body.story_assist_context?.current_beat || body.current_beat || body.beat || null,
    next_beat: body.story_assist_context?.next_beat || body.next_beat || null,
  };
}

function contextPrompt(context = {}) {
  return `当前剧情上下文：${JSON.stringify(context).slice(0, 18000)}\n只返回当前情节点。相邻情节点仅用于保持连续性，不得重写；结果先回填编辑器，必须由用户显式保存后才写入剧情蓝图。`;
}

function buildResponse(parsed, context = {}, mode, modelResult = {}) {
  const currentBeat = context?.current_beat && typeof context.current_beat === 'object' ? context.current_beat : {};
  return {
    story_beat: normalizeAssistedStoryBeat(parsed, currentBeat),
    mode,
    model_meta: {
      used_model: modelResult.used_model,
      fallback_used: modelResult.fallback_used,
      failed_models: modelResult.failed_models,
    },
  };
}

module.exports = { buildContext, buildResponse, contextPrompt, normalizeAssistedStoryBeat, outputSchema, systemRule };
