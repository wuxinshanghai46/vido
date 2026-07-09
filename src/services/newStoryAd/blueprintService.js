const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters } = require('./contextBuilder');

function desiredBeatCount(ctx = {}) {
  if (ctx.shot_count) return Math.max(1, Math.min(18, Number(ctx.shot_count) || 0));
  return 0;
}

function explicitSegmentCount(ctx = {}) {
  const brief = [
    ctx.brief,
    ctx.original_brief,
    ctx.story_structure,
  ].filter(Boolean).join(' ');
  const structureText = (brief.match(/(?:剧情结构|脚本结构|分镜结构|内容结构|结构)\s*[:：]?([\s\S]{0,1800})/) || [])[1] || brief;
  const nums = [];
  const re = /(?:^|[\s。；;，,])([1-9]|1[0-8])\s*[\.、．:：]/g;
  let match;
  while ((match = re.exec(structureText))) nums.push(Number(match[1]));
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  if (unique.length < 3) return 0;
  for (let i = 0; i < unique.length; i += 1) {
    if (unique[i] !== i + 1) return 0;
  }
  return unique.length;
}

function pacingProfile(ctx = {}) {
  const exactCount = desiredBeatCount(ctx);
  const targetDuration = Math.max(10, Math.min(180, Number(ctx.target_duration || ctx.duration || ctx.duration_sec || 30) || 30));
  const explicitSegments = explicitSegmentCount(ctx);
  const brief = [
    ctx.brief,
    ctx.original_brief,
    ctx.product_subject,
    ctx.scene_goal,
    ctx.business_boundary,
  ].filter(Boolean).join(' ');
  const fastCut = /快剪|快速剪辑|高频切换|混剪|闪切|多镜头|镜头密集|快速切换|montage/i.test(brief);
  const processHeavy = /步骤|流程|过程|教程|演示|对比|前后|先.*再|第一|第二|第三|第四|然后|接着|最后/.test(brief);
  const eventSignals = (brief.match(/步骤|流程|过程|对比|前后|痛点|解决|证明|展示|介绍|然后|接着|最后|第一|第二|第三|第四|[；;]/g) || []).length;
  // 剧情广告必须通用：这里不按行业/场景写死镜头数，只按用户内容密度和单镜可理解时长推导节奏。
  const minimumSecondsPerBeat = fastCut ? 2.4 : (processHeavy || eventSignals >= 5 ? 3.4 : 4.2);
  const preferredSecondsPerBeat = fastCut ? 3.0 : (processHeavy || eventSignals >= 5 ? 4.0 : 5.0);
  const durationRecommended = Math.max(3, Math.min(18, Math.round(targetDuration / preferredSecondsPerBeat)));
  const recommended = exactCount || explicitSegments || durationRecommended;
  const durationLimit = Math.min(18, Math.floor(targetDuration / minimumSecondsPerBeat));
  const structureLimit = explicitSegments ? Math.min(18, explicitSegments + (fastCut ? 2 : 1)) : 18;
  const maxReasonable = exactCount || Math.max(recommended, Math.min(durationLimit, structureLimit));
  return {
    exactCount,
    targetDuration,
    explicitSegments,
    fastCut,
    processHeavy,
    eventSignals,
    minimumSecondsPerBeat,
    preferredSecondsPerBeat,
    recommended,
    maxReasonable,
  };
}

function recommendedBeatCount(ctx = {}) {
  return pacingProfile(ctx).recommended;
}

function softBeatLimit(ctx = {}) {
  return pacingProfile(ctx).maxReasonable;
}

function clean(value = '', max = 300) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/[，。；、,\s]*$/, '') : text;
}

function cleanSpeech(value = '', max = 100) {
  return clean(value, max).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
}

function fallbackSpokenLine(beat = {}, idx = 0, ctx = {}) {
  const proof = clean(beat.visual_proof || beat.evidence || beat.selling_point || beat.benefit || '', 42);
  const action = clean(beat.action || beat.solution_step || beat.plot || beat.story_visual || beat.promo_visual || '', 42);
  const subject = clean(ctx.product_subject || '这个主体', 20);
  if (proof) return `这一镜看清${proof}。`;
  if (action) return `先看${action}。`;
  return `继续看${subject}的关键变化。`;
}

