const continuityGate = require('./storyboardContinuityGateService');
const transitionPerformance = require('./transitionPerformanceContractService');

const ALLOWED_SECTIONS = new Set(['overview', 'people', 'scenes', 'story', 'shots', 'candidates', 'continuity']);
const DEFAULT_SHOT_LIMIT = 12;
const MAX_SHOT_LIMIT = 20;
const MAX_CANDIDATE_LIMIT = 3;

function clean(value = '', max = 320) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

function list(value, maxItems = 12, maxText = 220) {
  const source = Array.isArray(value)
    ? value
    : (value === undefined || value === null || value === '' ? [] : [value]);
  return source
    .map(item => clean(typeof item === 'object' ? (item.label || item.name || item.content || item.text || '') : item, maxText))
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index)
    .slice(0, maxItems);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function profileText(values = [], max = 360) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return clean(value, max);
    const row = object(value);
    const nested = row.userPrompt || row.description || row.text || row.value || '';
    if (typeof nested === 'string' && nested.trim()) return clean(nested, max);
  }
  return '';
}

function outputMap(outputs = {}) {
  if (Array.isArray(outputs)) {
    return Object.fromEntries(outputs.map(row => [String(row?.kind || ''), row?.payload]).filter(([kind]) => kind));
  }
  return object(outputs);
}

function mediaUrl(value = '') {
  const url = clean(value, 1200);
  return url && !/^data:/i.test(url) ? url : '';
}

function imageFrom(value = {}) {
  const source = object(value);
  return mediaUrl(source.thumbnail_url || source.thumbnailUrl || source.image_url || source.imageUrl || source.url);
}

function viewMedia(rows = [], limit = 8) {
  return (Array.isArray(rows) ? rows : [])
    .map((item, index) => ({
      id: clean(item?.id || item?.key || item?.view || `view_${index + 1}`, 100),
      label: clean(item?.label || item?.name || item?.key || item?.view || `参考 ${index + 1}`, 80),
      image_url: imageFrom(item),
    }))
    .filter(item => item.image_url)
    .slice(0, limit);
}

function requestedSections(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const sections = source.map(item => clean(item, 40).toLowerCase()).filter(item => ALLOWED_SECTIONS.has(item));
  return new Set(sections.length ? sections : ['overview']);
}

function characterRows(ctx = {}, blueprint = {}) {
  const rows = Array.isArray(blueprint.characters) && blueprint.characters.length
    ? blueprint.characters
    : (Array.isArray(ctx.cast_profiles) && ctx.cast_profiles.length
      ? ctx.cast_profiles
      : (Array.isArray(ctx.characters) ? ctx.characters : []));
  return rows.slice(0, 12);
}

