const modelGateway = require('./modelGateway');
const jsonRepair = require('./jsonRepairService');
const { contextPrompt, normalizeCharacters } = require('./contextBuilder');

const { ensureChineseOutput } = require('./outputLanguageService');
const { polishBlueprint } = require('./blueprintQualityService');
const brandEnding = require('./brandEndingService');
const { BLUEPRINT_PROGRESS_TOTAL } = require('./blueprintProgressService');
const productionLimits = require('./productionLimitsService');

const EXPLICIT_SHOT_NUMBER_PATTERN = '(?:[1-9]|[1-9][0-9]|1[01][0-9]|120)';

const DIALOGUE_CONTRACT_VERSION = 'dialogue-arc-v1';
const CAUSAL_STORY_CONTRACT_VERSION = 'causal-story-v1';
const CAUSAL_ARC_TYPES = new Set(['conflict_resolution', 'transformation', 'demonstration', 'journey']);
const CAUSAL_ROLES = new Set(['setup', 'trigger', 'development', 'evidence', 'transformation', 'resolution', 'brand_closure']);

function inferDialogueFunction(beat = {}, index = 0, total = 1) {
  const explicit = clean(beat.dialogue_function || beat.dialogue_intent || '', 40).toLowerCase().replace(/[\s-]+/g, '_');
  const allowed = new Set(['setup_goal', 'obstacle', 'question', 'discovery', 'proof', 'value_shift', 'decision', 'result', 'resolution', 'brand_closure', 'development']);
  if (allowed.has(explicit)) return explicit;
  if (/品牌|落版|收束|号召/.test(explicit)) return 'brand_closure';
  if (/结果|解决|决定|选择|行动/.test(explicit)) return 'decision';
  if (/证明|证据|验证|体验|演示/.test(explicit)) return 'proof';
  if (/转折|反转|发现|灵感|认知/.test(explicit)) return 'discovery';
  if (/冲突|问题|困难|受阻|压力|危机|怀疑/.test(explicit)) return 'obstacle';
  const role = clean(`${beat.role || ''} ${beat.purpose || ''}`, 100);
  if (/品牌|落版|收束|号召/.test(role)) return 'brand_closure';
  if (/结果|解决|决定|选择|行动/.test(role)) return index >= total - 2 ? 'decision' : 'result';
  if (/证明|证据|验证|体验|演示/.test(role)) return 'proof';
  if (/转折|反转|发现|灵感|认知/.test(role)) return 'discovery';
  if (/冲突|问题|困难|受阻|压力|危机|怀疑/.test(role)) return 'obstacle';
  if (index === 0) return 'setup_goal';
  if (index === total - 1) return 'resolution';
  return 'development';
}

function inferCausalRole(beat = {}, dialogueFunction = '', index = 0, total = 1) {
  const explicit = clean(beat.causal_role || '', 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (CAUSAL_ROLES.has(explicit)) return explicit;
  if (['setup_goal', 'obstacle', 'question'].includes(dialogueFunction)) return 'setup';
  if (dialogueFunction === 'discovery') return index <= 0 ? 'trigger' : 'development';
  if (dialogueFunction === 'proof') return 'evidence';
  if (dialogueFunction === 'value_shift') return 'transformation';
  if (['decision', 'result', 'resolution'].includes(dialogueFunction)) return 'resolution';
  if (dialogueFunction === 'brand_closure') return 'brand_closure';
  if (index === 0) return 'setup';
  if (index === total - 1) return 'resolution';
  return 'development';
}

function inferAdPhase(beat = {}, index = 0, total = 1) {
  const explicit = clean(beat.ad_phase || beat.adPhase || '', 40).toLowerCase().replace(/[\s-]+/g, '_');
  if (['opening_hook', 'product_introduction', 'product_proof', 'transformation', 'closing_payoff'].includes(explicit)) return explicit;
  if (index === 0) return 'opening_hook';
  if (index === total - 1) return 'closing_payoff';
  const evidence = clean(`${beat.dialogue_function || ''} ${beat.role || ''} ${beat.visual_proof || ''} ${beat.selling_point || ''}`, 260);
  if (/证明|证据|细节|对比|演示|proof|evidence|detail|comparison/i.test(evidence)) return 'product_proof';
  if (/变化|组合|拆解|分解|转化|transform|assembl|morph/i.test(evidence)) return 'transformation';
  return index === 1 ? 'product_introduction' : 'product_proof';
}

function cleanList(value, maxItems = 12, maxText = 180) {
  return (Array.isArray(value) ? value : (value ? [value] : []))
    .map(item => clean(item, maxText))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizedBeatRefs(value = {}, beatCount = 0) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(['setup', 'trigger', 'progression', 'result'].map(key => [
    key,
    (Array.isArray(source[key]) ? source[key] : [])
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 1 && index <= beatCount),
  ]));
}

