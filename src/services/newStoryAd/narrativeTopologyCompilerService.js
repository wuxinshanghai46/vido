'use strict';

const crypto = require('crypto');
const { cleanText } = require('./contextBuilder');

const STORY_FACTS_SCHEMA_VERSION = 'story-facts-v1';
const NORMALIZER_VERSION = 'narrative-normalizer-v1';
const TOPOLOGY_COMPILER_VERSION = 'topology-compiler-v1';
const CHANGE_DIMENSIONS = Object.freeze(['era', 'time', 'location', 'environment']);
const VALID_RELATIONS = new Set(['same', 'continuous', 'changed', 'unknown']);

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function list(value) { return Array.isArray(value) ? value : []; }

function normalizeRelationValue(value, fallback = 'unknown') {
  if (value === true) return 'changed';
  if (value === false) return 'same';
  const normalized = cleanText(value, 40).toLowerCase();
  const aliases = {
    same: 'same', unchanged: 'same', stable: 'same', continuity: 'continuous',
    continuous: 'continuous', continue: 'continuous', changed: 'changed', change: 'changed',
    different: 'changed', new: 'changed', unknown: 'unknown', uncertain: 'unknown',
  };
  const result = aliases[normalized] || fallback;
  return VALID_RELATIONS.has(result) ? result : fallback;
}

function legacyTransitionDimensions(transitionType = '') {
  const type = cleanText(transitionType, 60).toLowerCase();
  if (type === 'opening') return { opening: true, dimensions: [] };
  if (type === 'continuity') return { opening: false, dimensions: [] };
  if (type === 'time_change') return { opening: false, dimensions: ['time'] };
  if (type === 'location_change') return { opening: false, dimensions: ['location'] };
  if (type === 'environment_change') return { opening: false, dimensions: ['environment'] };
  if (type === 'composite_change' || type === 'narrative_shift') {
    return { opening: false, dimensions: CHANGE_DIMENSIONS.slice() };
  }
  return { opening: false, dimensions: null };
}

function normalizeProductionRelation(beat = {}, index = 0) {
  if (index === 0) {
    return {
      era: 'changed', time: 'changed', location: 'changed', environment: 'changed',
      change_dimensions: CHANGE_DIMENSIONS.slice(), source: 'opening', uncertain: false,
    };
  }
  const relation = beat.production_relation || beat.productionRelation
    || beat.scene_relation || beat.sceneRelation || {};
  const explicitDimensions = list(beat.change_dimensions || beat.changeDimensions)
    .map(value => cleanText(value, 40).toLowerCase())
    .filter(value => CHANGE_DIMENSIONS.includes(value));
  const legacy = legacyTransitionDimensions(beat.transition_type || beat.transitionType);
  const hasStructuredRelation = relation && typeof relation === 'object'
    && CHANGE_DIMENSIONS.some(key => relation[key] !== undefined);
  let dimensions = explicitDimensions.length ? [...new Set(explicitDimensions)] : legacy.dimensions;
  const normalized = {};
  CHANGE_DIMENSIONS.forEach((dimension) => {
    const directFlag = beat[`${dimension}_changed`] ?? beat[`${dimension}Changed`];
    const fallback = dimensions === null
      ? 'unknown'
      : (dimensions.includes(dimension) ? 'changed' : 'same');
    normalized[dimension] = normalizeRelationValue(
      hasStructuredRelation ? relation[dimension] : directFlag,
      fallback,
    );
  });
  if (hasStructuredRelation) {
    dimensions = CHANGE_DIMENSIONS.filter(dimension => normalized[dimension] === 'changed');
  }
  const uncertain = CHANGE_DIMENSIONS.some(dimension => normalized[dimension] === 'unknown');
  const normalizedSource = cleanText(relation?.source || '', 60);
  return {
    ...normalized,
    change_dimensions: dimensions || [],
    source: hasStructuredRelation ? (normalizedSource || 'structured_relation')
      : (explicitDimensions.length ? 'change_dimensions' : (legacy.dimensions !== null ? 'legacy_transition' : 'missing')),
    uncertain,
  };
}