function peopleProjection(ctx = {}, blueprint = {}, personProduction = {}) {
  const personAsset = object(ctx.person_asset);
  const castAssets = Array.isArray(personAsset.cast_assets) ? personAsset.cast_assets : [];
  const dossier = object(personProduction.dossier);
  const actionAssets = Array.isArray(personProduction.action_assets) ? personProduction.action_assets : [];
  const characters = characterRows(ctx, blueprint);
  const baseViews = [
    ...viewMedia(personAsset.view_images, 12),
    ...viewMedia(dossier.atomic_assets, 20),
  ];
  const completenessChecks = [
    { key: 'identity', label: '身份锚点', pass: !!(personAsset.image_url || baseViews.length), detail: personAsset.image_url || baseViews.length ? '已有主参考或身份视角' : '缺少主参考与身份视角' },
    { key: 'full_body', label: '完整体态', pass: baseViews.some(view => /body|front|全身|正面/i.test(`${view.id} ${view.label}`)), detail: '需能核对头身比例与鞋履' },
    { key: 'wardrobe', label: '服装细节', pass: Array.isArray(dossier.atomic_assets) && dossier.atomic_assets.some(item => /wardrobe|detail|服装|妆造/i.test(`${item?.kind} ${item?.label}`)), detail: '需覆盖服装、材质或配饰细节' },
    { key: 'expressions', label: '表情范围', pass: Array.isArray(dossier.expressions) && dossier.expressions.length > 0, detail: '需覆盖剧情所需表情变化' },
    { key: 'action', label: '动作连续性', pass: actionAssets.length > 0, detail: '剧情生成后按镜头形成动作前后状态' },
  ];
  const completed = completenessChecks.filter(item => item.pass).length;
  return {
    status: clean(dossier.status || (personAsset.image_url ? 'asset_ready' : (characters.length ? 'profile_ready' : 'not_required')), 40),
    dossier_revision: Math.max(0, Number(dossier.revision || personAsset.person_revision || 0) || 0),
    characters: characters.map((character, index) => {
      const name = clean(character?.name || character?.displayName || character?.roleName || `人物 ${index + 1}`, 100);
      const castAsset = castAssets[index] || castAssets.find(item => clean(item?.name, 100) === name) || {};
      return {
        id: clean(character?.id || castAsset.id || `character_${index + 1}`, 100),
        name,
        role: clean(character?.role || character?.roleName || castAsset.cast_role || '', 120),
        profile: profileText([character?.description, character?.appearanceText, character?.appearance], 360),
        wardrobe: profileText([character?.clothing, character?.wardrobeText, character?.wardrobe], 320),
        personality: clean(character?.personality || character?.temperament || '', 220),
        story_function: clean(character?.story_function || character?.storyFunction || character?.role || '', 220),
        image_url: imageFrom(castAsset) || (index === 0 ? imageFrom(personAsset) : ''),
      };
    }),
    identity_views: baseViews.slice(0, 20),
    expression_count: Array.isArray(dossier.expressions) ? dossier.expressions.length : 0,
    wardrobe_detail_count: Array.isArray(dossier.atomic_assets)
      ? dossier.atomic_assets.filter(item => item?.kind === 'wardrobe' || item?.kind === 'detail').length
      : 0,
    completeness: {
      score: Math.round((completed / completenessChecks.length) * 100),
      completed,
      total: completenessChecks.length,
      checks: completenessChecks,
      missing: completenessChecks.filter(item => !item.pass).map(item => item.label),
    },
    action_pack: actionAssets.slice(0, 30).map((asset, index) => ({
      id: clean(asset?.id || `action_${index + 1}`, 100),
      shot_index: Math.max(1, Number(asset?.contract?.shot_index ?? index) + (Number(asset?.contract?.shot_index ?? index) === 0 ? 1 : 0)),
      start_pose: clean(asset?.contract?.start_pose, 220),
      key_action: clean(asset?.contract?.key_action, 260),
      end_pose: clean(asset?.contract?.end_pose, 220),
      hand_contact: clean(asset?.contract?.prop_contact, 220),
      eyeline: clean(asset?.contract?.eyeline, 160),
      expression_change: clean(asset?.contract?.expression_change, 180),
      image_url: imageFrom(asset),
      status: clean(asset?.status || 'pending_approval', 40),
    })),
  };
}

function shotSceneStates(shots = [], sceneId = '') {
  return (Array.isArray(shots) ? shots : [])
    .filter(shot => !sceneId || clean(shot?.scene_id || shot?.scene_asset_id, 120) === sceneId)
    .map((shot, index) => {
      const temporal = object(shot?.temporal_state?.shot_state || shot?.temporal_state || shot?.temporal_evidence?.shot_state);
      return {
        shot_index: Math.max(1, Number(shot?.index || shot?.shot_index || index + 1) || index + 1),
        label: clean(shot?.title || `第 ${index + 1} 镜`, 100),
        state_before: list(temporal.state_before || shot?.entry_frame_state, 8, 220),
        visible_change: list(temporal.intended_changes || shot?.intended_changes || shot?.action, 8, 220),
        state_after: list(temporal.state_after || shot?.exit_frame_state || shot?.action_end, 8, 220),
      };
    })
    .filter(row => row.state_before.length || row.visible_change.length || row.state_after.length)
    .slice(0, 20);
}

function authoredSceneStates(spec = {}) {
  const rows = spec.storyStates || spec.story_states || spec.stateTimeline || spec.state_timeline;
  return (Array.isArray(rows) ? rows : []).slice(0, 20).map((state, index) => ({
    id: clean(state?.id || `state_${index + 1}`, 100),
    label: clean(state?.label || state?.name || `状态 ${index + 1}`, 100),
    state_before: list(state?.state_before || state?.before, 8, 220),
    visible_change: list(state?.visible_change || state?.change || state?.trigger, 8, 220),
    state_after: list(state?.state_after || state?.after, 8, 220),
    shot_refs: list(state?.shot_refs || state?.shots, 20, 40),
  }));
}

