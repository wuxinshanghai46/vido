'use strict';

const storage = require('../newStoryAd/storageService');

const OUTPUT_KIND = 'story_flow_contract';
const CONTRACT_VERSION = 3;
const DOWNSTREAM_KINDS = Object.freeze([
  'storyboard_checkpoint', 'storyboard_coverage_plan', 'storyboard_table', 'storyboard_meta',
  'storyboard_images', 'storyboard_image_batch', 'storyboard_sketches', 'storyboard_sketch_batch',
  'shot_reference_packs', 'continuity_contracts', 'keyframe_contracts', 'keyframes',
  'quality_review', 'sound_journey', 'tts_audio', 'video_clips', 'video_scene_blocks', 'final_video',
]);

function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function clean(value = '', max = 1200) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function now() { return new Date().toISOString(); }
function stableId(value, fallback = '') { return clean(value || fallback, 160); }

function taskState(taskId) {
  const task = storage.getTask(taskId);
  if (!task) throw Object.assign(new Error('项目不存在'), { code: 'TASK_NOT_FOUND', status: 404 });
  const context = storage.getOutput(taskId, 'context') || task.request || {};
  const blueprint = storage.getOutput(taskId, 'blueprint') || {};
  const sceneAssets = list(storage.getOutput(taskId, 'scene_assets') || context.scene_assets);
  const sceneConfig = storage.getOutput(taskId, 'scene_config') || context.scene_plan || {};
  const castProfiles = list(context.cast_profiles).length
    ? list(context.cast_profiles)
    : list(storage.getOutput(taskId, 'asset_plan')?.cast_profiles);
  const castAssets = list(context.person_asset?.cast_assets).length
    ? list(context.person_asset.cast_assets)
    : (context.person_asset ? [context.person_asset] : []);
  const cast = castProfiles.map((profile, index) => {
    const id = stableId(profile.character_id || profile.cast_id || profile.id);
    const asset = castAssets.find(item => [item.actor_id, item.character_id, item.subject_profile?.id, item.id]
      .map(stableId).includes(id)) || castAssets[index] || {};
    return {
      ...profile,
      person_revision: Number(asset.person_revision || asset.revision || profile.person_revision || profile.revision || context.person_contract?.person_revision || 0) || 0,
      identity_reference_ids: list(asset.identity_views || asset.view_images || asset.atomic_assets)
        .map((item, itemIndex) => stableId(item.id || item.asset_id || item.key, `identity_ref_${itemIndex + 1}`)),
    };
  });
  const beats = list(blueprint.beats);
  if (!beats.length) throw Object.assign(new Error('请先生成并确认剧情与对白。'), {
    code: 'BLUEPRINT_REQUIRED_FOR_STORY_FLOW', status: 409, retryable: false,
  });
  if (context.scene_setup_confirmed !== true) throw Object.assign(new Error('请先完成并确认人物与场景资产。'), {
    code: 'SCENE_CONFIRMATION_REQUIRED_FOR_STORY_FLOW', status: 409, retryable: false,
  });
  return { task, context, blueprint, sceneAssets, sceneConfig, cast, beats };
}

function beatId(beat = {}, index = 0) {
  return stableId(beat.beat_id || beat.story_beat_id || beat.id, `beat_${index + 1}`);
}

function personAuthority(person = {}, index = 0) {
  const looks = list(person.look_profiles).map((look, lookIndex) => ({
    look_id: stableId(look.id || look.look_id, `look_${index + 1}_${lookIndex + 1}`),
    name: clean(look.name || look.title || look.label || `造型 ${lookIndex + 1}`, 120),
    description: clean([
      look.description, look.prompt, look.wardrobe, look.clothing, look.accessories,
      look.hair, look.makeup, look.scene_usage, look.story_usage,
    ].flat().filter(Boolean).join('；'), 1000),
  }));
  return {
    character_id: stableId(person.character_id || person.cast_id || person.id),
    name: clean(person.name || person.displayName || person.role || `人物 ${index + 1}`, 120),
    person_revision: Math.max(0, Number(person.person_revision || person.revision || 0) || 0),
    look_ids: looks.map(look => look.look_id),
    looks,
    voice_id: stableId(person.voice_id || person.voiceId || person.tts_voice_id || person.voice_assignment?.voice_id),
    description: clean([
      person.description, person.bio, person.identity, person.appearance,
      person.wardrobe, person.role_description,
    ].filter(Boolean).join('；'), 1200),
    identity_reference_ids: list(person.identity_reference_ids).map(value => stableId(value)).filter(Boolean),
  };
}