function normalizeStoryFacts(storySeed = {}) {
  const raw = list(storySeed.plot_beats || storySeed.plotBeats).slice(0, 32);
  const beats = raw.map((beat, index) => {
    let relation = normalizeProductionRelation(beat, index);
    const hasStructuredRelation = beat?.production_relation && typeof beat.production_relation === 'object'
      && CHANGE_DIMENSIONS.some(key => beat.production_relation[key] !== undefined);
    const legacyKey = cleanText(
      beat?.legacy_production_scene_key || beat?.legacyProductionSceneKey
        || beat?.production_scene_key || beat?.productionSceneKey || '',
      100,
    );
    const previousBeat = raw[index - 1] || {};
    const previousLegacyKey = cleanText(
      previousBeat.legacy_production_scene_key || previousBeat.legacyProductionSceneKey
        || previousBeat.production_scene_key || previousBeat.productionSceneKey || '',
      100,
    );
    // v4 migration compatibility only: an adjacent repeated legacy key records
    // that the old validated plan intended one continuous production setup.
    // v5 facts always carry structured production_relation and ignore this hint.
    if (index > 0 && !hasStructuredRelation && legacyKey && legacyKey === previousLegacyKey) {
      relation = {
        era: 'same', time: 'continuous', location: 'same', environment: 'same',
        change_dimensions: [], source: 'legacy_adjacent_scene_key', uncertain: false,
      };
    }
    return {
      id: cleanText(beat?.id || beat?.beat_id || beat?.beatId || `beat_${String(index + 1).padStart(3, '0')}`, 100),
      phase: cleanText(beat?.phase || beat?.story_phase || beat?.storyPhase || '', 60),
      era: cleanText(beat?.era || beat?.time_period || beat?.timePeriod || '', 120),
      time_anchor: cleanText(beat?.time_anchor || beat?.timeAnchor || '', 160),
      location: cleanText(beat?.location || beat?.place || beat?.space_name || beat?.spaceName || '', 160),
      production_state: cleanText(beat?.production_state || beat?.productionState || beat?.environment_state || beat?.environmentState || '', 320),
      summary: cleanText(beat?.summary || beat?.purpose || beat?.content || beat?.description || '', 600),
      cause: cleanText(beat?.cause || beat?.motivation || '', 500),
      consequence: cleanText(beat?.consequence || beat?.result || '', 500),
      scene_change_reason: cleanText(beat?.scene_change_reason || beat?.sceneChangeReason || '', 300),
      production_requirements: {
        layout: cleanText(beat?.production_requirements?.layout || beat?.productionRequirements?.layout || '', 500),
        material_light: cleanText(beat?.production_requirements?.material_light || beat?.productionRequirements?.materialLight || '', 500),
        interaction: cleanText(beat?.production_requirements?.interaction || beat?.productionRequirements?.interaction || '', 500),
        negative: cleanText(beat?.production_requirements?.negative || beat?.productionRequirements?.negative || '', 500),
      },
      production_relation: relation,
      legacy_production_scene_key: legacyKey,
    };
  });
  return {
    ...storySeed,
    story_facts_schema_version: STORY_FACTS_SCHEMA_VERSION,
    plot_beats: beats,
  };
}

function relationTransitionType(relation = {}, index = 0) {
  if (index === 0) return 'opening';
  const changed = CHANGE_DIMENSIONS.filter(dimension => relation[dimension] === 'changed');
  if (!changed.length) return 'continuity';
  if (changed.length > 1) return 'composite_change';
  if (changed[0] === 'location') return 'location_change';
  if (changed[0] === 'environment') return 'environment_change';
  return 'time_change';
}