function mergeText(values = [], max = 180) {
  const seen = new Set();
  return clean(values
    .map(value => clean(value, max))
    .filter(Boolean)
    .filter(value => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .join('；'), max);
}

function mergeBeatGroup(group = [], index = 0) {
  if (group.length <= 1) return { ...(group[0] || {}), beat_index: index + 1 };
  const first = group[0] || {};
  const last = group[group.length - 1] || first;
  return {
    ...first,
    beat_index: index + 1,
    role: mergeText(group.map(beat => beat.role), 50) || first.role || 'story',
    scene: first.scene || last.scene || '',
    shot_type: first.shot_type || last.shot_type || '',
    plot: mergeText(group.map(beat => beat.plot), 180),
    visual_layers: group.flatMap(beat => Array.isArray(beat.visual_layers) ? beat.visual_layers : []).slice(0, 8),
    story_visual: mergeText(group.map(beat => beat.story_visual), 180),
    promo_visual: mergeText(group.map(beat => beat.promo_visual), 180),
    emotional_turn: mergeText(group.map(beat => beat.emotional_turn), 120),
    selling_point: mergeText(group.map(beat => beat.selling_point), 120),
    visual_proof: mergeText(group.map(beat => beat.visual_proof), 180),
    action: mergeText(group.map(beat => beat.action), 120),
    spoken_line: mergeText(group.map(beat => beat.spoken_line).slice(0, 2), 100) || first.spoken_line || last.spoken_line || '',
    why_next: last.why_next || first.why_next || '',
  };
}

function compactBeatsByPacing(beats = [], limit = 18) {
  const max = Math.max(1, Math.min(18, Number(limit) || 18));
  if (beats.length <= max) return beats.map((beat, idx) => ({ ...beat, beat_index: idx + 1 }));
  const groups = Array.from({ length: max }, () => []);
  beats.forEach((beat, idx) => {
    const groupIndex = Math.min(max - 1, Math.floor((idx * max) / beats.length));
    groups[groupIndex].push(beat);
  });
  return groups.filter(group => group.length).map((group, idx) => mergeBeatGroup(group, idx));
}

function normalizeBlueprint(blueprint, ctx) {
  const bp = blueprint && typeof blueprint === 'object' ? blueprint : {};
  const beats = Array.isArray(bp.beats) ? bp.beats : [];
  const targetCount = desiredBeatCount(ctx);
  const profile = pacingProfile(ctx);
  const recommendedCount = profile.recommended;
  const beatLimit = profile.maxReasonable;
  const characterSeed = `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`;
  const noHuman = ctx.cast_mode === 'no_human';
  const normalizedBeats = beats.map((beat, idx) => ({
    beat_index: Number(beat.beat_index || beat.index || idx + 1),
    role: clean(beat.role || beat.story_role || 'story', 50),
    subject_type: beat.subject_type || 'auto',
    scene: clean(beat.scene || beat.location || '', 120),
    shot_type: clean(beat.shot_type || beat.camera || '', 80),
    plot: clean(beat.plot || beat.event || beat.description || '', 180),
    visual_layers: Array.isArray(beat.visual_layers) ? beat.visual_layers.map(layer => ({
      type: clean(layer?.type || layer?.kind || '', 40),
      content: clean(layer?.content || layer?.visual || layer?.description || '', 180),
    })).filter(layer => layer.type || layer.content) : [],
    story_visual: clean(beat.story_visual || beat.story_moment || '', 180),
    promo_visual: clean(beat.promo_visual || beat.product_visual || '', 180),
    emotional_turn: clean(beat.emotional_turn || beat.emotion || beat.character_reaction || '', 120),
    selling_point: clean(beat.selling_point || beat.benefit || beat.value_point || '', 120),
    visual_proof: clean(beat.visual_proof || beat.evidence || beat.promo_visual || '', 180),
    action: clean(beat.action || beat.solution_step || '', 120),
    spoken_line: cleanSpeech(beat.spoken_line || beat.voiceover || beat.copy || fallbackSpokenLine(beat, idx, ctx), 100),
    why_next: clean(beat.why_next || '', 120),
  })).filter(x => x.plot || x.story_visual || x.promo_visual || x.visual_proof || x.spoken_line);
  const limitedBeats = compactBeatsByPacing(normalizedBeats, beatLimit);
  return {
    story_title: bp.story_title || bp.title || `${ctx.product_subject}剧情广告`,
    logline: bp.logline || bp.synopsis || '',
    beat_style: bp.beat_style || 'content_driven_visual_beats',
    visual_requirements: Array.isArray(bp.visual_requirements) ? bp.visual_requirements.map(x => clean(x, 80)).filter(Boolean) : [],
    target_beat_count: Number(targetCount || limitedBeats.length || recommendedCount || 0) || 0,
    segment_plan: Array.isArray(bp.segment_plan) ? bp.segment_plan : [],
    characters: noHuman ? [] : normalizeCharacters(Array.isArray(bp.characters) && bp.characters.length ? bp.characters : ctx.characters, characterSeed),
    beats: limitedBeats,
    model_meta: bp.model_meta || {},
  };
}

async function generateBlueprint(ctx, { taskId = '' } = {}) {
  const targetCount = desiredBeatCount(ctx);
  const profile = pacingProfile(ctx);
  const recommendedCount = profile.recommended;
  const beatLimit = profile.maxReasonable;
  const systemPrompt = [
    'You are the story blueprint writer for the New Story Ad module.',
    'Return strict JSON only. Do not write markdown or backend explanations.',
    'Do not use a fixed template, fixed large segments, or fixed shot count. The number of beats must follow the user brief content, event density and pacing.',
    'First extract concrete user-provided story events, actions, selling points, proof points, emotional turns, and call-to-action moments. Each real filmable event becomes one beat.',
    'Duration is a pacing constraint, not a fixed template. Only obey shot_count when the user explicitly provided it.',
    `Current content pacing analysis: target duration ${profile.targetDuration}s, recommended compact beat count around ${recommendedCount}, reasonable upper bound ${beatLimit}, fast-cut requested: ${profile.fastCut ? 'yes' : 'no'}, multi-step/process-heavy: ${profile.processHeavy ? 'yes' : 'no'}.`,
    'If the user did not explicitly ask for fast cuts or many separate steps, merge small UI moves, tiny proof points, repeated actions and repeated visual details into one stronger beat instead of splitting them.',
    'If the user brief truly contains many independent steps or explicitly asks for fast montage, you may use more beats within the reasonable upper bound.',
    'Do not force every beat into a fixed "story + promotion" pair.',
    'Keep the blueprint concise. Each field must be filmable and specific, but do not write long prose.',
    'For each task, first infer which visual dimensions are needed by the user brief: story, character, product, material, space, UI, proof, comparison, emotion, brand, offer, process, result, or others.',
    'Each beat should include only the visual layers that are actually needed for that beat. Some beats may be pure product proof, some may be pure story reaction, some may combine several layers.',
    'The important rule is completeness relative to the user request, not a fixed set of columns.',
    'characters.name must be a task-local formal person name when a person appears. If the user did not provide a name, generate a fresh stable name for this task; never use role placeholders or descriptions such as "elegant woman", "customer", "presenter" as final names.',
    'If cast_mode is no_human, characters must be an empty array and beats must not introduce human body parts, backs, silhouettes, hands, presenters, models or crowds unless the user explicitly asked for them.',
    'If cast_mode is animal, treat the animal/pet as the subject required by the user brief and do not convert it into a human presenter.',
    'Every beat must include spoken_line. If the picture is a silent product, space, UI or proof shot, write a short narrator line instead of leaving it blank.',
    'spoken_line is not a subtitle field. It must contain the final words for dialogue or narrator voice only, without any prefix such as "字幕:", "旁白:", "台词:", "解说:" or speaker-type tags.',
    'If Advanced production controls are enabled, obey scene direction, product presentation methods, style direction and negative requirements as hard constraints.',
    'When product presentation is enabled, each suitable beat must reserve a visible product/proof/material role according to presence and lock strength.',
    'Never put explicitly forbidden people, objects, carrier forms, styles or wrong products into beats.',
  ].join('\n');

  const userPrompt = `${contextPrompt(ctx)}

Return JSON in this shape:
{
  "story_title": "title",
  "logline": "one sentence story",
  "beat_style": "content_driven_visual_beats",
  "visual_requirements": ["story", "product", "material", "proof"],
  "target_beat_count": ${targetCount || recommendedCount || 0},
  "segment_plan": [{"segment_id":"seg_1","name":"section","space_anchor":"fixed space or carrier","fixed_subjects":"fixed subjects/relationships","continuity_rules":["rules"]}],
  "characters": [{"name":"fresh stable formal person name for this task when a human appears; empty array for no_human mode","role":"story function","gender":"female/male/unknown","description":"appearance, identity, behavior"}],
  "beats": [{
    "beat_index": 1,
    "role": "story function label",
    "subject_type": "human_scene/product_only/ui_screen/proof_scene/environment/brand_endcard/auto",
    "scene": "place or carrier",
    "shot_type": "medium / close_up / insert / product_detail / reaction / endcard",
    "plot": "what happens in this beat",
    "visual_layers": [{"type":"story/product/material/space/ui/proof/comparison/emotion/brand/offer/process/result/other","content":"specific visual content needed for this beat"}],
    "story_visual": "optional narrative picture if this beat needs story",
    "promo_visual": "optional commercial picture if this beat needs product/service/brand proof",
    "emotional_turn": "what the viewer feels or what changes in the character",
    "selling_point": "commercial point proved by this beat",
    "visual_proof": "visible proof",
    "action": "who does what",
    "spoken_line": "natural line heard in final video, without label prefix",
    "why_next": "why the next beat follows"
  }]
}

${ctx.shot_count ? `Beat count must equal the user-specified ${ctx.shot_count} shots.` : `Beat count is content-driven. Do not force the exact recommended number, but keep the result compact for the target duration; normal shots should have enough time to be understood, and only explicit fast-cut or dense step-by-step briefs should approach the upper bound ${beatLimit}.`}
For multi-person stories, keep names, roles, relationships and speaker ownership stable across all beats.`;

  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.blueprint',
    systemPrompt,
    userPrompt,
    maxTokens: 5200,
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  const normalized = normalizeBlueprint(parsed, ctx);
  normalized.model_meta = {
    used_model: result.used_model,
    fallback_used: result.fallback_used,
    failed_models: result.failed_models,
  };
  return normalized;
}

module.exports = {
  generateBlueprint,
  normalizeBlueprint,
  desiredBeatCount,
  pacingProfile,
  recommendedBeatCount,
  softBeatLimit,
};