function normalizeNarrativeContract(value, beatCount = 0) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!source) return null;
  const arcType = clean(source.arc_type || '', 40).toLowerCase();
  return {
    version: CAUSAL_STORY_CONTRACT_VERSION,
    arc_type: CAUSAL_ARC_TYPES.has(arcType) ? arcType : 'journey',
    setup: clean(source.setup || source.initial_state || source.premise || '', 260),
    trigger: clean(source.trigger || source.intervention || source.catalyst || '', 260),
    progression: clean(source.progression || source.evidence || source.change || '', 320),
    result: clean(source.result || source.outcome || source.resolution || '', 260),
    beat_refs: normalizedBeatRefs(source.beat_refs, beatCount),
  };
}

function allocateBeatDurations(beats = [], targetDuration = 30) {
  if (!beats.length) return [];
  const target = Math.max(beats.length, Math.round(Number(targetDuration || 30) || 30));
  const base = Math.floor(target / beats.length);
  let remainder = target - base * beats.length;
  return beats.map(beat => {
    const duration = Math.max(1, base + (remainder-- > 0 ? 1 : 0));
    return { ...beat, duration, duration_sec: duration };
  });
}

function reportBlueprintProgress(onProgress, phase, completed, message) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress({
      stage: 'blueprint',
      phase,
      completed: Math.max(0, Math.min(BLUEPRINT_PROGRESS_TOTAL, Number(completed) || 0)),
      total: BLUEPRINT_PROGRESS_TOTAL,
      message,
    });
  } catch {}
}

function desiredBeatCount(ctx = {}) {
  if (ctx.shot_count) return productionLimits.shotCount(ctx.shot_count);
  return 0;
}

function authoredStructureText(ctx = {}) {
  const brief = [
    ctx.brief,
    ctx.original_brief,
    ctx.story_structure,
  ].filter(Boolean).join('\n');
  return (brief.match(/(?:剧情结构|脚本结构|分镜结构|内容结构|结构)\s*[:：]?([\s\S]*)/) || [])[1] || brief;
}

function explicitAuthoredSegments(ctx = {}) {
  const text = authoredStructureText(ctx);
  const marker = new RegExp(`(?:\\[|【)\\s*(?:镜头|分镜|shot)\\s*(${EXPLICIT_SHOT_NUMBER_PATTERN})\\s*(?:\\]|】)|(?:^|[\\s。；;，,•])第\\s*(${EXPLICIT_SHOT_NUMBER_PATTERN})\\s*(?:镜|个镜头|个分镜)(?=[:：、.\\s]|$)`, 'gim');
  const matches = [];
  let found;
  while ((found = marker.exec(text))) {
    matches.push({
      index: Number(found[1] || found[2]),
      start: found.index,
      end: marker.lastIndex,
    });
  }
  const sequences = [];
  let current = [];
  matches.forEach(item => {
    if (item.index === 1) {
      if (current.length) sequences.push(current);
      current = [item];
      return;
    }
    if (current.length && item.index === current.length + 1) current.push(item);
  });
  if (current.length) sequences.push(current);
  const sequence = sequences.sort((a, b) => b.length - a.length)[0] || [];
  if (sequence.length < 2) return [];
  return sequence.map((item, offset) => {
    const next = sequence[offset + 1];
    const raw = text.slice(item.end, next ? next.start : text.length)
      .replace(/^[\s•:：、.\-—]+/, '')
      .trim();
    const speechMatch = raw.match(/(?:^|[\s•；;。])(?:旁白|画外音|配音|VO|台词|对白|解说)(?:\s*[\(（][^()（）]{0,20}[\)）])?\s*[:：]\s*([^•\r\n]+)/i);
    const spokenLine = cleanSpeech(speechMatch?.[1] || '', 100);
    const visualRaw = (speechMatch ? raw.replace(speechMatch[0], ' ') : raw)
      .replace(/\s*•\s*$/, '')
      .trim();
    const descriptor = visualRaw.match(/^([^-—]{1,30})\s*[-—]\s*([\s\S]+)$/);
    return {
      index: item.index,
      raw,
      shot_type: clean(descriptor?.[1] || '', 80),
      visual: clean(descriptor?.[2] || visualRaw, 600),
      spoken_line: spokenLine,
    };
  });
}

