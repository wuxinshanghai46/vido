const crypto = require('crypto');
const storage = require('./storageService');
const productionBoard = require('./productionBoardContractService');
const personLooks = require('./personLookProfileService');
const propTimelines = require('./propTimelineService');

const SCHEMA_VERSION = 1;
const CONTRACT_VERSION = 'production-graph-v1';
const OUTPUT_KIND = 'production_graph_v1';
const AUTHORITY = 'production_graph_v1';
const MULTI_VIEW_MODE = 'multi_view';
const PANORAMA_MODE = 'panorama_3dof';

function clean(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

function rows(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }

function normalizeSpatialMode(value = '') {
  const mode = clean(value, 60).toLowerCase();
  return ['panorama_3dof', 'panorama_360'].includes(mode) ? PANORAMA_MODE : MULTI_VIEW_MODE;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    if (!['compiled_at', 'updated_at', 'created_at', 'fingerprint', 'validation'].includes(key)) out[key] = canonical(value[key]);
    return out;
  }, {});
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function stableId(kind, ...parts) {
  return productionBoard.stableId(kind, parts.map(value => clean(value, 2000)).join('|'));
}

function sourceMap(taskId) {
  const task = storage.getTask(taskId);
  if (!task) { const error = new Error('任务不存在'); error.code = 'TASK_NOT_FOUND'; throw error; }
  const output = kind => storage.getOutput(taskId, kind);
  return {
    task,
    context: output('context') || task.request || {},
    blueprint: output('blueprint') || {},
    asset_plan_active: output('asset_plan_active') || null,
    scene_config: output('scene_config') || {},
    scene_assets: rows(output('scene_assets')),
    prop_assets: rows(output('prop_assets')),
    storyboard: rows(output('storyboard_table')),
    keyframe_contracts: rows(output('keyframe_contracts')),
    spatial_contract: output('production_spatial_contract') || null,
  };
}

function castAssetFor(profile = {}, index = 0, ctx = {}) {
  const assets = rows(ctx.person_asset?.cast_assets);
  const profileId = clean(profile.id || profile.identity_id, 160);
  const actorIds = [profile.actor_asset_id, profile.actor_id, profile.subject_id, profileId].map(value => clean(value, 160)).filter(Boolean);
  const profileName = clean(profile.displayName || profile.name, 160);
  const memberIndexes = assets.map(asset => Number(asset.cast_member_index)).filter(Number.isFinite);
  const oneBasedIndexes = memberIndexes.length > 0 && !memberIndexes.includes(0) && Math.min(...memberIndexes) >= 1;
  const expectedMemberIndex = oneBasedIndexes ? index + 1 : index;
  return assets.find(asset => [asset.subject_id, asset.identity_id, asset.profile_id, asset.actor_asset_id, asset.actor_id, asset.id]
    .some(value => actorIds.includes(clean(value, 160))))
    || assets.find(asset => profileName && clean(asset.displayName || asset.name, 160) === profileName)
    || assets.find(asset => Number(asset.cast_member_index) === expectedMemberIndex)
    || (assets.length === 1 ? assets[0] : null);
}

function ownedProps(profile = {}, characterId = '') {
  return rows(profile.owned_props || profile.props).map((prop, index) => {
    const type = clean(prop.type || prop.kind || 'handheld', 40).toLowerCase();
    const bag = /bag|包|箱|case|briefcase/.test(`${type} ${prop.name || ''}`.toLowerCase());
    const wearable = /wearable|accessory|jewelry|饰品|首饰|眼镜|帽|围巾/.test(`${type} ${prop.name || ''}`.toLowerCase());
    const attachmentMode = wearable ? 'worn' : (type === 'fixed_scene_object' ? 'placed' : 'carried');
    return {
      id: clean(prop.id, 160) || stableId('prop', characterId, index, prop.name),
      name: clean(prop.name || `随身物件${index + 1}`, 160),
      kind: wearable ? 'wearable' : (bag ? 'carry_bag' : type),
      attachment_mode: attachmentMode,
      owner_character_id: characterId,
      default_slot: clean(prop.slot || (wearable ? 'body' : (bag ? 'hand_or_shoulder' : 'hand')), 80),
      default_hand: clean(prop.hand || 'unspecified', 30),
      description: clean(prop.description || prop.appearance || '', 900),
      material: clean(prop.material || '', 180),
      scale: clean(prop.scale || '', 120),
      quantity: Math.max(1, Number(prop.quantity || 1) || 1),
      image_url: clean(prop.image_url || prop.url || '', 1600),
      source: 'character_profile',
    };
  });
}

