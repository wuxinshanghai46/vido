const crypto = require('crypto');

const STORY_AD_VERSION = '2.0';
const GRAPH_SCHEMA_VERSION = 'story-ad-temporal-evidence-graph-v2';

function clean(value = '', max = 320) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function list(value, maxItems = 24, maxText = 220) {
  const source = Array.isArray(value)
    ? value
    : (value === undefined || value === null || value === '' ? [] : [value]);
  return source
    .map(item => clean(item, maxText))
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index)
    .slice(0, maxItems);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stableId(prefix, ...parts) {
  const source = parts.map(value => clean(value, 500)).filter(Boolean).join('|') || prefix;
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 12);
  return `${prefix}_${digest}`;
}

function normalizeAttributes(value) {
  const source = object(value);
  return Object.keys(source).sort().slice(0, 40).reduce((result, key) => {
    const normalizedKey = clean(key, 80);
    const raw = source[key];
    if (!normalizedKey || raw === undefined || raw === null || raw === '') return result;
    result[normalizedKey] = Array.isArray(raw)
      ? list(raw, 20, 180)
      : (typeof raw === 'object' ? normalizeAttributes(raw) : clean(raw, 260));
    return result;
  }, {});
}

/**
 * V2.0 的角色、标签和属性均为开放字符串。这里不维护行业枚举，
 * 因此新增金融、地产、教育或尚未出现的行业时都不需要增加代码分支。
 */
function normalizeEntity(raw = {}, index = 0) {
  const source = object(raw);
  const name = clean(source.name || source.label || source.title || source.id || `实体${index + 1}`, 120);
  return {
    id: clean(source.id, 100) || stableId('entity', name, source.role || source.type || source.kind),
    name,
    role: clean(source.role || source.type || source.kind || 'subject', 100),
    tags: list(source.tags || source.labels, 24, 100),
    attributes: normalizeAttributes(source.attributes || source.state || source.properties),
    invariants: list(source.invariants || source.must_remain || source.locks, 24, 260),
    source_refs: list(source.source_refs || source.references || source.asset_ids, 24, 160),
  };
}

function normalizeRelation(raw = {}, index = 0) {
  const source = object(raw);
  const from = clean(source.from || source.from_id || source.source, 100);
  const to = clean(source.to || source.to_id || source.target, 100);
  const name = clean(source.name || source.relation || source.type || '关联', 120);
  return {
    id: clean(source.id, 100) || stableId('relation', from, name, to, index),
    from,
    to,
    name,
    attributes: normalizeAttributes(source.attributes || source.state),
    invariants: list(source.invariants || source.must_remain, 24, 260),
  };
}

function normalizeEvent(raw = {}, index = 0) {
  const source = object(raw);
  const name = clean(source.name || source.title || source.action || source.goal || `事件${index + 1}`, 160);
  return {
    id: clean(source.id, 100) || stableId('event', name, index),
    name,
    goal: clean(source.goal || source.purpose || source.objective, 260),
    actor_refs: list(source.actor_refs || source.actors, 24, 100),
    subject_refs: list(source.subject_refs || source.subjects || source.entity_refs, 24, 100),
    preconditions: list(source.preconditions || source.state_before, 24, 260),
    effects: list(source.effects || source.state_after, 24, 260),
    visual_evidence: list(source.visual_evidence || source.evidence_requirements || source.must_show, 24, 260),
    change_reason: clean(source.change_reason || source.reason, 260),
    time_window: clean(source.time_window || source.timing, 120),
  };
}

function shotText(shot = {}, ...keys) {
  for (const key of keys) {
    const value = shot?.[key];
    if (typeof value === 'string' && clean(value)) return clean(value, 320);
  }
  return '';
}

