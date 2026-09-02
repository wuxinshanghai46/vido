const storyboardTable = require('./storyboardTableService');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function failure(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function currentCharacters(context = {}) {
  const rows = Array.isArray(context.cast_profiles) ? context.cast_profiles : [];
  return rows.map((profile, index) => ({
    ...clone(profile),
    id: profile.source_character_id || profile.id || `character_${index + 1}`,
    name: profile.name || profile.displayName || `角色${index + 1}`,
    role: profile.role || profile.roleName || '',
    age_range: profile.age_contract?.display_text || profile.age_range || profile.age || '',
    age: profile.age_contract?.display_text || profile.age || profile.age_range || '',
  }));
}

function patchBlueprintCharacters(blueprint = {}, context = {}) {
  const current = currentCharacters(context);
  if (!current.length) return clone(blueprint);
  const byId = new Map(current.map(item => [clean(item.id), item]));
  const byName = new Map(current.map(item => [clean(item.name), item]));
  const historical = Array.isArray(blueprint.characters) ? blueprint.characters : [];
  const projected = historical.map((character, index) => {
    const authoritative = byId.get(clean(character.id)) || byName.get(clean(character.name)) || current[index];
    if (!authoritative) return clone(character);
    const age = authoritative.age_range || authoritative.age || '';
    return {
      ...clone(character),
      id: authoritative.id,
      name: authoritative.name,
      role: authoritative.role || character.role || '',
      gender: authoritative.gender || character.gender || 'unspecified',
      ...(age ? { age, age_range: age, age_source: authoritative.age_source || 'confirmed_current_cast' } : {}),
    };
  });
  current.forEach(character => {
    if (!projected.some(item => clean(item.id) === clean(character.id))) projected.push(clone(character));
  });
  return { ...clone(blueprint), characters: projected };
}

function spokenText(shot = {}) {
  const dialogue = Array.isArray(shot.dialogue)
    ? shot.dialogue.map(line => line?.line || line?.text || '').filter(Boolean).join(' ')
    : '';
  return clean(shot.blueprint_spoken_line || shot.voiceover || shot.narration || shot.ad_copy || shot.subtitle || dialogue);
}

function trackText(track = {}) {
  return clean(track.text || track.voiceover || track.narration || track.line || track.content);
}

function tracksFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.tracks) ? payload.tracks : [];
}

function stripHistoricalContinuity(shots = []) {
  const staleFields = [
    'continuity', 'continuity_from', 'continuityFrom', 'entry_frame_state', 'entryFrameState',
    'exit_frame_state', 'exitFrameState', 'action_start', 'actionStart', 'action_end', 'actionEnd',
    'requires_previous_frame', 'requiresPreviousFrame', 'same_scene_as_previous',
    'transition_type', 'transitionType', 'transition', 'transition_reason', 'transitionReason',
    'transition_source', 'transitionSource', 'transition_recommendation', 'transition_match_anchor',
    'transitionMatchAnchor', 'transition_duration_sec', 'transitionDurationSec', 'boundary_mode',
    'camera_axis', 'cameraAxis', 'screen_direction', 'screenDirection', 'eyeline', 'eyeLine',
  ];
  return shots.map(source => {
    const shot = clone(source);
    staleFields.forEach(field => { delete shot[field]; });
    if (shot.temporal_state && typeof shot.temporal_state === 'object') {
      shot.temporal_state = { ...shot.temporal_state, continuity_links: [] };
    }
    if (shot.temporal_evidence?.shot_state && typeof shot.temporal_evidence.shot_state === 'object') {
      shot.temporal_evidence = {
        ...shot.temporal_evidence,
        shot_state: { ...shot.temporal_evidence.shot_state, continuity_links: [] },
      };
    }
    return shot;
  });
}

function compileSceneTransitionReasons(shots = [], scenes = []) {
  const names = new Map((Array.isArray(scenes) ? scenes : []).map((scene, index) => [
    clean(scene.scene_id || scene.id),
    clean(scene.name || scene.title || `场景${index + 1}`),
  ]));
  let previousSceneId = '';
  return shots.map((source, index) => {
    const shot = clone(source);
    const sceneId = clean(shot.scene_id || shot.sceneId || shot.scene_asset_id || shot.sceneAssetId);
    if (index > 0 && previousSceneId && sceneId && sceneId !== previousSceneId) {
      const from = names.get(previousSceneId) || previousSceneId;
      const to = names.get(sceneId) || sceneId;
      shot.transition_reason = `剧情从“${from}”切换到“${to}”，进入下一段已确认的镜头内容。`;
    }
    previousSceneId = sceneId || previousSceneId;
    return shot;
  });
}

