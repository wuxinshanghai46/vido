const revisionService = require('./revisionService');

const SCENE_BLOCK_POLICY_VERSION = 'spatial-scene-block-v1';
const DEFAULT_MAX_BLOCK_DURATION = 15;
const DEFAULT_MAX_BLOCK_SHOTS = 4;

function text(value = '') {
  return String(value || '').trim();
}

function clipped(value = '', limit = 240) {
  return text(value).slice(0, limit);
}

function durationOf(shot = {}) {
  return Math.max(1, Math.min(15, Number(shot.duration_sec || shot.duration || shot.seconds || 3) || 3));
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

function isExplicitBoundary(shot = {}, previousShot = {}) {
  const transition = text(shot.transition_type || shot.transition).toLowerCase();
  const from = text(shot.transition_from || '');
  const previousScene = text(previousShot.scene_id || previousShot.scene_asset_id || '');
  if (from && previousScene && from !== previousScene) return true;
  if (/fade|dissolve|flash|black|time.?jump|montage/.test(transition)) return true;
  return shot.scene_block_boundary === true || shot.force_new_scene_block === true;
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

function buildSceneBlocks(shots = [], contracts = [], options = {}) {
  const list = Array.isArray(shots) ? shots : [];
  const enabled = options.scene_block_generation !== false && options.sceneBlockGeneration !== false;
  const maxDuration = Math.max(5, Math.min(15, Number(options.scene_block_max_duration || options.sceneBlockMaxDuration || DEFAULT_MAX_BLOCK_DURATION) || DEFAULT_MAX_BLOCK_DURATION));
  const maxShots = Math.max(1, Math.min(8, Number(options.scene_block_max_shots || options.sceneBlockMaxShots || DEFAULT_MAX_BLOCK_SHOTS) || DEFAULT_MAX_BLOCK_SHOTS));
  const blocks = [];
  let current = null;
  list.forEach((shot, index) => {
    const contract = contracts[index] || {};
    const identity = sceneIdentity(shot, contract);
    const temporal = temporalIdentity(shot, contract);
    const shotDuration = durationOf(shot);
    const previousIndex = current?.member_indexes?.[current.member_indexes.length - 1];
    const previousShot = previousIndex == null ? {} : list[previousIndex] || {};
    const join = enabled && current && identity && identity === current.scene_identity
      && temporal === current.temporal_identity
      && !isExplicitBoundary(shot, previousShot)
      && current.duration_sec + shotDuration <= maxDuration
      && current.member_indexes.length < maxShots;
    if (!join) {
      if (current) blocks.push(finalizeBlock(current, list, contracts));
      current = { scene_identity: identity || `unbound-shot-${index + 1}`, temporal_identity: temporal, member_indexes: [index], duration_sec: shotDuration };
    } else {
      current.member_indexes.push(index);
      current.duration_sec += shotDuration;
    }
  });
  if (current) blocks.push(finalizeBlock(current, list, contracts));
  return blocks;
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

function generationShot(block = {}, shots = []) {
  const memberShots = block.member_indexes.map(index => shots[index] || {});
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

function generationPrompt(block = {}, shots = [], contracts = [], repairInstructions = {}) {
  const firstContract = contracts[block.first_index] || {};
  const repairs = block.member_indexes.map(index => repairInstructions[index]).filter(Boolean);
  const promptBeats = (block.beats || []).map(beat => ({
    shot_index: beat.shot_index, start_sec: beat.start_sec, end_sec: beat.end_sec,
    visual: clipped(beat.visual, 150), action: clipped(beat.action, 130),
    camera_movement: clipped(beat.camera_movement, 90), entry_frame_state: clipped(beat.entry_frame_state, 90),
    exit_frame_state: clipped(beat.exit_frame_state, 90), screen_direction: clipped(beat.screen_direction, 60),
    object_states: clipped(beat.object_states, 90), characters: beat.characters,
  }));
  return [
    'Generate one uninterrupted continuous shot inside one current-task spatial scene. Do not cut, dissolve, teleport or rebuild the room between beats.',
    'Treat doors, windows, walls, fixed furniture, display structures, dominant materials, lighting direction and spatial anchors as immutable geometry for the whole clip.',
    'Move the camera and subjects continuously through the established space. Preserve cast identity, wardrobe, product, prop state, screen direction and action handoff across every beat.',
    'The task may represent any lawful industry, environment, person, product or story. Use only this task contract and never substitute a template scene.',
    repairs.length ? `QA repair requirements: ${repairs.join('\n')}` : '',
    `Ordered timeline beats: ${JSON.stringify(promptBeats)}`,
    `Scene block contract: ${JSON.stringify({ id: block.id, scene_identity: block.scene_identity, duration_sec: block.duration_sec, scene_lock: compactSceneLock(firstContract.scene_lock || {}) })}`,
  ].filter(Boolean).join('\n').slice(0, 3950);
}

module.exports = {
  SCENE_BLOCK_POLICY_VERSION,
  DEFAULT_MAX_BLOCK_DURATION,
  DEFAULT_MAX_BLOCK_SHOTS,
  durationOf,
  sceneIdentity,
  isExplicitBoundary,
  spatialReferenceUrls,
  buildSceneBlocks,
  blockForIndex,
  expandIndexesToBlocks,
  generationShot,
  compactSceneLock,
  generationPrompt,
};
