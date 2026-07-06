const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters, looksLikeDescriptorName } = require('./contextBuilder');

function clampText(value = '', max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/[，。；、,\s]*$/, '') : text;
}

function canonicalSpeakerName(name = '', characters = []) {
  const clean = clampText(name, 24);
  if (!clean || clean === '旁白') return clean || '旁白';
  const exact = characters.find(c => c.name === clean);
  if (exact) return exact.name;
  if (looksLikeDescriptorName(clean) && characters.length === 1) return characters[0].name;
  const byRole = characters.find(c => c.role && clean.includes(c.role));
  if (byRole) return byRole.name;
  return clean;
}

function normalizeDialogue(lines, voice = '', characters = []) {
  const list = Array.isArray(lines) ? lines : [];
  const normalized = list
    .map(item => ({
      speaker: canonicalSpeakerName(item?.speaker || '旁白', characters),
      line: clampText(item?.line || item?.text || '', 80),
    }))
    .filter(item => item.line);
  if (!normalized.length && voice) return [{ speaker: '旁白', line: clampText(voice, 80) }];
  return normalized.slice(0, 3);
}

function normalizeVisualLayers(shot = {}) {
  const layers = Array.isArray(shot.visual_layers) ? shot.visual_layers : [];
  const normalized = layers
    .map(layer => ({
      type: clampText(layer?.type || layer?.kind || '', 40),
      content: clampText(layer?.content || layer?.visual || layer?.description || '', 140),
    }))
    .filter(layer => layer.type || layer.content);
  const story = clampText(shot.story_visual || shot.story_moment || shot.character_moment || '', 140);
  const promo = clampText(shot.promo_visual || shot.product_visual || shot.commercial_visual || '', 140);
  if (story && !normalized.some(layer => layer.type === 'story')) normalized.push({ type: 'story', content: story });
  if (promo && !normalized.some(layer => layer.type === 'product' || layer.type === 'promo')) normalized.push({ type: 'product', content: promo });
  return normalized.slice(0, 5);
}

function joinVisualLayers({ shotType = '', visualLayers = [], visual = '' } = {}) {
  const parts = [];
  if (shotType) parts.push(shotType);
  visualLayers.forEach(layer => {
    if (layer.content) parts.push(`${layer.type || 'visual'}：${layer.content}`);
  });
  if (!visualLayers.length && visual) parts.push(visual);
  return clampText(parts.join('；'), 260);
}

function normalizeShot(shot, ctx, idx, defaultDuration = 3) {
  const characters = normalizeCharacters(ctx.characters || []);
  const n = Number(shot.index || shot.shot_index || idx + 1);
  const voice = clampText(shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || shot.text || '', 90);
  const shotType = clampText(shot.shot_type || shot.camera || shot.lens || '', 80);
  const visualLayers = normalizeVisualLayers(shot);
  const storyVisual = clampText(shot.story_visual || shot.story_moment || shot.character_moment || '', 140);
  const promoVisual = clampText(shot.promo_visual || shot.product_visual || shot.commercial_visual || shot.visual_proof || '', 140);
  const visualRaw = shot.visual || shot.content_prompt || shot.scene_content || '';
  const actionRaw = shot.action || shot.visual_action || '';
  const emotionalTurn = clampText(shot.emotional_turn || shot.emotion || shot.character_reaction || '', 80);
  const sellingPoint = clampText(shot.selling_point || shot.benefit || shot.value_point || '', 80);
  const keyframeNotes = clampText([
    emotionalTurn ? `情绪/转折：${emotionalTurn}` : '',
    sellingPoint ? `宣传卖点：${sellingPoint}` : '',
    shot.keyframe_notes || '',
  ].filter(Boolean).join('；'), 220);
  return {
    index: n,
    title: clampText(shot.title || `镜头 ${n}`, 40),
    role: clampText(shot.role || shot.story_stage || shot.purpose || '', 40),
    duration: Math.max(2, Math.min(6, Number(shot.duration || shot.duration_sec || 0) || defaultDuration)),
    purpose: clampText(shot.purpose || shot.script_purpose || shot.objective || shot.role || '', 40),
    subject_type: shot.subject_type || shot.subjectType || 'auto',
    shot_type: shotType,
    visual_layers: visualLayers,
    story_visual: storyVisual,
    promo_visual: promoVisual,
    emotional_turn: emotionalTurn,
    selling_point: sellingPoint,
    visual: joinVisualLayers({ shotType, visualLayers, visual: visualRaw }),
    action: clampText(actionRaw, 120),
    voiceover: voice,
    dialogue_lines: normalizeDialogue(shot.dialogue_lines, voice, characters),
    characters: Array.isArray(shot.characters) ? shot.characters.slice(0, 4).map(c => ({
      name: canonicalSpeakerName(c?.name || '', characters),
      action: clampText(c?.action || '', 80),
    })).filter(c => c.name || c.action) : [],
    material_usage: clampText(shot.material_usage || promoVisual || visualLayers.find(layer => /product|material|proof|brand|offer|result/i.test(layer.type))?.content || '', 160),
    keyframe_notes: keyframeNotes || clampText(shot.keyframe_notes || '', 180),
  };
}

