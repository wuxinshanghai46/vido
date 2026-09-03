function text(value, max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return (Array.isArray(value) ? value : String(value || '').split(/[；;\n]/))
    .map(item => text(item, 300)).filter(Boolean);
}

function speechSummary(shot = {}) {
  const lines = Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : [];
  if (lines.length) return lines.map(line => `${text(line.speaker || (line.speech_mode === 'voiceover' ? '旁白' : ''), 80)}：${text(line.line || line.text, 500)}`).filter(item => !item.endsWith('：')).join('；');
  const line = text(shot.spoken_line || shot.voiceover || shot.narration, 700);
  return line ? `${text(shot.speaker || (shot.speech_mode === 'dialogue' ? '角色' : '旁白'), 80)}：${line}` : '无对白；保持自然环境声节奏';
}

function soundSummary(shot = {}) {
  if (shot.sound_mode === 'silent') return `刻意静默：${text(shot.explicit_silence_reason, 300) || '以静默强化当前情绪'}`;
  return [
    text(shot.sound_design, 600),
    text(shot.ambient_sound, 300) && `环境声：${text(shot.ambient_sound, 300)}`,
    list(shot.sfx).length && `动作音效：${list(shot.sfx).join('、')}`,
    text(shot.music_cue, 300) && `音乐：${text(shot.music_cue, 300)}`,
    text(shot.audio_bridge, 300) && `跨镜衔接：${text(shot.audio_bridge, 300)}`,
  ].filter(Boolean).join('；') || '保留与场景一致的自然底噪，不添加无关音乐或音效';
}

function graphShotProjection(graphShot = {}) {
  if (!graphShot || typeof graphShot !== 'object' || !graphShot.id) return null;
  return {
    id: graphShot.id, title: graphShot.title, duration: graphShot.duration_sec,
    scene: graphShot.scene_binding?.scene_id || '', shot_size: graphShot.camera_binding?.shot_size || '',
    composition: graphShot.camera_binding?.composition || '', camera_movement: graphShot.camera_binding?.movement || '',
    visual: graphShot.performance?.visual || '', action: graphShot.performance?.action || '',
    action_start: graphShot.character_bindings?.map(item => item.action_start).filter(Boolean).join('；'),
    action_end: graphShot.character_bindings?.map(item => item.action_end).filter(Boolean).join('；'),
    lighting_mood: graphShot.lighting_mood || '', transition: graphShot.transition || '',
    speech_mode: graphShot.audio?.speech_mode || '', speaker_id: graphShot.audio?.speaker_id || '',
    dialogue_lines: graphShot.audio?.dialogue_lines || [], ambient_sound: graphShot.audio?.ambient_sound || '',
    sfx: graphShot.audio?.sfx || [], music_cue: graphShot.audio?.music_cue || '', audio_bridge: graphShot.audio?.audio_bridge || '',
    production_graph_binding: graphShot,
  };
}

function compileKeyframeDirection(shot = {}, options = {}) {
  shot = graphShotProjection(options.productionGraphShot) || shot;
  const override = text(shot.keyframe_prompt_override, 2400);
  const lines = [
    `主体：${text(shot.visual || shot.visual_description || shot.content_prompt, 1400) || '严格呈现本镜头已确认的主体与可见事件'}`,
    `场景：${text(shot.scene || shot.location || options.sceneName, 300) || '沿用当前项目已绑定场景，不得切换到无关地点'}`,
    `景别与构图：${text(shot.shot_size || shot.shot_type, 120) || '按分镜景别'}；${text(shot.composition || shot.visual_proof, 600) || '主体层级清楚，关键证据完整可见，画面边缘无意外裁切'}`,
    `动作与状态：${text(shot.action || shot.visual_action, 900) || '保持符合剧情的自然静态起始状态'}`,
    `光影与氛围：${text(shot.lighting_mood, 500) || '延续场景既有光向、色温、曝光与情绪基调'}`,
    `对白与表演依据：${speechSummary(shot)}`,
    `制作重点：${text(shot.prompt_notes, 1200) || '忠实执行剧情，不自行增加人物、物体、文字、品牌或地点'}`,
    shot.production_graph_binding && `统一制作图谱绑定（唯一权威）：${text(JSON.stringify(shot.production_graph_binding), 3600)}`,
    text(shot.negative_prompt_override, 1200) && `禁止：${text(shot.negative_prompt_override, 1200)}`,
    override && `用户确认的关键帧最终提示词（最高优先级）：${override}`,
    '输出约束：单张电影级关键帧；人物、服装、产品、道具、场景结构、材质、光向和空间关系与项目权威资产保持一致；不生成水印、说明文字、分屏或参考图拼贴。',
  ];
  return lines.filter(Boolean).join('\n');
}

function compileVideoDirection(shot = {}, options = {}) {
  shot = graphShotProjection(options.productionGraphShot) || shot;
  const duration = Math.max(1, Math.min(15, Number(shot.duration || shot.duration_sec) || 3));
  const split = Number(Math.max(0.5, duration / 2).toFixed(1));
  const end = Number(duration.toFixed(1));
  const movement = text(shot.camera_movement || shot.camera, 300) || '固定镜头，保持构图稳定';
  const detail = text(shot.camera_movement_notes, 600);
  const override = text(shot.video_prompt_override, 2400);
  return [
    `时间段 0-${split} 秒：从已确认关键帧自然起势。画面：${text(shot.visual || shot.visual_description, 1200)}。动作：${text(shot.action || shot.visual_action, 900) || '主体保持自然微动'}。运镜：${movement}${detail ? `；${detail}` : ''}。`,
    `时间段 ${split}-${end} 秒：完成本镜头动作并形成可剪辑的稳定尾帧；保持人物站位、视线、物体状态和空间轴线连续。转场：${text(shot.transition, 300) || '按分镜硬切，不额外制造转场特效'}。`,
    `光影与氛围：${text(shot.lighting_mood, 500) || '全程锁定关键帧光向、色温、曝光和情绪，不闪烁、不漂移'}。`,
    require('./nativeAudioWorkflowService').prompt(shot),
    `声音设计：${soundSummary(shot)}。由视频模型随画面一起生成，遵循剧情和台词；后期仅在用户明确应用声音修改时替换。`,
    `禁止：不得改变主体身份、服装、产品、道具、场景几何、材质纹理和光影方向；不得新增无关人物、物体、文字、Logo、地点；不得抖动、变形、闪烁、穿模或瞬移。${text(shot.negative_prompt_override, 1200) ? ` ${text(shot.negative_prompt_override, 1200)}` : ''}`,
    `制作重点：${text(shot.prompt_notes, 1200) || '严格执行当前剧情和分镜，不自行扩写事件'}`,
    shot.production_graph_binding && `统一制作图谱绑定（唯一权威）：${text(JSON.stringify(shot.production_graph_binding), 3600)}`,
    override && `用户确认的视频最终提示词（最高优先级）：${override}`,
    `输出约束：时长 ${end} 秒；保持首帧构图与项目连续性合同；动作因果完整；尾帧可与下一镜头无缝剪辑。`,
  ].filter(Boolean).join('\n');
}

module.exports = { compileKeyframeDirection, compileVideoDirection, graphShotProjection, soundSummary, speechSummary };