function buildCharacters(ctx = {}, taskId = '') {
  return rows(ctx.cast_profiles).map((profile, index) => {
    const id = clean(profile.id || profile.identity_id, 160) || stableId('character', taskId, index, profile.displayName);
    const asset = castAssetFor(profile, index, ctx) || {};
    const nativeMasters = asset.native_masters || asset.dossier?.native_masters || {};
    const expressions = rows(asset.expressions || asset.dossier?.expressions);
    const actions = rows(asset.base_actions || asset.dossier?.base_actions);
    const looks = rows(profile.look_profiles).map((look, lookIndex) => ({
      id: clean(look.id, 160) || stableId('look', id, lookIndex, look.name),
      character_id: id,
      name: clean(look.name || `造型 ${lookIndex + 1}`, 160),
      story_state: clean(look.story_state || '', 500),
      scene_ids: rows(look.scene_ids).map(value => clean(value, 160)),
      wardrobe: clean(look.wardrobeText || profile.wardrobeText || '', 2400),
      hair_makeup: clean(look.hairMakeupText || profile.hairMakeupText || '', 1800),
      negative: clean(look.negativeText || profile.negativeText || '', 1200),
      dossier_sheet_url: clean(look.dossier_sheet?.image_url || look.image_url || '', 1600),
    }));
    const fallbackLooks = looks.length ? looks : [{
      id: stableId('look', id, 'base'), character_id: id, name: '基础造型', story_state: '', scene_ids: [],
      wardrobe: clean(profile.wardrobeText || '', 2400), hair_makeup: clean(profile.hairMakeupText || '', 1800),
      negative: clean(profile.negativeText || '', 1200), dossier_sheet_url: '',
    }];
    return {
      id,
      identity: {
        display_name: clean(profile.displayName || profile.name || `人物${index + 1}`, 160),
        role: clean(profile.roleName || profile.role || '', 240),
        gender: clean(profile.gender || 'unspecified', 40),
        apparent_age: clean(profile.age_contract?.value || profile.age || '', 80),
        relationship: clean(profile.relationship || '', 500),
        appearance: clean(profile.appearanceText || '', 3000),
        body_shape: clean(profile.bodyShapeText || profile.body_shape || '', 800),
        ethnicity_design: clean(profile.ethnicity || profile.ethnic_appearance || '', 800),
        negative: clean(profile.negativeText || '', 1600),
      },
      voice: {
        voice_id: clean(profile.voice_id || profile.voice?.voice_id || '', 200),
        direction: clean(profile.voice_tone || profile.voice?.direction || '', 800),
      },
      looks: fallbackLooks,
      states: rows(profile.age_states).map((state, stateIndex) => ({
        id: clean(state.id, 160) || stableId('character_state', id, stateIndex),
        name: clean(state.name || state.state_name || `状态 ${stateIndex + 1}`, 160),
        story_state: clean(state.story_state || '', 600),
        apparent_age: clean(state.apparent_age || '', 80),
        scene_ids: rows(state.scene_ids).map(value => clean(value, 160)),
      })),
      performance_library: {
        expressions: expressions.map((item, expressionIndex) => ({
          id: clean(item.id, 160) || stableId('expression', id, expressionIndex, item.key),
          key: clean(item.key || item.name || '', 80), image_url: clean(item.image_url || item.url || '', 1600),
        })),
        actions: actions.map((item, actionIndex) => ({
          id: clean(item.id, 160) || stableId('performance', id, actionIndex, item.key),
          key: clean(item.key || item.name || '', 80), image_url: clean(item.image_url || item.url || '', 1600),
        })),
      },
      assets: {
        dossier_sheet_url: clean(asset.dossier_sheet?.image_url || asset.subject_board_url || '', 1600),
        face_master_url: clean(nativeMasters.face?.image_url || asset.face_master?.image_url || '', 1600),
        body_master_url: clean(nativeMasters.body?.image_url || asset.body_master?.image_url || '', 1600),
        person_contract_status: clean(asset.person_contract?.status || ctx.person_contract?.status || '', 80),
      },
      owned_props: ownedProps(profile, id),
    };
  });
}

