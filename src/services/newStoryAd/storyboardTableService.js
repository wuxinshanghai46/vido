const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters, looksLikeDescriptorName } = require('./contextBuilder');
const { bindShotsToScenes, sceneBindingPrompt } = require('./sceneBindingService');
const { withContinuityContracts } = require('./continuityService');
const shotDesign = require('./shotDesignService');
const temporalEvidenceGraph = require('./temporalEvidenceGraphService');

const { ensureChineseOutput } = require('./outputLanguageService');

function clampText(value = '', max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).replace(/[，。；、,\s]*$/, '') : text;
}

function cleanSpeech(value = '', max = 90) {
  return clampText(value, max).replace(/^(?:字幕|屏幕字幕|字幕文案|旁白|台词|对白|解说|画外音|配音)\s*[:：]\s*/i, '').trim();
}

function normalizeSpeechMode(value = '') {
  const mode = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['on_camera', 'on_camera_dialogue', 'visible_dialogue', 'speaking', 'lip_sync'].includes(mode)) return 'on_camera_dialogue';
  if (['silent', 'mute', 'no_speech'].includes(mode)) return 'silent';
  return 'offscreen_voiceover';
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
      line: cleanSpeech(item?.line || item?.text || '', 80),
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

function fallbackVoiceover(shot = {}, idx = 0, ctx = {}) {
  const proof = clampText(shot.visual_proof || shot.evidence || shot.purpose || shot.objective || shot.selling_point || '', 42);
  const visual = clampText(shot.visual || shot.story_visual || shot.promo_visual || shot.content_prompt || shot.action || '', 42);
  const subject = clampText(ctx.product_subject || '当前主体', 20);
  if (proof) return `这一镜看清${proof}。`;
  if (visual) return `先看${visual}。`;
  return `继续看${subject}的第 ${idx + 1} 个关键画面。`;
}

