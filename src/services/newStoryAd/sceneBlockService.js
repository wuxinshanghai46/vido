const revisionService = require('./revisionService');
const videoCore = require('../videoGenerationCore');
const temporalGenerationPlanner = require('./temporalGenerationPlannerService');

// Keep the lineage token stable so already-approved single-shot clips are not
// invalidated merely because automatic multi-shot provider units are retired.
const SCENE_BLOCK_POLICY_VERSION = 'continuous-scene-workflow-v6';
const DEFAULT_MIN_BLOCK_DURATION = 6;
const DEFAULT_MAX_BLOCK_DURATION = 10;
const DEFAULT_MAX_BLOCK_SHOTS = 4;
const VERIFIED_TEMPORAL_CAPABILITY = Symbol('verified-temporal-capability');

function text(value = '') {
  return String(value || '').trim();
}

function clipped(value = '', limit = 240) {
  return text(value).slice(0, limit);
}

function durationOf(shot = {}) {
  return Math.max(1, Math.min(15, Number(shot.duration_sec || shot.duration || shot.seconds || 3) || 3));
}

function certifyTemporalCapabilities(options = {}, evidence = {}) {
  // 连续母片能力只能由服务端的只读能力证据签发；客户端 JSON 无法伪造 Symbol 门禁。
  const verified = evidence.provider_supports_continuous_generation === true
    && evidence.adapter_supports_temporal_anchor_binding === true
    && Number(evidence.max_temporal_anchors || 0) > 1;
  if (!verified) return { ...options };
  return {
    ...options,
    supports_continuous_generation: true,
    adapter_supports_temporal_anchor_binding: true,
    max_temporal_anchors: Number(evidence.max_temporal_anchors),
    max_continuous_duration: Number(evidence.max_continuous_duration || options.max_continuous_duration || 10),
    [VERIFIED_TEMPORAL_CAPABILITY]: true,
  };
}

function sceneIdentity(shot = {}, contract = {}) {
  const lock = contract.scene_lock || {};
  const id = text(shot.scene_id || shot.scene_asset_id || lock.scene_id);
  if (!id) return '';
  return `${id}@${Math.max(1, Number(shot.scene_revision || lock.scene_revision || 1) || 1)}`;
}

function temporalIdentity(shot = {}, contract = {}) {
  const lock = contract.scene_lock || {};
  return revisionService.signature({
    time: shot.time_of_day || shot.temporal_state || shot.time_state || '',
    lighting: lock.scene_contract?.lighting || lock.lighting || '',
    weather: shot.weather || lock.weather || '',
  });
}

function hasContinuityHandoff(shot = {}, previousShot = {}) {
  const previousExit = text(previousShot.exit_frame_state || previousShot.exit_state || '');
  const currentEntry = text(shot.entry_frame_state || shot.entry_state || '');
  if (previousExit && currentEntry) return true;
  const previousDirection = text(previousShot.screen_direction || '').toLowerCase();
  const currentDirection = text(shot.screen_direction || '').toLowerCase();
  return !!(previousDirection && currentDirection && previousDirection === currentDirection);
}

function isExplicitBoundary(shot = {}, previousShot = {}, options = {}) {
  const transition = text(shot.transition_type || shot.transition).toLowerCase();
  const from = text(shot.transition_from || '');
  const previousScene = text(previousShot.scene_id || previousShot.scene_asset_id || '');
  if (from && previousScene && from !== previousScene) return true;
  if (/flash|black|time.?jump|montage|jump.?cut|smash.?cut/.test(transition)) return true;
  if (/fade|dissolve/.test(transition)) return true;
  if (options.preserve_existing_topology === true && /hard.?cut|match.?cut/.test(transition)) return true;
  if (/hard.?cut|match.?cut/.test(transition) && !hasContinuityHandoff(shot, previousShot)) return true;
  return shot.scene_block_boundary === true || shot.force_new_scene_block === true;
}

function visiblePersonPresence(shot = {}, options = {}) {
  if (Array.isArray(shot.characters) && shot.characters.filter(Boolean).length > 0) return true;
  if (options.preserve_existing_topology === true && Array.isArray(shot.characters)) return false;
  const subjectType = text(shot.subject_type || shot.cast_mode || shot.person_mode).toLowerCase();
  if (/no.?person|no.?human|object.?only|product.?only|empty/.test(subjectType)) return false;
  if (/person|human|character|cast/.test(subjectType)) return true;
  const peopleCount = Number(shot.people_count ?? shot.person_count);
  return Number.isFinite(peopleCount) ? peopleCount > 0 : null;
}