function buildProps(source = {}, characters = [], shots = []) {
  const profileProps = characters.flatMap(character => character.owned_props || []);
  const rootProps = source.prop_assets.map((prop, index) => ({
    id: clean(prop.prop_id || prop.id, 160) || stableId('prop', source.task.id, index, prop.name),
    name: clean(prop.name || `道具${index + 1}`, 160),
    kind: clean(prop.type || prop.kind || 'handheld', 80),
    attachment_mode: clean(prop.attachment_mode || (prop.type === 'fixed_scene_object' ? 'placed' : 'carried'), 40),
    owner_character_id: clean(prop.owner_id || prop.owner_character_id || '', 160),
    default_slot: clean(prop.slot || 'hand_or_scene', 80),
    default_hand: clean(prop.hand || 'unspecified', 30),
    description: clean(prop.description || '', 900), material: clean(prop.material || '', 180),
    scale: clean(prop.scale || '', 120), quantity: Math.max(1, Number(prop.quantity || 1) || 1),
    image_url: clean(prop.image_url || prop.url || '', 1600), source: 'prop_assets',
  }));
  const unique = [...rootProps, ...profileProps].filter((item, index, list) => list.findIndex(other => other.id === item.id) === index);
  return propTimelines.attachTimelines(unique, shots);
}

function sceneSpaces(source = {}) {
  const activePlan = source.asset_plan_active?.plan || {};
  return rows(source.scene_config.spaces || source.scene_config.scenes || activePlan.spaces || source.context.scene_plan?.spaces);
}

function buildScenes(source = {}) {
  const spaces = sceneSpaces(source);
  const assets = source.scene_assets;
  return spaces.map((space, index) => {
    const id = clean(space.id || space.space_id || space.scene_id, 160) || stableId('scene', source.task.id, index, space.name);
    const asset = assets.find(item => clean(item.scene_id || item.id, 160) === id) || {};
    const panorama = rows(asset.scene_world_assets?.panoramas)[0] || {};
    const viewImages = rows(asset.view_images);
    const masterView = viewImages.find(view => clean(view.key || view.id || view.camera_id, 80).toLowerCase() === 'master'
      || clean(view.camera_id, 80).toLowerCase() === 'camera_master') || {};
    const cameras = rows(asset.cameras || space.scene_spec?.cameraPlan || space.camera_plan).map((camera, cameraIndex) => ({
      id: clean(camera.id || camera.camera_id, 160) || stableId('camera', id, cameraIndex, camera.label),
      scene_id: id, label: clean(camera.label || `机位 ${cameraIndex + 1}`, 160),
      lens: clean(camera.lens || camera.lens_mm || '', 80), framing: clean(camera.framing || camera.shot_size || '', 100),
      fov: Number(camera.fov || 0) || 0, height: clean(camera.height || '', 80),
      orientation: clean(camera.orientation || '', 300), movement: clean(camera.movement || '', 800),
      position: camera.position || camera.camera_position || null, look_at: camera.look_at || camera.lookAt || null,
      image_url: clean(camera.image_url || '', 1600),
    }));
    return {
      id, name: clean(space.name || asset.name || `场景 ${index + 1}`, 200),
      story_purpose: clean(space.story_purpose || space.description || '', 1000),
      spatial_contract: {
        layout: clean(space.scene_spec?.layoutText || space.scene_spec?.layout || asset.scene_spec?.layout || '', 2400),
        materials: clean(space.scene_spec?.materialLightText || space.scene_spec?.materials || asset.scene_spec?.materials || '', 1800),
        lighting: clean(space.scene_spec?.light || asset.scene_spec?.light || '', 900),
        interaction_zones: rows(asset.zones || asset.spatial_contract?.interaction_zones),
        routes: rows(asset.routes || asset.spatial_contract?.routes),
        fixed_prop_placements: rows(asset.spatial_contract?.fixed_prop_placements),
      },
      assets: {
        master_view_url: clean(asset.master_view?.image_url || masterView.image_url || masterView.url || asset.image_url || asset.url || asset.layout?.image_url || '', 1600),
        panorama_id: clean(panorama.id || '', 160), panorama_url: clean(panorama.image_url || asset.scene_world_assets?.panorama_url || '', 1600),
        panorama_authority: clean(asset.scene_world_assets?.authority_mode || '', 60),
        view_images: viewImages.map(view => ({ id: clean(view.id || view.key, 160), image_url: clean(view.image_url || view.url, 1600) })),
      },
      cameras,
      qa: asset.qa || {},
    };
  });
}