function sequentialMarkerCount(text = '', patterns = []) {
  const nums = [];
  patterns.forEach(pattern => {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(text))) nums.push(Number(match[1]));
  });
  const unique = [...new Set(nums.filter(value => value >= 1 && value <= productionLimits.MAX_SHOT_COUNT))].sort((a, b) => a - b);
  if (unique.length < 2) return 0;
  return unique.every((value, index) => value === index + 1) ? unique.length : 0;
}

function explicitSegmentCount(ctx = {}) {
  const authoredSegments = explicitAuthoredSegments(ctx);
  if (authoredSegments.length >= 2) return authoredSegments.length;
  const text = authoredStructureText(ctx);
  return sequentialMarkerCount(text, [
    new RegExp(`(?:^|[\\s。；;，,])(?:\\[|【)?\\s*(?:镜头|分镜|shot)\\s*(${EXPLICIT_SHOT_NUMBER_PATTERN})\\s*(?:\\]|】|[:：、.\\s]|$)`, 'gim'),
    new RegExp(`(?:^|[\\s。；;，,])第\\s*(${EXPLICIT_SHOT_NUMBER_PATTERN})\\s*(?:镜|个镜头|个分镜)(?:[:：、.\\s]|$)`, 'gim'),
    new RegExp(`(?:^|[\\r\\n。；;])\\s*(${EXPLICIT_SHOT_NUMBER_PATTERN})\\s*[\\.、．:：]`, 'gm'),
  ]);
}

function authoredSpeechPlan(ctx = {}) {
  const segments = explicitAuthoredSegments(ctx);
  const text = authoredStructureText(ctx);
  const matches = text.match(/(?:^|[\s；;。•])(?:旁白|画外音|配音|VO|台词|对白|解说)(?:\s*[\(（][^()（）]{0,20}[\)）])?\s*[:：]\s*[^\r\n；;。•]+/gim) || [];
  const lineCount = Math.min(productionLimits.MAX_SHOT_COUNT, segments.length
    ? segments.filter(segment => segment.spoken_line).length
    : matches.length);
  const segmentCount = segments.length || explicitSegmentCount(ctx);
  return {
    policy: segmentCount >= 2 && lineCount > 0 && lineCount < segmentCount ? 'authored_sparse' : 'full_track',
    authored_line_count: lineCount,
    segment_count: segmentCount,
  };
}

function alignBlueprintToAuthoredSegments(ctx = {}, payload = {}) {
  const segments = explicitAuthoredSegments(ctx);
  if (!segments.length) return payload;
  const source = Array.isArray(payload?.beats) ? payload.beats : [];
  const indexed = new Map(source.map((beat, index) => [
    Number(beat?.beat_index || beat?.index || index + 1),
    beat || {},
  ]));
  const beats = segments.map((segment, index) => {
    const existing = indexed.get(segment.index) || source[index] || {};
    const visual = segment.visual || clean(existing.plot || existing.story_visual || existing.action || '', 600);
    const spoken = segment.spoken_line;
    return {
      ...existing,
      beat_index: segment.index,
      role: existing.role || (index === segments.length - 1 ? '剧情收束' : '剧情推进'),
      causal_role: existing.causal_role || (index === 0 ? 'setup' : (index === segments.length - 1 ? 'resolution' : 'development')),
      shot_type: segment.shot_type || existing.shot_type || '',
      plot: visual,
      story_visual: visual,
      action: clean(existing.action || `主体按用户第 ${segment.index} 镜要求完成对应动作，镜头保留动作过程与可见结果。`, 180),
      spoken_line: spoken,
      speech_mode: spoken ? 'voiceover' : 'ambient_only',
      visual_layers: [
        ...(Array.isArray(existing.visual_layers) ? existing.visual_layers : []),
        { type: 'story', content: visual },
      ].filter(layer => clean(layer?.content || '', 600)),
    };
  });
  return { ...(payload || {}), beats };
}