function audioCompatibility(shots = [], tracks = []) {
  const byShot = new Map(tracks.map(track => [clean(track.shot_id || track.shotId), track]));
  const issues = [];
  for (const shot of shots) {
    const shotId = clean(shot.id || shot.shot_id || shot.shotId);
    const track = byShot.get(shotId);
    if (!shotId) issues.push('shot_without_id');
    else if (!track) issues.push(`missing_track:${shotId}`);
    else if (!clean(track.url || track.audio_url || track.audioUrl)) issues.push(`missing_audio_url:${shotId}`);
    else if (spokenText(shot) !== trackText(track)) issues.push(`spoken_text_mismatch:${shotId}`);
  }
  if (tracks.length !== shots.length) issues.push(`count_mismatch:${tracks.length}/${shots.length}`);
  return { compatible: issues.length === 0, issues };
}

function buildRecovery({ currentWork = {}, historicalWork = {} } = {}) {
  const currentDomains = currentWork.domain_payloads || {};
  const historicalDomains = historicalWork.domain_payloads || {};
  const context = clone(currentWork.context || currentWork.brief?.context || currentDomains.brief?.context || {});
  const scenes = clone(currentWork.scene_assets || currentWork.scenes?.scene_assets || currentDomains.scenes?.assets || []);
  const historicalBlueprint = historicalWork.blueprint || historicalDomains.blueprint;
  const historicalShots = historicalWork.storyboard_table || historicalWork.storyboard?.storyboard_table
    || historicalDomains.storyboard || [];
  const historicalTts = historicalWork.tts_audio || historicalWork.audio?.tts_audio
    || historicalDomains.audio?.tts_audio || [];
  const historicalTracks = tracksFrom(historicalTts);
  if (!historicalBlueprint || typeof historicalBlueprint !== 'object') {
    throw failure('RECOVERY_BLUEPRINT_MISSING', '历史版本缺少可恢复的剧本蓝图');
  }
  if (!Array.isArray(historicalShots) || !historicalShots.length) {
    throw failure('RECOVERY_STORYBOARD_MISSING', '历史版本缺少可恢复的分镜');
  }
  if (!Array.isArray(historicalTracks) || !historicalTracks.length) {
    throw failure('RECOVERY_AUDIO_MISSING', '历史版本缺少可恢复的配音');
  }

  const blueprint = patchBlueprintCharacters(historicalBlueprint, context);
  const characters = currentCharacters(context);
  const storyboard = storyboardTable.normalizeShots(
    compileSceneTransitionReasons(stripHistoricalContinuity(historicalShots), scenes), {
    ...context,
    characters,
    scene_assets: scenes,
    },
  );
  const compatibility = audioCompatibility(storyboard, historicalTracks);
  if (!compatibility.compatible) {
    throw failure('RECOVERY_AUDIO_INCOMPATIBLE', '历史配音与恢复后的分镜不完全一致，禁止复用', compatibility);
  }

  return {
    context: {
      ...context,
      asset_confirmed: true,
      scene_confirmed: scenes.length > 0,
      shot_confirmed: true,
      shot_design_confirmed: true,
    },
    blueprint,
    storyboard_table: storyboard,
    tts_audio: clone(Array.isArray(historicalTts) ? historicalTracks : historicalTts),
    sound_journey: clone(historicalWork.sound_journey || historicalWork.audio?.sound_journey
      || historicalDomains.audio?.sound_journey || []),
    invalidated_domains: ['keyframes', 'video', 'compose'],
    task_patch: {
      status: 'working',
      stage: 'tts_ready',
      active_generation_request_id: null,
      active_generation_operation: null,
      active_generation_started_at: null,
    },
    diagnostics: {
      restored_shots: storyboard.length,
      restored_tracks: historicalTracks.length,
      current_people: characters.length,
      current_scenes: scenes.length,
      reused_visual_outputs: 0,
    },
  };
}

module.exports = {
  audioCompatibility,
  buildRecovery,
  compileSceneTransitionReasons,
  currentCharacters,
  patchBlueprintCharacters,
  spokenText,
  stripHistoricalContinuity,
  trackText,
  tracksFrom,
};