function normalizeDurations(shots, ctx) {
  if (!shots.length) return shots;
  const target = Math.max(10, Math.min(120, Number(ctx.target_duration || 30) || 30));
  const base = Math.max(2, Math.min(5, Math.round(target / shots.length)));
  let rows = shots.map((shot, idx) => normalizeShot(shot, ctx, idx, base));
  let total = rows.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  let guard = 0;

  while (total > target && guard < 200) {
    const item = rows.find(shot => shot.duration > 2);
    if (!item) break;
    item.duration -= 1;
    total -= 1;
    guard += 1;
  }

  while (total < target && guard < 400) {
    const item = rows.find(shot => shot.duration < 6);
    if (!item) break;
    item.duration += 1;
    total += 1;
    guard += 1;
  }

  return rows;
}

function normalizeShots(rows, ctx) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .sort((a, b) => Number(a?.index || a?.shot_index || 0) - Number(b?.index || b?.shot_index || 0));
  return normalizeDurations(sorted, ctx).map((shot, idx) => ({ ...shot, index: idx + 1 }));
}

function chunksOf(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function plannedBeats(blueprint, ctx) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const target = ctx.shot_count ? Math.max(1, Math.min(18, Number(ctx.shot_count) || 0)) : 0;

  if (target && beats.length !== target) {
    const out = [];
    for (let i = 0; i < target; i += 1) {
      const source = beats[i] || beats[beats.length - 1] || { beat_index: i + 1, role: 'story', plot: ctx.brief, spoken_line: '' };
      out.push({ ...source, beat_index: i + 1 });
    }
    return out;
  }

  return beats.length ? beats : [{ beat_index: 1, role: 'story', plot: ctx.brief, spoken_line: '' }];
}

async function generateStoryboardTable(ctx, blueprint, { taskId = '' } = {}) {
  const beats = plannedBeats(blueprint, ctx);
  const beatChunks = chunksOf(beats, beats.length > 8 ? 3 : 4);
  const all = [];
  const meta = [];

  for (const chunk of beatChunks) {
    const systemPrompt = [
      'You are the storyboard table writer for New Story Ad. Return a JSON array only.',
      'Do not force fixed segments, fixed template, or fixed shot count. Shots must follow the user story content.',
      'Each input beat must produce one corresponding shot.',
      'Do not force every shot into a fixed story_visual + promo_visual pair.',
      'For each shot, choose the visual layers required by the user brief and blueprint: story, character, product, material, space, UI, proof, comparison, emotion, brand, offer, process, result, or other.',
      'Some shots may need only product/material proof, some may need story/emotion, some may need comparison or brand result. Follow the actual user request.',
      'Use visual_layers as the source of truth; story_visual and promo_visual are optional compatibility fields only.',
      'Never invent an unmentioned product feature, character, prop, industry, or scene.',
      'Character names must use the stable names from blueprint.characters. Do not use descriptors as name or speaker.',
      'voiceover must be a natural short line that can be heard in the final video.',
    ].join('\n');

    const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 14000)}

Current beats: ${JSON.stringify(chunk)}

Return JSON array for current beats only. Fields:
{
  "index": 1,
  "title": "shot title",
  "role": "story function",
  "duration": 3,
  "purpose": "short label",
  "subject_type": "human_scene/product_only/ui_screen/proof_scene/environment/brand_endcard",
  "shot_type": "medium / close_up / insert / product_detail / reaction / endcard",
  "visual_layers": [{"type":"story/product/material/space/ui/proof/comparison/emotion/brand/offer/process/result/other","content":"specific visual content"}],
  "story_visual": "optional, only if this shot needs story/character/emotion",
  "promo_visual": "optional, only if this shot needs product/service/brand proof",
  "emotional_turn": "emotion or story change",
  "selling_point": "commercial point proved here",
  "visual": "combined visible frame if needed",
  "action": "who does what",
  "voiceover": "natural short line",
  "dialogue_lines": [{"speaker":"stable character name or narrator","line":"line"}],
  "characters": [{"name":"stable character name","action":"this shot action"}],
  "material_usage": "materials/evidence used",
  "keyframe_notes": "subject, proof and composition to lock for keyframe"
}`;

    const result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.storyboard_table',
      systemPrompt,
      userPrompt,
      maxTokens: 8000,
    });

    const parsed = await jsonRepair.parseOrRepair({
      raw: result.text,
      expected: 'array',
      modelGateway,
      taskId,
      stage: 'new_story_ad.json_repair',
    });

    all.push(...parsed);
    meta.push({
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
    });
  }

  const shots = normalizeShots(all, {
    ...ctx,
    characters: normalizeCharacters(Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters),
  });
  return { shots, model_meta: meta };
}

async function rewriteStoryboard(ctx, blueprint, shots, issues, { taskId = '' } = {}) {
  if (!Array.isArray(issues) || !issues.length) return shots;

  const systemPrompt = [
    'You are the storyboard rewrite agent. Return the full JSON array only.',
    'Keep shot count, characters, advertised subject, and story order.',
    'Do not add new story events that the user did not provide.',
    'Fix thin shots by strengthening the visual layers required by the user brief.',
    'Keep the requested commercial, story, product, proof, brand, UI, space, emotion or comparison dimensions visible as applicable.',
  ].join('\n');

  const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 10000)}
Current storyboard: ${JSON.stringify(shots).slice(0, 22000)}
Issues to fix: ${issues.slice(0, 30).join('; ')}

Return the repaired full JSON array. Do not change shot count. Do not invent unprovided plot.`;

  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.storyboard_rewrite',
    systemPrompt,
    userPrompt,
    maxTokens: 10000,
  });

  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'array',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });

  return normalizeShots(parsed, {
    ...ctx,
    characters: normalizeCharacters(Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters),
  });
}

module.exports = {
  generateStoryboardTable,
  rewriteStoryboard,
  normalizeShots,
};
