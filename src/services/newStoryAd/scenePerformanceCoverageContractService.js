'use strict';

const personIdentity = require('./personIdentityContractService');

const CONTRACT_VERSION = 1;
const list = value => Array.isArray(value) ? value.filter(Boolean) : [];
const clean = (value = '', max = 1600) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function idOf(value = {}) { return clean(value.scene_id || value.scene_asset_id || value.id, 120); }

function actorPlan(asset = {}, ctx = {}) {
  if (!personIdentity.personRequired(ctx)) return null;
  const spec = asset.scene_spec || {};
  const experience = spec.sceneExperienceContract || spec.scene_experience_contract || {};
  const interaction = clean(spec.interactionText || spec.interaction_text, 1400);
  const planned = asset.scene_plan_actor_blocking_required === true || experience.actor_blocking_required === true;
  if (!planned) return null;
  return {
    interaction,
    layout: clean(spec.layoutText || spec.layout_text || spec.layout, 1600),
    anchors: list(spec.interactionAnchors || spec.interaction_anchors),
    routes: list(spec.routes || spec.movement_routes),
    cameras: list(asset.scene_contract?.cameras || spec.cameraPlan || spec.camera_plan),
  };
}

function hasPerson(shot = {}) {
  return personIdentity.shotPersonPresence(shot, {}).required;
}

function castForShot(ctx = {}, action = '') {
  const rows = list(ctx.characters).length ? list(ctx.characters) : list(ctx.cast_profiles);
  if (rows.length) return rows.slice(0, Math.max(1, Number(ctx.expected_people || 1) || 1)).map(item => ({
    ...(item && typeof item === 'object' ? item : { name: clean(item, 120) }),
    name: clean(item?.name || item?.displayName || item?.roleName || item, 120),
    action: clean(action, 600),
  }));
  const person = ctx.person_asset || {};
  const name = clean(person.name || person.displayName || person.profile?.name || '', 120);
  return name ? [{ name, action: clean(action, 600) }] : [];
}

function stripNegativePersonText(value = '') {
  return clean(value, 1600).split(/[。；;]/u)
    .filter(clause => !/(?:禁止|不得|不要|不出现|无人|no\s+person|without\s+(?:a\s+)?person).{0,10}(?:人物|真人|演员|模特|人手|person|human|actor|model)?/iu.test(clause))
    .join('；');
}

function ensureCoverage(shots = [], sceneAssets = [], ctx = {}) {
  const result = list(shots).map(shot => ({ ...shot }));
  const assets = new Map(list(sceneAssets).map(asset => [idOf(asset), asset]));
  const grouped = new Map();
  result.forEach((shot, index) => {
    const id = idOf(shot);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push({ shot, index });
  });
  grouped.forEach((entries, sceneId) => {
    const plan = actorPlan(assets.get(sceneId) || {}, ctx);
    if (!plan || entries.some(entry => hasPerson(entry.shot))) return;
    const selected = entries[0];
    if (!selected) return;
    const anchor = plan.anchors[0] || {};
    const route = plan.routes[0] || {};
    const interactionCamera = plan.cameras.find(camera => /interaction|人物|互动|跟随/iu.test(clean([
      camera.id, camera.view_id, camera.label, camera.role, camera.movement_type,
    ].join(' '), 600))) || plan.cameras.find(camera => clean(camera.view_id, 80) === 'interaction') || plan.cameras[0] || {};
    const action = plan.interaction || clean(route.label || route.continuity || anchor.purpose, 1000);
    const personCharacters = castForShot(ctx, action);
    const anchorLabel = clean(anchor.label || anchor.name, 200);
    const routeLabel = clean(route.label || route.continuity, 300);
    const visualAuthority = [
      `人物依照已确认场景规划进入并完成互动，画面保留可识别的完整空间关系`,
      plan.layout ? `空间布局：${plan.layout}` : '',
      anchorLabel ? `人物站位对应互动点“${anchorLabel}”` : '',
      routeLabel ? `行动路线：${routeLabel}` : '',
    ].filter(Boolean).join('；');
    selected.shot = result[selected.index] = {
      ...selected.shot,
      subject_type: 'human_scene',
      expected_people: Math.max(1, Number(ctx.expected_people || personCharacters.length || 1) || 1),
      characters: personCharacters,
      no_person: false,
      noHuman: false,
      scene_view: clean(interactionCamera.view_id || 'interaction', 80),
      camera_id: clean(interactionCamera.id || interactionCamera.camera_id, 120) || selected.shot.camera_id,
      scene_context_role: 'planned_actor_interaction',
      shot_size: /^(?:wide|full|medium|medium_wide)$/i.test(clean(selected.shot.shot_size, 80)) ? selected.shot.shot_size : 'medium_wide',
      lens_mm: Number(selected.shot.lens_mm || 0) > 50 ? 35 : (Number(selected.shot.lens_mm || 0) || 35),
      subject_position: anchor.normalized_position ? `人物位于场景归一化坐标 ${JSON.stringify(anchor.normalized_position)}` : selected.shot.subject_position,
      visual: `${visualAuthority}。${stripNegativePersonText(selected.shot.visual || selected.shot.visual_description)}`,
      action: `${action || '人物按规划路线移动到互动位置并完成当前剧情动作'}。${stripNegativePersonText(selected.shot.action)}`,
      keyframe_notes: `${visualAuthority}；必须显示人物、规划站位和对应场景机位。${stripNegativePersonText(selected.shot.keyframe_notes)}`,
      scene_performance_contract: { version: CONTRACT_VERSION, scene_id: sceneId, source: 'structured_scene_plan' },
    };
    const establishing = entries.find(entry => entry.index !== selected.index) || null;
    if (establishing) {
      const establishingAuthority = [
        `空间建立镜必须清楚呈现当前场景的完整边界、整面主要展示面和人物行动所依赖的空间关系`,
        plan.layout ? `空间布局：${plan.layout}` : '',
        anchorLabel ? `保留互动点“${anchorLabel}”所在位置` : '',
      ].filter(Boolean).join('；');
      establishing.shot = result[establishing.index] = {
        ...establishing.shot,
        scene_view: 'master',
        scene_context_role: 'planned_scene_establishing',
        shot_size: 'wide',
        lens_mm: Number(establishing.shot.lens_mm || 0) > 40 ? 35 : (Number(establishing.shot.lens_mm || 0) || 35),
        visual: `${establishingAuthority}。${clean(establishing.shot.visual || establishing.shot.visual_description, 1600)}`,
        keyframe_notes: `${establishingAuthority}；不得裁成仅剩局部墙面或单块材质。${clean(establishing.shot.keyframe_notes, 1600)}`,
        scene_performance_contract: { version: CONTRACT_VERSION, scene_id: sceneId, source: 'structured_scene_plan', role: 'spatial_establishing' },
      };
    }
  });
  return result;
}

function inspect(shots = [], sceneAssets = [], ctx = {}) {
  const missing = list(sceneAssets).filter(asset => {
    const plan = actorPlan(asset, ctx);
    if (!plan) return false;
    return !list(shots).filter(shot => idOf(shot) === idOf(asset)).some(hasPerson);
  });
  return {
    contract_version: CONTRACT_VERSION,
    ready: missing.length === 0,
    missing_scene_ids: missing.map(idOf),
    issues: missing.map(asset => `${clean(asset.name || idOf(asset), 160)}缺少场景规划要求的人物站位与互动镜头`),
  };
}

module.exports = { CONTRACT_VERSION, actorPlan, hasPerson, ensureCoverage, inspect };