function scenesProjection(sceneConfig = {}, sceneAssets = [], shots = []) {
  const spaces = Array.isArray(sceneConfig.spaces) ? sceneConfig.spaces : [];
  const assets = Array.isArray(sceneAssets) ? sceneAssets : [];
  const source = spaces.length ? spaces : assets.map((asset, index) => ({
    id: asset?.scene_id || asset?.id || `scene_${index + 1}`,
    name: asset?.name,
    description: asset?.layout_summary,
    story_purpose: asset?.story_purpose,
    scene_spec: {},
  }));
  return source.slice(0, 12).map((space, index) => {
    const sceneId = clean(space?.id || space?.scene_id || `scene_${index + 1}`, 100);
    const asset = assets.find(item => clean(item?.scene_id || item?.id, 100) === sceneId) || assets[index] || {};
    const contract = object(asset.scene_contract);
    const spec = object(space?.scene_spec || space?.sceneSpec);
    const authoredStates = authoredSceneStates(spec);
    return {
      id: sceneId,
      name: clean(space?.name || asset?.name || `场景 ${index + 1}`, 120),
      story_purpose: clean(space?.story_purpose || space?.purpose || asset?.story_purpose || '', 300),
      description: clean(space?.description || spec.layoutText || asset?.layout_summary || '', 480),
      material_light: clean(spec.materialLightText || asset?.material_summary || asset?.style_summary || '', 420),
      interaction: clean(spec.interactionText || '', 360),
      forbidden: clean(spec.negativeText || asset?.negative || '', 360),
      views: viewMedia(asset?.view_images, 8),
      zones: (Array.isArray(contract.zones) ? contract.zones : []).slice(0, 16).map(zone => ({
        id: clean(zone?.id, 100),
        label: clean(zone?.label_zh || zone?.label, 120),
        purpose: clean(zone?.purpose, 220),
      })),
      routes: (Array.isArray(spec.routes) ? spec.routes : []).slice(0, 12).map((route, routeIndex) => ({
        id: clean(route?.id || `route_${routeIndex + 1}`, 100),
        label: clean(route?.label || route?.name || `路线 ${routeIndex + 1}`, 100),
        from: clean(route?.from, 120),
        to: clean(route?.to, 120),
        actor: clean(route?.actor, 120),
        continuity: clean(route?.continuity || route?.rule, 220),
      })),
      state_timeline: authoredStates.length ? authoredStates : shotSceneStates(shots, sceneId),
      verification_status: clean(contract.status || asset?.status || (asset?.image_url ? 'generated' : 'not_generated'), 40),
    };
  });
}

function storyProjection(blueprint = {}) {
  const narrative = object(blueprint.narrative_contract);
  const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
  return {
    title: clean(blueprint.story_title || blueprint.title, 160),
    logline: clean(blueprint.logline || blueprint.story_summary || blueprint.summary, 420),
    arc: {
      setup: clean(narrative.setup, 300),
      trigger: clean(narrative.trigger, 300),
      progression: clean(narrative.progression, 360),
      result: clean(narrative.result, 300),
      closure: clean(narrative.closure || blueprint.call_to_action || blueprint.cta, 240),
    },
    beats: beats.slice(0, 30).map((beat, index) => ({
      index: Math.max(1, Number(beat?.index || index + 1) || index + 1),
      title: clean(beat?.title || beat?.role || `剧情节点 ${index + 1}`, 120),
      narrative_function: clean(beat?.causal_role || beat?.role, 80),
      plot: clean(beat?.plot || beat?.story_visual || beat?.promo_visual, 420),
      action: clean(beat?.action || beat?.solution_step, 280),
      emotional_turn: clean(beat?.emotional_turn || beat?.emotion, 180),
      state_before: list(beat?.state_before, 8, 220),
      state_after: list(beat?.state_after, 8, 220),
      visible_evidence: list(beat?.visible_evidence || beat?.visual_proof, 8, 240),
      spoken_line: clean(beat?.spoken_line || beat?.voiceover, 260),
    })),
  };
}

function keyframeAt(keyframes = [], position = 0, shot = {}) {
  return (Array.isArray(keyframes) ? keyframes : []).find((frame, index) => (
    Number(frame?.index ?? frame?.shot_index ?? index) === Number(shot?.index ?? shot?.shot_index ?? position)
  )) || (Array.isArray(keyframes) ? keyframes[position] : null) || {};
}