function characterRefs(shot = {}, characters = []) {
  const haystack = JSON.stringify([shot.characters, shot.speaker_id, shot.speaker, shot.dialogue_lines, shot.visual, shot.action]);
  const matched = characters.filter(character => [character.id, character.identity.display_name].some(value => value && haystack.includes(value))).map(item => item.id);
  return [...new Set(matched)];
}

function shotScene(shot = {}, scenes = []) {
  const exact = scenes.find(scene => [shot.scene_id, shot.sceneId, shot.scene].some(value => clean(value, 160) === scene.id || clean(value, 160) === scene.name));
  return exact || (scenes.length === 1 ? scenes[0] : null);
}

function buildShots(source = {}, characters = [], props = [], scenes = []) {
  return source.storyboard.map((shot, index) => {
    const id = clean(shot.shot_id || shot.id, 160) || stableId('shot', source.task.id, index, shot.title);
    const scene = shotScene(shot, scenes);
    const contract = source.keyframe_contracts[index] || {};
    const cast = characterRefs(shot, characters);
    const characterBindings = cast.map(characterId => {
      const character = characters.find(row => row.id === characterId);
      const look = character ? personLooks.lookForShot({ id: character.id, look_profiles: character.looks }, shot) : null;
      return {
        character_id: characterId,
        look_id: look?.id || character?.looks?.[0]?.id || '',
        expression: clean(shot.expression || shot.emotion || 'neutral', 160),
        action_start: clean(shot.action_start || shot.entry_frame_state || '', 900),
        action_end: clean(shot.action_end || shot.exit_frame_state || shot.action || '', 900),
      };
    });
    const objectBindings = props.map(prop => {
      const state = rows(prop.shot_timeline).find(row => Number(row.shot_index) === index);
      if (!state?.present) return null;
      return { prop_id: prop.id, owner_character_id: state.owner_id || prop.owner_character_id, state: state.state,
        placement: state.placement, hand_contact: state.hand_contact, attachment_mode: prop.attachment_mode };
    }).filter(Boolean);
    const camera = scene?.cameras.find(row => [shot.camera_id, shot.cameraId].some(value => clean(value, 160) === row.id)) || scene?.cameras[0] || null;
    return {
      id, index: index + 1, title: clean(shot.title || `镜头 ${index + 1}`, 160), duration_sec: Number(shot.duration || shot.duration_sec || 3) || 3,
      scene_binding: { scene_id: scene?.id || clean(shot.scene_id || '', 160), zone_id: clean(shot.zone_id || shot.scene_zone_id || '', 160), panorama_id: scene?.assets.panorama_id || '' },
      camera_binding: { camera_id: camera?.id || clean(shot.camera_id || '', 160), shot_size: clean(shot.shot_size || '', 100), camera_angle: clean(shot.camera_angle || '', 100), lens_mm: Number(shot.lens_mm || 0) || 0, fov: Number(shot.fov || 0) || 0, composition: clean(shot.composition || '', 600), axis: clean(shot.camera_axis || '', 160), movement: clean(shot.camera_movement || '', 600) },
      character_bindings: characterBindings,
      object_bindings: objectBindings,
      performance: { visual: clean(shot.visual || '', 2000), action: clean(shot.action || '', 1600), entry_state: clean(shot.entry_frame_state || '', 900), exit_state: clean(shot.exit_frame_state || '', 900), requires_previous_frame: shot.requires_previous_frame === true },
      audio: { speech_mode: clean(shot.speech_mode || '', 40), speaker_id: clean(shot.speaker_id || '', 160), dialogue_lines: rows(shot.dialogue_lines), ambient_sound: clean(shot.ambient_sound || '', 600), sfx: rows(shot.sfx), music_cue: clean(shot.music_cue || '', 600), audio_bridge: clean(shot.audio_bridge || '', 600), voiceover_timing: clean(shot.voiceover_timing || '', 400) },
      lighting_mood: clean(shot.lighting_mood || '', 800), transition: clean(shot.transition || shot.transition_type || '', 300),
      prompt_source: 'production_graph_only', keyframe_contract_fingerprint: clean(contract.contract_fingerprint || '', 200),
    };
  });
}