function normalizeShot(shot, ctx, idx, defaultDuration = 3) {
  const characters = normalizeCharacters(ctx.characters || [], `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`);
  const n = Number(shot.index || shot.shot_index || idx + 1);
  const blueprintSpokenLine = cleanSpeech(shot.blueprint_spoken_line || '', 90);
  const voice = cleanSpeech(blueprintSpokenLine || shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || shot.text || fallbackVoiceover(shot, idx, ctx), 90);
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
  const design = shotDesign.normalizeShotDesign(shot);
  const speechMode = normalizeSpeechMode(shot.speech_mode || shot.speechMode || shot.on_screen_speech_mode);
  const proposedDialogue = normalizeDialogue(shot.dialogue_lines, voice, characters);
  const dialogueLines = blueprintSpokenLine
    ? [{
      speaker: speechMode === 'on_camera_dialogue' ? (proposedDialogue[0]?.speaker || characters[0]?.name || '旁白') : '旁白',
      line: blueprintSpokenLine,
    }]
    : proposedDialogue;
  const normalized = {
    storyboard_quality_policy_version: 2,
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
    speech_mode: speechMode,
    dialogue_function: clampText(shot.dialogue_function || shot.dialogue_intent || '', 40),
    blueprint_spoken_line: blueprintSpokenLine,
    voiceover: voice,
    dialogue_lines: dialogueLines,
    characters: Array.isArray(shot.characters) ? shot.characters.slice(0, 4).map(c => ({
      name: canonicalSpeakerName(c?.name || '', characters),
      action: clampText(c?.action || '', 80),
    })).filter(c => c.name || c.action) : [],
    material_usage: clampText(shot.material_usage || promoVisual || visualLayers.find(layer => /product|material|proof|brand|offer|result/i.test(layer.type))?.content || '', 160),
    keyframe_notes: keyframeNotes || clampText(shot.keyframe_notes || '', 180),
    scene_id: clampText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', 120),
    scene_asset_id: clampText(shot.scene_asset_id || shot.sceneAssetId || shot.scene_id || shot.sceneId || '', 120),
    scene_name: clampText(shot.scene_name || shot.sceneName || '', 120),
    scene_view: clampText(shot.scene_view || shot.sceneView || '', 40),
    scene_zone: clampText(shot.scene_zone || shot.sceneZone || shot.zone || '', 160),
    scene_zone_id: clampText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : '') || '', 100),
    scene_zone_label_zh: clampText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || shot.sceneZone || shot.zone || '', 160),
    scene_revision: Math.max(1, Number(shot.scene_revision || shot.sceneRevision || 1) || 1),
    camera_id: clampText(shot.camera_id || shot.cameraId || '', 100),
    zone_ids: (Array.isArray(shot.zone_ids) ? shot.zone_ids : []).map(value => clampText(value, 100)).filter(Boolean).slice(0, 16),
    anchor_ids: (Array.isArray(shot.anchor_ids) ? shot.anchor_ids : []).map(value => clampText(value, 100)).filter(Boolean).slice(0, 24),
    transition_from: clampText(shot.transition_from || shot.transitionFrom || '', 120),
    transition_reason: clampText(shot.transition_reason || shot.transitionReason || '', 240),
    entry_frame_state: clampText(shot.entry_frame_state || shot.entryFrameState || '', 240),
    exit_frame_state: clampText(shot.exit_frame_state || shot.exitFrameState || '', 240),
    action_start: clampText(shot.action_start || shot.actionStart || '', 180),
    action_end: clampText(shot.action_end || shot.actionEnd || '', 180),
    screen_direction: clampText(shot.screen_direction || shot.screenDirection || '', 80),
    eyeline: clampText(shot.eyeline || shot.eyeLine || '', 100),
    camera_axis: clampText(shot.camera_axis || shot.cameraAxis || '', 100),
    camera_movement: clampText(shot.camera_movement || shot.cameraMovement || '', 140),
    shot_size: clampText(shot.shot_size || shot.shotSize || '', 40),
    camera_angle: clampText(shot.camera_angle || shot.cameraAngle || '', 40),
    lens_mm: Math.max(0, Math.min(300, Number(shot.lens_mm || shot.lensMm || 0) || 0)),
    depth_of_field: clampText(shot.depth_of_field || shot.depthOfField || '', 40),
    composition: clampText(shot.composition || '', 80),
    subject_position: clampText(shot.subject_position || shot.subjectPosition || '', 80),
    object_states: shotDesign.structuredText(shot.object_states || shot.objectStates || '', 240),
    transition_type: clampText(shot.transition_type || shot.transitionType || shot.transition || '', 40),
    requires_previous_frame: shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
      || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true',
    audio_bridge: clampText(shot.audio_bridge || shot.audioBridge || '', 160),
    ambient_sound: clampText(shot.ambient_sound || shot.ambientSound || '', 180),
    sfx: (Array.isArray(shot.sfx) ? shot.sfx : String(shot.sfx || '').split(/[,，；;]/)).map(value => clampText(value, 100)).filter(Boolean).slice(0, 12),
    music_cue: clampText(shot.music_cue || shot.musicCue || '', 180),
    voiceover_timing: clampText(shot.voiceover_timing || shot.voiceoverTiming || '', 120),
    shot_scope: design.shot_scope,
    surface_topology: design.surface_topology,
    motion_effect: design.motion_effect,
    // V2.0 允许模型直接描述任意行业的状态、变化、证据和连续性约束；
    // 这里仅做开放结构归一化，不把内容限制为预设行业或预设场景。
    temporal_state: temporalEvidenceGraph.normalizeShotState(
      shot.temporal_state || shot.temporal_evidence?.shot_state || shot.evidence_state || {},
      shot,
      idx,
    ),
  };
  return normalized;
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
  const normalized = normalizeDurations(sorted, ctx).map((shot, idx) => ({ ...shot, index: idx + 1 }));
  return withContinuityContracts(bindShotsToScenes(normalized, ctx.scene_assets || []));
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