function clipAt(clips = [], position = 0, shot = {}) {
  return (Array.isArray(clips) ? clips : []).find((clip, index) => (
    Number(clip?.index ?? clip?.shot_index ?? index) === Number(shot?.index ?? shot?.shot_index ?? position)
  )) || (Array.isArray(clips) ? clips[position] : null) || {};
}

function lineageInputs({ ctx = {}, sceneAssets = [], shot = {}, frame = {} } = {}) {
  const sceneId = clean(shot.scene_id || shot.scene_asset_id, 100);
  const scene = (Array.isArray(sceneAssets) ? sceneAssets : [])
    .find(item => clean(item?.scene_id || item?.id, 100) === sceneId) || {};
  const person = object(ctx.person_asset);
  const product = object(ctx.product_asset);
  return [
    { kind: 'person', label: clean(person.name || '人物档案', 80), image_url: imageFrom(person) },
    { kind: 'scene', label: clean(scene.name || shot.scene_name || '场景档案', 80), image_url: imageFrom(scene) || imageFrom(scene?.view_images?.[0]) },
    { kind: 'product', label: clean(product.name || '产品/主体', 80), image_url: imageFrom(product) },
    { kind: 'keyframe', label: '已选关键帧', image_url: imageFrom(frame) },
  ].filter(item => item.image_url);
}

