const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters, looksLikeDescriptorName } = require('./contextBuilder');
const { bindShotsToScenes, sceneBindingPrompt } = require('./sceneBindingService');
const { withContinuityContracts } = require('./continuityService');
const shotDesign = require('./shotDesignService');
const temporalEvidenceGraph = require('./temporalEvidenceGraphService');
const brandEnding = require('./brandEndingService');
const productionLimits = require('./productionLimitsService');
const storyBeatShotCoverage = require('./storyBeatShotCoverageService');
const actionSemantics = require('./actionSemanticsService');
const transitionPerformance = require('./transitionPerformanceContractService');
const generationConcurrency = require('./generationConcurrencyService');
const narrativeOrder = require('./storyboardNarrativeOrderService');

const { ensureChineseOutput } = require('./outputLanguageService');

const STORYBOARD_CHUNK_CONCURRENCY = Math.max(1, Math.min(4,
  Number(process.env.NEW_STORY_AD_STORYBOARD_CHUNK_CONCURRENCY) || 3));

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

function contractText(value, max = 70) {
  const values = Array.isArray(value)
    ? value.flatMap(item => contractText(item, max)).filter(Boolean)
    : (value && typeof value === 'object'
      ? Object.values(value).flatMap(item => contractText(item, max)).filter(Boolean)
      : [clampText(value, max)]);
  return clampText(values.filter(Boolean).join('、')
    .replace(/\[object\s+Object\]/gi, '')
    .replace(/[；;\n]+/g, '、')
    .replace(/、{2,}/g, '、')
    .replace(/^、|、$/g, ''), max);
}

function contractField(value, keys = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  for (const key of keys) {
    const text = contractText(value[key]);
    if (text) return text;
  }
  return '';
}

function stringClause(value = '', label = '') {
  const match = String(value || '').match(new RegExp(`${label}\\s*[:：]\\s*([^；;\\n]+)`));
  return contractText(match?.[1] || '');
}