function normalizeShotState(raw = {}, shot = {}, index = 0) {
  // 已附着到分镜上的 temporal_evidence 是图切片；再次编译时要解包 shot_state，避免状态被外层包装吞掉。
  const outer = object(raw);
  const source = Object.keys(object(outer.shot_state)).length ? object(outer.shot_state) : outer;
  const shotIndex = Math.max(1, Number(source.shot_index || shot.index || shot.shot_index || index + 1) || index + 1);
  const before = list(source.state_before || source.entry_state || shot.entry_frame_state, 24, 280);
  const after = list(source.state_after || source.exit_state || shot.exit_frame_state || shot.action_end, 24, 280);
  const evidence = list(
    source.evidence_requirements
      || source.visual_evidence
      || [shot.visual, shot.action, shot.keyframe_notes].filter(Boolean),
    24,
    320,
  );
  return {
    shot_index: shotIndex,
    entity_refs: list(source.entity_refs, 32, 100),
    relation_refs: list(source.relation_refs, 32, 100),
    event_refs: list(source.event_refs, 24, 100),
    state_before: before,
    state_after: after,
    intended_changes: list(source.intended_changes || source.changes || shot.intended_changes, 24, 280),
    invariants: list(source.invariants || source.must_remain || shot.invariants, 32, 280),
    evidence_requirements: evidence,
    continuity_links: list(source.continuity_links || source.links, 24, 120),
  };
}

function contextEntities(ctx = {}, blueprint = {}) {
  const rows = [];
  const advertisedSubject = clean(
    ctx.product_subject
      || ctx.advertised_subject
      || blueprint.advertised_subject
      || blueprint.subject,
    160,
  );
  if (advertisedSubject) {
    rows.push({
      name: advertisedSubject,
      role: 'advertised_subject',
      tags: list(ctx.subject_tags || blueprint.subject_tags, 16, 100),
      invariants: list(ctx.subject_invariants || blueprint.subject_invariants, 24, 260),
      source_refs: list([
        ctx.product_asset?.asset_id,
        ctx.product_asset?.id,
        ctx.product_contract?.reference_fingerprint,
      ], 12, 160),
    });
  }
  const characters = Array.isArray(blueprint.characters) && blueprint.characters.length
    ? blueprint.characters
    : (Array.isArray(ctx.characters) ? ctx.characters : []);
  characters.forEach(character => rows.push({
    name: character?.name,
    role: character?.role || 'character',
    tags: character?.tags,
    attributes: character?.attributes || {
      appearance: character?.appearance,
      clothing: character?.clothing,
    },
    invariants: character?.invariants || [character?.appearance, character?.clothing].filter(Boolean),
    source_refs: character?.source_refs,
  }));
  return rows.filter(row => clean(row.name));
}

function shotEntities(shots = []) {
  return (Array.isArray(shots) ? shots : []).flatMap(shot => (
    Array.isArray(shot?.characters) ? shot.characters : []
  ).map(character => ({
    name: character?.name || character,
    role: character?.role || 'character',
    attributes: character?.attributes,
    invariants: character?.invariants,
    source_refs: character?.source_refs,
  }))).filter(row => clean(row.name));
}

function mergeById(primary = [], secondary = []) {
  const result = [];
  const seen = new Set();
  [...primary, ...secondary].forEach(item => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    result.push(item);
  });
  return result;
}

function resolveRef(value = '', rows = []) {
  const ref = clean(value, 120);
  if (!ref) return '';
  const matched = rows.find(item => item.id === ref || item.name === ref);
  return matched?.id || ref;
}

function entityIdsForShot(shot = {}, entities = []) {
  const names = new Set();
  (Array.isArray(shot.characters) ? shot.characters : []).forEach(character => {
    const name = clean(character?.name || character, 120);
    if (name) names.add(name);
  });
  const visualText = [
    shot.visual,
    shot.action,
    shot.story_visual,
    shot.promo_visual,
    shot.material_usage,
  ].map(value => clean(value, 500)).join(' ');
  return entities
    .filter(entity => entity.role === 'advertised_subject' || names.has(entity.name) || (entity.name && visualText.includes(entity.name)))
    .map(entity => entity.id);
}

/**
 * 把旧版分镜的入镜/出镜字段无损投影到 V2.0 图协议。
 * 旧任务不需要重新生成即可继续使用，新任务则可以直接携带开放式图数据。
 */