function validate(graph = {}) {
  const issues = [];
  if (!graph.story.blueprint_fingerprint) issues.push('blueprint_missing');
  if (!graph.characters.length && graph.story.cast_expected > 0) issues.push('characters_missing');
  graph.characters.forEach(character => {
    if (!character.identity.appearance) issues.push(`character_appearance_missing:${character.id}`);
    if (!character.looks.some(look => look.wardrobe && look.hair_makeup)) issues.push(`character_look_incomplete:${character.id}`);
    if (!character.assets.dossier_sheet_url) issues.push(`character_dossier_missing:${character.id}`);
    if (!character.assets.face_master_url || !character.assets.body_master_url) issues.push(`character_native_master_missing:${character.id}`);
    if (character.performance_library.expressions.length < 6) issues.push(`character_expressions_missing:${character.id}`);
    if (character.performance_library.actions.length < 6) issues.push(`character_actions_missing:${character.id}`);
  });
  graph.scenes.forEach(scene => {
    if (!scene.spatial_contract.layout) issues.push(`scene_layout_missing:${scene.id}`);
    if (!scene.cameras.length) issues.push(`scene_cameras_missing:${scene.id}`);
    if (!scene.assets.master_view_url) issues.push(`scene_master_view_missing:${scene.id}`);
    if (normalizeSpatialMode(graph.spatial_mode) === PANORAMA_MODE
      && (!scene.assets.panorama_url || scene.assets.panorama_authority !== PANORAMA_MODE)) issues.push(`scene_panorama_missing:${scene.id}`);
  });
  graph.props.filter(prop => prop.attachment_mode === 'carried').forEach(prop => {
    if (!prop.description) issues.push(`carry_prop_description_missing:${prop.id}`);
    if (!prop.image_url) issues.push(`carry_prop_asset_missing:${prop.id}`);
  });
  graph.shots.forEach(shot => {
    if (!shot.scene_binding.scene_id) issues.push(`shot_scene_missing:${shot.id}`);
    if (!shot.camera_binding.camera_id) issues.push(`shot_camera_missing:${shot.id}`);
    if (shot.audio.speech_mode === 'dialogue' && !shot.audio.speaker_id) issues.push(`shot_speaker_missing:${shot.id}`);
  });
  return { status: issues.length ? 'incomplete' : 'ready', issues, checked_at: new Date().toISOString() };
}