function pacingProfile(ctx = {}) {
  const exactCount = desiredBeatCount(ctx);
  const targetDuration = productionLimits.targetDuration(ctx.target_duration || ctx.duration || ctx.duration_sec);
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
  const durationRecommended = Math.max(3, Math.min(productionLimits.MAX_AUTO_BLUEPRINT_BEATS, Math.round(targetDuration / preferredSecondsPerBeat)));
  const recommended = exactCount || explicitSegments || durationRecommended;
  const durationLimit = Math.min(productionLimits.MAX_SHOT_COUNT, Math.floor(targetDuration / minimumSecondsPerBeat));
  const structureLimit = explicitSegments ? Math.min(productionLimits.MAX_SHOT_COUNT, explicitSegments + (fastCut ? 2 : 1)) : productionLimits.MAX_AUTO_BLUEPRINT_BEATS;
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
    causal_role: first.causal_role || last.causal_role || '',
    state_before: cleanList(first.state_before),
    state_after: cleanList(last.state_after),
    intended_changes: cleanList(group.flatMap(beat => cleanList(beat.intended_changes)), 16, 180),
    visible_evidence: cleanList(group.flatMap(beat => cleanList(beat.visible_evidence)), 16, 180),
    spoken_line: mergeText(group.map(beat => beat.spoken_line).slice(0, 2), 100) || first.spoken_line || last.spoken_line || '',
    why_next: last.why_next || first.why_next || '',
  };
}

function compactBeatsByPacing(beats = [], limit = productionLimits.MAX_AUTO_BLUEPRINT_BEATS) {
  const max = Math.max(1, Math.min(productionLimits.MAX_SHOT_COUNT, Number(limit) || productionLimits.MAX_AUTO_BLUEPRINT_BEATS));
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
  const speechPlan = authoredSpeechPlan(ctx);
  const normalizedBeats = beats.map((beat, idx) => {
    const dialogueFunction = inferDialogueFunction(beat, idx, beats.length);
    const explicitSpeech = cleanSpeech(beat.spoken_line || beat.voiceover || beat.copy || '', 100);
    const speechMode = clean(beat.speech_mode || '', 30).toLowerCase().replace(/[\s-]+/g, '_');
    const silent = speechPlan.policy === 'authored_sparse'
      && (['silent', 'ambient_only'].includes(speechMode) || !explicitSpeech);
    return {
      beat_index: Number(beat.beat_index || beat.index || idx + 1),
      role: clean(beat.role || beat.story_role || 'story', 50),
      ad_phase: inferAdPhase(beat, idx, beats.length),
      causal_role: inferCausalRole(beat, dialogueFunction, idx, beats.length),
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
      state_before: cleanList(beat.state_before || beat.entry_state, 12, 180),
      state_after: cleanList(beat.state_after || beat.exit_state, 12, 180),
      intended_changes: cleanList(beat.intended_changes || beat.intended_change || beat.changes, 12, 180),
      visible_evidence: cleanList(beat.visible_evidence || beat.evidence_requirements || beat.visual_evidence, 12, 180),
      spoken_line: silent ? '' : (explicitSpeech || cleanSpeech(fallbackSpokenLine(beat, idx, ctx), 100)),
      speech_mode: silent ? (speechMode === 'ambient_only' ? 'ambient_only' : 'silent')
        : (speechMode === 'dialogue' ? 'dialogue' : 'voiceover'),
      dialogue_function: dialogueFunction,
      why_next: clean(beat.why_next || '', 120),
    };
  }).filter(x => x.plot || x.story_visual || x.promo_visual || x.visual_proof || x.spoken_line);
  const limitedBeats = compactBeatsByPacing(normalizedBeats, beatLimit);
  const timedBeats = allocateBeatDurations(limitedBeats, profile.targetDuration);
  const structuredBeats = timedBeats.map((beat, index) => ({
    ...beat,
    ad_phase: inferAdPhase(beat, index, timedBeats.length),
  }));
  return {
    story_title: bp.story_title || bp.title || (ctx.product_subject ? `${ctx.product_subject}剧情广告` : '原创故事短片'),
    logline: bp.logline || bp.synopsis || '',
    beat_style: bp.beat_style || 'content_driven_visual_beats',
    visual_requirements: Array.isArray(bp.visual_requirements) ? bp.visual_requirements.map(x => clean(x, 80)).filter(Boolean) : [],
    target_beat_count: Number(targetCount || timedBeats.length || recommendedCount || 0) || 0,
    target_duration: profile.targetDuration,
    causal_contract_required: ctx.require_causal_contract === true
      || bp.causal_contract_required === true
      || !!bp.narrative_contract,
    narrative_contract: normalizeNarrativeContract(bp.narrative_contract, timedBeats.length),
    dialogue_contract: {
      version: DIALOGUE_CONTRACT_VERSION,
      target_chars_per_second: { min: 2.4, max: 4.8 },
      required_arc: ['setup_or_obstacle', 'development_or_proof', 'decision_or_resolution'],
      speech_policy: speechPlan.policy,
      authored_line_count: speechPlan.authored_line_count,
    },
    ad_structure_contract: {
      version: 'opening-proof-closing-v1',
      required_phases: ['opening_hook', 'product_introduction_or_proof', 'closing_payoff'],
      first_beat: 'opening_hook',
      final_beat: 'closing_payoff',
    },
    copy_naturalness_policy: {
      version: 'meaning-preserving-spoken-copy-v1',
      preserve: ['facts', 'brand_terms', 'numbers', 'claims', 'speaker_intent'],
      improve: ['remove_empty_summary', 'remove_formulaic_parallelism', 'vary_sentence_length', 'natural_spoken_rhythm'],
      never_apply_to: ['camera_contracts', 'image_prompts', 'video_effect_timelines', 'legal_claims'],
    },
    segment_plan: Array.isArray(bp.segment_plan) ? bp.segment_plan : [],
    characters: noHuman ? [] : normalizeCharacters(Array.isArray(bp.characters) && bp.characters.length ? bp.characters : ctx.characters, characterSeed),
    beats: structuredBeats,
    model_meta: bp.model_meta || {},
  };
}