function normalizeKeyframeNotes(shot = {}, ctx = {}) {
  const raw = shot.keyframe_notes || shot.keyframeNotes || {};
  const rawText = typeof raw === 'string'
    ? clampText(String(raw).replace(/\[object\s+Object\]/gi, '').replace(/\s+/g, ' ').trim(), 500)
    : '';
  const freeformRawText = /本镜目的\s*[:：]|必须出现\s*[:：]|禁止出现\s*[:：]/.test(rawText) ? '' : rawText;
  const purpose = stringClause(rawText, '本镜目的') || contractField(raw, ['本镜目的', 'purpose', 'objective', 'intent', 'shot_purpose'])
    || contractText(shot.purpose || shot.objective || shot.role || shot.title || '推进当前剧情节点', 50);
  const mustAppear = stringClause(rawText, '必须出现') || contractField(raw, ['必须出现', 'must_appear', 'must_include', 'must_have', 'required', 'positive'])
    || contractText(freeformRawText || shot.material_usage || shot.promo_visual || shot.story_visual || shot.visual || shot.action || ctx.product_subject || '当前镜头已确认主体与场景', 70);
  const mustAvoid = stringClause(rawText, '禁止出现') || contractField(raw, ['禁止出现', 'must_not_appear', 'must_avoid', 'forbidden', 'negative', 'avoid'])
    || contractText([
      ctx.forbidden,
      ctx.negative_requirements,
      ctx.creative_direction?.must_avoid,
      ctx.controlled_production?.negative_control,
    ], 60) || '未授权人物、商品、场景、文字与标识';
  return `本镜目的：${contractText(purpose, 50)}；必须出现：${contractText(mustAppear, 70)}；禁止出现：${contractText(mustAvoid, 60)}`;
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
  const microExpression = transitionPerformance.normalizeMicroExpression(
    shot.micro_expression || shot.microExpression || shot.expression_contract || shot.expression_change || {},
    emotionalTurn,
  );
  const sellingPoint = clampText(shot.selling_point || shot.benefit || shot.value_point || '', 80);
  const keyframeNotes = normalizeKeyframeNotes(shot, ctx);
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
    shot_id: clampText(shot.shot_id || shot.coverage_id || `shot_${n}`, 160),
    source_beat_id: clampText(shot.source_beat_id || shot.source_story_beat_id || shot.flow_beat_id || '', 160),
    coverage_id: clampText(shot.coverage_id || shot.shot_coverage?.coverage_id || '', 160),
    story_flow_contract_fingerprint: clampText(shot.story_flow_contract_fingerprint || ctx.story_flow_contract?.contract_fingerprint || '', 220),
    index: n,
    title: clampText(shot.title || `镜头 ${n}`, 40),
    role: clampText(shot.role || shot.story_stage || shot.purpose || '', 40),
    duration: Math.max(2, Math.min(productionLimits.MAX_SHOT_DURATION, Number(shot.duration || shot.duration_sec || 0) || defaultDuration)),
    purpose: clampText(shot.purpose || shot.script_purpose || shot.objective || shot.role || '', 40),
    subject_type: shot.subject_type || shot.subjectType || 'auto',
    expected_people: Math.max(0, Math.min(12, Math.round(Number(
      Object.prototype.hasOwnProperty.call(shot, 'expected_people')
        ? shot.expected_people
        : (Array.isArray(shot.characters) && shot.characters.length ? shot.characters.length : (ctx.expected_people || 0)),
    ) || 0))),
    expected_animals: Math.max(0, Math.min(8, Math.round(Number(
      Object.prototype.hasOwnProperty.call(shot, 'expected_animals')
        ? shot.expected_animals
        : (ctx.expected_animals || ctx.pet_contract?.expected_animals || 0),
    ) || 0))),
    pets: (Array.isArray(shot.pets) ? shot.pets : []).map((pet, petIndex) => ({
      id: clampText(pet?.id || `pet_${petIndex + 1}`, 80),
      name: clampText(pet?.name || '', 80),
      type: clampText(pet?.type || pet?.species || pet?.breed || '', 100),
      action: clampText(pet?.action || '', 120),
    })).filter(pet => pet.name || pet.type || pet.action).slice(0, 8),
    shot_type: shotType,
    lighting_mood: clampText(shot.lighting_mood || shot.light_atmosphere || shot.lighting || shot.light || '', 180)
      || '沿用当前场景已确认的主光方向、色温和明暗关系',
    visual_layers: visualLayers,
    story_visual: storyVisual,
    promo_visual: promoVisual,
    emotional_turn: emotionalTurn,
    micro_expression: microExpression,
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
    character_ids: (Array.isArray(shot.character_ids) ? shot.character_ids : []).map(value => clampText(value, 160)).filter(Boolean).slice(0, 12),
    look_bindings: shot.look_bindings && typeof shot.look_bindings === 'object' ? { ...shot.look_bindings } : {},
    voice_bindings: shot.voice_bindings && typeof shot.voice_bindings === 'object' ? { ...shot.voice_bindings } : {},
    material_usage: clampText(shot.material_usage || promoVisual || visualLayers.find(layer => /product|material|proof|brand|offer|result/i.test(layer.type))?.content || '', 160),
    keyframe_notes: keyframeNotes,
    scene_id: clampText(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId || '', 120),
    scene_asset_id: clampText(shot.scene_asset_id || shot.sceneAssetId || shot.scene_id || shot.sceneId || '', 120),
    scene_name: clampText(shot.scene_name || shot.sceneName || '', 120),
    look_id: clampText(shot.look_id || shot.lookId || '', 100),
    scene_view: clampText(shot.scene_view || shot.sceneView || '', 40),
    scene_zone: clampText(shot.scene_zone || shot.sceneZone || shot.zone || '', 160),
    scene_zone_id: clampText(shot.scene_zone_id || shot.zone_id || (Array.isArray(shot.zone_ids) ? shot.zone_ids[0] : '') || '', 100),
    scene_zone_label_zh: clampText(shot.scene_zone_label_zh || shot.zone_label_zh || shot.scene_zone || shot.sceneZone || shot.zone || '', 160),
    scene_revision: Math.max(1, Number(shot.scene_revision || shot.sceneRevision || 1) || 1),
    sound_profile_id: clampText(shot.sound_profile_id || shot.soundProfileId || '', 160),
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
    transition_duration_sec: Math.max(0, Math.min(2, Number(
      shot.transition_duration_sec ?? shot.transitionDurationSec ?? 0,
    ) || 0)),
    transition_match_anchor: clampText(
      shot.transition_match_anchor || shot.transitionMatchAnchor || shot.match_anchor || '',
      180,
    ),
    transition_source: clampText(shot.transition_source || shot.transitionSource || '', 40),
    transition_design: transitionPerformance.normalizeTransitionDesign(
      shot.transition_design || shot.transitionDesign || shot.transition_motif || {},
      shot.transition_type || shot.transitionType || shot.transition || '',
    ),
    requires_previous_frame: shot.requires_previous_frame === true || shot.requiresPreviousFrame === true
      || String(shot.requires_previous_frame || shot.requiresPreviousFrame || '').toLowerCase() === 'true',
    audio_bridge: clampText(shot.audio_bridge || shot.audioBridge || '', 160),
    audio_bridge_duration_sec: Math.max(0, Math.min(1.5, Number(
      shot.audio_bridge_duration_sec ?? shot.audioBridgeDurationSec ?? 0,
    ) || 0)),
    ambient_sound: clampText(shot.ambient_sound || shot.ambientSound || '', 180),
    sfx: (Array.isArray(shot.sfx) ? shot.sfx : String(shot.sfx || '').split(/[,，；;]/)).map(value => clampText(value, 100)).filter(Boolean).slice(0, 12),
    music_cue: clampText(shot.music_cue || shot.musicCue || '', 180),
    voiceover_timing: clampText(shot.voiceover_timing || shot.voiceoverTiming || '', 120),
    shot_scope: design.shot_scope,
    surface_topology: design.surface_topology,
    motion_effect: design.motion_effect,
    action_contract: design.action_contract,
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
  const target = productionLimits.targetDuration(ctx.target_duration);
  const base = Math.max(2, Math.min(productionLimits.MAX_SHOT_DURATION, Math.round(target / shots.length)));
  let rows = shots.map((shot, idx) => normalizeShot(shot, ctx, idx, base));
  let total = rows.reduce((sum, shot) => sum + Number(shot.duration || 0), 0);
  let guard = 0;

  // 保留模型根据对白、动作和场景节奏给出的相对时长。需要对齐总时长时，
  // 每轮调整当前最长/最短且仍有余量的镜头，避免过去从第一镜开始机械填满 6 秒。
  const longestAdjustable = () => rows
    .filter(shot => shot.duration > 2)
    .sort((a, b) => b.duration - a.duration || Number(b.index) - Number(a.index))[0];
  const shortestAdjustable = () => rows
    .filter(shot => shot.duration < productionLimits.MAX_SHOT_DURATION)
    .sort((a, b) => a.duration - b.duration || Number(a.index) - Number(b.index))[0];

  while (total > target && guard < productionLimits.MAX_SHOT_COUNT * productionLimits.MAX_SHOT_DURATION) {
    const item = longestAdjustable();
    if (!item) break;
    item.duration -= 1;
    total -= 1;
    guard += 1;
  }

  while (total < target && guard < productionLimits.MAX_SHOT_COUNT * productionLimits.MAX_SHOT_DURATION * 2) {
    const item = shortestAdjustable();
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
  return brandEnding.applyToShots(
    withContinuityContracts(bindShotsToScenes(normalized, ctx.scene_assets || [], { context: ctx })),
    ctx,
  );
}

function chunksOf(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function storyboardBeatChunks(beats = [], pendingBeats = []) {
  const pending = Array.isArray(pendingBeats) ? pendingBeats : [];
  if (!pending.some(beat => beat?.long_form_segment)) return chunksOf(pending, beats.length > 8 ? 3 : 4);
  const groups = new Map();
  pending.forEach(beat => {
    const key = Number(beat?.source_beat_index || beat?.beat_index || 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(beat);
  });
  return [...groups.values()].flatMap(group => chunksOf(group, 8));
}

function storyboardBlueprintDigest(blueprint = {}) {
  const { beats, ...global } = blueprint && typeof blueprint === 'object' ? blueprint : {};
  return { ...global, beat_count: Array.isArray(beats) ? beats.length : 0 };
}

function coverageSourceBeats(blueprint = {}, fallbackBrief = '', storyFlowContract = null) {
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  const base = beats.length ? beats : [{ beat_index: 1, role: 'story', plot: fallbackBrief, spoken_line: '' }];
  const flowUnits = Array.isArray(storyFlowContract?.units) ? storyFlowContract.units : [];
  const people = Array.isArray(storyFlowContract?.people) ? storyFlowContract.people : [];
  const scenes = Array.isArray(storyFlowContract?.scenes) ? storyFlowContract.scenes : [];
  return base.map((beat, index) => {
    const sourceId = beat.source_story_beat_id || beat.story_beat_id || beat.beat_id || beat.id || `story_beat_${index + 1}`;
    const flow = flowUnits.find(unit => String(unit.beat_id || '') === String(sourceId)) || flowUnits[index] || {};
    const characterIds = Array.isArray(flow.character_ids) ? flow.character_ids : [];
    const characterNames = characterIds.map(id => people.find(person => person.character_id === id)?.name).filter(Boolean);
    const boundScene = scenes.find(scene => scene.scene_id === flow.scene_id) || {};
    return {
      ...beat,
      source_story_beat_id: sourceId,
      story_beat_id: `${sourceId}:source:${index + 1}`,
      plot: beat.plot || beat.summary || fallbackBrief,
      flow_beat_id: flow.beat_id || sourceId,
      flow_character_ids: characterIds,
      flow_character_names: characterNames,
      flow_look_bindings: flow.look_bindings || {},
      flow_voice_bindings: flow.voice_bindings || {},
      flow_scene_id: flow.scene_id || '',
      flow_scene_revision: boundScene.scene_revision || 1,
      flow_sound_profile_id: boundScene.sound_profile_id || '',
      story_flow_contract_fingerprint: storyFlowContract?.contract_fingerprint || '',
    };
  });
}

function storyboardCoveragePlan(blueprint, ctx) {
  const base = coverageSourceBeats(blueprint, ctx.brief, ctx.story_flow_contract);
  const target = Math.max(
    productionLimits.shotCount(ctx.shot_count),
    productionLimits.requiredStoryboardShotCount(ctx.target_duration, base.length),
  );
  return storyBeatShotCoverage.planCoverage({
    beats: base,
    target_shots: target,
    target_duration: productionLimits.targetDuration(ctx.target_duration),
    max_shot_duration: productionLimits.MAX_SHOT_DURATION,
    // Coverage is a narrative split, not a request to multiply paid shots for
    // every wording fragment. The existing duration/shot budget remains the
    // upper authority while each unit can carry several compatible facts.
    max_obligations_per_unit: 12,
  });
}

function beatsFromCoveragePlan(blueprint, plan, ctx = {}) {
  const beats = coverageSourceBeats(blueprint, blueprint.brief || '', ctx.story_flow_contract);
  const sourceById = new Map(beats.map((beat, index) => [
    String(beat.story_beat_id),
    { beat, sourceIndex: index },
  ]));
  return storyBeatShotCoverage.coverageUnits(plan).map((unit, index) => {
    const sourceEntry = sourceById.get(String(unit.story_beat_id)) || { beat: beats[0], sourceIndex: 0 };
    const source = sourceEntry.beat;
    const segmentIndex = Number(unit.segment_index || 1);
    const segmentCount = Number(unit.segment_count || 1);
    const phase = segmentCount === 1 ? 'complete' : (segmentIndex === 1 ? 'entry' : (segmentIndex === segmentCount ? 'exit' : 'progress'));
    return {
      ...source,
      beat_index: index + 1,
      source_beat_index: Number(source.beat_index || sourceEntry.sourceIndex + 1),
      story_beat_id: unit.story_beat_id,
      coverage_id: unit.coverage_id,
      shot_coverage: unit,
      visible_evidence: unit.required_evidence,
      state_before: unit.entry_state,
      state_after: unit.exit_state,
      intended_changes: unit.intended_changes,
      invariants: unit.invariants,
      long_form_segment: {
        sequence_id: `sequence_${unit.story_beat_id}`,
        index: segmentIndex,
        total: segmentCount,
        phase,
        duration_budget_sec: unit.duration_budget_sec,
        entry_state: unit.entry_state,
        exit_state: unit.exit_state,
        proof_requirements: unit.required_evidence,
        instruction: `${unit.narrative_instruction}；只推进本覆盖单元的可见状态，不重复前段动作，不提前完成后段结果。`,
      },
      spoken_line: unit.spoken_line,
      why_next: segmentIndex === segmentCount ? source.why_next : '',
    };
  });
}

function plannedBeats(blueprint, ctx) {
  return beatsFromCoveragePlan(blueprint, storyboardCoveragePlan(blueprint, ctx), ctx);
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
    const authoritativeCharacters = (Array.isArray(beat.flow_character_names) ? beat.flow_character_names : [])
      .map(name => ({ name, action: clampText(beat.action || beat.plot || '', 80) }));
    return {
      ...shot,
      index: shotIndex,
      shot_id: beat.coverage_id || `shot_${shotIndex}`,
      coverage_id: beat.coverage_id || '',
      source_beat_id: beat.flow_beat_id || beat.source_story_beat_id || '',
      story_flow_contract_fingerprint: beat.story_flow_contract_fingerprint || '',
      character_ids: Array.isArray(beat.flow_character_ids) ? beat.flow_character_ids : [],
      look_bindings: beat.flow_look_bindings || {},
      voice_bindings: beat.flow_voice_bindings || {},
      characters: authoritativeCharacters,
      expected_people: authoritativeCharacters.length,
      scene_id: beat.flow_scene_id || '',
      scene_asset_id: beat.flow_scene_id || '',
      scene_revision: beat.flow_scene_revision || 1,
      sound_profile_id: beat.flow_sound_profile_id || '',
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
    'Return exactly one shot for every supplied missing narrative coverage unit, in the same order, with index equal to beat_index.',
    'All user-visible text must be natural Simplified Chinese. Technical enum values and IDs stay unchanged.',
    'Do not invent a new person, product, industry, scene or plot. Use only the supplied context, blueprint and scene assets.',
    'Each shot must include a concrete visual, action, appropriate speech or explicit silence, purpose, visual_layers, lighting_mood, sound and continuity fields.',
    'For every shot, dynamically choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement from that beat. Never copy one camera template across unrelated beats.',
    'For every shot, write entry_frame_state, exit_frame_state, action_start, action_end and object_states as visible states, even for the first shot.',
    actionSemantics.promptBlock(),
    'For every shot, write temporal_state with open-vocabulary entity_refs, relation_refs, state_before, state_after, intended_changes, invariants, evidence_requirements and continuity_links. Never choose values from an industry template.',
    'keyframe_notes must contain three explicit task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”. Derive them from this user task; never use a fixed scene, person, product or industry.',
    'Never emit replacement characters, mojibake, placeholder text, or runs of question marks.',
    'Default speech_mode to offscreen_voiceover so visible people do not speak. Use on_camera_dialogue only when the user explicitly requests a visible person to speak; never infer it from an industry, profession or the mere presence of a person.',
    'If scene assets exist, use only their scene_id, scene_revision, camera_id, zone_ids and anchor_ids.',
    'When a cast profile has multiple look_profiles, every shot containing that person must set look_id to one declared look ID whose scene_ids include the selected scene_id, unless the story explicitly changes look inside that scene.',
  ].join('\n');
  const userPrompt = `${contextPrompt(ctx)}

Blueprint: ${JSON.stringify(blueprint).slice(0, 12000)}
${sceneBindingPrompt(ctx.scene_assets || [])}
Missing beats: ${JSON.stringify(beats)}

Return exactly ${beats.length} shots. Required fields: index, title, role, duration, purpose, subject_type, expected_people, expected_animals, pets, shot_type, lighting_mood, shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position, visual_layers, visual, action, speech_mode, voiceover, dialogue_lines, characters, material_usage, keyframe_notes, scene_id, look_id, scene_revision, scene_view, camera_id, scene_zone, scene_zone_id, scene_zone_label_zh, zone_ids, anchor_ids, transition_from, transition_reason, entry_frame_state, exit_frame_state, action_start, action_end, screen_direction, eyeline, camera_axis, camera_movement, object_states, transition_type, transition_duration_sec, transition_match_anchor, requires_previous_frame, audio_bridge, audio_bridge_duration_sec, ambient_sound, sfx, music_cue, voiceover_timing, temporal_state.`;
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
  const coveragePlan = storyboardCoveragePlan(blueprint, ctx);
  const beats = beatsFromCoveragePlan(blueprint, coveragePlan, ctx);
  const expectedIndexes = new Set(beats.map((beat, index) => Number(beat?.beat_index || index + 1)));
  const resumedByIndex = new Map((Array.isArray(resumeShots) ? resumeShots : [])
    .map(shot => [Number(shot?.index || shot?.shot_index || 0), shot])
    .filter(([index]) => expectedIndexes.has(index)));
  const all = [...resumedByIndex.values()];
  const pendingBeats = beats.filter((beat, index) => !resumedByIndex.has(Number(beat?.beat_index || index + 1)));
  const beatChunks = storyboardBeatChunks(beats, pendingBeats);
  const meta = [];

  const checkpoint = async phase => {
    if (typeof onCheckpoint !== 'function') return;
    await onCheckpoint({
      phase,
      shots: all.slice().sort((a, b) => Number(a?.index || 0) - Number(b?.index || 0)),
      completed_indexes: [...new Set(all.map(shot => Number(shot?.index || shot?.shot_index || 0)).filter(Boolean))].sort((a, b) => a - b),
      expected_total: beats.length,
      coverage_plan: coveragePlan,
    });
  };

  if (all.length) await checkpoint('resumed');

  const generateChunk = async chunk => {
    const systemPrompt = [
      'You are the storyboard table writer for New Story Ad. Return one JSON object with a shots array only.',
      'All user-visible text values must be natural Simplified Chinese, including shot title, role, purpose, visuals, actions, voiceover/dialogue, character names/actions, material notes, scene descriptions and transition/continuity explanations. JSON keys and technical enum values stay unchanged. Brand/product/API/UI names may remain in their original spelling.',
      'Do not force fixed segments, fixed template, or fixed shot count. Shots must follow the user story content.',
      'Each supplied narrative coverage unit must produce one corresponding shot. One source story beat may intentionally have multiple coverage units; preserve coverage_id and advance only that unit.',
      'Choose each shot by narrative function and visible state change. Establishing, entrance, environment interaction, action, reaction, dialogue tension, suspense observation, memory and transition are open examples, never a required checklist or industry template.',
      'Use wide views when spatial orientation is the evidence, closer views when emotion or detail is the evidence, and motivated camera movement only when it reveals or follows a change. Preserve the established action axis, screen direction and eyeline unless the shot explicitly re-establishes them.',
      'When long_form_segment is present, all beats with the same sequence_id are one macro chapter. Give every segment a distinct visible action/state progression, close the supplied entry/exit states, satisfy proof_requirements, and never repeat the same plot, framing or action as padding.',
      'Do not force every shot into a fixed story_visual + promo_visual pair.',
      'For each shot, choose the visual layers required by the user brief and blueprint: story, character, product, material, space, UI, proof, comparison, emotion, brand, offer, process, result, or other.',
      'Some shots may need only product/material proof, some may need story/emotion, some may need comparison or brand result. Follow the actual user request.',
      'Use visual_layers as the source of truth; story_visual and promo_visual are optional compatibility fields only.',
      'Never invent an unmentioned product feature, character, prop, industry, or scene.',
      brandEnding.enabled(ctx)
        ? 'Only the final shot carries brand_ending. Keep it in the current approved scene, settle to a stable ending frame, and reserve the configured safe area; never render the Logo itself.'
        : 'No authorized Logo is active. Do not reserve a Logo area, create a brand end card, or request any visual Logo in any shot.',
      'Character names must use the stable names from blueprint.characters. Do not use descriptors as name or speaker.',
      'Every shot must set expected_people and expected_animals independently. Use 0 when that subject is intentionally absent in the shot. In human_pet mode, never merge the two counts or replace a human with a pet.',
      'When expected_animals is greater than 0, pets must identify the stable pet id/name/type from the current pet contract and describe its shot action. Preserve species/breed, coat, size, markings and accessories; never add, remove, replace or duplicate a pet.',
      'voiceover must be a natural short line that can be heard in the final video.',
      'The blueprint spoken_line and dialogue_function are approved story contracts. Copy spoken_line verbatim into voiceover and preserve dialogue_function; do not shorten it into a generic reaction or replace it with a new slogan.',
      'The heard lines across adjacent shots must retain the blueprint causal arc: goal/obstacle, discovery/proof, then decision/result. Do not move this meaning back into visuals only.',
      'speech_mode defaults to offscreen_voiceover. Visible people must remain naturally non-speaking in this mode. Use on_camera_dialogue only when the user explicitly asks for a visible person to speak; never choose it from industry, occupation, scene type or person presence alone. Use silent only when no speech is intended.',
      'voiceover and dialogue_lines.line are not subtitle fields. They must contain dialogue or narrator voice only, without labels such as "字幕:", "旁白:", "台词:", "解说:" or speaker-type tags.',
      'If Advanced production controls are enabled, obey them shot by shot: scene direction constrains location, product presentation controls product visibility and method, style direction controls visual tone, and negative requirements are forbidden.',
      'When product presentation is enabled, mark product/proof/material/brand layers in visual_layers whenever the shot is commercially suitable.',
      'Do not output shots that violate negative requirements.',
      'If scene assets exist, scene_id must be selected from the current task scene assets only.',
      'flow_scene_id is the authoritative location for the supplied beat. Render only that scene\'s task-authored layout, furniture, fixtures, props, zones and anchors. If source prose compares several application contexts, keep the story meaning but never mix another scene\'s unique physical elements into the selected scene.',
      'When a visible character has multiple look_profiles, set look_id on every shot to one declared look ID. Prefer the look whose scene_ids contains the shot scene_id; change it only when the approved story explicitly changes wardrobe state.',
      'scene_zone_id and zone_ids are stable machine bindings from the selected scene contract. Never translate, rename or invent them.',
      'scene_zone_label_zh is the user-facing Simplified Chinese label for the selected zone. It may explain the binding but must not replace or change scene_zone_id/zone_ids.',
      'Do not invent unrelated spaces. A scene change must have transition_reason.',
      'Every shot, including the first, must describe entry_frame_state, exit_frame_state, action_start, action_end, camera_movement and object_states as visible states. Add screen_direction, eyeline, camera_axis and audio_bridge whenever they are relevant.',
      actionSemantics.promptBlock(),
      'Set requires_previous_frame=true only when the current image must visually inherit an exact action, pose, object state, eyeline or composition from the immediately previous frame. Ordinary hard cuts with shared verified scene/person anchors must use false so they can generate in parallel.',
      'Choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement independently from the current shot purpose. These are cinematography controls, not fixed story templates; do not copy one camera signature across unrelated beats.',
      'The visual must be production-ready and state the task-relevant subject/product, environment, spatial relationship and proportions, plus material and lighting only where they matter. Do not pad it with irrelevant fixed details.',
      'lighting_mood must state the visible light source/direction, contrast or softness, and atmosphere needed by this shot while preserving the selected scene identity.',
      'keyframe_notes must use exactly three task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”. Each clause must be derived from the current brief, scene contract and beat, never from a fixed scene/person/product template.',
      'Never output replacement characters, mojibake, placeholder values, or runs of question marks in any user-visible field.',
      'shot_scope, surface_topology and motion_effect are optional compatibility controls with open task-authored values. Set them only when the current brief/beat explicitly needs them; otherwise omit them. Never infer an industry-specific surface, scene, character or effect template.',
      'Add ambient_sound, sfx, music_cue and voiceover_timing only when they serve the current shot. Never assume a fixed genre or industry sound.',
      'Continuity values must be derived only from the current brief, current scene assets and adjacent beats. Never assume a fixed location, profession, person, product or industry.',
      'For every shot, author temporal_state as an open-vocabulary evidence contract. It must describe state_before, state_after, intended_changes, invariants, evidence_requirements and continuity_links. These values come only from the current task and may contain any industry-specific words supplied by the task; never select from a built-in industry list.',
    ].join('\n');

    const userPrompt = `${contextPrompt(ctx)}

Blueprint global contract: ${JSON.stringify(storyboardBlueprintDigest(blueprint)).slice(0, 8000)}

${sceneBindingPrompt(ctx.scene_assets || [])}

Current beats: ${JSON.stringify(chunk)}

    Return one JSON object for current beats only: {"shots":[...]}. Each shots item uses these fields:
{
  "index": 1,
  "title": "shot title",
  "role": "story function",
  "duration": 3,
  "purpose": "short label",
  "subject_type": "open task-authored subject description; compatibility field only",
  "expected_people": 0,
  "expected_animals": 0,
  "pets": [{"id":"stable pet id from pet_contract","name":"pet name or empty","type":"species/breed","action":"this shot action"}],
  "shot_type": "open cinematography description chosen for this beat",
  "lighting_mood": "visible light direction, contrast/softness and atmosphere for this shot",
  "shot_scope": "optional open task-authored scope; compatibility field only",
  "surface_topology": {"mode":"open task-authored topology","seam_policy":"open task-authored seam rule","finish_distribution":"open task-authored distribution","primary_surface_count":"explicit count or null","secondary_surface_policy":"auto/forbidden/task_defined","notes":"optional task-specific structure only"},
  "motion_effect": {"type":"open task-authored effect or none","source_state":"visible start state","target_state":"authored end state","timeline":"within-shot timing","intensity":"task-authored value","preserve_scene_geometry":true,"reference_asset_id":"optional exact target asset id","notes":"optional task-specific effect only"},
  "visual_layers": [{"type":"open task-authored layer name","content":"specific visible content"}],
  "story_visual": "optional, only if this shot needs story/character/emotion",
  "promo_visual": "optional, only if this shot needs product/service/brand proof",
  "emotional_turn": "emotion or story change",
  "micro_expression": {"label":"specific restrained reaction","gaze":"visible gaze target/direction","eyelids":"visible eyelid state","brows":"visible brow state","mouth":"visible lips/corners state","jaw":"visible jaw tension","head_pose":"small head pose","gesture":"optional hand-to-face gesture","intensity":"restrained/low/medium/high","onset":"when it begins in this shot","hold_sec":0.0,"trigger":"story event causing it","prohibited":"visible expression failures to avoid"},
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
  "look_id": "must match one current character look_profiles ID when that character has multiple looks",
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
  "transition_duration_sec": 0.0,
  "transition_match_anchor": "visible action, shape, position or composition anchor used by match_cut; empty otherwise",
  "transition_design": {"motif":"task-relevant boundary motif or empty","execution_class":"editorial_only/semantic_cut/generated_boundary","source_object":"visible occluder/object/action used at the boundary","outgoing_end_state":"observable final state of previous shot","incoming_start_state":"observable first state of current shot","motion_direction":"shared screen direction or empty","generation_prompt":"only the boundary behavior; no new plot","verification_evidence":"what must be visible on both sides","deterministic_fallback":"hard_cut/dissolve/fade"},
  "requires_previous_frame": false,
  "audio_bridge": "ambient or sound bridge into this shot, empty when none",
  "audio_bridge_duration_sec": 0.0,
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
      structuredOutput: { mode: 'json_object', name: 'storyboard_chunk' },
      validateText: async (_text, validation = {}) => {
        const rows = Array.isArray(validation.parsed_json?.shots) ? validation.parsed_json.shots : [];
        if (rows.length === chunk.length) return true;
        const error = new Error(`当前镜头批次需要 ${chunk.length} 项，模型实际返回 ${rows.length} 项`);
        error.code = 'STORYBOARD_CHUNK_COUNT_INVALID';
        error.details = [{ message: `shots 数量必须为 ${chunk.length}，实际为 ${rows.length}` }];
        throw error;
      },
    });

    const parsed = Array.isArray(result.parsed_json?.shots)
      ? result.parsed_json.shots
      : await jsonRepair.parseOrRepair({
        raw: result.text,
        expected: 'array',
        modelGateway,
        taskId,
        stage: 'new_story_ad.json_repair',
      });

    const language = await ensureChineseOutput({ payload: parsed, kind: 'storyboard', taskId, context: ctx });
    return {
      shots: alignShotsToBeats(language.payload, chunk),
      model_meta: {
        used_model: result.used_model,
        fallback_used: result.fallback_used,
        failed_models: result.failed_models,
        language_repaired: language.repaired,
        language_model: language.model_meta?.used_model || '',
      },
    };
  };

  try {
    await generationConcurrency.map(
      `storyboard-table:${taskId || 'anonymous'}`,
      beatChunks,
      STORYBOARD_CHUNK_CONCURRENCY,
      async chunk => {
        const generated = await generateChunk(chunk);
        all.push(...generated.shots);
        meta.push(generated.model_meta);
        await checkpoint('chunk_done');
        return generated;
      },
    );
  } catch (error) {
    error.partial_results_saved = all.length > 0;
    error.partial_completed = all.length;
    error.partial_total = beats.length;
    throw error;
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

  const normalizedShots = normalizeShots(all, {
    ...ctx,
    characters: normalizeCharacters(
      Array.isArray(blueprint.characters) && blueprint.characters.length ? blueprint.characters : ctx.characters,
      `${ctx.request_id || ''}|${ctx.brief || ''}|${ctx.product_subject || ''}`,
    ),
  });
  const shots = narrativeOrder.canonicalize(normalizedShots, { blueprint, coveragePlan }).shots;
  return { shots, model_meta: meta, coverage_plan: coveragePlan };
}

function issueShotIndexes(issue = '', total = 0) {
  const matches = [...String(issue || '').matchAll(/(?:shot|镜头|第)?\s*(\d{1,3})/gi)];
  return matches.map(match => Number(match[1])).filter(index => index >= 1 && index <= total);
}

async function rewriteStoryboard(ctx, blueprint, shots, issues, { taskId = '', onlyIndexes = null } = {}) {
  if (!Array.isArray(issues) || !issues.length) return shots;
  const indexes = Array.isArray(onlyIndexes)
    ? onlyIndexes.filter(index => Number.isInteger(index) && index >= 1 && index <= shots.length)
    : Array.from(new Set(issues.flatMap(issue => issueShotIndexes(issue, shots.length))));
  if (!indexes.length) return shots;
  if (indexes.length > 8) {
    let repaired = shots;
    for (const batch of chunksOf(indexes, 8)) {
      repaired = await rewriteStoryboard(ctx, blueprint, repaired, issues, { taskId, onlyIndexes: batch });
    }
    return repaired;
  }
  const selected = indexes.map(index => shots[index - 1]).filter(Boolean);
  const selectedIssues = issues.filter(issue => issueShotIndexes(issue, shots.length).some(index => indexes.includes(index)));

  const systemPrompt = [
    'You are the storyboard rewrite agent. Return a JSON array containing only the requested shot indexes.',
    'All user-visible text values must be natural Simplified Chinese. Keep JSON keys, technical enum values, IDs, indexes and durations unchanged.',
    'Preserve each original index. Do not add, remove, merge or reorder shots.',
    'Keep characters, advertised subject, and story order.',
    'Do not add new story events that the user did not provide.',
    brandEnding.enabled(ctx)
      ? 'Preserve the final shot brand safe area inside its current approved scene, but never render the Logo itself.'
      : 'No authorized Logo is active. Remove visual Logo instructions and keep an ordinary natural story ending.',
    'Fix thin shots by strengthening the visual layers required by the user brief.',
    'For every repaired shot, dynamically choose shot_size, camera_angle, lens_mm, depth_of_field, composition, subject_position and camera_movement from that shot purpose; never copy a fixed camera template.',
    'Write production-ready visual and action fields with task-relevant subject/product, environment, spatial relationship and proportions, plus material and lighting only where relevant.',
    'Write visible entry_frame_state, exit_frame_state, action_start, action_end and object_states for every repaired shot, including shot 1.',
    actionSemantics.promptBlock(),
    'keyframe_notes must contain exactly three task-specific clauses: “本镜目的：…；必须出现：…；禁止出现：…”.',
    'Remove replacement characters, mojibake, placeholders and runs of question marks from every user-visible field.',
    'Keep the requested commercial, story, product, proof, brand, UI, space, emotion or comparison dimensions visible as applicable.',
    'Preserve and enforce Advanced production controls from context: scene direction, product presentation, style direction and negative requirements.',
    'Preserve scene_id, look_id, scene_revision, scene_view, camera_id, scene_zone_id, zone_ids, anchor_ids and transition_reason whenever they are valid for the current task scene assets and character looks. scene_zone_label_zh may be repaired into Simplified Chinese without changing those IDs.',
    'The preserved scene_id is the only physical location authority. Remove furniture, fixtures, counters, booths, rooms, props, zones or anchors that belong only to another task scene while preserving the approved action and spoken line.',
    'Preserve and repair adjacent-shot entry/exit state, action start/end, screen direction, eyeline, camera axis, camera movement, object state, transition type, transition_design and audio bridge. Preserve micro_expression as observable gaze/eyelid/brow/mouth/jaw/head/gesture evidence rather than an abstract emotion word.',
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
  const merged = shots.map((shot, idx) => {
    if (!repairedByIndex.has(idx + 1)) return shot;
    const repaired = repairedByIndex.get(idx + 1);
    return {
      ...shot,
      ...repaired,
      index: idx + 1,
      shot_id: shot.shot_id,
      coverage_id: shot.coverage_id,
      source_beat_id: shot.source_beat_id,
      story_flow_contract_fingerprint: shot.story_flow_contract_fingerprint,
      character_ids: shot.character_ids,
      look_bindings: shot.look_bindings,
      voice_bindings: shot.voice_bindings,
      characters: shot.characters,
      expected_people: shot.expected_people,
      scene_id: shot.scene_id,
      scene_asset_id: shot.scene_asset_id,
      scene_revision: shot.scene_revision,
      sound_profile_id: shot.sound_profile_id,
    };
  });
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
  normalizeKeyframeNotes,
  alignShotsToBeats,
  missingBeatIndexes,
  plannedBeats,
  storyboardCoveragePlan,
  beatsFromCoveragePlan,
  storyboardBeatChunks,
  storyboardBlueprintDigest,
};
