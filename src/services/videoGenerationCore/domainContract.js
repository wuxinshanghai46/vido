const crypto = require('crypto');

const CAST_MODES = Object.freeze(['no_human', 'single', 'dual', 'multi_principal', 'crowd']);
const GENERATION_MODES = Object.freeze(['single_shot', 'one_take', 'local_motion']);

/** 把任意值转换为去除首尾空白的安全文本。 */
function text(value = '') {
  return String(value ?? '').trim();
}

/** 把任意值转换为数组，并过滤空值。 */
function list(value = []) {
  return (Array.isArray(value) ? value : []).filter(item => item !== null && item !== undefined && item !== '');
}

/** 生成不依赖对象字段顺序的稳定指纹。 */
function fingerprint(value = {}) {
  const normalize = input => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return input;
    return Object.keys(input).sort().reduce((out, key) => {
      out[key] = normalize(input[key]);
      return out;
    }, {});
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

/** 将镜头时长限制在供应商可执行的安全范围内。 */
function durationOf(shot = {}) {
  const value = Number(shot.duration_sec ?? shot.duration ?? shot.seconds ?? 3);
  return Math.max(1, Math.min(15, Number.isFinite(value) ? value : 3));
}

/** 从人物对象或名称中读取稳定的人物标识。 */
function characterId(character = {}, index = 0) {
  if (typeof character === 'string') return text(character) || `character-${index + 1}`;
  return text(character.id || character.character_id || character.asset_id || character.name) || `character-${index + 1}`;
}

/** 根据明确配置、人物列表和人数推断通用人物规模。 */
function castModeOf(shot = {}) {
  const explicit = text(shot.cast_mode || shot.person_mode || shot.subject_type).toLowerCase().replace(/[\s-]+/g, '_');
  if (CAST_MODES.includes(explicit)) return explicit;
  if (/no_?(person|human)|object_?only|product_?only|empty/.test(explicit)) return 'no_human';
  if (/crowd|extras|audience|群演|人群/.test(explicit)) return 'crowd';
  if (/dual|two|双人/.test(explicit)) return 'dual';
  if (/single|one|单人/.test(explicit)) return 'single';
  if (/multi|group|多人/.test(explicit)) return 'multi_principal';
  const authored = list(shot.characters || shot.cast || shot.principal_characters);
  const declaredCount = Number(shot.people_count ?? shot.person_count ?? shot.expected_people ?? authored.length);
  const count = Number.isFinite(declaredCount) ? Math.max(0, declaredCount) : authored.length;
  if (count <= 0) return 'no_human';
  if (count === 1) return 'single';
  if (count === 2) return 'dual';
  if (count <= 4) return 'multi_principal';
  return 'crowd';
}

/** 读取物理场景世界标识；不同世界绝不合并为一个生成单元。 */
function sceneWorldIdentity(shot = {}, contract = {}, index = 0) {
  const lock = contract.scene_lock || {};
  const id = text(shot.scene_world_id || shot.scene_id || shot.scene_asset_id || lock.scene_id) || `unbound-world-${index + 1}`;
  const revision = Math.max(1, Number(shot.scene_revision || lock.scene_revision || 1) || 1);
  return { id, revision, key: `${id}@${revision}` };
}

/** 读取同一物理世界的一次访问状态，用于区分昼夜、天气和重新入场。 */
function sceneVisitIdentity(shot = {}, contract = {}, index = 0) {
  const world = sceneWorldIdentity(shot, contract, index);
  const lock = contract.scene_lock || {};
  const explicit = text(shot.scene_visit_id || shot.visit_id);
  const state = {
    world_key: world.key,
    time_of_day: text(shot.time_of_day || shot.temporal_state || shot.time_state),
    weather: text(shot.weather || lock.weather),
    lighting: lock.scene_contract?.lighting || lock.lighting || '',
    visit_sequence: Number(shot.scene_visit_sequence || 0) || 0,
  };
  return {
    id: explicit || `${world.id}-visit-${fingerprint(state).slice(0, 10)}`,
    world,
    state,
  };
}

/** 构建镜头使用的主角、配角、群演和站位合同。 */
function buildCastContract(shot = {}) {
  const authored = list(shot.characters || shot.cast || shot.principal_characters);
  const principalIds = list(shot.principal_character_ids).map(text);
  const resolvedPrincipalIds = principalIds.length ? principalIds : authored.map(characterId);
  const supportingIds = list(shot.supporting_character_ids || shot.supporting_characters).map(characterId);
  const mode = castModeOf(shot);
  return {
    mode,
    principal_character_ids: mode === 'no_human' ? [] : resolvedPrincipalIds,
    supporting_character_ids: supportingIds,
    crowd_spec: shot.crowd_spec || (mode === 'crowd' ? {
      count: Number(shot.people_count || shot.expected_people || authored.length) || 5,
      wardrobe_style: text(shot.crowd_wardrobe_style),
      movement_pattern: text(shot.crowd_movement_pattern),
    } : null),
    blocking_map: shot.blocking_map || shot.blocking || {},
    screen_position: shot.screen_position || {},
    eyeline_target_id: text(shot.eyeline_target_id),
    camera_axis_id: text(shot.camera_axis_id || shot.axis_id),
  };
}

/** 构建可被不同行业复用的单个成片镜头合同。 */
function buildEditShot(shot = {}, contract = {}, index = 0) {
  const visit = sceneVisitIdentity(shot, contract, index);
  const cast = buildCastContract(shot);
  const sceneLock = contract.scene_lock || {};
  const editShot = {
    id: text(shot.id || shot.shot_id) || `edit-shot-${index + 1}`,
    index,
    shot_number: index + 1,
    title: text(shot.title) || `第 ${index + 1} 镜`,
    duration_sec: durationOf(shot),
    scene_world_id: visit.world.id,
    scene_world_revision: visit.world.revision,
    scene_visit_id: visit.id,
    scene_visit_state: visit.state,
    scene_zone_ids: list(shot.scene_zone_ids || shot.zone_ids || sceneLock.zone_ids).map(text),
    look_cluster_id: text(shot.look_cluster_id || shot.visual_style_id || 'default-look'),
    cast,
    camera_view_id: text(shot.camera_view_id || shot.scene_view || contract.scene_lock?.scene_view),
    camera_axis_id: cast.camera_axis_id,
    visual: text(shot.visual || shot.visual_description),
    action: text(shot.action || shot.visual_action),
    camera: text(shot.camera || shot.camera_movement),
    transition_type: text(shot.transition_type || shot.transition).toLowerCase(),
    entry_frame_state: text(shot.entry_frame_state || shot.entry_state),
    exit_frame_state: text(shot.exit_frame_state || shot.exit_state),
    screen_direction: text(shot.screen_direction),
    wardrobe_revision: text(shot.wardrobe_revision || contract.person_lock?.wardrobe_revision),
    prop_states: shot.prop_states || shot.object_states || {},
    requested_generation_mode: text(shot.generation_mode || shot.execution_mode).toLowerCase(),
    one_take_group_id: text(shot.one_take_group_id),
    contract_fingerprint: text(contract.contract_fingerprint),
  };
  return { ...editShot, fingerprint: fingerprint(editShot) };
}

/** 判断两个成片镜头是否属于同一次场景访问。 */
function sameSceneVisit(left = {}, right = {}) {
  return !!left.scene_visit_id && left.scene_visit_id === right.scene_visit_id;
}

/** 判断两个镜头是否具备明确的动作或方向交接。 */
function hasContinuityHandoff(left = {}, right = {}) {
  if (text(left.exit_frame_state) && text(right.entry_frame_state)) return true;
  const leftDirection = text(left.screen_direction).toLowerCase();
  const rightDirection = text(right.screen_direction).toLowerCase();
  return !!leftDirection && leftDirection === rightDirection;
}

module.exports = {
  CAST_MODES,
  GENERATION_MODES,
  text,
  list,
  fingerprint,
  durationOf,
  characterId,
  castModeOf,
  sceneWorldIdentity,
  sceneVisitIdentity,
  buildCastContract,
  buildEditShot,
  sameSceneVisit,
  hasContinuityHandoff,
};