function sceneAuthority(scene = {}, index = 0, sceneConfig = {}) {
  const contract = scene.scene_contract && typeof scene.scene_contract === 'object' ? scene.scene_contract : {};
  const sceneId = stableId(scene.scene_id || scene.space_id || scene.id);
  const configured = list(sceneConfig.spaces || sceneConfig.scenes || sceneConfig.scene_plan)
    .find(space => stableId(space.scene_id || space.space_id || space.id) === sceneId) || {};
  const views = list(scene.view_images || scene.views).map((view, viewIndex) => ({
    view_id: stableId(view.view_id || view.key || view.id, `view_${viewIndex + 1}`),
    image_url: clean(view.image_url || view.imageUrl || view.url, 1200),
  }));
  return {
    scene_id: sceneId,
    name: clean(scene.name || scene.scene_name || scene.title || `场景 ${index + 1}`, 120),
    story_purpose: clean(scene.story_purpose || configured.story_purpose || configured.purpose || contract.story_purpose, 900),
    layout: clean(configured.layout || configured.layout_text || contract.layout || scene.layout, 700),
    interaction: clean(configured.interaction || configured.interaction_text || contract.interaction || scene.interaction, 700),
    covered_beat_ids: list(configured.covered_beat_ids || configured.beat_ids || configured.story_beat_ids).map(String),
    required_in_story: configured.required_in_story !== false,
    description: clean([
      scene.description, scene.prompt, scene.scene_prompt, contract.description,
      contract.spatial_summary, contract.layout, contract.materials, contract.lighting,
    ].flat().filter(Boolean).join('；'), 1800),
    scene_revision: Math.max(1, Number(scene.scene_revision || scene.revision || contract.revision || 1) || 1),
    view_ids: views.map(view => view.view_id),
    sound_profile_id: stableId(scene.sound_profile_id || scene.sound_profile?.id || contract.sound_profile_id || `sound_profile_${stableId(scene.scene_id || scene.space_id || scene.id)}`),
  };
}

function authoritySnapshot(state) {
  const people = state.cast.map(personAuthority);
  const scenes = state.sceneAssets.map((scene, index) => sceneAuthority(scene, index, state.sceneConfig));
  const narrativeSceneSequence = declaredSceneSequence(state, scenes);
  const blueprintFingerprint = clean(state.blueprint.fingerprint, 220) || storage.canonicalFingerprint({
    title: state.blueprint.story_title || state.blueprint.title || '',
    logline: state.blueprint.logline || '',
    beats: state.beats,
  });
  const authoritySource = {
    blueprint_fingerprint: blueprintFingerprint,
    people,
    scenes,
  };
  if (narrativeSceneSequence.length) authoritySource.narrative_scene_sequence = narrativeSceneSequence;
  const authorityFingerprint = storage.canonicalFingerprint(authoritySource);
  return { people, scenes, narrative_scene_sequence: narrativeSceneSequence, blueprint_fingerprint: blueprintFingerprint, authority_fingerprint: authorityFingerprint };
}

function tokens(value = '') {
  const text = clean(value, 2000).toLowerCase();
  return new Set([
    ...text.match(/[a-z0-9_\-]{2,}/g) || [],
    ...text.replace(/[a-z0-9_\-]/g, '').split('').filter(char => /[\u3400-\u9fff]/.test(char)),
  ]);
}

function overlapScore(left = '', right = '') {
  const a = tokens(left); const b = tokens(right);
  let score = 0;
  a.forEach(value => { if (b.has(value)) score += 1; });
  return score;
}