function hasCastModeBoundary(shot = {}, previousShot = {}, options = {}) {
  const currentPresence = visiblePersonPresence(shot, options);
  const previousPresence = visiblePersonPresence(previousShot, options);
  return currentPresence !== null && previousPresence !== null && currentPresence !== previousPresence;
}

function spatialReferenceUrls(contract = {}) {
  const lock = contract.scene_lock || {};
  const views = Array.isArray(lock.view_images) ? lock.view_images : [];
  const preferred = ['master', lock.scene_view, 'interaction', 'reverse', 'detail'].filter(Boolean);
  const ordered = preferred.flatMap(key => views.filter(view => text(view.key || view.view_id || view.view) === key))
    .concat(views);
  return [...new Set(ordered.map(view => text(view.url || view.image_url || view.imageUrl || view.reference_image_url)).filter(Boolean))].slice(0, 2);
}

function finalizeBlock(block, shots, contracts) {
  const members = block.member_indexes;
  const first = members[0];
  const last = members[members.length - 1];
  let cursor = 0;
  const beats = members.map((index) => {
    const shot = shots[index] || {};
    const duration = durationOf(shot);
    const beat = {
      shot_index: index + 1,
      start_sec: cursor,
      end_sec: cursor + duration,
      duration_sec: duration,
      purpose: clipped(shot.purpose || shot.role || '', 140),
      visual: clipped(shot.visual || shot.visual_description || '', 260),
      action: clipped(shot.action || shot.visual_action || '', 220),
      camera_movement: clipped(shot.camera_movement || shot.camera || '', 160),
      entry_frame_state: clipped(shot.entry_frame_state || '', 180),
      exit_frame_state: clipped(shot.exit_frame_state || '', 180),
      screen_direction: clipped(shot.screen_direction || '', 100),
      object_states: clipped(shot.object_states || '', 180),
      characters: Array.isArray(shot.characters) ? shot.characters : [],
      // 语义切点只读取当前镜头的开放式状态证据，不依据行业动作词表猜测。
      temporal_evidence: contracts[index]?.temporal_evidence_lock || shot.temporal_evidence || null,
    };
    cursor += duration;
    return beat;
  });
  const firstContract = contracts[first] || {};
  const payload = {
    policy_version: SCENE_BLOCK_POLICY_VERSION,
    scene_identity: block.scene_identity,
    temporal_identity: block.temporal_identity,
    member_indexes: members,
    beats,
    scene_contract_fingerprint: firstContract.scene_lock?.scene_contract?.reference_fingerprint || '',
    scene_lock_signature: revisionService.signature(firstContract.scene_lock || {}),
  };
  return {
    ...block,
    id: `scene-block-${first + 1}-${last + 1}-${revisionService.signature(payload).slice(0, 12)}`,
    fingerprint: revisionService.signature(payload),
    duration_sec: cursor,
    beats,
    first_index: first,
    last_index: last,
    continuous: members.length > 1,
    spatial_reference_urls: spatialReferenceUrls(firstContract),
    policy_version: SCENE_BLOCK_POLICY_VERSION,
  };
}

/**
 * 将通用执行方案转换为旧视频适配器可读取的兼容块。
 * 注意：块现在代表付费生成单元，不再代表“同场景镜头自动合并”。
 */