function buildGraph({ ctx = {}, blueprint = {}, shots = [], existingGraph = null } = {}) {
  const authored = object(existingGraph || blueprint.temporal_evidence_graph || ctx.temporal_evidence_graph);
  const authoredEntities = (Array.isArray(authored.entities) ? authored.entities : []).map(normalizeEntity);
  const derivedEntities = [...contextEntities(ctx, blueprint), ...shotEntities(shots)].map(normalizeEntity);
  const entities = mergeById(authoredEntities, derivedEntities);

  const relations = (Array.isArray(authored.relations) ? authored.relations : []).map(normalizeRelation).map(relation => ({
    ...relation,
    from: resolveRef(relation.from, entities),
    to: resolveRef(relation.to, entities),
  }));
  const authoredEvents = (Array.isArray(authored.events) ? authored.events : []).map(normalizeEvent);
  const authoredShotStates = new Map(
    (Array.isArray(authored.shot_states) ? authored.shot_states : [])
      .map((state, index) => normalizeShotState(state, {}, index))
      .map(state => [state.shot_index, state]),
  );

  const derivedEvents = [];
  const shotStates = (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const shotIndex = Math.max(1, Number(shot.index || shot.shot_index || index + 1) || index + 1);
    const embedded = object(shot.temporal_state || shot.temporal_evidence || shot.evidence_state);
    const existing = authoredShotStates.get(shotIndex) || {};
    const eventSource = object(shot.event || embedded.event);
    const eventName = clean(
      eventSource.name
        || shotText(shot, 'action', 'purpose', 'title')
        || `镜头${shotIndex}事件`,
      160,
    );
    const event = normalizeEvent({
      ...eventSource,
      id: clean(eventSource.id, 100) || stableId('event', shotIndex, eventName),
      name: eventName,
      goal: eventSource.goal || shot.purpose || shot.role,
      actor_refs: eventSource.actor_refs || entityIdsForShot(shot, entities),
      subject_refs: eventSource.subject_refs || entityIdsForShot(shot, entities),
      preconditions: eventSource.preconditions || embedded.state_before || shot.entry_frame_state,
      effects: eventSource.effects || embedded.state_after || shot.exit_frame_state || shot.action_end,
      visual_evidence: eventSource.visual_evidence || embedded.evidence_requirements || [shot.visual, shot.action, shot.keyframe_notes],
      change_reason: eventSource.change_reason || shot.transition_reason,
      time_window: eventSource.time_window || `${Number(shot.duration || 0) || 0}s`,
    }, index);
    derivedEvents.push(event);

    const state = normalizeShotState({
      ...existing,
      ...embedded,
      shot_index: shotIndex,
      entity_refs: embedded.entity_refs || existing.entity_refs || entityIdsForShot(shot, entities),
      relation_refs: embedded.relation_refs || existing.relation_refs,
      event_refs: embedded.event_refs || existing.event_refs || [event.id],
      state_before: embedded.state_before || existing.state_before || shot.entry_frame_state || shot.action_start,
      state_after: embedded.state_after || existing.state_after || shot.exit_frame_state || shot.action_end || shot.action,
      intended_changes: embedded.intended_changes || existing.intended_changes || shot.intended_changes,
      invariants: embedded.invariants || existing.invariants || shot.invariants,
      evidence_requirements: embedded.evidence_requirements || existing.evidence_requirements || [shot.visual, shot.action, shot.keyframe_notes],
      continuity_links: embedded.continuity_links || existing.continuity_links,
    }, shot, index);
    state.entity_refs = state.entity_refs.map(ref => resolveRef(ref, entities));
    state.relation_refs = state.relation_refs.map(ref => resolveRef(ref, relations));
    state.event_refs = state.event_refs.map(ref => resolveRef(ref, [event, ...authoredEvents]));
    if (shotIndex > 1 && shot.requires_previous_frame === true && !state.continuity_links.length) {
      state.continuity_links = [`shot_${shotIndex - 1}->shot_${shotIndex}`];
    }
    return state;
  });

  const events = mergeById(authoredEvents, derivedEvents);
  return {
    version: STORY_AD_VERSION,
    schema_version: GRAPH_SCHEMA_VERSION,
    entities,
    relations,
    events,
    shot_states: shotStates,
    metadata: {
      open_vocabulary: true,
      industry_templates: false,
      shot_count: shotStates.length,
      generated_at: new Date().toISOString(),
    },
  };
}

