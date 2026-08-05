const CONTRACT_VERSION = 'reference-understanding-v6';

const NARRATIVE_MODES = new Set(['narrative_story', 'showcase_montage']);
const FABRICATED_SEQUENCE_PATTERN = /形成下一事件[“"]/u;
const GENERIC_STORY_PATTERN = /^(?:通过)?(?:真实)?镜头时间线展示.+核心价值与可见结果[。.]?$/u;
const GENERIC_SCENE_PATTERN = /按镜头时间线展示广告主体、空间关系和可见结果/u;

function text(value = '', max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max = 120) {
  return (Array.isArray(value) ? value : []).filter(Boolean).slice(0, max);
}

function range(value = [], fallback = [0, 0]) {
  const candidate = Array.isArray(value) ? value.map(Number).slice(0, 2) : [];
  if (candidate.length === 2 && candidate.every(Number.isFinite) && candidate[1] >= candidate[0]) {
    return candidate.map(number => Number(number.toFixed(3)));
  }
  return fallback;
}

function overlaps(left = [], right = []) {
  return Number(left[0] || 0) <= Number(right[1] || 0) && Number(right[0] || 0) <= Number(left[1] || 0);
}

function unique(values = [], max = 120) {
  return [...new Set(values.map(value => text(value, 120)).filter(Boolean))].slice(0, max);
}

function frameRows(analysis = {}, visualEvidence = []) {
  const fromBatches = list(visualEvidence).flatMap(batch => list(batch?.payload?.frames));
  const source = fromBatches.length ? fromBatches : list(analysis.evidence_frames);
  const normalized = source.map((frame, index) => ({
    ...frame,
    frame_id: text(frame?.frame_id || `F${String(index + 1).padStart(3, '0')}`, 20),
    timestamp_seconds: Number(frame?.timestamp_seconds || 0),
  }));
  if (normalized.length) return normalized;
  // Legacy normalized fixtures may retain only evidence-derived shot rows. Preserve zero-call
  // migration by projecting one trace ref per audited shot instead of requesting the model again.
  return list(analysis.shot_breakdown, 120).map((shot, index) => {
    const shotRange = range(shot?.range);
    return {
      frame_id: `F${String(index + 1).padStart(3, '0')}`,
      timestamp_seconds: Number(((shotRange[0] + shotRange[1]) / 2).toFixed(3)),
      shot_range: shotRange,
      derived_from: 'audited_shot_breakdown',
      visible_text: [],
    };
  });
}

function transcriptRows(transcript = {}) {
  return list(transcript?.segments, 240).map((segment, index) => ({
    id: `T${String(index + 1).padStart(3, '0')}`,
    range: range(segment?.range || [segment?.start, segment?.end]),
    text: text(segment?.text, 1000),
  })).filter(row => row.text);
}

function refsForRange(eventRange, frames, transcripts) {
  const frameRefs = frames.filter(frame => {
    const timestamp = Number(frame.timestamp_seconds || 0);
    return timestamp >= eventRange[0] && timestamp <= eventRange[1];
  }).map(frame => frame.frame_id);
  const transcriptRefs = transcripts.filter(row => overlaps(eventRange, row.range)).map(row => row.id);
  return unique([...frameRefs, ...transcriptRefs], 48);
}

function normalizeRefs(values, validRefs) {
  return unique(list(values), 48).filter(value => validRefs.has(value));
}

function derivedCausalChain(analysis, frames, transcripts) {
  const shots = list(analysis.shot_breakdown, 120);
  const beats = list(analysis.plot_beats, 120);
  const rows = shots.length ? shots : beats;
  return rows.map((row, index) => {
    const eventRange = range(row.range);
    const evidenceRefs = refsForRange(eventRange, frames, transcripts);
    const action = text(row.action || row.purpose || row.evidence_summary || row.visual, 700);
    return {
      id: `event_${index + 1}`,
      range: eventRange,
      scene_id: text(row.scene_id, 100),
      subject: list(row.subject_ids, 16).map(item => text(item, 100)).filter(Boolean).join('、') || '画面主体',
      action: action || '展示当前镜头中可见的状态变化',
      motivation: '',
      // 镜头先后只证明时间顺序，不能自动证明因果。兜底时间线保留可见动作，
      // 但绝不伪造“上一镜头导致下一镜头”的故事关系。
      result: '',
      caused_by: null,
      leads_to: null,
      evidence_refs: evidenceRefs,
      certainty: evidenceRefs.length ? 'fact' : 'unknown',
    };
  });
}

function normalizeCausalChain(proposed, fallback, validRefs) {
  const proposedRows = list(proposed, 120);
  // The audited shot breakdown owns timeline cardinality. A model may enrich an
  // event, but a partial response must not collapse a 16-shot timeline to one
  // event and then be mistaken for a complete contract.
  const rows = fallback.length ? fallback.map((base, index) => {
    const byId = proposedRows.find(row => text(row?.id, 80) === text(base.id, 80));
    const byRange = proposedRows.find(row => {
      const candidateRange = range(row?.range);
      return overlaps(candidateRange, base.range || [0, 0])
        && text(row?.scene_id, 100) === text(base.scene_id, 100);
    });
    return { ...base, ...(byId || byRange || proposedRows[index] || {}) };
  }) : proposedRows;
  return rows.map((row, index) => {
    const base = fallback[index] || {};
    const evidenceRefs = normalizeRefs(row.evidence_refs, validRefs);
    const motivationEvidenceRefs = normalizeRefs(row.motivation_evidence_refs, validRefs);
    const requestedCertainty = ['fact', 'inference', 'unknown'].includes(row.certainty)
      ? row.certainty
      : ((evidenceRefs.length || base.evidence_refs?.length) ? 'fact' : 'unknown');
    const certainty = text(row.motivation) && !motivationEvidenceRefs.length
      ? 'inference'
      : requestedCertainty;
    return {
      id: text(row.id || base.id || `event_${index + 1}`, 80),
      range: range(row.range, base.range || [0, 0]),
      // The audited shot breakdown owns physical-space identity. A synthesis
      // candidate may explain a scene, but it must not remap an event to an
      // invented or different space.
      scene_id: text(base.scene_id || row.scene_id, 100),
      subject: text(row.subject || base.subject || '画面主体', 300),
      action: text(row.action || base.action, 700),
      motivation: text(row.motivation, 500),
      motivation_evidence_refs: motivationEvidenceRefs,
      result: text(row.result || base.result, 700),
      caused_by: row.caused_by === null ? null : text(row.caused_by || base.caused_by, 80) || null,
      leads_to: row.leads_to === null ? null : text(row.leads_to || base.leads_to, 80) || null,
      evidence_refs: evidenceRefs.length ? evidenceRefs : (base.evidence_refs || []),
      certainty,
    };
  });
}

function normalizeStorySummary(proposed = {}, analysis = {}, chain = []) {
  const outline = analysis.story_outline || {};
  const eventText = chain.map(event => event.action).filter(Boolean).join('；');
  const fullSynopsis = text(proposed.full_synopsis || outline.logline || analysis.summary || eventText, 5000);
  return {
    narrative_mode: NARRATIVE_MODES.has(proposed.narrative_mode) ? proposed.narrative_mode : 'unclassified',
    narrative_mode_reason: text(proposed.narrative_mode_reason, 700),
    logline: text(proposed.logline || outline.logline || analysis.summary, 700),
    short_synopsis: text(proposed.short_synopsis || outline.logline || analysis.summary, 1500),
    full_synopsis: fullSynopsis,
    theme: text(proposed.theme, 500),
    central_conflict: text(proposed.central_conflict, 700),
    trigger: text(proposed.trigger || outline.opening || chain[0]?.action, 700),
    turning_point: text(proposed.turning_point || outline.turning_point, 700),
    climax: text(proposed.climax || chain[Math.max(0, chain.length - 2)]?.action, 700),
    resolution: text(proposed.resolution || outline.resolution || chain[chain.length - 1]?.result, 700),
    brand_function: text(proposed.brand_function, 700),
    cta: text(proposed.cta || analysis.subtitle_cta, 500),
  };
}

function normalizeCharacters(proposed, analysis, validRefs) {
  const subjectTracks = list(analysis.subject_tracks, 48).filter(track => track?.kind === 'human');
  const fallback = list(analysis.character_prompts, 24).map((row, index) => {
    const characterId = text(row.id || `character_prompt_${index + 1}`, 80);
    const track = subjectTracks[index] || {};
    return {
      character_id: characterId,
      role: text(row.role || `人物 ${index + 1}`, 200),
      narrative_function: text(row.narrative_function || row.performance_style, 500),
      initial_state: '', goal: '', obstacle: '', key_decision: '', final_state: '',
      relationships: [], emotional_arc: [],
      evidence_refs: normalizeRefs(track.evidence_refs, validRefs),
      certainty: track.evidence_refs?.length ? 'fact' : 'unknown',
    };
  });
  const proposedRows = list(proposed, 24);
  const rows = fallback.length ? fallback.map((base, index) => {
    const match = proposedRows.find(row => text(row?.character_id || row?.id, 80) === base.character_id)
      || proposedRows[index];
    return { ...base, ...(match || {}) };
  }) : proposedRows;
  return rows.map((row, index) => ({
    character_id: text(row.character_id || row.id || fallback[index]?.character_id || `character_prompt_${index + 1}`, 80),
    role: text(row.role || fallback[index]?.role, 200),
    narrative_function: text(row.narrative_function, 500),
    relationships: list(row.relationships, 24).map(item => typeof item === 'string' ? text(item, 300) : {
      character_id: text(item?.character_id, 80), relationship: text(item?.relationship, 300),
    }),
    initial_state: text(row.initial_state, 500), goal: text(row.goal, 500), obstacle: text(row.obstacle, 500),
    key_decision: text(row.key_decision, 500), final_state: text(row.final_state, 500),
    emotional_arc: list(row.emotional_arc, 24).map(item => typeof item === 'string' ? text(item, 400) : item),
    evidence_refs: normalizeRefs(row.evidence_refs, validRefs),
    certainty: ['fact', 'inference', 'unknown'].includes(row.certainty) ? row.certainty : 'unknown',
  }));
}

function normalizeScenes(proposed, analysis, chain, validRefs) {
  const validEventIds = new Set(chain.map(event => event.id));
  const authoritativeScenes = list(analysis.scene_prompts, 120).filter((row, index, all) => {
    const sceneId = text(row?.id || `scene_prompt_${index + 1}`, 100);
    return sceneId && all.findIndex((candidate, candidateIndex) => (
      text(candidate?.id || `scene_prompt_${candidateIndex + 1}`, 100) === sceneId
    )) === index;
  });
  const fallback = authoritativeScenes.map((row, index) => {
    const sceneId = text(row.id || `scene_prompt_${index + 1}`, 100);
    const events = chain.filter(event => event.scene_id === sceneId);
    const eventSummary = unique(events.map(event => text(event.action || event.result, 300)), 6).join('；');
    const proposedFunction = text(row.camera_purpose || row.interaction_prompt, 600);
    const narrativeFunction = proposedFunction && !GENERIC_SCENE_PATTERN.test(proposedFunction)
      ? proposedFunction
      : text(`${row.location_type || '该物理空间'}承载${eventSummary || row.interaction_prompt || '可见主体、动作与状态变化'}`, 700);
    return {
      scene_id: sceneId,
      narrative_function: narrativeFunction,
      entry_transition: '', events: events.map(event => event.id),
      state_change: text(unique(events.map(event => event.result || event.action), 4).join('；'), 700), exit_transition: '',
      evidence_refs: unique(events.flatMap(event => event.evidence_refs), 48), certainty: 'fact',
    };
  });
  const proposedRows = list(proposed, 120);
  const rows = fallback.length ? fallback.map((base) => {
    const matches = proposedRows.filter(row => text(row?.scene_id, 100) === base.scene_id);
    return matches.reduce((merged, row) => ({
      ...merged,
      ...row,
      scene_id: base.scene_id,
      narrative_function: text(row?.narrative_function || merged.narrative_function, 700),
      evidence_refs: unique([
        ...list(merged.evidence_refs, 48),
        ...list(row?.evidence_refs, 48),
      ], 48),
    }), base);
  }) : proposedRows;
  return rows.map((row, index) => {
    const sceneId = text(row.scene_id || fallback[index]?.scene_id || `scene_prompt_${index + 1}`, 100);
    const authoritativeEvents = chain.filter(event => event.scene_id === sceneId);
    const eventIds = authoritativeEvents.length
      ? authoritativeEvents.map(event => event.id)
      : unique(list(row.events, 120).map(item => text(item, 80)).filter(item => validEventIds.has(item)), 120);
    const authoritativeRefs = unique(authoritativeEvents.flatMap(event => event.evidence_refs), 48);
    const normalizedProposedRefs = normalizeRefs(row.evidence_refs, validRefs);
    const combinedRefs = unique([...normalizedProposedRefs, ...authoritativeRefs], 48);
    return {
      scene_id: sceneId,
      narrative_function: text(row.narrative_function || fallback[index]?.narrative_function, 700),
      entry_transition: text(row.entry_transition, 400),
      events: unique(eventIds, 120),
      state_change: text(row.state_change, 700),
      exit_transition: text(row.exit_transition, 400),
      evidence_refs: combinedRefs.length ? combinedRefs : (fallback[index]?.evidence_refs || []),
      certainty: ['fact', 'inference', 'unknown'].includes(row.certainty) ? row.certainty : 'fact',
    };
  });
}

function normalizeEvidenceClaims(values, prefix, validRefs) {
  return list(values, 240).map((row, index) => ({
    id: text(row?.id || `${prefix}_${index + 1}`, 80),
    claim: text(row?.claim || row, 1000),
    evidence_refs: normalizeRefs(row?.evidence_refs, validRefs),
    ...(prefix === 'inference' ? { reason: text(row?.reason, 700) } : {}),
  })).filter(row => row.claim && row.evidence_refs.length);
}

function enrichAnalysis(analysis = {}, options = {}) {
  const frames = frameRows(analysis, options.visualEvidence);
  const transcript = options.transcript || analysis.transcript || {};
  const transcripts = transcriptRows(transcript);
  const validRefs = new Set([...frames.map(row => row.frame_id), ...transcripts.map(row => row.id)]);
  const proposed = analysis.reference_understanding && typeof analysis.reference_understanding === 'object'
    ? analysis.reference_understanding : {};
  const hasProposedUnderstanding = Boolean(
    text(proposed.story_summary?.full_synopsis, 5000)
    && list(proposed.causal_chain).length
    && list(proposed.scenes).length,
  );
  const fallbackChain = derivedCausalChain(analysis, frames, transcripts);
  const causalChain = normalizeCausalChain(proposed.causal_chain, fallbackChain, validRefs);
  const storySummary = normalizeStorySummary(proposed.story_summary, analysis, causalChain);
  const facts = normalizeEvidenceClaims(proposed.facts, 'fact', validRefs);
  if (!facts.length) causalChain.filter(row => row.certainty === 'fact').forEach((row, index) => facts.push({
    id: `fact_${index + 1}`, claim: `${row.subject}${row.action}`, evidence_refs: row.evidence_refs,
  }));
  const inferences = normalizeEvidenceClaims(proposed.inferences, 'inference', validRefs);
  causalChain.filter(row => row.motivation && row.certainty !== 'fact').forEach((row, index) => inferences.push({
    id: `inference_motivation_${index + 1}`, claim: row.motivation, evidence_refs: row.evidence_refs,
    reason: '人物动机无法仅凭可见动作直接确认，保留为推断。',
  }));
  const unknowns = list(proposed.unknowns, 120).map((row, index) => ({
    id: text(row?.id || `unknown_${index + 1}`, 80), question: text(row?.question || row, 700),
    affected_fields: list(row?.affected_fields, 24).map(item => text(item, 100)).filter(Boolean),
  })).filter(row => row.question);
  causalChain.filter(row => !row.evidence_refs.length).forEach((row, index) => unknowns.push({
    id: `unknown_evidence_${index + 1}`, question: `事件 ${row.id} 缺少可追溯证据，需要用户确认。`,
    affected_fields: ['causal_chain'],
  }));
  const ocr = frames.flatMap(frame => list(frame.visible_text, 24).map(value => ({
    text: text(value, 500), range: [frame.timestamp_seconds, frame.timestamp_seconds], evidence_refs: [frame.frame_id],
  }))).filter(row => row.text);
  const proposedOcr = list(proposed.audio_visual?.ocr, 240).map(row => ({
    text: text(row?.text, 500),
    range: range(row?.range),
    evidence_refs: normalizeRefs(row?.evidence_refs, validRefs),
  })).filter(row => row.text && row.evidence_refs.length);
  const alignments = causalChain.map(event => ({
    range: event.range,
    spoken_text: transcripts.filter(row => overlaps(event.range, row.range)).map(row => row.text).join(' '),
    visual: event.action,
    event_id: event.id,
    function: text(list(proposed.audio_visual?.alignments).find(row => row.event_id === event.id)?.function, 500),
    evidence_refs: event.evidence_refs,
  }));
  const tracedEvents = causalChain.filter(row => row.evidence_refs.length).length;
  const characters = normalizeCharacters(proposed.characters, analysis, validRefs);
  const scenes = normalizeScenes(proposed.scenes, analysis, causalChain, validRefs);
  const narrativeMode = storySummary.narrative_mode;
  const causeChainComplete = narrativeMode === 'showcase_montage'
    ? causalChain.length > 0 && tracedEvents === causalChain.length
    : causalChain.length > 0 && causalChain.every((row, index) => (
      index === 0 ? row.caused_by === null : Boolean(row.caused_by)
    ));
  const authoritativeShots = list(analysis.shot_breakdown, 120);
  const timelineEventCoverageComplete = !authoritativeShots.length
    || (causalChain.length === authoritativeShots.length && authoritativeShots.every((shot, index) => {
      const event = causalChain[index];
      return Boolean(event)
        && text(event.scene_id, 100) === text(shot?.scene_id, 100)
        && overlaps(event.range, range(shot?.range));
    }));
  const storyComplete = Boolean(
    NARRATIVE_MODES.has(narrativeMode)
    && storySummary.logline
    && storySummary.full_synopsis
    && storySummary.resolution
    && storySummary.theme
    && storySummary.brand_function
    && (narrativeMode === 'showcase_montage' || (
      storySummary.central_conflict && storySummary.trigger && storySummary.turning_point
    )),
  );
  const characterCoverage = list(analysis.character_prompts).length
    ? Number((characters.filter(row => (
      row.evidence_refs.length
      && row.role
      && !/^出镜人物\s*\d*$/u.test(row.role)
      && (row.narrative_function || (row.initial_state && row.final_state))
    )).length / list(analysis.character_prompts).length).toFixed(3))
    : 1;
  const validSceneIds = new Set(list(analysis.scene_prompts).map((row, index) => (
    text(row?.id || `scene_prompt_${index + 1}`, 100)
  )));
  const sceneEventIds = scenes.flatMap(row => row.events);
  const sceneReferencesValid = scenes.length > 0 && scenes.every(row => validSceneIds.has(row.scene_id));
  const sceneEventsComplete = causalChain.length > 0
    && sceneEventIds.length === causalChain.length
    && new Set(sceneEventIds).size === causalChain.length;
  const sceneCoverage = scenes.length
    ? Number((scenes.filter(row => (
      row.evidence_refs.length
      && row.events.length
      && row.narrative_function
      && !GENERIC_SCENE_PATTERN.test(row.narrative_function)
    )).length / scenes.length).toFixed(3))
    : 0;
  const brandRoleReady = Boolean(
    text(proposed.brand_role?.subject || analysis.source_facts?.product_or_service, 500)
    && text(proposed.brand_role?.story_function || storySummary.brand_function, 700)
    && normalizeRefs(proposed.brand_role?.evidence_refs, validRefs).length,
  );
  const failures = [];
  if (!hasProposedUnderstanding) failures.push('semantic_understanding_missing');
  if (!causalChain.length) failures.push('causal_chain_missing');
  if (!storySummary.full_synopsis) failures.push('full_synopsis_missing');
  if (causalChain.length && tracedEvents !== causalChain.length) failures.push('event_evidence_incomplete');
  if (!timelineEventCoverageComplete) failures.push('timeline_event_coverage_incomplete');
  if (!NARRATIVE_MODES.has(narrativeMode)) failures.push('narrative_mode_unclassified');
  if (FABRICATED_SEQUENCE_PATTERN.test(storySummary.full_synopsis)) failures.push('temporal_adjacency_mislabeled_as_causality');
  if (GENERIC_STORY_PATTERN.test(storySummary.logline)) failures.push('story_summary_generic');
  if (!storyComplete) failures.push('story_semantics_incomplete');
  if (!causeChainComplete) failures.push('cause_or_progression_incomplete');
  if (characterCoverage < 1) failures.push('character_semantics_incomplete');
  if (sceneCoverage < 1) failures.push('scene_semantics_incomplete');
  if (!sceneReferencesValid) failures.push('scene_reference_invalid');
  if (!sceneEventsComplete) failures.push('scene_event_mapping_incomplete');
  if (!brandRoleReady) failures.push('brand_semantics_incomplete');
  const completeness = {
    valid: failures.length === 0,
    timeline_coverage: causalChain.length ? Number((tracedEvents / causalChain.length).toFixed(3)) : 0,
    evidence_traceability: validRefs.size ? Number((tracedEvents / Math.max(1, causalChain.length)).toFixed(3)) : 0,
    cause_chain_complete: causeChainComplete,
    timeline_event_coverage_complete: timelineEventCoverageComplete,
    story_complete: storyComplete,
    character_coverage: characterCoverage,
    scene_coverage: sceneCoverage,
    brand_complete: brandRoleReady,
    semantic_source: hasProposedUnderstanding ? 'model_proposed' : 'timeline_fallback',
    audio_visual_coverage: transcript.status === 'no_audio' ? 1 : (transcripts.length ? 1 : 0),
    failures,
  };
  return {
    ...analysis,
    schema_version: Math.max(6, Number(analysis.schema_version || 0)),
    reference_understanding: {
      contract_version: CONTRACT_VERSION,
      schema_version: 6,
      story_summary: storySummary,
      causal_chain: causalChain,
      characters,
      scenes,
      brand_role: {
        subject: text(proposed.brand_role?.subject || analysis.source_facts?.product_or_service, 500),
        story_function: text(proposed.brand_role?.story_function || storySummary.brand_function, 700),
        visible_claims: list(proposed.brand_role?.visible_claims, 48).map(item => text(item, 500)).filter(Boolean),
        proof_moments: list(proposed.brand_role?.proof_moments, 48).map(item => text(item, 500)).filter(Boolean),
        cta: text(proposed.brand_role?.cta || storySummary.cta, 500),
        evidence_refs: normalizeRefs(proposed.brand_role?.evidence_refs, validRefs),
        certainty: ['fact', 'inference', 'unknown'].includes(proposed.brand_role?.certainty)
          ? proposed.brand_role.certainty : 'unknown',
      },
      audio_visual: {
        transcript_status: text(transcript.status || 'unknown', 60),
        alignments,
        ocr: proposedOcr.length ? proposedOcr : ocr,
      },
      facts,
      inferences,
      unknowns,
      completeness,
    },
  };
}

function validate(analysis = {}) {
  const understanding = analysis.reference_understanding || analysis;
  const failures = [];
  if (understanding.contract_version !== CONTRACT_VERSION) failures.push('contract_version_invalid');
  if (!text(understanding.story_summary?.full_synopsis)) failures.push('full_synopsis_missing');
  if (!list(understanding.causal_chain).length) failures.push('causal_chain_missing');
  if (list(understanding.causal_chain).some(row => !list(row.evidence_refs).length)) failures.push('event_evidence_incomplete');
  if (understanding.completeness?.valid !== true) failures.push(...list(understanding.completeness?.failures));
  if (failures.length) {
    const error = new Error(`参考内容深度理解不完整：${unique(failures).join(', ')}`);
    error.code = 'REFERENCE_UNDERSTANDING_V6_INVALID';
    error.status = 422;
    error.retryable = true;
    error.failures = unique(failures);
    throw error;
  }
  return { valid: true, contract_version: CONTRACT_VERSION };
}

function contextDigest(understanding = null) {
  if (!understanding || typeof understanding !== 'object') return null;
  return {
    contract_version: text(understanding.contract_version, 60),
    schema_version: Number(understanding.schema_version || 0),
    user_edit_revision: Math.max(0, Number(understanding.user_edit_revision || 0) || 0),
    user_edited_at: text(understanding.user_edited_at, 60),
    story_summary: understanding.story_summary || {},
    causal_chain: list(understanding.causal_chain, 48),
    characters: list(understanding.characters, 24),
    scenes: list(understanding.scenes, 48),
    brand_role: understanding.brand_role || {},
    audio_visual: {
      transcript_status: text(understanding.audio_visual?.transcript_status, 60),
      alignments: list(understanding.audio_visual?.alignments, 48),
      ocr: list(understanding.audio_visual?.ocr, 48),
    },
    facts: list(understanding.facts, 96),
    inferences: list(understanding.inferences, 48),
    unknowns: list(understanding.unknowns, 48),
    completeness: understanding.completeness || {},
  };
}

module.exports = { CONTRACT_VERSION, enrichAnalysis, validate, contextDigest, _private: { frameRows, transcriptRows, refsForRange } };
