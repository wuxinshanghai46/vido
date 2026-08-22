const { cleanText } = require('./contextBuilder');

function normalizeAssistedStoryBeat(input = {}, current = {}) {
  const source = input?.story_beat || input?.storyBeat || input?.beat || input || {};
  const currentDuration = Number(current.duration || current.duration_sec || 3) || 3;
  const requestedDuration = Number(source.duration || source.duration_sec || currentDuration) || currentDuration;
  const list = value => (Array.isArray(value) ? value : (value ? [value] : [])).map(item => cleanText(item, 180)).filter(Boolean).slice(0, 12);
  return {
    title: cleanText(source.title || current.title || current.role || '未命名情节点', 120),
    visual: cleanText(source.visual || source.plot || current.visual || current.plot || '', 1200),
    action: cleanText(source.action || current.action || '', 600),
    spoken_line: cleanText(source.spoken_line || source.voiceover || current.spoken_line || current.voiceover || '', 600),
    visual_proof: cleanText(source.visual_proof || source.purpose || current.visual_proof || current.purpose || '', 600),
    duration: Math.max(1, Math.min(30, requestedDuration)),
    scene: cleanText(source.scene || current.scene || '', 180),
    shot_size: cleanText(source.shot_size || source.shot_type || current.shot_size || current.shot_type || '', 80),
    lighting_mood: cleanText(source.lighting_mood || current.lighting_mood || '', 240),
    camera_movement: cleanText(source.camera_movement || current.camera_movement || '', 240),
    camera_movement_notes: cleanText(source.camera_movement_notes || current.camera_movement_notes || '', 500),
    transition: cleanText(source.transition || current.transition || '', 160),
    sound_mode: cleanText(source.sound_mode || current.sound_mode || 'designed', 30),
    ambient_sound: cleanText(source.ambient_sound || current.ambient_sound || '', 300),
    sfx: list(source.sfx !== undefined ? source.sfx : current.sfx),
    music_cue: cleanText(source.music_cue || current.music_cue || '', 300),
    audio_bridge: cleanText(source.audio_bridge || current.audio_bridge || '', 300),
    explicit_silence_reason: cleanText(source.explicit_silence_reason || current.explicit_silence_reason || '', 300),
    speaker: cleanText(source.speaker || current.speaker || '', 120),
    speaker_id: cleanText(source.speaker_id || current.speaker_id || '', 80),
    speech_mode: cleanText(source.speech_mode || current.speech_mode || '', 30),
    voiceover_timing: cleanText(source.voiceover_timing || current.voiceover_timing || '', 300),
    prompt_notes: cleanText(source.prompt_notes || current.prompt_notes || '', 1200),
    keyframe_prompt_override: cleanText(source.keyframe_prompt_override || current.keyframe_prompt_override || '', 2400),
    video_prompt_override: cleanText(source.video_prompt_override || current.video_prompt_override || '', 2400),
    negative_prompt_override: cleanText(source.negative_prompt_override || current.negative_prompt_override || '', 1200),
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
    ,"scene": "明确场景"
    ,"shot_size": "景别"
    ,"lighting_mood": "光影氛围"
    ,"camera_movement": "运镜路径、方向与速度"
    ,"camera_movement_notes": "运镜执行细节"
    ,"transition": "转场"
    ,"sound_mode": "designed/ambient_only/silent"
    ,"ambient_sound": "环境底声"
    ,"sfx": ["与动作同步的音效"]
    ,"music_cue": "音乐情绪和进出点"
    ,"audio_bridge": "跨镜声音衔接"
    ,"explicit_silence_reason": "仅明确静默时填写"
    ,"speaker": "角色名或旁白"
    ,"speaker_id": "已有稳定角色ID；不得编造"
    ,"speech_mode": "dialogue/voiceover/silent"
    ,"voiceover_timing": "对白或旁白在镜头内的时间"
    ,"prompt_notes": "制作提示"
    ,"keyframe_prompt_override": "关键帧提示词覆盖，可为空"
    ,"video_prompt_override": "视频提示词覆盖，可为空"
    ,"negative_prompt_override": "负面提示词覆盖，可为空"
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