function compileStorySeed(storySeed = {}) {
  const normalized = normalizeStoryFacts(storySeed);
  let segment = -1;
  const beats = normalized.plot_beats.map((beat, index) => {
    const relation = beat.production_relation;
    const changed = index === 0 || CHANGE_DIMENSIONS.some(dimension => relation[dimension] === 'changed');
    if (changed) segment += 1;
    const productionSceneKey = `production_scene_${String(segment + 1).padStart(3, '0')}`;
    const transitionType = relationTransitionType(relation, index);
    return {
      ...beat,
      production_scene_key: productionSceneKey,
      transition_type: transitionType,
      scene_change_reason: index === 0
        ? (beat.scene_change_reason || '故事开始')
        : (beat.scene_change_reason || (transitionType === 'continuity'
          ? '制作条件连续，沿用当前场次'
          : `制作条件变化：${relation.change_dimensions.join('、')}`)),
    };
  });
  const topology = beats.map((beat, index) => ({
    beat_id: beat.id,
    sequence: index + 1,
    production_scene_key: beat.production_scene_key,
    transition_type: beat.transition_type,
    change_dimensions: beat.production_relation.change_dimensions,
  }));
  return {
    ...normalized,
    plot_beats: beats,
    normalizer_version: NORMALIZER_VERSION,
    topology_compiler_version: TOPOLOGY_COMPILER_VERSION,
    topology_hash: hash(topology),
  };
}

function sceneCardForGroup(group = [], index = 0) {
  const first = group[0] || {};
  const last = group[group.length - 1] || first;
  const key = first.production_scene_key || `production_scene_${String(index + 1).padStart(3, '0')}`;
  const layout = group.map(beat => beat.production_requirements?.layout).filter(Boolean).join('；');
  const materialLight = group.map(beat => beat.production_requirements?.material_light).filter(Boolean).join('；');
  const interaction = group.map(beat => beat.production_requirements?.interaction).filter(Boolean).join('；');
  const negative = group.map(beat => beat.production_requirements?.negative).filter(Boolean).join('；');
  return {
    id: `scene_${String(index + 1).padStart(3, '0')}`,
    production_scene_key: key,
    narrative_visit_id: `visit_${String(index + 1).padStart(3, '0')}`,
    covered_beat_ids: group.map(beat => beat.id),
    name: cleanText([first.location, first.time_anchor].filter(Boolean).join(' · ') || `剧情场次${index + 1}`, 160),
    description: cleanText([first.era, first.location, first.production_state].filter(Boolean).join('；'), 800),
    story_purpose: cleanText(group.map(beat => beat.summary).filter(Boolean).join('；'), 1000),
    scene_spec: {
      layoutText: cleanText(layout || `${first.location || '当前地点'}的固定结构、出入口和可行动区域以剧情事实为准`, 800),
      materialLightText: cleanText(materialLight || [first.era, first.time_anchor, first.production_state].filter(Boolean).join('；'), 800),
      interactionText: cleanText(interaction || group.map(beat => beat.summary).filter(Boolean).join('；'), 800),
      negativeText: cleanText(negative || '禁止加入用户输入与剧情事实中不存在的地点、布景、人物或广告元素', 800),
      storyStates: group.map(beat => ({ beat_id: beat.id, summary: beat.summary })),
      interactionAnchors: [], routes: [], propPlacements: [],
    },
    first_beat_id: first.id,
    last_beat_id: last.id,
  };
}

function compileScenePlan(storySeed = {}, priorScenePlan = {}) {
  const compiledSeed = compileStorySeed(storySeed);
  const groups = [];
  compiledSeed.plot_beats.forEach((beat) => {
    const current = groups[groups.length - 1];
    if (!current || current[0].production_scene_key !== beat.production_scene_key) groups.push([beat]);
    else current.push(beat);
  });
  const spaces = groups.map(sceneCardForGroup);
  return {
    ...(priorScenePlan && typeof priorScenePlan === 'object' ? priorScenePlan : {}),
    business_boundary: '纯剧情，不含广告',
    advertised_subject: '',
    scene_mode: spaces.length > 1 ? 'multi' : 'single',
    spaces,
    story_facts_schema_version: STORY_FACTS_SCHEMA_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    topology_compiler_version: TOPOLOGY_COMPILER_VERSION,
    topology_hash: compiledSeed.topology_hash,
  };
}