async function repairExplicitBlueprintStructure(ctx, payload, { taskId = '' } = {}) {
  const expectedCount = explicitSegmentCount(ctx);
  const actualCount = Array.isArray(payload?.beats) ? payload.beats.length : 0;
  if (!expectedCount) return payload;
  const deterministic = alignBlueprintToAuthoredSegments(ctx, payload);
  if (Array.isArray(deterministic.beats) && deterministic.beats.length === expectedCount) return deterministic;
  if (actualCount === expectedCount) return payload;
  let result;
  try {
    result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.blueprint_structure_repair',
      systemPrompt: [
        'You repair only the structure of a story-ad blueprint. Return strict JSON only.',
        'The user-authored shot markers are authoritative. Produce exactly one beat for each marker, in the same order.',
        'Do not merge, omit, reorder or invent user events. Preserve task facts, people, scenes, products and authored speech.',
        'A shot without authored dialogue may use speech_mode silent or ambient_only and an empty spoken_line.',
        'Keep all user-visible values in natural Simplified Chinese. Keep JSON keys and technical enums unchanged.',
      ].join('\n'),
      userPrompt: `Authoritative authored structure (${expectedCount} shots):\n${authoredStructureText(ctx).slice(0, 12000)}\n\nCurrent parsed blueprint (${actualCount} beats):\n${JSON.stringify(payload).slice(0, 22000)}\n\nReturn the complete blueprint with exactly ${expectedCount} beats.`,
      maxTokens: 8000,
      temperature: 0.2,
    });
  } catch (error) {
    error.details = {
      ...(error.details || {}),
      expected_beat_count: expectedCount,
      actual_beat_count: actualCount,
      reusable_draft_available: true,
      failed_stage: 'blueprint_structure_repair',
    };
    throw error;
  }
  const parsed = await jsonRepair.parseOrRepair({
    raw: result.text,
    expected: 'object',
    modelGateway,
    taskId,
    stage: 'new_story_ad.json_repair',
  });
  if (!Array.isArray(parsed.beats) || parsed.beats.length !== expectedCount) {
    const error = new Error(`用户明确提供了 ${expectedCount} 个镜头，但结构修复仅返回 ${Array.isArray(parsed.beats) ? parsed.beats.length : 0} 个；本次结果未保存`);
    error.code = 'BLUEPRINT_EXPLICIT_STRUCTURE_INCOMPLETE';
    error.retryable = true;
    error.details = { expected_beat_count: expectedCount, actual_beat_count: Array.isArray(parsed.beats) ? parsed.beats.length : 0 };
    throw error;
  }
  return parsed;
}