function alignShotsToBeats(rows, beats) {
  const shots = Array.isArray(rows) ? rows : [];
  const sourceBeats = Array.isArray(beats) ? beats : [];
  const expected = sourceBeats.map((beat, index) => Number(beat?.beat_index || index + 1));
  const expectedSet = new Set(expected);
  const claimed = shots.map(shot => Number(shot?.index || shot?.shot_index || 0));
  const indexesAreUsable = claimed.length === shots.length
    && new Set(claimed).size === claimed.length
    && claimed.every(index => expectedSet.has(index));
  const beatByIndex = new Map(sourceBeats.map((beat, index) => [
    Number(beat?.beat_index || index + 1),
    beat,
  ]));
  return shots.slice(0, expected.length).map((shot, index) => {
    const shotIndex = indexesAreUsable ? claimed[index] : expected[index];
    const beat = beatByIndex.get(shotIndex) || sourceBeats[index] || {};
    const blueprintSpokenLine = cleanSpeech(beat.spoken_line || beat.voiceover || beat.copy || '', 90);
    return {
      ...shot,
      index: shotIndex,
      dialogue_function: beat.dialogue_function || beat.dialogue_intent || shot.dialogue_function || '',
      blueprint_spoken_line: blueprintSpokenLine,
      voiceover: blueprintSpokenLine || shot.voiceover || shot.narration || '',
    };
  });
}

function missingBeatIndexes(beats, shots) {
  const present = new Set((Array.isArray(shots) ? shots : []).map(shot => Number(shot?.index || shot?.shot_index || 0)));
  return (Array.isArray(beats) ? beats : [])
    .map((beat, index) => Number(beat?.beat_index || index + 1))
    .filter(index => !present.has(index));
}

async function generateMissingStoryboardBeats(ctx, blueprint, beats, { taskId = '' } = {}) {
  if (!beats.length) return { shots: [], model_meta: null };
  const systemPrompt = [
    'You repair a New Story Ad storyboard by generating only missing shots. Return a JSON array only.',
    'Return exactly one shot for every supplied missing beat, in the same order, with index equal to beat_index.',
    'All user-visible text must be natural Simplified Chinese. Technical enum values and IDs stay unchanged.',
    'Do not invent a new person, product, industry, scene or plot. Use only the supplied context, blueprint and scene assets.',
    'Each shot must include a concrete visual, action, natural voiceover or dialogue, purpose, visual_layers, speech_mode and continuity fields.',
    'For every shot, dynamically choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement from that beat. Never copy one camera template across unrelated beats.',
    'For every shot, write entry_frame_state, exit_frame_state, action_start, action_end and object_states as visible states, even for the first shot.',
    'For every shot, write temporal_state with open-vocabulary entity_refs, relation_refs, state_before, state_after, intended_changes, invariants, evidence_requirements and continuity_links. Never choose values from an industry template.',
    'keyframe_notes must contain three explicit task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”. Derive them from this user task; never use a fixed scene, person, product or industry.',
    'Never emit replacement characters, mojibake, placeholder text, or runs of question marks.',
    'Default speech_mode to offscreen_voiceover so visible people do not speak. Use on_camera_dialogue only when the user explicitly requests a visible person to speak; never infer it from an industry, profession or the mere presence of a person.',
    'If scene assets exist, use only their scene_id, scene_revision, camera_id, zone_ids and anchor_ids.',
  ].join('\n');
  const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 12000)}
${sceneBindingPrompt(ctx.scene_assets || [])}
Missing beats: ${JSON.stringify(beats)}