function shotProjection({ shot = {}, position = 0, ctx = {}, sceneAssets = [], keyframes = [], clips = [], candidateLimit = 2 } = {}) {
  const frame = keyframeAt(keyframes, position, shot);
  const clip = clipAt(clips, position, shot);
  const temporal = object(shot.temporal_state?.shot_state || shot.temporal_state || shot.temporal_evidence?.shot_state);
  const candidates = Array.isArray(frame.candidates) ? frame.candidates : [];
  const videoCandidates = Array.isArray(clip.candidates)
    ? clip.candidates
    : (Array.isArray(clip.attempts) ? clip.attempts : []);
  const actionContract = object(shot.action_contract);
  const phases = object(actionContract.phases);
  const actionPhaseCount = Object.values(phases).filter(value => clean(value, 20)).length;
  const complexAction = actionPhaseCount >= 3 || list(actionContract.participants, 12, 100).length >= 2
    || list(actionContract.props, 12, 100).length > 0 || /orbit|tracking|handheld|环绕|跟拍|手持/i.test(shot.camera_movement || '');
  const spatialComplexity = list(shot.zone_ids, 12, 80).length > 1 || list(shot.anchor_ids, 20, 80).length >= 3
    || /穿越|绕行|遮挡|楼梯|多层|追逐|打斗|交互/i.test(`${shot.action || ''} ${actionContract.spatial_relation || ''}`);
  return {
    index: Math.max(1, Number(shot.index || shot.shot_index || position + 1) || position + 1),
    title: clean(shot.title || `第 ${position + 1} 镜`, 120),
    duration: Math.max(0, Number(shot.duration || 0) || 0),
    narrative_function: clean(shot.purpose || shot.role, 260),
    visual: clean(shot.visual || shot.story_visual || shot.promo_visual, 520),
    action: clean(shot.action, 360),
    action_contract: {
      participants: list(actionContract.participants, 12, 100),
      props: list(actionContract.props, 12, 100),
      spatial_relation: clean(actionContract.spatial_relation, 360),
      camera_axis: clean(actionContract.camera_axis, 180),
      screen_direction: clean(actionContract.screen_direction, 180),
      start_pose: clean(actionContract.start_pose, 300),
      phases: Object.fromEntries(Object.entries(phases).map(([key, value]) => [key, clean(value, 300)]).filter(([, value]) => value)),
      end_pose: clean(actionContract.end_pose, 300),
      continuity_notes: clean(actionContract.continuity_notes, 500),
      phase_count: actionPhaseCount,
    },
    director_card: {
      objective: clean(shot.purpose || shot.role, 260),
      staging: clean(actionContract.spatial_relation || shot.subject_position || shot.scene_zone, 360),
      camera: clean([shot.shot_size, shot.camera_angle, shot.lens_mm ? `${shot.lens_mm}mm` : '', shot.camera_movement].filter(Boolean).join(' · '), 260),
      performance: clean([actionContract.start_pose, ...Object.values(phases), actionContract.end_pose].filter(Boolean).join(' → ') || shot.action, 700),
      continuity: clean(actionContract.continuity_notes || [shot.entry_frame_state, shot.exit_frame_state].filter(Boolean).join(' → '), 500),
      evidence: list(temporal.evidence_requirements || shot.keyframe_notes, 10, 240),
    },
    previs_3d: {
      recommended: complexAction || spatialComplexity,
      level: spatialComplexity ? 'structured_3d' : (complexAction ? 'camera_blocking' : 'not_required'),
      reasons: [complexAction ? '动作/机位编排复杂' : '', spatialComplexity ? '存在空间路径、遮挡或多锚点验证需求' : ''].filter(Boolean),
      capability_boundary: '结构化3D导演预演用于机位、路径与遮挡验证，不等于真实6DoF或最终画面生成。',
    },
    expression: clean(transitionPerformance.microExpressionPrompt(
      shot.micro_expression || shot.expression_change || { label: shot.emotional_turn || shot.emotion || '' },
    ), 700),
    scene: {
      id: clean(shot.scene_id || shot.scene_asset_id, 100),
      name: clean(shot.scene_name || shot.scene_zone_label_zh || shot.scene_zone, 140),
      zone: clean(shot.scene_zone_label_zh || shot.scene_zone, 140),
    },
    state_before: list(temporal.state_before || shot.entry_frame_state, 10, 220),
    visible_change: list(temporal.intended_changes || shot.intended_changes || shot.action, 10, 240),
    state_after: list(temporal.state_after || shot.exit_frame_state || shot.action_end, 10, 220),
    evidence: list(temporal.evidence_requirements || shot.keyframe_notes, 10, 240),
    voiceover: clean(shot.voiceover || shot.spoken_line, 320),
    dialogue: (Array.isArray(shot.dialogue_lines) ? shot.dialogue_lines : []).slice(0, 8).map(line => ({
      speaker: clean(line?.speaker, 100),
      text: clean(line?.text || line?.line, 260),
    })).filter(line => line.speaker || line.text),
    keyframe: {
      image_url: imageFrom(frame),
      status: clean(frame.qa_status || frame.status || (imageFrom(frame) ? 'generated' : 'not_generated'), 40),
      candidates: candidates.slice(0, candidateLimit).map((candidate, index) => ({
        id: clean(candidate?.id || `image_candidate_${index + 1}`, 100),
        image_url: imageFrom(candidate),
        status: clean(candidate?.qa_status || candidate?.status || '', 40),
        selected: candidate?.selected === true || clean(frame.selected_candidate_id, 100) === clean(candidate?.id, 100),
      })).filter(candidate => candidate.image_url),
    },
    video: {
      video_url: mediaUrl(clip.video_url || clip.videoUrl || clip.url),
      status: clean(clip.qa_status || clip.status || clip.lifecycle || '', 40),
      candidates: videoCandidates.slice(0, candidateLimit).map((candidate, index) => ({
        id: clean(candidate?.id || candidate?.generation_id || `video_candidate_${index + 1}`, 100),
        video_url: mediaUrl(candidate?.video_url || candidate?.videoUrl || candidate?.url),
        status: clean(candidate?.qa_status || candidate?.status || candidate?.lifecycle || '', 40),
        selected: candidate?.selected === true || clean(clip.selected_candidate_id, 100) === clean(candidate?.id, 100),
      })).filter(candidate => candidate.video_url || candidate.status),
    },
    lineage_inputs: lineageInputs({ ctx, sceneAssets, shot, frame }),
  };
}

function continuityProjection(shots = [], contracts = []) {
  const continuity = continuityGate.reviewContinuity({ shots, contracts });
  const incomplete = (Array.isArray(shots) ? shots : []).map((shot, index) => {
    const temporal = object(shot?.temporal_state?.shot_state || shot?.temporal_state || shot?.temporal_evidence?.shot_state);
    const missing = [];
    if (!clean(shot?.action, 500)) missing.push('action');
    if (!list(temporal.state_before || shot?.entry_frame_state, 2, 200).length) missing.push('state_before');
    if (!list(temporal.state_after || shot?.exit_frame_state || shot?.action_end, 2, 200).length) missing.push('state_after');
    if (!list(temporal.evidence_requirements || shot?.keyframe_notes, 2, 200).length) missing.push('evidence');
    return missing.length ? { shot_index: index + 1, missing } : null;
  }).filter(Boolean);
  return {
    pass: continuity.pass && incomplete.length === 0,
    boundary_pass: continuity.pass,
    checked_boundaries: continuity.checked_boundaries,
    issues: list(continuity.issues, 30, 320),
    incomplete_shots: incomplete.slice(0, 30),
  };
}