function graphForShot(graph = {}, shotIndex = 0) {
  const normalizedIndex = Math.max(1, Number(shotIndex) || 1);
  const state = (Array.isArray(graph.shot_states) ? graph.shot_states : [])
    .find(item => Number(item?.shot_index) === normalizedIndex) || null;
  if (!state) return null;
  const entityIds = new Set(state.entity_refs || []);
  const relationIds = new Set(state.relation_refs || []);
  const eventIds = new Set(state.event_refs || []);
  return {
    schema_version: graph.schema_version || GRAPH_SCHEMA_VERSION,
    shot_state: state,
    entities: (graph.entities || []).filter(item => entityIds.has(item.id)),
    relations: (graph.relations || []).filter(item => relationIds.has(item.id)),
    events: (graph.events || []).filter(item => eventIds.has(item.id)),
  };
}

function attachGraphToShots(shots = [], graph = {}) {
  return (Array.isArray(shots) ? shots : []).map((shot, index) => ({
    ...shot,
    temporal_evidence: graphForShot(graph, shot.index || shot.shot_index || index + 1),
  }));
}

function validateGraph(graph = {}) {
  const errors = [];
  if (graph.schema_version !== GRAPH_SCHEMA_VERSION) errors.push('GRAPH_SCHEMA_VERSION_INVALID');
  const entityIds = new Set((graph.entities || []).map(item => item?.id).filter(Boolean));
  const relationIds = new Set((graph.relations || []).map(item => item?.id).filter(Boolean));
  const eventIds = new Set((graph.events || []).map(item => item?.id).filter(Boolean));
  (graph.relations || []).forEach(relation => {
    if (relation.from && !entityIds.has(relation.from)) errors.push(`RELATION_FROM_MISSING:${relation.id}`);
    if (relation.to && !entityIds.has(relation.to)) errors.push(`RELATION_TO_MISSING:${relation.id}`);
  });
  (graph.shot_states || []).forEach(state => {
    (state.entity_refs || []).forEach(id => {
      if (!entityIds.has(id)) errors.push(`SHOT_ENTITY_MISSING:${state.shot_index}:${id}`);
    });
    (state.relation_refs || []).forEach(id => {
      if (!relationIds.has(id)) errors.push(`SHOT_RELATION_MISSING:${state.shot_index}:${id}`);
    });
    (state.event_refs || []).forEach(id => {
      if (!eventIds.has(id)) errors.push(`SHOT_EVENT_MISSING:${state.shot_index}:${id}`);
    });
    if (!(state.evidence_requirements || []).length) errors.push(`SHOT_EVIDENCE_MISSING:${state.shot_index}`);
  });
  return { pass: errors.length === 0, errors };
}

function promptForShot(graph = {}, shotIndex = 0) {
  const slice = graphForShot(graph, shotIndex);
  if (!slice) return '';
  return [
    '剧情广告 V2.0 时序证据合同：',
    `镜头状态：${JSON.stringify(slice.shot_state)}`,
    `相关实体：${JSON.stringify(slice.entities)}`,
    `相关关系：${JSON.stringify(slice.relations)}`,
    `相关事件：${JSON.stringify(slice.events)}`,
    '只允许 intended_changes 发生变化；invariants 必须保持；画面必须提供 evidence_requirements 指定的可见证据。',
  ].join('\n');
}

module.exports = {
  STORY_AD_VERSION,
  GRAPH_SCHEMA_VERSION,
  normalizeEntity,
  normalizeRelation,
  normalizeEvent,
  normalizeShotState,
  buildGraph,
  graphForShot,
  attachGraphToShots,
  validateGraph,
  promptForShot,
};