function partitionContinuousRun(run = {}, shots = [], options = {}) {
  const members = Array.isArray(run.member_indexes) ? run.member_indexes : [];
  if (!members.length) return [];
  const minDuration = Math.max(1, Math.min(10, Number(options.minDuration || DEFAULT_MIN_BLOCK_DURATION) || DEFAULT_MIN_BLOCK_DURATION));
  const maxDuration = Math.max(minDuration, Math.min(10, Number(options.maxDuration || DEFAULT_MAX_BLOCK_DURATION) || DEFAULT_MAX_BLOCK_DURATION));
  const maxShots = Math.max(1, Math.min(6, Number(options.maxShots || DEFAULT_MAX_BLOCK_SHOTS) || DEFAULT_MAX_BLOCK_SHOTS));
  const idealDuration = (minDuration + maxDuration) / 2;
  const size = members.length;
  const best = Array(size + 1).fill(null);
  best[0] = { cost: 0, groups: [] };
  for (let end = 1; end <= size; end += 1) {
    for (let start = Math.max(0, end - maxShots); start < end; start += 1) {
      if (!best[start]) continue;
      const slice = members.slice(start, end);
      const duration = slice.reduce((sum, member) => sum + durationOf(shots[member] || {}), 0);
      const unavoidableOversize = slice.length === 1 && duration > maxDuration;
      if (duration > maxDuration && !unavoidableOversize) continue;
      const edgeRemainder = start === 0 || end === size;
      const underMinPenalty = duration < minDuration ? (minDuration - duration) * (edgeRemainder ? 8 : 20) : 0;
      const oversizePenalty = duration > maxDuration ? (duration - maxDuration) * 50 : 0;
      const cost = best[start].cost + underMinPenalty + oversizePenalty + Math.abs(duration - idealDuration);
      if (!best[end] || cost < best[end].cost) {
        best[end] = { cost, groups: [...best[start].groups, { ...run, member_indexes: slice, duration_sec: duration }] };
      }
    }
  }
  return best[size]?.groups || members.map(member => ({ ...run, member_indexes: [member], duration_sec: durationOf(shots[member] || {}) }));
}

function buildSceneBlocks(shots = [], contracts = [], options = {}) {
  const list = Array.isArray(shots) ? shots : [];
  if (!list.length) return [];
  const executionPlan = videoCore.planner.compileExecutionPlan({
    shots: list,
    contracts,
    businessProfile: options.business_profile || options.businessProfile || 'story_ad',
    options,
  });
  const temporalOptions = options[VERIFIED_TEMPORAL_CAPABILITY] === true
    ? options
    : {
      ...options,
      supports_continuous_generation: false,
      provider_supports_temporal_multi_keyframe: false,
      adapter_supports_temporal_anchor_binding: false,
    };
  const temporalPlan = temporalGenerationPlanner.buildGenerationUnits(list, contracts, temporalOptions);
  const executionUnitFor = index => executionPlan.generation_units
    .find(unit => unit.edit_shot_indexes.includes(index)) || {};
  // 默认仍逐镜提交；只有供应商能力、适配器绑定和时间锚点容量三项均有明确证据时，
  // 才把开放式连续组转换成一次付费的连续母片，避免重复计费或后续关键帧失去约束。
  return temporalPlan.generation_units.map((temporalUnit) => {
    const members = temporalUnit.member_indexes || [];
    const firstIndex = members[0];
    const firstShot = list[firstIndex] || {};
    const firstContract = contracts[firstIndex] || {};
    const executionUnits = members.map(executionUnitFor);
    const continuous = temporalUnit.mode === 'continuous'
      && members.length > 1
      && executionUnits.every(unit => unit.mode !== 'local_motion' && unit.paid !== false);
    const compatible = finalizeBlock({
      scene_identity: sceneIdentity(firstShot, firstContract) || `unbound-shot-${firstIndex + 1}`,
      temporal_identity: temporalIdentity(firstShot, firstContract),
      member_indexes: continuous ? members : [firstIndex],
      duration_sec: continuous ? temporalUnit.duration_sec : durationOf(firstShot),
    }, list, contracts);
    return {
      ...compatible,
      generation_mode: continuous ? 'one_take' : (executionUnits[0]?.mode === 'local_motion' ? 'local_motion' : 'single_shot'),
      continuous,
      paid: executionUnits.every(unit => unit.paid !== false),
      complexity_level: continuous ? 'high' : videoCore.planner.complexityOf(executionPlan.edit_shots[firstIndex] || {}),
      requires_manual_review: continuous,
      automatic_retry_limit: 0,
      execution_plan_fingerprint: executionPlan.fingerprint,
      temporal_anchor_binding_verified: continuous,
      required_temporal_anchors: temporalUnit.required_temporal_anchors || 1,
      temporal_plan_policy_version: temporalPlan.policy_version,
      temporal_plan_fingerprint: temporalPlan.fingerprint,
      continuity_cluster_id: temporalPlan.continuity_clusters.find(cluster => cluster.member_indexes.includes(firstIndex))?.id || '',
      continuity_edges: temporalUnit?.continuity_edges || [],
      handoff_required: temporalUnit?.handoff_required === true,
      temporal_split_reason: temporalUnit?.split_reason || '',
      policy_version: SCENE_BLOCK_POLICY_VERSION,
    };
  });
}