function compile(taskId, options = {}) {
  const source = sourceMap(taskId);
  const spatialMode = normalizeSpatialMode(options.spatial_mode || source.spatial_contract?.mode);
  const characters = buildCharacters(source.context, taskId);
  const props = buildProps(source, characters, source.storyboard);
  const scenes = buildScenes(source);
  const shots = buildShots(source, characters, props, scenes);
  const previous = storage.getOutput(taskId, OUTPUT_KIND) || {};
  const graph = {
    schema_version: SCHEMA_VERSION, contract_version: CONTRACT_VERSION, graph_id: previous.graph_id || stableId('production_graph', taskId),
    task_id: taskId, content_revision: Number(source.task.content_revision || 1) || 1, spatial_mode: spatialMode,
    revision: Math.max(1, Number(previous.revision || 0) + (options.publish === false ? 0 : 1)),
    authority: { mode: AUTHORITY, execution_path: 'new_only', legacy_generation_writes: 'blocked', prompt_source: 'graph_only' },
    story: { blueprint_id: clean(source.blueprint.id || '', 160), blueprint_revision: Number(source.blueprint.revision || 0), blueprint_fingerprint: clean(source.blueprint.fingerprint || '', 200), cast_expected: rows(source.context.cast_profiles).length, beats: rows(source.blueprint.beats) },
    characters, props, scenes, shots,
    lineage: {
      context_fingerprint: fingerprint(source.context), asset_plan_fingerprint: clean(source.asset_plan_active?.fingerprint || '', 200),
      scene_config_fingerprint: fingerprint(source.scene_config), scene_assets_fingerprint: fingerprint(source.scene_assets),
      storyboard_fingerprint: fingerprint(source.storyboard), keyframe_contracts_fingerprint: fingerprint(source.keyframe_contracts),
    },
    compiled_at: new Date().toISOString(), compiled_by: clean(options.compiled_by || 'production_graph_compiler', 120),
  };
  graph.validation = validate(graph);
  graph.fingerprint = fingerprint(graph);
  return graph;
}

function publish(taskId, options = {}) {
  const graph = compile(taskId, options);
  storage.saveOutput(taskId, OUTPUT_KIND, graph, { input_fingerprint: graph.fingerprint, qa_status: graph.validation.status });
  storage.saveStage(taskId, 'production_graph', { status: graph.validation.status === 'ready' ? 'done' : 'running', output_summary: `${graph.characters.length} 人物、${graph.scenes.length} 场景、${graph.shots.length} 镜头`, diagnostics: graph.validation });
  storage.updateTask(taskId, { production_graph_authority: AUTHORITY, legacy_generation_enabled: false, production_graph_fingerprint: graph.fingerprint, production_graph_revision: graph.revision });
  return graph;
}

function authorityActive(taskId) {
  const task = storage.getTask(taskId) || {};
  return task.production_graph_authority === AUTHORITY && task.legacy_generation_enabled === false;
}

function assertLegacyMutationAllowed(taskId, stage = '') {
  if (!taskId) return;
  const error = new Error('旧的独立生成入口已停用，请使用“生成全部制作资产”。');
  error.code = 'LEGACY_PRODUCTION_PATH_BLOCKED'; error.status = 409; error.retryable = false; error.stage = stage;
  throw error;
}

function assertExecutable(taskId) {
  const task = storage.getTask(taskId) || {};
  if (!authorityActive(taskId)) return null;
  const graph = storage.getOutput(taskId, OUTPUT_KIND);
  const current = graph && graph.validation?.status === 'ready'
    && Number(graph.content_revision || 0) === Number(task.content_revision || 0)
    && graph.fingerprint === task.production_graph_fingerprint;
  if (current) return graph;
  const error = new Error('统一制作图谱已失效或仍有缺项；已阻止关键帧/视频继续使用旧人物、场景或镜头合同，请先重新生成全部制作资产。');
  error.code = 'PRODUCTION_GRAPH_NOT_EXECUTABLE'; error.status = 409; error.retryable = true;
  throw error;
}

module.exports = { SCHEMA_VERSION, CONTRACT_VERSION, OUTPUT_KIND, AUTHORITY, MULTI_VIEW_MODE, PANORAMA_MODE,
  normalizeSpatialMode, fingerprint, compile, publish, validate, authorityActive, assertLegacyMutationAllowed, assertExecutable };
