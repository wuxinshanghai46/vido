/** 把任意值整理为安全短文本。 */
function clean(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function enumValue(value, aliases = {}) {
  const raw = clean(value, 100);
  return aliases[raw.toLowerCase()] || aliases[raw] || raw;
}

function durationSeconds(value, fallback = 3) {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(1, Number(safe.toFixed(2)));
}

function referenceReady(reference = {}) {
  return !!clean(reference.analysis_id || reference.id, 120)
    && String(reference.status || '').toLowerCase() === 'completed'
    && reference.analysis_quality?.valid === true;
}

const SHOT_SIZE_ALIASES = {
  '大远景': 'extreme_wide', '远景': 'extreme_wide', '全景': 'wide', '全身景': 'full',
  '中景': 'medium', '中近景': 'medium_close', '特写': 'close_up', '大特写': 'extreme_close_up', '微距': 'macro',
};
const CAMERA_ANGLE_ALIASES = {
  '平视': 'eye_level', '俯拍': 'high_angle', '轻微俯拍': 'high_angle', '仰拍': 'low_angle',
  '顶拍': 'overhead', '倾斜镜头': 'dutch', '过肩视角': 'over_shoulder', '主观视角': 'pov',
};
const CAMERA_MOVEMENT_ALIASES = {
  '固定机位': 'static', '静止': 'static', '水平摇镜': 'pan', '摇镜': 'pan', '上下摇镜': 'tilt',
  '缓慢推进': 'dolly_in', '缓慢推近': 'dolly_in', '推进': 'dolly_in', '缓慢拉远': 'dolly_out',
  '跟随拍摄': 'tracking', '跟拍': 'tracking', '手持跟拍': 'handheld', '环绕拍摄': 'orbit',
};

/** 将参考视频故事证据投影为剧情室可编辑草稿，不冒充正式剧情蓝图。 */
function referenceBlueprintDraft(context = {}) {
  const reference = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  if (!referenceReady(reference)) return null;
  const sourceSeed = context.story_seed && typeof context.story_seed === 'object' ? context.story_seed : {};
  const seed = sourceSeed.source === 'reference_analysis_projection' || sourceSeed.projection_only === true
    ? sourceSeed
    : {};
  const outline = reference.story_outline && typeof reference.story_outline === 'object'
    ? reference.story_outline
    : seed;
  const rawBeats = list(seed.plot_beats).length ? list(seed.plot_beats) : list(reference.plot_beats);
  const phaseBeats = [
    ['开场', outline.opening],
    ['发展', outline.development],
    ['转折', outline.turning_point],
    ['收束', outline.resolution],
  ].filter(([, value]) => clean(value, 1200));
  const beats = (rawBeats.length ? rawBeats : phaseBeats.map(([title, visual]) => ({ title, visual })))
    .slice(0, 40)
    .map((item, index) => {
      const range = Array.isArray(item.range) ? item.range.map(Number) : [];
      const duration = range.length >= 2 && range.every(Number.isFinite)
        ? durationSeconds(range[1] - range[0])
        : durationSeconds(item.duration || item.duration_sec || 3);
      return {
        ...item,
        index: index + 1,
        beat_index: index + 1,
        title: clean(item.title || item.role || `情节点 ${index + 1}`, 120),
        visual: clean(item.visual || item.plot || item.content || item.purpose, 1200),
        plot: clean(item.plot || item.visual || item.content || item.purpose, 1200),
        action: clean(item.action || item.character_action, 600),
        duration,
        duration_sec: duration,
        spoken_line: clean(item.spoken_line || item.voiceover || item.narration, 600),
        visual_proof: clean(item.visual_proof || item.purpose, 600),
        source: 'reference_analysis_projection',
        projection_only: true,
      };
    });
  const logline = clean(seed.logline || outline.logline || reference.generated_brief, 2200);
  if (!logline && !beats.length) return null;
  return {
    story_title: clean(seed.story_title || outline.title || '参考视频故事草稿', 160),
    logline,
    summary: clean(reference.generated_brief || logline, 2200),
    beats,
    characters: list(context.cast_profiles).slice(0, 12).map((item, index) => ({
      id: clean(item.id || `reference-character-${index + 1}`, 100),
      name: clean(item.name || item.displayName || item.role || `人物 ${index + 1}`, 120),
      role: clean(item.role || item.roleName, 180),
    })),
    source: 'reference_analysis_projection',
    projection_only: true,
  };
}

/** 将参考视频逐镜证据投影为分镜台/镜头设计可编辑草稿。 */
function referenceStoryboardDraft(context = {}) {
  const reference = context.reference_video_analysis && typeof context.reference_video_analysis === 'object'
    ? context.reference_video_analysis
    : {};
  if (!referenceReady(reference)) return [];
  const intents = list(reference.camera_intents);
  return list(reference.shot_breakdown).slice(0, 200).map((item, index) => {
    const intent = intents[index] || {};
    const range = Array.isArray(item.range) ? item.range.map(Number) : [];
    const duration = durationSeconds(item.duration_seconds || item.duration || item.duration_sec
      || (range.length >= 2 && range.every(Number.isFinite) ? range[1] - range[0] : 3));
    const shotIndex = Math.max(1, Number(item.order || item.shot_index || item.index || index + 1) || index + 1);
    const visual = clean(item.visual || item.visual_description || item.purpose, 1600);
    const action = clean(item.action || item.character_action || item.purpose || visual, 800);
    const entryFrameState = clean(
      item.entry_frame_state || item.entry || item.start_state || `镜头开始：${visual}`,
      900,
    );
    const exitFrameState = clean(
      item.exit_frame_state || item.exit || item.end_state || `镜头结束：${action || visual}`,
      900,
    );
    return {
      ...item,
      id: clean(item.shot_id || item.id || `reference-shot-${shotIndex}`, 120),
      shot_index: shotIndex,
      index: shotIndex,
      title: clean(item.title || item.purpose || `镜头 ${shotIndex}`, 160),
      visual,
      visual_description: visual,
      action,
      purpose: clean(item.purpose || intent.purpose, 500),
      duration,
      duration_sec: duration,
      scene_id: clean(item.scene_id, 120),
      character_ids: list(item.subject_ids || item.character_ids).slice(0, 20).map(id => clean(id, 100)),
      shot_size: enumValue(item.shot_size || item.framing || intent.shot_size || intent.framing, SHOT_SIZE_ALIASES),
      camera_angle: enumValue(item.camera_angle || item.angle || intent.camera_angle || intent.angle, CAMERA_ANGLE_ALIASES),
      camera_movement: enumValue(item.camera_movement || item.movement || intent.camera_movement || intent.movement, CAMERA_MOVEMENT_ALIASES),
      entry_frame_state: entryFrameState,
      exit_frame_state: exitFrameState,
      source: 'reference_analysis_projection',
      projection_only: true,
    };
  });
}

function storySection(context = {}, outputs = {}) {
  const blueprint = outputs.blueprint || null;
  const referenceDraft = blueprint ? null : referenceBlueprintDraft(context);
  return {
    setup: context.story_setup || null,
    blueprint,
    reference_draft: referenceDraft,
    status: blueprint ? 'ready' : (referenceDraft ? 'reference_draft' : 'empty'),
  };
}

function storyboardSection(context = {}, outputs = {}, raw = {}) {
  const savedShots = list(outputs.storyboard_table).slice(0, 200);
  const referenceDraft = savedShots.length ? [] : referenceStoryboardDraft(context);
  return {
    shots: savedShots.length ? savedShots : referenceDraft,
    reference_draft: referenceDraft,
    source: savedShots.length ? 'saved_storyboard' : (referenceDraft.length ? 'reference_analysis_projection' : 'empty'),
    images: list(outputs.storyboard_images).slice(0, 200),
    image_batch: outputs.storyboard_image_batch && typeof outputs.storyboard_image_batch === 'object'
      ? outputs.storyboard_image_batch
      : null,
    status: raw.storyboard_status || null,
    continuity: list(outputs.continuity_contracts || outputs.keyframe_contracts).slice(0, 200),
  };
}

function storyFlowSection(taskId, outputs = {}) {
  return {
    contract: outputs.story_flow_contract && typeof outputs.story_flow_contract === 'object' ? outputs.story_flow_contract : null,
    historical_sketches: list(outputs.story_flow_sketches).slice(0, 200),
    historical_batch: outputs.story_flow_sketch_batch && typeof outputs.story_flow_sketch_batch === 'object' ? outputs.story_flow_sketch_batch : null,
    gate: require('./storyFlowSketchGateService').inspect(taskId),
  };
}

module.exports = {
  referenceBlueprintDraft,
  referenceStoryboardDraft,
  referenceReady,
  storySection,
  storyFlowSection,
  storyboardSection,
};
