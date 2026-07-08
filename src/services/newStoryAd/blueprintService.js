const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters } = require('./contextBuilder');

function desiredBeatCount(ctx = {}) {
  if (ctx.shot_count) return Math.max(1, Math.min(18, Number(ctx.shot_count) || 0));
  return 0;
}

function clean(value = '', max = 300) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/[，。；、,\s]*$/, '') : text;
}

function normalizeBlueprint(blueprint, ctx) {
  const bp = blueprint && typeof blueprint === 'object' ? blueprint : {};
  const beats = Array.isArray(bp.beats) ? bp.beats : [];
  const targetCount = desiredBeatCount(ctx);
  const characterSeed = `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`;
  return {
    story_title: bp.story_title || bp.title || `${ctx.product_subject}剧情广告`,
    logline: bp.logline || bp.synopsis || '',
    beat_style: bp.beat_style || 'content_driven_visual_beats',
    visual_requirements: Array.isArray(bp.visual_requirements) ? bp.visual_requirements.map(x => clean(x, 80)).filter(Boolean) : [],
    target_beat_count: Number(bp.target_beat_count || targetCount || beats.length || 0) || 0,
    segment_plan: Array.isArray(bp.segment_plan) ? bp.segment_plan : [],
    characters: normalizeCharacters(Array.isArray(bp.characters) && bp.characters.length ? bp.characters : ctx.characters, characterSeed),
    beats: beats.map((beat, idx) => ({
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
      spoken_line: clean(beat.spoken_line || beat.voiceover || beat.copy || '', 100),
      why_next: clean(beat.why_next || '', 120),
    })).filter(x => x.plot || x.story_visual || x.promo_visual || x.visual_proof || x.spoken_line),
    model_meta: bp.model_meta || {},
  };
}

async function generateBlueprint(ctx, { taskId = '' } = {}) {
  const targetCount = desiredBeatCount(ctx);
  const systemPrompt = [
    'You are the story blueprint writer for the New Story Ad module.',
    'Return strict JSON only. Do not write markdown or backend explanations.',
    'Do not use a fixed template, fixed large segments, or fixed shot count. The number of beats must follow the user brief content.',
    'First extract concrete user-provided story events, actions, selling points, proof points, emotional turns, and call-to-action moments. Each real filmable event becomes one beat.',
    'Duration only affects timing later; duration must not decide beat count. Only obey shot_count when the user explicitly provided it.',
    'Do not force every beat into a fixed "story + promotion" pair.',
    'Keep the blueprint concise. Each field must be filmable and specific, but do not write long prose.',
    'For each task, first infer which visual dimensions are needed by the user brief: story, character, product, material, space, UI, proof, comparison, emotion, brand, offer, process, result, or others.',
    'Each beat should include only the visual layers that are actually needed for that beat. Some beats may be pure product proof, some may be pure story reaction, some may combine several layers.',
    'The important rule is completeness relative to the user request, not a fixed set of columns.',
    'characters.name must be a task-local formal person name when a person appears. If the user did not provide a name, generate a fresh stable name for this task; never use role placeholders or descriptions such as "elegant woman", "customer", "presenter" as final names.',
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
  "target_beat_count": ${targetCount || 0},
  "segment_plan": [{"segment_id":"seg_1","name":"section","space_anchor":"fixed space or carrier","fixed_subjects":"fixed subjects/relationships","continuity_rules":["rules"]}],
  "characters": [{"name":"fresh stable formal person name for this task, generated when user did not provide one","role":"story function","gender":"female/male/unknown","description":"appearance, identity, behavior"}],
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
    "spoken_line": "natural line heard in final video",
    "why_next": "why the next beat follows"
  }]
}

${ctx.shot_count ? `Beat count must equal the user-specified ${ctx.shot_count} shots.` : 'Beat count is decided by user story content. Do not add or remove beats just to fill duration.'}
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
};