function sceneMentionText(value = '') {
  return clean(value, 2400).toLowerCase().replace(/[\s，。；、：,.!！?？“”"'（）()\[\]【】的]/gu, '');
}

function declaredSceneSequence(state = {}, scenes = []) {
  const seed = state.context?.story_seed && typeof state.context.story_seed === 'object' ? state.context.story_seed : {};
  const phaseKeys = ['opening', 'setup', 'development', 'turning_point', 'progression', 'resolution', 'ending', 'closing'];
  const segments = [
    ...phaseKeys.map(key => seed[key]),
    ...list(seed.plot_beats || seed.plotBeats).map(beat => [beat.location, beat.summary, beat.content, beat.description].filter(Boolean).join(' ')),
  ].map(value => clean(typeof value === 'object' ? JSON.stringify(value) : value, 1800)).filter(Boolean);
  const sequence = [];
  segments.forEach((segment) => {
    const normalizedSegment = sceneMentionText(segment);
    const exactMatches = scenes.map(scene => ({ scene, position: scene.name ? normalizedSegment.indexOf(sceneMentionText(scene.name)) : -1 }))
      .filter(item => item.position >= 0).sort((a, b) => a.position - b.position);
    const selected = exactMatches.map(item => item.scene);
    selected.forEach((scene) => {
      if (scene?.scene_id && sequence[sequence.length - 1] !== scene.scene_id) sequence.push(scene.scene_id);
    });
  });
  return sequence;
}

function plannedSceneForBeat(state, beat, index, scenes) {
  const explicit = stableId(beat.scene_id || beat.sceneId || beat.scene_asset_id);
  if (explicit && scenes.some(scene => scene.scene_id === explicit)) return explicit;
  const spaces = list(state.sceneConfig.spaces || state.sceneConfig.scenes || state.sceneConfig.scene_plan);
  for (const space of spaces) {
    const covered = list(space.covered_beat_ids || space.beat_ids || space.story_beat_ids).map(String);
    if (covered.includes(beatId(beat, index)) || covered.includes(String(index + 1))) {
      const id = stableId(space.scene_id || space.space_id || space.id);
      if (scenes.some(scene => scene.scene_id === id)) return id;
    }
  }
  if (scenes.length === 1) return scenes[0].scene_id;
  const beatText = [beat.title, beat.plot, beat.visual, beat.action, beat.location, beat.scene].filter(Boolean).join(' ');
  const ranked = scenes.map(scene => ({ scene, score: overlapScore(beatText, `${scene.name} ${scene.story_purpose || ''} ${scene.layout || ''} ${scene.interaction || ''}`) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 && ranked[0].score > (ranked[1]?.score || 0) ? ranked[0].scene.scene_id : '';
}

function plannedScenesForBeats(state, beats, scenes, declared = []) {
  const rows = list(beats);
  const sequence = list(declared).map(stableId).filter(id => scenes.some(scene => scene.scene_id === id));
  if (sequence.length < 2 || rows.length < sequence.length) {
    return rows.map((beat, index) => plannedSceneForBeat(state, beat, index, scenes));
  }
  const sceneById = new Map(scenes.map(scene => [scene.scene_id, scene]));
  const score = (beat, sceneId) => {
    const scene = sceneById.get(sceneId) || {};
    const beatText = [beat.title, beat.plot, beat.visual, beat.action, beat.location, beat.scene].filter(Boolean).join(' ');
    const sceneText = `${scene.name || ''} ${scene.story_purpose || ''} ${scene.layout || ''} ${scene.interaction || ''}`;
    return overlapScore(beatText, sceneText);
  };
  const minimum = rows.length >= sequence.length * 2 ? 2 : 1;
  const memo = new Map();
  const solve = (beatIndex, sceneIndex) => {
    const key = `${beatIndex}:${sceneIndex}`;
    if (memo.has(key)) return memo.get(key);
    const remainingBeats = rows.length - beatIndex;
    const remainingScenes = sequence.length - sceneIndex;
    if (remainingScenes === 1) {
      const result = {
        score: rows.slice(beatIndex).reduce((sum, beat) => sum + score(beat, sequence[sceneIndex]), 0),
        scenes: rows.slice(beatIndex).map(() => sequence[sceneIndex]),
      };
      memo.set(key, result); return result;
    }
    let best = null;
    const maxTake = remainingBeats - minimum * (remainingScenes - 1);
    for (let take = minimum; take <= maxTake; take += 1) {
      const next = solve(beatIndex + take, sceneIndex + 1);
      if (!next) continue;
      const own = rows.slice(beatIndex, beatIndex + take).reduce((sum, beat) => sum + score(beat, sequence[sceneIndex]), 0);
      const candidate = { score: own + next.score, scenes: [...Array(take).fill(sequence[sceneIndex]), ...next.scenes] };
      if (!best || candidate.score > best.score) best = candidate;
    }
    memo.set(key, best); return best;
  };
  return solve(0, 0)?.scenes || rows.map((beat, index) => plannedSceneForBeat(state, beat, index, scenes));
}

function peopleForBeat(beat, people) {
  const explicit = list(beat.character_ids || beat.characters || beat.people).map(item => (
    typeof item === 'object' ? stableId(item.character_id || item.cast_id || item.id || item.name) : stableId(item)
  ));
  const resolved = new Set();
  explicit.forEach(value => {
    const match = people.find(person => person.character_id === value || person.name === value);
    if (match) resolved.add(match.character_id);
  });
  const text = clean([beat.title, beat.plot, beat.visual, beat.action, beat.spoken_line].filter(Boolean).join(' '), 3000);
  people.forEach(person => { if (person.name && text.includes(person.name)) resolved.add(person.character_id); });
  if (!resolved.size && people.length === 1 && !/无人|空镜|纯场景|无人物/.test(text)) resolved.add(people[0].character_id);
  return [...resolved];
}

function unitFromBeat(state, beat, index, authority) {
  const characterIds = peopleForBeat(beat, authority.people);
  return {
    beat_id: beatId(beat, index),
    beat_index: index + 1,
    title: clean(beat.title || beat.role || `剧情节点 ${index + 1}`, 160),
    plot: clean(beat.plot || beat.visual || beat.summary || '', 1600),
    action: clean(beat.action || beat.character_action || '', 800),
    state_before: clean(beat.state_before || beat.entry_frame_state || '', 600),
    state_after: clean(beat.state_after || beat.exit_frame_state || '', 600),
    spoken_line: clean(beat.spoken_line || beat.voiceover || beat.copy || '', 600),
    character_ids: characterIds,
    look_bindings: Object.fromEntries(characterIds.map(id => {
      const person = authority.people.find(item => item.character_id === id);
      return [id, person?.look_ids?.[0] || ''];
    })),
    voice_bindings: Object.fromEntries(characterIds.map(id => {
      const person = authority.people.find(item => item.character_id === id);
      return [id, person?.voice_id || ''];
    })),
    scene_id: plannedSceneForBeat(state, beat, index, authority.scenes),
    transition_from: '',
    transition_reason: '',
  };
}

function draft(taskId) {
  const state = taskState(taskId);
  const authority = authoritySnapshot(state);
  const stored = storage.getOutput(taskId, OUTPUT_KIND);
  const current = stored && Number(stored.contract_version || 0) === CONTRACT_VERSION
    && stored.authority_fingerprint === authority.authority_fingerprint
    && stored.blueprint_fingerprint === authority.blueprint_fingerprint;
  const plannedScenes = plannedScenesForBeats(state, state.beats, authority.scenes, authority.narrative_scene_sequence);
  const generatedUnits = state.beats.map((beat, index) => ({
    ...unitFromBeat(state, beat, index, authority),
    scene_id: plannedScenes[index] || '',
  }));
  generatedUnits.forEach((unit, index) => {
    const previous = generatedUnits[index - 1];
    if (!previous || !unit.scene_id || unit.scene_id === previous.scene_id) return;
    const scene = authority.scenes.find(item => item.scene_id === unit.scene_id);
    unit.transition_from = previous.scene_id;
    unit.transition_reason = `剧情从“${previous.title}”推进到“${unit.title}”，地点切换至“${scene?.name || unit.scene_id}”`;
  });
  const priorById = new Map(current ? list(stored.units).map(unit => [stableId(unit.beat_id), unit]) : []);
  const units = generatedUnits.map(unit => {
    const prior = priorById.get(unit.beat_id);
    if (!prior) return unit;
    return {
      ...unit,
      character_ids: list(prior.character_ids),
      look_bindings: prior.look_bindings && typeof prior.look_bindings === 'object' ? prior.look_bindings : unit.look_bindings,
      voice_bindings: prior.voice_bindings && typeof prior.voice_bindings === 'object' ? prior.voice_bindings : unit.voice_bindings,
      scene_id: stableId(prior.scene_id) || unit.scene_id,
    };
  });
  return {
    contract_version: CONTRACT_VERSION,
    status: current ? clean(stored.status, 30) || 'draft' : 'draft',
    model_call_count: 0,
    blueprint_fingerprint: authority.blueprint_fingerprint,
    authority_fingerprint: authority.authority_fingerprint,
    people: authority.people,
    scenes: authority.scenes,
    narrative_scene_sequence: authority.narrative_scene_sequence,
    story_seed: state.context.story_seed && typeof state.context.story_seed === 'object' ? state.context.story_seed : {},
    units,
    historical_flow_sketch_count: list(storage.getOutput(taskId, 'story_flow_sketches')).length,
    created_at: current ? clean(stored.created_at, 80) : '',
    updated_at: current ? clean(stored.updated_at, 80) : '',
    confirmed_at: current ? clean(stored.confirmed_at, 80) : '',
  };
}

function validateUnits(base, supplied = [], options = {}) {
  const incoming = new Map(list(supplied).map(unit => [stableId(unit.beat_id), unit]));
  const personIds = new Set(base.people.map(person => person.character_id));
  const sceneIds = new Set(base.scenes.map(scene => scene.scene_id));
  const errors = [];
  if (options.requireExact === true) {
    const expectedIds = new Set(base.units.map(unit => unit.beat_id));
    const suppliedIds = list(supplied).map(unit => stableId(unit.beat_id)).filter(Boolean);
    const duplicateIds = suppliedIds.filter((id, index) => suppliedIds.indexOf(id) !== index);
    duplicateIds.forEach(id => errors.push(`剧情节点 ${id} 被重复绑定`));
    suppliedIds.filter(id => !expectedIds.has(id)).forEach(id => errors.push(`返回了不存在的剧情节点 ${id}`));
    base.units.filter(unit => !incoming.has(unit.beat_id)).forEach(unit => errors.push(`${unit.title} 缺少人物与场景绑定`));
  }
  const units = base.units.map(unit => {
    const source = incoming.get(unit.beat_id) || unit;
    const characterIds = [...new Set(list(source.character_ids).map(value => stableId(value)).filter(Boolean))];
    characterIds.forEach(id => { if (!personIds.has(id)) errors.push(`${unit.title} 引用了不存在的人物 ${id}`); });
    const sceneId = stableId(source.scene_id);
    const transitionFrom = stableId(source.transition_from);
    const transitionReason = clean(source.transition_reason, 500);
    if (base.scenes.length && !sceneId) errors.push(`${unit.title} 尚未绑定场景`);
    else if (sceneId && !sceneIds.has(sceneId)) errors.push(`${unit.title} 引用了不存在的场景 ${sceneId}`);
    const lookBindings = Object.fromEntries(characterIds.map(id => {
      const person = base.people.find(item => item.character_id === id);
      const validLooks = list(person?.look_ids).map(stableId).filter(Boolean);
      const requested = stableId(source.look_bindings?.[id]);
      if (requested && !validLooks.includes(requested)) errors.push(`${unit.title} 为人物 ${id} 引用了不存在的造型 ${requested}`);
      if (!requested && validLooks.length > 1) errors.push(`${unit.title} 尚未为人物 ${id} 选择剧情对应造型`);
      return [id, requested || (validLooks.length === 1 ? validLooks[0] : '')];
    }));
    return {
      ...unit,
      character_ids: characterIds,
      scene_id: sceneId,
      transition_from: transitionFrom,
      transition_reason: transitionReason,
      look_bindings: lookBindings,
      voice_bindings: Object.fromEntries(characterIds.map(id => {
        const person = base.people.find(item => item.character_id === id);
        return [id, person?.voice_id || ''];
      })),
    };
  });
  const unitByBeatId = new Map(units.map(unit => [unit.beat_id, unit]));
  const requiredScenes = base.scenes.filter(scene => scene.required_in_story !== false);
  const defaultMinimum = requiredScenes.length && units.length >= requiredScenes.length * 2 ? 2 : 1;
  base.scenes.forEach(scene => {
    const sceneUnits = units.filter(unit => unit.scene_id === scene.scene_id);
    const explicitMinimum = Math.max(0, Number(scene.minimum_story_units || 0) || 0);
    const minimum = scene.required_in_story === false ? explicitMinimum : Math.max(defaultMinimum, explicitMinimum);
    if (sceneUnits.length < minimum) {
      errors.push(`已确认场景“${scene.name}”至少需要 ${minimum} 个有剧情作用的节点，当前只有 ${sceneUnits.length} 个`);
    }
    list(scene.covered_beat_ids).forEach(id => {
      const unit = unitByBeatId.get(String(id)) || units[Number(id) - 1];
      if (unit && unit.scene_id !== scene.scene_id) errors.push(`${unit.title} 必须使用场景“${scene.name}”`);
    });
  });
  units.forEach((unit, index) => {
    const previous = units[index - 1];
    if (!previous) {
      if (unit.transition_from) errors.push(`${unit.title} 是首个剧情节点，不应填写来源场景`);
      return;
    }
    if (unit.scene_id !== previous.scene_id) {
      if (unit.transition_from !== previous.scene_id) errors.push(`${unit.title} 的场景切换来源必须是 ${previous.scene_id}`);
      if (!unit.transition_reason) errors.push(`${unit.title} 切换场景时必须说明剧情原因`);
    } else if (unit.transition_from) {
      errors.push(`${unit.title} 没有切换场景，不应填写 transition_from`);
    }
  });
  const declared = list(base.narrative_scene_sequence).map(stableId).filter(Boolean);
  const actual = units.map(unit => unit.scene_id).filter((id, index, rows) => id && id !== rows[index - 1]);
  if (declared.length > 1 && actual.join('|') !== declared.join('|')) {
    errors.push(`场景访问顺序必须继承剧情种子：${declared.join(' → ')}；当前为：${actual.join(' → ')}`);
  }
  if (errors.length) throw Object.assign(new Error(`剧情流向尚不能确认：${errors.join('；')}`), {
    code: 'STORY_FLOW_CONTRACT_INVALID', status: 422, retryable: false, issues: errors,
  });
  return units;
}

function persistConfirmation(taskId, supplied = [], actor = {}, options = {}) {
  const base = draft(taskId);
  const units = validateUnits(base, supplied, { requireExact: options.requireExact === true });
  const previous = storage.getOutput(taskId, OUTPUT_KIND) || {};
  const nextFingerprint = storage.canonicalFingerprint({
    blueprint_fingerprint: base.blueprint_fingerprint,
    authority_fingerprint: base.authority_fingerprint,
    units: units.map(unit => ({ beat_id: unit.beat_id, character_ids: unit.character_ids, look_bindings: unit.look_bindings, voice_bindings: unit.voice_bindings, scene_id: unit.scene_id, transition_from: unit.transition_from, transition_reason: unit.transition_reason })),
  });
  const status = options.status === 'system_confirmed' ? 'system_confirmed' : 'confirmed';
  const changed = previous.contract_fingerprint !== nextFingerprint || previous.status !== status;
  const timestamp = now();
  const contract = {
    ...base,
    units,
    status,
    contract_fingerprint: nextFingerprint,
    model_call_count: Math.max(0, Number(options.model_call_count || 0) || 0),
    planning_model: clean(options.planning_model, 180),
    created_at: previous.created_at || timestamp,
    updated_at: timestamp,
    confirmed_at: timestamp,
    confirmed_by: clean(actor.id || actor.user_id || actor.email || (status === 'system_confirmed' ? 'system_ai' : 'user'), 120),
  };
  const task = storage.getTask(taskId) || {};
  if (changed && !previous.contract_fingerprint) {
    const legacy = Object.fromEntries(DOWNSTREAM_KINDS
      .map(kind => [kind, storage.getOutput(taskId, kind)])
      .filter(([, value]) => value !== null && value !== undefined));
    if (Object.keys(legacy).length) storage.saveOutput(taskId, 'story_flow_migration_archive', {
      status: 'historical_read_only',
      reason: 'pre_structured_story_flow_contract',
      archived_at: timestamp,
      outputs: legacy,
    });
  }
  storage.saveOutput(taskId, OUTPUT_KIND, contract, {
    content_revision: Number(task.content_revision || 1) || 1,
    snapshot_id: task.current_snapshot_id || `story-flow:${taskId}`,
  });
  const downstreamInvalidated = changed && options.preserveDownstream !== true;
  if (downstreamInvalidated) storage.deleteOutputs(taskId, DOWNSTREAM_KINDS);
  return { contract, gate: inspect(taskId), model_call_count: contract.model_call_count, downstream_invalidated: downstreamInvalidated };
}

function confirm(taskId, supplied = [], actor = {}) {
  return persistConfirmation(taskId, supplied, actor);
}

function confirmSystem(taskId, supplied = [], modelMeta = {}) {
  return persistConfirmation(taskId, supplied, { id: 'system_ai' }, {
    status: 'system_confirmed',
    requireExact: true,
    model_call_count: 1,
    planning_model: modelMeta.used_model || '',
  });
}

function repairSystem(taskId, supplied = [], repairMeta = {}) {
  return persistConfirmation(taskId, supplied, { id: clean(repairMeta.repaired_by || 'system_zero_cost_repair', 120) }, {
    status: 'system_confirmed', requireExact: true,
    model_call_count: 0,
    planning_model: clean(repairMeta.reason || 'deterministic_narrative_order_repair', 180),
    preserveDownstream: true,
  });
}

function rebindSystemAuthority(taskId) {
  const stored = storage.getOutput(taskId, OUTPUT_KIND) || {};
  const base = draft(taskId);
  if (stored.status !== 'system_confirmed' || stored.blueprint_fingerprint !== base.blueprint_fingerprint) {
    throw Object.assign(new Error('只有剧本未变化的系统确认绑定合同才能零模型升级权威指纹'), {
      code: 'STORY_FLOW_AUTHORITY_REBIND_BLOCKED', status: 409, retryable: false,
    });
  }
  return persistConfirmation(taskId, stored.units, { id: 'system_authority_rebind' }, {
    status: 'system_confirmed', requireExact: true,
    model_call_count: Number(stored.model_call_count || 0),
    planning_model: stored.planning_model || '',
    preserveDownstream: true,
  });
}

function inspect(taskId) {
  let base;
  try { base = draft(taskId); } catch (error) {
    return {
      ready: false, total: 0, confirmed: 0, code: error.code || 'STORY_FLOW_NOT_READY',
      reason: clean(error.message || '请先完成剧情、人物和场景。', 300),
    };
  }
  const stored = storage.getOutput(taskId, OUTPUT_KIND) || {};
  const fresh = Number(stored.contract_version || 0) === CONTRACT_VERSION
    && stored.blueprint_fingerprint === base.blueprint_fingerprint
    && stored.authority_fingerprint === base.authority_fingerprint;
  const complete = list(stored.units).length === base.units.length
    && list(stored.units).every(unit => !base.scenes.length || stableId(unit.scene_id));
  const ready = fresh && complete && ['confirmed', 'system_confirmed'].includes(stored.status);
  return {
    ready,
    total: base.units.length,
    confirmed: ready ? base.units.length : 0,
    blueprint_fingerprint: base.blueprint_fingerprint,
    authority_fingerprint: base.authority_fingerprint,
    contract_fingerprint: clean(stored.contract_fingerprint, 220),
    reason: ready
      ? '剧情流向及人物、场景绑定已确认，可以生成正式人物场景分镜。'
      : (fresh && stored.status === 'draft' ? '系统尚未完成剧情节点的人物与场景绑定。' : '剧情或人物场景资产已变化，系统需要重新绑定后再生成分镜。'),
  };
}

function assertReady(taskId) {
  const state = inspect(taskId);
  if (state.ready) return { ...state, contract: storage.getOutput(taskId, OUTPUT_KIND) };
  throw Object.assign(new Error(state.reason), {
    code: 'STORY_FLOW_CONFIRMATION_REQUIRED', status: 409, retryable: false, story_flow_gate: state,
  });
}

module.exports = {
  CONTRACT_VERSION, DOWNSTREAM_KINDS, OUTPUT_KIND, assertReady, authoritySnapshot, confirm, confirmSystem, declaredSceneSequence, draft, inspect, plannedScenesForBeats, rebindSystemAuthority, repairSystem, validateUnits,
};