function blockForIndex(blocks = [], index = 0) {
  return (Array.isArray(blocks) ? blocks : []).find(block => block.member_indexes.includes(index)) || null;
}

function expandIndexesToBlocks(indexes = [], blocks = []) {
  const expanded = new Set(indexes);
  indexes.forEach((index) => {
    const block = blockForIndex(blocks, index);
    (block?.member_indexes || []).forEach(member => expanded.add(member));
  });
  return [...expanded].sort((a, b) => a - b);
}

function isolateIndexes(blocks = [], shots = [], contracts = [], indexes = []) {
  const isolated = new Set((Array.isArray(indexes) ? indexes : []).map(Number).filter(Number.isInteger));
  if (!isolated.size) return Array.isArray(blocks) ? blocks : [];
  return (Array.isArray(blocks) ? blocks : []).flatMap((block) => {
    const members = Array.isArray(block.member_indexes) ? block.member_indexes : [];
    if (!members.some(index => isolated.has(index))) return [block];
    const groups = [];
    let current = [];
    members.forEach((index) => {
      if (isolated.has(index)) {
        if (current.length) groups.push(current);
        groups.push([index]);
        current = [];
        return;
      }
      current.push(index);
    });
    if (current.length) groups.push(current);
    return groups.map((memberIndexes) => {
      const finalized = finalizeBlock({
        ...block,
        member_indexes: memberIndexes,
      }, shots, contracts);
      const continuous = block.generation_mode === 'one_take' && memberIndexes.length > 1;
      return {
        ...block,
        ...finalized,
        generation_mode: continuous ? 'one_take' : 'single_shot',
        continuous,
        complexity_level: continuous ? block.complexity_level : 'standard',
        requires_manual_review: continuous && block.requires_manual_review === true,
        isolated_for_keyframe_transition: memberIndexes.length === 1 && isolated.has(memberIndexes[0]),
        policy_version: SCENE_BLOCK_POLICY_VERSION,
      };
    });
  });
}

/** 为单镜或经批准的一镜到底生成供应商镜头合同。 */
function generationShot(block = {}, shots = []) {
  const memberShots = block.member_indexes.map(index => shots[index] || {});
  const oneTake = block.generation_mode === 'one_take' && memberShots.length > 1;
  if (!oneTake) {
    const shot = memberShots[0] || {};
    return {
      ...shot,
      title: shot.title || `第 ${(block.first_index ?? 0) + 1} 镜`,
      purpose: shot.purpose || shot.role || '生成一个可直接用于最终剪辑的独立镜头。',
      duration_sec: block.duration_sec || durationOf(shot),
    };
  }
  return {
    title: `Continuous scene block ${block.first_index + 1}-${block.last_index + 1}`,
    purpose: 'Execute the ordered current-task storyboard beats as one uninterrupted spatially continuous shot.',
    visual: memberShots.map((shot, i) => `Beat ${i + 1}: ${shot.visual || shot.visual_description || ''}`).join('\n'),
    action: memberShots.map((shot, i) => `Beat ${i + 1}: ${shot.action || shot.visual_action || ''}`).join('\n'),
    camera_movement: memberShots.map((shot, i) => `Beat ${i + 1}: ${shot.camera_movement || shot.camera || ''}`).join('\n'),
    characters: [...new Set(memberShots.flatMap(shot => Array.isArray(shot.characters) ? shot.characters : []).filter(Boolean))],
    duration_sec: block.duration_sec,
    speech_mode: memberShots.some(shot => String(shot.speech_mode || '').toLowerCase() === 'on_camera_dialogue') ? 'on_camera_dialogue' : 'offscreen_voiceover',
  };
}