async function generateBlueprint(ctx, {
  taskId = '',
  onProgress = null,
  draftCheckpoint = null,
  onDraftReady = null,
} = {}) {
  const targetCount = desiredBeatCount(ctx);
  const profile = pacingProfile(ctx);
  const recommendedCount = profile.recommended;
  const beatLimit = profile.maxReasonable;
  const speechPlan = authoredSpeechPlan(ctx);
  const narrativeOnly = ctx.content_mode === 'narrative_story' || ctx.product_presentation?.mode === 'narrative_story';
  const systemPrompt = [
    'You are the story blueprint writer for the New Story Ad module.',
    'Return strict JSON only. Do not write markdown or backend explanations.',
    'All user-visible text values must be natural Simplified Chinese, including titles, logline, character names/descriptions, scene descriptions, plot, visuals, actions, spoken lines, purposes and continuity explanations. JSON keys and technical enum values stay unchanged. Brand/product/API/UI names may remain in their original spelling.',
    'Write a causal short story with a clear initial state, trigger or intervention, visible progression and concrete result. Do not write a feature checklist or a sequence of unrelated selling-point demonstrations.',
    'Choose the most suitable open-domain causal arc: conflict_resolution, transformation, demonstration or journey. Do not fabricate a crisis, rejection, illness, failure or other negative state merely to satisfy a dramatic template.',
    'Return narrative_contract version causal-story-v1 with arc_type, setup, trigger, progression, result and beat_refs. The contract must describe only facts supported by this task.',
    'Every beat must include causal_role using setup, trigger, development, evidence, transformation, resolution or brand_closure, plus state_before, state_after, intended_changes and visible_evidence arrays.',
    narrativeOnly
      ? 'This is a pure narrative/story task. Build visible story progression from character actions, place, time and emotional change. Do not invent a product, brand, selling point, purchase prompt or conversion goal.'
      : 'Prove selling points through visible actions, product/UI feedback, comparison or outcome. Characters must not simply recite product claims.',
    'Spoken lines must sound like natural conversational Chinese and fit the shot duration. Avoid translated phrasing and advertising clichés such as universe-like, industry-leading, empower, maximize your budget, faster and smarter, or one-stop solution.',
    'The spoken track must carry the story, not merely react to visuals. Do not hide motivation, obstacle, evidence, value change or decision only in plot, visual, action or why_next.',
    'Give every beat a distinct dialogue_function such as setup_goal, obstacle, question, discovery, proof, value_shift, decision, resolution or brand_closure. Across the whole film, the heard lines must cover setup/obstacle, development/proof and decision/resolution.',
    narrativeOnly
      ? 'The story must have a visible beginning, development and ending: establish the requested character and place, advance the requested events through observable actions, and resolve the emotional or narrative change. The middle must not be forced into product proof.'
      : 'Every advertisement must have a visible beginning, middle proof and ending: beat 1 is an opening hook or establishing problem/scene; middle beats introduce the actual product, material, service or scene-embedded result and prove it through detail, use, comparison, transformation, assembly or outcome; the final beat resolves the value and closes on a stable result or authorized brand ending. Do not start with an unexplained beauty shot or end immediately after a detail montage.',
    'For natural Chinese with deliberate pauses, target roughly 2.4-4.8 spoken Chinese characters per second across the full film. A normal 4-6 second beat usually needs about 10-22 meaningful characters; a brand end card may be shorter.',
    'Do not use a generic reaction such as “原来……可以这样做”“就是它了”“太棒了” as the whole line. Each line must add a concrete intention, question, product/material evidence, consequence or decision.',
    'Avoid repeating the same opening word or sentence pattern in adjacent beats. Concise means information-dense, not empty.',
    'Natural spoken-copy pass: preserve all facts, brand terms, numbers, claims and speaker intent; remove empty conclusions, overly symmetrical parallel phrasing, mechanical transition words and correct-but-useless filler. Vary sentence length and allow controlled spoken pauses, but never introduce mistakes, vague claims or deliberately broken language.',
    'The visual field describes what the audience sees; the action field describes what changes or what the subject does. Never duplicate the same sentence across visual and action.',
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
    speechPlan.policy === 'authored_sparse'
      ? `The user authored ${speechPlan.authored_line_count} spoken line(s) across ${speechPlan.segment_count} explicit shots. Preserve this sparse speech plan: do not invent speech for silent shots; use speech_mode silent or ambient_only and an empty spoken_line there.`
      : 'Every beat must include spoken_line. If the picture is a silent product, space, UI or proof shot, write a short narrator line instead of leaving it blank.',
    'spoken_line is not a subtitle field. It must contain the final words for dialogue or narrator voice only, without any prefix such as "字幕:", "旁白:", "台词:", "解说:" or speaker-type tags.',
    'If Advanced production controls are enabled, obey scene direction, product presentation methods, style direction and negative requirements as hard constraints.',
    narrativeOnly
      ? 'Product presentation is disabled for this pure story. Leave product, selling_point and promo_visual empty unless the user explicitly adds a commercial subject later.'
      : 'When product presentation is enabled, each suitable beat must reserve a visible product/proof/material role according to presence and lock strength.',
    'Never put explicitly forbidden people, objects, carrier forms, styles or wrong products into beats.',
    'Originality and rights are hard production constraints for every industry: create original characters, scenes, plot actions and visual compositions. Never reproduce or closely imitate a film, series, animation, game, advertisement, poster, album cover or protected character.',
    'Never request the style, likeness, face, voice or recognizable identity of a named artist, director, photographer, celebrity, public figure, influencer or third-party character. Do not write face-swap, identity-bypass or review-bypass instructions.',
    'User-provided first-party brand names and product facts may appear naturally in dialogue, narration and editable subtitles. A visual logo, trademark or brand wordmark must be represented only as an authorized asset added in post-production; never ask an image model to generate, transform, infer or imitate it.',
    brandEnding.enabled(ctx)
      ? 'An authorized Logo asset is active. Keep the final beat inside the current confirmed story scene, reserve the configured clear safe area, and end on a stable frame. The exact asset is added only after video generation.'
      : 'No authorized Logo asset is active. End the story naturally with no Logo safe area, no brand end card and no visual Logo request, even if legacy brief text mentions one.',
    'If the brief contains an inspiration reference, translate it into generic high-level traits such as pacing, lighting, framing, material mood or emotional tone without naming or copying the reference.',
  ].join('\n');

  const userPrompt = `${contextPrompt(ctx)}

Return JSON in this shape:
{
  "story_title": "title",
  "logline": "one sentence story",
  "beat_style": "content_driven_visual_beats",
  "visual_requirements": ["story", "product", "material", "proof"],
  "target_beat_count": ${targetCount || recommendedCount || 0},
  "narrative_contract": {
    "version": "causal-story-v1",
    "arc_type": "conflict_resolution/transformation/demonstration/journey",
    "setup": "initial state or goal",
    "trigger": "event, action or product intervention that starts change",
    "progression": "filmable process and visible evidence",
    "result": "observable result and commercial resolution",
    "beat_refs": {"setup":[1],"trigger":[2],"progression":[2,3],"result":[4]}
  },
  "segment_plan": [{"segment_id":"seg_1","name":"section","space_anchor":"fixed space or carrier","fixed_subjects":"fixed subjects/relationships","continuity_rules":["rules"]}],
  "characters": [{"name":"fresh stable formal person name for this task when a human appears; empty array for no_human mode","role":"story function","gender":"female/male/unknown","description":"appearance, identity, behavior"}],
  "beats": [{
    "beat_index": 1,
    "role": "story function label",
    "ad_phase": "opening_hook/product_introduction/product_proof/transformation/closing_payoff",
    "causal_role": "setup/trigger/development/evidence/transformation/resolution/brand_closure",
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
    "state_before": ["observable state before this beat"],
    "state_after": ["observable state after this beat"],
    "intended_changes": ["what is allowed to change"],
    "visible_evidence": ["what the audience can directly see proving the change"],
    "dialogue_function": "setup_goal/obstacle/question/discovery/proof/value_shift/decision/resolution/brand_closure/development",
    "speech_mode": "dialogue/voiceover/silent/ambient_only",
    "spoken_line": "natural line heard in final video, without label prefix",
    "why_next": "why the next beat follows"
  }]
}

${ctx.shot_count ? `Beat count must equal the user-specified ${ctx.shot_count} shots.` : profile.explicitSegments ? `The user's explicit shot markers are authoritative. Beat count must equal ${profile.explicitSegments}; preserve every marked event in order and do not merge them.` : `Beat count is content-driven. Do not force the exact recommended number, but keep the result compact for the target duration; normal shots should have enough time to be understood, and only explicit fast-cut or dense step-by-step briefs should approach the upper bound ${beatLimit}.`}
For multi-person stories, keep names, roles, relationships and speaker ownership stable across all beats.`;

  let result;
  let language;
  const reusableDraft = draftCheckpoint
    && draftCheckpoint.reusable === true
    && draftCheckpoint.payload
    && typeof draftCheckpoint.payload === 'object'
    && Array.isArray(draftCheckpoint.payload.beats);
  if (reusableDraft) {
    result = draftCheckpoint.model_meta || {};
    language = {
      payload: draftCheckpoint.payload,
      repaired: draftCheckpoint.language_repaired === true,
      model_meta: draftCheckpoint.language_model ? { used_model: draftCheckpoint.language_model } : {},
    };
    reportBlueprintProgress(onProgress, 'draft_ready', 3, '已复用同一内容版本的剧本初稿，正在继续结构修复与质量审核。');
  } else {
    reportBlueprintProgress(onProgress, 'draft_generation', 1, '上下文和原创过审规则已准备，正在生成剧本初稿。');
    result = await modelGateway.generateText({
      taskId,
      stage: 'new_story_ad.blueprint',
      systemPrompt,
      userPrompt,
      maxTokens: 5200,
    });
    reportBlueprintProgress(onProgress, 'draft_ready', 2, '剧本初稿已返回，正在校验 JSON 结构。');
    const parsed = await jsonRepair.parseOrRepair({
      raw: result.text,
      expected: 'object',
      modelGateway,
      taskId,
      stage: 'new_story_ad.json_repair',
    });
    reportBlueprintProgress(onProgress, 'structure_validated', 3, '剧本结构已校验，正在检查中文表达和可拍性。');
    language = await ensureChineseOutput({ payload: parsed, kind: 'blueprint', taskId, context: ctx });
    if (typeof onDraftReady === 'function') {
      await onDraftReady({
        payload: language.payload,
        model_meta: {
          used_model: result.used_model,
          fallback_used: result.fallback_used,
          failed_models: result.failed_models,
        },
        language_repaired: language.repaired,
        language_model: language.model_meta?.used_model || '',
        expected_beat_count: explicitSegmentCount(ctx),
        actual_beat_count: Array.isArray(language.payload?.beats) ? language.payload.beats.length : 0,
      });
    }
  }
  const structuredPayload = await repairExplicitBlueprintStructure(ctx, language.payload, { taskId });
  reportBlueprintProgress(onProgress, 'language_checked', 4, '中文表达已检查，正在执行质量与版权/IP 风险审核。');
  const causalCtx = { ...ctx, require_causal_contract: true };
  const firstPass = normalizeBlueprint(structuredPayload, causalCtx);
  const polish = await polishBlueprint(ctx, firstPass, { taskId, onProgress });
  reportBlueprintProgress(onProgress, 'quality_approved', 5, '剧情质量和版权/IP 风险审核已通过，正在保存最终剧本。');
  const normalized = brandEnding.applyToBlueprint(normalizeBlueprint(polish.blueprint, causalCtx), ctx);
  normalized.model_meta = {
    used_model: result.used_model,
    fallback_used: result.fallback_used,
    failed_models: result.failed_models,
    language_repaired: language.repaired,
    language_model: language.model_meta?.used_model || '',
    polished: polish.polished,
    polish_model: polish.model_meta?.used_model || '',
    quality_before: polish.before,
    quality_after: polish.after,
    rights_policy_version: polish.after?.rights?.policy_version || polish.before?.rights?.policy_version || '',
    rights_pass: polish.after?.rights?.pass !== false,
  };
  return normalized;
}

module.exports = {
  BLUEPRINT_PROGRESS_TOTAL,
  generateBlueprint,
  normalizeBlueprint,
  desiredBeatCount,
  pacingProfile,
  explicitSegmentCount,
  authoredSpeechPlan,
  explicitAuthoredSegments,
  alignBlueprintToAuthoredSegments,
  repairExplicitBlueprintStructure,
  recommendedBeatCount,
  softBeatLimit,
};