function compileAssetPlan(plan = {}) {
  const storySeed = compileStorySeed(plan.story_seed || plan.storySeed || {});
  return {
    ...plan,
    story_seed: storySeed,
    scene_plan: compileScenePlan(storySeed, plan.scene_plan || plan.scenePlan || {}),
  };
}

function issueList(value) {
  return list(value).length
    ? list(value).map(item => cleanText(item, 500)).filter(Boolean)
    : String(value || '').split(',').map(item => cleanText(item, 500)).filter(Boolean);
}

function buildStorySeedRepairScope(baseSeed = {}, rawIssues = [], minimumBeats = 0) {
  const beats = list(baseSeed.plot_beats || baseSeed.plotBeats);
  const issues = issueList(rawIssues);
  const targetIndices = new Set();
  const allowedScalarFields = new Set();
  let appendCount = 0;
  issues.forEach((issue) => {
    const beatMatch = issue.match(/story_seed\.plot_beats\[(\d+)\]/);
    if (beatMatch) targetIndices.add(Number(beatMatch[1]));
    const shallowMatch = issue.match(/story_seed\.plot_beats_too_shallow:(\d+)\/(\d+)/);
    if (shallowMatch) appendCount = Math.max(appendCount, Number(shallowMatch[2]) - Number(shallowMatch[1]));
    if (issue === 'story_seed.plot_beats_missing') appendCount = Math.max(appendCount, Math.max(1, Number(minimumBeats) || 0));
    const scalarMatch = issue.match(/^story_seed\.([a-z][a-z0-9_]*)_missing$/i);
    if (scalarMatch && scalarMatch[1] !== 'plot_beats') allowedScalarFields.add(scalarMatch[1]);
  });
  const targetBeats = [...targetIndices].sort((a, b) => a - b)
    .map(index => ({ index, beat: beats[index] }))
    .filter(item => item.beat && typeof item.beat === 'object');
  const targetBeatIds = targetBeats
    .map(item => cleanText(item.beat?.id || item.beat?.beat_id || item.beat?.beatId || '', 100))
    .filter(Boolean);
  const contextIndices = new Set();
  targetBeats.forEach(({ index }) => {
    if (index > 0) contextIndices.add(index - 1);
    contextIndices.add(index);
    if (index + 1 < beats.length) contextIndices.add(index + 1);
  });
  if (appendCount > 0) {
    for (let index = Math.max(0, beats.length - 3); index < beats.length; index += 1) contextIndices.add(index);
  }
  return {
    issues,
    target_indices: targetBeats.map(item => item.index),
    target_beat_ids: targetBeatIds,
    target_beats: targetBeats,
    neighbor_context: [...contextIndices].sort((a, b) => a - b).map(index => ({ index, beat: beats[index] })),
    allowed_scalar_fields: [...allowedScalarFields],
    append_count: Math.max(0, appendCount),
    existing_beat_ids: beats.map(beat => cleanText(beat?.id || beat?.beat_id || beat?.beatId || '', 100)).filter(Boolean),
  };
}

function storySeedPatchOutputTemplate() {
  return {
    story_seed_patch: {
      fields: {},
      plot_beats_upsert: [{
        id: '必须沿用目标ID或使用不重复的新ID',
        phase: '剧情阶段',
        era: '时代',
        time_anchor: '时间关系锚点',
        location: '制作地点',
        production_state: '可见制作环境状态',
        summary: '可见剧情动作',
        cause: '本节拍发生原因',
        consequence: '本节拍造成后果',
        production_relation: { era: 'same|changed', time: 'same|continuous|changed', location: 'same|changed', environment: 'same|changed' },
      }],
    },
  };
}