function createDirectorWorkspace({
  task = {},
  outputs = {},
  personProduction = {},
} = {}, {
  sections: sectionInput = 'overview',
  shotOffset = 0,
  shotLimit = DEFAULT_SHOT_LIMIT,
  candidateLimit = 2,
} = {}) {
  const map = outputMap(outputs);
  const ctx = object(map.context || task.request);
  const blueprint = object(map.blueprint);
  const sceneConfig = object(map.scene_config || ctx.scene_plan);
  const sceneAssets = Array.isArray(map.scene_assets) ? map.scene_assets : [];
  const shots = Array.isArray(map.storyboard_table) ? map.storyboard_table : [];
  const contracts = Array.isArray(map.keyframe_contracts) ? map.keyframe_contracts : [];
  const keyframes = Array.isArray(map.keyframes) ? map.keyframes : [];
  const clips = Array.isArray(map.video_clips) ? map.video_clips : [];
  const sections = requestedSections(sectionInput);
  const offset = Math.max(0, Number(shotOffset) || 0);
  const limit = Math.max(1, Math.min(MAX_SHOT_LIMIT, Number(shotLimit) || DEFAULT_SHOT_LIMIT));
  const candidates = Math.max(1, Math.min(MAX_CANDIDATE_LIMIT, Number(candidateLimit) || 2));
  const response = {
    schema_version: 'director-workspace-v1',
    task: {
      id: clean(task.id, 100),
      title: clean(task.title || blueprint.story_title || ctx.product_subject, 180),
      stage: clean(task.stage, 60),
      status: clean(task.status, 40),
      updated_at: task.updated_at || '',
      content_revision: Math.max(1, Number(task.content_revision || 1) || 1),
    },
    pagination: {
      shot_offset: offset,
      shot_limit: limit,
      shot_total: shots.length,
      has_more_shots: offset + limit < shots.length,
      next_shot_offset: offset + limit < shots.length ? offset + limit : null,
      candidate_limit: candidates,
    },
  };
  if (sections.has('overview')) {
    response.overview = {
      brief: clean(ctx.brief || task.brief, 700),
      advertised_subject: clean(ctx.product_subject || blueprint.advertised_subject, 180),
      target_duration: Math.max(0, Number(ctx.target_duration || blueprint.total_duration || 0) || 0),
      ratio: clean(ctx.output_ratio || '9:16', 20),
      people_count: characterRows(ctx, blueprint).length,
      scene_count: Math.max(sceneConfig.spaces?.length || 0, sceneAssets.length),
      beat_count: Array.isArray(blueprint.beats) ? blueprint.beats.length : 0,
      shot_count: shots.length,
      generated_keyframe_count: keyframes.filter(item => imageFrom(item)).length,
      generated_video_count: clips.filter(item => mediaUrl(item?.video_url || item?.videoUrl || item?.url)).length,
    };
  }
  if (sections.has('people')) response.people = peopleProjection(ctx, blueprint, personProduction);
  if (sections.has('scenes')) response.scenes = scenesProjection(sceneConfig, sceneAssets, shots);
  if (sections.has('story')) response.story = storyProjection(blueprint);
  if (sections.has('shots') || sections.has('candidates')) {
    const page = shots.slice(offset, offset + limit).map((shot, pageIndex) => shotProjection({
      shot,
      position: offset + pageIndex,
      ctx,
      sceneAssets,
      keyframes,
      clips,
      candidateLimit: candidates,
    }));
    if (sections.has('shots')) response.shots = page;
    if (sections.has('candidates')) {
      response.candidates = page.map(shot => ({
        shot_index: shot.index,
        title: shot.title,
        lineage_inputs: shot.lineage_inputs,
        keyframe: shot.keyframe,
        video: shot.video,
      }));
    }
  }
  if (sections.has('continuity')) response.continuity = continuityProjection(shots, contracts);
  response.payload_bytes = Buffer.byteLength(JSON.stringify(response));
  return response;
}

module.exports = {
  ALLOWED_SECTIONS,
  DEFAULT_SHOT_LIMIT,
  MAX_SHOT_LIMIT,
  MAX_CANDIDATE_LIMIT,
  createDirectorWorkspace,
  _private: {
    outputMap,
    requestedSections,
    peopleProjection,
    scenesProjection,
    storyProjection,
    shotProjection,
    continuityProjection,
  },
};