Return exactly ${beats.length} shots. Required fields: index, title, role, duration, purpose, subject_type, shot_type, shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position, visual_layers, visual, action, speech_mode, voiceover, dialogue_lines, characters, material_usage, keyframe_notes, scene_id, scene_revision, scene_view, camera_id, scene_zone, scene_zone_id, scene_zone_label_zh, zone_ids, anchor_ids, transition_from, transition_reason, entry_frame_state, exit_frame_state, action_start, action_end, screen_direction, eyeline, camera_axis, camera_movement, object_states, transition_type, requires_previous_frame, audio_bridge, ambient_sound, sfx, music_cue, voiceover_timing, temporal_state.`;
  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.storyboard_fill_missing',
    systemPrompt,
    userPrompt,
    maxTokens: Math.min(6000, Math.max(2400, beats.length * 1200)),
  });
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'array',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  const language = await ensureChineseOutput({ payload: parsed, kind: 'storyboard', taskId, context: ctx });
  return {
    shots: alignShotsToBeats(language.payload, beats),
    model_meta: {
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
      language_repaired: language.repaired,
      language_model: language.model_meta?.used_model || '',
      fill_missing: true,
    },
  };
}

async function generateStoryboardTable(ctx, blueprint, { taskId = '', resumeShots = [], onCheckpoint = null } = {}) {
  const beats = plannedBeats(blueprint, ctx);
  const expectedIndexes = new Set(beats.map((beat, index) => Number(beat?.beat_index || index + 1)));
  const resumedByIndex = new Map((Array.isArray(resumeShots) ? resumeShots : [])
    .map(shot => [Number(shot?.index || shot?.shot_index || 0), shot])
    .filter(([index]) => expectedIndexes.has(index)));
  const all = [...resumedByIndex.values()];
  const pendingBeats = beats.filter((beat, index) => !resumedByIndex.has(Number(beat?.beat_index || index + 1)));
  const beatChunks = chunksOf(pendingBeats, beats.length > 8 ? 3 : 4);
  const meta = [];

  const checkpoint = async phase => {
    if (typeof onCheckpoint !== 'function') return;
    await onCheckpoint({
      phase,
      shots: all.slice().sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0)),
      completed_indexes: [...new Set(all.map(shot => Number(shot?.index || shot?.shot_index || 0)).filter(Boolean))].sort((a, b) => a - b),
      expected_total: beats.length,
    });
  };

  if (all.length) await checkpoint('resumed');

  for (const chunk of beatChunks) {
    const systemPrompt = [
      'You are the storyboard table writer for New Story Ad. Return a JSON array only.',
      'All user-visible text values must be natural Simplified Chinese, including shot title, role, purpose, visuals, actions, voiceover/dialogue, character names/actions, material notes, scene descriptions and transition/continuity explanations. JSON keys and technical enum values stay unchanged. Brand/product/API/UI names may remain in their original spelling.',
      'Do not force fixed segments, fixed template, or fixed shot count. Shots must follow the user story content.',
      'Each input beat must produce one corresponding shot.',
      'Do not force every shot into a fixed story_visual + promo_visual pair.',
      'For each shot, choose the visual layers required by the user brief and blueprint: story, character, product, material, space, UI, proof, comparison, emotion, brand, offer, process, result, or other.',
      'Some shots may need only product/material proof, some may need story/emotion, some may need comparison or brand result. Follow the actual user request.',
      'Use visual_layers as the source of truth; story_visual and promo_visual are optional compatibility fields only.',
      'Never invent an unmentioned product feature, character, prop, industry, or scene.',
      'Character names must use the stable names from blueprint.characters. Do not use descriptors as name or speaker.',
      'voiceover must be a natural short line that can be heard in the final video.',
      'The blueprint spoken_line and dialogue_function are approved story contracts. Copy spoken_line verbatim into voiceover and preserve dialogue_function; do not shorten it into a generic reaction or replace it with a new slogan.',
      'The heard lines across adjacent shots must retain the blueprint causal arc: goal/obstacle, discovery/proof, then decision/result. Do not move this meaning back into visuals only.',
      'speech_mode defaults to offscreen_voiceover. Visible people must remain naturally non-speaking in this mode. Use on_camera_dialogue only when the user explicitly asks for a visible person to speak; never choose it from industry, occupation, scene type or person presence alone. Use silent only when no speech is intended.',
      'voiceover and dialogue_lines.line are not subtitle fields. They must contain dialogue or narrator voice only, without labels such as "字幕:", "旁白:", "台词:", "解说:" or speaker-type tags.',
      'If Advanced production controls are enabled, obey them shot by shot: scene direction constrains location, product presentation controls product visibility and method, style direction controls visual tone, and negative requirements are forbidden.',
      'When product presentation is enabled, mark product/proof/material/brand layers in visual_layers whenever the shot is commercially suitable.',
      'Do not output shots that violate negative requirements.',
      'If scene assets exist, scene_id must be selected from the current task scene assets only.',
      'scene_zone_id and zone_ids are stable machine bindings from the selected scene contract. Never translate, rename or invent them.',
      'scene_zone_label_zh is the user-facing Simplified Chinese label for the selected zone. It may explain the binding but must not replace or change scene_zone_id/zone_ids.',
      'Do not invent unrelated spaces. A scene change must have transition_reason.',
      'Every shot, including the first, must describe entry_frame_state, exit_frame_state, action_start, action_end, camera_movement and object_states as visible states. Add screen_direction, eyeline, camera_axis and audio_bridge whenever they are relevant.',
      'Set requires_previous_frame=true only when the current image must visually inherit an exact action, pose, object state, eyeline or composition from the immediately previous frame. Ordinary hard cuts with shared verified scene/person anchors must use false so they can generate in parallel.',
      'Choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement independently from the current shot purpose. These are cinematography controls, not fixed story templates; do not copy one camera signature across unrelated beats.',
      'The visual must be production-ready and state the task-relevant subject/product, environment, spatial relationship and proportions, plus material and lighting only where they matter. Do not pad it with irrelevant fixed details.',
      'keyframe_notes must use exactly three task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”. Each clause must be derived from the current brief, scene contract and beat, never from a fixed scene/person/product template.',
      'Never output replacement characters, mojibake, placeholder values, or runs of question marks in any user-visible field.',
      'shot_scope, surface_topology and motion_effect are optional compatibility controls with open task-authored values. Set them only when the current brief/beat explicitly needs them; otherwise omit them. Never infer an industry-specific surface, scene, character or effect template.',
      'Add ambient_sound, sfx, music_cue and voiceover_timing only when they serve the current shot. Never assume a fixed genre or industry sound.',
      'Continuity values must be derived only from the current brief, current scene assets and adjacent beats. Never assume a fixed location, profession, person, product or industry.',
      'For every shot, author temporal_state as an open-vocabulary evidence contract. It must describe state_before, state_after, intended_changes, invariants, evidence_requirements and continuity_links. These values come only from the current task and may contain any industry-specific words supplied by the task; never select from a built-in industry list.',
    ].join('\n');

    const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 14000)}

${sceneBindingPrompt(ctx.scene_assets || [])}

Current beats: ${JSON.stringify(chunk)}

Return JSON array for current beats only. Fields:
{
  "index": 1,
  "title": "shot title",
  "role": "story function",
  "duration": 3,
  "purpose": "short label",
  "subject_type": "open task-authored subject description; compatibility field only",
  "shot_type": "open cinematography description chosen for this beat",
  "shot_scope": "optional open task-authored scope; compatibility field only",
  "surface_topology": {"mode":"open task-authored topology","seam_policy":"open task-authored seam rule","finish_distribution":"open task-authored distribution","notes":"optional task-specific structure only"},
  "motion_effect": {"type":"open task-authored effect or none","source_state":"visible start state","target_state":"authored end state","timeline":"within-shot timing","intensity":"task-authored value","preserve_scene_geometry":true,"reference_asset_id":"optional exact target asset id","notes":"optional task-specific effect only"},
  "visual_layers": [{"type":"open task-authored layer name","content":"specific visible content"}],
  "story_visual": "optional, only if this shot needs story/character/emotion",
  "promo_visual": "optional, only if this shot needs product/service/brand proof",
  "emotional_turn": "emotion or story change",
  "selling_point": "commercial point proved here",
  "visual": "combined visible frame if needed",
  "action": "who does what",
  "dialogue_function": "copy from the current blueprint beat",
  "speech_mode": "offscreen_voiceover/on_camera_dialogue/silent; default offscreen_voiceover",
  "voiceover": "natural short line",
  "dialogue_lines": [{"speaker":"stable character name or narrator","line":"line"}],
  "characters": [{"name":"stable character name","action":"this shot action"}],
  "material_usage": "materials/evidence used",
  "keyframe_notes": "subject, proof and composition to lock for keyframe",
  "scene_id": "must match one current task scene_id when scene assets exist",
  "scene_revision": "must match the selected current task scene revision",
  "scene_view": "stable open view ID from the selected current-task scene asset",
  "camera_id": "camera id from the selected scene contract",
  "scene_zone": "the concrete zone inside this task scene",
  "scene_zone_id": "stable machine zone id; normally zone_ids[0]",
  "scene_zone_label_zh": "面向用户显示的简体中文场景区域名称",
  "zone_ids": ["zone ids from the selected scene contract"],
  "anchor_ids": ["required spatial anchor ids visible in this shot"],
  "transition_from": "previous scene_id when changing scene, otherwise empty",
  "transition_reason": "why this shot enters this scene; required when scene_id changes",
  "entry_frame_state": "visible people, subject and object state at shot start",
  "exit_frame_state": "visible people, subject and object state at shot end",
  "action_start": "action state at the first frame",
  "action_end": "action state at the final frame",
  "screen_direction": "established left/right/toward/away direction when relevant",
  "eyeline": "character eyeline when relevant",
  "camera_axis": "spatial axis that must be preserved",
  "camera_movement": "static/push/pull/pan/tilt/tracking/orbit/handheld as required by this shot",
  "shot_size": "extreme_wide/wide/full/medium/medium_close/close_up/extreme_close_up/macro",
  "camera_angle": "eye_level/high_angle/low_angle/overhead/dutch/over_shoulder/pov",
  "lens_mm": 50,
  "depth_of_field": "deep/medium/shallow/ultra_shallow",
  "composition": "composition derived from current shot purpose",
  "subject_position": "subject placement derived from current action and continuity",
  "object_states": "product and prop positions/states that must not jump",
  "transition_type": "none/hard_cut/cut_on_action/match_cut/dissolve/fade",
  "requires_previous_frame": false,
  "audio_bridge": "ambient or sound bridge into this shot, empty when none",
  "ambient_sound": "environment sound from the current scene",
  "sfx": ["specific action or object sound"],
  "music_cue": "music change serving the current story beat",
  "voiceover_timing": "timing relationship between spoken line and visible action"
  ,"temporal_state": {
    "entity_refs": ["optional entity IDs or stable names used by this shot"],
    "relation_refs": ["optional relation IDs used by this shot"],
    "state_before": ["visible facts at the beginning"],
    "state_after": ["visible facts at the end"],
    "intended_changes": ["only the changes this shot is allowed to introduce"],
    "invariants": ["identity, geometry, material, wardrobe, UI, product or other facts that must not change"],
    "evidence_requirements": ["visible evidence proving this shot completed its purpose"],
    "continuity_links": ["open continuity links to adjacent shots when required"]
  }
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

    const language = await ensureChineseOutput({ payload: parsed, kind: 'storyboard', taskId, context: ctx });
    all.push(...alignShotsToBeats(language.payload, chunk));
    meta.push({
      used_model: result.used_model,
      fallback_used: result.fallback_used,
      failed_models: result.failed_models,
      language_repaired: language.repaired,
      language_model: language.model_meta?.used_model || '',
    });
    await checkpoint('chunk_done');
  }

  const missingIndexes = missingBeatIndexes(beats, all);
  if (missingIndexes.length) {
    const missingSet = new Set(missingIndexes);
    const missingBeats = beats.filter((beat, index) => missingSet.has(Number(beat?.beat_index || index + 1)));
    const filled = await generateMissingStoryboardBeats(ctx, blueprint, missingBeats, { taskId });
    all.push(...filled.shots);
    if (filled.model_meta) meta.push(filled.model_meta);
    await checkpoint('missing_filled');
  }

  const unresolved = missingBeatIndexes(beats, all);
  if (unresolved.length || all.length !== beats.length) {
    const error = new Error(`分镜数量与已确认剧本不一致：需要 ${beats.length}，实际 ${all.length}，缺少第 ${unresolved.join('、') || '-'} 镜`);
    error.code = 'STORYBOARD_COUNT_MISMATCH';
    error.retryable = true;
    throw error;
  }

  const shots = normalizeShots(all, {
    ...ctx,
    characters: normalizeCharacters(
      Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters,
      `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`,
    ),
  });
  return { shots, model_meta: meta };
}

async function rewriteStoryboard(ctx, blueprint, shots, issues, { taskId = '' } = {}) {
  if (!Array.isArray(issues) || !issues.length) return shots;
  const indexes = Array.from(new Set(issues.flatMap((issue) => {
    const matches = [...String(issue || '').matchAll(/第\s*(\d+)\s*镜/g)];
    return matches.map(match => Number(match[1])).filter(n => n >= 1 && n <= shots.length);
  }))).slice(0, 8);
  if (!indexes.length) return shots;
  const selected = indexes.map(index => shots[index - 1]).filter(Boolean);
  const selectedIssues = issues.filter(issue => indexes.some(index => new RegExp(`第\\s*${index}\\s*镜`).test(String(issue || ''))));

  const systemPrompt = [
    'You are the storyboard rewrite agent. Return a JSON array containing only the requested shot indexes.',
    'All user-visible text values must be natural Simplified Chinese. Keep JSON keys, technical enum values, IDs, indexes and durations unchanged.',
    'Preserve each original index. Do not add, remove, merge or reorder shots.',
    'Keep characters, advertised subject, and story order.',
    'Do not add new story events that the user did not provide.',
    'Fix thin shots by strengthening the visual layers required by the user brief.',
    'For every repaired shot, dynamically choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement from that shot purpose; never copy a fixed camera template.',
    'Write production-ready visual and action fields with task-relevant subject/product, environment, spatial relationship and proportions, plus material and lighting only where relevant.',
    'Write visible entry_frame_state, exit_frame_state, action_start, action_end and object_states for every repaired shot, including shot 1.',
    'keyframe_notes must contain exactly three task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”.',
    'Remove replacement characters, mojibake, placeholders and runs of question marks from every user-visible field.',
    'Keep the requested commercial, story, product, proof, brand, UI, space, emotion or comparison dimensions visible as applicable.',
    'Preserve and enforce Advanced production controls from context: scene direction, product presentation, style direction and negative requirements.',
    'Preserve scene_id, scene_revision, scene_view, camera_id, scene_zone_id, zone_ids, anchor_ids and transition_reason whenever they are valid for the current task scene assets. scene_zone_label_zh may be repaired into Simplified Chinese without changing those IDs.',
    'Preserve and repair adjacent-shot entry/exit state, action start/end, screen direction, eyeline, camera axis, camera movement, object state, transition type and audio bridge.',
    'Preserve and repair temporal_state. It is an open-vocabulary contract: only intended_changes may change; invariants and evidence_requirements must remain task-specific and must never be replaced by an industry template.',
  ].join('\n');

  const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 10000)}
${sceneBindingPrompt(ctx.scene_assets || [])}
Shots to repair: ${JSON.stringify(selected).slice(0, 14000)}
Issues to fix: ${selectedIssues.slice(0, 24).join('; ')}

Return only the repaired shots with their original index. Do not invent unprovided plot.`;

  const result = await modelGateway.generateText({
    taskId,
    stage: 'new_story_ad.storyboard_rewrite',
    systemPrompt,
    userPrompt,
    maxTokens: Math.min(6000, Math.max(2400, selected.length * 900)),
  });

  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'array',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });

  const language = await ensureChineseOutput({ payload: parsed, kind: 'storyboard', taskId, context: ctx });
  const repairedByIndex = new Map(language.payload.map((shot, idx) => {
    const index = Number(shot?.index || shot?.shot_index || indexes[idx]);
    return [index, shot];
  }).filter(([index]) => indexes.includes(index)));
  const merged = shots.map((shot, idx) => repairedByIndex.has(idx + 1)
    ? { ...shot, ...repairedByIndex.get(idx + 1), index: idx + 1 }
    : shot);
  return normalizeShots(merged, {
    ...ctx,
    characters: normalizeCharacters(
      Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters,
      `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`,
    ),
  });
}

module.exports = {
  generateStoryboardTable,
  rewriteStoryboard,
  normalizeShots,
  alignShotsToBeats,
  missingBeatIndexes,
};