function validateStorySeedPatch(baseSeed = {}, rawPatch = {}, repairScope = {}) {
  const rootKeys = rawPatch && typeof rawPatch === 'object' ? Object.keys(rawPatch) : [];
  if (rootKeys.length !== 1 || rootKeys[0] !== 'story_seed_patch') {
    throw Object.assign(new Error('story_seed_patch_root_must_be_exact'), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  const patch = rawPatch.story_seed_patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw Object.assign(new Error('story_seed_patch_object_required'), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  const patchKeys = Object.keys(patch);
  const unexpectedPatchKeys = patchKeys.filter(key => !['fields', 'plot_beats_upsert'].includes(key));
  if (unexpectedPatchKeys.length) {
    throw Object.assign(new Error(`story_seed_patch_keys_out_of_scope:${unexpectedPatchKeys.join('|')}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  const fields = patch.fields && typeof patch.fields === 'object' && !Array.isArray(patch.fields) ? patch.fields : {};
  const allowedScalarFields = new Set(list(repairScope.allowed_scalar_fields));
  const outOfScopeFields = Object.keys(fields).filter(key => !allowedScalarFields.has(key));
  if (outOfScopeFields.length) {
    throw Object.assign(new Error(`story_seed_patch_fields_out_of_scope:${outOfScopeFields.join('|')}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  const upserts = list(patch.plot_beats_upsert);
  const baseBeats = list(baseSeed.plot_beats || baseSeed.plotBeats);
  const existingIds = new Set(baseBeats.map(beat => cleanText(beat?.id || beat?.beat_id || beat?.beatId || '', 100)).filter(Boolean));
  const targetIds = new Set(list(repairScope.target_beat_ids).map(id => cleanText(id, 100)).filter(Boolean));
  const appendLimit = Math.max(0, Number(repairScope.append_count) || 0);
  if (upserts.length > targetIds.size + appendLimit) {
    throw Object.assign(new Error(`story_seed_patch_too_many_beats:${upserts.length}/${targetIds.size + appendLimit}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  const touchedTargets = new Set();
  let appended = 0;
  const forbiddenBeatKeys = new Set(['production_scene_key', 'productionSceneKey', 'scene_id', 'sceneId', 'transition_type', 'transitionType', 'covered_beat_ids', 'coveredBeatIds']);
  upserts.forEach((beat, index) => {
    if (!beat || typeof beat !== 'object' || Array.isArray(beat)) {
      throw Object.assign(new Error(`story_seed_patch_beat_invalid:${index}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
    }
    const forbidden = Object.keys(beat).filter(key => forbiddenBeatKeys.has(key));
    if (forbidden.length) {
      throw Object.assign(new Error(`story_seed_patch_compiler_fields_forbidden:${forbidden.join('|')}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
    }
    const id = cleanText(beat.id || beat.beat_id || beat.beatId || '', 100);
    if (!id) throw Object.assign(new Error(`story_seed_patch_beat_id_required:${index}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
    if (existingIds.has(id)) {
      if (!targetIds.has(id)) throw Object.assign(new Error(`story_seed_patch_existing_beat_out_of_scope:${id}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
      touchedTargets.add(id);
    } else {
      appended += 1;
      if (appended > appendLimit) throw Object.assign(new Error(`story_seed_patch_append_out_of_scope:${id}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
      existingIds.add(id);
    }
  });
  const missingTargets = [...targetIds].filter(id => !touchedTargets.has(id));
  if (missingTargets.length) {
    throw Object.assign(new Error(`story_seed_patch_target_missing:${missingTargets.join('|')}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  if (appendLimit && appended !== appendLimit) {
    throw Object.assign(new Error(`story_seed_patch_append_count_invalid:${appended}/${appendLimit}`), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  if (!upserts.length && !Object.keys(fields).length) {
    throw Object.assign(new Error('story_seed_patch_empty'), { code: 'STORY_FACTS_PATCH_SCOPE_INVALID' });
  }
  return true;
}

function mergeStorySeedPatch(baseSeed = {}, rawPatch = {}, options = {}) {
  if (options.repair_scope || options.repairScope) {
    validateStorySeedPatch(baseSeed, rawPatch, options.repair_scope || options.repairScope);
  }
  const patch = rawPatch.story_seed_patch || rawPatch.storySeedPatch || rawPatch.story_seed || rawPatch.storySeed || rawPatch || {};
  const baseBeats = list(baseSeed.plot_beats || baseSeed.plotBeats).map(beat => ({ ...beat }));
  const upserts = list(patch.plot_beats_upsert || patch.plotBeatsUpsert || patch.plot_beats_append || patch.plotBeatsAppend || patch.plot_beats || patch.plotBeats);
  const positions = new Map(baseBeats.map((beat, index) => [cleanText(beat?.id || beat?.beat_id || beat?.beatId || '', 100), index]).filter(([id]) => id));
  upserts.forEach((beat) => {
    const id = cleanText(beat?.id || beat?.beat_id || beat?.beatId || '', 100);
    if (id && positions.has(id)) baseBeats[positions.get(id)] = { ...baseBeats[positions.get(id)], ...beat };
    else {
      baseBeats.push({ ...beat });
      if (id) positions.set(id, baseBeats.length - 1);
    }
  });
  const fields = patch.fields && typeof patch.fields === 'object' ? patch.fields : patch;
  const { plot_beats, plotBeats, plot_beats_upsert, plotBeatsUpsert, plot_beats_append, plotBeatsAppend, ...scalarFields } = fields;
  return { ...baseSeed, ...scalarFields, plot_beats: baseBeats };
}

function storyFactIssues(storySeed = {}) {
  const normalized = normalizeStoryFacts(storySeed);
  const issues = [];
  if (!normalized.plot_beats.length) return ['story_seed.plot_beats_missing'];
  const ids = new Set();
  const legacyKeyLastIndex = new Map();
  normalized.plot_beats.forEach((beat, index) => {
    const prefix = `story_seed.plot_beats[${index}]`;
    if (!beat.id) issues.push(`${prefix}.id_missing`);
    else if (ids.has(beat.id)) issues.push(`${prefix}.id_duplicate:${beat.id}`);
    else ids.add(beat.id);
    ['phase', 'era', 'time_anchor', 'location', 'production_state', 'summary', 'cause', 'consequence']
      .forEach(field => { if (!beat[field]) issues.push(`${prefix}.${field}_missing`); });
    if (index > 0 && beat.production_relation.uncertain) issues.push(`${prefix}.production_relation_uncertain`);
    if (beat.legacy_production_scene_key) {
      const previousIndex = legacyKeyLastIndex.get(beat.legacy_production_scene_key);
      if (Number.isInteger(previousIndex) && previousIndex !== index - 1) {
        issues.push(`story_seed.production_scene_key_non_contiguous_reuse:${beat.legacy_production_scene_key}`);
      }
      legacyKeyLastIndex.set(beat.legacy_production_scene_key, index);
    }
  });
  return issues;
}

module.exports = {
  STORY_FACTS_SCHEMA_VERSION,
  NORMALIZER_VERSION,
  TOPOLOGY_COMPILER_VERSION,
  CHANGE_DIMENSIONS,
  normalizeProductionRelation,
  normalizeStoryFacts,
  compileStorySeed,
  compileScenePlan,
  compileAssetPlan,
  buildStorySeedRepairScope,
  storySeedPatchOutputTemplate,
  validateStorySeedPatch,
  mergeStorySeedPatch,
  storyFactIssues,
};