function compactSceneLock(lock = {}) {
  const sceneContract = lock.scene_contract || {};
  const compactRows = (rows, limit = 8) => (Array.isArray(rows) ? rows.slice(0, limit).map(row => (
    row && typeof row === 'object'
      ? { id: row.id || row.anchor_id || row.zone_id || '', name: row.name || row.label || '', position: row.position || row.location || '', relationship: row.relationship || row.relative_position || '' }
      : row
  )) : []);
  return {
    scene_id: lock.scene_id || '', scene_revision: lock.scene_revision || 1,
    scene_name: clipped(lock.scene_name || '', 100), layout_summary: clipped(lock.layout_summary || '', 300),
    material_summary: clipped(lock.material_summary || '', 260), style_summary: clipped(lock.style_summary || '', 180),
    zone_ids: lock.zone_ids || [], anchor_ids: lock.anchor_ids || [],
    anchors: compactRows(sceneContract.anchors), zones: compactRows(sceneContract.zones),
    geometry_facts: (sceneContract.geometry_facts || []).slice(0, 6),
    materials: (sceneContract.materials || []).slice(0, 6), lighting: sceneContract.lighting || {},
  };
}

/** 生成单镜或一镜到底提示词；只有明确批准的一镜到底才使用连续母片语义。 */
function generationPrompt(block = {}, shots = [], contracts = [], repairInstructions = {}) {
  const firstContract = contracts[block.first_index] || {};
  const repairs = block.member_indexes.map(index => repairInstructions[index]).filter(Boolean);
  const promptBeats = (block.beats || []).map(beat => ({
    shot_index: beat.shot_index, start_sec: beat.start_sec, end_sec: beat.end_sec,
    visual: clipped(beat.visual, 150), action: clipped(beat.action, 130),
    camera_movement: clipped(beat.camera_movement, 90), entry_frame_state: clipped(beat.entry_frame_state, 90),
    exit_frame_state: clipped(beat.exit_frame_state, 90), screen_direction: clipped(beat.screen_direction, 60),
    object_states: clipped(beat.object_states, 90), characters: beat.characters,
    temporal_evidence: beat.temporal_evidence || null,
  }));
  const oneTake = block.generation_mode === 'one_take' && block.member_indexes.length > 1;
  const instructions = oneTake ? [
    'Generate one intentionally designed uninterrupted take inside one current-task spatial scene. Do not cut, dissolve, teleport or rebuild the room between authored beats.',
    'Move the camera and subjects continuously through the established space. Preserve cast identity, wardrobe, prop state, screen direction and action handoff across every beat.',
  ] : [
    'Generate exactly one final edit shot. Do not invent additional shots, split screens, montages or unrequested camera changes.',
    'Use this shot-specific camera, lens, composition, cast blocking and approved keyframe state. The shared scene world defines geometry but does not force a continuous mother clip.',
  ];
  return [
    ...instructions,
    'Treat doors, windows, walls, fixed furniture, display structures, dominant materials, lighting direction and spatial anchors as immutable geometry.',
    'The task may represent any lawful industry, environment, person, product or story. Use only this task contract and never substitute a template scene.',
    block.handoff_required
      ? `This independent unit must preserve the authored temporal handoff from the previous unit: ${JSON.stringify(block.continuity_edges || [])}. Begin from the approved current keyframe, retain all invariants, and continue only the declared state change.`
      : '',
    firstContract.temporal_evidence_lock
      ? `V2.0 temporal evidence contract: ${JSON.stringify(firstContract.temporal_evidence_lock)}`
      : '',
    repairs.length ? `QA repair requirements: ${repairs.join('\n')}` : '',
    `${oneTake ? 'Ordered timeline beats' : 'Edit shot contract'}: ${JSON.stringify(promptBeats)}`,
    `Generation unit contract: ${JSON.stringify({ id: block.id, mode: block.generation_mode || 'single_shot', scene_identity: block.scene_identity, duration_sec: block.duration_sec, scene_lock: compactSceneLock(firstContract.scene_lock || {}) })}`,
  ].filter(Boolean).join('\n').slice(0, 3950);
}

module.exports = {
  SCENE_BLOCK_POLICY_VERSION,
  DEFAULT_MIN_BLOCK_DURATION,
  DEFAULT_MAX_BLOCK_DURATION,
  DEFAULT_MAX_BLOCK_SHOTS,
  certifyTemporalCapabilities,
  durationOf,
  sceneIdentity,
  hasContinuityHandoff,
  isExplicitBoundary,
  visiblePersonPresence,
  hasCastModeBoundary,
  spatialReferenceUrls,
  partitionContinuousRun,
  buildSceneBlocks,
  blockForIndex,
  expandIndexesToBlocks,
  isolateIndexes,
  generationShot,
  compactSceneLock,
  generationPrompt,
};
